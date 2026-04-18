import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, FlatList, Platform, Modal, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { ShareableLeaderboard, shareLeaderboard } from '../components/ShareableCard';
import PullToRefresh from '../components/PullToRefresh';
import {
  loadTournament, loadAllTournaments,
  setActiveTournament, clearActiveTournament,
  deleteTournament,
  tournamentLeaderboard, tournamentBestWorstLeaderboard,
  roundPairLeaderboard, calcBestWorstBall,
  DEFAULT_SETTINGS,
} from '../store/tournamentStore';

export default function HomeScreen({ navigation, viewMode = 'auto' }) {
  const { theme, mode, toggle } = useTheme();
  const [tournament, setTournament] = useState(null);
  const [allTournaments, setAllTournaments] = useState([]);
  const [selectedRound, setSelectedRound] = useState(0);
  const [roundPagerWidth, setRoundPagerWidth] = useState(0);
  const roundPagerRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [leaderboardBestBall, setLeaderboardBestBall] = useState(false);
  const [roundBestBall, setRoundBestBall] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const [t, all] = await Promise.all([loadTournament(), loadAllTournaments()]);
    setTournament(t);
    setAllTournaments(all);
    if (t) setSelectedRound(t.currentRound);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', reload);
    return unsubscribe;
  }, [navigation, reload]);

  // Keep round pager in sync with selectedRound (from tab taps)
  useEffect(() => {
    if (!roundPagerRef.current || roundPagerWidth <= 0) return;
    roundPagerRef.current.scrollTo({ x: selectedRound * roundPagerWidth, animated: false });
  }, [selectedRound, roundPagerWidth]);

  async function selectTournament(id) {
    await setActiveTournament(id);
    const all = await loadAllTournaments();
    const t = all.find((x) => x.id === id) ?? null;
    setTournament(t);
  }

  async function goToList() {
    await clearActiveTournament();
    setTournament(null);
  }

  async function confirmDelete(t) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Delete "${t.name}"? This cannot be undone.`)
      : await new Promise((resolve) => Alert.alert(
          'Delete Tournament', `Delete "${t.name}"? This cannot be undone.`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Delete', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await deleteTournament(t.id);
      const all = await loadAllTournaments();
      setAllTournaments(all);
      setTournament(null);
    } catch (err) {
      if (Platform.OS === 'web') window.alert(err.message ?? 'Could not delete tournament');
      else Alert.alert('Error', err.message ?? 'Could not delete tournament');
    }
  }

  const s = makeStyles(theme);
  const leaderboardRef = useRef();

  const showList = viewMode === 'list' || (viewMode === 'auto' && !tournament);
  const showTournament = viewMode === 'tournament' || (viewMode === 'auto' && !!tournament);

  if (showList) {
    return (
      <View style={s.screen}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Golf Partner</Text>
            <Text style={s.subtitle}>{allTournaments.length} {allTournaments.length === 1 ? 'tournament' : 'tournaments'}</Text>
          </View>
          <View style={s.headerActions}>
            <TouchableOpacity style={s.iconBtn} onPress={toggle} activeOpacity={0.7}>
              <Feather name={mode === 'dark' ? 'sun' : 'moon'} size={18} color={theme.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('PlayersLibrary')} activeOpacity={0.7}>
              <Feather name="users" size={18} color={theme.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('CoursesLibrary')} activeOpacity={0.7}>
              <Feather name="map" size={18} color={theme.accent.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <PullToRefresh
          style={s.scrollView}
          contentContainerStyle={s.content}
          refreshing={refreshing}
          onRefresh={onRefresh}
        >
        <View>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.navigate('Setup')} activeOpacity={0.8}>
            <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.primaryBtnText}>New Tournament</Text>
          </TouchableOpacity>
        </View>

        {allTournaments.length === 0 ? (
          <View style={s.emptyState}>
            <Feather name="flag" size={48} color={theme.text.muted} />
            <Text style={s.emptyTitle}>No tournaments yet</Text>
            <Text style={s.emptySubtitle}>Create your first tournament to start playing</Text>
          </View>
        ) : (
          <>
            <Text style={s.sectionLabel}>TOURNAMENTS</Text>
            {allTournaments
              .slice()
              .sort((a, b) => b.id - a.id)
              .map((t, index) => {
                const played = t.rounds.filter((r) => r.scores && Object.keys(r.scores).length > 0).length;
                const isActive = played < t.rounds.length;
                return (
                  <View key={t.id} style={s.tournamentCardWrapper}>
                    <TouchableOpacity style={s.tournamentCard} onPress={() => selectTournament(t.id)} activeOpacity={0.7}>
                      <View style={s.tournamentCardLeft}>
                        <View style={s.tournamentCardHeader}>
                          <Text style={s.tournamentCardName}>{t.name}</Text>
                          <View style={[s.statusBadge, !isActive && s.statusBadgeFinished]}>
                            <Text style={[s.statusBadgeText, !isActive && s.statusBadgeTextFinished]}>
                              {isActive ? 'Active' : 'Finished'}
                            </Text>
                          </View>
                        </View>
                        <Text style={s.tournamentCardMeta}>
                          {t.players.map((p) => p.name.split(' ')[0]).join(' · ')}
                        </Text>
                        <Text style={s.tournamentCardRound}>Round {played}/{t.rounds.length}</Text>
                      </View>
                      <View style={s.tournamentCardRight}>
                        <Feather name="chevron-right" size={18} color={theme.text.muted} />
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.deleteCardBtn} onPress={() => confirmDelete(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Feather name="trash-2" size={14} color={theme.destructive} />
                    </TouchableOpacity>
                  </View>
                );
              })}
          </>
        )}
        </PullToRefresh>
      </View>
    );
  }

  if (showTournament && !tournament) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Feather name="flag" size={48} color={theme.text.muted} />
        <Text style={[s.emptyTitle, { marginTop: 16 }]}>No active tournament</Text>
        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 20 }]}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.8}
        >
          <Text style={s.primaryBtnText}>Go to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const settings = { ...DEFAULT_SETTINGS, ...tournament.settings };

  const completedRounds = tournament.rounds.filter(
    (r) => r.scores && Object.keys(r.scores).length > 0,
  );

  const leaderboard = tournamentLeaderboard(tournament);
  const bestWorstLeaderboard = leaderboardBestBall ? tournamentBestWorstLeaderboard(tournament) : null;

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity onPress={goToList} style={s.backBtn} activeOpacity={0.7}>
            <Feather name="chevron-left" size={20} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>{tournament.name}</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={toggle} activeOpacity={0.7}>
            <Feather name={mode === 'dark' ? 'sun' : 'moon'} size={18} color={theme.accent.primary} />
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

      <View style={s.mastersCard}>
        <View style={s.cardTitleRow}>
          <Text style={s.mastersCardTitle}>LEADERBOARD</Text>
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
        </View>
        {leaderboard.map((entry, i) => {
          const rankColors = ['#ffd700', '#c0c8d4', '#daa06d'];
          const rankColor = rankColors[i] || 'rgba(255,255,255,0.4)';
          const rankBg = i === 0 ? 'rgba(255,215,0,0.2)' : i === 1 ? 'rgba(192,200,212,0.15)' : i === 2 ? 'rgba(218,160,109,0.15)' : 'rgba(255,255,255,0.08)';
          return (
            <View key={entry.player.id} style={[s.mastersRow, i === 0 && s.mastersRowFirst, i === leaderboard.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[s.mastersRankBadge, { backgroundColor: rankBg }]}>
                <Text style={[s.mastersRankText, { color: rankColor }]}>{i + 1}</Text>
              </View>
              <Text style={[s.mastersName, i === 0 && { fontFamily: 'PlusJakartaSans-Bold' }]}>{entry.player.name}</Text>
              <Text style={[s.mastersPoints, i === 0 && { fontSize: 18 }]}>{entry.points} pts</Text>
              {leaderboardBestBall
                ? <Text style={s.mastersSub}>{(bestWorstLeaderboard?.find((e) => e.player.id === entry.player.id)?.bestWins ?? 0) + (bestWorstLeaderboard?.find((e) => e.player.id === entry.player.id)?.worstWins ?? 0)} holes</Text>
                : <Text style={s.mastersSub}>{entry.strokes} str</Text>}
            </View>
          );
        })}
      </View>

      {tournament.rounds.length > 0 && (
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>ROUND SCORES</Text>
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
          </View>
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

          {/* Horizontal pager — swipe to change round, stays in sync with tabs */}
          <View style={s.roundPagerWrap} onLayout={(e) => setRoundPagerWidth(e.nativeEvent.layout.width)}>
            {roundPagerWidth > 0 && (
              <ScrollView
                ref={roundPagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / roundPagerWidth);
                  if (idx !== selectedRound) setSelectedRound(idx);
                }}
                contentOffset={{ x: selectedRound * roundPagerWidth, y: 0 }}
              >
                {tournament.rounds.map((round, i) => {
                  const hasScores = round.scores && Object.keys(round.scores).length > 0;
                  const isCurrentRound = i === tournament.currentRound;
                  return (
                    <View key={round.id} style={{ width: roundPagerWidth }}>
                      <Text style={s.tabRoundTitle}>RONDA {i + 1} · {round.courseName || '—'}</Text>
                      {hasScores ? (
                        roundBestBall
                          ? <BestBallRoundCard round={round} players={tournament.players} settings={settings} theme={theme} s={s} />
                          : <StablefordRoundCard round={round} players={tournament.players} theme={theme} s={s} />
                      ) : (
                        <Text style={s.emptyRoundHint}>No scores yet for this round.</Text>
                      )}
                      <View style={s.roundActionsRow}>
                        <TouchableOpacity
                          style={[s.primaryBtn, s.roundActionBtn]}
                          onPress={() => navigation.navigate('Scorecard', { roundIndex: i })}
                          activeOpacity={0.8}
                        >
                          <Feather name="edit-2" size={16} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                          <Text style={s.primaryBtnText}>{isCurrentRound ? 'Scorecard' : 'Edit Scores'}</Text>
                        </TouchableOpacity>
                        {isCurrentRound && tournament.currentRound < tournament.rounds.length - 1 && (() => {
                          const nextRound = tournament.rounds[tournament.currentRound + 1];
                          const nextRevealed = nextRound?.revealed;
                          return nextRevealed ? (
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
                          );
                        })()}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      <View style={{ position: 'absolute', left: -9999 }}>
        <ShareableLeaderboard ref={leaderboardRef} tournamentName={tournament.name} leaderboard={leaderboard} />
      </View>
    </PullToRefresh>

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

          {(() => {
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

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowSettings(false); shareLeaderboard({ tournamentName: tournament.name, leaderboard, theme, viewRef: leaderboardRef }); }}
            activeOpacity={0.7}
          >
            <Feather name="share-2" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Share Leaderboard</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

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
            onPress={() => { setShowSettings(false); navigation.navigate('PlayersLibrary'); }}
            activeOpacity={0.7}
          >
            <Feather name="users" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Players</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowSettings(false); navigation.navigate('CoursesLibrary'); }}
            activeOpacity={0.7}
          >
            <Feather name="map" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Courses</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.menuItem}
            onPress={() => { setShowSettings(false); navigation.navigate('EditTournament'); }}
            activeOpacity={0.7}
          >
            <Feather name="edit-3" size={18} color={theme.accent.primary} />
            <Text style={s.menuItemText}>Edit Tournament</Text>
            <Feather name="chevron-right" size={16} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.menuItem, s.menuItemDestructive]}
            onPress={() => { setShowSettings(false); confirmDelete(tournament); }}
            activeOpacity={0.7}
          >
            <Feather name="trash-2" size={18} color={theme.destructive} />
            <Text style={[s.menuItemText, { color: theme.destructive }]}>Delete Tournament</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
    </View>
  );
}

function StablefordRoundCard({ round, players, theme, s }) {
  const pairResults = roundPairLeaderboard(round, players);
  return (
    <>
      {pairResults.map((pair, pi) => (
        <View key={pi} style={[s.pairBlock, pi === 0 && s.winnerBlock]}>
          {pi === 0 && <Text style={s.winnerBadge}>WINNER</Text>}
          <View style={s.pairHeader}>
            <Text style={s.pairNames}>{pair.members.map((m) => m.player.name).join(' & ')}</Text>
            <Text style={s.pairPoints}>{pair.combinedPoints} pts</Text>
          </View>
          {pair.members.map((m) => (
            <Text key={m.player.id} style={s.pairMember}>
              {m.player.name}  {m.totalPoints} pts · {m.totalStrokes} strokes
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

function BestBallRoundCard({ round, players, settings, theme, s }) {
  const result = calcBestWorstBall(round, players);
  if (!result) return <Text style={s.pairMember}>No results yet</Text>;

  const { pair1, pair2, bestBall, worstBall } = result;
  const p1Names = pair1.map((p) => p.name).join(' & ');
  const p2Names = pair2.map((p) => p.name).join(' & ');

  const p1Points = bestBall.pair1 * settings.bestBallValue + worstBall.pair1 * settings.worstBallValue;
  const p2Points = bestBall.pair2 * settings.bestBallValue + worstBall.pair2 * settings.worstBallValue;
  const winner = p1Points > p2Points ? 1 : p2Points > p1Points ? 2 : 0;

  return (
    <>
      <View style={[s.pairBlock, winner === 1 && s.winnerBlock]}>
        {winner === 1 && <Text style={s.winnerBadge}>WINNER</Text>}
        <View style={s.pairHeader}>
          <Text style={s.pairNames}>{p1Names}</Text>
          <Text style={s.pairPoints}>{p1Points} pts</Text>
        </View>
      </View>
      <View style={[s.pairBlock, winner === 2 && s.winnerBlock]}>
        {winner === 2 && <Text style={s.winnerBadge}>WINNER</Text>}
        <View style={s.pairHeader}>
          <Text style={s.pairNames}>{p2Names}</Text>
          <Text style={s.pairPoints}>{p2Points} pts</Text>
        </View>
      </View>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 16, paddingBottom: 100 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: t.bg.primary },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerActions: { flexDirection: 'row', gap: 8 },
  title: { fontFamily: 'PlayfairDisplay-Black', fontSize: 30, color: t.text.primary, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: t.text.muted, marginTop: 2 },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: t.text.primary, flexShrink: 1 },
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

  // Tournament list
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.muted, fontSize: 10, letterSpacing: 1.5,
    marginBottom: 12, marginTop: 20, textTransform: 'uppercase',
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

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 18 },
  emptySubtitle: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 14, textAlign: 'center' },

  // Card title row with inline toggle
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
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
  tabRoundTitle: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, marginBottom: 12 },
  roundPagerWrap: {},
  emptyRoundHint: {
    fontFamily: 'PlusJakartaSans-Regular',
    color: t.text.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
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
  mastersName: { fontFamily: 'PlusJakartaSans-Medium', flex: 1, color: '#ffffff', fontSize: 14 },
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

  // Round action row (Scorecard + Next Round side-by-side)
  roundActionsRow: { flexDirection: 'row', gap: 10 },
  roundActionBtn: { flex: 1, marginTop: 0 },

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
});
