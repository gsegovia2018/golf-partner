import React, { useEffect, useState, useCallback, useRef, useMemo, startTransition } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, FlatList, Platform, Modal, Pressable, ActivityIndicator, Share, Animated, Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import ScreenContainer from '../components/ScreenContainer';
import { markBootReady } from '../store/bootReveal';
import IconButton from '../components/ui/IconButton';
import RoundScoreboard from '../components/RoundScoreboard';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { CommonActions } from '@react-navigation/native';

import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { loadProfile } from '../store/profileStore';
import { ShareableLeaderboard, shareLeaderboard } from '../components/ShareableCard';
import QuickStartCourses from '../components/QuickStartCourses';
import PostCreateInviteModal from '../components/PostCreateInviteModal';
import TourOverlay from '../components/tour/TourOverlay';
import { HOME_TOUR_STEPS } from '../components/tour/tourSteps';
import { scoringModeUsesTeams, leaderboardToggleLabels, getScoringMode, isScrambleMode } from '../components/scoringModes';
import { ScoringModeSheet, TeamsSettingsFields, BestBallValueFields } from '../components/ScoringModePicker';
import PullToRefresh from '../components/PullToRefresh';
import BottomSheet from '../components/BottomSheet';
import LiveRoundCard from '../components/LiveRoundCard';
import PressableScale from '../components/ui/PressableScale';
import {
  loadTournament, loadAllTournaments, loadAllTournamentsWithFallback,
  setActiveTournament,
  deleteTournament,
  tournamentPlayerClinched,
  isRoundComplete, isTournamentFinished, subscribeTournamentChanges,
  tournamentMatchPlayStandings,
  roundLeaderboard, tournamentLeaderboardResolved,
  DEFAULT_SETTINGS, generateInviteCode, buildJoinLink,
  tournamentNoun, tournamentNounCapitalized,
  getActiveTournamentSnapshot, getTournament, getTournamentSnapshot,
  lastTeeForPlayerOnCourse,
} from '../store/tournamentStore';
import { ensureRealtimeForTournament, stopRealtime } from '../store/realtimeSync';
import { fetchMyPlayers, loadQuickStartCourses as loadQuickStartCourseList } from '../store/libraryStore';
import {
  buildQuickStartRound,
  buildQuickStartTournamentDraft,
  resolveQuickStartPlayerTees,
} from '../lib/quickStartGame';
import { mutate } from '../store/mutate';
import { roundScoringMode, tournamentHasMixedModes, tournamentStablefordLeaderboard, buildTeamsForMode, roundBestBallValues } from '../store/scoring';
import { assignPlacements, comparatorForBoardMode } from '../store/leaderboardPlacement';
import { subscribeConnectivity } from '../lib/connectivity';
import { getAppSettings, updateAppSettings } from '../store/settingsStore';
import { useAppSettings } from '../hooks/useAppSettings';
import { unreadCount } from '../store/notificationStore';
import { shouldHandleStoreChange } from '../lib/navigationFocus';
import { useAuth } from '../context/AuthContext';
import { shouldOfferPostCreateEditorInvite } from './setupWizard';

// Web-only CSS scroll-snap. See ScorecardScreen.js for the rationale:
// RNW 0.21's `pagingEnabled` omits `scroll-snap-stop: always`, so a
// fast swipe can skip past one page. On web we drive snap ourselves.
const PAGER_SNAP_TYPE_STYLE = Platform.OS === 'web' ? { scrollSnapType: 'x mandatory', overflowX: 'auto' } : null;
const PAGER_PAGE_SNAP_STYLE = Platform.OS === 'web' ? { scrollSnapAlign: 'start', scrollSnapStop: 'always' } : null;

// Pick the round to land on when entering the tournament view.
// currentRound is an unreliable, often-stale cross-device pointer (it can lag
// at 0 while later rounds are fully scored), so derive the landing round from
// the scores themselves: go to the furthest round play has actually reached
// (the last round with any scores). If that round is complete and a later
// round exists, jump to the next one — that's where play is headed.
export function chooseInitialRound(tournament) {
  const rounds = tournament?.rounds ?? [];
  if (rounds.length === 0) return 0;
  const players = tournament?.players ?? [];
  let last = -1;
  for (let i = 0; i < rounds.length; i++) {
    const scores = rounds[i]?.scores;
    if (scores && Object.keys(scores).length > 0) last = i;
  }
  if (last < 0) return Math.min(tournament?.currentRound ?? 0, rounds.length - 1);
  if (last < rounds.length - 1 && isRoundComplete(rounds[last], players)) return last + 1;
  return last;
}

// "Marcos + Noé vs Guille + Alex" — the tournament's fixed pairs, first
// names only, read from round 1 (fixedTeams keeps them identical everywhere).
function pairsPreviewText(t) {
  const pairs = t?.rounds?.[0]?.pairs ?? [];
  if (pairs.length !== 2) return '';
  const firstName = (p) => {
    const live = t.players?.find((x) => x.id === p.id);
    return ((live ?? p)?.name ?? '').split(' ')[0];
  };
  return pairs.map((pr) => pr.map(firstName).join(' + ')).join(' vs ');
}

// Short label for a leaderboard's native scoring mode, used in the LEADERBOARD
// card header ("R2 · Match Play"). Mirrors scoringModes.js's fuller labels but
// stays local since this card only ever needs the short form.
const ROUND_MODE_LABELS = {
  stableford: 'Stableford',
  matchplay: 'Match Play',
  sindicato: 'Sindicato',
  bestball: 'Best Ball',
  pairsmatchplay: 'Pairs Match Play',
};
function roundModeLabel(mode) {
  if (mode?.startsWith?.('scramble')) return 'Scramble';
  return ROUND_MODE_LABELS[mode] ?? 'Stableford';
}
// True "Stroke Play" alt-view modes: the alt toggle re-sorts by gross
// strokes. Other modes (matchplay/sindicato/bestball/pairsmatchplay) label
// their alt toggle "Stableford" instead, so their alt view stays in points
// order rather than being strokes-sorted.
function isStrokePlayAlt(m) {
  return m === 'stableford' || m === 'individual' || isScrambleMode(m);
}

// Belt-and-braces: inject the snap rules via a real <style> tag so they
// apply even if RNW's atomic-CSS pipeline ever filters an unknown CSS
// property. Targeted by a data attribute we set on each page.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const id = 'golf-partner-pager-snap-stop';
  if (!document.getElementById(id)) {
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = '[data-pagerpage="1"]{scroll-snap-align:start !important;scroll-snap-stop:always !important;}';
    document.head.appendChild(styleEl);
  }
}

const SNACK_ENTER_DURATION = 200;
const SNACK_EXIT_DURATION = 160;
const SNACK_EASING = Easing.out(Easing.ease);
const SNACK_OFFSET = 60;

