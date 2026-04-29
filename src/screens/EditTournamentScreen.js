import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadTournament, saveTournament, subscribeTournamentChanges, DEFAULT_SETTINGS, randomPairs,
  deriveRoundPlayingHandicap, normalizeRoundHandicaps, readLocal,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

export default function EditTournamentScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [tournament, setTournament] = useState(null);
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const tournamentRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const isFirstRender = useRef(true);
  // Set when a subscription-driven reload pushes fresh display-only data
  // into local state so the debounced save effect doesn't echo it back.
  const skipNextSaveRef = useRef(false);

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      const t = await loadTournament();
      if (cancelled) return;
      setTournament(t);
      setPlayers(t.players.map((p) => ({ ...p, handicap: String(p.handicap) })));
      setSettings({ ...DEFAULT_SETTINGS, ...t.settings, bestBallValue: String((t.settings ?? DEFAULT_SETTINGS).bestBallValue ?? 1), worstBallValue: String((t.settings ?? DEFAULT_SETTINGS).worstBallValue ?? 1) });
      setRounds(t.rounds.map((r) => {
        const normalized = normalizeRoundHandicaps(r, t.players);
        return {
          ...normalized,
          holes: [...normalized.holes],
          notes: normalized.notes ?? '',
          playerHandicaps: Object.fromEntries(
            t.players.map((p) => [p.id, String(normalized.playerHandicaps[p.id] ?? p.handicap)]),
          ),
          manualHandicaps: { ...(normalized.manualHandicaps ?? {}) },
        };
      }));
    }

    // On subscription-driven reloads we only refresh display-only fields
    // (player names) so ongoing local edits are preserved. Any change that
    // originates from external writes (library rename, course slope
    // propagation, another screen's save) should not discard the user's
    // in-flight handicap/course-name/notes edits on this screen.
    async function mergeLoad() {
      const t = await loadTournament();
      if (cancelled || !t) return;
      setTournament(t);
      setPlayers((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const fresh = t.players.find((x) => x.id === p.id);
          if (fresh && fresh.name !== p.name) {
            changed = true;
            return { ...p, name: fresh.name };
          }
          return p;
        });
        if (!changed) return prev;
        skipNextSaveRef.current = true;
        return next;
      });
    }

    initialLoad();
    const unsub = subscribeTournamentChanges(mergeLoad);
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (!tournamentRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const builtPlayers = players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }));
      const builtRounds = rounds.map((r) => ({
        ...r,
        playerHandicaps: Object.fromEntries(
          Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
        ),
        manualHandicaps: { ...(r.manualHandicaps ?? {}) },
      }));

      // Emit per-cell handicap.set mutations so offline edits are queued and
      // the relevant _meta paths are stamped for LWW merge. The rest of the
      // tournament (players, settings, notes, etc.) rides on the saveTournament
      // call below, which is offline-safe since Task 5.
      //
      // Re-read the freshest local snapshot so any out-of-band mutations
      // (e.g. a round.remove fired by removeRound just before this timer)
      // are preserved in the spread below. Without this, the spread of
      // tournamentRef would drop their _meta tombstones and the deletion
      // would be undone on the next merge.
      const baseId = tournamentRef.current?.id;
      let t = (baseId && (await readLocal(baseId))) || tournamentRef.current;
      for (const r of builtRounds) {
        const prevRound = t.rounds.find((pr) => pr.id === r.id);
        if (!prevRound) continue;
        for (const [pid, v] of Object.entries(r.playerHandicaps)) {
          const before = prevRound.playerHandicaps?.[pid];
          if (before === v) continue;
          t = await mutate(t, { type: 'handicap.set', roundId: r.id, playerId: pid, handicap: v });
        }
      }

      await saveTournament({
        ...t,
        players: builtPlayers,
        rounds: builtRounds,
        settings: {
          ...settings,
          bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
          worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
        },
      });
    }, 400);
  }, [players, rounds, settings]);

  const handleHolesSaved = useCallback((roundIndex, holes, slope, courseRating, playerHandicaps, manualHandicaps) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes,
        slope,
        courseRating,
        // CourseEditor returns numbers; convert to strings for our inputs
        playerHandicaps: Object.fromEntries(
          Object.entries(playerHandicaps).map(([id, v]) => [id, String(v)]),
        ),
        manualHandicaps: { ...(manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);

  function updateBaseHandicap(playerIndex, value) {
    const playerId = players[playerIndex]?.id;
    setPlayers((prev) => {
      const next = [...prev];
      next[playerIndex] = { ...next[playerIndex], handicap: value };
      return next;
    });
    if (!playerId) return;
    const parsedIndex = parseInt(value, 10) || 0;
    setRounds((prev) => prev.map((r) => {
      if (r.manualHandicaps?.[playerId]) return r;
      const derived = deriveRoundPlayingHandicap(parsedIndex, r);
      return {
        ...r,
        playerHandicaps: { ...r.playerHandicaps, [playerId]: String(derived) },
      };
    }));
  }

  function updateCourseName(roundIndex, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], courseName: value };
      return next;
    });
  }

  function addRound() {
    setRounds((prev) => {
      const builtPlayers = players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }));
      // Match each tournament's pair structure: individual stableford + 2-
      // player match play use solo-pairs; everything else gets random
      // partners. Without this an individual tournament would suddenly
      // sprout random partners on its added round.
      const mode = settings?.scoringMode;
      const pairs = mode === 'individual'
        ? builtPlayers.map((p) => [p])
        : (mode === 'matchplay' && builtPlayers.length === 2)
          ? [[builtPlayers[0]], [builtPlayers[1]]]
          : randomPairs(builtPlayers);
      const newRound = {
        id: `r${Date.now()}`,
        courseName: '',
        holes: defaultHoles(),
        slope: null,
        courseRating: null,
        playerHandicaps: Object.fromEntries(builtPlayers.map((p) => [p.id, String(p.handicap)])),
        manualHandicaps: {},
        pairs,
        scores: {},
      };
      return [...prev, newRound];
    });
  }

  async function removeRound(index) {
    const target = rounds[index];
    // Persist the deletion through mutate() so a `rounds.<id>._deleted`
    // tombstone lands in _meta. Without it the next loadTournament merge
    // would deepClone the still-present remote round back into local state.
    if (target?.id && tournamentRef.current) {
      try {
        const updated = await mutate(tournamentRef.current, {
          type: 'round.remove',
          roundId: target.id,
        });
        tournamentRef.current = updated;
        // Skip the next debounced save: mutate already wrote local + queued
        // the sync, and the spread in the save effect would otherwise echo
        // the deletion as a redundant write.
        skipNextSaveRef.current = true;
        setTournament(updated);
      } catch (_) {
        // Fall through to local-only filter so the UI still updates; the
        // debounced save will then push a truncated rounds list (without a
        // tombstone, so the historical bug shape can recur). This branch is
        // only hit if mutate itself throws, which is rare.
      }
    }
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  function updateNotes(roundIndex, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], notes: value };
      return next;
    });
  }

  function updatePlayingHandicap(roundIndex, playerId, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerHandicaps: { ...next[roundIndex].playerHandicaps, [playerId]: value },
        manualHandicaps: { ...(next[roundIndex].manualHandicaps ?? {}), [playerId]: true },
      };
      return next;
    });
  }

  if (!tournament) return null;

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit Tournament</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.container} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        {/* Base handicap indexes */}
        <View>
          <Text style={s.sectionTitle}>Handicap Index</Text>
          <Text style={s.hint}>Base index used when no slope is set for a course.</Text>
          {players.map((p, i) => (
            <View key={p.id} style={s.playerCard}>
              <Text style={s.playerName}>{p.name}</Text>
              <TextInput
                style={s.hcpInput}
                keyboardType="numeric"
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                value={p.handicap}
                onChangeText={(v) => updateBaseHandicap(i, v)}
                placeholder="0"
                placeholderTextColor={theme.text.muted}
              />
              <Text style={s.hcpLabel}>index</Text>
            </View>
          ))}
        </View>

        {/* Per-round playing handicaps */}
        {rounds.map((r, ri) => (
          <View key={r.id}>
            <View style={s.roundHeader}>
              <Text style={s.sectionTitle}>Round {ri + 1}{r.slope ? `  --  Slope ${r.slope}` : ''}</Text>
              {rounds.length > 1 && (
                <TouchableOpacity onPress={() => removeRound(ri)} style={s.removeBtn}>
                  <Feather name="trash-2" size={14} color={theme.destructive} style={{ marginRight: 4 }} />
                  <Text style={s.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={s.roundCard}>
              <TextInput
                style={s.input}
                placeholder="Course name"
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                value={r.courseName}
                onChangeText={(v) => updateCourseName(ri, v)}
              />
              {players.map((p) => (
                <View key={p.id} style={s.hcpRow}>
                  <Text style={s.hcpRowName}>{p.name}</Text>
                  <TextInput
                    style={s.hcpInput}
                    keyboardType="numeric"
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    value={r.playerHandicaps?.[p.id] ?? ''}
                    onChangeText={(v) => updatePlayingHandicap(ri, p.id, v)}
                    placeholder="0"
                    placeholderTextColor={theme.text.muted}
                  />
                  <Text style={s.hcpLabel}>p.hcp</Text>
                </View>
              ))}
              <TextInput
                style={[s.input, s.notesInput]}
                placeholder="Round notes..."
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={r.notes ?? ''}
                onChangeText={(v) => updateNotes(ri, v)}
              />
              <TouchableOpacity
                style={s.editHolesBtn}
                onPress={() =>
                  navigation.navigate('CourseEditor', {
                    roundIndex: ri,
                    courseName: r.courseName,
                    initialHoles: r.holes,
                    initialSlope: r.slope,
                    initialCourseRating: r.courseRating ?? null,
                    initialPlayerHandicaps: Object.fromEntries(
                      Object.entries(r.playerHandicaps ?? {}).map(([id, v]) => [id, parseInt(v, 10) || 0]),
                    ),
                    initialManualHandicaps: r.manualHandicaps ?? {},
                    players: players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 })),
                    onSave: handleHolesSaved,
                    courseId: r.courseId ?? null,
                  })
                }
              >
                <Feather name="edit-3" size={14} color={theme.accent.primary} style={{ marginRight: 8 }} />
                <Text style={s.editHolesBtnText}>
                  Edit Holes & Slope
                </Text>
                <View style={s.parBadge}>
                  <Text style={s.parBadgeText}>Par {r.holes.reduce((sum, h) => sum + h.par, 0)}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View>
          <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
            <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.addRoundBtnText}>Add Round</Text>
          </TouchableOpacity>
        </View>

        <View>
          <Text style={s.sectionTitle}>Scoring Mode</Text>
          <View style={s.modeRow}>
            {['stableford', 'bestball'].map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[s.modeBtn, settings.scoringMode === mode && s.modeBtnActive]}
                onPress={() => setSettings((sv) => ({ ...sv, scoringMode: mode }))}
              >
                <Feather
                  name={mode === 'stableford' ? 'user' : 'users'}
                  size={16}
                  color={settings.scoringMode === mode
                    ? (theme.isDark ? theme.accent.primary : theme.text.inverse)
                    : theme.text.muted}
                  style={{ marginRight: 8 }}
                />
                <Text style={[s.modeBtnText, settings.scoringMode === mode && s.modeBtnTextActive]}>
                  {mode === 'stableford' ? 'Individual Stableford' : 'Best Ball / Worst Ball'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {settings.scoringMode === 'bestball' && (
            <View style={s.valueRow}>
              <View style={s.valueBlock}>
                <Text style={s.valueLabel}>Best Ball</Text>
                <TextInput
                  style={s.valueInput}
                  keyboardType="numeric"
                  maxLength={2}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  value={String(settings.bestBallValue)}
                  onChangeText={(v) => setSettings((sv) => ({ ...sv, bestBallValue: v }))}
                />
                <Text style={s.valueSuffix}>pts / hole</Text>
              </View>
              <View style={s.valueBlock}>
                <Text style={s.valueLabel}>Worst Ball</Text>
                <TextInput
                  style={s.valueInput}
                  keyboardType="numeric"
                  maxLength={2}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  value={String(settings.worstBallValue)}
                  onChangeText={(v) => setSettings((sv) => ({ ...sv, worstBallValue: v }))}
                />
                <Text style={s.valueSuffix}>pts / hole</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8, flex: 1,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginBottom: 10 },
  playerCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  playerName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 16 },
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 54, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold', padding: 7,
  },
  hcpLabel: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, marginLeft: 6, fontSize: 13, width: 44 },
  roundHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 24, marginBottom: 8,
  },
  removeBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10 },
  removeBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 13 },
  roundCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14, marginBottom: 8, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  hcpRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
  },
  hcpRowName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  notesInput: { minHeight: 60, textAlignVertical: 'top', marginTop: 8 },
  editHolesBtn: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 12, alignItems: 'center', marginTop: 10,
    flexDirection: 'row', justifyContent: 'center',
  },
  editHolesBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  parBadge: {
    backgroundColor: theme.accent.light, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  parBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  addRoundBtn: {
    borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 4,
    flexDirection: 'row', justifyContent: 'center',
  },
  addRoundBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  modeRow: { gap: 8 },
  modeBtn: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14, alignItems: 'center', marginBottom: 6,
    flexDirection: 'row', justifyContent: 'center',
  },
  modeBtnActive: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  modeBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 14 },
  modeBtnTextActive: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
  },
  valueRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  valueBlock: {
    flex: 1, backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, alignItems: 'center', gap: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  valueLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 12, letterSpacing: 0.5,
  },
  valueInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 56, textAlign: 'center', fontSize: 22,
    fontFamily: 'PlusJakartaSans-ExtraBold', padding: 8,
  },
  valueSuffix: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },
});
