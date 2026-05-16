import React, { useEffect, useState, useCallback, useRef, useMemo, startTransition } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, FlatList, Platform, Modal, Pressable, ActivityIndicator, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { ShareableLeaderboard, shareLeaderboard } from '../components/ShareableCard';
import PullToRefresh from '../components/PullToRefresh';
import LoadingSplash from '../components/LoadingSplash';
import {
  loadTournament, loadAllTournaments, loadAllTournamentsWithFallback,
  setActiveTournament, clearActiveTournament,
  deleteTournament, saveTournament,
  tournamentLeaderboard, tournamentBestWorstLeaderboard,
  roundPairLeaderboard, calcBestWorstBall, roundTotals,
  playerRoundBestWorstPoints,
  tournamentPlayerClinched, roundPairClinched,
  isRoundComplete, isTournamentFinished, subscribeTournamentChanges,
  matchPlayRoundTally, addPlayerRoundPatches,
  DEFAULT_SETTINGS, generateInviteCode,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { consumePendingPlayers } from '../lib/selectionBridge';
import { subscribeConnectivity } from '../lib/connectivity';
import { getShowRunningScore, setShowRunningScore } from '../lib/prefs';

// Web-only CSS scroll-snap. See ScorecardScreen.js for the rationale:
// RNW 0.21's `pagingEnabled` omits `scroll-snap-stop: always`, so a
// fast swipe can skip past one page. On web we drive snap ourselves.
const PAGER_SNAP_TYPE_STYLE = Platform.OS === 'web' ? { scrollSnapType: 'x mandatory', overflowX: 'auto' } : null;
const PAGER_PAGE_SNAP_STYLE = Platform.OS === 'web' ? { scrollSnapAlign: 'start', scrollSnapStop: 'always' } : null;

// Pick the round to land on when entering the tournament view:
// - Default is `currentRound`.
// - If that round is fully played (every player scored every hole) AND
//   a next round exists, jump to the next one. Keeps the UI pointing at
//   where play is actually headed.
function chooseInitialRound(tournament) {
  const cur = tournament?.currentRound ?? 0;
  const rounds = tournament?.rounds ?? [];
  const round = rounds[cur];
  if (!round) return cur;
  const playersCount = tournament?.players?.length ?? 0;
  const holeCount = round.holes?.length ?? 18;
  const expected = playersCount * holeCount;
  if (expected === 0) return cur;
  let entered = 0;
  for (const pid in (round.scores ?? {})) {
    entered += Object.keys(round.scores[pid] ?? {}).length;
  }
  if (entered >= expected && cur < rounds.length - 1) return cur + 1;
  return cur;
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

export default function HomeScreen({ navigation, route }) {
  const viewMode = route?.params?.viewMode ?? 'auto';
  const { theme } = useTheme();
  const { user } = useAuth();
  const [tournament, setTournament] = useState(null);
  const [allTournaments, setAllTournaments] = useState([]);
  const [listStale, setListStale] = useState(false);
  const [openableIds, setOpenableIds] = useState(null); // null = all openable
  const [loading, setLoading] = useState(true);
  const [selectedRound, setSelectedRound] = useState(0);
  const [roundPagerWidth, setRoundPagerWidth] = useState(0);
  const roundPagerRef = useRef(null);
  const roundScrollOffset = useRef(0);
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
  const [showSettings, setShowSettings] = useState(false);
  // List-view overflow menu — surfaces Friends / Stats / Profile, which are
  // otherwise buried (Friends had no entry point at all on the list view).
  const [showListMenu, setShowListMenu] = useState(false);
  const [showRoundEdit, setShowRoundEdit] = useState(false);
  const [showResetHistory, setShowResetHistory] = useState(false);
  const [undoSnack, setUndoSnack] = useState(null); // { roundIndex, snapshot, at }
  const undoTimerRef = useRef(null);
  const [leaderboardBestBall, setLeaderboardBestBall] = useState(false);
  const [roundBestBall, setRoundBestBall] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCodes, setInviteCodes] = useState({ editor: '', viewer: '' });
  const [inviteRoleState, setInviteRoleState] = useState('editor');
  const [inviteLoading, setInviteLoading] = useState(false);
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
  // Shares the same persisted preference as ScorecardScreen so that hiding
  // running totals follows the user across screens.
  const [showRunning, setShowRunningState] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getShowRunningScore().then((v) => { if (!cancelled) setShowRunningState(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const toggleRunning = useCallback(() => {
    setShowRunningState((v) => {
      const next = !v;
      setShowRunningScore(next).catch(() => {});
      return next;
    });
  }, []);

  // Coalesce reload calls: `focus` and store-change emits can arrive in
  // quick succession. Run them serially and squash consecutive triggers
  // into a single trailing reload so we don't fan out overlapping
  // network round-trips.
  const reloadInFlight = useRef(null);
  const reloadPending = useRef(false);
  const hasLoadedOnceRef = useRef(false);
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
          loadTournament(),
          loadAllTournamentsWithFallback(),
        ]);
        setTournament(t);
        setAllTournaments(listResult.list);
        setListStale(listResult.stale);
        setOpenableIds(listResult.openableIds);
        if (t) setSelectedRound(chooseInitialRound(t));
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
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  // Apply players picked mid-round (returned via the selection bridge from
  // PlayerPicker). Each addPlayer mutation also patches the affected rounds'
  // playing handicaps and pairs. Applied serially so the second player's
  // pairs are computed against a roster that already includes the first.
  const applyAddPlayers = useCallback(async (picked) => {
    let t = await loadTournament();
    if (!t) return;
    for (const p of picked) {
      if ((t.players ?? []).length >= 4) break;
      if ((t.players ?? []).some((x) => x.id === p.id)) continue;
      const player = { id: p.id, name: p.name, handicap: parseInt(p.handicap, 10) || 0 };
      const roundPatches = addPlayerRoundPatches(t, player);
      t = await mutate(t, { type: 'tournament.addPlayer', player, roundPatches });
    }
    setTournament(t);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      const picked = consumePendingPlayers();
      if (picked && picked.length > 0) applyAddPlayers(picked);
    });
    return unsub;
  }, [navigation, applyAddPlayers]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', reload);
    const unsubStore = subscribeTournamentChanges(() => { reload(); });
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

    const updated = { ...tournament };
    updated.rounds = updated.rounds.map((r, i) => {
      if (i !== idx) return r;
      const history = [...(r.resetHistory ?? [])];
      if (hasContent) {
        history.push(snapshot);
        // Cap to last 10 entries to avoid unbounded growth
        if (history.length > 10) history.splice(0, history.length - 10);
      }
      return { ...r, scores: {}, notes: {}, resetHistory: history };
    });
    await saveTournament(updated);
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
    const updated = { ...tournament };
    updated.rounds = updated.rounds.map((r, i) => {
      if (i !== roundIndex) return r;
      // Pop the entry we just pushed (the snapshot we're restoring)
      const history = [...(r.resetHistory ?? [])];
      if (history.length > 0 && history[history.length - 1].at === snapshot.at) history.pop();
      return { ...r, scores: snapshot.scores, notes: snapshot.notes, resetHistory: history };
    });
    await saveTournament(updated);
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
    const updated = { ...tournament };
    updated.rounds = updated.rounds.map((r, i) => (
      i === idx ? { ...r, scores: entry.scores ?? {}, notes: entry.notes ?? '' } : r
    ));
    await saveTournament(updated);
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

  async function goToList() {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Main', { screen: 'Home' });
    }
  }

  async function confirmDelete(t) {
    const confirmed = await confirm({
      title: 'Delete Tournament',
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
      if (viewMode === 'tournament' && navigation.canGoBack()) {
        navigation.goBack();
      }
    } catch (err) {
      if (Platform.OS === 'web') window.alert(err.message ?? 'Could not delete tournament');
      else Alert.alert('Error', err.message ?? 'Could not delete tournament');
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
        else navigation.navigate('Main', { screen: 'Home' });
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
  const bestBallAvailable = (tournament?.players?.length ?? 0) >= 4;

  // Sync toggle to tournament's scoring mode when it loads/changes. If the
  // tournament doesn't support best-ball (fewer than 4 players), force off.
  useEffect(() => {
    if (!bestBallAvailable) {
      setRoundBestBall(false);
      setLeaderboardBestBall(false);
      return;
    }
    const isBB = settings.scoringMode === 'bestball';
    setRoundBestBall(isBB);
    setLeaderboardBestBall(isBB);
  }, [tournament?.id, settings.scoringMode, bestBallAvailable]);
  const leaderboard = useMemo(
    () => (tournament ? tournamentLeaderboard(tournament) : []),
    [tournament],
  );
  const bestWorstLeaderboard = useMemo(
    () => (tournament && leaderboardBestBall ? tournamentBestWorstLeaderboard(tournament) : null),
    [tournament, leaderboardBestBall],
  );
  const selectedRoundData = tournament?.rounds?.[selectedRound] ?? null;
  const selectedRoundHasScores = !!(selectedRoundData?.scores && Object.keys(selectedRoundData.scores).length > 0);
  const selectedRoundPlayerTotals = useMemo(
    () => (tournament && selectedRoundData && selectedRoundHasScores && !leaderboardBestBall
      ? roundTotals(selectedRoundData, tournament.players)
      : null),
    [tournament, selectedRoundData, selectedRoundHasScores, leaderboardBestBall],
  );
  const selectedRoundBB = useMemo(
    () => (tournament && selectedRoundData && selectedRoundHasScores && leaderboardBestBall && selectedRoundData.pairs?.length
      ? calcBestWorstBall(selectedRoundData, tournament.players)
      : null),
    [tournament, selectedRoundData, selectedRoundHasScores, leaderboardBestBall],
  );
  const tournamentMode = settings.scoringMode === 'bestball' ? 'bestball' : 'stableford';
  const tournamentClinchedId = useMemo(
    () => (tournament ? tournamentPlayerClinched(tournament, tournamentMode) : null),
    [tournament, tournamentMode],
  );

  // Stable callbacks for the memoised round pager pages. Keep references
  // stable across swipes so <RoundPage /> memoisation holds.
  const goToRound = useCallback((i) => setSelectedRound(i), []);
  const openRoundEdit = useCallback((i) => {
    setSelectedRound(i);
    setShowRoundEdit(true);
  }, []);

  const showList = viewMode === 'list' || (viewMode === 'auto' && !tournament);
  const showTournament = viewMode === 'tournament' || (viewMode === 'auto' && !!tournament);
  const isViewer = tournament?._role === 'viewer';
  const isOwner = tournament?._role === 'owner';
  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';

  // Show the green splash whenever a reload is in flight AND there's no
  // data to render yet — covers initial mount (cold open) and re-focus
  // cases where the cached state would otherwise flash an empty page
  // (e.g. after deletion). When data IS already present, skip the splash
  // so quick navigations don't blink the green panel.
  const wouldRenderEmpty =
    (showTournament && !tournament) ||
    (showList && allTournaments.length === 0);
  if (loading && wouldRenderEmpty) {
    return <LoadingSplash />;
  }

  if (showList) {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Golf Partner</Text>
          </View>
          <View style={s.headerActions}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => setShowListMenu(true)}
              activeOpacity={0.7}
              accessibilityLabel="Menu"
            >
              <Feather name="menu" size={18} color={theme.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={s.avatarBtn} onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
              <Text style={s.avatarText}>{userInitials}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <PullToRefresh
          style={s.scrollView}
          contentContainerStyle={s.content}
          refreshing={refreshing}
          onRefresh={onRefresh}
        >
        <Text style={s.startHeading}>Start playing</Text>
        <View style={s.startTilesRow}>
          <TouchableOpacity
            style={[s.startTile, s.startTileFeatured]}
            onPress={() => navigation.navigate('Setup', { kind: 'game' })}
            activeOpacity={0.88}
          >
            <View style={[s.startTileIconWrap, s.startTileIconWrapFeatured]}>
              <Feather name="flag" size={24} color={theme.text.inverse} />
            </View>
            <View>
              <Text style={[s.startTileTitle, s.startTileTitleFeatured]}>Game</Text>
              <Text style={[s.startTileSub, s.startTileSubFeatured]}>Single round</Text>
            </View>
            <View style={[s.startTileCta, s.startTileCtaFeatured]}>
              <Feather name="plus" size={16} color={theme.text.inverse} />
              <Text style={[s.startTileCtaText, { color: theme.text.inverse }]}>New game</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.startTile}
            onPress={() => navigation.navigate('Setup', { kind: 'tournament' })}
            activeOpacity={0.88}
          >
            <View style={s.startTileIconWrap}>
              <Feather name="award" size={24} color={theme.accent.primary} />
            </View>
            <View>
              <Text style={s.startTileTitle}>Tournament</Text>
              <Text style={s.startTileSub}>Multi-day event</Text>
            </View>
            <View style={s.startTileCta}>
              <Feather name="plus" size={16} color={theme.accent.primary} />
              <Text style={s.startTileCtaText}>New tournament</Text>
            </View>
          </TouchableOpacity>
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

        {reloadError && (
          <View style={s.errorCard}>
            <Feather name="alert-triangle" size={18} color={theme.destructive} />
            <View style={{ flex: 1 }}>
              <Text style={s.errorCardTitle}>Couldn't load</Text>
              <Text style={s.errorCardText}>{reloadError}</Text>
            </View>
            <TouchableOpacity style={s.errorRetryBtn} onPress={reload} activeOpacity={0.8}>
              <Feather name="refresh-cw" size={13} color={theme.accent.primary} />
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
                  onPress={() => { if (openable) selectTournament(t.id); }}
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
                        <Feather name="cloud-off" size={12} color="#c77a0a" />
                        <Text style={s.offlineBadgeText}>Connection required</Text>
                      </View>
                    ) : (
                      <Feather name="chevron-right" size={18} color={theme.text.muted} />
                    )}
                  </View>
                </TouchableOpacity>
                {openable && t._role === 'owner' && (
                  <TouchableOpacity style={s.deleteCardBtn} onPress={() => confirmDelete(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Feather name="trash-2" size={14} color={theme.destructive} />
                  </TouchableOpacity>
                )}
              </View>
            );
          };
          const sorted = allTournaments.slice().sort((a, b) => b.id - a.id);
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
                  <Feather name="cloud-off" size={32} color={theme.text.muted} />
                  <Text style={s.staleEmptyText}>Offline · no saved tournaments yet</Text>
                </View>
              );
            }
            return (
              <View style={s.emptyState}>
                <Feather name="flag" size={48} color={theme.text.muted} />
                <Text style={s.emptyTitle}>Nothing here yet</Text>
                <Text style={s.emptySubtitle}>Create your first game or tournament to start playing</Text>
              </View>
            );
          }
          if (active.length === 0) {
            return (
              <View style={s.emptyState}>
                <Feather name="check-circle" size={48} color={theme.text.muted} />
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

        <Modal
          visible={showListMenu}
          transparent
          animationType="slide"
          onRequestClose={() => setShowListMenu(false)}
        >
          <Pressable style={s.modalBackdrop} onPress={() => setShowListMenu(false)}>
            <Pressable style={s.modalSheet} onPress={() => {}}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>Menu</Text>

              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowListMenu(false); navigation.navigate('Friends'); }}
                activeOpacity={0.7}
              >
                <Feather name="users" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Friends</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowListMenu(false); navigation.navigate('Stats'); }}
                activeOpacity={0.7}
              >
                <Feather name="bar-chart-2" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Statistics</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.menuItem, { borderBottomWidth: 0 }]}
                onPress={() => { setShowListMenu(false); navigation.navigate('Profile'); }}
                activeOpacity={0.7}
              >
                <Feather name="user" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Profile</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        <ConfirmModal state={confirmState} onResult={resolveConfirm} theme={theme} s={s} />
      </SafeAreaView>
    );
  }

  if (showTournament && !tournament) {
    return (
      <SafeAreaView style={[s.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]} edges={['top', 'bottom']}>
        <Feather name="flag" size={48} color={theme.text.muted} />
        <Text style={[s.emptyTitle, { marginTop: 16 }]}>No active tournament</Text>
        <Text style={[s.emptySubtitle, { marginTop: 6, marginBottom: 8 }]}>
          Start a game or tournament to begin playing.
        </Text>
        <TouchableOpacity
          style={[s.primaryBtn, s.emptyStateBtn]}
          onPress={() => navigation.navigate('Setup', { kind: 'game' })}
          activeOpacity={0.8}
        >
          <Feather name="flag" size={16} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          <Text style={s.primaryBtnText}>Start a Game</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.secondaryBtn, s.emptyStateBtn]}
          onPress={() => navigation.navigate('Setup', { kind: 'tournament' })}
          activeOpacity={0.8}
        >
          <Feather name="award" size={16} color={theme.accent.primary} />
          <Text style={s.secondaryBtnText}>Start a Tournament</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.secondaryBtn, s.emptyStateBtn]}
          onPress={goToList}
          activeOpacity={0.8}
        >
          <Feather name="home" size={16} color={theme.accent.primary} />
          <Text style={s.secondaryBtnText}>Go to Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isGame = tournament.kind === 'game';
  const completedRounds = tournament.rounds.filter(
    (r) => r.scores && Object.keys(r.scores).length > 0,
  );
  const strokesByPlayer = Object.fromEntries(leaderboard.map((e) => [e.player.id, e.strokes]));
  const displayedBoard = leaderboardBestBall && bestWorstLeaderboard ? bestWorstLeaderboard : leaderboard;
  const getSelectedRoundValue = (playerId) => {
    if (leaderboardBestBall) {
      if (!selectedRoundData || !selectedRoundHasScores || !selectedRoundData.pairs?.length) return null;
      return playerRoundBestWorstPoints(selectedRoundData, playerId, tournament.players, settings);
    }
    if (!selectedRoundPlayerTotals) return null;
    return selectedRoundPlayerTotals.find((e) => e.player.id === playerId)?.totalPoints ?? 0;
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity onPress={goToList} style={s.backBtn} activeOpacity={0.7}>
            <Feather name="chevron-left" size={20} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text
            style={[s.headerTitle, tournament.name.length > 22 && s.headerTitleLong]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {tournament.name}
          </Text>
        </View>
        <View style={s.headerActions}>
          {!isViewer && (
            <TouchableOpacity style={s.iconBtn} onPress={handleInvite} activeOpacity={0.7}>
              <Feather name="share" size={18} color={theme.accent.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => navigation.navigate('Gallery', { tournamentId: tournament.id })}
            activeOpacity={0.7}
            accessibilityLabel="Memories"
          >
            <Feather name="image" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={toggleRunning}
            activeOpacity={0.7}
            accessibilityLabel={showRunning ? 'Hide running scores' : 'Show running scores'}
          >
            <Feather name={showRunning ? 'eye-off' : 'eye'} size={18} color={theme.accent.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => setShowSettings(true)} activeOpacity={0.7}>
            <Feather name="settings" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <PullToRefresh
        style={s.scrollView}
        contentContainerStyle={s.content}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >

      {!isGame && (
      <View style={s.mastersCard}>
        <View style={s.cardTitleRow}>
          <Text style={s.mastersCardTitle}>LEADERBOARD</Text>
          {bestBallAvailable && (
            <View style={s.inlineToggle}>
              <Text style={[s.mastersToggleLabel, !leaderboardBestBall && s.mastersToggleLabelActive]}>Stableford</Text>
              <Switch
                value={leaderboardBestBall}
                onValueChange={setLeaderboardBestBall}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: 'rgba(255,215,0,0.4)' }}
                thumbColor="#fff"
              />
              <Text style={[s.mastersToggleLabel, leaderboardBestBall && s.mastersToggleLabelActive]}>Best Ball</Text>
            </View>
          )}
        </View>
        {displayedBoard.map((entry, i) => {
          const rankColors = ['#ffd700', '#c0c8d4', '#daa06d'];
          const rankColor = rankColors[i] || 'rgba(255,255,255,0.4)';
          const rankBg = i === 0 ? 'rgba(255,215,0,0.2)' : i === 1 ? 'rgba(192,200,212,0.15)' : i === 2 ? 'rgba(218,160,109,0.15)' : 'rgba(255,255,255,0.08)';
          const roundValue = getSelectedRoundValue(entry.player.id);
          const roundUnit = 'pts';
          const strokes = strokesByPlayer[entry.player.id] ?? 0;
          return (
            <View key={entry.player.id} style={[s.mastersRow, i === 0 && s.mastersRowFirst, i === displayedBoard.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[s.mastersRankBadge, { backgroundColor: rankBg }]}>
                <Text style={[s.mastersRankText, { color: rankColor }]}>{i + 1}</Text>
              </View>
              <View style={s.mastersNameCol}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.mastersName, i === 0 && { fontFamily: 'PlusJakartaSans-Bold' }]} numberOfLines={1}>
                    {entry.player.name}
                  </Text>
                  {showRunning && entry.player.id === tournamentClinchedId && (
                    <Feather name="award" size={12} color="#ffd700" />
                  )}
                </View>
                <Text style={s.mastersRoundSub}>
                  R{selectedRound + 1} · {!showRunning ? '—' : roundValue == null ? '—' : `${roundValue} ${roundUnit}`}
                </Text>
              </View>
              <Text style={[s.mastersPoints, i === 0 && { fontSize: 18 }]}>{showRunning ? `${entry.points} pts` : '—'}</Text>
              <Text style={s.mastersSub}>{showRunning ? `${strokes || '-'} str` : ''}</Text>
            </View>
          );
        })}
      </View>
      )}

      {tournament.rounds.length > 0 && isGame && tournament.rounds.length === 1
        && settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball' && (
        <GameOverviewCard
          round={tournament.rounds[0]}
          players={tournament.players}
          settings={settings}
          theme={theme}
          s={s}
          onOpenEdit={isViewer ? null : openRoundEdit}
          showRunning={showRunning}
        />
      )}

      {tournament.rounds.length > 0 && !(isGame && tournament.rounds.length === 1
        && settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball') && (
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
            {bestBallAvailable && (
              <View style={s.inlineToggle}>
                <Text style={[s.modeLabel, !roundBestBall && s.modeLabelActive]}>Stableford</Text>
                <Switch
                  value={roundBestBall}
                  onValueChange={setRoundBestBall}
                  trackColor={{ false: theme.border.default, true: theme.accent.primary }}
                  thumbColor="#fff"
                />
                <Text style={[s.modeLabel, roundBestBall && s.modeLabelActive]}>Best Ball</Text>
              </View>
            )}
            {tournament.rounds.length === 1 && !isViewer && (
              <TouchableOpacity
                onPress={() => openRoundEdit(0)}
                style={s.roundEditBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Round options"
              >
                <Feather name="settings" size={14} color={theme.text.muted} />
              </TouchableOpacity>
            )}
          </View>
          {!isGame && (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={tournament.rounds}
              keyExtractor={(r) => r.id}
              style={s.tabBar}
              renderItem={({ item: round, index }) => (
                <TouchableOpacity
                  style={[s.tab, selectedRound === index && s.tabActive]}
                  onPress={() => setSelectedRound(index)}
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
                roundBestBall={roundBestBall}
                players={tournament.players}
                settings={settings}
                theme={theme}
                s={s}
                onGoToRound={goToRound}
                onOpenEdit={isViewer ? null : openRoundEdit}
                isSingleRound
                showRunning={showRunning}
              />
            ) : (
              <ScrollView
                ref={roundPagerRef}
                horizontal
                pagingEnabled={Platform.OS !== 'web'}
                style={PAGER_SNAP_TYPE_STYLE}
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
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
                    roundBestBall={roundBestBall}
                    players={tournament.players}
                    settings={settings}
                    theme={theme}
                    s={s}
                    onGoToRound={goToRound}
                    onOpenEdit={isViewer ? null : openRoundEdit}
                    isSingleRound={tournament.rounds.length === 1}
                    showRunning={showRunning}
                  />
                ))}
              </ScrollView>
            ))}
          </View>
        </View>
      )}

      <View style={{ position: 'absolute', left: -9999 }}>
        <ShareableLeaderboard ref={leaderboardRef} tournamentName={tournament.name} leaderboard={leaderboard} />
      </View>
    </PullToRefresh>

    {undoSnack && (
      <View style={s.undoSnack}>
        <Feather name="rotate-ccw" size={16} color={theme.accent.primary} />
        <Text style={s.undoSnackText}>Round {undoSnack.roundIndex + 1} reset</Text>
        <TouchableOpacity onPress={performUndoReset} style={s.undoSnackBtn} activeOpacity={0.7}>
          <Text style={s.undoSnackBtnText}>UNDO</Text>
        </TouchableOpacity>
      </View>
    )}

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
            onPress={() => navigation.navigate('Scorecard', { roundIndex: selectedRound })}
            activeOpacity={0.8}
          >
            <Feather name="edit-2" size={16} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.primaryBtnText}>{isCurrentRound ? 'Scorecard' : 'Edit Scores'}</Text>
          </TouchableOpacity>
          {canShowNext && (
            nextRevealed ? (
              <TouchableOpacity
                style={[s.secondaryBtn, s.roundActionBtn]}
                onPress={() => navigation.navigate('NextRound', { revealOnly: true, roundIndex: tournament.currentRound + 1 })}
                activeOpacity={0.7}
              >
                <Feather name="eye" size={16} color={theme.accent.primary} />
                <Text style={s.secondaryBtnText}>Next Round</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.primaryBtn, s.roundActionBtn]}
                onPress={() => navigation.navigate('NextRound')}
                activeOpacity={0.8}
              >
                <Feather name="play" size={16} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                <Text style={s.primaryBtnText}>Start Next Round</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      );
    })()}

    <Modal
      visible={showInvite}
      transparent
      animationType="slide"
      onRequestClose={() => setShowInvite(false)}
    >
      <Pressable style={s.modalBackdrop} onPress={() => setShowInvite(false)}>
        <Pressable style={s.modalSheet} onPress={() => {}}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Invite</Text>
          <Text style={s.inviteSubtitle}>
            {(() => {
              const noun = tournament?.kind === 'game' ? 'game' : 'tournament';
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
                  // QR encodes the same payload as "Share link": a web invite
                  // URL when an origin is available, otherwise the bare code.
                  const origin = Platform.OS === 'web' && typeof window !== 'undefined'
                    ? window.location.origin
                    : null;
                  const qrValue = origin
                    ? `${origin}/?invite=${inviteCode}`
                    : inviteCode;
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
                : null;
              // On web the link auto-prefills the join code (see
              // AppNavigator's ?invite handler). On native we share just
              // the code until deep-linking is wired up.
              // Blank line before the URL keeps WhatsApp from wrapping the
              // text into the middle of the link and breaking the tap target.
              const message = origin
                ? `Join my golf tournament 🏌️\n\n${origin}/?invite=${inviteCode}`
                : `Join my golf tournament! Code: ${inviteCode}`;
              Share.share({ message });
            }}
            activeOpacity={0.7}
            disabled={!inviteCode}
          >
            <Feather name="share-2" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Share link</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={showRoundEdit}
      transparent
      animationType="fade"
      onRequestClose={() => setShowRoundEdit(false)}
    >
      <Pressable style={s.modalBackdrop} onPress={() => setShowRoundEdit(false)}>
        <Pressable style={s.modalSheet} onPress={() => {}}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Round {selectedRound + 1}</Text>

          {(() => {
            // Individual + match-play tournaments have nothing to "team up" —
            // every pair is one player — so Edit/Reveal Teams is meaningless
            // and EditTeamsScreen's slot UI doesn't fit single-member pairs.
            const mode = settings?.scoringMode;
            const usesTeams = mode !== 'individual' && mode !== 'matchplay' && tournament.players.length > 1;
            if (!usesTeams) return null;
            const r = tournament.rounds[selectedRound];
            const alreadyRevealed = r?.revealed || selectedRound <= tournament.currentRound;
            return alreadyRevealed ? (
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowRoundEdit(false); navigation.navigate('EditTeams', { roundIndex: selectedRound }); }}
                activeOpacity={0.7}
              >
                <Feather name="users" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Edit Teams</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowRoundEdit(false); navigation.navigate('NextRound', { revealOnly: true, roundIndex: selectedRound }); }}
                activeOpacity={0.7}
              >
                <Feather name="eye" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Reveal Teams</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            );
          })()}

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowRoundEdit(false); navigation.navigate('EditTournament'); }}
            activeOpacity={0.7}
          >
            <Feather name="map" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Edit Course</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          {(() => {
            const historyCount = tournament.rounds[selectedRound]?.resetHistory?.length ?? 0;
            if (historyCount === 0) return null;
            return (
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowRoundEdit(false); setShowResetHistory(true); }}
                activeOpacity={0.7}
              >
                <Feather name="rotate-cw" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Restore previous scores ({historyCount})</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            );
          })()}

          <TouchableOpacity
            style={[s.menuItem, s.menuItemDestructive]}
            onPress={() => { setShowRoundEdit(false); resetCurrentRound(); }}
            activeOpacity={0.7}
          >
            <Feather name="rotate-ccw" size={18} color={theme.destructive} />
            <Text style={[s.menuItemText, { color: theme.destructive }]}>Reset Round</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
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
                  <Feather name="clock" size={18} color={theme.accent.primary} />
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

    <Modal
      visible={showSettings}
      transparent
      animationType="slide"
      onRequestClose={() => setShowSettings(false)}
    >
      <Pressable style={s.modalBackdrop} onPress={() => setShowSettings(false)}>
        <Pressable style={s.modalSheet} onPress={() => {}}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Tournament Settings</Text>

          {!isViewer && (() => {
            const mode = settings?.scoringMode;
            const usesTeams = mode !== 'individual' && mode !== 'matchplay' && tournament.players.length > 1;
            if (!usesTeams) return null;
            const r = tournament.rounds[selectedRound];
            const alreadyRevealed = r?.revealed || selectedRound <= tournament.currentRound;
            return alreadyRevealed ? (
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowSettings(false); navigation.navigate('EditTeams', { roundIndex: selectedRound }); }}
                activeOpacity={0.7}
              >
                <Feather name="users" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Edit Teams</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowSettings(false); navigation.navigate('NextRound', { revealOnly: true, roundIndex: selectedRound }); }}
                activeOpacity={0.7}
              >
                <Feather name="eye" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Reveal Teams</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            );
          })()}

          {tournament.players.length > 1 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); shareLeaderboard({ tournamentName: tournament.name, leaderboard, theme, viewRef: leaderboardRef }); }}
              activeOpacity={0.7}
            >
              <Feather name="share-2" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>Share Leaderboard</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {!isViewer && tournament.players.length < 4
            && (settings?.scoringMode === 'individual'
              || settings?.scoringMode === 'stableford'
              || settings?.scoringMode == null) && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                setShowSettings(false);
                navigation.navigate('PlayerPicker', {
                  alreadySelectedIds: tournament.players.map((p) => p.id),
                });
              }}
              activeOpacity={0.7}
            >
              <Feather name="user-plus" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>Add Player</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowSettings(false); navigation.navigate('Stats'); }}
            activeOpacity={0.7}
          >
            <Feather name="bar-chart-2" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Statistics</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => {
              setShowSettings(false);
              navigation.navigate('Members', {
                tournamentId: tournament.id,
                tournamentName: tournament.name,
              });
            }}
            activeOpacity={0.7}
          >
            <Feather name="user-check" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Members</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          {!isViewer && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); navigation.navigate('EditTournament'); }}
              activeOpacity={0.7}
            >
              <Feather name="edit-3" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>{tournament.rounds.length === 1 ? 'Edit Round' : 'Edit Tournament'}</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {!isViewer && (() => {
            const kindLabel = tournament.kind === 'game' ? 'Game' : 'Tournament';
            if (tournament.finishedAt) {
              return (
                <TouchableOpacity
                  style={s.menuItem}
                  onPress={() => { setShowSettings(false); setTournamentFinished(tournament, false); }}
                  activeOpacity={0.7}
                >
                  <Feather name="rotate-ccw" size={18} color={theme.accent.primary} />
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
                <Feather name="flag" size={18} color={theme.accent.primary} />
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
              <Feather name="trash-2" size={18} color={theme.destructive} />
              <Text style={[s.menuItemText, { color: theme.destructive }]}>Delete Tournament</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>

    <ConfirmModal state={confirmState} onResult={resolveConfirm} theme={theme} s={s} />

    </SafeAreaView>
  );
}

// Themed in-app confirmation dialog. Used in place of window.confirm so the
// web build matches the native styling; native uses it too for consistency.
function ConfirmModal({ state, onResult, theme, s }) {
  return (
    <Modal
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
  round, index, width, hasPrev, hasNext, revealed, roundBestBall,
  players, settings, theme, s,
  onGoToRound, onOpenEdit, isSingleRound, showRunning = true,
}) {
  const hasScores = round.scores && Object.keys(round.scores).length > 0;
  const hasPairs = Array.isArray(round.pairs) && round.pairs.length > 0;
  const tournamentMode = settings?.scoringMode === 'bestball' ? 'bestball' : 'stableford';
  const clinchedPairIdx = hasScores
    ? roundPairClinched(round, players, settings, tournamentMode)
    : null;
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
              <Feather name="settings" size={14} color={theme.text.muted} />
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
      {hasScores ? (
        settings?.scoringMode === 'matchplay'
          ? <MatchPlayRoundCard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
          : roundBestBall
            ? <BestBallRoundCard round={round} players={players} settings={settings} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
            : <StablefordRoundCard round={round} players={players} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
      ) : revealed && hasPairs ? (
        <PairsPreviewCard pairs={round.pairs} theme={theme} s={s} />
      ) : (
        <Text style={s.emptyRoundHint}>No scores yet for this round.</Text>
      )}
    </View>
  );
});

// Single-round game overview: course hero with progress and per-player
// stat cards (points / strokes / through / vs par). Replaces the bare
// "ROUND SCORES · Course" + name+points layout for the common case where
// a Game has one round and isn't using match-play or best-ball scoring.
const GameOverviewCard = React.memo(function GameOverviewCard({
  round, players, settings, theme, s, onOpenEdit, showRunning = true,
}) {
  const totalHoles = round?.holes?.length ?? 18;
  const totalPar = (round?.holes ?? []).reduce((sum, h) => sum + (h.par ?? 0), 0);
  const playedByPlayer = players.map((p) => Object.keys(round?.scores?.[p.id] ?? {}).length);
  const holesPlayed = playedByPlayer.length ? Math.max(...playedByPlayer) : 0;
  const progressPct = totalHoles > 0 ? Math.min(100, Math.round((holesPlayed / totalHoles) * 100)) : 0;

  const totals = roundTotals(round, players);
  const totalsById = Object.fromEntries(totals.map((t) => [t.player.id, t]));

  const stats = players.map((p) => {
    const ps = round?.scores?.[p.id] ?? {};
    let strokes = 0;
    let parThrough = 0;
    let played = 0;
    for (const hole of round?.holes ?? []) {
      const sc = ps[hole.number];
      if (sc) {
        strokes += sc;
        parThrough += hole.par ?? 0;
        played++;
      }
    }
    const t = totalsById[p.id];
    return {
      player: p,
      played,
      strokes,
      vsPar: strokes - parThrough,
      points: t?.totalPoints ?? 0,
      handicap: t?.handicap ?? p.handicap ?? 0,
    };
  });

  const ranked = stats.length > 1
    ? [...stats].sort((a, b) => b.points - a.points)
    : stats;
  const anyScores = stats.some((st) => st.played > 0);
  const competitive = ranked.length > 1 && anyScores
    && ranked[0].points !== (ranked[1]?.points ?? 0);

  return (
    <View style={s.gameHeroCard}>
      <View style={s.gameHeroHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.cardTitle}>ROUND</Text>
          <Text style={s.gameHeroCourse} numberOfLines={2}>
            {round?.courseName || '—'}
          </Text>
          <Text style={s.gameHeroMeta}>
            {totalHoles} holes · Par {totalPar || '—'}
          </Text>
        </View>
        {onOpenEdit && (
          <TouchableOpacity
            onPress={() => onOpenEdit(0)}
            style={s.roundEditBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Round options"
          >
            <Feather name="settings" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.gameProgressRow}>
        <View style={s.gameProgressTrack}>
          <View style={[s.gameProgressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={s.gameProgressText}>{holesPlayed} / {totalHoles}</Text>
      </View>

      <View style={{ marginTop: 16, gap: 10 }}>
        {ranked.map((st, idx) => {
          const isLeader = competitive && idx === 0;
          const vsParStr = st.played === 0
            ? '—'
            : st.vsPar === 0 ? 'E' : st.vsPar > 0 ? `+${st.vsPar}` : `${st.vsPar}`;
          return (
            <View
              key={st.player.id}
              style={[s.gamePlayerCard, isLeader && s.gamePlayerCardLeader]}
            >
              <View style={s.gamePlayerHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.gamePlayerName} numberOfLines={1}>
                      {st.player.name}
                    </Text>
                    {isLeader && <Feather name="award" size={14} color="#ffd700" />}
                  </View>
                  <Text style={s.gamePlayerHcp}>HCP {st.handicap}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.gamePlayerPoints}>{showRunning ? st.points : '—'}</Text>
                  <Text style={s.gamePlayerPointsLabel}>pts</Text>
                </View>
              </View>
              <View style={s.gameStatsRow}>
                <View style={s.gameStatCell}>
                  <Text style={s.gameStatValue}>
                    {!showRunning ? '—' : st.played > 0 ? st.strokes : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>Strokes</Text>
                </View>
                <View style={s.gameStatDivider} />
                <View style={s.gameStatCell}>
                  <Text style={s.gameStatValue}>
                    {st.played > 0 ? `${st.played}/${totalHoles}` : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>Through</Text>
                </View>
                <View style={s.gameStatDivider} />
                <View style={s.gameStatCell}>
                  <Text style={[
                    s.gameStatValue,
                    showRunning && st.played > 0 && st.vsPar > 0 && s.gameStatValueWarn,
                    showRunning && st.played > 0 && st.vsPar < 0 && s.gameStatValueGood,
                  ]}>
                    {showRunning ? vsParStr : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>vs Par</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

    </View>
  );
});

// Fallback card shown when a round has revealed pairs but no scores yet.
const PairsPreviewCard = React.memo(function PairsPreviewCard({ pairs, theme, s }) {
  return (
    <>
      {pairs.map((pair, pi) => (
        <View key={pi} style={s.pairBlock}>
          <View style={s.pairHeader}>
            <Text style={s.pairNames}>{pair.map((p) => p.name).join(' & ')}</Text>
            <Text style={s.pairPoints}>—</Text>
          </View>
        </View>
      ))}
      <Text style={s.pairsPreviewHint}>No scores yet. Teams are set for this round.</Text>
    </>
  );
});

const StablefordRoundCard = React.memo(function StablefordRoundCard({ round, players, clinchedPairIdx, theme, s, showRunning = true }) {
  const pairResults = roundPairLeaderboard(round, players);
  // Map sorted-leaderboard position back to round.pairs index so we can
  // tag the winner row with a crown when that pair is mathematically
  // clinched. The leader row (pi === 0) is always first in pairResults.
  const pairIdxFor = (members) => round.pairs.findIndex((pr) => (
    pr.length === members.length && pr.every((p) => members.some((m) => m.player.id === p.id))
  ));
  const competitive = pairResults.length > 1;
  return (
    <>
      {pairResults.map((pair, pi) => {
        const origIdx = pairIdxFor(pair.members);
        const isClinched = clinchedPairIdx != null && origIdx === clinchedPairIdx;
        return (
          <View key={pi} style={[s.pairBlock, showRunning && competitive && pi === 0 && s.winnerBlock]}>
            {showRunning && competitive && pi === 0 && <Text style={s.winnerBadge}>WINNER</Text>}
            <View style={s.pairHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={s.pairNames}>{pair.members.map((m) => m.player.name).join(' & ')}</Text>
                {showRunning && isClinched && <Feather name="award" size={14} color="#ffd700" />}
              </View>
              <Text style={s.pairPoints}>{showRunning ? `${pair.combinedPoints} pts` : '— pts'}</Text>
            </View>
          </View>
        );
      })}
    </>
  );
});

// Match Play: show per-player hole wins, halved count, and match status
// ("Alex 2 UP", "All square", "Alex wins 3&2"). Uses the same .pairBlock /
// .winnerBlock / .winnerBadge styles as the Stableford card so the visual
// rhythm on the round overview stays consistent.
const MatchPlayRoundCard = React.memo(function MatchPlayRoundCard({ round, players, theme, s, showRunning = true }) {
  if (!players || players.length !== 2) {
    return <Text style={s.pairMember}>Match play needs 2 players</Text>;
  }
  const tally = matchPlayRoundTally(round, players);
  if (!tally) return <Text style={s.pairMember}>No results yet</Text>;

  const { aWins, bWins, halved, leaderIdx, lead, clinched, holesLeft } = tally;
  const leader = leaderIdx !== null ? players[leaderIdx] : null;
  const loser = leaderIdx !== null ? players[1 - leaderIdx] : null;

  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const status = leader
    ? clinched
      ? `${firstName(leader)} wins ${lead}&${holesLeft}`
      : `${firstName(leader)} ${lead} UP${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
    : `All square${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;

  // Order rows: leader first (winner), then other.
  const rows = leader
    ? [
        { player: leader, wins: leaderIdx === 0 ? aWins : bWins, isLeader: true },
        { player: loser, wins: leaderIdx === 0 ? bWins : aWins, isLeader: false },
      ]
    : [
        { player: players[0], wins: aWins, isLeader: false },
        { player: players[1], wins: bWins, isLeader: false },
      ];

  return (
    <>
      {rows.map(({ player, wins, isLeader }, i) => (
        <View key={player.id} style={[s.pairBlock, showRunning && clinched && isLeader && s.winnerBlock]}>
          {showRunning && clinched && isLeader && <Text style={s.winnerBadge}>WINNER</Text>}
          <View style={s.pairHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Text style={s.pairNames}>{player.name}</Text>
              {showRunning && clinched && isLeader && <Feather name="award" size={14} color="#ffd700" />}
            </View>
            <Text style={s.pairPoints}>{showRunning ? `${wins} ${wins === 1 ? 'hole' : 'holes'}` : '—'}</Text>
          </View>
        </View>
      ))}
      <Text style={s.pairsPreviewHint}>
        {showRunning ? `${status}${halved > 0 ? ` · ${halved} halved` : ''}` : 'Scores hidden'}
      </Text>
    </>
  );
});

const BestBallRoundCard = React.memo(function BestBallRoundCard({ round, players, settings, clinchedPairIdx, theme, s, showRunning = true }) {
  const result = calcBestWorstBall(round, players);
  if (!result) return <Text style={s.pairMember}>No results yet</Text>;

  const { pair1, pair2, bestBall, worstBall } = result;
  const p1Names = pair1.map((p) => p.name).join(' & ');
  const p2Names = pair2.map((p) => p.name).join(' & ');

  const p1Points = bestBall.pair1 * settings.bestBallValue + worstBall.pair1 * settings.worstBallValue;
  const p2Points = bestBall.pair2 * settings.bestBallValue + worstBall.pair2 * settings.worstBallValue;
  const winner = p1Points > p2Points ? 1 : p2Points > p1Points ? 2 : 0;
  const p1Clinched = clinchedPairIdx === 0;
  const p2Clinched = clinchedPairIdx === 1;

  return (
    <>
      <View style={[s.pairBlock, showRunning && winner === 1 && s.winnerBlock]}>
        {showRunning && winner === 1 && <Text style={s.winnerBadge}>WINNER</Text>}
        <View style={s.pairHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={s.pairNames}>{p1Names}</Text>
            {showRunning && p1Clinched && <Feather name="award" size={14} color="#ffd700" />}
          </View>
          <Text style={s.pairPoints}>{showRunning ? `${p1Points} pts` : '— pts'}</Text>
        </View>
      </View>
      <View style={[s.pairBlock, showRunning && winner === 2 && s.winnerBlock]}>
        {showRunning && winner === 2 && <Text style={s.winnerBadge}>WINNER</Text>}
        <View style={s.pairHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={s.pairNames}>{p2Names}</Text>
            {showRunning && p2Clinched && <Feather name="award" size={14} color="#ffd700" />}
          </View>
          <Text style={s.pairPoints}>{showRunning ? `${p2Points} pts` : '— pts'}</Text>
        </View>
      </View>
    </>
  );
});

const makeStyles = (t) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 16, paddingBottom: 100 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: t.bg.primary },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: 8 },
  headerActions: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  title: { fontFamily: 'PlayfairDisplay-Black', fontSize: 30, color: t.text.primary, letterSpacing: -0.5 },
  backBtn: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  headerTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: t.text.primary, flexShrink: 1, lineHeight: 24 },
  headerTitleLong: { fontSize: 16, lineHeight: 20 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.card,
    borderWidth: 1, borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    alignItems: 'center', justifyContent: 'center',
    ...(t.isDark ? {} : t.shadow.card),
  },

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
    backgroundColor: '#006747',
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
  mastersRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  mastersRowFirst: { borderLeftWidth: 3, borderLeftColor: '#ffd700', paddingLeft: 8, marginLeft: -8 },
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
  mastersPoints: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 16, marginRight: 8 },
  mastersSub: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.45)', fontSize: 11, width: 60, textAlign: 'right' },

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
  gamePlayerCard: {
    borderRadius: 14,
    backgroundColor: t.isDark ? t.bg.secondary : t.bg.secondary,
    borderWidth: 1,
    borderColor: t.border.default,
    padding: 14,
  },
  gamePlayerCardLeader: {
    backgroundColor: t.isDark ? 'rgba(255,215,0,0.06)' : '#fffaeb',
    borderColor: '#ffd700' + '66',
  },
  gamePlayerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  gamePlayerName: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.primary,
    fontSize: 15,
    flexShrink: 1,
  },
  gamePlayerHcp: {
    fontFamily: 'PlusJakartaSans-Medium',
    color: t.text.muted,
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.3,
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
  gameStatsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
    borderRadius: 10,
    paddingVertical: 8,
  },
  gameStatCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  gameStatDivider: {
    width: 1,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    marginVertical: 4,
  },
  gameStatValue: {
    fontFamily: 'PlusJakartaSans-Bold',
    color: t.text.primary,
    fontSize: 15,
  },
  gameStatValueGood: { color: t.accent.primary },
  gameStatValueWarn: { color: t.text.secondary },
  gameStatLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.muted,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 3,
  },
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

  // User avatar
  avatarBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#006747',
    borderWidth: 1, borderColor: t.accent.primary + '66',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffd700', fontSize: 13 },

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
