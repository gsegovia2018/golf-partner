import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, InteractionManager } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  interpolateColor,
  Extrapolation,
  useReducedMotion,
  runOnJS,
} from 'react-native-reanimated';
import ScreenContainer from '../components/ScreenContainer';
import PressableScale from '../components/ui/PressableScale';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile, upsertProfile } from '../store/profileStore';
import { getAppSettings, updateAppSettings } from '../store/settingsStore';
import { useAppSettings } from '../hooks/useAppSettings';
import { TargetHandicapPicker } from '../components/mystats/TargetHandicapPicker';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';
import { pruneShotsToRounds } from '../store/shotStore';
import { buildRoundReportCard } from '../store/roundReportCard';
import RoundReportCard from '../components/RoundReportCard';
import MyStatsRoundSelector from '../components/MyStatsRoundSelector';
import StatDetailSheet from '../components/StatDetailSheet';
import CoachTab from '../components/mystats/tabs/CoachTab';
import FormTab from '../components/mystats/tabs/FormTab';
import BreakdownTab from '../components/mystats/tabs/BreakdownTab';
import ShotsTab from '../components/mystats/tabs/ShotsTab';
import HandicapTab from '../components/mystats/tabs/HandicapTab';
import { statExplainers } from '../components/mystats/statExplainers';
import { loadFocus, saveFocus, clearFocus, archiveFocus, makeFocusCommit, focusVerdict } from '../store/coachFocus';

const SELECTION_PREFIX = '@mystats_round_selection:';
// Legacy per-device key handicap exclusions used before they moved into the
// synced app settings store (handicapExcludedRounds). Kept only so the load
// effect can migrate any exclusions still sitting in it — see the migration
// block below — then delete it.
const LEGACY_EXCLUSIONS_PREFIX = '@handicap_round_exclusions:';

// Builds the rows array for StatDetailSheet based on which infoKey is active.
// Most keys need no rows (explainer-only). strokesGained shows per-round trend.
function buildInfoRows(key, stats) {
  if (key !== 'strokesGained' || !stats?.strokesGained?.perRound?.length) return [];
  const perRound = stats.strokesGained.perRound;
  const last10 = perRound.slice(-10);
  const rows = [
    { key: 'section-trend', section: true, label: 'Last 10 rounds', rightLabel: 'SG total' },
  ];
  last10.forEach((r, i) => {
    const n = perRound.length - last10.length + i + 1;
    const val = r.total >= 0 ? `+${r.total.toFixed(2)}` : r.total.toFixed(2);
    rows.push({
      key: `sg-round-${n}`,
      primary: `Round ${n}`,
      secondary: `${r.sampleHoles} holes`,
      rightPrimary: val,
      tone: r.total >= 0 ? 'good' : 'poor',
    });
  });
  return rows;
}

const ALL_TABS = [
  { key: 'reportCard', label: 'Report Card' },
  { key: 'coach', label: 'Coach' },
  { key: 'shots',     label: 'Strokes Gained' },
  { key: 'form',      label: 'Form' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'handicap', label: 'Handicap' },
];

// Captured by the pager's scroll worklet, which must not reach into the
// ALL_TABS array from the UI thread.
const TAB_COUNT = ALL_TABS.length;

// The label colour rides the pager offset on the UI thread rather than
// flipping when `tab` state commits. Committing the tab re-renders the screen,
// and that render is long enough to be seen: the indicator (UI thread) kept
// gliding while the label waited on the JS thread, which read as the colour
// lagging the pill. Interpolating here keeps the two exactly in step.
function TabPill({ index, item, active, scrollX, pageWidthSV, theme, s, onPress, onLayout }) {
  const textStyle = useAnimatedStyle(() => {
    const w = pageWidthSV.value > 0 ? pageWidthSV.value : 1;
    // How many pages away the pager currently sits from this pill.
    const distance = Math.min(1, Math.abs(scrollX.value / w - index));
    return {
      color: interpolateColor(distance, [0, 1], [theme.text.inverse, theme.text.muted]),
    };
  });

  return (
    <PressableScale
      style={s.tab}
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
    >
      <Animated.Text style={[s.tabText, textStyle]}>{item.label}</Animated.Text>
    </PressableScale>
  );
}

