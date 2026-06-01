import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadTournament, saveTournament, subscribeTournamentChanges, DEFAULT_SETTINGS, randomPairs,
  normalizeRoundHandicaps, isRoundComplete,
  getActiveTournamentSnapshot,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { normalizeRoundNotes, roundNoteText } from '../store/roundNotes';
import { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';
import { scoringModeUsesTeams } from '../components/scoringModes';
import { parseHandicapIndex } from '../lib/handicap';
import { shouldHandleStoreChange } from '../lib/navigationFocus';
import {
  canRemoveRoundFromEditor,
  roundRemovalConfirmation,
} from './editTournamentRoundDeletion';

async function confirmDialog(title, message, confirmLabel = 'Remove') {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
     { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }],
  ));
}

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

function editablePlayersFromTournament(t) {
  return (t?.players ?? []).map((p) => ({ ...p, handicap: String(p.handicap) }));
}

function editableSettingsFromTournament(t) {
  const settings = t?.settings ?? DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    bestBallValue: String((settings ?? DEFAULT_SETTINGS).bestBallValue ?? 1),
    worstBallValue: String((settings ?? DEFAULT_SETTINGS).worstBallValue ?? 1),
  };
}

function editableRoundsFromTournament(t) {
  return (t?.rounds ?? []).map((r) => {
    const normalized = normalizeRoundHandicaps(r, t.players ?? []);
    return {
      ...normalized,
      holes: [...(normalized.holes ?? [])],
      notes: normalizeRoundNotes(normalized.notes),
      playerHandicaps: Object.fromEntries(
        (t.players ?? []).map((p) => [p.id, String(normalized.playerHandicaps[p.id] ?? p.handicap)]),
      ),
      manualHandicaps: { ...(normalized.manualHandicaps ?? {}) },
    };
  });
}

