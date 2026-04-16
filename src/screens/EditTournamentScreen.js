import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import { loadTournament, saveTournament, DEFAULT_SETTINGS, randomPairs } from '../store/tournamentStore';

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

export default function EditTournamentScreen({ navigation }) {
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>Edit Tournament</Text>

      {/* Base handicap indexes */}
      <Text style={styles.sectionTitle}>Handicap Index</Text>
      <Text style={styles.hint}>Base index used when no slope is set for a course.</Text>
      {players.map((p, i) => (
        <View key={p.id} style={styles.row}>
          <Text style={styles.playerName}>{p.name}</Text>
          <TextInput
            style={styles.hcpInput}
            keyboardType="numeric"
            keyboardAppearance="dark"
            selectionColor="#4caf50"
            value={p.handicap}
            onChangeText={(v) => updateBaseHandicap(i, v)}
            placeholder="0"
            placeholderTextColor="#484f58"
          />
          <Text style={styles.hcpLabel}>index</Text>
        </View>
      ))}

      {/* Per-round playing handicaps */}
      {rounds.map((r, ri) => (
        <View key={r.id}>
          <View style={styles.roundHeader}>
            <Text style={styles.sectionTitle}>Round {ri + 1}{r.slope ? `  ·  Slope ${r.slope}` : ''}</Text>
            {rounds.length > 1 && (
              <TouchableOpacity onPress={() => removeRound(ri)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Course name"
            placeholderTextColor="#484f58"
            keyboardAppearance="dark"
            selectionColor="#4caf50"
            value={r.courseName}
            onChangeText={(v) => updateCourseName(ri, v)}
          />
          {players.map((p) => (
            <View key={p.id} style={styles.row}>
              <Text style={styles.playerName}>{p.name}</Text>
              <TextInput
                style={styles.hcpInput}
                keyboardType="numeric"
                keyboardAppearance="dark"
                selectionColor="#4caf50"
                value={r.playerHandicaps?.[p.id] ?? ''}
                onChangeText={(v) => updatePlayingHandicap(ri, p.id, v)}
                placeholder="0"
                placeholderTextColor="#484f58"
              />
              <Text style={styles.hcpLabel}>playing</Text>
            </View>
          ))}
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Round notes…"
            placeholderTextColor="#484f58"
            keyboardAppearance="dark"
            selectionColor="#4caf50"
            multiline
            value={r.notes ?? ''}
            onChangeText={(v) => updateNotes(ri, v)}
          />
          <TouchableOpacity
            style={styles.editHolesBtn}
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
            <Text style={styles.editHolesBtnText}>
              Edit Holes & Slope  ·  Par {r.holes.reduce((s, h) => s + h.par, 0)}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.addRoundBtn} onPress={addRound}>
        <Text style={styles.addRoundBtnText}>+ Add Round</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Scoring Mode</Text>
      <View style={styles.modeRow}>
        {['stableford', 'bestball'].map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeBtn, settings.scoringMode === mode && styles.modeBtnActive]}
            onPress={() => setSettings((s) => ({ ...s, scoringMode: mode }))}
          >
            <Text style={[styles.modeBtnText, settings.scoringMode === mode && styles.modeBtnTextActive]}>
              {mode === 'stableford' ? 'Individual Stableford' : 'Best Ball / Worst Ball'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {settings.scoringMode === 'bestball' && (
        <View style={styles.valueRow}>
          <View style={styles.valueBlock}>
            <Text style={styles.valueLabel}>Best Ball</Text>
            <TextInput
              style={styles.valueInput}
              keyboardType="numeric"
              maxLength={2}
              keyboardAppearance="dark"
              selectionColor="#4caf50"
              value={String(settings.bestBallValue)}
              onChangeText={(v) => setSettings((s) => ({ ...s, bestBallValue: v }))}
            />
            <Text style={styles.valueSuffix}>pts / hole</Text>
          </View>
          <View style={styles.valueBlock}>
            <Text style={styles.valueLabel}>Worst Ball</Text>
            <TextInput
              style={styles.valueInput}
              keyboardType="numeric"
              maxLength={2}
              keyboardAppearance="dark"
              selectionColor="#4caf50"
              value={String(settings.worstBallValue)}
              onChangeText={(v) => setSettings((s) => ({ ...s, worstBallValue: v }))}
            />
            <Text style={styles.valueSuffix}>pts / hole</Text>
          </View>
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '900', color: '#4ade80', marginBottom: 20, letterSpacing: -0.5 },
  sectionTitle: { color: '#4ade80', fontWeight: '700', fontSize: 11, marginTop: 24, marginBottom: 8, flex: 1, letterSpacing: 1.8, textTransform: 'uppercase' },
  hint: { color: '#364f68', fontSize: 12, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c1a28', borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 14, marginBottom: 8 },
  playerName: { flex: 1, color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  hcpInput: {
    backgroundColor: '#070d15', color: '#f1f5f9', borderRadius: 8, borderWidth: 1, borderColor: '#1c3250',
    width: 54, textAlign: 'center', fontSize: 16, fontWeight: '700', padding: 7,
  },
  hcpLabel: { color: '#7a8fa8', marginLeft: 6, fontSize: 13, width: 44 },
  input: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 12, borderWidth: 1, borderColor: '#1c3250',
    padding: 14, marginBottom: 8, fontSize: 15, fontWeight: '500',
  },
  roundHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  removeBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  removeBtnText: { color: '#f87171', fontSize: 13, fontWeight: '700' },
  addRoundBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: '#1c3250', borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 4,
  },
  addRoundBtnText: { color: '#4ade80', fontSize: 14, fontWeight: '700' },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  editHolesBtn: {
    backgroundColor: '#031a0a', borderRadius: 12, borderWidth: 1,
    borderColor: '#1a4a2e', padding: 12, alignItems: 'center', marginBottom: 4,
  },
  editHolesBtnText: { color: '#4ade80', fontSize: 14, fontWeight: '700' },
  modeRow: { gap: 8 },
  modeBtn: { backgroundColor: '#0c1a28', borderRadius: 12, borderWidth: 1, borderColor: '#1c3250', padding: 14, alignItems: 'center', marginBottom: 6 },
  modeBtnActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  modeBtnText: { color: '#364f68', fontWeight: '600', fontSize: 14 },
  modeBtnTextActive: { color: '#fff', fontWeight: '700' },
  valueRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  valueBlock: { flex: 1, backgroundColor: '#0c1a28', borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 14, alignItems: 'center', gap: 8 },
  valueLabel: { color: '#4ade80', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  valueInput: { backgroundColor: '#070d15', color: '#f1f5f9', borderRadius: 8, borderWidth: 1, borderColor: '#1c3250', width: 56, textAlign: 'center', fontSize: 22, fontWeight: '800', padding: 8 },
  valueSuffix: { color: '#364f68', fontSize: 11 },
  btn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 24 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
