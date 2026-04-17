import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { fetchCourses, upsertCourse, defaultHoles, saveCourseHoles } from '../store/libraryStore';
import { setPendingCourses } from '../lib/selectionBridge';

export default function CoursePickerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { roundIndex } = route.params;

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchCourses().then(setCourses).finally(() => setLoading(false));
    }, []),
  );

  function toggleCourse(course) {
    setSelectedCourses((prev) => {
      const exists = prev.find((c) => c.id === course.id);
      if (exists) return prev.filter((c) => c.id !== course.id);
      return [...prev, course];
    });
  }

  function confirm() {
    setPendingCourses({ startRoundIndex: roundIndex, courses: selectedCourses });
    navigation.goBack();
  }

  async function addAndSelect() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const holes = defaultHoles();
      const course = await upsertCourse({ name: newName.trim(), slope: null });
      await saveCourseHoles(course.id, holes);
      const full = { ...course, holes };
      setCourses((prev) => [...prev, full]);
      setNewName('');
      setSelectedCourses((prev) => [...prev, full]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Select Courses</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        <Text style={s.sectionTitle}>New Course</Text>
        <View style={s.form}>
          <TextInput
            style={[s.input, s.flex]}
            placeholder="Course name"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={newName}
            onChangeText={setNewName}
          />
          <TouchableOpacity style={s.addBtn} onPress={addAndSelect} disabled={saving || !newName.trim()}>
            <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>Library</Text>
        {loading
          ? <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
          : courses.length === 0
            ? <Text style={s.empty}>No courses in library yet.</Text>
            : courses.map((c, index) => {
              const selIdx = selectedCourses.findIndex((sc) => sc.id === c.id);
              const isPicked = selIdx !== -1;
              return (
                <View
                  key={c.id}
                 
                >
                  <TouchableOpacity
                    style={[s.row, isPicked && s.rowPicked]}
                    onPress={() => toggleCourse({ id: c.id, name: c.name, slope: c.slope, holes: c.holes.length === 18 ? c.holes : defaultHoles() })}
                    activeOpacity={0.7}
                  >
                    <View style={s.rowLeft}>
                      <Text style={s.courseName}>{c.name}</Text>
                      <Text style={s.courseMeta}>
                        Par {c.holes.reduce((sum, h) => sum + h.par, 0)}
                        {c.slope ? `  ·  Slope ${c.slope}` : ''}
                      </Text>
                    </View>
                    {isPicked
                      ? (
                        <View style={s.orderBadge}>
                          <Text style={s.orderBadgeText}>{selIdx + 1}</Text>
                        </View>
                      )
                      : <View style={s.emptyCircle} />}
                  </TouchableOpacity>
                </View>
              );
            })}
      </ScrollView>

      {selectedCourses.length > 0 && (
        <View style={s.footer}>
          <TouchableOpacity style={s.confirmBtn} onPress={confirm}>
            <Text style={s.confirmBtnText}>
              Add {selectedCourses.length} Round{selectedCourses.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg.primary, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    color: theme.text.primary,
  },
  content: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  sectionTitle: {
    color: theme.text.muted,
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    marginBottom: 12,
    marginTop: 8,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border.default,
    padding: 13,
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  addBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  addBtnText: {
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  empty: {
    color: theme.text.muted,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  rowPicked: {
    borderColor: theme.accent.primary,
    backgroundColor: theme.isDark ? theme.accent.primary + '10' : theme.accent.light,
  },
  rowLeft: { flex: 1 },
  courseName: {
    color: theme.text.primary,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  courseMeta: {
    color: theme.text.secondary,
    fontSize: 12,
    marginTop: 3,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  orderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: {
    color: theme.text.inverse,
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-ExtraBold',
  },
  emptyCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.border.default,
    backgroundColor: theme.bg.secondary,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border.subtle,
    backgroundColor: theme.bg.primary,
  },
  confirmBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  confirmBtnText: {
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 16,
  },
});
