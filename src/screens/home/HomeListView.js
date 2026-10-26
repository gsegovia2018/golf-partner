import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../../components/ScreenContainer';
import IconButton from '../../components/ui/IconButton';
import PressableScale from '../../components/ui/PressableScale';
import PullToRefresh from '../../components/PullToRefresh';
import BottomSheet from '../../components/BottomSheet';
import QuickStartCourses from '../../components/QuickStartCourses';
import PostCreateInviteModal from '../../components/PostCreateInviteModal';
import LeagueListSection from '../../components/LeagueListSection';
import TourOverlay from '../../components/tour/TourOverlay';
import { HOME_TOUR_STEPS } from '../../components/tour/tourSteps';
import { BeforeHero, YourGame } from '../../components/HomePhase';
import LiveScorecard from '../../components/HomeLiveScorecard';
import { beforeModel, liveModel } from '../../store/homePhase';
import { getSwings } from '../../store/swingStore';
import { SWING_STRINGS } from '../../swing/strings';
import { setActiveTournament, isRoundComplete, isTournamentFinished } from '../../store/tournamentStore';
import { roundScoringMode } from '../../store/scoring';
import { useTabBarScroll, useTabBarClearance } from '../../navigation/tabBarChrome';
import { openLiveScorecard } from '../../navigation/openScorecard';
import { useT, formatDate } from '../../i18n';
import ConfirmModal from './ConfirmModal';
import TournamentKindSheet from './TournamentKindSheet';
import { roundModeLabel } from './homeShared';

