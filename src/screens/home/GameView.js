import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Switch from '../../components/ui/Switch';
import ScreenContainer from '../../components/ScreenContainer';
import IconButton from '../../components/ui/IconButton';
import PullToRefresh from '../../components/PullToRefresh';
import { ShareableLeaderboard } from '../../components/ShareableCard';
import PostCreateInviteModal from '../../components/PostCreateInviteModal';
import LeaderboardCard from '../../components/LeaderboardCard';
import SettleUpCard from '../../components/SettleUpCard';
import TourOverlay from '../../components/tour/TourOverlay';
import { HOME_TOUR_STEPS } from '../../components/tour/tourSteps';
import { scoringModeUsesTeams, leaderboardToggleLabels } from '../../components/scoringModes';
import {
  tournamentPlayerClinched, isTournamentFinished, tournamentMatchPlayStandings,
  roundLeaderboard, tournamentLeaderboardResolved, DEFAULT_SETTINGS,
} from '../../store/tournamentStore';
import { roundScoringMode, tournamentHasMixedModes, tournamentStablefordLeaderboard } from '../../store/scoring';
import { assignPlacements, comparatorForBoardMode } from '../../store/leaderboardPlacement';
import { getAppSettings, updateAppSettings } from '../../store/settingsStore';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useTabBarScroll, useTabBarClearance } from '../../navigation/tabBarChrome';
import { useT, tr } from '../../i18n';
import ConfirmModal from './ConfirmModal';
import GameShareSheet, { useGameShare } from './GameShareSheet';
import GameSheets from './GameSheets';
import RoundScoresPager from './RoundScoresPager';
import { PastRoundScorecard } from './RoundPage';
import { chooseInitialRound, roundModeLabel, isStrokePlayAlt } from './homeShared';

