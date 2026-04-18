import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { deleteCourse, fetchCourses, upsertCourse } from '../store/libraryStore';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function CoursesLibraryScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const filteredCourses = useMemo(() => {
    const q = normalize(query);
    if (!q) return courses;
    return courses.filter((c) =>
      normalize(c.name).includes(q) ||
      normalize(c.city).includes(q) ||
      normalize(c.province).includes(q),
    );
  }, [courses, query]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    try {
      setCourses(await fetchCourses());
    } finally {
      setLoading(false);
    }
  }

  async function addCourse() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const course = await upsertCourse({ name: name.trim(), slope: null });
      setName('');
      navigation.navigate('CourseLibraryDetail', { courseId: course.id, courseName: course.name });
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Remove "${c.name}" from the library?`)
      : await new Promise((resolve) => Alert.alert(
          'Remove Course', `Remove "${c.name}" from the library?`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Remove', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await deleteCourse(c.id);
      await load();
    } catch (err) {
      if (Platform.OS === 'web') window.alert(err.message ?? 'Could not delete course');
      else Alert.alert('Error', err.message ?? 'Could not delete course');
    }
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Courses</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        <Text style={s.sectionTitle}>
          {`All courses · ${filteredCourses.length}${query && filteredCourses.length !== courses.length ? ` of ${courses.length}` : ''}`}
        </Text>

        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search name, city or region"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} style={s.searchClear} activeOpacity={0.7}>
              <Feather name="x" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={s.sectionTitle}>Add course</Text>
        <View style={s.form}>
          <TextInput
            style={[s.input, s.flex]}
            placeholder="New course name"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={name}
            onChangeText={setName}
          />
          <TouchableOpacity style={s.addBtn} onPress={addCourse} disabled={saving || !name.trim()} activeOpacity={0.7}>
            <Feather name="plus" size={20} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>List</Text>

        {loading
          ? <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
          : courses.length === 0
            ? (
              <View style={s.emptyState}>
                <Feather name="map" size={48} color={theme.text.muted} />
                <Text style={s.emptyTitle}>No courses yet</Text>
                <Text style={s.emptySubtitle}>Add golf courses to set up your rounds</Text>
              </View>
            )
            : filteredCourses.length === 0
            ? (
              <View style={s.emptyState}>
                <Feather name="search" size={48} color={theme.text.muted} />
                <Text style={s.emptyTitle}>No matches</Text>
                <Text style={s.emptySubtitle}>No courses match "{query}"</Text>
              </View>
            )
            : filteredCourses.map((c, index) => (
              <View key={c.id}>
                <View style={s.row}>
                  <TouchableOpacity
                    style={s.rowLeft}
                    onPress={() => navigation.navigate('CourseLibraryDetail', { courseId: c.id, courseName: c.name })}
                    activeOpacity={0.7}
                  >
                    <Text style={s.courseName}>{c.name}</Text>
                    <Text style={s.courseMeta}>
                      {[c.city, c.province].filter(Boolean).join(', ')}
                      {(c.city || c.province) ? '  ·  ' : ''}
                      Par {c.holes.reduce((sum, h) => sum + h.par, 0)}
                      {c.slope ? `  ·  Slope ${c.slope}` : ''}
                      {c.rating ? `  ·  CR ${c.rating}` : ''}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.editBtn}
                    onPress={() => navigation.navigate('CourseLibraryDetail', { courseId: c.id, courseName: c.name })}
                    activeOpacity={0.7}
                  >
                    <Feather name="edit-2" size={16} color={theme.accent.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => remove(c)} activeOpacity={0.7}>
                    <Feather name="trash-2" size={16} color={theme.destructive} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, marginTop: 16, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, padding: 13, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  addBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: theme.isDark ? 1 : 0, borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 12, marginBottom: 10,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 4,
    color: theme.text.primary, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18 },
  emptySubtitle: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 14, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  rowLeft: { flex: 1 },
  courseName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16 },
  courseMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 3 },
  editBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
});
