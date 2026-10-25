import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import CardGrid from '../components/CardGrid';
import IconButton from '../components/ui/IconButton';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, FontAwesome } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { isAdminUser } from '../lib/admin';
import { useT, formatNumber } from '../i18n';
import { useTabBarScroll, useTabBarClearance } from '../navigation/tabBarChrome';
import {
  deleteCourse, fetchCourses, upsertCourse,
  fetchFavoriteCourseIds, toggleFavoriteCourse,
} from '../store/libraryStore';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function CoursesLibraryScreen({ navigation }) {
  const { theme } = useTheme();
  const tabBarScroll = useTabBarScroll();
  const tabBarClearance = useTabBarClearance();
  const t = useT();
  const s = makeStyles(theme);
  // Adding, editing and deleting library courses is admin-only (RLS enforces
  // the same list, see public.is_geo_admin); everyone can browse and star.
  const canEdit = isAdminUser(useAuth()?.user?.id);

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => new Set());
  const hasLoadedOnceRef = useRef(false);

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
    if (!hasLoadedOnceRef.current) setLoading(true);
    setLoadError(null);
    try {
      const [list, favs] = await Promise.all([
        fetchCourses(),
        fetchFavoriteCourseIds().catch(() => new Set()),
      ]);
      setCourses(list);
      setFavorites(favs);
    } catch (err) {
      setLoadError(err?.message ?? t('courses.loadFailed'));
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
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
      if (Platform.OS === 'web') window.alert(err.message ?? t('courses.favoriteFailed'));
      else Alert.alert(t('courses.errorTitle'), err.message ?? t('courses.favoriteFailed'));
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
      Alert.alert(t('courses.errorTitle'), e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(t('courses.library.removeConfirm', { name: c.name }))
      : await new Promise((resolve) => Alert.alert(
          t('courses.library.removeTitle'), t('courses.library.removeConfirm', { name: c.name }),
          [{ text: t('courses.cancel'), style: 'cancel', onPress: () => resolve(false) },
           { text: t('courses.library.remove'), style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await deleteCourse(c.id);
      await load();
    } catch (err) {
      if (Platform.OS === 'web') window.alert(err.message ?? t('courses.deleteFailed'));
      else Alert.alert(t('courses.errorTitle'), err.message ?? t('courses.deleteFailed'));
    }
  }

  return (
    <ScreenContainer style={s.container} edges={['top']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{t('courses.library.title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={[s.content, { paddingBottom: tabBarClearance }]} automaticallyAdjustKeyboardInsets {...tabBarScroll}>
        <Text style={s.sectionTitle}>
          {query && filteredCourses.length !== courses.length
            ? t('courses.library.countOf', { count: filteredCourses.length, total: courses.length })
            : t('courses.library.countAll', { count: filteredCourses.length })}
        </Text>

        <View style={s.searchRow}>
          <Feather name="search" size={14} color={theme.text.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder={t('courses.searchPlaceholder')}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <IconButton icon="x" onPress={() => setQuery('')} style={s.searchClear} accessibilityLabel={t('courses.library.clearSearch')} />
          ) : null}
        </View>

        {canEdit && (
          <>
            <Text style={s.sectionTitle}>{t('courses.library.addSection')}</Text>
            <View style={s.form}>
              <TextInput
                style={[s.input, s.flex]}
                placeholder={t('courses.library.newNamePlaceholder')}
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
          </>
        )}

        <Text style={s.sectionTitle}>{t('courses.library.listSection')}</Text>

        {loading
          ? <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
          : loadError
            ? (
              <View style={s.errorBox}>
                <Feather name="wifi-off" size={44} color={theme.destructive} />
                <Text style={s.errorTitle}>{t('courses.loadFailedTitle')}</Text>
                <Text style={s.errorMsg}>{loadError}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.7}>
                  <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
                  <Text style={s.retryBtnText}>{t('courses.retry')}</Text>
                </TouchableOpacity>
              </View>
            )
            : courses.length === 0
            ? (
              <View style={s.emptyState}>
                <Feather name="map" size={44} color={theme.text.muted} />
                <Text style={s.emptyTitle}>{t('courses.library.empty')}</Text>
                <Text style={s.emptySubtitle}>{t('courses.library.emptySub')}</Text>
              </View>
            )
            : filteredCourses.length === 0
            ? (
              <View style={s.emptyState}>
                <Feather name="search" size={44} color={theme.text.muted} />
                <Text style={s.emptyTitle}>{t('courses.library.noMatches')}</Text>
                <Text style={s.emptySubtitle}>{t('courses.noMatch', { query })}</Text>
              </View>
            )
            : (
              <CardGrid>{filteredCourses.map((c) => (
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
                        {t('courses.picker.par', { par: formatNumber(c.holes.reduce((sum, h) => sum + h.par, 0)) })}
                        {c.slope ? `  ·  ${t('courses.picker.slope', { slope: formatNumber(c.slope) })}` : ''}
                        {c.rating ? `  ·  ${t('courses.library.rating', { rating: formatNumber(c.rating) })}` : ''}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.favBtn}
                      onPress={() => handleToggleFavorite(c.id)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {favorites.has(c.id) ? (
                        <FontAwesome name="star" size={16} color={theme.accent.primary} />
                      ) : (
                        <Feather name="star" size={16} color={theme.text.muted} />
                      )}
                    </TouchableOpacity>
                    {canEdit && (
                      <>
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
                      </>
                    )}
                  </View>
                </View>
              ))}</CardGrid>
            )}
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
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
    padding: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  rowLeft: { flex: 1 },
  courseName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16 },
  courseMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 3 },
  editBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  favBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  errorBox: {
    alignItems: 'center', padding: 24, marginTop: 12,
    backgroundColor: theme.bg.card, borderRadius: 16,
    borderWidth: 1, borderColor: theme.border.default,
  },
  errorTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 15, marginTop: 10,
  },
  errorMsg: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 13, marginTop: 4, textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.accent.light, borderRadius: 10,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 14,
  },
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14, textAlign: 'center' },
});
