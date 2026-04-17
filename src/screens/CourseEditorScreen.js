import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
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
  const { theme } = useTheme();
  const s = makeStyles(theme);

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
    const sv = parseInt(rawSlope, 10);
    if (!sv || sv <= 0) return;
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        next[p.id] = String(calcPlayingHandicap(p.handicap, sv));
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

  const totalPar = holes.reduce((sum, h) => sum + h.par, 0);
  const slopeNum = parseInt(slope, 10) || 0;

  return (
    <View style={s.screen}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Course Editor</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.container} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        <View>
          <Text style={s.title}>{courseName || `Round ${roundIndex + 1}`}</Text>
          <Text style={s.subtitle}>Total par: {totalPar}</Text>
        </View>

        {/* Slope */}
        <View style={s.slopeCard}>
          <View style={s.slopeRow}>
            <Text style={s.slopeLabel}>Course Slope</Text>
            <TextInput
              style={s.slopeInput}
              keyboardType="numeric"
              maxLength={3}
              placeholder="e.g. 128"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={slope}
              onChangeText={applySlope}
            />
            <Text style={s.slopeHint}>std 113</Text>
          </View>
        </View>

        {/* Per-player playing handicaps */}
        {players.length > 0 && (
          <View style={s.hcpSection}>
            <Text style={s.sectionTitle}>Playing Handicaps</Text>
            {slopeNum > 0 && (
              <Text style={s.hcpHint}>
                Auto-calculated from slope -- tap to override
              </Text>
            )}
            {players.map((p) => {
              const auto = slopeNum > 0 ? calcPlayingHandicap(p.handicap, slopeNum) : null;
              const current = parseInt(playerHandicaps[p.id], 10);
              const isDifferent = auto !== null && current !== auto;
              return (
                <View key={p.id} style={s.hcpRow}>
                  <Text style={s.hcpName}>{p.name}</Text>
                  <Text style={s.hcpIndex}>Index {p.handicap}</Text>
                  {auto !== null && (
                    <Feather name="arrow-right" size={14} color={theme.text.muted} style={{ marginRight: 8 }} />
                  )}
                  <TextInput
                    style={[s.hcpInput, isDifferent && s.hcpInputOverride]}
                    keyboardType="numeric"
                    maxLength={2}
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
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
        <View>
          <Text style={s.sectionTitle}>Holes</Text>
          <View style={s.tableCard}>
            <View style={s.headerRow}>
              <Text style={[s.col, s.holeCol, s.headerText]}>Hole</Text>
              <Text style={[s.col, s.parCol, s.headerText]}>Par</Text>
              <Text style={[s.col, s.siCol, s.headerText]}>SI</Text>
            </View>

            {holes.map((hole, i) => (
              <View key={hole.number} style={[s.row, i % 2 === 1 && s.altRow]}>
                <Text style={[s.col, s.holeCol, s.holeNum]}>{hole.number}</Text>
                <View style={[s.col, s.parCol, s.parPicker]}>
                  {[3, 4, 5].map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[s.parBtn, hole.par === p && s.parBtnActive]}
                      onPress={() => setPar(i, p)}
                    >
                      <Text style={[s.parBtnText, hole.par === p && s.parBtnTextActive]}>
                        {p}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[s.col, s.siCol, s.siInput]}
                  keyboardType="numeric"
                  maxLength={2}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  value={hole.strokeIndex > 0 ? String(hole.strokeIndex) : ''}
                  onChangeText={(v) => setSI(i, v)}
                />
              </View>
            ))}
          </View>
        </View>

        <View>
          <TouchableOpacity
            style={s.btn}
            onPress={async () => {
              if (courseId) {
                try { await updateCourseFromEditor(courseId, slope, holes); } catch (_) {}
              }
              navigation.goBack();
            }}
          >
            <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.btnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary, overflow: 'hidden' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  title: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 24,
    color: theme.accent.primary, letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
    marginBottom: 16, fontSize: 14,
  },
  slopeCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  slopeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slopeLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary,
    fontSize: 15, flex: 1,
  },
  slopeInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 76, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold', padding: 9,
  },
  slopeHint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  hcpSection: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  hcpHint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 12, marginBottom: 10 },
  hcpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  hcpName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  hcpIndex: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 13, marginRight: 8 },
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    width: 50, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 6,
  },
  hcpInputOverride: {
    backgroundColor: theme.accent.light,
    borderColor: theme.accent.primary,
  },
  tableCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 12, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  headerRow: {
    flexDirection: 'row', borderBottomWidth: 1,
    borderBottomColor: theme.border.subtle, paddingBottom: 8, marginBottom: 4,
  },
  headerText: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 12, letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  altRow: { backgroundColor: theme.bg.secondary, borderRadius: 8 },
  col: { paddingHorizontal: 4 },
  holeCol: { width: 44 },
  parCol: { width: 110 },
  siCol: { width: 60 },
  holeNum: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 15 },
  parPicker: { flexDirection: 'row', gap: 6 },
  parBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: theme.bg.secondary, borderWidth: 1,
    borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  parBtnActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  parBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 13 },
  parBtnTextActive: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 13 },
  siInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    textAlign: 'center', fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 6,
  },
  btn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 24,
    flexDirection: 'row', justifyContent: 'center',
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  btnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 16,
  },
});
