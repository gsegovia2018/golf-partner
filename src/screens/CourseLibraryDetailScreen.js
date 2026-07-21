import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { fetchCourses, updateCourseFromEditor, upsertCourse } from '../store/libraryStore';
import { propagateCourseToTournaments } from '../store/tournamentStore';
import TeesEditor from '../components/TeesEditor';
import { canSaveCourse } from '../lib/courseLibrary';
import {
  prefetchCourseTiles, getPrefetchState, subscribePrefetch,
  deleteBucket, courseKeyFor, estimateTileBytes, PREFETCH_ZOOMS,
} from '../store/tileCache';
import { findCourseGeometry } from '../lib/geo';
import { holeBbox, tilesForBbox } from '../lib/tileMath';

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}

export default function CourseLibraryDetailScreen({ navigation, route }) {
  const { courseId, courseName: initialName } = route.params;
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [name, setName] = useState(initialName ?? '');
  const [tees, setTees] = useState([]);
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [holes, setHoles] = useState(defaultHoles());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const courses = await fetchCourses();
        if (cancelled) return;
        const course = courses.find((c) => c.id === courseId);
        if (course) {
          setName(course.name);
          setTees((course.tees ?? []).map((t) => ({ ...t })));
          setCity(course.city ?? '');
          setProvince(course.province ?? '');
          if (course.holes.length === 18) setHoles(course.holes.map((h) => ({ ...h })));
        }
      } catch (err) {
        if (!cancelled) setLoadError(err?.message ?? 'Could not load course');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, reloadKey]);

  useEffect(() => {
    navigation.setOptions({ title: name || initialName || 'Course' });
  }, [navigation, name, initialName]);

  // Offline map: visible only for courses with per-hole ('holes'-mode) mapped
  // geometry — the satellite tile prefetch needs a bbox per hole.
  const prefetch = useSyncExternalStore(subscribePrefetch, getPrefetchState);
  const geometry = findCourseGeometry(name);
  const tileCount = useMemo(() => {
    if (!geometry?.holes?.length) return 0;
    const seen = new Set();
    for (const h of geometry.holes) {
      const b = holeBbox({ tee: h.start, greenCenter: h.greenCenter, green: h.green, hazards: h.hazards });
      if (b) tilesForBbox(b, PREFETCH_ZOOMS).forEach((t) => seen.add(`${t.z}/${t.x}/${t.y}`));
    }
    return seen.size;
  }, [geometry]);
  const sizeMb = (estimateTileBytes(tileCount) / (1024 * 1024)).toFixed(0);
  const courseKey = courseKeyFor(name);
  const mine = prefetch?.courseKey === courseKey;
  const busy = mine && prefetch.running;
  // A run only counts as "downloaded" once every tile in it actually
  // succeeded — a finished-but-partial run (offline mid-download) stays
  // retryable rather than pretending success.
  const downloaded = mine && !prefetch.running && prefetch.total > 0 && prefetch.ok === prefetch.total;
  const finishedIncomplete = mine && !prefetch.running && prefetch.total > 0 && prefetch.ok < prefetch.total;
  const downloadLabel = busy
    ? `Downloading ${prefetch.done}/${prefetch.total}`
    : finishedIncomplete ? 'Retry' : 'Download';
  const onDownloadTiles = useCallback(() => {
    prefetchCourseTiles(name, { force: true }).catch(() => {});
  }, [name]);
  const onDeleteTiles = useCallback(() => {
    deleteBucket(courseKey).catch(() => {});
  }, [courseKey]);

  async function handleSave() {
    if (!name.trim()) return;
    const { ok, siIssues, dupes } = canSaveCourse(holes, tees);
    if (!ok) {
      Alert.alert(
        'Fix course data before saving',
        [...siIssues, ...(dupes.length > 0 ? [`Duplicate tee labels: ${dupes.join(', ')}`] : [])].join('\n'),
      );
      return;
    }
    setSaving(true);
    try {
      await upsertCourse({ id: courseId, name: name.trim(), city, province });
      await updateCourseFromEditor(courseId, holes, tees);
      await propagateCourseToTournaments(courseId, { holes, tees });
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
  const { ok: canSave } = canSaveCourse(holes, tees);

  if (loading) {
    return (
      <ScreenContainer style={s.centered} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (loadError) {
    return (
      <ScreenContainer style={s.centered} edges={['top', 'bottom']}>
        <View style={s.errorBox}>
          <Feather name="wifi-off" size={44} color={theme.destructive} />
          <Text style={s.errorTitle}>Couldn't load course</Text>
          <Text style={s.errorMsg}>{loadError}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => setReloadKey((k) => k + 1)}
            activeOpacity={0.7}
          >
            <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
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

        <TeesEditor tees={tees} onChange={setTees} theme={theme} />

        <View style={s.locationRow}>
          <TextInput
            style={[s.locationInput, s.flex]}
            placeholder="City"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={city}
            onChangeText={setCity}
          />
          <TextInput
            style={[s.locationInput, { width: 100 }]}
            placeholder="Province"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={province}
            onChangeText={setProvince}
          />
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

        {!!geometry?.holes?.length && (
          <>
            <Text style={s.sectionTitle}>Offline map</Text>
            <View style={[s.tableCard, s.offlineMapCard]}>
              <View style={s.offlineMapInfo}>
                <Text style={s.offlineMapSubtitle}>~{sizeMb} MB satellite imagery</Text>
                {downloaded && <Text style={s.offlineMapStatus}>Downloaded</Text>}
                {finishedIncomplete && (
                  <Text style={s.offlineMapStatusWarn}>
                    Incomplete — {prefetch.ok}/{prefetch.total} tiles
                  </Text>
                )}
              </View>
              <View style={s.offlineMapActions}>
                <TouchableOpacity
                  style={[s.offlineMapDownloadBtn, busy && s.saveBtnDisabled]}
                  onPress={onDownloadTiles}
                  disabled={busy}
                  activeOpacity={0.7}
                  accessibilityLabel="Download offline map"
                >
                  <Feather name="download" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 6 }} />
                  <Text style={s.offlineMapDownloadBtnText}>{downloadLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onDeleteTiles}
                  activeOpacity={0.7}
                  style={s.offlineMapDeleteBtn}
                  accessibilityLabel="Delete offline map"
                >
                  <Text style={s.offlineMapDeleteBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        <TouchableOpacity
          style={[s.saveBtn, (saving || !canSave) && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving || !canSave}
          activeOpacity={0.7}
        >
          <Feather name="check" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
          <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save course'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  centered: { flex: 1, backgroundColor: theme.bg.primary, alignItems: 'center', justifyContent: 'center' },
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  nameInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, fontSize: 18,
    fontFamily: 'PlusJakartaSans-Bold', marginBottom: 16,
  },
  locationRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  locationInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, padding: 11, fontSize: 14,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  flex: { flex: 1 },
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
  offlineMapCard: {
    padding: 14, marginTop: 4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  offlineMapInfo: { flex: 1 },
  offlineMapSubtitle: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13 },
  offlineMapStatus: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12, marginTop: 4,
  },
  offlineMapStatusWarn: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginTop: 4,
  },
  offlineMapActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offlineMapDownloadBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14,
    borderWidth: theme.isDark ? 1 : 0, borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  offlineMapDownloadBtnText: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse, fontSize: 13,
  },
  offlineMapDeleteBtn: { paddingVertical: 9, paddingHorizontal: 6 },
  offlineMapDeleteBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13 },
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
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
