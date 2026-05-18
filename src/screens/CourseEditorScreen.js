import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { updateCourseFromEditor } from '../store/libraryStore';
import TeesEditor from '../components/TeesEditor';

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
    initialHoles, initialTees,
    courseId,
    onSave,
  } = route.params;

  const [holes, setHoles] = useState(
    initialHoles?.length === 18 ? initialHoles.map((h) => ({ ...h })) : defaultHoles(),
  );
  const [tees, setTees] = useState(
    () => (initialTees ?? []).map((t) => ({ ...t })),
  );

  const isFirstRender = useRef(true);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    onSaveRef.current(roundIndex, { holes, tees });
  }, [holes, tees]);

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

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
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

        <TeesEditor tees={tees} onChange={setTees} theme={theme} />

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
                try { await updateCourseFromEditor(courseId, holes, tees); } catch (_) {}
              }
              navigation.goBack();
            }}
          >
            <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
            <Text style={s.btnText}>Done</Text>
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
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase',
  },
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