// Wraps the undo snackbar's data-driven visibility (`data` is null when
// hidden) so it can animate in *and* out without touching the timeout logic
// that owns `undoSnack` state — this component just watches `data` flip
// between an object and null and plays the matching transition. Keeps
// rendering its last known data through the exit animation since `data`
// is already null by the time that plays.
function UndoSnackbar({ data, onUndo, theme, s }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(!!data);
  const lastDataRef = useRef(data);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(SNACK_OFFSET)).current;
  const exitTimerRef = useRef(null);
  // Guards the exit animation's completion callback (and its fallback timer)
  // against firing setState after the component itself has really unmounted
  // — mirrors BottomSheet's isMountedRef pattern.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (exitTimerRef.current) { clearTimeout(exitTimerRef.current); exitTimerRef.current = null; }
    if (data) {
      lastDataRef.current = data;
      setMounted(true);
      opacity.setValue(0);
      const animations = [
        Animated.timing(opacity, {
          toValue: 1, duration: SNACK_ENTER_DURATION, easing: SNACK_EASING, useNativeDriver: true,
        }),
      ];
      if (reduced) {
        translateY.setValue(0);
      } else {
        translateY.setValue(SNACK_OFFSET);
        animations.push(Animated.timing(translateY, {
          toValue: 0, duration: SNACK_ENTER_DURATION, easing: SNACK_EASING, useNativeDriver: true,
        }));
      }
      Animated.parallel(animations).start();
      return undefined;
    }
    if (!mounted) return undefined;
    // finished === false → exit tween interrupted by a new snackbar; keep mounted.
    const finish = ({ finished } = {}) => {
      if (finished !== false && isMountedRef.current) setMounted(false);
    };
    const animations = [
      Animated.timing(opacity, {
        toValue: 0, duration: SNACK_EXIT_DURATION, easing: SNACK_EASING, useNativeDriver: true,
      }),
    ];
    if (!reduced) {
      animations.push(Animated.timing(translateY, {
        toValue: SNACK_OFFSET, duration: SNACK_EXIT_DURATION, easing: SNACK_EASING, useNativeDriver: true,
      }));
    }
    Animated.parallel(animations).start(finish);
    // Safety net matching BottomSheet's: guarantees unmount even if the
    // native-driver completion callback never fires.
    exitTimerRef.current = setTimeout(finish, SNACK_EXIT_DURATION + 50);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
  }, []);

  if (!mounted) return null;
  const shown = data ?? lastDataRef.current;

  return (
    <Animated.View style={[s.undoSnack, { opacity, transform: [{ translateY }] }]}>
      <Feather name="rotate-ccw" size={14} color="#fff" />
      <Text style={s.undoSnackText}>Round {(shown?.roundIndex ?? 0) + 1} reset</Text>
      <TouchableOpacity onPress={onUndo} style={s.undoSnackBtn} activeOpacity={0.7}>
        <Text style={s.undoSnackBtnText}>UNDO</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function HomeScreen({ navigation, route }) {
  const viewMode = route?.params?.viewMode ?? 'auto';
  const routeTournamentId = route?.params?.tournamentId ?? null;
  const { theme } = useTheme();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const [needsGender, setNeedsGender] = useState(false);
  useEffect(() => {
    let alive = true;
    const refreshGender = () => {
      loadProfile()
        .then((p) => { if (alive) setNeedsGender(!!p && !p.gender); })
        .catch(() => {});
    };
    refreshGender();
    const unsubFocus = navigation.addListener('focus', refreshGender);
    return () => { alive = false; unsubFocus(); };
  }, [navigation]);
  const initialTournament = useMemo(
    () => (routeTournamentId ? getTournamentSnapshot(routeTournamentId) : getActiveTournamentSnapshot()),
    [routeTournamentId],
  );
  const [tournament, setTournament] = useState(() => initialTournament);
  const [allTournaments, setAllTournaments] = useState(() => (initialTournament ? [initialTournament] : []));
  const [listStale, setListStale] = useState(false);
  const [openableIds, setOpenableIds] = useState(null); // null = all openable
  const [loading, setLoading] = useState(() => !initialTournament);
  // Drop the boot splash overlay (App.js) once this screen has real content
  // to stand behind it — the first render where nothing is loading.
  useEffect(() => {
    if (!loading) markBootReady();
  }, [loading]);
  const [selectedRound, setSelectedRound] = useState(0);
  const [roundPagerWidth, setRoundPagerWidth] = useState(0);
  const roundPagerRef = useRef(null);
  const roundScrollOffset = useRef(0);
  const quickStartCourseLoadRef = useRef(0);
  const quickStartPlayerLoadRef = useRef(0);
  const quickStartStartingRef = useRef(false);
  const isUserScrollingRound = useRef(false);
  const roundPagerInitialized = useRef(false);
  const hasAutoOpenedRef = useRef(false);
  // True while a programmatic scrollTo animation is in flight. Used to
  // stop onScroll from committing mid-animation (which would make the
  // pager fight its own scroll). User drags/momentum are NOT suppressed.
  const suppressRoundOnScroll = useRef(false);
  const suppressRoundTimer = useRef(null);
  // True when the latest selectedRound change came from a scroll commit
  // (onScroll / onMomentumScrollEnd). The sync effect uses this to skip
  // the scrollTo — the scroll is already at the right place. Without
  // this guard, a transition commit lagging behind the scroll settle can
  // trigger a visible mini-scroll back to an intermediate page.
  const selectedRoundFromScroll = useRef(false);
  // True once the user has picked a round themselves (tab tap, swipe, or
  // round menu). Background reloads (store-change / focus / connectivity)
  // must not snap the pager back to the smart default while this is set —
  // only a tournament switch or a currentRound advance clears it.
  const userPickedRoundRef = useRef(false);
  const lastLoadedTournamentIdRef = useRef(initialTournament?.id ?? null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [showPointValues, setShowPointValues] = useState(false);
  // Strings — BestBallValueFields edits through TextInputs.
  const [pointValuesDraft, setPointValuesDraft] = useState(null);
  // List-view overflow menu — surfaces the Course/Player libraries, which
  // otherwise have no entry point here.
  const [showListMenu, setShowListMenu] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [showTournamentKindChoice, setShowTournamentKindChoice] = useState(false);
  const [showRoundEdit, setShowRoundEdit] = useState(false);
  // Per-round "Scoring Mode" picker, opened from the Round N sheet.
  const [showRoundModeSheet, setShowRoundModeSheet] = useState(false);
  const [showResetHistory, setShowResetHistory] = useState(false);
  const [undoSnack, setUndoSnack] = useState(null); // { roundIndex, snapshot, at }
  const undoTimerRef = useRef(null);
  const [leaderboardAlt, setLeaderboardAlt] = useState(false);
  // false = follows the pager's selected round; true = whole-tournament board.
  // Defaults to true so a multi-round tournament opens on Overall standings;
  // the isGame single-game path ignores this flag entirely.
  const [leaderboardOverall, setLeaderboardOverall] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCodes, setInviteCodes] = useState({ editor: '', viewer: '' });
  const [inviteRoleState, setInviteRoleState] = useState('editor');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [quickStartCourses, setQuickStartCourses] = useState([]);
  const [quickStartCoursesLoading, setQuickStartCoursesLoading] = useState(false);
  const [quickStartPlayers, setQuickStartPlayers] = useState([]);
  const [quickStartPlayersLoading, setQuickStartPlayersLoading] = useState(false);
  const [quickStartPlayersError, setQuickStartPlayersError] = useState(null);
  const [quickStartStarting, setQuickStartStarting] = useState(false);
  const [postCreateInvite, setPostCreateInvite] = useState({
    visible: false,
    loading: false,
    link: '',
    error: '',
    tournament: null,
  });
  // Surfaced inline when reload() throws — instead of silently dropping the
  // user into an empty state with no way to recover.
  const [reloadError, setReloadError] = useState(null);
  // Themed in-app confirmation modal. `confirm()` returns a promise that
  // resolves true/false; replaces window.confirm so web matches native.
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);
  const confirm = useCallback(({ title, message, confirmLabel = 'Confirm', destructive = false }) => (
    new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ title, message, confirmLabel, destructive });
    })
  ), []);
  const resolveConfirm = useCallback((result) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(result);
  }, []);
  // Shares the same synced setting as ScorecardScreen so that hiding
  // running totals follows the user across screens. No-spoilers mode
  // overrides it, same as on the scorecard.
  const appSettings = useAppSettings();
  const showRunning = appSettings.showRunningScore && !appSettings.noSpoilers;
  const toggleRunning = useCallback(() => {
    updateAppSettings({ showRunningScore: !getAppSettings().showRunningScore }).catch(() => {});
  }, []);

  // Coalesce reload calls: `focus` and store-change emits can arrive in
  // quick succession. Run them serially and squash consecutive triggers
  // into a single trailing reload so we don't fan out overlapping
  // network round-trips.
  const reloadInFlight = useRef(null);
  const reloadPending = useRef(false);
  const hasLoadedOnceRef = useRef(!!initialTournament);
  const reload = useCallback(async () => {
    if (reloadInFlight.current) {
      reloadPending.current = true;
      return reloadInFlight.current;
    }
    const run = async () => {
      // Only flash the splash on the first load. Subsequent reloads swap
      // data in place to avoid flicker and perceived slowness.
      if (!hasLoadedOnceRef.current) setLoading(true);
      try {
        const [t, listResult] = await Promise.all([
          routeTournamentId ? getTournament(routeTournamentId) : loadTournament(),
          loadAllTournamentsWithFallback(),
        ]);
        setTournament(t);
        ensureRealtimeForTournament(t?.id ?? null).catch(() => {});
        setAllTournaments(listResult.list);
        setListStale(listResult.stale);
        setOpenableIds(listResult.openableIds);
        if (t) {
          // Snap to the smart default only when the viewed tournament
          // changed or the user hasn't manually picked a round yet. A
          // background reload (sync emit, refocus) must not yank the
          // pager off the round the user chose to look at.
          if (t.id !== lastLoadedTournamentIdRef.current) {
            lastLoadedTournamentIdRef.current = t.id;
            userPickedRoundRef.current = false;
          }
          if (!userPickedRoundRef.current) setSelectedRound(chooseInitialRound(t));
        }
        setReloadError(null);
      } catch (err) {
        // Surface the failure inline (with a Retry) rather than letting the
        // empty state render as if there were genuinely nothing to show.
        setReloadError(err?.message ?? 'Could not load your tournaments');
      } finally {
        hasLoadedOnceRef.current = true;
        setLoading(false);
      }
    };
    const p = run().finally(() => {
      reloadInFlight.current = null;
      if (reloadPending.current) {
        reloadPending.current = false;
        reload();
      }
    });
    reloadInFlight.current = p;
    return p;
  }, [routeTournamentId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  const loadQuickStartCourses = useCallback(async () => {
    const requestId = quickStartCourseLoadRef.current + 1;
    quickStartCourseLoadRef.current = requestId;
    const userId = currentUserId;
    if (!userId) {
      setQuickStartCourses([]);
      setQuickStartCoursesLoading(false);
      return;
    }
    setQuickStartCoursesLoading(true);
    try {
      const library = await loadQuickStartCourseList();
      if (quickStartCourseLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartCourses(library?.courses ?? []);
    } catch (_) {
      if (quickStartCourseLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartCourses([]);
    } finally {
      if (quickStartCourseLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartCoursesLoading(false);
    }
  }, [currentUserId]);

  const loadQuickStartPlayers = useCallback(async () => {
    const requestId = quickStartPlayerLoadRef.current + 1;
    quickStartPlayerLoadRef.current = requestId;
    const userId = currentUserId;
    if (!userId) {
      setQuickStartPlayers([]);
      setQuickStartPlayersError(null);
      setQuickStartPlayersLoading(false);
      return;
    }
    setQuickStartPlayersLoading(true);
    setQuickStartPlayersError(null);
    try {
      const players = await fetchMyPlayers();
      if (quickStartPlayerLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartPlayers(players);
    } catch (err) {
      if (quickStartPlayerLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartPlayersError(err?.message ?? 'Could not load players.');
    } finally {
      if (quickStartPlayerLoadRef.current !== requestId || currentUserIdRef.current !== userId) return;
      setQuickStartPlayersLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadQuickStartCourses();
    loadQuickStartPlayers();
    const unsubscribe = navigation.addListener('focus', () => {
      loadQuickStartCourses();
      loadQuickStartPlayers();
    });
    return unsubscribe;
  }, [loadQuickStartCourses, loadQuickStartPlayers, navigation]);

  // Unread-notification badge — refreshes whenever the screen regains focus.
  useEffect(() => {
    const refresh = () => {
      unreadCount().then(setUnreadNotifs).catch(() => {});
    };
    refresh();
    const unsubFocus = navigation.addListener('focus', refresh);
    return unsubFocus;
  }, [navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', reload);
    const unsubStore = subscribeTournamentChanges(() => {
      if (shouldHandleStoreChange(navigation)) reload();
    });
    // Re-pull when the device comes back online so the orange "Sin
    // conexión" banner clears on its own without forcing the user to
    // navigate or pull-to-refresh. The first event fires the current
    // state — ignore it so we don't double-load on mount (`focus`
    // already triggers the initial reload).
    let seenFirstConnEvent = false;
    const unsubConn = subscribeConnectivity((online) => {
      if (!seenFirstConnEvent) { seenFirstConnEvent = true; return; }
      if (online) reload();
    });
    return () => { unsubscribe(); unsubStore(); unsubConn(); };
  }, [navigation, reload]);

  // Home owns the realtime channel's lifetime — torn down on unmount so a
  // signed-out/backgrounded Home doesn't leave a stale subscription open.
  useEffect(() => () => stopRealtime(), []);

  // Web deep-link: if the URL has ?invite=CODE, auto-open the Join screen
  // with the code pre-filled once the user is signed in. Strip the param
  // from the URL afterwards so a refresh doesn't re-trigger.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('invite');
    if (!code) return;
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.toString());
    navigation.navigate('JoinTournament', { code: code.toUpperCase() });
  }, [navigation]);

  // Keep the round pager pinned to the round play is actually on:
  // whenever `currentRound` advances (e.g. the user started the next
  // round from another screen), snap to the smart default. This also
  // covers the initial Tournament mount where selectedRound is briefly
  // 0 before the tournament has loaded.
  useEffect(() => {
    if (tournament) {
      // Play advanced to a new round — the user's previous manual pick is
      // stale, so let the pager (and future reloads) follow play again.
      userPickedRoundRef.current = false;
      setSelectedRound(chooseInitialRound(tournament));
    }
    // Intentionally only re-run when currentRound advances; editing a
    // scorecard doesn't force the pager off the user's manual choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.currentRound]);

  // Auto-push Tournament once on the first Home mount, but only if a round
  // is actually in progress (some scores entered, not all holes complete).
  // If the user's active tournament is finished or not yet started, stay
  // on the list so they can pick what to do next. Back gesture / browser
  // back still pops us here.
  useEffect(() => {
    if (viewMode !== 'list') return;
    if (hasAutoOpenedRef.current) return;
    if (!tournament) return;
    // Background subscription updates can fire this effect while the user
    // is on a deeper screen (e.g. Scorecard). Auto-pushing then pops the
    // user out of their current screen — symptom: the first score on a
    // fresh round bounced you back to the tournament page.
    if (!navigation.isFocused()) return;
    const round = tournament.rounds?.[tournament.currentRound];
    const players = tournament.players ?? [];
    if (!round || !players.length) return;
    const holeCount = round.holes?.length ?? 18;
    const expected = players.length * holeCount;
    let entered = 0;
    for (const p of players) {
      const ps = round.scores?.[p.id];
      if (ps) entered += Object.keys(ps).length;
    }
    const inProgress = entered > 0 && entered < expected;
    if (!inProgress) return;
    hasAutoOpenedRef.current = true;
    navigation.navigate('Tournament');
  }, [viewMode, tournament, navigation]);

  useEffect(() => {
    if (viewMode !== 'tournament') return;
    if (routeTournamentId) return;
    if (loading || tournament || reloadError) return;
    navigation.navigate('Main', { screen: 'Home', params: { viewMode: 'list' } });
  }, [viewMode, routeTournamentId, loading, tournament, reloadError, navigation]);

  // Keep round pager in sync with selectedRound (tab taps, arrow buttons).
  // Skip while the user is dragging, and skip if this commit came from a
  // scroll (the pager is already at the right place). Animate so taps
  // slide smoothly instead of snapping.
  useEffect(() => {
    if (selectedRoundFromScroll.current) {
      selectedRoundFromScroll.current = false;
      return;
    }
    if (!roundPagerRef.current || roundPagerWidth <= 0) return;
    if (isUserScrollingRound.current) return;
    const target = selectedRound * roundPagerWidth;
    if (Math.abs(roundScrollOffset.current - target) < 1) return;
    // Suppress onScroll commits while the animation runs, so intermediate
    // offsets don't reset selectedRound and make the pager fight itself.
    suppressRoundOnScroll.current = true;
    clearTimeout(suppressRoundTimer.current);
    suppressRoundTimer.current = setTimeout(() => {
      suppressRoundOnScroll.current = false;
    }, 450);
    roundPagerRef.current.scrollTo({ x: target, animated: roundPagerInitialized.current });
    roundScrollOffset.current = target;
    roundPagerInitialized.current = true;
  }, [selectedRound, roundPagerWidth]);

  async function resetCurrentRound() {
    if (!tournament) return;
    const idx = selectedRound;
    const confirmed = await confirm({
      title: 'Reset Round',
      message: `Reset Round ${idx + 1}? Scores and notes will be cleared.`,
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!confirmed) return;

    const roundBefore = tournament.rounds[idx];
    const prevScores = roundBefore?.scores ?? {};
    const prevNotes = roundBefore?.notes ?? {};
    // Notes are an object { round, hole: { [n]: text } }; treat the round as
    // having note content if the round-level note or any hole note is set.
    const hasNoteContent = typeof prevNotes === 'string'
      ? prevNotes.trim().length > 0
      : [prevNotes.round, ...Object.values(prevNotes.hole ?? {})]
          .some((t) => typeof t === 'string' && t.trim().length > 0);
    const hasContent = Object.keys(prevScores).length > 0 || hasNoteContent;
    const snapshot = { scores: prevScores, notes: prevNotes, at: new Date().toISOString() };

    const history = [...(roundBefore?.resetHistory ?? [])];
    if (hasContent) {
      history.push(snapshot);
      // Cap to last 10 entries to avoid unbounded growth
      if (history.length > 10) history.splice(0, history.length - 10);
    }
    await mutate(tournament, {
      type: 'round.resetContent', roundId: roundBefore.id, scores: {}, notes: {}, resetHistory: history,
    });
    await reload();

    if (hasContent) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoSnack({ roundIndex: idx, snapshot });
      undoTimerRef.current = setTimeout(() => setUndoSnack(null), 3000);
    }
  }

  async function performUndoReset() {
    if (!undoSnack || !tournament) return;
    const { roundIndex, snapshot } = undoSnack;
    if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
    const round = tournament.rounds[roundIndex];
    // Pop the entry we just pushed (the snapshot we're restoring)
    const history = [...(round?.resetHistory ?? [])];
    if (history.length > 0 && history[history.length - 1].at === snapshot.at) history.pop();
    await mutate(tournament, {
      type: 'round.resetContent',
      roundId: round.id,
      scores: snapshot.scores ?? {},
      notes: snapshot.notes ?? {},
      resetHistory: history,
    });
    await reload();
    setUndoSnack(null);
  }

  async function restoreFromHistory(entryIndex) {
    if (!tournament) return;
    const idx = selectedRound;
    const round = tournament.rounds[idx];
    const entry = round?.resetHistory?.[entryIndex];
    if (!entry) return;
    const confirmed = await confirm({
      title: 'Restore snapshot',
      message: 'Restore this snapshot? Current scores for this round will be overwritten.',
      confirmLabel: 'Restore',
    });
    if (!confirmed) return;
    await mutate(tournament, {
      type: 'round.resetContent',
      roundId: round.id,
      scores: entry.scores ?? {},
      notes: entry.notes ?? {},
      resetHistory: round.resetHistory ?? [],
    });
    await reload();
    setShowResetHistory(false);
  }

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  async function selectTournament(id) {
    await setActiveTournament(id);
    const all = await loadAllTournaments();
    const t = all.find((x) => x.id === id) ?? null;
    setTournament(t);
    navigation.navigate('Tournament');
  }

  // Deep link from an "added to a game" notification — open that game.
  // selectTournament is intentionally omitted from deps: it is recreated each
  // render, and the effect should run only when the param changes.
  useEffect(() => {
    const id = route.params?.openTournamentId;
    if (id) selectTournament(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openTournamentId]);

  async function goToList() {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Main', { screen: 'Home', params: { viewMode: 'list' } });
    }
  }

  function showError(message, title = 'Error') {
    if (Platform.OS === 'web') window.alert(message);
    else Alert.alert(title, message);
  }

  function currentOrigin() {
    return Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : '';
  }

  async function resolveQuickStartTees(course, players) {
    const lastTeeEntries = await Promise.all(players.map(async (player) => {
      if (!course?.id || !player?.id) return [player?.id, null];
      try {
        return [player.id, await lastTeeForPlayerOnCourse(course.id, player.id)];
      } catch (_) {
        return [player.id, null];
      }
    }));
    const lastTeeByPlayer = Object.fromEntries(
      lastTeeEntries.filter(([playerId]) => playerId),
    );
    return resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId,
      lastTeeByPlayer,
    });
  }

  function quickStartPlayersWithFallback(players) {
    const selectedPlayers = Array.isArray(players) ? players.filter(Boolean) : [];
    if (selectedPlayers.length > 0) return selectedPlayers;
    const me = quickStartPlayers.find((p) => p?.user_id === currentUserId || p?.userId === currentUserId);
    return me ? [me] : [];
  }

  const navigateToCreatedGame = useCallback(() => {
    const targetNavigation = navigation.getState?.().routeNames?.includes('Tournament')
      ? navigation
      : navigation.getParent?.() ?? navigation;
    targetNavigation.dispatch((state) => {
      const index = state.index ?? state.routes.length - 1;
      const baseRoutes = state.routes.slice(0, index + 1);
      const routes = [
        ...baseRoutes,
        { name: 'Tournament' },
        { name: 'Scorecard', params: { roundIndex: 0 } },
      ];
      return CommonActions.reset({ ...state, routes, index: routes.length - 1 });
    });
  }, [navigation]);

  function closePostCreateInvite() {
    const created = postCreateInvite.tournament;
    setPostCreateInvite({
      visible: false,
      loading: false,
      link: '',
      error: '',
      tournament: null,
    });
    if (created) navigateToCreatedGame();
  }

  function requestClosePostCreateInvite() {
    if (postCreateInvite.loading) return;
    closePostCreateInvite();
  }

  async function sharePostCreateInvite() {
    if (!postCreateInvite.link) return;
    try {
      const label = postCreateInvite.tournament?.name ?? 'my game';
      await Share.share({
        message: `Join "${label}" on Golf Partner:\n${postCreateInvite.link}`,
      });
    } catch (err) {
      showError(err?.message ?? 'Could not share the invite link');
    }
  }

  async function handleQuickStartStart({ course, players }) {
    if (quickStartStartingRef.current) return;
    if (!course) {
      showError('Choose a course before starting.');
      return;
    }
    const selectedPlayers = Array.isArray(players) ? players.filter(Boolean) : [];
    if (selectedPlayers.length === 0) {
      showError('Select at least 1 player.');
      return;
    }
    quickStartStartingRef.current = true;
    setQuickStartStarting(true);
    try {
      const playerTees = await resolveQuickStartTees(course, selectedPlayers);
      const created = buildQuickStartTournamentDraft({
        course,
        players: selectedPlayers,
        playerTees,
        settings: DEFAULT_SETTINGS,
        userId: currentUserId,
      });
      await mutate(created, { type: 'tournament.create', tournament: created });
      setTournament(created);
      lastLoadedTournamentIdRef.current = created.id;
      userPickedRoundRef.current = false;
      setSelectedRound(0);
      setAllTournaments((prev) => [
        created,
        ...prev.filter((item) => item.id !== created.id),
      ]);
      setOpenableIds((prev) => {
        if (!prev) return prev;
        const next = new Set(prev);
        next.add(created.id);
        return next;
      });
      setListStale(false);

      if (shouldOfferPostCreateEditorInvite('game', selectedPlayers, currentUserId)) {
        setPostCreateInvite({
          visible: true,
          loading: true,
          link: '',
          error: '',
          tournament: created,
        });
        try {
          const { editorCode } = await generateInviteCode(created.id);
          setPostCreateInvite({
            visible: true,
            loading: false,
            link: buildJoinLink(currentOrigin(), editorCode),
            error: '',
            tournament: created,
          });
        } catch (inviteErr) {
          setPostCreateInvite({
            visible: true,
            loading: false,
            link: '',
            error: inviteErr?.message ?? 'Could not create the invite link right now.',
            tournament: created,
          });
        }
        return;
      }

      navigateToCreatedGame();
    } catch (err) {
      showError(err?.message ?? 'Could not create game');
    } finally {
      quickStartStartingRef.current = false;
      setQuickStartStarting(false);
    }
  }

  async function handleQuickStartEditDetails({ course, players }) {
    if (!course) {
      showError('Choose a course before editing details.');
      return;
    }
    try {
      const selectedPlayers = quickStartPlayersWithFallback(players);
      const playerTees = await resolveQuickStartTees(course, selectedPlayers);
      const round = buildQuickStartRound({ course, players: selectedPlayers, playerTees });
      navigation.navigate('Setup', {
        kind: 'game',
        initialStep: 'tees',
        prefill: {
          players: selectedPlayers,
          rounds: [round],
          settings: DEFAULT_SETTINGS,
        },
      });
    } catch (err) {
      showError(err?.message ?? 'Could not prepare game details');
    }
  }

  async function confirmDelete(t) {
    const confirmed = await confirm({
      title: `Delete ${tournamentNounCapitalized(t)}`,
      message: `Delete "${t.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteTournament(t.id);
      const listResult = await loadAllTournamentsWithFallback();
      setAllTournaments(listResult.list);
      setListStale(listResult.stale);
      setOpenableIds(listResult.openableIds);
      setTournament(null);
      // Leave the pushed Tournament screen after deleting. viewMode can be
      // 'auto' here (post-create resets push { name: 'Tournament' } without
      // params), so key off the route name — an 'auto' route left in place
      // would render the home list without the tab bar.
      if (route?.name === 'Tournament') {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('Main', { screen: 'Home', params: { viewMode: 'list' } });
      }
    } catch (err) {
      if (Platform.OS === 'web') window.alert(err.message ?? `Could not delete ${tournamentNoun(t)}`);
      else Alert.alert('Error', err.message ?? `Could not delete ${tournamentNoun(t)}`);
    }
  }

  // Persist a per-round scoring-mode override from the Round N sheet's
  // "Scoring Mode" item. Rebuilds that round's pairs for the new mode (same
  // approach as the tournament-wide picker) and dispatches the dedicated
  // round.setScoringMode mutation rather than a whole-tournament write — this
  // is a single round's override, not a tournament-wide reset.
  async function saveRoundScoringMode(key) {
    if (!tournament) return;
    const r = tournament.rounds?.[selectedRound];
    if (!r) return;
    try {
      const pairs = buildTeamsForMode(key, tournament.players);
      await mutate(tournament, {
        type: 'round.setScoringMode', roundId: r.id, scoringMode: key, pairs,
      });
      await reload();
      setShowRoundModeSheet(false);
    } catch (err) {
      const msg = err?.message ?? 'Could not update scoring mode';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  // Persist the selected round's best/worst point values (round override).
  async function savePointValues() {
    const r = tournament?.rounds?.[selectedRound];
    if (!r || !pointValuesDraft) return;
    try {
      await mutate(tournament, {
        type: 'round.setBestBallValues',
        roundId: r.id,
        bestBallValue: parseInt(pointValuesDraft.bestBallValue, 10) || 1,
        worstBallValue: parseInt(pointValuesDraft.worstBallValue, 10) || 1,
      });
      await reload();
      setShowPointValues(false);
    } catch (err) {
      const msg = err?.message ?? 'Could not update point values';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  // Persist the gear sheet's team toggles. Tournament-wide by design —
  // fixedTeams/manualTeams shape how EVERY round builds its pairs. No eager
  // pair rebuilds: pairsForNextRound applies fixedTeams lazily at reveal.
  async function saveTeamSettings(next) {
    if (!tournament) return;
    try {
      await mutate(tournament, {
        type: 'tournament.setTeamSettings',
        fixedTeams: Boolean(next.fixedTeams),
        manualTeams: Boolean(next.manualTeams),
      });
      await reload();
    } catch (err) {
      const msg = err?.message ?? 'Could not update team settings';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  // Archive or reopen the active tournament. Marking finished moves it off
  // the Home list onto the Finished screen; reopening clears the flag.
  async function setTournamentFinished(t, finished) {
    if (!t) return;
    try {
      const updated = await mutate(t, {
        type: 'tournament.setFinished',
        finishedAt: finished ? new Date().toISOString() : null,
      });
      setTournament(updated);
      if (finished) {
        if (viewMode === 'tournament' && navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('Main', { screen: 'Home', params: { viewMode: 'list' } });
      }
    } catch (err) {
      const msg = err?.message ?? 'Could not update tournament';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  const s = useMemo(() => makeStyles(theme), [theme]);
  const leaderboardRef = useRef();

  async function handleInvite() {
    if (!tournament) return;
    setInviteLoading(true);
    setShowInvite(true);
    try {
      const { editorCode, viewerCode } = await generateInviteCode(tournament.id);
      setInviteCodes({ editor: editorCode, viewer: viewerCode });
    } catch (err) {
      setShowInvite(false);
      Alert.alert('Error', err.message);
    } finally {
      setInviteLoading(false);
    }
  }

  // The editor and viewer codes are distinct and fixed; switching role just
  // shows the matching code — no server round-trip, nothing to mutate.
  function changeInviteRole(next) {
    setInviteRoleState(next);
  }
  const inviteCode = inviteCodes[inviteRoleState] ?? '';

  // Hoist memoised derivations above the early returns so the hook order
  // stays stable across showList / showTournament toggles.
  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(tournament?.settings ?? {}) }),
    [tournament?.settings],
  );
  // Sync toggle to tournament's scoring mode when it loads/changes.
  useEffect(() => {
    setLeaderboardAlt(false);
  }, [tournament?.id, settings.scoringMode]);
  const matchPlayStandings = useMemo(
    () => (tournament && settings.scoringMode === 'matchplay'
      ? tournamentMatchPlayStandings(tournament)
      : null),
    [tournament, settings.scoringMode],
  );
  const selectedRoundData = tournament?.rounds?.[selectedRound] ?? null;
  // The mode that decides whether team settings apply: the first round whose
  // effective mode is a team mode the roster supports. Null → no team rounds,
  // the gear hides Team Settings entirely.
  const teamSettingsMode = tournament
    ? ((tournament.rounds ?? [])
        .map((r) => roundScoringMode(tournament, r))
        .find((m) => scoringModeUsesTeams(m, tournament.players.length)) ?? null)
    : null;
  // Hoisted above the early returns (used by resolvedBoard/displayedBoard
  // below as well as the render further down).
  const isGame = tournament?.kind === 'game';
  // Native mode board for the current scope (selected round, or whole
  // tournament). Casual games are always round-scoped (there's only one).
  const resolvedBoard = useMemo(() => {
    if (!tournament) return { mode: 'stableford', unit: 'pts', entries: [] };
    if (isGame || !leaderboardOverall) {
      return roundLeaderboard(tournament, selectedRoundData);
    }
    return tournamentLeaderboardResolved(tournament);
  }, [tournament, isGame, leaderboardOverall, selectedRoundData]);
  // Stroke-play alt-view: a Stableford board for the current scope, sorted by
  // gross strokes ascending (unplayed last). Preserves the existing toggle,
  // now scope-aware.
  const displayedBoard = useMemo(() => {
    if (!leaderboardAlt) {
      return { ...resolvedBoard, comparator: comparatorForBoardMode(resolvedBoard.mode) };
    }
    const sb = (isGame || !leaderboardOverall)
      ? roundLeaderboard(tournament, { ...selectedRoundData, scoringMode: 'stableford' })
      : { mode: 'stableford', unit: 'pts', entries: tournamentStablefordLeaderboard(tournament) };
    // Only a true "Stroke Play" alt view (stableford/individual/scramble
    // modes) re-sorts by gross strokes. For other modes (matchplay,
    // sindicato, bestball, pairsmatchplay) the toggle's alt view is the
    // Stableford board itself, shown in its native points order.
    if (!isStrokePlayAlt(resolvedBoard.mode)) {
      return { ...sb, comparator: comparatorForBoardMode(sb.mode) };
    }
    // Ties in this view are defined by gross strokes alone (the order it's
    // actually sorted by here), not by points — keep the comparator in sync
    // with the sort below so assignPlacements' tie definition matches.
    const strokesComparator = (a, b) =>
      (a.strokes > 0 ? a.strokes : Infinity) - (b.strokes > 0 ? b.strokes : Infinity);
    const entries = [...sb.entries].sort(strokesComparator);
    return { ...sb, entries, comparator: strokesComparator };
  }, [leaderboardAlt, resolvedBoard, isGame, leaderboardOverall, selectedRoundData, tournament]);
  // Tie-aware competition ranking (1,2,2,4) for the board currently on
  // screen, using the SAME comparator the board above was sorted with, so
  // players who compare equal (e.g. same points AND strokes) share a place
  // and are rendered as "T{n}" with a shared medal color instead of getting
  // distinct array-index ranks that imply an order the data doesn't have.
  const rankedLeaderboardEntries = useMemo(
    () => assignPlacements(displayedBoard.entries, displayedBoard.comparator),
    [displayedBoard],
  );
  const tournamentMode = settings.scoringMode === 'bestball' ? 'bestball'
    : settings.scoringMode === 'sindicato' ? 'sindicato'
    : settings.scoringMode === 'matchplay' ? 'matchplay'
    : 'stableford';
  const tournamentClinchedId = useMemo(
    // Mixed-mode tournaments rank by the cross-mode Stableford total board —
    // none of the single-mode clinch formulas apply, so skip clinch entirely.
    () => (tournament && !tournamentHasMixedModes(tournament)
      ? tournamentPlayerClinched(tournament, tournamentMode) : null),
    [tournament, tournamentMode],
  );

  // Stable callbacks for the memoised round pager pages. Keep references
  // stable across swipes so <RoundPage /> memoisation holds.
  const goToRound = useCallback((i) => {
    userPickedRoundRef.current = true;
    setSelectedRound(i);
  }, []);
  // Opens the per-round (•••) sheet. Multi-round only — single-round
  // tournaments collapse "round" and "tournament" into one thing, so they
  // use just the header gear (Tournament Settings) as the single entry point.
  const openRoundEdit = useCallback((i) => {
    userPickedRoundRef.current = true;
    setSelectedRound(i);
    setShowRoundEdit(true);
  }, []);

  // Edit/Reveal Teams menu item — shared by the round-options sheet and the
  // tournament-settings sheet so the two stay in lockstep. Returns null for
  // individual / match-play modes, where every "pair" is a single player and
  // there is nothing to team up. `onClose` dismisses the host sheet.
  function renderTeamsMenuItem(onClose) {
    const r = tournament.rounds[selectedRound];
    // Teams exist only in a team scoring mode that the current roster can
    // actually support — so an unknown/legacy mode, or a game stuck on a
    // team mode with too few players, never wrongly shows team UI. Reads the
    // ROUND's effective mode (it may override the tournament default).
    if (!scoringModeUsesTeams(roundScoringMode(tournament, r), tournament.players.length)) return null;
    const alreadyRevealed = r?.revealed || selectedRound <= tournament.currentRound;
    // Editing pairs only makes sense for the standard two-team split. Modes
    // like scramble4 can produce a single team (everyone on one team), and
    // EditTeamsScreen only initializes when there are exactly two pairs —
    // with any other shape it renders null (a blank screen). Since there's
    // nothing to edit for a single team anyway, just hide the entry point.
    if (alreadyRevealed && r?.pairs?.length !== 2) return null;
    return alreadyRevealed ? (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => { onClose(); navigation.navigate('EditTeams', { roundIndex: selectedRound, tournamentId: tournament.id }); }}
        activeOpacity={0.7}
      >
        <Feather name="users" size={14} color={theme.text.primary} />
        <Text style={s.menuItemText}>Edit Teams</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    ) : (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => { onClose(); navigation.navigate('NextRound', { revealOnly: true, roundIndex: selectedRound }); }}
        activeOpacity={0.7}
      >
        <Feather name="eye" size={14} color={theme.text.primary} />
        <Text style={s.menuItemText}>Reveal Teams</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }

  // Point values are only meaningful for a Best Ball round. Rendered in the
  // per-round sheet (multi-round) and the gear sheet (single-round).
  function renderPointValuesMenuItem(onClose) {
    const r = tournament.rounds[selectedRound];
    if (isViewer || roundScoringMode(tournament, r) !== 'bestball') return null;
    const vals = roundBestBallValues(tournament, r);
    return (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => {
          onClose();
          setPointValuesDraft({
            bestBallValue: String(vals.bestBallValue),
            worstBallValue: String(vals.worstBallValue),
          });
          setShowPointValues(true);
        }}
        activeOpacity={0.7}
      >
        <Feather name="hash" size={14} color={theme.text.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.menuItemText}>Point Values</Text>
          <Text style={s.modalSubtle}>{`Best ${vals.bestBallValue} · Worst ${vals.worstBallValue} pts / hole`}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }

  // Restore-scores + Reset-Round items for the selected round. Shared by the
  // per-round sheet (multi-round) and the single settings sheet (single-
  // round, where the two menus are merged). `onClose` dismisses the host.
  function renderRoundActions(onClose) {
    const historyCount = tournament.rounds[selectedRound]?.resetHistory?.length ?? 0;
    return (
      <>
        {historyCount > 0 && (
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { onClose(); setShowResetHistory(true); }}
            activeOpacity={0.7}
          >
            <Feather name="rotate-cw" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>Restore previous scores ({historyCount})</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.menuItem, s.menuItemDestructive]}
          onPress={() => { onClose(); resetCurrentRound(); }}
          activeOpacity={0.7}
        >
          <Feather name="rotate-ccw" size={14} color={theme.destructive} />
          <Text style={[s.menuItemText, { color: theme.destructive }]}>Reset Round</Text>
        </TouchableOpacity>
      </>
    );
  }

  const showList = viewMode === 'list' || (viewMode === 'auto' && !tournament);
  const showTournament = viewMode === 'tournament' || (viewMode === 'auto' && !!tournament);
  const isViewer = tournament?._role === 'viewer';
  const isOwner = tournament?._role === 'owner';

  // Quiet themed hold while a reload is in flight AND there's no data to
  // render yet — covers initial mount (cold open) and re-focus cases where
  // the cached state would otherwise flash an empty page (e.g. after
  // deletion). Deliberately NOT the green LoadingSplash: by the time this
  // screen mounts the tab bar is already visible, and replaying the brand
  // splash inside the app shell reads as a second boot. When data IS
  // already present, skip the hold so quick navigations don't blink.
  const wouldRenderEmpty =
    (showTournament && !tournament) ||
    (showList && allTournaments.length === 0);
  if (loading && wouldRenderEmpty) {
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (showList) {
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Golf Partner</Text>
          </View>
          <View style={s.headerActions}>
            <IconButton
              icon="menu"
              onPress={() => setShowListMenu(true)}
              accessibilityLabel="Menu"
            />
            <IconButton
              icon="bell"
              onPress={() => navigation.navigate('Notifications')}
              dot={unreadNotifs > 0}
              dotColor={theme.accent.danger ?? '#e5484d'}
              accessibilityLabel={unreadNotifs > 0 ? `Notifications, ${unreadNotifs} unread` : 'Notifications'}
            />
          </View>
        </View>

        <PullToRefresh
          style={s.scrollView}
          contentContainerStyle={s.content}
          refreshing={refreshing}
          onRefresh={onRefresh}
        >
        {needsGender && (
          <TouchableOpacity
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Complete your profile"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12,
                     borderWidth: 1, borderColor: theme.accent.primary + '55',
                     backgroundColor: theme.accent.light, padding: 12, marginBottom: 12 }}
          >
            <Feather name="user" size={16} color={theme.accent.primary} />
            <Text style={{ fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 13, flex: 1 }}>
              Complete your profile — set your gender so handicaps use the right tee rating.
            </Text>
            <Feather name="chevron-right" size={16} color={theme.accent.primary} />
          </TouchableOpacity>
        )}
        <LiveRoundCard onOpen={() => navigation.navigate('Scorecard')} />
        <Text style={s.startHeading}>Start playing</Text>
        <View style={s.startTilesRow}>
          <PressableScale
            style={[s.startTile, s.startTileFeatured]}
            onPress={() => navigation.navigate('Setup', { kind: 'game' })}
            activeScale={0.97}
          >
            <View style={[s.startTileIconWrap, s.startTileIconWrapFeatured]}>
              <Feather name="flag" size={24} color={theme.text.inverse} />
            </View>
            <View>
              <Text style={[s.startTileTitle, s.startTileTitleFeatured]}>Game</Text>
              <Text style={[s.startTileSub, s.startTileSubFeatured]}>Single round</Text>
            </View>
            <View style={[s.startTileCta, s.startTileCtaFeatured]}>
              <Feather name="plus" size={14} color={theme.text.inverse} />
              <Text style={[s.startTileCtaText, { color: theme.text.inverse }]}>New game</Text>
            </View>
          </PressableScale>
          <PressableScale
            style={s.startTile}
            onPress={() => setShowTournamentKindChoice(true)}
            activeScale={0.97}
          >
            <View style={s.startTileIconWrap}>
              <Feather name="award" size={24} color={theme.accent.primary} />
            </View>
            <View>
              <Text style={s.startTileTitle}>Tournament</Text>
              <Text style={s.startTileSub}>Multi-day event</Text>
            </View>
            <View style={s.startTileCta}>
              <Feather name="plus" size={14} color={theme.accent.primary} />
              <Text style={s.startTileCtaText}>New tournament</Text>
            </View>
          </PressableScale>
        </View>

        <TouchableOpacity
          style={s.joinTile}
          onPress={() => navigation.navigate('JoinTournament')}
          activeOpacity={0.85}
        >
          <View style={s.joinTileIconWrap}>
            <Feather name="link" size={20} color={theme.accent.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.joinTileTitle}>Join with code</Text>
            <Text style={s.joinTileSub}>Enter an invite code from a friend</Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>

        <QuickStartCourses
          courses={quickStartCourses}
          coursesLoading={quickStartCoursesLoading}
          players={quickStartPlayers}
          currentUserId={currentUserId}
          playersLoading={quickStartPlayersLoading}
          playersError={quickStartPlayersError}
          starting={quickStartStarting}
          onManage={() => navigation.navigate('CoursesLibrary')}
          onRetryPlayers={loadQuickStartPlayers}
          onStart={handleQuickStartStart}
          onEditDetails={handleQuickStartEditDetails}
        />

        {reloadError && (
          <View style={s.errorCard}>
            <Feather name="alert-triangle" size={14} color={theme.destructive} />
            <View style={{ flex: 1 }}>
              <Text style={s.errorCardTitle}>Couldn't load</Text>
              <Text style={s.errorCardText}>{reloadError}</Text>
            </View>
            <TouchableOpacity style={s.errorRetryBtn} onPress={reload} activeOpacity={0.8}>
              <Feather name="refresh-cw" size={14} color={theme.accent.primary} />
              <Text style={s.errorRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {listStale && allTournaments.length > 0 && (
          <View style={s.staleBanner}>
            <Feather name="cloud-off" size={14} color="#c77a0a" />
            <Text style={s.staleBannerText}>Offline · showing last saved list</Text>
          </View>
        )}

        {(() => {
          const renderCard = (t) => {
            const openable = !openableIds || openableIds.has(t.id);
            const rounds = t.rounds ?? [];
            const players = t.players ?? [];
            const isGameKind = t.kind === 'game';
            const played = rounds.filter((r) => isRoundComplete(r, players)).length;
            const totalRounds = rounds.length;
            const isActive = totalRounds > 0 && played < totalRounds;
            const courseName = isGameKind ? (rounds[0]?.courseName ?? '') : null;
            const metaText = players.length > 0
              ? players.map((p) => p.name.split(' ')[0]).join(' · ')
              : '';
            return (
              <View key={t.id} style={s.tournamentCardWrapper}>
                <TouchableOpacity
                  style={[s.tournamentCard, !openable && s.tournamentCardDisabled]}
                  onPress={() => {
                    if (!openable) return;
                    // Official tournaments use a separate data model and
                    // dedicated screens — the casual detail view can't render
                    // them, so route straight to the management screen.
                    if (t.kind === 'official') {
                      navigation.navigate('OfficialSetup', { tournamentId: t.id });
                    } else {
                      selectTournament(t.id);
                    }
                  }}
                  disabled={!openable}
                  activeOpacity={openable ? 0.7 : 1}
                >
                  <View style={s.tournamentCardLeft}>
                    <View style={s.tournamentCardHeader}>
                      <Text style={s.tournamentCardName}>{t.name}</Text>
                      {totalRounds > 0 && (
                        <View style={[s.statusBadge, !isActive && s.statusBadgeFinished]}>
                          <Text style={[s.statusBadgeText, !isActive && s.statusBadgeTextFinished]}>
                            {isActive ? 'Active' : 'Finished'}
                          </Text>
                        </View>
                      )}
                      {t._role === 'viewer' && (
                        <View style={s.viewerBadge}>
                          <Feather name="eye" size={9} color={theme.text.muted} />
                          <Text style={s.viewerBadgeText}>Viewer</Text>
                        </View>
                      )}
                    </View>
                    {metaText ? <Text style={s.tournamentCardMeta}>{metaText}</Text> : null}
                    {totalRounds > 0 && (
                      <Text style={s.tournamentCardRound}>
                        {isGameKind ? (courseName || 'Single round') : `Round ${played}/${totalRounds}`}
                      </Text>
                    )}
                  </View>
                  <View style={s.tournamentCardRight}>
                    {!openable ? (
                      <View style={s.offlineBadge}>
                        <Feather name="cloud-off" size={14} color="#c77a0a" />
                        <Text style={s.offlineBadgeText}>Connection required</Text>
                      </View>
                    ) : (
                      <Feather name="chevron-right" size={18} color={theme.text.muted} />
                    )}
                  </View>
                </TouchableOpacity>
                {openable && t._role === 'owner' && (
                  <IconButton
                    icon="trash-2"
                    color={theme.destructive}
                    onPress={() => confirmDelete(t)}
                    accessibilityLabel="Delete"
                    style={s.deleteCardBtn}
                  />
                )}
              </View>
            );
          };
          // Newest first by creation time — official tournament ids are UUID
          // strings, so an id subtraction would produce NaN ordering.
          const sorted = allTournaments.slice().sort(
            (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0),
          );
          // Finished games/tournaments live on a dedicated screen — keep the
          // Home list focused on what's still in play.
          const active = sorted.filter((t) => !isTournamentFinished(t));
          // Finished games/tournaments live entirely on the History tab —
          // the Play view stays focused on starting and resuming play.
          const games = active.filter((t) => t.kind === 'game');
          const tournaments = active.filter((t) => t.kind !== 'game');
          if (sorted.length === 0) {
            if (listStale) {
              return (
                <View style={s.staleEmpty}>
                  <Feather name="cloud-off" size={44} color={theme.text.muted} />
                  <Text style={s.staleEmptyText}>Offline · no saved tournaments yet</Text>
                </View>
              );
            }
            return (
              <View style={s.emptyState}>
                <Feather name="flag" size={44} color={theme.text.muted} />
                <Text style={s.emptyTitle}>Nothing here yet</Text>
                <Text style={s.emptySubtitle}>Create your first game or tournament to start playing</Text>
              </View>
            );
          }
          if (active.length === 0) {
            return (
              <View style={s.emptyState}>
                <Feather name="check-circle" size={44} color={theme.text.muted} />
                <Text style={s.emptyTitle}>All caught up</Text>
                <Text style={s.emptySubtitle}>Every game and tournament is finished. Start a new one above.</Text>
              </View>
            );
          }
          return (
            <>
              {games.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>GAMES</Text>
                  {games.map(renderCard)}
                </>
              )}
              {tournaments.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>TOURNAMENTS</Text>
                  {tournaments.map(renderCard)}
                </>
              )}
            </>
          );
        })()}
        </PullToRefresh>

        <BottomSheet visible={showListMenu} onClose={() => setShowListMenu(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Menu</Text>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowListMenu(false); navigation.navigate('CoursesLibrary'); }}
            activeOpacity={0.7}
          >
            <Feather name="map" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>Courses</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.menuItem, { borderBottomWidth: 0 }]}
            onPress={() => { setShowListMenu(false); navigation.navigate('PlayersLibrary'); }}
            activeOpacity={0.7}
          >
            <Feather name="user" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>Players</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        </BottomSheet>

        <BottomSheet visible={showTournamentKindChoice} onClose={() => setShowTournamentKindChoice(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>New Tournament</Text>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowTournamentKindChoice(false); navigation.navigate('Setup', { kind: 'tournament' }); }}
            activeOpacity={0.7}
          >
            <Feather name="users" size={14} color={theme.text.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.menuItemText}>Casual tournament</Text>
              <Text style={s.modalSubtle}>Friends scoring a round together</Text>
            </View>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.menuItem, { borderBottomWidth: 0 }]}
            onPress={() => { setShowTournamentKindChoice(false); navigation.navigate('OfficialCreate'); }}
            activeOpacity={0.7}
          >
            <Feather name="award" size={14} color={theme.text.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.menuItemText}>Official tournament</Text>
              <Text style={s.modalSubtle}>Invite players by link; double-entered, verified scoring</Text>
            </View>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        </BottomSheet>

        <PostCreateInviteModal
          visible={postCreateInvite.visible}
          loading={postCreateInvite.loading}
          link={postCreateInvite.link}
          error={postCreateInvite.error}
          onRequestClose={requestClosePostCreateInvite}
          onShare={sharePostCreateInvite}
        />

        <ConfirmModal state={confirmState} onResult={resolveConfirm} theme={theme} s={s} />

        <TourOverlay chapter="home" steps={HOME_TOUR_STEPS} />
      </ScreenContainer>
    );
  }

  if (showTournament && !tournament) {
    return (
      <ScreenContainer style={[s.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="flag" size={44} color={theme.text.muted} />
          <Text style={[s.emptyTitle, { marginTop: 16 }]}>No active tournament</Text>
          <Text style={[s.emptySubtitle, { marginTop: 6, marginBottom: 8 }]}>
            Start a game or tournament to begin playing.
          </Text>
          <TouchableOpacity
            style={[s.primaryBtn, s.emptyStateBtn]}
            onPress={() => navigation.navigate('Setup', { kind: 'game' })}
            activeOpacity={0.8}
          >
            <Feather name="flag" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.primaryBtnText}>Start a Game</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, s.emptyStateBtn]}
            onPress={() => setShowTournamentKindChoice(true)}
            activeOpacity={0.8}
          >
            <Feather name="award" size={14} color={theme.accent.primary} />
            <Text style={s.secondaryBtnText}>Start a Tournament</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, s.emptyStateBtn]}
            onPress={goToList}
            activeOpacity={0.8}
          >
            <Feather name="home" size={14} color={theme.accent.primary} />
            <Text style={s.secondaryBtnText}>Go to Home</Text>
          </TouchableOpacity>
        </View>

        <BottomSheet visible={showTournamentKindChoice} onClose={() => setShowTournamentKindChoice(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>New Tournament</Text>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowTournamentKindChoice(false); navigation.navigate('Setup', { kind: 'tournament' }); }}
            activeOpacity={0.7}
          >
            <Feather name="users" size={14} color={theme.text.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.menuItemText}>Casual tournament</Text>
              <Text style={s.modalSubtle}>Friends scoring a round together</Text>
            </View>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.menuItem, { borderBottomWidth: 0 }]}
            onPress={() => { setShowTournamentKindChoice(false); navigation.navigate('OfficialCreate'); }}
            activeOpacity={0.7}
          >
            <Feather name="award" size={14} color={theme.text.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.menuItemText}>Official tournament</Text>
              <Text style={s.modalSubtle}>Invite players by link; double-entered, verified scoring</Text>
            </View>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        </BottomSheet>

        <TourOverlay chapter="home" steps={HOME_TOUR_STEPS} />
      </ScreenContainer>
    );
  }

  const toggleLabels = leaderboardToggleLabels(resolvedBoard.mode);

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.tournamentHeader}>
        <View style={s.headerLeft}>
          <IconButton icon="chevron-left" onPress={goToList} />
          <Text
            style={s.headerTitle}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {tournament.name}
          </Text>
        </View>
        <View style={s.headerActions}>
          {!isViewer && (
            <IconButton icon="share-2" onPress={handleInvite} />
          )}
          <IconButton
            icon="image"
            onPress={() => navigation.navigate('Gallery', { tournamentId: tournament.id })}
            accessibilityLabel="Memories"
          />
          {!appSettings.noSpoilers && (
            <IconButton
              icon={showRunning ? 'eye-off' : 'eye'}
              onPress={toggleRunning}
              accessibilityLabel={showRunning ? 'Hide running scores' : 'Show running scores'}
            />
          )}
          <IconButton
            icon="settings"
            onPress={() => setShowSettings(true)}
            accessibilityLabel="Tournament settings"
          />
        </View>
      </View>

      <PullToRefresh
        style={s.scrollView}
        contentContainerStyle={s.content}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >

      {tournament.players.length >= 2 && (
      <View style={s.mastersCard}>
        <View style={[s.cardTitleRow, { marginBottom: 8 }]}>
          <Text style={[s.mastersCardTitle, { flexShrink: 1 }]} numberOfLines={1}>
            {leaderboardOverall && !isGame ? 'OVERALL' : `R${selectedRound + 1} · ${roundModeLabel(displayedBoard.mode)}`}
          </Text>
          {resolvedBoard.entries.length > 0 && (
            <View style={s.inlineToggle}>
              <Text style={[s.mastersToggleLabel, !leaderboardAlt && s.mastersToggleLabelActive]}>{toggleLabels.left}</Text>
              <Switch
                value={leaderboardAlt}
                onValueChange={setLeaderboardAlt}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: 'rgba(255,215,0,0.4)' }}
                thumbColor="#fff"
              />
              <Text style={[s.mastersToggleLabel, leaderboardAlt && s.mastersToggleLabelActive]}>{toggleLabels.right}</Text>
            </View>
          )}
        </View>
        {!isGame && (
          <ScrollView
            testID="leaderboard-scope-chips"
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[s.mastersChipRow, { marginBottom: 12 }]}
            contentContainerStyle={{ gap: 6 }}
          >
            <TouchableOpacity
              style={[s.mastersChip, leaderboardOverall && s.mastersChipActive]}
              onPress={() => setLeaderboardOverall(true)}
              activeOpacity={0.7}
            >
              <Text style={[s.mastersChipText, leaderboardOverall && s.mastersChipTextActive]}>Overall</Text>
            </TouchableOpacity>
            {tournament.rounds.map((round, index) => (
              <TouchableOpacity
                key={round.id}
                style={[s.mastersChip, !leaderboardOverall && selectedRound === index && s.mastersChipActive]}
                onPress={() => {
                  userPickedRoundRef.current = true;
                  setLeaderboardOverall(false);
                  setSelectedRound(index);
                }}
                activeOpacity={0.7}
              >
                <Text style={[s.mastersChipText, !leaderboardOverall && selectedRound === index && s.mastersChipTextActive]}>
                  R{index + 1}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {rankedLeaderboardEntries.map((entry, i) => {
          const rankColors = [semantic.winner.dark, '#c0c8d4', '#daa06d'];
          const placeIdx = entry.place - 1;
          const isFirstPlace = entry.place === 1;
          const rankColor = rankColors[placeIdx] || 'rgba(255,255,255,0.4)';
          const rankBg = placeIdx === 0 ? 'rgba(255,215,0,0.2)' : placeIdx === 1 ? 'rgba(192,200,212,0.15)' : placeIdx === 2 ? 'rgba(218,160,109,0.15)' : 'rgba(255,255,255,0.08)';
          const rankLabel = entry.isTie ? `T${entry.place}` : entry.place;
          return (
            <View key={entry.player.id} style={[s.mastersRow, isFirstPlace && s.mastersRowFirst, i === rankedLeaderboardEntries.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[s.mastersRankBadge, { backgroundColor: rankBg }]}>
                <Text style={[s.mastersRankText, { color: rankColor }]}>{rankLabel}</Text>
              </View>
              <View style={s.mastersNameCol}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.mastersName, isFirstPlace && { fontFamily: 'PlusJakartaSans-Bold' }]} numberOfLines={1}>
                    {entry.player.name}
                  </Text>
                  {showRunning && entry.player.id === tournamentClinchedId && (
                    <Feather name="award" size={14} color={semantic.winner.dark} />
                  )}
                </View>
              </View>
              <Text style={[s.mastersPoints, isFirstPlace && { fontSize: 18 }]}>{
                !showRunning ? '—' : `${entry.points} ${displayedBoard.unit}`
              }</Text>
              {entry.strokes != null && (
                <Text style={s.mastersSub}>{!showRunning ? '' : `${entry.strokes || '-'} str`}</Text>
              )}
            </View>
          );
        })}
        {settings.scoringMode === 'matchplay' && matchPlayStandings && showRunning && !tournamentHasMixedModes(tournament) && (
          <Text style={s.mastersMatchStatus}>{matchPlayStandings.status}</Text>
        )}
      </View>
      )}

      {tournament.rounds.length > 0 && (
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <View style={s.cardTitleLeft}>
              <Text style={s.cardTitle}>ROUND SCORES</Text>
              {tournament.rounds.length === 1 && tournament.rounds[0].courseName && (
                <Text style={s.cardTitleCourse} numberOfLines={1}>
                  {' · '}{tournament.rounds[0].courseName}
                </Text>
              )}
            </View>
          </View>
          {!isGame && (
            <FlatList
              testID="round-tabs"
              horizontal
              showsHorizontalScrollIndicator={false}
              data={tournament.rounds}
              keyExtractor={(r) => r.id}
              style={s.tabBar}
              renderItem={({ item: round, index }) => (
                <TouchableOpacity
                  style={[s.tab, selectedRound === index && s.tabActive]}
                  onPress={() => {
                    userPickedRoundRef.current = true;
                    setSelectedRound(index);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.tabText, selectedRound === index && s.tabTextActive]}>
                    R{index + 1}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}

          {/* Horizontal pager — swipe to change round, stays in sync with tabs */}
          <View
            testID="round-pager-wrap"
            style={s.roundPagerWrap}
            onLayout={(e) => {
              // Don't prefill roundScrollOffset from selectedRound — on web
              // the ScrollView's contentOffset can't position before the
              // children lay out, and if we lie that we're already there the
              // sync effect below skips its scrollTo. Leave the ref at its
              // actual value (0 on first mount) so the effect corrects it.
              setRoundPagerWidth(e.nativeEvent.layout.width);
            }}
          >
            {roundPagerWidth > 0 && (isGame ? (
              <RoundPage
                round={tournament.rounds[0]}
                index={0}
                width={roundPagerWidth}
                hasPrev={false}
                hasNext={false}
                revealed
                players={tournament.players}
                meId={tournament.meId}
                theme={theme}
                s={s}
                onGoToRound={goToRound}
                isSingleRound
                showRunning={showRunning}
                scoringMode={roundScoringMode(tournament, tournament.rounds[0])}
              />
            ) : (
              <ScrollView
                testID="round-pager"
                ref={roundPagerRef}
                horizontal
                pagingEnabled={Platform.OS !== 'web'}
                style={PAGER_SNAP_TYPE_STYLE}
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onLayout={() => {
                  // Never scroll out from under the user's finger — e.g. a
                  // viewport reflow firing layout mid-swipe on web.
                  if (isUserScrollingRound.current) return;
                  // A remount (list ↔ tournament switch, or a modal-driven
                  // re-layout) resets the ScrollView's real offset to 0 on web
                  // while roundScrollOffset still holds the last position, so
                  // the sync effect thinks nothing moved. Re-assert the
                  // selected page — a no-op when already there.
                  const target = selectedRound * roundPagerWidth;
                  roundPagerRef.current?.scrollTo({ x: target, animated: false });
                  roundScrollOffset.current = target;
                }}
                onScrollBeginDrag={() => {
                  isUserScrollingRound.current = true;
                  // User gesture overrides any in-flight programmatic scroll.
                  suppressRoundOnScroll.current = false;
                  clearTimeout(suppressRoundTimer.current);
                }}
                onScroll={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  roundScrollOffset.current = x;
                  // Skip only during a programmatic scrollTo animation.
                  // Live-commit throughout the user's drag AND its momentum
                  // so the leaderboard / bubbles update during the whole
                  // swipe, not just the drag phase.
                  if (suppressRoundOnScroll.current) return;
                  const idx = Math.round(x / roundPagerWidth);
                  if (idx !== selectedRound) {
                    // Tag so the sync effect skips scrollTo — the pager is
                    // already at `idx`; a scrollTo would fight the scroll.
                    selectedRoundFromScroll.current = true;
                    userPickedRoundRef.current = true;
                    // Non-urgent: let the native scroll keep running smoothly
                    // while React reconciles leaderboard / tabs / round card.
                    startTransition(() => setSelectedRound(idx));
                  }
                }}
                // Keep isUserScrollingRound true through the momentum phase
                // so the sync effect doesn't scrollTo on top of the inertia.
                onScrollEndDrag={() => {}}
                onMomentumScrollEnd={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  roundScrollOffset.current = x;
                  isUserScrollingRound.current = false;
                  suppressRoundOnScroll.current = false;
                  clearTimeout(suppressRoundTimer.current);
                  const idx = Math.round(x / roundPagerWidth);
                  if (idx !== selectedRound) {
                    selectedRoundFromScroll.current = true;
                    userPickedRoundRef.current = true;
                    setSelectedRound(idx);
                  }
                }}
                contentOffset={{ x: selectedRound * roundPagerWidth, y: 0 }}
              >
                {tournament.rounds.map((round, i) => (
                  <RoundPage
                    key={round.id}
                    round={round}
                    index={i}
                    width={roundPagerWidth}
                    hasPrev={i > 0}
                    hasNext={i < tournament.rounds.length - 1}
                    revealed={!!round.revealed || i <= tournament.currentRound}
                    players={tournament.players}
                    meId={tournament.meId}
                    theme={theme}
                    s={s}
                    onGoToRound={goToRound}
                    onOpenEdit={isViewer ? null : openRoundEdit}
                    isSingleRound={tournament.rounds.length === 1}
                    showRunning={showRunning}
                    scoringMode={roundScoringMode(tournament, round)}
                  />
                ))}
              </ScrollView>
            ))}
          </View>
        </View>
      )}

      <View style={{ position: 'absolute', left: -9999 }}>
        <ShareableLeaderboard ref={leaderboardRef} tournamentName={tournament.name} leaderboard={displayedBoard.entries} />
      </View>
    </PullToRefresh>

    <UndoSnackbar data={undoSnack} onUndo={performUndoReset} theme={theme} s={s} />

    {tournament.rounds.length > 0 && (() => {
      const isCurrentRound = selectedRound === tournament.currentRound;
      const canShowNext = isCurrentRound && tournament.currentRound < tournament.rounds.length - 1;
      const nextRound = canShowNext ? tournament.rounds[tournament.currentRound + 1] : null;
      const nextRevealed = nextRound?.revealed;
      if (isViewer) return null;
      return (
        <View style={s.tournamentBottomBar}>
          <TouchableOpacity
            style={[s.primaryBtn, s.roundActionBtn]}
            onPress={() => navigation.navigate('Scorecard', { roundIndex: selectedRound, tournamentId: tournament.id })}
            activeOpacity={0.8}
          >
            <Feather name="edit-2" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.primaryBtnText}>{isCurrentRound ? 'Scorecard' : 'Edit Scores'}</Text>
          </TouchableOpacity>
          {canShowNext && (
            nextRevealed ? (
              <TouchableOpacity
                style={[s.secondaryBtn, s.roundActionBtn]}
                onPress={() => navigation.navigate('NextRound', { revealOnly: true, roundIndex: tournament.currentRound + 1 })}
                activeOpacity={0.7}
              >
                <Feather name="eye" size={14} color={theme.accent.primary} />
                <Text style={s.secondaryBtnText}>Next Round</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.primaryBtn, s.roundActionBtn]}
                onPress={() => navigation.navigate('NextRound')}
                activeOpacity={0.8}
              >
                <Feather name="play" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                <Text style={s.primaryBtnText}>Start Next Round</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      );
    })()}

    <BottomSheet visible={showInvite} onClose={() => setShowInvite(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Invite</Text>
          <Text style={s.inviteSubtitle}>
            {(() => {
              const noun = tournamentNoun(tournament);
              return inviteRoleState === 'editor'
                ? `Anyone with this code can enter scores for this ${noun}.`
                : `Anyone with this code can view this ${noun} (read-only).`;
            })()}
          </Text>
          {inviteLoading
            ? <ActivityIndicator color={theme.accent.primary} style={{ marginVertical: 24 }} />
            : (
              <>
                <View style={s.inviteCodeBox}>
                  <Text style={s.inviteCode}>{inviteCode}</Text>
                </View>
                {!!inviteCode && (() => {
                  // QR encodes the same payload as "Share link": the
                  // path-based join-tournament link.
                  const origin = Platform.OS === 'web' && typeof window !== 'undefined'
                    ? window.location.origin
                    : '';
                  const qrValue = buildJoinLink(origin, inviteCode);
                  return (
                    <View style={s.inviteQrBox}>
                      <View style={s.inviteQrInner}>
                        <QRCode
                          value={qrValue}
                          size={148}
                          backgroundColor="#ffffff"
                          color="#000000"
                        />
                      </View>
                      <Text style={s.inviteQrHint}>Scan to join</Text>
                    </View>
                  );
                })()}
              </>
            )}
          <View style={s.inviteRoleRow}>
            <TouchableOpacity
              style={[s.inviteRoleBtn, inviteRoleState === 'editor' && s.inviteRoleBtnActive]}
              onPress={() => changeInviteRole('editor')}
              activeOpacity={0.7}
              disabled={!inviteCode}
            >
              <Text style={[s.inviteRoleText, inviteRoleState === 'editor' && s.inviteRoleTextActive]}>
                Editor
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.inviteRoleBtn, inviteRoleState === 'viewer' && s.inviteRoleBtnActive]}
              onPress={() => changeInviteRole('viewer')}
              activeOpacity={0.7}
              disabled={!inviteCode}
            >
              <Text style={[s.inviteRoleText, inviteRoleState === 'viewer' && s.inviteRoleTextActive]}>
                Viewer
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[s.menuItem, { borderBottomWidth: 0 }]}
            onPress={() => {
              const origin = Platform.OS === 'web' && typeof window !== 'undefined'
                ? window.location.origin
                : '';
              // Blank line before the URL keeps WhatsApp from wrapping the
              // text into the middle of the link and breaking the tap target.
              const message = `Join my golf tournament 🏌️\n\n${buildJoinLink(origin, inviteCode)}`;
              Share.share({ message });
            }}
            activeOpacity={0.7}
            disabled={!inviteCode}
          >
            <Feather name="share-2" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>Share link</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
    </BottomSheet>

    <Modal statusBarTranslucent hardwareAccelerated
      visible={showRoundEdit}
      transparent
      animationType="fade"
      onRequestClose={() => setShowRoundEdit(false)}
    >
      <Pressable style={s.modalBackdrop} onPress={() => setShowRoundEdit(false)}>
        <Pressable style={s.modalSheet} onPress={() => {}}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Round {selectedRound + 1}</Text>

          {/* Per-round sheet (multi-round only). Round-scoped actions live
              here; tournament-wide settings live in the gear menu. */}
          <TouchableOpacity
            style={s.menuItem}
            onPress={() => setShowRoundModeSheet(true)}
            activeOpacity={0.7}
          >
            <Feather name="flag" size={14} color={theme.text.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.menuItemText}>Scoring Mode</Text>
              <Text style={s.modalSubtle}>
                {getScoringMode(roundScoringMode(tournament, tournament.rounds[selectedRound])).label}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
          {renderPointValuesMenuItem(() => setShowRoundEdit(false))}
          {renderTeamsMenuItem(() => setShowRoundEdit(false))}
          {renderRoundActions(() => setShowRoundEdit(false))}
        </Pressable>
      </Pressable>
    </Modal>

    <ScoringModeSheet
      visible={showRoundModeSheet}
      value={roundScoringMode(tournament, tournament.rounds?.[selectedRound])}
      playerCount={tournament.players.length}
      onSelect={saveRoundScoringMode}
      onClose={() => setShowRoundModeSheet(false)}
    />

    <Modal statusBarTranslucent hardwareAccelerated
      visible={showResetHistory}
      transparent
      animationType="fade"
      onRequestClose={() => setShowResetHistory(false)}
    >
      <Pressable style={s.modalBackdrop} onPress={() => setShowResetHistory(false)}>
        <Pressable style={s.modalSheet} onPress={() => {}}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Restore Round {selectedRound + 1}</Text>
          <Text style={s.modalSubtitle}>Pick a pre-reset snapshot to restore.</Text>
          {(tournament.rounds[selectedRound]?.resetHistory ?? [])
            .map((entry, idx) => ({ entry, idx }))
            .reverse()
            .map(({ entry, idx }) => {
              const playerCount = Object.keys(entry.scores ?? {}).length;
              const holeCount = Object.values(entry.scores ?? {})
                .reduce((max, pScores) => Math.max(max, Object.keys(pScores ?? {}).length), 0);
              const when = (() => {
                try { return new Date(entry.at).toLocaleString(); } catch { return entry.at; }
              })();
              return (
                <TouchableOpacity
                  key={entry.at ?? idx}
                  style={s.menuItem}
                  onPress={() => restoreFromHistory(idx)}
                  activeOpacity={0.7}
                >
                  <Feather name="clock" size={14} color={theme.text.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.menuItemText}>{when}</Text>
                    <Text style={s.modalSubtle}>{playerCount} players · up to hole {holeCount}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.text.muted} />
                </TouchableOpacity>
              );
            })}
        </Pressable>
      </Pressable>
    </Modal>

    <BottomSheet visible={showSettings} onClose={() => setShowSettings(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>{`${tournamentNounCapitalized(tournament)} Settings`}</Text>

          {/* Teams are round-scoped. Single-round tournaments have no separate
              per-round sheet, so teams surface here; multi-round keeps them in
              the per-round (•••) sheet instead. */}
          {!isViewer && tournament.rounds.length === 1
            && renderTeamsMenuItem(() => setShowSettings(false))}

          {tournament.players.length > 1 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); shareLeaderboard({ tournamentName: tournament.name, leaderboard: displayedBoard.entries, theme, viewRef: leaderboardRef }); }}
              activeOpacity={0.7}
            >
              <Feather name="share-2" size={14} color={theme.text.primary} />
              <Text style={s.menuItemText}>Share Leaderboard</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowSettings(false); navigation.navigate('Stats', { tournamentId: tournament.id }); }}
            activeOpacity={0.7}
          >
            <Feather name="bar-chart-2" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>Statistics</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => {
              setShowSettings(false);
              navigation.navigate('Players', {
                tournamentId: tournament.id,
                tournamentName: tournament.name,
              });
            }}
            activeOpacity={0.7}
          >
            <Feather name="users" size={14} color={theme.text.primary} />
            <Text style={s.menuItemText}>Players</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          {/* Scoring mode is round-scoped. Single-round games have no
              per-round sheet, so the round-scoped picker surfaces here;
              multi-round tournaments edit each round from its own sheet. */}
          {!isViewer && tournament.rounds.length === 1 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); setShowRoundModeSheet(true); }}
              activeOpacity={0.7}
            >
              <Feather name="flag" size={14} color={theme.text.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.menuItemText}>Scoring Mode</Text>
                <Text style={s.modalSubtle}>
                  {getScoringMode(roundScoringMode(tournament, tournament.rounds[0])).label}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {tournament.rounds.length === 1 && renderPointValuesMenuItem(() => setShowSettings(false))}

          {!isViewer && teamSettingsMode && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); setShowTeamSettings(true); }}
              activeOpacity={0.7}
            >
              <Feather name="users" size={14} color={theme.text.primary} />
              <Text style={s.menuItemText}>Team Settings</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {!isViewer && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                setShowSettings(false);
                navigation.navigate('EditTournament', {
                  tournamentId: tournament.id,
                  tournamentName: tournament.name,
                });
              }}
              activeOpacity={0.7}
            >
              <Feather name="edit-3" size={14} color={theme.text.primary} />
              <Text style={s.menuItemText}>{tournament.rounds.length === 1 ? 'Edit Round' : 'Edit Tournament'}</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {/* Round-scoped actions — single-round only, since multi-round
              tournaments expose these in the per-round (•••) sheet. */}
          {!isViewer && tournament.rounds.length === 1
            && renderRoundActions(() => setShowSettings(false))}

          {!isViewer && (() => {
            const kindLabel = tournamentNounCapitalized(tournament);
            if (tournament.finishedAt) {
              return (
                <TouchableOpacity
                  style={s.menuItem}
                  onPress={() => { setShowSettings(false); setTournamentFinished(tournament, false); }}
                  activeOpacity={0.7}
                >
                  <Feather name="rotate-ccw" size={14} color={theme.text.primary} />
                  <Text style={s.menuItemText}>Reopen {kindLabel}</Text>
                  <Feather name="chevron-right" size={16} color={theme.text.muted} />
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowSettings(false); setTournamentFinished(tournament, true); }}
                activeOpacity={0.7}
              >
                <Feather name="flag" size={14} color={theme.text.primary} />
                <Text style={s.menuItemText}>Finish {kindLabel}</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            );
          })()}

          {isOwner && (
            <TouchableOpacity
              style={[s.menuItem, s.menuItemDestructive]}
              onPress={() => { setShowSettings(false); confirmDelete(tournament); }}
              activeOpacity={0.7}
            >
              <Feather name="trash-2" size={14} color={theme.destructive} />
              <Text style={[s.menuItemText, { color: theme.destructive }]}>{`Delete ${tournamentNounCapitalized(tournament)}`}</Text>
            </TouchableOpacity>
          )}
    </BottomSheet>

    <BottomSheet visible={showTeamSettings} onClose={() => setShowTeamSettings(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Team Settings</Text>
          <TeamsSettingsFields
            value={teamSettingsMode}
            playerCount={tournament.players.length}
            settings={{
              fixedTeams: Boolean(tournament.settings?.fixedTeams),
              manualTeams: Boolean(tournament.settings?.manualTeams),
            }}
            onSettingsChange={saveTeamSettings}
          />
          {Boolean(tournament.settings?.fixedTeams) && tournament.rounds[0]?.pairs?.length === 2 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowTeamSettings(false); navigation.navigate('EditTeams', { roundIndex: 0, tournamentId: tournament.id }); }}
              activeOpacity={0.7}
            >
              <Feather name="edit-2" size={14} color={theme.text.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.menuItemText}>Edit Pairs</Text>
                <Text style={s.modalSubtle}>{pairsPreviewText(tournament)}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
    </BottomSheet>

    <BottomSheet visible={showPointValues} onClose={() => setShowPointValues(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>{`Point Values · Round ${selectedRound + 1}`}</Text>
          {pointValuesDraft && (
            <>
              <BestBallValueFields settings={pointValuesDraft} onSettingsChange={setPointValuesDraft} />
              <TouchableOpacity
                style={[s.menuItem, { borderBottomWidth: 0, justifyContent: 'center' }]}
                onPress={savePointValues}
                activeOpacity={0.7}
              >
                <Feather name="check" size={14} color={theme.text.primary} />
                <Text style={s.menuItemText}>Save</Text>
              </TouchableOpacity>
            </>
          )}
    </BottomSheet>

    <PostCreateInviteModal
      visible={postCreateInvite.visible}
      loading={postCreateInvite.loading}
      link={postCreateInvite.link}
      error={postCreateInvite.error}
      onRequestClose={requestClosePostCreateInvite}
      onShare={sharePostCreateInvite}
    />

    <ConfirmModal state={confirmState} onResult={resolveConfirm} theme={theme} s={s} />

    <TourOverlay chapter="home" steps={HOME_TOUR_STEPS} />

    </ScreenContainer>
  );
}

// Themed in-app confirmation dialog. Used in place of window.confirm so the
// web build matches the native styling; native uses it too for consistency.
function ConfirmModal({ state, onResult, theme, s }) {
  return (
    <Modal statusBarTranslucent hardwareAccelerated
      visible={!!state}
      transparent
      animationType="fade"
      onRequestClose={() => onResult(false)}
    >
      <Pressable style={s.confirmBackdrop} onPress={() => onResult(false)}>
        <Pressable style={s.confirmCard} onPress={() => {}}>
          <Text style={s.confirmTitle}>{state?.title}</Text>
          {!!state?.message && <Text style={s.confirmMessage}>{state.message}</Text>}
          <View style={s.confirmActions}>
            <TouchableOpacity
              style={[s.confirmBtn, s.confirmBtnCancel]}
              onPress={() => onResult(false)}
              activeOpacity={0.8}
            >
              <Text style={s.confirmBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmBtn, state?.destructive ? s.confirmBtnDestructive : s.confirmBtnPrimary]}
              onPress={() => onResult(true)}
              activeOpacity={0.8}
            >
              <Text style={[
                s.confirmBtnPrimaryText,
                state?.destructive && s.confirmBtnDestructiveText,
              ]}>
                {state?.confirmLabel ?? 'Confirm'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Memoized round pager page. Extracted so changing selectedRound during
// a swipe only re-renders the outside leaderboard / tab bar — the 3
// round pages stay memoized with stable refs.
const RoundPage = React.memo(function RoundPage({
  round, index, width, hasPrev, hasNext, revealed,
  players, meId, theme, s,
  onGoToRound, onOpenEdit, isSingleRound, showRunning = true, scoringMode = null,
}) {
  const hasScores = round.scores && Object.keys(round.scores).length > 0;
  return (
    <View
      style={[{ width }, PAGER_PAGE_SNAP_STYLE]}
      dataSet={Platform.OS === 'web' ? { pagerpage: '1' } : undefined}
    >
      {/* Single-round games render course + gear in the card title row, so
          this ROUND N / prev-next row is redundant and we skip it entirely. */}
      {!isSingleRound && (
        <View style={s.pagerTitleRow}>
          <TouchableOpacity
            style={[s.pagerArrow, !hasPrev && s.pagerArrowHidden]}
            onPress={() => hasPrev && onGoToRound(index - 1)}
            disabled={!hasPrev}
            activeOpacity={0.7}
            accessibilityLabel="Previous round"
          >
            <Feather name="chevron-left" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.tabRoundTitle}>ROUND {index + 1} · {round.courseName || '—'}</Text>
          {onOpenEdit && (
            <TouchableOpacity
              onPress={() => onOpenEdit(index)}
              style={s.roundEditBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Round options"
            >
              <Feather name="settings" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.pagerArrow, !hasNext && s.pagerArrowHidden]}
            onPress={() => hasNext && onGoToRound(index + 1)}
            disabled={!hasNext}
            activeOpacity={0.7}
            accessibilityLabel="Next round"
          >
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
      )}
      {hasScores || revealed ? (
        <RoundScoreboard round={round} players={players} meId={meId} showRunning={showRunning} scoringMode={scoringMode} />
      ) : (
        <Text style={s.emptyRoundHint}>No scores yet for this round.</Text>
      )}
    </View>
  );
});

const makeStyles = (t) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 16, paddingBottom: 100 },

  // Header — list header (serif "Golf Partner" title).
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: t.bg.primary },
  headerActions: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  title: { fontFamily: 'PlayfairDisplay-Black', fontSize: 30, color: t.text.primary, letterSpacing: -0.5 },

  // Tournament-detail header — matches the scorecard header exactly (same
  // paddings, same PlusJakartaSans-Bold 17 title).
  tournamentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: t.bg.primary },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: 8 },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary, letterSpacing: -0.3, flexShrink: 1 },

  // Buttons
  primaryBtn: {
    backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
    borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, marginTop: 12,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
    ...(t.isDark ? {} : t.shadow.accent),
  },
  primaryBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.isDark ? t.accent.primary : t.text.inverse,
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.primary,
    borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, marginTop: 12,
    borderWidth: 1, borderColor: t.border.default,
  },
  secondaryBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.accent.primary, fontSize: 14,
  },

  // Start tiles (Game / Tournament)
  startHeading: {
    fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary,
    fontSize: 17, marginBottom: 12, letterSpacing: -0.2,
  },
  startTilesRow: { flexDirection: 'row', gap: 12 },
  startTile: {
    flex: 1, alignItems: 'flex-start', gap: 14,
    backgroundColor: t.bg.card,
    borderRadius: 22, borderWidth: 1.5, borderColor: t.accent.primary + '55',
    paddingVertical: 20, paddingHorizontal: 16, minHeight: 168,
    ...(t.isDark ? {} : t.shadow.card),
  },
  startTileFeatured: {
    backgroundColor: t.accent.primary,
    borderColor: t.accent.primary,
  },
  startTileIconWrap: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: t.accent.light,
    alignItems: 'center', justifyContent: 'center',
  },
  startTileIconWrapFeatured: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  startTileTitle: {
    fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary, fontSize: 21,
    letterSpacing: -0.3,
  },
  startTileTitleFeatured: { color: t.text.inverse },
  startTileSub: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12,
    marginTop: 3, letterSpacing: 0.2,
  },
  startTileSubFeatured: { color: t.text.inverse, opacity: 0.82 },
  startTileCta: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 'auto',
    backgroundColor: t.accent.light,
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
  },
  startTileCtaFeatured: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  startTileCtaText: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 12,
  },

  // "Join with code" entry point
  joinTile: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: t.bg.card,
    borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    paddingVertical: 14, paddingHorizontal: 16, marginTop: 12,
    ...(t.isDark ? {} : t.shadow.card),
  },
  joinTileIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: t.accent.light,
    alignItems: 'center', justifyContent: 'center',
  },
  joinTileTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 15,
  },
  joinTileSub: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12,
    marginTop: 1,
  },

  // Inline reload error card
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: t.destructive + '55',
    padding: 14, marginTop: 12,
  },
  errorCardTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14,
  },
  errorCardText: {
    fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 12,
    marginTop: 1,
  },
  errorRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: t.accent.light,
  },
  errorRetryText: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 12,
  },

  // Tournament list
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.muted, fontSize: 10, letterSpacing: 1.5,
    marginBottom: 12, marginTop: 20, textTransform: 'uppercase',
  },
  finishedLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 16, borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginTop: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  finishedLinkText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 14,
  },
  tournamentCard: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 20, borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    ...(t.isDark ? {} : t.shadow.card),
  },
  tournamentCardLeft: { flex: 1 },
  tournamentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tournamentCardName: { fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary, fontSize: 16 },
  tournamentCardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, marginBottom: 2 },
  tournamentCardRound: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11 },
  tournamentCardRight: { paddingLeft: 12 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
    backgroundColor: 'rgba(212,175,55,0.15)',
  },
  statusBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', color: '#d4af37', fontSize: 9, letterSpacing: 0.5 },
  statusBadgeFinished: { backgroundColor: t.bg.secondary },
  statusBadgeTextFinished: { color: t.text.muted },

  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: 'rgba(199, 122, 10, 0.12)',
    borderRadius: 8, marginBottom: 10, marginTop: 4,
  },
  staleBannerText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13, color: '#c77a0a',
  },
  tournamentCardDisabled: { opacity: 0.5 },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6,
    backgroundColor: 'rgba(199, 122, 10, 0.15)',
  },
  offlineBadgeText: {
    fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: '#c77a0a',
  },
  staleEmpty: {
    alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12,
  },
  staleEmptyText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 14, color: t.text.muted, textAlign: 'center',
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 18 },
  emptySubtitle: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 14, textAlign: 'center' },

  // Card title row with inline toggle
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 },
  cardTitleLeft: { flexDirection: 'row', alignItems: 'baseline', flex: 1, minWidth: 0 },
  inlineToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 11 },
  modeLabelActive: { color: t.text.primary },

  // Cards
  card: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 20, borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  cardTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: t.accent.primary,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  cardTitleCourse: {
    flex: 1,
    fontFamily: 'PlayfairDisplay-Bold',
    fontSize: 14,
    color: t.text.primary,
    letterSpacing: -0.2,
  },

  // Round navigation
  roundNavHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  roundNavBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  roundNavBtnDisabled: { opacity: 0.3 },
  roundNavCenter: { flex: 1, alignItems: 'center' },
  roundNavCourse: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, marginTop: 2 },

  // Tabs
  tabBar: { marginBottom: 14 },
  tab: {
    paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1, borderColor: t.border.default,
    marginRight: 8, backgroundColor: t.bg.secondary,
  },
  tabActive: { backgroundColor: t.accent.primary, borderColor: t.accent.primary },
  tabText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.muted, fontSize: 12 },
  tabTextActive: { color: t.text.inverse },
  tabRoundTitle: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, flex: 1, textAlign: 'center' },
  pagerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pagerArrow: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },
  pagerArrowHidden: { opacity: 0 },
  roundEditBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  roundPagerWrap: {},
  emptyRoundHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    color: t.text.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  pairsPreviewHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    color: t.text.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },

  // Masters leaderboard
  mastersCard: {
    backgroundColor: t.bg.deep,
    borderRadius: 20, padding: 16, marginBottom: 16,
    ...(t.isDark ? {} : { shadowColor: '#004030', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 6 }),
  },
  mastersCardTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: 'rgba(255,255,255,0.6)',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  mastersToggleLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  mastersToggleLabelActive: { color: 'rgba(255,255,255,0.9)' },
  // Overall/R1/R2/… scope chip strip in the leaderboard card header.
  mastersChipRow: { flexGrow: 0 },
  mastersChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  mastersChipActive: { backgroundColor: 'rgba(255,255,255,0.9)' },
  mastersChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  mastersChipTextActive: { color: t.bg.deep },
  mastersRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  mastersRowFirst: { borderLeftWidth: 3, borderLeftColor: semantic.winner.dark, paddingLeft: 8, marginLeft: -8 },
  mastersRankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  mastersRankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  mastersNameCol: { flex: 1, minWidth: 0, marginRight: 8 },
  mastersName: { fontFamily: 'PlusJakartaSans-Medium', color: '#ffffff', fontSize: 14 },
  mastersRoundSub: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  mastersPoints: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 16, marginRight: 8 },
  mastersSub: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.45)', fontSize: 11, width: 60, textAlign: 'right' },
  mastersMatchStatus: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.85)',
    fontSize: 12, textAlign: 'center', marginTop: 10,
  },

  // Pair blocks
  pairBlock: {
    borderRadius: 12,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
    padding: 12, marginBottom: 8,
  },
  winnerBlock: {
    backgroundColor: t.isDark ? 'rgba(52,211,153,0.06)' : '#e8f5ee',
    borderColor: t.accent.primary + '44',
  },
  winnerBadge: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.accent.primary, fontSize: 9, marginBottom: 8,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  pairHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pairNames: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14, flex: 1 },
  pairPoints: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary, fontSize: 20 },
  pairMember: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, paddingTop: 3 },

  // Single-round game overview (course hero + per-player stat cards)
  gameHeroCard: {
    backgroundColor: t.bg.card,
    borderRadius: 20,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16,
    marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  gameHeroHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
  gameHeroCourse: {
    fontFamily: 'PlayfairDisplay-Bold',
    fontSize: 22,
    lineHeight: 26,
    color: t.text.primary,
    letterSpacing: -0.4,
    marginTop: 6,
  },
  gameHeroMeta: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: t.text.muted,
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  gameProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gameProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  gameProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: t.accent.primary,
  },
  gameProgressText: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.secondary,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  gamePlayerPoints: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: t.accent.primary,
    fontSize: 28,
    lineHeight: 30,
  },
  gamePlayerPointsLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.muted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  gameStatValueGood: { color: t.accent.primary },
  gameStatValueWarn: { color: t.text.secondary },
  // Round action row (Scorecard + Next Round side-by-side)
  roundActionsRow: { flexDirection: 'row', gap: 10 },
  roundActionBtn: { flex: 1, marginTop: 0 },
  tournamentBottomBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.bg.primary,
    borderTopWidth: 1,
    borderTopColor: t.isDark ? t.glass?.border : t.border.default,
  },

  // Delete (tournament list cards)
  tournamentCardWrapper: { position: 'relative' },
  deleteCardBtn: { position: 'absolute', top: 8, right: 8, padding: 6 },

  // Settings modal (bottom sheet)
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: t.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 10, paddingBottom: 32, paddingHorizontal: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: t.border.default,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.border.default, marginBottom: 12,
  },
  modalTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: t.accent.primary, marginBottom: 8,
    letterSpacing: 1.5, textTransform: 'uppercase', paddingHorizontal: 4,
  },
  modalSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 13, color: t.text.secondary,
    paddingHorizontal: 4, marginBottom: 8,
  },
  modalSubtle: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 11, color: t.text.muted, marginTop: 2,
  },
  undoSnack: {
    position: 'absolute',
    left: 16, right: 16, bottom: 80,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: t.isDark ? t.bg.elevated : '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent.primary + '40',
    ...(t.isDark ? {} : t.shadow.elevated),
    zIndex: 20,
  },
  undoSnackText: {
    flex: 1,
    color: '#ffffff',
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
  },
  undoSnackBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: t.accent.primary + '22',
    borderWidth: 1,
    borderColor: t.accent.primary + '55',
  },
  undoSnackBtnText: {
    color: t.accent.primary,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 12,
    letterSpacing: 1,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  menuItemText: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.primary, fontSize: 14,
  },
  menuItemDestructive: { borderBottomWidth: 0 },

  // Viewer badge
  viewerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20,
    backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default,
  },
  viewerBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 9, letterSpacing: 0.5 },

  // Invite modal
  inviteSubtitle: {
    fontFamily: 'PlusJakartaSans-Regular', color: t.text.secondary,
    fontSize: 13, paddingHorizontal: 4, marginBottom: 16,
  },
  inviteCodeBox: {
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderRadius: 16, borderWidth: 1, borderColor: t.border.default,
    padding: 20, alignItems: 'center', marginBottom: 16,
  },
  inviteCode: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary,
    fontSize: 36, letterSpacing: 10,
  },
  inviteRoleRow: {
    flexDirection: 'row', gap: 8, marginBottom: 12, paddingHorizontal: 4,
  },
  inviteRoleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: t.border.default,
    alignItems: 'center', backgroundColor: t.bg.secondary,
  },
  inviteRoleBtnActive: {
    backgroundColor: t.accent.primary, borderColor: t.accent.primary,
  },
  inviteRoleText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: t.text.muted,
  },
  inviteRoleTextActive: { color: t.text.inverse },

  // Invite QR code
  inviteQrBox: { alignItems: 'center', marginBottom: 16 },
  inviteQrInner: {
    backgroundColor: '#ffffff', padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: t.border.default,
  },
  inviteQrHint: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted,
    fontSize: 11, marginTop: 8, letterSpacing: 0.3,
  },

  // Empty-state CTA buttons
  emptyStateBtn: { alignSelf: 'stretch', width: '100%', maxWidth: 320 },

  // Themed confirmation modal
  confirmBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  confirmCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: t.bg.card,
    borderRadius: 20, padding: 22,
    borderWidth: 1, borderColor: t.border.default,
    ...(t.isDark ? {} : t.shadow.elevated),
  },
  confirmTitle: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: t.text.primary,
    marginBottom: 6,
  },
  confirmMessage: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: t.text.secondary,
    lineHeight: 20, marginBottom: 20,
  },
  confirmActions: { flexDirection: 'row', gap: 10 },
  confirmBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnCancel: {
    backgroundColor: t.bg.secondary,
    borderWidth: 1, borderColor: t.border.default,
  },
  confirmBtnCancelText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: t.text.primary,
  },
  confirmBtnPrimary: {
    backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
    borderWidth: t.isDark ? 1 : 0,
    borderColor: t.isDark ? t.accent.primary + '33' : 'transparent',
  },
  confirmBtnPrimaryText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14,
    color: t.isDark ? t.accent.primary : t.text.inverse,
  },
  confirmBtnDestructive: { backgroundColor: t.destructive },
  confirmBtnDestructiveText: { color: '#ffffff' },
});
