import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import PressableScale from '../components/ui/PressableScale';
import IconButton from '../components/ui/IconButton';
import Reveal from '../components/ui/Reveal';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile, upsertProfile } from '../store/profileStore';
import { TargetHandicapPicker } from '../components/mystats/TargetHandicapPicker';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';
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
const EXCLUSIONS_PREFIX = '@handicap_round_exclusions:';

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
  const [handicapExclusions, setHandicapExclusions] = useState(() => new Set());
  const [coachFocus, setCoachFocus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadFocus(user?.id).then((focus) => { if (!cancelled) setCoachFocus(focus); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);
  const isTabPresentation = route?.params?.presentation === 'tab';
  const contentScrollRef = useRef(null);
  const tabScrollRef = useRef(null);
  const tabLayoutsRef = useRef({});
  const tabViewportWidthRef = useRef(0);
  const tabScrollXRef = useRef(0);

  // Device-scoped fallback key when signed out, so a signed-out user's
  // selection still persists (and can later be migrated onto their account).
  const storageKey = `${SELECTION_PREFIX}${user?.id ?? 'local'}`;
  const exclusionsKey = `${EXCLUSIONS_PREFIX}${user?.id ?? 'local'}`;

  useEffect(() => {
    setTab(normalizeStatsTab(route?.params?.tab));
  }, [route?.params?.tab]);

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
        const [{ list }, profile] = await Promise.all([
          loadAllTournamentsWithFallback(),
          loadProfile().catch(() => null),
        ]);
        if (!cancelled) {
          setTargetHandicap(profile?.targetHandicap ?? null);
          setProfileHandicap(profile?.handicap ?? null);
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
        let exclusions = new Set();
        try {
          let rawEx = await AsyncStorage.getItem(exclusionsKey);
          if (rawEx == null && user?.id) {
            // First signed-in load on this device: adopt any signed-out exclusions.
            const localExKey = `${EXCLUSIONS_PREFIX}local`;
            const localExRaw = await AsyncStorage.getItem(localExKey);
            if (localExRaw != null) {
              rawEx = localExRaw;
              AsyncStorage.setItem(exclusionsKey, localExRaw).catch(() => {});
              AsyncStorage.removeItem(localExKey).catch(() => {});
            }
          }
          if (rawEx) exclusions = new Set(JSON.parse(rawEx) || []);
        } catch (_) { /* ignore corrupt storage */ }
        // Deliberately keep stale keys rather than pruning: resolveSelection
        // only consults overrides for rounds that exist, the map is bounded
        // by rounds ever played, and pruning on load permanently loses
        // selections whenever a load is partial (offline / transient failure).
        if (!cancelled) {
          setMyRounds(rounds);
          setOverrides(stored);
          setHandicapExclusions(exclusions);
        }
      } catch (e) {
        console.warn('MyStatsScreen: failed to load tournaments', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, storageKey, exclusionsKey, loadNonce]);

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
    setHandicapExclusions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      AsyncStorage.setItem(exclusionsKey, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, [exclusionsKey]);

  const onInfo = useCallback((key) => setInfoKey(key), []);

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

  // New tab content starts at the top — jump there without animating so the
  // Reveal transition is the only motion on a tab switch.
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);

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
          size={22}
          color={theme.accent.primary}
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
      {ALL_TABS.map((t) => (
        <PressableScale
          key={t.key}
          style={[s.tab, tab === t.key && s.tabActive]}
          onPress={() => setTab(t.key)}
          onLayout={(event) => {
            tabLayoutsRef.current[t.key] = event.nativeEvent.layout;
            if (tab === t.key) scrollTabIntoView(t.key, false);
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === t.key }}
          accessibilityLabel={t.label}
        >
          <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
        </PressableScale>
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
          <Feather name="wifi-off" size={32} color={theme.text.muted} />
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
          <Feather name="bar-chart-2" size={32} color={theme.text.muted} />
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

  // ── Empty: every round deselected ──
  if (selected.length === 0 && tab !== 'reportCard' && tab !== 'handicap') {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        {TabBar}
        <View style={s.center}>
          <Feather name="filter" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds selected.</Text>
          <PressableScale style={s.retryBtn} onPress={() => setSelectorOpen(true)}>
            <Text style={s.retryText}>Choose rounds</Text>
          </PressableScale>
        </View>
        {Selector}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      {TabBar}
      <ScrollView ref={contentScrollRef} contentContainerStyle={s.scroll}>
        <Reveal key={tab} style={s.revealWrap}>
          {tab === 'reportCard' && (
            <RoundReportCard
              card={reportCard}
              rounds={myRounds}
              selectedKey={reportRoundKey}
              onSelect={setReportRoundKey}
              onOpenRound={openReportRound}
            />
          )}
          {tab === 'coach' && (
            <CoachTab
              stats={stats}
              onInfo={onInfo}
              targetHandicap={targetHandicap}
              onChangeTarget={() => setPickerOpen(true)}
              focus={coachFocus}
              focusVerdict={coachFocusVerdict}
              onCommitFocus={onCommitFocus}
              onEndFocus={onEndFocus}
            />
          )}
          {tab === 'form' && <FormTab stats={stats} n={n} onChangeN={setN} onInfo={onInfo} />}
          {tab === 'breakdown' && <BreakdownTab stats={stats} onInfo={onInfo} onSelectCourse={openCourseStats} />}
          {tab === 'shots' && <ShotsTab stats={stats} onInfo={onInfo} targetHandicap={targetHandicap} onChangeTarget={() => setPickerOpen(true)} />}
          {tab === 'handicap' && (
            <HandicapTab
              myRounds={myRounds}
              profileHandicap={profileHandicap}
              onInfo={onInfo}
              onApplied={setProfileHandicap}
              excludedKeys={handicapExclusions}
              onToggleExcluded={toggleHandicapExclusion}
            />
          )}
        </Reveal>
      </ScrollView>
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
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.card,
      borderWidth: 1, borderColor: theme.border.default,
      flexShrink: 0,
    },
    tabActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    tabText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tabTextActive: { color: theme.text.inverse },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
    revealWrap: { gap: theme.spacing.lg },
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

export { getTabScrollTarget };
