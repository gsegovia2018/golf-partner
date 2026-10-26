import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import TourOverlay from '../components/tour/TourOverlay';
import { HOME_TOUR_STEPS } from '../components/tour/tourSteps';
import { setPlayCue, liveCue, quickStartCue } from '../store/playCue';
import { afterTabSettles } from '../navigation/tabSettle';
import { useTheme } from '../theme/ThemeContext';
import { loadProfile } from '../store/profileStore';
import { liveModel } from '../store/homePhase';
import { useHomePhase } from '../hooks/useHomePhase';
import {
  loadAllTournaments, loadAllTournamentsWithFallback, setActiveTournament, deleteTournament,
  getActiveTournamentSnapshot, getTournamentSnapshot,
} from '../store/tournamentStore';
import { useMyLeagueRows } from '../hooks/useMyLeagueRows';
import { unreadCount } from '../store/notificationStore';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { makeStyles } from './home/homeStyles';
import { useConfirm } from './home/ConfirmModal';
import { useHomeTournaments } from './home/useHomeTournaments';
import { useQuickStart } from './home/useQuickStart';
import HomeListView from './home/HomeListView';
import GameView from './home/GameView';
import TournamentKindSheet from './home/TournamentKindSheet';

export { chooseInitialRound } from './home/homeShared';

const NO_TOURNAMENTS = [];

