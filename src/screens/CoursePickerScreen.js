import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  fetchCourses, upsertCourse, defaultHoles, saveCourseHoles,
  fetchFavoriteCourseIds, toggleFavoriteCourse,
} from '../store/libraryStore';
import { loadAllTournaments } from '../store/tournamentStore';
import { setPendingCourses } from '../lib/selectionBridge';
import { buildCourseLastUsed } from '../lib/recentUse';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function CoursePickerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { roundIndex } = route.params;

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => new Set());
  const [lastUsed, setLastUsed] = useState({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([
        fetchCourses(),
        fetchFavoriteCourseIds().catch(() => new Set()),
        loadAllTournaments().catch(() => []),
      ])
        .then(([list, favs, tournaments]) => {
          if (cancelled) return;
          setCourses(list);
          setFavorites(favs);
          setLastUsed(buildCourseLastUsed(tournaments));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, []),
  );

  const filteredCourses = useMemo(() => {
    const q = normalize(query);
    const base = q
      ? courses.filter((c) =>
        normalize(c.name).includes(q) ||
        normalize(c.city).includes(q) ||
        normalize(c.province).includes(q))
      : courses.slice();
    base.sort((a, b) => {
      const fa = favorites.has(a.id) ? 1 : 0;
      const fb = favorites.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const ta = lastUsed[a.id] ?? 0;
      const tb = lastUsed[b.id] ?? 0;
      if (ta !== tb) return tb - ta;
      return normalize(a.name).localeCompare(normalize(b.name));
    });
    return base;
  }, [courses, query, favorites, lastUsed]);

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

  async function handleToggleFavorite(courseId) {
    const prev = favorites;
    const next = new Set(prev);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    setFavorites(next);
    try {
      await toggleFavoriteCourse(courseId);
    } catch (err) {
      setFavorites(prev);
      Alert.alert('Error', err.message ?? 'Could not update favorite');
    }
  }

  async function addAndSelect(rawName = newName) {
    const trimmed = (rawName ?? '').trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const holes = defaultHoles();
      const course = await upsertCourse({ name: trimmed, slope: null });
      await saveCourseHoles(course.id, holes);
      const full = { ...course, holes };
      setCourses((prev) => [...prev, full]);
      setNewName('');
      setQuery('');
      setSelectedCourses((prev) => [...prev, full]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Select Courses</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
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
          <TouchableOpacity style={s.addBtn} onPress={() => addAndSelect()} disabled={saving || !newName.trim()}>
            <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>Library</Text>
        {loading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
        ) : courses.length === 0 ? (
          <Text style={s.empty}>No courses in library yet.</Text>
        ) : filteredCourses.length === 0 ? (
          <>
            <Text style={s.empty}>No courses match "{query}"</Text>
            {query.trim() ? (
              <TouchableOpacity
                style={s.createCta}
                onPress={() => addAndSelect(query)}
                disabled={saving}
                activeOpacity={0.7}
              >
                <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.createCtaText}>Create "{query.trim()}"</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          filteredCourses.map((c) => {
            const selIdx = selectedCourses.findIndex((sc) => sc.id === c.id);
            const isPicked = selIdx !== -1;
            const isFavorite = favorites.has(c.id);
            return (
              <View key={c.id} style={[s.row, isPicked && s.rowPicked]}>
                <TouchableOpacity
                  style={s.rowLeft}
                  onPress={() => toggleCourse({ id: c.id, name: c.name, slope: c.slope, holes: c.holes.length === 18 ? c.holes : defaultHoles() })}
                  activeOpacity={0.7}
                >
                  <Text style={s.courseName}>{c.name}</Text>
                  <Text style={s.courseMeta}>
                    {[c.city, c.province].filter(Boolean).join(', ')}
                    {(c.city || c.province) ? '  ·  ' : ''}
                    Par {c.holes.reduce((sum, h) => sum + h.par, 0)}
                    {c.slope ? `  ·  Slope ${c.slope}` : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.favBtn}
                  onPress={() => handleToggleFavorite(c.id)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather
                    name="star"
                    size={18}
                    color={isFavorite ? theme.accent.primary : theme.text.muted}
                  />
                </TouchableOpacity>
                {isPicked
                  ? (
                    <View style={s.orderBadge}>
                      <Text style={s.orderBadgeText}>{selIdx + 1}</Text>
                    </View>
                  )
                  : <View style={s.emptyCircle} />}
              </View>
            );
          })
        )}
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
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 12, marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 4,
    color: theme.text.primary, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  favBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  createCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.accent.primary + '40', borderStyle: 'dashed',
    backgroundColor: theme.accent.light,
    padding: 14, marginTop: 8,
  },
  createCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.accent.primary, fontSize: 14,
  },
});
