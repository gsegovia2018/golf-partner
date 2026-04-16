import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { createTournament, saveTournament, randomPairs, DEFAULT_SETTINGS } from '../store/tournamentStore';
import { defaultHoles } from '../store/libraryStore';
import { consumePendingPlayers, consumePendingCourses } from '../lib/selectionBridge';

export default function SetupScreen({ navigation }) {
  const [tournamentName, setTournamentName] = useState('Weekend Golf');
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([{ courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });

  useFocusEffect(useCallback(() => {
    const picked = consumePendingPlayers();
    if (picked && picked.length > 0) {
      setPlayers((prev) => {
        const next = [...prev];
        for (const p of picked) {
          if (next.length >= 4 || next.find((x) => x.id === p.id)) continue;
          next.push({ id: p.id, name: p.name, handicap: p.handicap });
        }
        return next;
      });
    }
    const pc = consumePendingCourses();
    if (pc && pc.courses.length > 0) {
      const { startRoundIndex, courses } = pc;
      setRounds((prev) => {
        const next = [...prev];
        courses.forEach((course, i) => {
          const idx = startRoundIndex + i;
          const roundData = {
            courseId: course.id,
            courseName: course.name,
            holes: course.holes,
            slope: course.slope,
            playerHandicaps: null,
          };
          if (idx < next.length) {
            next[idx] = { ...next[idx], ...roundData };
          } else {
            next.push({ ...roundData });
          }
        });
        return next;
      });
    }
  }, []));

  const handleHolesSaved = useCallback((roundIndex, holes, slope, playerHandicaps) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes, slope, playerHandicaps };
      return next;
    });
  }, []);

  function removePlayer(id) {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }

  function updateCourseName(index, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], courseName: value };
      return next;
    });
  }

  function addRound() {
    setRounds((prev) => [...prev, { courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  }

  function removeRound(index) {
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleStart() {
    if (players.length !== 4) {
      Alert.alert('Missing info', 'Select exactly 4 players.');
      return;
    }
    if (rounds.some((r) => !r.courseName.trim())) {
      Alert.alert('Missing info', 'All course names are required.');
      return;
    }

    const builtRounds = rounds.map((r, i) => {
      const playerHandicaps = r.playerHandicaps
        ?? Object.fromEntries(players.map((p) => [p.id, p.handicap]));
      return {
        id: `r${i}`,
        courseName: r.courseName.trim(),
        holes: r.holes,
        slope: r.slope ?? null,
        playerHandicaps,
        notes: '',
        pairs: randomPairs(players),
        scores: {},
      };
    });

    const tournament = createTournament({
      name: tournamentName.trim() || 'Weekend Golf',
      players,
      rounds: builtRounds,
      settings: {
        ...settings,
        bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
        worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
      },
    });

    await saveTournament(tournament);
    navigation.replace('Home');
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>New Tournament</Text>

      <Text style={styles.label}>Tournament Name</Text>
      <TextInput
        style={styles.input}
        value={tournamentName}
        onChangeText={setTournamentName}
        placeholderTextColor="#484f58"
        keyboardAppearance="dark"
        selectionColor="#4caf50"
      />

      <Text style={styles.sectionTitle}>Players ({players.length}/4)</Text>
      {players.map((p) => (
        <View key={p.id} style={styles.playerRow}>
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>{p.name}</Text>
            <Text style={styles.playerHcp}>HCP {p.handicap}</Text>
          </View>
          <TouchableOpacity onPress={() => removePlayer(p.id)} style={styles.removeBtn}>
            <Text style={styles.removeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      {players.length < 4 && (
        <TouchableOpacity
          style={styles.pickBtn}
          onPress={() => navigation.navigate('PlayerPicker', {
            alreadySelectedIds: players.map((p) => p.id),
          })}
        >
          <Text style={styles.pickBtnText}>+ Add Player from Library</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>Rounds</Text>
      {rounds.map((r, i) => {
        const totalPar = r.holes.reduce((s, h) => s + h.par, 0);
        return (
          <View key={i} style={styles.courseBlock}>
            <View style={styles.roundHeader}>
              <Text style={styles.roundLabel}>Round {i + 1}</Text>
              {rounds.length > 1 && (
                <TouchableOpacity onPress={() => removeRound(i)} style={styles.removeRoundBtn}>
                  <Text style={styles.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={styles.pickBtn}
              onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
            >
              <Text style={styles.pickBtnText}>
                {r.courseName ? `Course: ${r.courseName}` : '+ Pick Course from Library'}
              </Text>
            </TouchableOpacity>
            {r.courseName ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Override course name"
                  placeholderTextColor="#484f58"
                  keyboardAppearance="dark"
                  selectionColor="#4caf50"
                  value={r.courseName}
                  onChangeText={(v) => updateCourseName(i, v)}
                />
                <TouchableOpacity
                  style={styles.editHolesBtn}
                  onPress={() =>
                    navigation.navigate('CourseEditor', {
                      roundIndex: i,
                      courseName: r.courseName || `Round ${i + 1}`,
                      initialHoles: r.holes,
                      onSave: handleHolesSaved,
                      players: players,
                      initialSlope: r.slope,
                      initialPlayerHandicaps: r.playerHandicaps,
                      courseId: r.courseId ?? null,
                    })
                  }
                >
                  <Text style={styles.editHolesBtnText}>
                    Configure Holes  ·  Par {totalPar}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        );
      })}

      <TouchableOpacity style={styles.addRoundBtn} onPress={addRound}>
        <Text style={styles.addRoundBtnText}>+ Add Round</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Scoring</Text>
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
              keyboardAppearance="dark"
              selectionColor="#4caf50"
              maxLength={2}
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
              keyboardAppearance="dark"
              selectionColor="#4caf50"
              maxLength={2}
              value={String(settings.worstBallValue)}
              onChangeText={(v) => setSettings((s) => ({ ...s, worstBallValue: v }))}
            />
            <Text style={styles.valueSuffix}>pts / hole</Text>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.btn} onPress={handleStart}>
        <Text style={styles.btnText}>Start Tournament</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  title: { fontSize: 32, fontWeight: '900', color: '#4ade80', marginBottom: 24, letterSpacing: -0.5 },
  label: { color: '#7a8fa8', marginBottom: 8, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  sectionTitle: { color: '#4ade80', fontWeight: '700', fontSize: 11, marginTop: 24, marginBottom: 12, letterSpacing: 1.8, textTransform: 'uppercase' },
  input: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 12, borderWidth: 1, borderColor: '#1c3250',
    padding: 14, marginBottom: 10, fontSize: 15, fontWeight: '500',
  },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c1a28',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  playerInfo: { flex: 1 },
  playerName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  playerHcp: { color: '#7a8fa8', fontSize: 12, marginTop: 3, fontWeight: '500' },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  removeRoundBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  removeBtnText: { color: '#f87171', fontSize: 13, fontWeight: '700' },
  pickBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: '#1a4a2e', borderStyle: 'dashed',
    backgroundColor: '#031a0a', padding: 14, alignItems: 'center', marginBottom: 8,
  },
  pickBtnText: { color: '#4ade80', fontSize: 14, fontWeight: '700' },
  courseBlock: { marginBottom: 12 },
  roundHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  roundLabel: { color: '#7a8fa8', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  addRoundBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: '#1c3250', borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 4,
  },
  addRoundBtnText: { color: '#4ade80', fontSize: 14, fontWeight: '700' },
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
  valueBlock: { flex: 1, backgroundColor: '#0c1a28', borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 16, alignItems: 'center', gap: 8 },
  valueLabel: { color: '#4ade80', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  valueInput: { backgroundColor: '#070d15', color: '#f1f5f9', borderRadius: 8, borderWidth: 1, borderColor: '#1c3250', width: 56, textAlign: 'center', fontSize: 22, fontWeight: '800', padding: 8 },
  valueSuffix: { color: '#364f68', fontSize: 11 },
  btn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 24 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