function normalizeStatsTab(value) {
  if (value === 'overview') return 'coach';
  if (!ALL_TABS.some((t) => t.key === value)) return 'reportCard';
  return value;
}

export default function MyStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [myRounds, setMyRounds] = useState(null);   // null = loading
  const [error, setError] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [n, setN] = useState(5);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [tab, setTab] = useState(normalizeStatsTab(route?.params?.tab));
  const [reportRoundKey, setReportRoundKey] = useState(route?.params?.roundKey ?? null);
  const [infoKey, setInfoKey] = useState(null);
  const [targetHandicap, setTargetHandicap] = useState(null);
  const [profileHandicap, setProfileHandicap] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const appSettings = useAppSettings();
  // Persisted in app settings (handicapExcludedRounds), not local state — an
  // excluded round must stay excluded across unmount/app restart until the
  // user re-includes it. computeHandicapIndex/handicapIndexSeries call
  // .has() on this, so keep it a Set even though the stored form is an array.
  const handicapExclusions = useMemo(
    () => new Set(appSettings.handicapExcludedRounds ?? []),
    [appSettings.handicapExcludedRounds],
  );
  const [coachFocus, setCoachFocus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadFocus(user?.id).then((focus) => { if (!cancelled) setCoachFocus(focus); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);
  const isTabPresentation = route?.params?.presentation === 'tab';
  const tabScrollRef = useRef(null);
  const tabLayoutsRef = useRef({});
  const tabViewportWidthRef = useRef(0);
  const tabScrollXRef = useRef(0);
  const pagerRef = useRef(null);
  const currentOffsetRef = useRef(0);
  const reduced = useReducedMotion();
  const [pageWidth, setPageWidth] = useState(() => Dimensions.get('window').width);
  const scrollX = useSharedValue(0);
  // Last page index the scroll stream committed. Lives on the UI thread so the
  // handler can tell a genuine page change from the ~60 events/s that don't
  // cross a boundary, and only bridge to JS on the former.
  const settledIndexSV = useSharedValue(0);
  const tabLayoutsSV = useSharedValue({ xs: [], ws: [] });
  const pageWidthSV = useSharedValue(pageWidth);
  const [pillBox, setPillBox] = useState({ y: 0, height: 0 });

  const syncTabLayoutsSV = useCallback(() => {
    const xs = [];
    const ws = [];
    for (const t of ALL_TABS) {
      const l = tabLayoutsRef.current[t.key];
      if (!l) return; // wait until every pill is measured
      xs.push(l.x);
      ws.push(l.width);
    }
    tabLayoutsSV.value = { xs, ws };
    const first = tabLayoutsRef.current[ALL_TABS[0].key];
    setPillBox((prev) => (
      prev.height === first.height && prev.y === first.y ? prev : { y: first.y, height: first.height }
    ));
  }, [tabLayoutsSV]);

  const indicatorStyle = useAnimatedStyle(() => {
    const { xs, ws } = tabLayoutsSV.value;
    if (!xs || xs.length < 2) return { opacity: 0, width: 0 };
    const w = pageWidthSV.value > 0 ? pageWidthSV.value : 1;
    const frac = scrollX.value / w; // 0 .. count-1
    const input = xs.map((_, i) => i);
    const x = interpolate(frac, input, xs, Extrapolation.CLAMP);
    const width = interpolate(frac, input, ws, Extrapolation.CLAMP);
    return { opacity: 1, width, transform: [{ translateX: x }] };
  });

  const activeIndex = useMemo(
    () => Math.max(0, ALL_TABS.findIndex((t) => t.key === tab)),
    [tab],
  );

  const [activated, setActivated] = useState(
    () => windowAround(
      Math.max(0, ALL_TABS.findIndex((t) => t.key === normalizeStatsTab(route?.params?.tab))),
      ALL_TABS.length,
    ),
  );

  // Grow the mounted window to include the active page's neighbours; once a
  // page has been visited it stays mounted (no re-mount cost on return).
  // The active page mounts straight away, but the neighbours wait for the
  // gesture to finish: they are off-screen, and mounting a chart-heavy tab
  // inside the swipe is what made the slide stutter as it snapped.
  useEffect(() => {
    setActivated((prev) => (prev.has(activeIndex) ? prev : new Set(prev).add(activeIndex)));
    const handle = InteractionManager.runAfterInteractions(() => {
      setActivated((prev) => {
        const next = windowAround(activeIndex, ALL_TABS.length);
        let grew = false;
        next.forEach((j) => { if (!prev.has(j)) grew = true; });
        if (!grew) return prev;
        const merged = new Set(prev);
        next.forEach((j) => merged.add(j));
        return merged;
      });
    });
    return () => handle.cancel();
  }, [activeIndex]);

  const commitIndex = useCallback((index, width) => {
    const key = ALL_TABS[index]?.key;
    if (!key) return;
    // The swipe itself moved the pager, so record where it is heading. The
    // alignment effect below reads this and stays out of the way instead of
    // firing a scrollTo that fights the platform's own page snap.
    currentOffsetRef.current = index * width;
    setTab((prev) => (prev === key ? prev : key));
  }, []);

  // Settle from the scroll stream, not from onScrollEndDrag/onMomentumScrollEnd.
  // react-native-web's ScrollView wires only onScroll to the DOM and never
  // emits either end event, so settling on those left web swipes inert: the
  // pill label never followed the indicator and pages outside the initial
  // window never mounted, leaving a blank page under the finger. Committing at
  // the halfway point also lands the header change with the indicator rather
  // than a beat behind it.
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const x = event.contentOffset.x;
      scrollX.value = x;
      const w = pageWidthSV.value;
      if (w <= 0) return;
      const index = indexFromOffset(x, w, TAB_COUNT);
      if (index === settledIndexSV.value) return;
      settledIndexSV.value = index;
      runOnJS(commitIndex)(index, w);
    },
  });

  // Device-scoped fallback key when signed out, so a signed-out user's
  // selection still persists (and can later be migrated onto their account).
  const storageKey = `${SELECTION_PREFIX}${user?.id ?? 'local'}`;

  useEffect(() => {
    setTab(normalizeStatsTab(route?.params?.tab));
  }, [route?.params?.tab]);

  // Keep the pager aligned with the active tab. Skip when the pager is already
  // at that offset (i.e. the change came from a finger swipe, whose commitIndex
  // updated currentOffsetRef first) so we never fight the native scroll.
  useEffect(() => {
    const targetX = activeIndex * pageWidth;
    const delta = Math.abs(currentOffsetRef.current - targetX);
    if (delta < 2) return;
    // Animate one-page hops only. Animating a multi-page jump (tapping a far
    // pill) drags the viewport across pages that aren't mounted yet, so the
    // user watches a blank sweep, and the scroll stream crosses — and commits
    // — every index on the way.
    const adjacent = delta <= pageWidth + 2;
    currentOffsetRef.current = targetX;
    settledIndexSV.value = activeIndex;
    pagerRef.current?.scrollTo?.({ x: targetX, animated: !reduced && adjacent });
  }, [activeIndex, pageWidth, reduced, settledIndexSV]);

  useEffect(() => {
    if (route?.params?.roundKey) {
      setReportRoundKey(route.params.roundKey);
    }
  }, [route?.params?.roundKey]);

  // Load all tournaments → collect this user's rounds. Restore stored overrides.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        // The profile display name lets collectMyRounds recognise unlinked
        // (guest) player slots — e.g. solo games never claimed to an account.
        const [{ list, stale }, profile] = await Promise.all([
          loadAllTournamentsWithFallback(),
          loadProfile().catch(() => null),
        ]);
        if (!cancelled) {
          setTargetHandicap(profile?.targetHandicap ?? null);
          setProfileHandicap(profile?.handicap ?? null);
        }
        // Drop GPS shots whose round was deleted. Only when the list is
        // authoritative (fresh server load, not a stale cache) — otherwise a
        // tournament that simply wasn't loaded offline would look "deleted".
        if (!stale) {
          const validRoundIds = new Set();
          for (const t of list || []) for (const r of t.rounds || []) if (r?.id) validRoundIds.add(r.id);
          pruneShotsToRounds(validRoundIds, { deleteRemote: true }).catch(() => {});
        }
        const rounds = collectMyRounds(list, user?.id, profile?.displayName);
        let stored = {};
        try {
          let raw = await AsyncStorage.getItem(storageKey);
          if (raw == null && user?.id) {
            // First signed-in load on this device: adopt any signed-out selection.
            const localKey = `${SELECTION_PREFIX}local`;
            const localRaw = await AsyncStorage.getItem(localKey);
            if (localRaw != null) {
              raw = localRaw;
              AsyncStorage.setItem(storageKey, localRaw).catch(() => {});
              AsyncStorage.removeItem(localKey).catch(() => {});
            }
          }
          if (raw) stored = JSON.parse(raw) || {};
        } catch (_) { /* ignore corrupt storage */ }
        // One-time migration: exclusions used to live in a per-device
        // AsyncStorage key before they moved into the synced app settings
        // store. Adopt any legacy entries once, then delete the legacy
        // key(s) — once removed, later loads find nothing and this is a
        // no-op, so it naturally runs at most once per device.
        try {
          const legacyKey = `${LEGACY_EXCLUSIONS_PREFIX}${user?.id ?? 'local'}`;
          const legacyKeysToRemove = [];
          let legacyRaw = await AsyncStorage.getItem(legacyKey);
          if (legacyRaw != null) legacyKeysToRemove.push(legacyKey);
          if (user?.id) {
            // Also fold in (and clean up) a signed-out device's exclusions,
            // same as the round-selection migration above.
            const localLegacyKey = `${LEGACY_EXCLUSIONS_PREFIX}local`;
            const localLegacyRaw = await AsyncStorage.getItem(localLegacyKey);
            if (localLegacyRaw != null) {
              legacyKeysToRemove.push(localLegacyKey);
              if (legacyRaw == null) legacyRaw = localLegacyRaw;
            }
          }
          if (legacyRaw != null) {
            let legacyExclusions = [];
            try { legacyExclusions = JSON.parse(legacyRaw) || []; } catch (_) { legacyExclusions = []; }
            if (Array.isArray(legacyExclusions) && legacyExclusions.length > 0 && !cancelled) {
              // Settings win: only adopt into an empty settings array, and
              // re-check right before writing so a toggle that raced this
              // migration (settings already non-empty) is never clobbered.
              const currentExclusions = getAppSettings().handicapExcludedRounds ?? [];
              if (currentExclusions.length === 0) {
                await updateAppSettings({ handicapExcludedRounds: legacyExclusions });
              }
            }
            await Promise.all(legacyKeysToRemove.map((k) => AsyncStorage.removeItem(k).catch(() => {})));
          }
        } catch (_) { /* ignore corrupt legacy storage */ }
        // Deliberately keep stale keys rather than pruning: resolveSelection
        // only consults overrides for rounds that exist, the map is bounded
        // by rounds ever played, and pruning on load permanently loses
        // selections whenever a load is partial (offline / transient failure).
        if (!cancelled) {
          setMyRounds(rounds);
          setOverrides(stored);
        }
      } catch (e) {
        console.warn('MyStatsScreen: failed to load tournaments', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, storageKey, loadNonce]);

  // The target handicap can be edited on the Profile screen while this
  // screen stays mounted in the tab navigator — refresh it on focus so
  // Strokes Gained and Coach recompute against the current target.
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('focus', () => (
      loadProfile()
        .then((profile) => {
          setTargetHandicap(profile?.targetHandicap ?? null);
          setProfileHandicap(profile?.handicap ?? null);
        })
        .catch(() => {})
    ));
  }, [navigation]);

  // Default the Report Card to the most recent round once rounds are loaded.
  // collectMyRounds returns rounds chronologically (oldest first), so the
  // last entry is the most recent.
  useEffect(() => {
    if (!myRounds || myRounds.length === 0) return;
    setReportRoundKey((prev) => {
      if (prev && myRounds.some((r) => r.key === prev)) return prev;
      return myRounds[myRounds.length - 1].key;
    });
  }, [myRounds]);

  const persistOverrides = useCallback((next) => {
    setOverrides(next);
    AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
  }, [storageKey]);

  const toggleHandicapExclusion = useCallback((key) => {
    const next = new Set(getAppSettings().handicapExcludedRounds ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateAppSettings({ handicapExcludedRounds: [...next] }).catch(() => {});
  }, []);

  const onInfo = useCallback((key) => setInfoKey(key), []);
  // Stable so the memoised Coach/Shots tabs aren't re-rendered by a new arrow
  // on every commit — the whole point of memoising them.
  const openTargetPicker = useCallback(() => setPickerOpen(true), []);

  const openCourseStats = useCallback((course) => {
    if (!course?.courseKey) return;
    navigation.navigate('CourseStats', {
      courseKey: course.courseKey,
      courseName: course.courseName,
    });
  }, [navigation]);

  const scrollTabIntoView = useCallback((key, animated = true) => {
    const layout = tabLayoutsRef.current[key];
    const viewportWidth = tabViewportWidthRef.current;
    if (!layout || !viewportWidth) {
      if (key === 'breakdown') {
        tabScrollRef.current?.scrollToEnd({ animated });
      } else {
        tabScrollXRef.current = 0;
        tabScrollRef.current?.scrollTo({ x: 0, animated });
      }
      return;
    }
    const targetX = getTabScrollTarget({
      layout,
      viewportWidth,
      currentX: tabScrollXRef.current,
      pinToStart: key === 'reportCard' || key === 'coach' || key === 'shots',
    });
    if (targetX == null) return;
    tabScrollXRef.current = targetX;
    tabScrollRef.current?.scrollTo({ x: targetX, animated });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollTabIntoView(tab));
    return () => cancelAnimationFrame(frame);
  }, [scrollTabIntoView, tab]);

  const selected = useMemo(
    () => (myRounds ? resolveSelection(myRounds, overrides) : []),
    [myRounds, overrides],
  );
  const stats = useMemo(
    () => (selected.length ? computeMyStats(selected, { n, targetHandicap: targetHandicap ?? 0 }) : null),
    [selected, n, targetHandicap],
  );

  const coachFocusVerdict = useMemo(
    () => (coachFocus && stats ? focusVerdict(coachFocus, stats) : null),
    [coachFocus, stats],
  );

  const onCommitFocus = useCallback((insight) => {
    const focus = makeFocusCommit(insight, stats);
    if (!focus) return;
    setCoachFocus(focus);
    saveFocus(user?.id, focus).catch(() => {});
  }, [stats, user?.id]);

  const onEndFocus = useCallback(() => {
    if (!coachFocus) return;
    const ended = coachFocus;
    const verdict = coachFocusVerdict;
    setCoachFocus(null);
    archiveFocus(user?.id, ended, verdict).catch(() => clearFocus(user?.id).catch(() => {}));
  }, [coachFocus, coachFocusVerdict, user?.id]);

  const reportCard = useMemo(
    () => (myRounds && reportRoundKey
      ? buildRoundReportCard(myRounds, reportRoundKey)
      : null),
    [myRounds, reportRoundKey],
  );

  // Link to the full statistics screen (holes, players, etc.) scoped to the
  // selected round — only when the round is resolvable there (StatsScreen
  // matches rounds by round.id, which older local rounds may lack).
  const openReportRound = useMemo(() => {
    const r = myRounds && reportRoundKey
      ? myRounds.find((it) => it.key === reportRoundKey)
      : null;
    if (!r?.tournamentId || !r?.round?.id) return null;
    return () => navigation.navigate('Stats', {
      tournamentId: r.tournamentId,
      roundId: r.round.id,
    });
  }, [myRounds, reportRoundKey, navigation]);

  const activeExplainer = useMemo(() => {
    const rawExplainer = infoKey ? statExplainers[infoKey] : null;
    return typeof rawExplainer === 'function' ? rawExplainer(targetHandicap) : rawExplainer;
  }, [infoKey, targetHandicap]);

  const Header = (
    <View style={s.header}>
      {!isTabPresentation && (
        <IconButton
          icon="chevron-left"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        />
      )}
      <Text style={s.headerTitle}>My Stats</Text>
      <PressableScale
        onPress={() => setSelectorOpen(true)}
        style={s.roundsBtn}
        disabled={!myRounds}
      >
        <Feather name="sliders" size={14} color={theme.accent.primary} />
        <Text style={s.roundsBtnText}>
          {myRounds ? `${selected.length} of ${myRounds.length}` : '—'}
        </Text>
      </PressableScale>
    </View>
  );

  const TabBar = (
    <ScrollView
      ref={tabScrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      alwaysBounceHorizontal={false}
      nestedScrollEnabled
      scrollEnabled
      scrollEventThrottle={16}
      style={s.tabScroller}
      contentContainerStyle={s.tabBar}
      testID="my-stats-tab-scroller"
      onScroll={(event) => {
        tabScrollXRef.current = event.nativeEvent.contentOffset?.x ?? 0;
      }}
      onLayout={(event) => {
        tabViewportWidthRef.current = event.nativeEvent.layout.width;
        scrollTabIntoView(tab, false);
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[s.tabIndicator, { top: pillBox.y, height: pillBox.height }, indicatorStyle]}
      />
      {ALL_TABS.map((t, i) => (
        <TabPill
          key={t.key}
          index={i}
          item={t}
          active={tab === t.key}
          scrollX={scrollX}
          pageWidthSV={pageWidthSV}
          theme={theme}
          s={s}
          onPress={() => setTab(t.key)}
          onLayout={(event) => {
            tabLayoutsRef.current[t.key] = event.nativeEvent.layout;
            if (tab === t.key) scrollTabIntoView(t.key, false);
            syncTabLayoutsSV();
          }}
        />
      ))}
    </ScrollView>
  );

  // ── Loading ──
  if (myRounds === null && !error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="wifi-off" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>Could not load your stats.</Text>
          <PressableScale
            style={s.retryBtn}
            onPress={() => { setMyRounds(null); setError(false); setLoadNonce((v) => v + 1); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </PressableScale>
        </View>
      </ScreenContainer>
    );
  }

  // ── Empty: no rounds at all ──
  if (myRounds.length === 0) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="bar-chart-2" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>Play and score a round to see your stats.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const Selector = (
    <MyStatsRoundSelector
      visible={selectorOpen}
      myRounds={myRounds}
      overrides={overrides}
      onChange={persistOverrides}
      onClose={() => setSelectorOpen(false)}
    />
  );

  const renderPage = (key) => {
    const needsRounds = key === 'coach' || key === 'shots' || key === 'form' || key === 'breakdown';
    if (needsRounds && selected.length === 0) {
      return (
        <View style={[s.page, { width: pageWidth }, s.pageEmpty]}>
          <Feather name="filter" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds selected.</Text>
          <PressableScale style={s.retryBtn} onPress={() => setSelectorOpen(true)}>
            <Text style={s.retryText}>Choose rounds</Text>
          </PressableScale>
        </View>
      );
    }
    let body = null;
    if (key === 'reportCard') {
      body = (
        <RoundReportCard
          card={reportCard}
          rounds={myRounds}
          selectedKey={reportRoundKey}
          onSelect={setReportRoundKey}
          onOpenRound={openReportRound}
        />
      );
    } else if (key === 'coach') {
      body = (
        <CoachTab
          stats={stats}
          onInfo={onInfo}
          targetHandicap={targetHandicap}
          onChangeTarget={openTargetPicker}
          focus={coachFocus}
          focusVerdict={coachFocusVerdict}
          onCommitFocus={onCommitFocus}
          onEndFocus={onEndFocus}
        />
      );
    } else if (key === 'form') {
      body = <FormTab stats={stats} n={n} onChangeN={setN} onInfo={onInfo} />;
    } else if (key === 'breakdown') {
      body = <BreakdownTab stats={stats} onInfo={onInfo} onSelectCourse={openCourseStats} />;
    } else if (key === 'shots') {
      body = <ShotsTab stats={stats} onInfo={onInfo} targetHandicap={targetHandicap} onChangeTarget={openTargetPicker} />;
    } else if (key === 'handicap') {
      body = (
        <HandicapTab
          myRounds={myRounds}
          profileHandicap={profileHandicap}
          onInfo={onInfo}
          onApplied={setProfileHandicap}
          excludedKeys={handicapExclusions}
          onToggleExcluded={toggleHandicapExclusion}
        />
      );
    }
    return (
      <ScrollView
        style={[s.page, { width: pageWidth }]}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    );
  };

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      {TabBar}
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        style={s.pager}
        contentContainerStyle={s.pagerContent}
        testID="my-stats-pager"
        onLayout={(event) => {
          const w = event.nativeEvent.layout.width;
          if (w && Math.abs(w - pageWidth) > 1) { setPageWidth(w); pageWidthSV.value = w; }
        }}
      >
        {ALL_TABS.map((t, i) => (
          // s.pageSlot's height is load-bearing, not cosmetic. Each page's body
          // is a vertical ScrollView, which can only scroll when its height is
          // BOUNDED by the pager. Width alone left this wrapper at
          // `flex: 0 0 auto` with no height, so it grew to its content's full
          // height (~2500px); the ScrollView grew with it, scrollHeight ===
          // clientHeight, and vertical scrolling died — the overflow was just
          // clipped by the pager. On web, react-native-web's `pagingEnabled`
          // inserts its own stretched wrapper around this one, which masked the
          // missing constraint from the layout above.
          <View key={t.key} style={[s.pageSlot, { width: pageWidth }]}>
            {activated.has(i) ? renderPage(t.key) : null}
          </View>
        ))}
      </Animated.ScrollView>
      <StatDetailSheet
        visible={!!infoKey}
        onClose={() => setInfoKey(null)}
        title={activeExplainer?.title ?? ''}
        subtitle={activeExplainer?.subtitle ?? ''}
        explainer={activeExplainer?.explainer ?? ''}
        rows={buildInfoRows(infoKey, stats)}
        shareable={false}
      />
      {Selector}
      <TargetHandicapPicker
        visible={pickerOpen}
        currentValue={targetHandicap}
        currentHandicap={null}
        onSave={async (value) => {
          setTargetHandicap(value);
          setPickerOpen(false);
          await upsertProfile({ targetHandicap: value });
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10,
    },
    headerTitle: {
      flex: 1, fontFamily: 'PlayfairDisplay-Black', fontSize: 26, color: theme.text.primary,
    },
    roundsBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: theme.spacing.md, paddingVertical: 6,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.light,
    },
    roundsBtnText: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    tabScroller: {
      flexGrow: 0,
      flexShrink: 0,
      width: '100%',
      maxWidth: '100%',
      alignSelf: 'stretch',
      minHeight: 48,
      backgroundColor: theme.bg.primary,
    },
    tabBar: {
      flexDirection: 'row', gap: 6,
      paddingLeft: theme.spacing.lg,
      paddingRight: theme.spacing.xxxl,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      minHeight: 48,
    },
    tab: {
      paddingVertical: 6, paddingHorizontal: 14,
      borderRadius: theme.radius.pill,
      backgroundColor: 'transparent',
      borderWidth: 1, borderColor: 'transparent',
      flexShrink: 0,
    },
    // Fill comes from the animated indicator, colour from TabPill's worklet.
    tabText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tabIndicator: {
      position: 'absolute',
      left: 0,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.accent.primary,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
    pager: { flex: 1 },
    pagerContent: { alignItems: 'stretch' },
    // Bounds each page to the pager's height so the page's ScrollView has
    // something to scroll within. See the comment at the pager's map().
    pageSlot: { height: '100%' },
    page: { flex: 1 },
    pageEmpty: { alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
  });
}

function getTabScrollTarget({
  layout,
  viewportWidth,
  currentX = 0,
  edgePadding = 16,
  pinToStart = false,
}) {
  if (!layout || !viewportWidth) return null;
  if (pinToStart) return currentX > 0 ? 0 : null;
  const left = layout.x;
  const right = layout.x + layout.width;
  const visibleLeft = currentX + edgePadding;
  const visibleRight = currentX + viewportWidth - edgePadding;

  if (left < visibleLeft) return Math.max(0, left - edgePadding);
  if (right > visibleRight) return Math.max(0, right - viewportWidth + edgePadding);
  return null;
}

function indexFromOffset(offsetX, width, count) {
  'worklet'; // also called from the pager's scroll handler on the UI thread
  if (!Number.isFinite(width) || width <= 0) return 0;
  const raw = Math.round(offsetX / width);
  return Math.max(0, Math.min(count - 1, raw));
}

function windowAround(index, count) {
  const set = new Set();
  for (let j = index - 1; j <= index + 1; j += 1) {
    if (j >= 0 && j < count) set.add(j);
  }
  return set;
}

export { getTabScrollTarget, indexFromOffset };