// One screen, three routes: the Play tab (`viewMode: 'list'`), a game or
// tournament (`'tournament'`, or `'auto'` with a tournament to show), and the
// "no active game" page. The views live in ./home/.
export default function HomeScreen({ navigation, route }) {
  const viewMode = route?.params?.viewMode ?? 'auto';
  const routeTournamentId = route?.params?.tournamentId ?? null;
  const { theme } = useTheme();
  const tx = useT();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const leagueRows = useMyLeagueRows(navigation, currentUserId);
  const [needsGender, setNeedsGender] = useState(false);
  useEffect(() => {
    let alive = true;
    const refreshGender = () => {
      loadProfile()
        .then((p) => { if (alive) setNeedsGender(!!p && !p.gender); })
        .catch(() => {});
    };
    refreshGender();
    const unsubFocus = navigation.addListener('focus', () => afterTabSettles(refreshGender));
    return () => { alive = false; unsubFocus(); };
  }, [navigation]);
  const initialTournament = useMemo(
    () => (routeTournamentId ? getTournamentSnapshot(routeTournamentId) : getActiveTournamentSnapshot()),
    [routeTournamentId],
  );
  const {
    tournament, setTournament,
    allTournaments, setAllTournaments,
    listStale, setListStale,
    openableIds, setOpenableIds,
    loading, reloadError, reload,
    refreshing, onRefresh,
  } = useHomeTournaments({ navigation, routeTournamentId, initialTournament });
  // The tournament detail view (same component) has no phase hero.
  const homePhase = useHomePhase(viewMode === 'tournament' ? NO_TOURNAMENTS : allTournaments, currentUserId);
  const hasAutoOpenedRef = useRef(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [showTournamentKindChoice, setShowTournamentKindChoice] = useState(false);
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const quickStart = useQuickStart({
    navigation,
    currentUserId,
    onCreated: (created) => {
      setTournament(created);
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
    },
  });

  // Unread-notification badge — refreshes whenever the screen regains focus.
  useEffect(() => {
    const refresh = () => {
      unreadCount().then(setUnreadNotifs).catch(() => {});
    };
    refresh();
    const unsubFocus = navigation.addListener('focus', () => afterTabSettles(refresh));
    return unsubFocus;
  }, [navigation]);

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

  // The tab bar's live strip and Play hold menu (store/playCue.js) come
  // from the Play tab itself, the one Home instance that is always mounted.
  const publishesPlayCue = viewMode === 'list';
  const cueLive = homePhase.phase === 'live' ? homePhase.live : null;
  useEffect(() => {
    if (!publishesPlayCue) return;
    setPlayCue({
      live: cueLive ? liveCue(cueLive, liveModel(cueLive, currentUserId)) : null,
      quickStart: quickStartCue(quickStart.courses),
    });
  }, [publishesPlayCue, cueLive, currentUserId, quickStart.courses]);
  useEffect(() => (publishesPlayCue ? () => setPlayCue(null) : undefined), [publishesPlayCue]);

  async function confirmDelete(t) {
    const confirmed = await confirm({
      title: tx(t?.kind === 'game' ? 'home.delete.gameTitle' : 'home.delete.tournamentTitle'),
      message: tx('home.delete.message', { name: t.name }),
      confirmLabel: tx('home.delete.confirm'),
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
      const deleteFailed = err.message ?? tx(t?.kind === 'game' ? 'home.delete.gameError' : 'home.delete.tournamentError');
      if (Platform.OS === 'web') window.alert(deleteFailed);
      else Alert.alert(tx('home.common.error'), deleteFailed);
    }
  }

  const showList = viewMode === 'list' || (viewMode === 'auto' && !tournament);
  const showTournament = viewMode === 'tournament' || (viewMode === 'auto' && !!tournament);

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
      <HomeListView
        navigation={navigation}
        route={route}
        theme={theme}
        s={s}
        currentUserId={currentUserId}
        homePhase={homePhase}
        needsGender={needsGender}
        unreadNotifs={unreadNotifs}
        leagueRows={leagueRows}
        quickStart={quickStart}
        allTournaments={allTournaments}
        openableIds={openableIds}
        listStale={listStale}
        reloadError={reloadError}
        reload={reload}
        refreshing={refreshing}
        onRefresh={onRefresh}
        selectTournament={selectTournament}
        confirmDelete={confirmDelete}
        confirmState={confirmState}
        resolveConfirm={resolveConfirm}
      />
    );
  }

  if (showTournament && !tournament) {
    return (
      <ScreenContainer style={[s.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="flag" size={44} color={theme.text.muted} />
          <Text style={[s.emptyTitle, { marginTop: 16 }]}>{tx('home.noActive.title')}</Text>
          <Text style={[s.emptySubtitle, { marginTop: 6, marginBottom: 8 }]}>
            {tx('home.noActive.sub')}
          </Text>
          <TouchableOpacity
            style={[s.primaryBtn, s.emptyStateBtn]}
            onPress={() => navigation.navigate('Setup', { kind: 'game' })}
            activeOpacity={0.8}
          >
            <Feather name="flag" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.primaryBtnText}>{tx('home.noActive.startGame')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, s.emptyStateBtn]}
            onPress={() => setShowTournamentKindChoice(true)}
            activeOpacity={0.8}
          >
            <Feather name="award" size={14} color={theme.accent.primary} />
            <Text style={s.secondaryBtnText}>{tx('home.noActive.startTournament')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, s.emptyStateBtn]}
            onPress={goToList}
            activeOpacity={0.8}
          >
            <Feather name="home" size={14} color={theme.accent.primary} />
            <Text style={s.secondaryBtnText}>{tx('home.noActive.goHome')}</Text>
          </TouchableOpacity>
        </View>

        <TournamentKindSheet
          visible={showTournamentKindChoice}
          onClose={() => setShowTournamentKindChoice(false)}
          navigation={navigation}
          theme={theme}
          s={s}
        />

        <TourOverlay chapter="home" steps={HOME_TOUR_STEPS} />
      </ScreenContainer>
    );
  }

  return (
    <GameView
      key={tournament.id}
      navigation={navigation}
      viewMode={viewMode}
      tournament={tournament}
      onTournamentChange={setTournament}
      reload={reload}
      refreshing={refreshing}
      onRefresh={onRefresh}
      confirm={confirm}
      confirmState={confirmState}
      resolveConfirm={resolveConfirm}
      confirmDelete={confirmDelete}
      goToList={goToList}
      quickStart={quickStart}
      theme={theme}
      s={s}
    />
  );
}