// One game or tournament: leaderboard, settle-up, round scores (a pager of
// rounds), the round actions bar, and its menus. Keyed by tournament id, so
// opening another game starts from fresh state.
export default function GameView({
  navigation, viewMode, tournament, onTournamentChange, reload, refreshing, onRefresh,
  confirm, confirmState, resolveConfirm, confirmDelete, goToList, quickStart, theme, s,
}) {
  const tx = useT();
  const tabBarScroll = useTabBarScroll();
  const tabBarClearance = useTabBarClearance();
  const [showSettings, setShowSettings] = useState(false);
  const [showRoundEdit, setShowRoundEdit] = useState(false);
  const [showStakes, setShowStakes] = useState(false);
  const [leaderboardAlt, setLeaderboardAlt] = useState(false);
  // false = follows the pager's selected round; true = whole-tournament board.
  // Defaults to true so a multi-round tournament opens on Overall standings;
  // the isGame single-game path ignores this flag entirely.
  const [leaderboardOverall, setLeaderboardOverall] = useState(true);
  const leaderboardRef = useRef();

  // True once the user has picked a round themselves (tab tap, swipe, or
  // round menu). Background reloads (store-change / focus / connectivity)
  // must not snap the pager back to the smart default while this is set —
  // only a tournament switch (a new GameView) or a currentRound advance
  // clears it.
  const userPickedRoundRef = useRef(false);
  const [selectedRound, setSelectedRound] = useState(() => chooseInitialRound(tournament));
  // A reload hands in a new tournament object: follow the smart default
  // unless the user picked a round.
  const [roundsOf, setRoundsOf] = useState(tournament);
  if (roundsOf !== tournament) {
    setRoundsOf(tournament);
    if (!userPickedRoundRef.current) setSelectedRound(chooseInitialRound(tournament));
  }
  // Keep the round pager pinned to the round play is actually on:
  // whenever `currentRound` advances (e.g. the user started the next
  // round from another screen), snap to the smart default.
  useEffect(() => {
    // Play advanced to a new round — the user's previous manual pick is
    // stale, so let the pager (and future reloads) follow play again.
    userPickedRoundRef.current = false;
    setSelectedRound(chooseInitialRound(tournament));
    // Intentionally only re-run when currentRound advances; editing a
    // scorecard doesn't force the pager off the user's manual choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.currentRound]);

  // Shares the same synced setting as ScorecardScreen so that hiding
  // running totals follows the user across screens. No-spoilers mode
  // overrides it, same as on the scorecard.
  const appSettings = useAppSettings();
  const showRunning = appSettings.showRunningScore && !appSettings.noSpoilers;
  const toggleRunning = useCallback(() => {
    updateAppSettings({ showRunningScore: !getAppSettings().showRunningScore }).catch(() => {});
  }, []);

  const isViewer = tournament._role === 'viewer';
  const isOwner = tournament._role === 'owner';
  // Side bets: casual games and tournaments with someone to play against.
  const canHaveStakes = tournament.kind !== 'official' && (tournament.players?.length ?? 0) >= 2;
  const share = useGameShare({ tournament, isOwner, reload, confirm });

  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...(tournament.settings ?? {}) }),
    [tournament.settings],
  );
  // Sync toggle to tournament's scoring mode when it loads/changes.
  useEffect(() => {
    setLeaderboardAlt(false);
  }, [tournament.id, settings.scoringMode]);
  const matchPlayStandings = useMemo(
    () => (settings.scoringMode === 'matchplay'
      ? tournamentMatchPlayStandings(tournament)
      : null),
    [tournament, settings.scoringMode],
  );
  const selectedRoundData = tournament.rounds?.[selectedRound] ?? null;
  // The mode that decides whether team settings apply: the first round whose
  // effective mode is a team mode the roster supports. Null → no team rounds,
  // the gear hides Team Settings entirely.
  const teamSettingsMode = (tournament.rounds ?? [])
    .map((r) => roundScoringMode(tournament, r))
    .find((m) => scoringModeUsesTeams(m, tournament.players.length)) ?? null;
  const isGame = tournament.kind === 'game';
  // Past = the History list's rule: marked finished, or every round fully
  // scored. Past events show hole-by-hole scorecards, not running totals.
  const isPast = isTournamentFinished(tournament);
  // Native mode board for the current scope (selected round, or whole
  // tournament). Casual games are always round-scoped (there's only one).
  const resolvedBoard = useMemo(() => {
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
    () => (!tournamentHasMixedModes(tournament)
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

  const toggleLabels = leaderboardToggleLabels(resolvedBoard.mode);

  // The round actions sit in a bar above the tab bar; without them (a viewer,
  // no rounds) the scroll itself clears the tab bar.
  const hasRoundBar = tournament.rounds.length > 0 && !isViewer;

  function renderRoundBar() {
    const isCurrentRound = selectedRound === tournament.currentRound;
    const canShowNext = isCurrentRound && tournament.currentRound < tournament.rounds.length - 1;
    const nextRound = canShowNext ? tournament.rounds[tournament.currentRound + 1] : null;
    const nextRevealed = nextRound?.revealed;
    return (
      <View style={[s.tournamentBottomBar, { paddingBottom: tabBarClearance - 4 }]}>
        <TouchableOpacity
          style={[s.primaryBtn, s.roundActionBtn]}
          onPress={() => navigation.navigate('Scorecard', { roundIndex: selectedRound, tournamentId: tournament.id })}
          activeOpacity={0.8}
        >
          <Feather name="edit-2" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          <Text style={s.primaryBtnText}>{isCurrentRound ? tx('home.bar.scorecard') : tx('home.bar.editScores')}</Text>
        </TouchableOpacity>
        {canShowNext && (
          nextRevealed ? (
            <TouchableOpacity
              style={[s.secondaryBtn, s.roundActionBtn]}
              onPress={() => navigation.navigate('NextRound', { revealOnly: true, roundIndex: tournament.currentRound + 1 })}
              activeOpacity={0.7}
            >
              <Feather name="eye" size={14} color={theme.accent.primary} />
              <Text style={s.secondaryBtnText}>{tx('home.bar.nextRound')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.primaryBtn, s.roundActionBtn]}
              onPress={() => navigation.navigate('NextRound')}
              activeOpacity={0.8}
            >
              <Feather name="play" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              <Text style={s.primaryBtnText}>{tx('home.bar.startNextRound')}</Text>
            </TouchableOpacity>
          )
        )}
      </View>
    );
  }

  const { postCreateInvite } = quickStart;

  return (
    <ScreenContainer style={s.screen} edges={['top']}>
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
            <IconButton icon="share-2" onPress={share.open} testID="share-hub-button" />
          )}
          <IconButton
            icon="image"
            onPress={() => navigation.navigate('Gallery', { tournamentId: tournament.id })}
            accessibilityLabel={tx('home.header.memoriesA11y')}
          />
          {!appSettings.noSpoilers && (
            <IconButton
              icon={showRunning ? 'eye-off' : 'eye'}
              onPress={toggleRunning}
              accessibilityLabel={showRunning ? tx('home.header.hideRunningA11y') : tx('home.header.showRunningA11y')}
            />
          )}
          <IconButton
            icon="settings"
            onPress={() => setShowSettings(true)}
            accessibilityLabel={tx('home.header.settingsA11y')}
          />
        </View>
      </View>

      <PullToRefresh
        style={s.scrollView}
        contentContainerStyle={[s.content, !hasRoundBar && { paddingBottom: tabBarClearance }]}
        refreshing={refreshing}
        onRefresh={onRefresh}
        {...tabBarScroll}
      >

      {tournament.players.length >= 2 && (
      <LeaderboardCard
        title={leaderboardOverall && !isGame ? tx('home.board.overallTitle') : tx('home.board.roundTitle', { n: selectedRound + 1, mode: roundModeLabel(displayedBoard.mode, tx) })}
        headerRight={resolvedBoard.entries.length > 0 && (
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
        subheader={!isGame && (
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
              <Text style={[s.mastersChipText, leaderboardOverall && s.mastersChipTextActive]}>{tx('home.board.overall')}</Text>
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
                  {tx('home.board.roundChip', { n: index + 1 })}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        rows={rankedLeaderboardEntries.map((entry) => ({
          key: entry.player.id,
          place: entry.place,
          isTie: entry.isTie,
          name: entry.player.name,
          mark: showRunning && entry.player.id === tournamentClinchedId,
          points: !showRunning ? '—' : `${entry.points} ${displayedBoard.unit}`,
          sub: entry.strokes != null ? (!showRunning ? '' : tx('home.board.strokesSub', { strokes: entry.strokes || '-' })) : null,
        }))}
        footer={settings.scoringMode === 'matchplay' && matchPlayStandings && showRunning && !tournamentHasMixedModes(tournament)
          ? tr(matchPlayStandings.status) : null}
        scope={`${leaderboardOverall}-${selectedRound}-${leaderboardAlt}`}
      />
      )}

      {/* Hidden running scores hide the live ledger too: it would give the order away. */}
      {canHaveStakes && (showRunning || isPast) && (
        <SettleUpCard
          tournament={tournament}
          live={!isPast}
          onAddStakes={isViewer ? null : () => setShowStakes(true)}
          cardStyle={s.card}
        />
      )}

      {/* A finished casual game has one round, and its ROUND SCORES card only
          repeats the leaderboard — show the read-only hole-by-hole card instead. */}
      {isGame && isPast && tournament.rounds[0] && (
        <View style={s.card} testID="finished-game-scorecard">
          <PastRoundScorecard
            round={tournament.rounds[0]}
            settings={tournament.settings}
            players={tournament.players}
            meId={tournament.meId}
            s={s}
            title={(
              <View style={s.cardTitleLeft}>
                <Text style={s.cardTitle}>{tx('home.card.scorecardTitle')}</Text>
                {tournament.rounds[0].courseName && (
                  <Text style={s.cardTitleCourse} numberOfLines={1}>{' · '}{tournament.rounds[0].courseName}</Text>
                )}
              </View>
            )}
          />
        </View>
      )}

      {tournament.rounds.length > 0 && !(isGame && isPast) && (
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <View style={s.cardTitleLeft}>
              <Text style={s.cardTitle}>{tx('home.leaderboard.roundScores')}</Text>
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
                  onPress={() => goToRound(index)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.tabText, selectedRound === index && s.tabTextActive]}>
                    {tx('home.board.roundChip', { n: index + 1 })}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}

          <RoundScoresPager
            tournament={tournament}
            isGame={isGame}
            isPast={isPast}
            isViewer={isViewer}
            showRunning={showRunning}
            theme={theme}
            s={s}
            selectedRound={selectedRound}
            onSwipe={goToRound}
            onGoToRound={goToRound}
            onOpenEdit={openRoundEdit}
          />
        </View>
      )}

      <View style={{ position: 'absolute', left: -9999 }}>
        <ShareableLeaderboard ref={leaderboardRef} tournamentName={tournament.name} leaderboard={displayedBoard.entries} />
      </View>
    </PullToRefresh>

    {hasRoundBar && renderRoundBar()}

    <GameShareSheet
      share={share}
      tournament={tournament}
      isOwner={isOwner}
      theme={theme}
      s={s}
      leaderboardEntries={displayedBoard.entries}
      leaderboardRef={leaderboardRef}
    />

    <GameSheets
      navigation={navigation}
      viewMode={viewMode}
      tournament={tournament}
      onTournamentChange={onTournamentChange}
      reload={reload}
      confirmDelete={confirmDelete}
      selectedRound={selectedRound}
      isGame={isGame}
      isViewer={isViewer}
      isOwner={isOwner}
      canHaveStakes={canHaveStakes}
      teamSettingsMode={teamSettingsMode}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
      showRoundEdit={showRoundEdit}
      setShowRoundEdit={setShowRoundEdit}
      showStakes={showStakes}
      setShowStakes={setShowStakes}
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
