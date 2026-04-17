import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { fetchCourses, saveCourseHoles, upsertCourse } from '../store/libraryStore';

const STANDARD_SLOPE = 113;

function calcPlayingHandicap(index, slope) {
  if (!slope || slope <= 0) return index;
  return Math.round(index * (slope / STANDARD_SLOPE));
}

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}

export default function CourseLibraryDetailScreen({ navigation, route }) {
  const { courseId, courseName: initialName } = route.params;
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [name, setName] = useState(initialName ?? '');
  const [slope, setSlope] = useState('');
  const [holes, setHoles] = useState(defaultHoles());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: initialName || 'Course' });
    (async () => {
      const courses = await fetchCourses();
      const course = courses.find((c) => c.id === courseId);
      if (course) {
        setName(course.name);
        setSlope(course.slope ? String(course.slope) : '');
        if (course.holes.length === 18) setHoles(course.holes.map((h) => ({ ...h })));
      }
      setLoading(false);
    })();
  }, [courseId]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await upsertCourse({ id: courseId, name: name.trim(), slope: slope || null });
      await saveCourseHoles(courseId, holes);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  function setPar(i, par) {
    setHoles((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], par };
      return next;
    });
  }

  function setSI(i, value) {
    setHoles((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], strokeIndex: parseInt(value, 10) || 0 };
      return next;
    });
  }

  const totalPar = holes.reduce((sum, h) => sum + h.par, 0);

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={theme.accent.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Course Details</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        <TextInput
          style={s.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="Course name"
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
        />

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
            onChangeText={setSlope}
          />
          <Text style={s.slopeHint}>std 113</Text>
        </View>

        <Text style={s.sectionTitle}>Holes  ·  Par {totalPar}</Text>

        <View>
          <View style={s.tableCard}>
            <View style={s.tableHeaderRow}>
              <Text style={[s.col, s.holeCol, s.tableHeaderText]}>Hole</Text>
              <Text style={[s.col, s.parCol, s.tableHeaderText]}>Par</Text>
              <Text style={[s.col, s.siCol, s.tableHeaderText]}>SI</Text>
            </View>

            {holes.map((hole, i) => (
              <View key={hole.number}>
                <View style={[s.tableRow, i % 2 === 1 && s.altRow]}>
                  <Text style={[s.col, s.holeCol, s.holeNum]}>{hole.number}</Text>
                  <View style={[s.col, s.parCol, s.parPicker]}>
                    {[3, 4, 5].map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[s.parBtn, hole.par === p && s.parBtnActive]}
                        onPress={() => setPar(i, p)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.parBtnText, hole.par === p && s.parBtnTextActive]}>{p}</Text>
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
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
          <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save course'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  centered: { flex: 1, backgroundColor: theme.bg.primary, alignItems: 'center', justifyContent: 'center' },
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  nameInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, fontSize: 18,
    fontFamily: 'PlusJakartaSans-Bold', marginBottom: 16,
  },
  slopeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  slopeLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15, flex: 1 },
  slopeInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, width: 76, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold', padding: 9,
  },
  slopeHint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 11,
    marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  tableCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    overflow: 'hidden',
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  tableHeaderRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  tableHeaderText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 12, letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  altRow: { backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.secondary },
  col: { paddingHorizontal: 4 },
  holeCol: { width: 44 },
  parCol: { width: 110 },
  siCol: { width: 60 },
  holeNum: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 15 },
  parPicker: { flexDirection: 'row', gap: 6 },
  parBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderWidth: 1, borderColor: theme.border.default, alignItems: 'center', justifyContent: 'center',
  },
  parBtnActive: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderColor: theme.accent.primary,
  },
  parBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 13 },
  parBtnTextActive: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse, fontSize: 13,
  },
  siInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default, textAlign: 'center', fontSize: 15,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 6,
  },
  saveBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 24,
    flexDirection: 'row', justifyContent: 'center',
    borderWidth: theme.isDark ? 1 : 0, borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse, fontSize: 16,
  },
});
