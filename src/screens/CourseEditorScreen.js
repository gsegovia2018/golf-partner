import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { updateCourseFromEditor } from '../store/libraryStore';
import { calcPlayingHandicap } from '../store/tournamentStore';

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
    initialHoles, initialSlope, initialCourseRating,
    initialPlayerHandicaps, initialManualHandicaps,
    courseId,
    players = [],
    onSave,
  } = route.params;

  const [holes, setHoles] = useState(
    initialHoles?.length === 18 ? initialHoles.map((h) => ({ ...h })) : defaultHoles(),
  );
  const [slope, setSlope] = useState(initialSlope ? String(initialSlope) : '');
  const [courseRating, setCourseRating] = useState(
    initialCourseRating != null && initialCourseRating !== '' ? String(initialCourseRating) : '',
  );

  // playerHandicaps: { [playerId]: string } — editable overrides
  const [playerHandicaps, setPlayerHandicaps] = useState(() => {
    const init = {};
    players.forEach((p) => {
      const existing = initialPlayerHandicaps?.[p.id];
      init[p.id] = existing != null ? String(existing) : String(p.handicap);
    });
    return init;
  });
  const [manualHandicaps, setManualHandicaps] = useState(
    () => ({ ...(initialManualHandicaps ?? {}) }),
  );

  const isFirstRender = useRef(true);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  // On mount: if slope is already set (e.g. opened from a saved round), align
  // non-manual players' playing handicaps with the current slope+CR. Without
  // this the input keeps showing stale values stored before slope/CR were
  // applied to the round.
  useEffect(() => {
    const sv = parseInt(slope, 10) || 0;
    if (sv <= 0) return;
    const par = holes.reduce((sum, h) => sum + (h.par || 0), 0);
    const cr = parseFloat(courseRating);
    const crForCalc = Number.isFinite(cr) ? cr : null;
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      let changed = false;
      players.forEach((p) => {
        if (manualHandicaps[p.id]) return;
        const auto = String(calcPlayingHandicap(p.handicap, sv, crForCalc, par));
        if (next[p.id] !== auto) {
          next[p.id] = auto;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    // Run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const parsedHandicaps = {};
    players.forEach((p) => { parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0; });
    const parsedRating = parseFloat(courseRating);
    onSaveRef.current(
      roundIndex,
      holes,
      parseInt(slope, 10) || null,
      Number.isFinite(parsedRating) ? parsedRating : null,
      parsedHandicaps,
      manualHandicaps,
    );
  }, [holes, slope, courseRating, playerHandicaps, manualHandicaps]);

  // Slope/CR keystrokes recompute ONLY the players who have not been manually
  // overridden. Manual overrides survive until the user explicitly resets.
  function recomputeAuto(nextSlope, nextRating) {
    const sv = parseInt(nextSlope, 10);
    if (!sv || sv <= 0) return;
    const par = holes.reduce((sum, h) => sum + (h.par || 0), 0);
    const cr = parseFloat(nextRating);
    const crForCalc = Number.isFinite(cr) ? cr : null;
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        if (manualHandicaps[p.id]) return;
        next[p.id] = String(calcPlayingHandicap(p.handicap, sv, crForCalc, par));
      });
      return next;
    });
  }

  // Explicit "Reset all to auto": clear every manual override and recompute
  // each player from the current slope/CR.
  function resetAllToAuto() {
    const sv = parseInt(slope, 10);
    const par = holes.reduce((sum, h) => sum + (h.par || 0), 0);
    const cr = parseFloat(courseRating);
    const crForCalc = Number.isFinite(cr) ? cr : null;
    setManualHandicaps({});
    if (!sv || sv <= 0) {
      // No slope: auto value is just the raw index.
      setPlayerHandicaps(() => {
        const next = {};
        players.forEach((p) => { next[p.id] = String(p.handicap); });
        return next;
      });
      return;
    }
    setPlayerHandicaps(() => {
      const next = {};
      players.forEach((p) => {
        next[p.id] = String(calcPlayingHandicap(p.handicap, sv, crForCalc, par));
      });
      return next;
    });
  }

  function applySlope(rawSlope) {
    setSlope(rawSlope);
    recomputeAuto(rawSlope, courseRating);
  }

  function applyRating(rawRating) {
    setCourseRating(rawRating);
    recomputeAuto(slope, rawRating);
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

  // Sequentially numbers stroke indexes 1-18 in hole order. The simplest
  // valid SI set; the user can then fine-tune individual holes.
  function autoNumberSI() {
    setHoles((prev) => prev.map((h, i) => ({ ...h, strokeIndex: i + 1 })));
  }

  function setAllPar(par) {
    setHoles((prev) => prev.map((h) => ({ ...h, par })));
  }

  // Validate the stroke-index set: every value must be 1-18 and used exactly
  // once. Returns a human-readable list of problems (empty when valid).
  const siIssues = (() => {
    const issues = [];
    const seen = new Map();
    holes.forEach((h) => {
      const si = h.strokeIndex;
      if (!si || si < 1 || si > 18) {
        issues.push(`Hole ${h.number}: SI must be 1–18`);
      }
      if (si) seen.set(si, (seen.get(si) ?? 0) + 1);
    });
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([si]) => si);
    if (dupes.length > 0) {
      issues.push(`Duplicate SI: ${dupes.sort((a, b) => a - b).join(', ')}`);
    }
    const missing = [];
    for (let i = 1; i <= 18; i += 1) if (!seen.has(i)) missing.push(i);
    if (missing.length > 0 && missing.length < 18) {
      issues.push(`Missing SI: ${missing.join(', ')}`);
    }
    return issues;
  })();

  const totalPar = holes.reduce((sum, h) => sum + h.par, 0);
  const slopeNum = parseInt(slope, 10) || 0;
  const ratingNum = parseFloat(courseRating);
  const ratingForCalc = Number.isFinite(ratingNum) ? ratingNum : null;

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
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

        {/* Slope + Course Rating */}
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
          <View style={[s.slopeRow, { marginTop: 12 }]}>
            <Text style={s.slopeLabel}>Course Rating</Text>
            <TextInput
              style={s.slopeInput}
              keyboardType="decimal-pad"
              maxLength={5}
              placeholder="e.g. 71.5"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={courseRating}
              onChangeText={applyRating}
            />
            <Text style={s.slopeHint}>par {totalPar}</Text>
          </View>
        </View>

        {/* Per-player playing handicaps */}
        {players.length > 0 && (
          <View style={s.hcpSection}>
            <Text style={s.sectionTitle}>Playing Handicaps</Text>
            {slopeNum > 0 && (
              <Text style={s.hcpHint}>
                Auto-calculated from slope & CR -- tap to override
              </Text>
            )}
            {Object.values(manualHandicaps).some(Boolean) && (
              <TouchableOpacity style={s.resetBtn} onPress={resetAllToAuto} activeOpacity={0.7}>
                <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.resetBtnText}>Reset all to auto</Text>
              </TouchableOpacity>
            )}
            {players.map((p) => {
              const auto = slopeNum > 0
                ? calcPlayingHandicap(p.handicap, slopeNum, ratingForCalc, totalPar)
                : null;
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
                    onChangeText={(v) => {
                      setPlayerHandicaps((prev) => ({ ...prev, [p.id]: v }));
                      setManualHandicaps((prev) => ({ ...prev, [p.id]: true }));
                    }}
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* Hole table */}
        <View>
          <Text style={s.sectionTitle}>Holes</Text>

          <View style={s.toolRow}>
            <Text style={s.toolLabel}>Par presets</Text>
            {[3, 4, 5].map((p) => (
              <TouchableOpacity
                key={p}
                style={s.toolBtn}
                onPress={() => setAllPar(p)}
                activeOpacity={0.7}
              >
                <Text style={s.toolBtnText}>All par {p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.toolRow}>
            <Text style={s.toolLabel}>Stroke index</Text>
            <TouchableOpacity style={s.toolBtn} onPress={autoNumberSI} activeOpacity={0.7}>
              <Feather name="hash" size={12} color={theme.accent.primary} style={{ marginRight: 4 }} />
              <Text style={s.toolBtnText}>Auto-number 1–18</Text>
            </TouchableOpacity>
          </View>

          {siIssues.length > 0 && (
            <View style={s.warnBox}>
              <Feather name="alert-triangle" size={14} color={theme.destructive} style={{ marginRight: 8, marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.warnTitle}>Stroke index needs attention</Text>
                {siIssues.map((issue) => (
                  <Text key={issue} style={s.warnText}>{issue}</Text>
                ))}
                <Text style={s.warnText}>Each hole must use a unique SI from 1 to 18.</Text>
              </View>
            </View>
          )}

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
                try { await updateCourseFromEditor(courseId, slope, courseRating, holes); } catch (_) {}
              }
              navigation.goBack();
            }}
          >
            <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.btnText}>Done</Text>
          </TouchableOpacity>
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
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 8,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10,
  },
  resetBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  toolRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  toolLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
    fontSize: 12, marginRight: 4,
  },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 8, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  toolBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: theme.destructive + '12', borderRadius: 12,
    borderWidth: 1, borderColor: theme.destructive + '55',
    padding: 12, marginBottom: 10,
  },
  warnTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive,
    fontSize: 13, marginBottom: 2,
  },
  warnText: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 1,
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
