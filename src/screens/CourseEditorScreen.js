import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import { updateCourseFromEditor } from '../store/libraryStore';

const STANDARD_SLOPE = 113;

function calcPlayingHandicap(index, slope) {
  if (!slope || slope <= 0) return index;
  return Math.round(index * (slope / STANDARD_SLOPE));
}

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}

export default function CourseEditorScreen({ navigation, route }) {
  const {
    roundIndex, courseName,
    initialHoles, initialSlope, initialPlayerHandicaps,
    courseId,
    players = [],
    onSave,
  } = route.params;

  const [holes, setHoles] = useState(
    initialHoles?.length === 18 ? initialHoles.map((h) => ({ ...h })) : defaultHoles(),
  );
  const [slope, setSlope] = useState(initialSlope ? String(initialSlope) : '');

  // playerHandicaps: { [playerId]: string } — editable overrides
  const [playerHandicaps, setPlayerHandicaps] = useState(() => {
    const init = {};
    players.forEach((p) => {
      const existing = initialPlayerHandicaps?.[p.id];
      init[p.id] = existing != null ? String(existing) : String(p.handicap);
    });
    return init;
  });

  const isFirstRender = useRef(true);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const parsedHandicaps = {};
    players.forEach((p) => { parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0; });
    onSaveRef.current(roundIndex, holes, parseInt(slope, 10) || null, parsedHandicaps);
  }, [holes, slope, playerHandicaps]);

  function applySlope(rawSlope) {
    setSlope(rawSlope);
    const s = parseInt(rawSlope, 10);
    if (!s || s <= 0) return;
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        next[p.id] = String(calcPlayingHandicap(p.handicap, s));
      });
      return next;
    });
  }

  function setPar(holeIndex, par) {
    setHoles((prev) => {
      const next = [...prev];
      next[holeIndex] = { ...next[holeIndex], par };
      return next;
    });
  }

  function setSI(holeIndex, value) {
    setHoles((prev) => {
      const next = [...prev];
      next[holeIndex] = { ...next[holeIndex], strokeIndex: parseInt(value, 10) || 0 };
      return next;
    });
  }

  const totalPar = holes.reduce((s, h) => s + h.par, 0);
  const slopeNum = parseInt(slope, 10) || 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>{courseName || `Round ${roundIndex + 1}`}</Text>
      <Text style={styles.subtitle}>Total par: {totalPar}</Text>

      {/* Slope */}
      <View style={styles.slopeRow}>
        <Text style={styles.slopeLabel}>Course Slope</Text>
        <TextInput
          style={styles.slopeInput}
          keyboardType="numeric"
          maxLength={3}
          placeholder="e.g. 128"
          placeholderTextColor="#484f58"
          keyboardAppearance="dark"
          selectionColor="#4caf50"
          value={slope}
          onChangeText={applySlope}
        />
        <Text style={styles.slopeHint}>std 113</Text>
      </View>

      {/* Per-player playing handicaps */}
      {players.length > 0 && (
        <View style={styles.hcpSection}>
          <Text style={styles.sectionTitle}>Playing Handicaps</Text>
          {slopeNum > 0 && (
            <Text style={styles.hcpHint}>
              Auto-calculated from slope · tap to override
            </Text>
          )}
          {players.map((p) => {
            const auto = slopeNum > 0 ? calcPlayingHandicap(p.handicap, slopeNum) : null;
            const current = parseInt(playerHandicaps[p.id], 10);
            const isDifferent = auto !== null && current !== auto;
            return (
              <View key={p.id} style={styles.hcpRow}>
                <Text style={styles.hcpName}>{p.name}</Text>
                <Text style={styles.hcpIndex}>Index {p.handicap}</Text>
                {auto !== null && (
                  <Text style={styles.hcpArrow}>→</Text>
                )}
                <TextInput
                  style={[styles.hcpInput, isDifferent && styles.hcpInputOverride]}
                  keyboardType="numeric"
                  maxLength={2}
                  keyboardAppearance="dark"
                  selectionColor="#4caf50"
                  value={playerHandicaps[p.id] ?? ''}
                  onChangeText={(v) =>
                    setPlayerHandicaps((prev) => ({ ...prev, [p.id]: v }))
                  }
                />
              </View>
            );
          })}
        </View>
      )}

      {/* Hole table */}
      <Text style={styles.sectionTitle}>Holes</Text>
      <View style={styles.headerRow}>
        <Text style={[styles.col, styles.holeCol, styles.headerText]}>Hole</Text>
        <Text style={[styles.col, styles.parCol, styles.headerText]}>Par</Text>
        <Text style={[styles.col, styles.siCol, styles.headerText]}>SI</Text>
      </View>

      {holes.map((hole, i) => (
        <View key={hole.number} style={[styles.row, i % 2 === 1 && styles.altRow]}>
          <Text style={[styles.col, styles.holeCol, styles.holeNum]}>{hole.number}</Text>
          <View style={[styles.col, styles.parCol, styles.parPicker]}>
            {[3, 4, 5].map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.parBtn, hole.par === p && styles.parBtnActive]}
                onPress={() => setPar(i, p)}
              >
                <Text style={[styles.parBtnText, hole.par === p && styles.parBtnTextActive]}>
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.col, styles.siCol, styles.siInput]}
            keyboardType="numeric"
            maxLength={2}
            keyboardAppearance="dark"
            selectionColor="#4caf50"
            value={hole.strokeIndex > 0 ? String(hole.strokeIndex) : ''}
            onChangeText={(v) => setSI(i, v)}
          />
        </View>
      ))}

      <TouchableOpacity
        style={styles.btn}
        onPress={async () => {
          if (courseId) {
            try { await updateCourseFromEditor(courseId, slope, holes); } catch (_) {}
          }
          navigation.goBack();
        }}
      >
        <Text style={styles.btnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '900', color: '#4ade80', letterSpacing: -0.5 },
  subtitle: { color: '#7a8fa8', marginBottom: 16, fontWeight: '500' },
  slopeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  slopeLabel: { color: '#c8d6e5', fontSize: 15, flex: 1, fontWeight: '600' },
  slopeInput: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 10, borderWidth: 1, borderColor: '#1c3250',
    width: 76, textAlign: 'center', fontSize: 16, fontWeight: '700', padding: 9,
  },
  slopeHint: { color: '#364f68', fontSize: 12 },
  hcpSection: { backgroundColor: '#031a0a', borderRadius: 14, borderWidth: 1, borderColor: '#1a4a2e', padding: 14, marginBottom: 20 },
  sectionTitle: { color: '#4ade80', fontWeight: '700', fontSize: 11, marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase' },
  hcpHint: { color: '#7a8fa8', fontSize: 12, marginBottom: 10 },
  hcpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  hcpName: { flex: 1, color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  hcpIndex: { color: '#7a8fa8', fontSize: 13, marginRight: 8 },
  hcpArrow: { color: '#364f68', marginRight: 8 },
  hcpInput: {
    backgroundColor: '#112038', color: '#f1f5f9', borderRadius: 8, borderWidth: 1, borderColor: '#1c3250',
    width: 50, textAlign: 'center', fontSize: 16, fontWeight: '600', padding: 6,
  },
  hcpInputOverride: { backgroundColor: '#031a0a', borderColor: '#4ade80' },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c3250', paddingBottom: 8, marginBottom: 4 },
  headerText: { color: '#4ade80', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  altRow: { backgroundColor: '#0c1a28' },
  col: { paddingHorizontal: 4 },
  holeCol: { width: 44 },
  parCol: { width: 110 },
  siCol: { width: 60 },
  holeNum: { color: '#7a8fa8', fontSize: 15, fontWeight: '600' },
  parPicker: { flexDirection: 'row', gap: 6 },
  parBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#112038', borderWidth: 1, borderColor: '#1c3250', alignItems: 'center', justifyContent: 'center',
  },
  parBtnActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  parBtnText: { color: '#364f68', fontWeight: '700', fontSize: 13 },
  parBtnTextActive: { color: '#fff', fontWeight: '800' },
  siInput: {
    backgroundColor: '#112038', color: '#f1f5f9', borderRadius: 8, borderWidth: 1, borderColor: '#1c3250',
    textAlign: 'center', fontSize: 15, fontWeight: '600', padding: 6,
  },
  btn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 24 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