export default function EditTournamentScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const initialTournament = useMemo(() => getActiveTournamentSnapshot(), []);

  const [tournament, setTournament] = useState(() => initialTournament);
  const [players, setPlayers] = useState(() => editablePlayersFromTournament(initialTournament));
  const [rounds, setRounds] = useState(() => editableRoundsFromTournament(initialTournament));
  const [settings, setSettings] = useState(() => editableSettingsFromTournament(initialTournament));
  // 'idle' | 'saving' | 'saved' | 'error' — drives the small status pill.
  const [saveState, setSaveState] = useState('idle');
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
      setPlayers(editablePlayersFromTournament(t));
      setSettings(editableSettingsFromTournament(t));
      setRounds(editableRoundsFromTournament(t));
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
    const unsub = subscribeTournamentChanges(() => {
      if (shouldHandleStoreChange(navigation)) mergeLoad();
    });
    return () => { cancelled = true; unsub(); };
  }, [navigation]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (!tournamentRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveState('saving');
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const builtRounds = rounds.map((r) => ({
          ...r,
          playerHandicaps: Object.fromEntries(
            Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
          ),
          manualHandicaps: { ...(r.manualHandicaps ?? {}) },
        }));

        await saveTournament({
          ...tournamentRef.current,
          rounds: builtRounds,
          settings: {
            ...settings,
            bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
            worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
          },
        });
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        const msg = err?.message ?? 'Could not save changes';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Save failed', msg);
      }
    }, 400);
  }, [rounds, settings]);

  // Keep the scoring mode valid for the current player count. An existing
  // tournament loaded with e.g. bestball but only 3 players gets nudged back
  // to a safe mode rather than silently saving an unplayable configuration.
  useEffect(() => {
    if (players.length === 0) return;
    if (!isScoringModeAllowed(settings.scoringMode, players.length)) {
      setSettings((prev) => ({ ...prev, scoringMode: fallbackScoringMode(players.length) }));
    }
  }, [players.length, settings.scoringMode]);

  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes: patch.holes, tees: patch.tees };
      return next;
    });
  }, []);

  function updateCourseName(roundIndex, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], courseName: value };
      return next;
    });
  }

  function addRound() {
    setRounds((prev) => {
      const builtPlayers = players.map((p) => {
        const r = parseHandicapIndex(p.handicap);
        return { ...p, handicap: r.ok ? r.value : 0 };
      });
      // Team modes get random pairs; solo modes get one singleton pair per
      // player. scoringModeUsesTeams keeps this in lockstep with the mode list.
      const mode = settings?.scoringMode;
      const pairs = scoringModeUsesTeams(mode, builtPlayers.length)
        ? randomPairs(builtPlayers)
        : builtPlayers.map((p) => [p]);
      const newRound = {
        id: `r${Date.now()}`,
        courseName: '',
        holes: defaultHoles(),
        tees: [],
        playerTees: {},
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
    const confirmation = roundRemovalConfirmation({
      round: target,
      roundIndex: index,
      players,
      tournament: { ...tournamentRef.current, rounds },
    });
    const ok = await confirmDialog(
      confirmation.title,
      confirmation.message,
      confirmation.confirmLabel,
    );
    if (!ok) return;
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
      next[roundIndex] = {
        ...next[roundIndex],
        notes: { ...normalizeRoundNotes(next[roundIndex].notes), round: value },
      };
      return next;
    });
  }

  if (!tournament) return null;

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Edit Tournament</Text>
        {saveState === 'idle' ? (
          <View style={{ width: 64 }} />
        ) : (
          <View style={[
            s.savePill,
            saveState === 'error' && s.savePillError,
            saveState === 'saved' && s.savePillSaved,
          ]}>
            <Feather
              name={saveState === 'error' ? 'alert-circle' : saveState === 'saved' ? 'check' : 'loader'}
              size={11}
              color={saveState === 'error' ? theme.destructive : theme.text.muted}
              style={{ marginRight: 4 }}
            />
            <Text style={[s.savePillText, saveState === 'error' && s.savePillTextError]}>
              {saveState === 'error' ? 'Save failed' : saveState === 'saved' ? 'Saved' : 'Saving…'}
            </Text>
          </View>
        )}
      </View>

      <ScrollView style={s.container} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        {/* Per-round playing handicaps */}
        {rounds.map((r, ri) => {
          // Finished rounds are score-edit locked, but can still be removed
          // from history when another round remains in the tournament.
          const finished = isRoundComplete(r, players) || !!tournament?.finishedAt;
          const canRemove = canRemoveRoundFromEditor({ ...tournament, rounds }, ri);
          return (
          <View key={r.id}>
            <View style={s.roundHeader}>
              <Text style={s.sectionTitle}>Round {ri + 1}{r.tees?.length ? `  --  ${r.tees.length} tees` : ''}</Text>
              {canRemove && (
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
              {r.courseId ? (
                <Text style={s.courseNameHint}>
                  Renames this round only — the course saved in your library is unchanged.
                </Text>
              ) : null}
              <TextInput
                style={[s.input, s.notesInput]}
                placeholder="Round notes..."
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={roundNoteText(r.notes)}
                onChangeText={(v) => updateNotes(ri, v)}
              />
              {!finished && (
                <TouchableOpacity
                  style={s.editHolesBtn}
                  onPress={() =>
                    navigation.navigate('CourseEditor', {
                      roundIndex: ri,
                      courseName: r.courseName,
                      initialHoles: r.holes,
                      initialTees: r.tees ?? [],
                      onSave: handleHolesSaved,
                      courseId: r.courseId ?? null,
                    })
                  }
                >
                  <Feather name="edit-3" size={14} color={theme.accent.primary} style={{ marginRight: 8 }} />
                  <Text style={s.editHolesBtnText}>
                    Edit Holes & Tees
                  </Text>
                  <View style={s.parBadge}>
                    <Text style={s.parBadgeText}>Par {r.holes.reduce((sum, h) => sum + h.par, 0)}</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
          );
        })}

        <View>
          <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
            <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.addRoundBtnText}>Add Round</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
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
  savePill: {
    flexDirection: 'row', alignItems: 'center',
    minWidth: 64, justifyContent: 'center',
    backgroundColor: theme.bg.secondary,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  savePillSaved: { borderColor: theme.accent.primary + '55' },
  savePillError: { borderColor: theme.destructive, backgroundColor: theme.destructive + '15' },
  savePillText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.muted },
  savePillTextError: { color: theme.destructive },
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8, flex: 1,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  courseNameHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: -2, marginBottom: 10,
  },
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
