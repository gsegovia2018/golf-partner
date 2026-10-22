import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import CourseRoundsTray from '../components/CourseRoundsTray';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, FontAwesome } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useT, formatNumber, formatDate } from '../i18n';
import {
  getCachedCourseLibrary, loadCourseLibrary, defaultHoles, toggleFavoriteCourse,
} from '../store/libraryStore';
import { tournamentsIndex } from '../store/tournamentsIndex';
import { isStandardHoleCard } from '../store/scoring';
import { setPendingCourses } from '../lib/selectionBridge';
import { buildCourseLastUsed } from '../lib/recentUse';
import {
  normalizeText, recentCourses, regionItems, regionSummary, searchCourses,
} from '../lib/courseLibrary';

// Search results stop here; the rest is a "keep typing" count.
const SEARCH_LIMIT = 40;

// Search-first course picker. The library is the whole federation list, so
// it never renders all of it: favourites and recent courses, layout-level
// search results, or one region at a time. Picks are layouts (courses), in
// round order. A tournament (`route.params.rounds`) shows the rounds tray.
export default function CoursePickerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);

  const { roundIndex } = route.params;
  // Optional cap on how many courses can be picked at once.
  const maxSelectable = route.params?.maxSelectable ?? null;
  const showRounds = !!route.params?.rounds && maxSelectable !== 1;

  const [courses, setCourses] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => new Set());
  const [lastUsed, setLastUsed] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  // null on the main view; { region } while browsing one region (region may
  // itself be null: courses with no region).
  const [browsing, setBrowsing] = useState(null);
  const [openClubId, setOpenClubId] = useState(null);
  const hasLoadedOnceRef = useRef(false);
  // Stars tapped on this screen (course id -> starred). The fresh library can
  // land after a tap made on the cached one; these are re-applied on top so
  // it never undoes them.
  const favoriteEditsRef = useRef(new Map());
  const browsingRef = useRef(null);
  const leavingRef = useRef(false);
  browsingRef.current = browsing;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let shown = false;
      const show = (library) => {
        if (cancelled) return;
        setCourses(library.courses);
        setClubs(library.clubs);
        const favs = new Set(library.favorites);
        favoriteEditsRef.current.forEach((on, id) => { if (on) favs.add(id); else favs.delete(id); });
        setFavorites(favs);
        setLoading(false);
        shown = true;
      };
      if (!hasLoadedOnceRef.current) setLoading(true);
      setLoadError(null);
      // Recent-use order comes from the local tournaments index: no network.
      tournamentsIndex.readIndex()
        .then((rows) => { if (!cancelled) setLastUsed(buildCourseLastUsed(rows)); })
        .catch(() => {});
      // Cache first so the list shows at once, then the fresh library replaces
      // it. loadCourseLibrary never throws: offline it serves the same cache
      // and reports usingCachedData.
      getCachedCourseLibrary()
        .then((cached) => { if (cached.courses.length && !shown) show(cached); });
      loadCourseLibrary()
        .then((library) => {
          if (cancelled) return;
          // Offline with the cache already on screen: keep showing it.
          if (library.usingCachedData && shown) return;
          show(library);
          // The only true error state: offline with nothing cached to show.
          if (library.usingCachedData && library.courses.length === 0) {
            setLoadError(t('courses.loadFailed'));
          }
        })
        .finally(() => {
          if (!cancelled) {
            hasLoadedOnceRef.current = true;
            setLoading(false);
          }
        });
      return () => { cancelled = true; };
    }, [reloadKey, t]),
  );

  // Back (header, gesture or Android button) from a region returns to the
  // main view instead of leaving the picker.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!browsingRef.current || leavingRef.current) return;
    e.preventDefault();
    setBrowsing(null);
    setOpenClubId(null);
  }), [navigation]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const layoutCount = useMemo(() => {
    const counts = new Map();
    for (const c of courses) if (c.clubId) counts.set(c.clubId, (counts.get(c.clubId) ?? 0) + 1);
    return counts;
  }, [courses]);

  const favoriteCourses = useMemo(
    () => courses.filter((c) => favorites.has(c.id))
      .sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name))),
    [courses, favorites],
  );
  const recent = useMemo(() => recentCourses(courses, lastUsed, favorites), [courses, lastUsed, favorites]);
  const regions = useMemo(() => regionSummary(courses, clubs), [courses, clubs]);
  const results = useMemo(() => searchCourses(courses, clubs, query, SEARCH_LIMIT), [courses, clubs, query]);
  const browseItems = useMemo(
    () => (browsing ? regionItems(courses, clubs, browsing.region) : []),
    [courses, clubs, browsing],
  );

  const regionLabel = (region) => {
    if (region == null) return t('courses.region.none');
    const key = `courses.region.${region}`;
    const label = t(key);
    return label === key ? region : label;
  };

  function togglePick(courseId) {
    setSelected((prev) => {
      if (prev.includes(courseId)) return prev.filter((id) => id !== courseId);
      if (maxSelectable != null && prev.length >= maxSelectable) {
        const msg = t('courses.picker.limitMessage', { count: maxSelectable });
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert(t('courses.picker.limitTitle'), msg);
        return prev;
      }
      return [...prev, courseId];
    });
  }

  function moveRound(from, to) {
    setSelected((prev) => {
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function confirm() {
    const picks = selected.map((id) => {
      const course = courseById.get(id);
      return {
        kind: 'course',
        course: {
          id: course.id, name: course.name, slope: course.slope, rating: course.rating,
          // Full 18 or full 9 (nine-hole layouts) are used as stored; a
          // half-entered card falls back to a blank 18.
          holes: isStandardHoleCard(course.holes) ? course.holes : defaultHoles(),
          tees: course.tees ?? [],
        },
      };
    });
    setPendingCourses({ startRoundIndex: roundIndex, picks });
    leavingRef.current = true;
    navigation.goBack();
  }

  async function handleToggleFavorite(courseId) {
    const prev = favorites;
    const next = new Set(prev);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    favoriteEditsRef.current.set(courseId, next.has(courseId));
    setFavorites(next);
    try {
      await toggleFavoriteCourse(courseId);
    } catch (err) {
      favoriteEditsRef.current.set(courseId, prev.has(courseId));
      setFavorites(prev);
      Alert.alert(t('courses.errorTitle'), err.message ?? t('courses.favoriteFailed'));
    }
  }

  function courseMeta(c) {
    return [
      placeOf(c.city, c.province),
      t('courses.picker.par', { par: formatNumber(c.holes.reduce((sum, h) => sum + h.par, 0)) }),
      c.slope ? t('courses.picker.slope', { slope: formatNumber(c.slope) }) : null,
    ].filter(Boolean).join('  ·  ');
  }

  // One pickable layout. `label` overrides the name (a layout under its club).
  function renderCourseRow(c, { label, played, highlight, nested } = {}) {
    const selIdx = selected.indexOf(c.id);
    const picked = selIdx !== -1;
    const isFavorite = favorites.has(c.id);
    const name = label ?? c.name;
    return (
      <View key={`course-${c.id}`} style={[s.row, nested && s.rowNested, picked && s.rowPicked]}>
        <TouchableOpacity
          style={s.rowLeft}
          onPress={() => togglePick(c.id)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ selected: picked }}
          aria-pressed={picked}
        >
          <Highlight text={name} query={highlight} style={nested ? s.layoutName : s.courseName} markStyle={s.mark} />
          <Text style={s.courseMeta}>
            {played ? <Text style={s.played}>{t('courses.picker.playedOn', { date: formatDate(played, 'day') })}  ·  </Text> : null}
            {courseMeta(c)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.favBtn}
          onPress={() => handleToggleFavorite(c.id)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('courses.picker.favorite', { name })}
          accessibilityState={{ checked: isFavorite }}
          aria-pressed={isFavorite}
        >
          {isFavorite ? (
            <FontAwesome name="star" size={18} color={theme.accent.primary} />
          ) : (
            <Feather name="star" size={14} color={theme.text.secondary} />
          )}
        </TouchableOpacity>
        {!picked ? <View style={s.emptyCircle} />
          : showRounds
            ? <View style={s.roundPill}><Text style={s.orderBadgeText}>{t('courses.picker.roundShort', { n: roundIndex + 1 + selIdx })}</Text></View>
            : <View style={s.orderBadge}><Text style={s.orderBadgeText}>{selIdx + 1}</Text></View>}
      </View>
    );
  }

  // A club with several layouts: its name over the layouts, each pickable.
  function renderClubLayouts(club, layouts, highlight) {
    return (
      <View key={`club-${club.id}`}>
        <View style={s.clubHead}>
          <Highlight text={club.name} query={highlight} style={s.courseName} markStyle={s.mark} />
          <Text style={s.courseMeta}>
            {placeOf(club.city, club.province)}
            {(club.city || club.province) ? '  ·  ' : ''}
            {t('courses.picker.layouts', { count: layoutCount.get(club.id) ?? layouts.length })}
          </Text>
        </View>
        {layouts.map((c) => renderCourseRow(c, { label: c.layoutName ?? c.name, highlight, nested: true }))}
      </View>
    );
  }

  function renderSearch() {
    if (results.total === 0) {
      return (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>{t('courses.noMatch', { query: query.trim() })}</Text>
          <Text style={s.emptyHint}>{t('courses.picker.noMatchHint')}</Text>
        </View>
      );
    }
    const shown = results.groups.reduce((n, g) => n + g.courses.length, 0);
    return (
      <>
        <SectionTitle text={t('courses.picker.results')} extra={t('courses.picker.layouts', { count: results.total })} s={s} />
        <Group s={s}>
          {results.groups.map((g) => (g.club && (layoutCount.get(g.club.id) ?? 0) > 1
            ? renderClubLayouts(g.club, g.courses, query)
            : renderCourseRow(g.courses[0], { highlight: query })))}
        </Group>
        {results.total > shown ? (
          <Text style={s.moreText}>{t('courses.picker.moreResults', { count: results.total - shown })}</Text>
        ) : null}
      </>
    );
  }

  function renderHome() {
    return (
      <>
        {favoriteCourses.length > 0 && (
          <>
            <SectionTitle text={t('courses.picker.favorites')} s={s} />
            <Group s={s}>
              {favoriteCourses.map((c) => renderCourseRow(c, { played: lastUsed[c.id] }))}
            </Group>
          </>
        )}
        {recent.length > 0 && (
          <>
            <SectionTitle text={t('courses.picker.recent')} s={s} />
            <Group s={s}>
              {recent.map((c) => renderCourseRow(c, { played: lastUsed[c.id] }))}
            </Group>
          </>
        )}
        {favoriteCourses.length === 0 && recent.length === 0 && (
          <Text style={s.hint}>{t('courses.picker.firstVisit')}</Text>
        )}
        <SectionTitle text={t('courses.picker.browse')} s={s} />
        <Group s={s}>
          {regions.map(({ region, count }) => (
            <TouchableOpacity
              key={region ?? 'none'}
              style={s.row}
              onPress={() => { setBrowsing({ region }); setOpenClubId(null); }}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={[s.courseName, s.flex]}>{regionLabel(region)}</Text>
              <Text style={s.count}>{t('courses.picker.clubCount', { count })}</Text>
              <Feather name="chevron-right" size={18} color={theme.text.secondary} />
            </TouchableOpacity>
          ))}
        </Group>
      </>
    );
  }

  function renderRegion() {
    return (
      <Group s={s}>
        {browseItems.map((item) => {
          if (item.kind === 'course') return renderCourseRow(item.course);
          const open = openClubId === item.club.id;
          return (
            <View key={`club-${item.club.id}`}>
              <TouchableOpacity
                style={s.row}
                onPress={() => setOpenClubId(open ? null : item.club.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                aria-expanded={open}
              >
                <View style={s.rowLeft}>
                  <Text style={s.courseName}>{item.club.name}</Text>
                  <Text style={s.courseMeta}>
                    {item.club.city ? `${item.club.city}  ·  ` : ''}
                    {t('courses.picker.layouts', { count: item.layouts.length })}
                  </Text>
                </View>
                <Feather name={open ? 'chevron-down' : 'chevron-right'} size={18} color={theme.text.secondary} />
              </TouchableOpacity>
              {open && item.layouts.map((c) => renderCourseRow(c, { label: c.layoutName ?? c.name, nested: true }))}
            </View>
          );
        })}
      </Group>
    );
  }

  function renderBody() {
    if (loading) return <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />;
    if (loadError) {
      return (
        <View style={s.errorBox}>
          <Feather name="wifi-off" size={44} color={theme.destructive} />
          <Text style={s.errorTitle}>{t('courses.loadFailedTitle')}</Text>
          <Text style={s.errorMsg}>{loadError}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => setReloadKey((k) => k + 1)}
            activeOpacity={0.7}
          >
            <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
            <Text style={s.retryBtnText}>{t('courses.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (courses.length === 0) return <Text style={s.hint}>{t('courses.picker.empty')}</Text>;
    if (browsing) return renderRegion();
    if (query.trim()) return renderSearch();
    return renderHome();
  }

  // Tray names lead with the layout: a slot truncates from the end, and two
  // rounds at one club differ only by layout.
  const clubName = useMemo(() => new Map(clubs.map((c) => [c.id, c.name])), [clubs]);
  const selectedNames = selected.map((id) => {
    const c = courseById.get(id);
    if (!c) return '';
    return c.layoutName && clubName.has(c.clubId) ? `${c.layoutName} · ${clubName.get(c.clubId)}` : c.name;
  });

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton
          icon="chevron-left"
          onPress={() => navigation.goBack()}
          accessibilityLabel={browsing ? t('courses.picker.backToSearch') : t('courses.back')}
        />
        <Text style={s.headerTitle} numberOfLines={1}>
          {browsing ? regionLabel(browsing.region) : t('courses.picker.title')}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        {!browsing && (
          <View style={s.searchRow}>
            <Feather name="search" size={18} color={theme.text.secondary} style={s.searchIcon} />
            <TextInput
              style={s.searchInput}
              placeholder={t('courses.searchPlaceholder')}
              placeholderTextColor={theme.text.secondary}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query ? (
              <IconButton icon="x" onPress={() => setQuery('')} style={s.searchClear} />
            ) : null}
          </View>
        )}
        {browsing && regions.length > 0 ? (
          <Text style={s.hint}>
            {t('courses.picker.clubCount', {
              count: regions.find((r) => r.region === browsing.region)?.count ?? 0,
            })}
          </Text>
        ) : null}
        {renderBody()}
      </ScrollView>

      {showRounds ? (
        <CourseRoundsTray
          names={selectedNames}
          startRound={roundIndex + 1}
          onMove={moveRound}
          onRemove={(i) => setSelected((prev) => prev.filter((_, idx) => idx !== i))}
          onConfirm={confirm}
        />
      ) : selected.length > 0 && (
        <View style={s.footer}>
          <TouchableOpacity style={s.confirmBtn} onPress={confirm}>
            <Text style={s.confirmBtnText}>
              {t('courses.picker.addRounds', { count: selected.length })}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScreenContainer>
  );
}

// A section card. Each row draws a top hairline; the card clips the first.
function Group({ s, children }) {
  return (
    <View style={s.group}>
      <View style={s.groupInner}>{children}</View>
    </View>
  );
}

// "Madrid" rather than "Madrid, Madrid" when the city is the region.
function placeOf(city, province) {
  return city && province && normalizeText(city) === normalizeText(province)
    ? city
    : [city, province].filter(Boolean).join(', ');
}

function SectionTitle({ text, extra, s }) {
  return (
    <View style={s.sectionTitleRow}>
      <Text style={s.sectionTitle}>{text}</Text>
      {extra ? <Text style={s.sectionExtra}>{extra}</Text> : null}
    </View>
  );
}

// `text` with the first accent-insensitive match of `query` underlined (not
// coloured, so the match doesn't rely on colour alone).
function Highlight({ text, query, style, markStyle }) {
  const q = normalizeText(query).trim();
  const norm = normalizeText(text);
  const i = q && norm.length === text.length ? norm.indexOf(q) : -1;
  if (i < 0) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {text.slice(0, i)}
      <Text style={markStyle}>{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </Text>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: theme.bg.primary,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    color: theme.text.primary,
  },
  content: { padding: 16, paddingTop: 4, paddingBottom: 40, gap: 8 },
  flex: { flex: 1 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card,
    borderRadius: 14, borderWidth: 1.5, borderColor: theme.accent.primary,
    paddingHorizontal: 14, minHeight: 54, marginBottom: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 14, paddingHorizontal: 2,
    color: theme.text.primary, fontSize: 16,
    fontFamily: 'PlusJakartaSans-Medium',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  sectionTitleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingHorizontal: 4, marginTop: 10,
  },
  sectionTitle: {
    color: theme.text.secondary,
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  sectionExtra: {
    color: theme.text.secondary,
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12,
  },
  // One card per section; rows inside are separated by hairlines.
  group: {
    backgroundColor: theme.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    overflow: 'hidden',
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  groupInner: { marginTop: -StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border.default,
  },
  rowNested: { minHeight: 54, paddingLeft: 28 },
  rowPicked: {
    backgroundColor: theme.isDark ? theme.accent.primary + '14' : theme.accent.light,
  },
  rowLeft: { flex: 1, minWidth: 0 },
  clubHead: {
    paddingTop: 12, paddingBottom: 6, paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border.default,
  },
  courseName: {
    color: theme.text.primary,
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  layoutName: {
    color: theme.text.primary,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  mark: {
    textDecorationLine: 'underline',
    textDecorationColor: theme.accent.primary,
  },
  courseMeta: {
    color: theme.text.secondary,
    fontSize: 12,
    marginTop: 3,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  played: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-SemiBold' },
  count: {
    color: theme.text.secondary,
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-SemiBold',
  },
  hint: {
    color: theme.text.secondary,
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Regular',
    paddingHorizontal: 4,
  },
  moreText: {
    color: theme.text.secondary,
    fontSize: 13,
    fontFamily: 'PlusJakartaSans-Medium',
    textAlign: 'center',
    marginTop: 4,
  },
  emptyBox: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 16, gap: 6 },
  emptyTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15, textAlign: 'center',
  },
  emptyHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 13, textAlign: 'center',
  },
  orderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundPill: {
    minWidth: 32,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
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
    textAlign: 'center',
  },
  favBtn: { paddingHorizontal: 8, paddingVertical: 10 },
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
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
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
