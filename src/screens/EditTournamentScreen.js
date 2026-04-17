import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { loadTournament, saveTournament, DEFAULT_SETTINGS, randomPairs } from '../store/tournamentStore';

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

  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);

  useEffect(() => {
    (async () => {
      const t = await loadTournament();
      setTournament(t);
      setPlayers(t.players.map((p) => ({ ...p, handicap: String(p.handicap) })));
      setSettings({ ...DEFAULT_SETTINGS, ...t.settings, bestBallValue: String((t.settings ?? DEFAULT_SETTINGS).bestBallValue ?? 1), worstBallValue: String((t.settings ?? DEFAULT_SETTINGS).worstBallValue ?? 1) });
      setRounds(t.rounds.map((r) => ({
        ...r,
        holes: [...r.holes],
        notes: r.notes ?? '',
        playerHandicaps: Object.fromEntries(
          t.players.map((p) => [p.id, String(r.playerHandicaps?.[p.id] ?? p.handicap)]),
        ),
      })));
    })();
  }, []);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!tournamentRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const builtPlayers = players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }));
      const builtRounds = rounds.map((r) => ({
        ...r,
        playerHandicaps: Object.fromEntries(
          Object.entries(r.playerHandicaps).map(([id, v]) => [id, parseInt(v, 10) || 0]),
        ),
      }));
      await saveTournament({
        ...tournamentRef.current,
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

  const handleHolesSaved = useCallback((roundIndex, holes, slope, playerHandicaps) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes,
        slope,
        // CourseEditor returns numbers; convert to strings for our inputs
        playerHandicaps: Object.fromEntries(
          Object.entries(playerHandicaps).map(([id, v]) => [id, String(v)]),
        ),
      };
      return next;
    });
  }, []);

  function updateBaseHandicap(index, value) {
    setPlayers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], handicap: value };
      return next;
    });
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
      const newRound = {
        id: `r${Date.now()}`,
        courseName: '',
        holes: defaultHoles(),
        slope: null,
        playerHandicaps: Object.fromEntries(builtPlayers.map((p) => [p.id, String(p.handicap)])),
        pairs: randomPairs(builtPlayers),
        scores: {},
      };
      return [...prev, newRound];
    });
  }

  function removeRound(index) {
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
      };
      return next;
    });
  }

  if (!tournament) return null;

  return (
    <View style={s.screen}>
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
        <Animated.View entering={FadeInDown.delay(50).duration(300).springify()}>
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
        </Animated.View>

        {/* Per-round playing handicaps */}
        {rounds.map((r, ri) => (
          <Animated.View key={r.id} entering={FadeInDown.delay(100 + ri * 50).duration(300).springify()}>
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
                    initialPlayerHandicaps: Object.fromEntries(
                      Object.entries(r.playerHandicaps ?? {}).map(([id, v]) => [id, parseInt(v, 10) || 0]),
                    ),
                    players: tournament.players,
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
          </Animated.View>
        ))}

        <Animated.View entering={FadeInDown.delay(200).duration(300).springify()}>
          <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
            <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.addRoundBtnText}>Add Round</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250).duration(300).springify()}>
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
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary },
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