// The Play tab: the round-lifecycle hero (live / before), start tiles,
// leagues, quick start, Your game, and the games and tournaments in play.
export default function HomeListView({
  navigation, route, theme, s, currentUserId,
  homePhase, needsGender, unreadNotifs, leagueRows, quickStart,
  allTournaments, openableIds, listStale, reloadError, reload, refreshing, onRefresh,
  selectTournament, confirmDelete, confirmState, resolveConfirm,
}) {
  const tx = useT();
  const tabBarScroll = useTabBarScroll();
  const tabBarClearance = useTabBarClearance();
  // List-view overflow menu — surfaces the Course/Player libraries, which
  // otherwise have no entry point here.
  const [showListMenu, setShowListMenu] = useState(false);
  const [showTournamentKindChoice, setShowTournamentKindChoice] = useState(false);

  // Phase hero actions (store/homePhase.js): the scorecard, NextRound and
  // EditTeams read the active tournament, so the phase's one becomes active.
  function openPhaseScorecard({ tournament: t, roundIndex }) {
    return openLiveScorecard(navigation, { tournamentId: t.id, roundIndex });
  }
  async function startPhaseRound(entry) {
    if (!entry.next) return openPhaseScorecard(entry);
    await setActiveTournament(entry.tournament.id);
    navigation.navigate('NextRound');
  }

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
          <View style={[s.tournamentCardLeft, openable && t._role === 'owner' && s.tournamentCardLeftWithDelete]}>
            <View style={s.tournamentCardHeader}>
              <Text style={s.tournamentCardName}>{t.name}</Text>
              {totalRounds > 0 && (
                <View style={s.stateMark}>
                  <View style={[s.stateDot, !isActive && s.stateDotFinished]} />
                  <Text style={[s.stateMarkText, !isActive && s.stateMarkTextFinished]}>
                    {isActive ? tx('home.card.active') : tx('home.card.finished')}
                  </Text>
                </View>
              )}
              {t._role === 'viewer' && (
                <View style={s.viewerBadge}>
                  <Feather name="eye" size={12} color={theme.text.secondary} />
                  <Text style={s.viewerBadgeText}>{tx('home.card.viewer')}</Text>
                </View>
              )}
            </View>
            {metaText ? <Text style={s.tournamentCardMeta}>{metaText}</Text> : null}
            {totalRounds > 0 && (
              <Text style={s.tournamentCardRound}>
                {isGameKind ? (courseName || tx('home.card.singleRound')) : tx('home.card.roundProgress', { played, total: totalRounds })}
              </Text>
            )}
          </View>
          <View style={s.tournamentCardRight}>
            {!openable ? (
              <View style={s.offlineBadge}>
                <Feather name="cloud-off" size={14} color="#c77a0a" />
                <Text style={s.offlineBadgeText}>{tx('home.card.connectionRequired')}</Text>
              </View>
            ) : (
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            )}
          </View>
        </TouchableOpacity>
        {openable && t._role === 'owner' && (
          <View style={s.deleteCardBtn} pointerEvents="box-none">
            <IconButton
              icon="trash-2"
              color={theme.text.secondary}
              onPress={() => confirmDelete(t)}
              accessibilityLabel={tx('home.card.deleteA11y')}
            />
          </View>
        )}
      </View>
    );
  };

  function renderTournamentList() {
    // Newest first by creation time — official tournament ids are UUID
    // strings, so an id subtraction would produce NaN ordering.
    const sorted = allTournaments.slice().sort(
      (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0),
    );
    // Finished games/tournaments live entirely on the History tab —
    // the Play view stays focused on starting and resuming play.
    const active = sorted.filter((t) => !isTournamentFinished(t));
    const games = active.filter((t) => t.kind === 'game');
    const tournaments = active.filter((t) => t.kind !== 'game');
    // A league is still in play: no "nothing here" / "all caught up" line.
    if (active.length === 0 && leagueRows.length > 0) return null;
    if (sorted.length === 0) {
      if (listStale) {
        return (
          <View style={s.staleEmpty}>
            <Feather name="cloud-off" size={44} color={theme.text.muted} />
            <Text style={s.staleEmptyText}>{tx('home.list.offlineEmpty')}</Text>
          </View>
        );
      }
      return (
        <View style={s.listEmpty}>
          <Feather name="flag" size={20} color={theme.accent.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.listEmptyTitle}>{tx('home.list.emptyTitle')}</Text>
            <Text style={s.listEmptyText}>{tx('home.list.emptySub')}</Text>
          </View>
        </View>
      );
    }
    if (active.length === 0) {
      return (
        <View style={s.listEmpty}>
          <Feather name="check-circle" size={20} color={theme.accent.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.listEmptyTitle}>{tx('home.list.caughtUpTitle')}</Text>
            <Text style={s.listEmptyText}>{tx('home.list.caughtUpSub')}</Text>
          </View>
        </View>
      );
    }
    return (
      <>
        {games.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{tx('home.list.sectionGames')}</Text>
            {games.map(renderCard)}
          </>
        )}
        {tournaments.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{tx('home.list.sectionTournaments')}</Text>
            {tournaments.map(renderCard)}
          </>
        )}
      </>
    );
  }

  function renderPhaseHero() {
    const { phase, live, before } = homePhase;
    if (phase === 'live') {
      return (
        <LiveScorecard entry={live} model={liveModel(live, currentUserId)} userId={currentUserId} onOpen={() => openPhaseScorecard(live)} />
      );
    }
    if (phase === 'before') {
      const m = beforeModel(before, currentUserId);
      return (
        <BeforeHero
          model={m}
          modeLabel={roundModeLabel(roundScoringMode(before.tournament, before.round), tx)}
          onStart={() => startPhaseRound(before)}
          onEditTeams={before.next ? null : async () => {
            await setActiveTournament(before.tournament.id);
            navigation.navigate('EditTeams', { roundIndex: before.roundIndex, tournamentId: before.tournament.id });
          }}
        />
      );
    }
    return null;
  }

  const { postCreateInvite } = quickStart;

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <View>
          <Text style={s.headerDate}>{formatDate(new Date())}</Text>
          <Text style={s.title}>Golf Partner</Text>
        </View>
        <View style={s.headerActions}>
          <IconButton
            icon="menu"
            onPress={() => setShowListMenu(true)}
            accessibilityLabel={tx('home.list.menuA11y')}
          />
          <IconButton
            icon="bell"
            onPress={() => navigation.navigate('Notifications')}
            dot={unreadNotifs > 0}
            dotColor={theme.accent.danger ?? '#e5484d'}
            accessibilityLabel={unreadNotifs > 0 ? tx('home.list.notificationsUnreadA11y', { count: unreadNotifs }) : tx('home.list.notificationsA11y')}
          />
        </View>
      </View>

      <PullToRefresh
        style={s.scrollView}
        contentContainerStyle={[s.content, { paddingBottom: tabBarClearance }]}
        refreshing={refreshing}
        onRefresh={onRefresh}
        {...tabBarScroll}
      >
      {needsGender && (
        <TouchableOpacity
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={tx('home.list.completeProfileA11y')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12,
                   borderWidth: 1, borderColor: theme.accent.primary + '55',
                   backgroundColor: theme.accent.light, padding: 12, marginBottom: 12 }}
        >
          <Feather name="user" size={16} color={theme.accent.primary} />
          <Text style={{ fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 13, flex: 1 }}>
            {tx('home.list.completeProfile')}
          </Text>
          <Feather name="chevron-right" size={16} color={theme.accent.primary} />
        </TouchableOpacity>
      )}
      {renderPhaseHero()}
      <Text style={s.startHeading}>{tx('home.list.startPlaying')}</Text>
      <View style={s.startTilesRow}>
        <PressableScale
          style={[s.startTile, s.startTileFeatured]}
          onPress={() => navigation.navigate('Setup', { kind: 'game' })}
          activeScale={0.97}
        >
          <Feather name="flag" size={20} color={theme.text.inverse} />
          <View>
            <Text style={[s.startTileTitle, s.startTileTitleFeatured]}>{tx('home.list.gameTile')}</Text>
            <Text style={[s.startTileSub, s.startTileSubFeatured]}>{tx('home.list.gameTileSub')}</Text>
          </View>
          <View style={[s.startTileCta, s.startTileCtaFeatured]}>
            <Feather name="plus" size={14} color={theme.text.inverse} />
            <Text style={[s.startTileCtaText, { color: theme.text.inverse }]}>{tx('home.list.newGame')}</Text>
          </View>
        </PressableScale>
        <PressableScale
          style={s.startTile}
          onPress={() => setShowTournamentKindChoice(true)}
          activeScale={0.97}
        >
          <Feather name="award" size={20} color={theme.accent.primary} />
          <View>
            <Text style={s.startTileTitle}>{tx('home.list.tournamentTile')}</Text>
            <Text style={s.startTileSub}>{tx('home.list.tournamentTileSub')}</Text>
          </View>
          <View style={s.startTileCta}>
            <Feather name="plus" size={14} color={theme.accent.primary} />
            <Text style={s.startTileCtaText}>{tx('home.list.newTournament')}</Text>
          </View>
        </PressableScale>
      </View>

      <LeagueListSection navigation={navigation} rows={leagueRows} />

      <QuickStartCourses
        courses={quickStart.courses}
        coursesLoading={quickStart.coursesLoading}
        players={quickStart.players}
        currentUserId={currentUserId}
        playersLoading={quickStart.playersLoading}
        playersError={quickStart.playersError}
        starting={quickStart.starting}
        onManage={() => navigation.navigate('CoursePicker', { mode: 'favorites' })}
        onRetryPlayers={quickStart.loadPlayers}
        onStart={quickStart.start}
        onEditDetails={quickStart.editDetails}
        openCourseId={route?.params?.quickStartCourseId ?? null}
        onCourseOpened={() => navigation.setParams({ quickStartCourseId: undefined })}
      />

      <YourGame
        swingLine={(() => {
          const sw = getSwings().find((x) => x.mainFault && x.status !== 'error');
          return sw ? (SWING_STRINGS.fault[sw.mainFault] ?? sw.mainFault) : null;
        })()}
        onSwing={() => navigation.navigate('SwingHome')}
        onCoach={() => navigation.navigate('MyStats', { tab: 'coach' })}
      />

      {reloadError && (
        <View style={s.errorCard}>
          <Feather name="alert-triangle" size={14} color={theme.destructive} />
          <View style={{ flex: 1 }}>
            <Text style={s.errorCardTitle}>{tx('home.list.loadErrorTitle')}</Text>
            <Text style={s.errorCardText}>{reloadError}</Text>
          </View>
          <TouchableOpacity style={s.errorRetryBtn} onPress={reload} activeOpacity={0.8}>
            <Feather name="refresh-cw" size={14} color={theme.accent.primary} />
            <Text style={s.errorRetryText}>{tx('home.list.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {listStale && allTournaments.length > 0 && (
        <View style={s.staleBanner}>
          <Feather name="cloud-off" size={14} color="#c77a0a" />
          <Text style={s.staleBannerText}>{tx('home.list.offlineBanner')}</Text>
        </View>
      )}

      {renderTournamentList()}
      </PullToRefresh>

      <BottomSheet visible={showListMenu} onClose={() => setShowListMenu(false)} sheetStyle={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>{tx('home.list.menuTitle')}</Text>

        <TouchableOpacity
          style={s.menuItem}
          onPress={() => { setShowListMenu(false); navigation.navigate('CoursesLibrary'); }}
          activeOpacity={0.7}
        >
          <Feather name="map" size={14} color={theme.text.primary} />
          <Text style={s.menuItemText}>{tx('home.list.menuCourses')}</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.menuItem}
          onPress={() => { setShowListMenu(false); navigation.navigate('PlayersLibrary'); }}
          activeOpacity={0.7}
        >
          <Feather name="user" size={14} color={theme.text.primary} />
          <Text style={s.menuItemText}>{tx('home.list.menuPlayers')}</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.menuItem, { borderBottomWidth: 0 }]}
          onPress={() => { setShowListMenu(false); navigation.navigate('JoinTournament'); }}
          activeOpacity={0.7}
        >
          <Feather name="link" size={14} color={theme.text.primary} />
          <Text style={s.menuItemText}>{tx('home.list.joinTitle')}</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </TouchableOpacity>
      </BottomSheet>

      <TournamentKindSheet
        visible={showTournamentKindChoice}
        onClose={() => setShowTournamentKindChoice(false)}
        navigation={navigation}
        theme={theme}
        s={s}
      />

      <PostCreateInviteModal
        visible={postCreateInvite.visible}
        loading={postCreateInvite.loading}
        link={postCreateInvite.link}
        error={postCreateInvite.error}
        onRequestClose={quickStart.requestClosePostCreateInvite}
        onShare={quickStart.sharePostCreateInvite}
      />

      <ConfirmModal state={confirmState} onResult={resolveConfirm} s={s} />

      <TourOverlay chapter="home" steps={HOME_TOUR_STEPS} />
    </ScreenContainer>
  );
}
