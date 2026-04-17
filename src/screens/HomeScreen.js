import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadTournament, loadAllTournaments, saveTournament,
  setActiveTournament, clearActiveTournament,
  deleteTournament,
  tournamentLeaderboard, tournamentBestWorstLeaderboard,
  roundPairLeaderboard, calcBestWorstBall,
  DEFAULT_SETTINGS,
} from '../store/tournamentStore';

export default function HomeScreen({ navigation }) {
  const { theme, mode, toggle } = useTheme();
  const [tournament, setTournament] = useState(null);
  const [allTournaments, setAllTournaments] = useState([]);
  const [activeRoundTab, setActiveRoundTab] = useState(0);
  const [selectedRound, setSelectedRound] = useState(0);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      const [t, all] = await Promise.all([loadTournament(), loadAllTournaments()]);
      setTournament(t);
      setAllTournaments(all);
      if (t) setSelectedRound(t.currentRound);
    });
    return unsubscribe;
  }, [navigation]);

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

  function confirmDelete(t) {
    Alert.alert('Delete Tournament', `Delete "${t.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteTournament(t.id);
          const all = await loadAllTournaments();
          setAllTournaments(all);
          setTournament(null);
        },
      },
    ]);
  }

  const s = makeStyles(theme);

  if (!tournament) {
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

        <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
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
                  <View key={t.id}>
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
                      <TouchableOpacity style={s.deleteCardBtn} onPress={() => confirmDelete(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Feather name="trash-2" size={14} color={theme.destructive} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </View>
                );
              })}
          </>
        )}
        </ScrollView>
      </View>
    );
  }

  const settings = { ...DEFAULT_SETTINGS, ...tournament.settings };
  const isBestBall = settings.scoringMode === 'bestball';

  async function toggleScoringMode() {
    const next = { ...tournament, settings: { ...settings, scoringMode: isBestBall ? 'stableford' : 'bestball' } };
    await saveTournament(next);
    setTournament(next);
  }

  const completedRounds = tournament.rounds.filter(
    (r) => r.scores && Object.keys(r.scores).length > 0,
  );
  const leaderboard = isBestBall
    ? tournamentBestWorstLeaderboard(tournament)
    : tournamentLeaderboard(tournament);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity onPress={goToList} style={s.backBtn} activeOpacity={0.7}>
            <Feather name="chevron-left" size={20} color={theme.accent.primary} />
            <Text style={s.backBtnText}>All</Text>
          </TouchableOpacity>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={toggle} activeOpacity={0.7}>
            <Feather name={mode === 'dark' ? 'sun' : 'moon'} size={18} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
      <View>
        <Text style={s.tournamentDetailName}>{tournament.name}</Text>
      </View>

      <View style={s.modeToggle}>
        <Text style={[s.modeLabel, !isBestBall && s.modeLabelActive]}>Stableford</Text>
        <Switch
          value={isBestBall}
          onValueChange={toggleScoringMode}
          trackColor={{ false: theme.border.default, true: theme.accent.primary }}
          thumbColor="#fff"
        />
        <Text style={[s.modeLabel, isBestBall && s.modeLabelActive]}>Best Ball</Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>LEADERBOARD</Text>
        {leaderboard.map((entry, i) => {
          const rankColors = [theme.semantic.rank.gold, theme.semantic.rank.silver, theme.semantic.rank.bronze];
          const rankColor = rankColors[i] || theme.text.muted;
          return (
            <View key={entry.player.id} style={[s.leaderRow, i === leaderboard.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[s.rankBadge, { backgroundColor: rankColor + '18' }]}>
                <Text style={[s.rankText, { color: rankColor }]}>{i + 1}</Text>
              </View>
              <Text style={[s.playerName, i === 0 && { color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold' }]}>{entry.player.name}</Text>
              <Text style={[s.points, i === 0 && { fontSize: 18 }]}>{entry.points} pts</Text>
              {isBestBall
                ? <Text style={s.subStat}>{entry.bestWins + entry.worstWins} holes</Text>
                : <Text style={s.subStat}>{entry.strokes} str</Text>}
            </View>
          );
        })}
      </View>

      {completedRounds.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>ROUND SCORES</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={completedRounds}
            keyExtractor={(r) => r.id}
            style={s.tabBar}
            renderItem={({ item: round, index }) => (
              <TouchableOpacity
                style={[s.tab, activeRoundTab === index && s.tabActive]}
                onPress={() => setActiveRoundTab(index)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, activeRoundTab === index && s.tabTextActive]}>
                  R{tournament.rounds.indexOf(round) + 1}
                </Text>
              </TouchableOpacity>
            )}
          />
          {(() => {
            const round = completedRounds[activeRoundTab];
            return round ? (
              <>
                <Text style={s.tabRoundTitle}>{round.courseName}</Text>
                {isBestBall
                  ? <BestBallRoundCard round={round} players={tournament.players} settings={settings} theme={theme} s={s} />
                  : <StablefordRoundCard round={round} players={tournament.players} theme={theme} s={s} />}
              </>
            ) : null;
          })()}
        </View>
      )}

      {(() => {
        const dispRound = tournament.rounds[selectedRound];
        const isCurrentRound = selectedRound === tournament.currentRound;
        const canPrev = selectedRound > 0;
        const canNext = selectedRound < tournament.rounds.length - 1;
        return (
          <View style={s.card}>
            <View style={s.roundNavHeader}>
              <TouchableOpacity
                style={[s.roundNavBtn, !canPrev && s.roundNavBtnDisabled]}
                onPress={() => canPrev && setSelectedRound((r) => r - 1)}
                disabled={!canPrev}
                activeOpacity={0.7}
              >
                <Feather name="chevron-left" size={18} color={canPrev ? theme.accent.primary : theme.text.muted} />
              </TouchableOpacity>
              <View style={s.roundNavCenter}>
                <Text style={s.cardTitle}>RONDA {selectedRound + 1}</Text>
                <Text style={s.roundNavCourse}>{dispRound?.courseName}</Text>
              </View>
              <TouchableOpacity
                style={[s.roundNavBtn, !canNext && s.roundNavBtnDisabled]}
                onPress={() => canNext && setSelectedRound((r) => r + 1)}
                disabled={!canNext}
                activeOpacity={0.7}
              >
                <Feather name="chevron-right" size={18} color={canNext ? theme.accent.primary : theme.text.muted} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() => navigation.navigate('NextRound', { revealOnly: true, roundIndex: selectedRound })}
              activeOpacity={0.7}
            >
              <Feather name="eye" size={16} color={theme.accent.primary} />
              <Text style={s.secondaryBtnText}>Reveal Teams</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => navigation.navigate('Scorecard', { roundIndex: selectedRound })}
              activeOpacity={0.8}
            >
              <Feather name="edit-2" size={16} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              <Text style={s.primaryBtnText}>{isCurrentRound ? 'Scorecard' : 'Edit Scores'}</Text>
            </TouchableOpacity>
            {isCurrentRound && tournament.currentRound < tournament.rounds.length - 1 && (
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => navigation.navigate('NextRound')}
                activeOpacity={0.7}
              >
                <Feather name="skip-forward" size={16} color={theme.accent.primary} />
                <Text style={s.secondaryBtnText}>Next Round</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      <View>
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => navigation.navigate('EditTournament')}
          activeOpacity={0.7}
        >
          <Feather name="settings" size={16} color={theme.accent.primary} />
          <Text style={s.secondaryBtnText}>Edit Tournament</Text>
        </TouchableOpacity>
      </View>

      <View style={s.libraryRow}>
        <TouchableOpacity style={s.libraryBtn} onPress={() => navigation.navigate('PlayersLibrary')} activeOpacity={0.7}>
          <Feather name="users" size={16} color={theme.text.secondary} />
          <Text style={s.libraryBtnText}>Players</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.libraryBtn} onPress={() => navigation.navigate('CoursesLibrary')} activeOpacity={0.7}>
          <Feather name="map" size={16} color={theme.text.secondary} />
          <Text style={s.libraryBtnText}>Courses</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete(tournament)} activeOpacity={0.7}>
        <Feather name="trash-2" size={16} color={theme.destructive} />
        <Text style={s.deleteBtnText}>Delete Tournament</Text>
      </TouchableOpacity>
    </ScrollView>
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
  screen: { flex: 1, backgroundColor: t.bg.primary, overflow: 'hidden' },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 16, paddingBottom: 100 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: t.bg.primary },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerActions: { flexDirection: 'row', gap: 8 },
  title: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28, color: t.text.primary, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: t.text.muted, marginTop: 2 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.accent.primary, fontSize: 16 },
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
    borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    ...(t.isDark ? {} : t.shadow.card),
  },
  tournamentCardLeft: { flex: 1 },
  tournamentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tournamentCardName: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 15 },
  tournamentCardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 12, marginBottom: 2 },
  tournamentCardRound: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11 },
  tournamentCardRight: { paddingLeft: 12 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
    backgroundColor: t.accent.light,
  },
  statusBadgeText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.accent.primary, fontSize: 9, letterSpacing: 0.5 },
  statusBadgeFinished: { backgroundColor: t.bg.secondary },
  statusBadgeTextFinished: { color: t.text.muted },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 18 },
  emptySubtitle: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 14, textAlign: 'center' },

  // Tournament detail
  tournamentDetailName: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: t.text.secondary, marginBottom: 16,
  },

  // Scoring mode toggle
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  modeLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 13 },
  modeLabelActive: { color: t.text.primary },

  // Cards
  card: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.card),
  },
  cardTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: t.accent.primary, marginBottom: 14,
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

  // Leaderboard
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  rankBadge: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  playerName: { fontFamily: 'PlusJakartaSans-Medium', flex: 1, color: t.text.secondary, fontSize: 14 },
  points: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary, fontSize: 16, marginRight: 8 },
  subStat: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, width: 60, textAlign: 'right' },

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

  // Library row
  libraryRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  libraryBtn: {
    flex: 1,
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 12, borderWidth: 1, borderColor: t.border.default,
    padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
    ...(t.isDark ? {} : t.shadow.card),
  },
  libraryBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.secondary, fontSize: 13 },

  // Delete
  deleteCardBtn: { position: 'absolute', top: 8, right: 8, padding: 6 },
  deleteBtn: {
    borderRadius: 12, borderWidth: 1, borderColor: t.destructive + '44',
    backgroundColor: t.isDark ? 'rgba(248,113,113,0.06)' : 'transparent',
    padding: 14, alignItems: 'center', marginTop: 12,
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  deleteBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.destructive, fontSize: 14 },
});
