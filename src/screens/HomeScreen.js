import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, FlatList } from 'react-native';
import {
  loadTournament, loadAllTournaments, saveTournament,
  setActiveTournament, clearActiveTournament,
  deleteTournament,
  tournamentLeaderboard, tournamentBestWorstLeaderboard,
  roundPairLeaderboard, calcBestWorstBall,
  DEFAULT_SETTINGS,
} from '../store/tournamentStore';

export default function HomeScreen({ navigation }) {
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

  if (!tournament) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Golf</Text>

        {allTournaments.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TOURNAMENTS</Text>
            {allTournaments
              .slice()
              .sort((a, b) => b.id - a.id)
              .map((t) => {
                const played = t.rounds.filter((r) => r.scores && Object.keys(r.scores).length > 0).length;
                return (
                  <View key={t.id} style={styles.tournamentCard}>
                    <TouchableOpacity style={styles.tournamentCardLeft} onPress={() => selectTournament(t.id)}>
                      <Text style={styles.tournamentCardName}>{t.name}</Text>
                      <Text style={styles.tournamentCardMeta}>
                        {t.players.map((p) => p.name.split(' ')[0]).join(' · ')}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.tournamentCardRight}>
                      <Text style={styles.tournamentCardRound}>Round {played}/{t.rounds.length}</Text>
                      <Text style={styles.tournamentCardChevron}>›</Text>
                    </View>
                    <TouchableOpacity style={styles.deleteCardBtn} onPress={() => confirmDelete(t)}>
                      <Text style={styles.deleteCardBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
          </>
        )}

        <TouchableOpacity style={[styles.btn, allTournaments.length > 0 && styles.btnSecondary]} onPress={() => navigation.navigate('Setup')}>
          <Text style={styles.btnText}>+ New Tournament</Text>
        </TouchableOpacity>
        <View style={styles.libraryRow}>
          <TouchableOpacity style={styles.libraryBtn} onPress={() => navigation.navigate('PlayersLibrary')}>
            <Text style={styles.libraryBtnText}>Players Library</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.libraryBtn} onPress={() => navigation.navigate('CoursesLibrary')}>
            <Text style={styles.libraryBtnText}>Courses Library</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={goToList} style={styles.backLink}>
          <Text style={styles.backLinkText}>‹ All</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Golf</Text>
      </View>
      <Text style={styles.tournamentName}>{tournament.name}</Text>

      <View style={styles.modeToggle}>
        <Text style={[styles.modeLabel, !isBestBall && styles.modeLabelActive]}>Stableford</Text>
        <Switch
          value={isBestBall}
          onValueChange={toggleScoringMode}
          trackColor={{ false: '#30363d', true: '#2ea043' }}
          thumbColor="#fff"
        />
        <Text style={[styles.modeLabel, isBestBall && styles.modeLabelActive]}>Best Ball</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Leaderboard</Text>
        {leaderboard.map((entry, i) => {
          const rankColor = i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#c47c3a' : '#364f68';
          return (
            <View key={entry.player.id} style={[styles.leaderRow, i === leaderboard.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={[styles.rank, { color: rankColor }]}>{i + 1}</Text>
              <Text style={[styles.playerName, i === 0 && { color: '#f1f5f9', fontWeight: '700' }]}>{entry.player.name}</Text>
              <Text style={[styles.points, i === 0 && { fontSize: 18 }]}>{entry.points} pts</Text>
              {isBestBall
                ? <Text style={styles.subStat}>{entry.bestWins + entry.worstWins} holes</Text>
                : <Text style={styles.subStat}>{entry.strokes} str</Text>}
            </View>
          );
        })}
      </View>

      {completedRounds.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Round Scores</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={completedRounds}
            keyExtractor={(r) => r.id}
            style={styles.tabBar}
            renderItem={({ item: round, index }) => (
              <TouchableOpacity
                style={[styles.tab, activeRoundTab === index && styles.tabActive]}
                onPress={() => setActiveRoundTab(index)}
              >
                <Text style={[styles.tabText, activeRoundTab === index && styles.tabTextActive]}>
                  R{tournament.rounds.indexOf(round) + 1}
                </Text>
              </TouchableOpacity>
            )}
          />
          {(() => {
            const round = completedRounds[activeRoundTab];
            const roundIndex = tournament.rounds.indexOf(round);
            return round ? (
              <>
                <Text style={styles.tabRoundTitle}>{round.courseName}</Text>
                {isBestBall
                  ? <BestBallRoundCard round={round} players={tournament.players} settings={settings} />
                  : <StablefordRoundCard round={round} players={tournament.players} />}
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
          <View style={styles.card}>
            <View style={styles.roundNavHeader}>
              <TouchableOpacity
                style={[styles.roundNavBtn, !canPrev && styles.roundNavBtnDisabled]}
                onPress={() => canPrev && setSelectedRound((r) => r - 1)}
                disabled={!canPrev}
              >
                <Text style={[styles.roundNavBtnText, !canPrev && styles.roundNavBtnTextDisabled]}>‹</Text>
              </TouchableOpacity>
              <View style={styles.roundNavCenter}>
                <Text style={styles.cardTitle}>Round {selectedRound + 1}</Text>
                <Text style={styles.roundNavCourse}>{dispRound?.courseName}</Text>
              </View>
              <TouchableOpacity
                style={[styles.roundNavBtn, !canNext && styles.roundNavBtnDisabled]}
                onPress={() => canNext && setSelectedRound((r) => r + 1)}
                disabled={!canNext}
              >
                <Text style={[styles.roundNavBtnText, !canNext && styles.roundNavBtnTextDisabled]}>›</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => navigation.navigate('NextRound', { revealOnly: true, roundIndex: selectedRound })}
            >
              <Text style={styles.btnText}>Reveal Teams</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => navigation.navigate('Scorecard', { roundIndex: selectedRound })}
            >
              <Text style={styles.btnText}>{isCurrentRound ? 'Enter Scores' : 'Edit Scores'}</Text>
            </TouchableOpacity>
            {isCurrentRound && tournament.currentRound < tournament.rounds.length - 1 && (
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary]}
                onPress={() => navigation.navigate('NextRound')}
              >
                <Text style={styles.btnText}>Next Round</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => navigation.navigate('EditTournament')}
      >
        <Text style={styles.btnText}>Edit Players / Courses</Text>
      </TouchableOpacity>

      <View style={styles.libraryRow}>
        <TouchableOpacity style={styles.libraryBtn} onPress={() => navigation.navigate('PlayersLibrary')}>
          <Text style={styles.libraryBtnText}>Players Library</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.libraryBtn} onPress={() => navigation.navigate('CoursesLibrary')}>
          <Text style={styles.libraryBtnText}>Courses Library</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.deleteTournamentBtn} onPress={() => confirmDelete(tournament)}>
        <Text style={styles.deleteTournamentBtnText}>Delete Tournament</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StablefordRoundCard({ round, players }) {
  const pairResults = roundPairLeaderboard(round, players);
  return (
    <>
      {pairResults.map((pair, pi) => (
        <View key={pi} style={[styles.pairBlock, pi === 0 && styles.winnerBlock]}>
          {pi === 0 && <Text style={styles.winnerBadge}>Winner</Text>}
          <View style={styles.pairHeader}>
            <Text style={styles.pairNames}>{pair.members.map((m) => m.player.name).join(' & ')}</Text>
            <Text style={styles.pairPoints}>{pair.combinedPoints} pts</Text>
          </View>
          {pair.members.map((m) => (
            <Text key={m.player.id} style={styles.pairMember}>
              {m.player.name}  {m.totalPoints} pts · {m.totalStrokes} strokes
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

function BestBallRoundCard({ round, players, settings }) {
  const result = calcBestWorstBall(round, players);
  if (!result) return <Text style={styles.pairMember}>No scores yet</Text>;

  const { pair1, pair2, bestBall, worstBall } = result;
  const p1Names = pair1.map((p) => p.name).join(' & ');
  const p2Names = pair2.map((p) => p.name).join(' & ');

  const p1Points = bestBall.pair1 * settings.bestBallValue + worstBall.pair1 * settings.worstBallValue;
  const p2Points = bestBall.pair2 * settings.bestBallValue + worstBall.pair2 * settings.worstBallValue;
  const winner = p1Points > p2Points ? 1 : p2Points > p1Points ? 2 : 0;

  return (
    <>
      <View style={[styles.pairBlock, winner === 1 && styles.winnerBlock]}>
        {winner === 1 && <Text style={styles.winnerBadge}>Winner</Text>}
        <View style={styles.pairHeader}>
          <Text style={styles.pairNames}>{p1Names}</Text>
          <Text style={styles.pairPoints}>{p1Points} pts</Text>
        </View>
      </View>
      <View style={[styles.pairBlock, winner === 2 && styles.winnerBlock]}>
        {winner === 2 && <Text style={styles.winnerBadge}>Winner</Text>}
        <View style={styles.pairHeader}>
          <Text style={styles.pairNames}>{p2Names}</Text>
          <Text style={styles.pairPoints}>{p2Points} pts</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  backLink: { marginRight: 10, paddingVertical: 4, paddingRight: 8 },
  backLinkText: { color: '#4ade80', fontSize: 18, fontWeight: '600' },
  title: { fontSize: 40, fontWeight: '900', color: '#4ade80', letterSpacing: -1 },
  tournamentName: { fontSize: 16, color: '#7a8fa8', marginBottom: 18, fontWeight: '500' },
  sectionLabel: { color: '#364f68', fontSize: 11, fontWeight: '700', letterSpacing: 1.8, marginBottom: 12, marginTop: 4, textTransform: 'uppercase' },
  tournamentCard: {
    backgroundColor: '#0c1a28', borderRadius: 18, borderWidth: 1, borderColor: '#1c3250',
    padding: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
  },
  tournamentCardLeft: { flex: 1 },
  tournamentCardName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  tournamentCardMeta: { color: '#7a8fa8', fontSize: 12, fontWeight: '500' },
  tournamentCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tournamentCardRound: { color: '#364f68', fontSize: 12, fontWeight: '600' },
  tournamentCardChevron: { color: '#4ade80', fontSize: 24 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  modeLabel: { color: '#364f68', fontSize: 14, fontWeight: '600' },
  modeLabelActive: { color: '#f1f5f9', fontWeight: '700' },
  card: {
    backgroundColor: '#0c1a28', borderRadius: 18, borderWidth: 1, borderColor: '#1c3250',
    padding: 18, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 7,
  },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#4ade80', marginBottom: 14, letterSpacing: 1.8, textTransform: 'uppercase' },
  roundNavHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  roundNavBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#112038', borderWidth: 1, borderColor: '#1c3250', alignItems: 'center', justifyContent: 'center' },
  roundNavBtnDisabled: { opacity: 0.25 },
  roundNavBtnText: { color: '#4ade80', fontSize: 22, fontWeight: '700', lineHeight: 26 },
  roundNavBtnTextDisabled: { color: '#364f68' },
  roundNavCenter: { flex: 1, alignItems: 'center' },
  roundNavCourse: { color: '#7a8fa8', fontSize: 13, fontWeight: '500', marginTop: 1 },
  tabBar: { marginBottom: 14 },
  tab: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#1c3250', marginRight: 8, backgroundColor: '#070d15' },
  tabActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  tabText: { color: '#364f68', fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  tabRoundTitle: { color: '#7a8fa8', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0c1a28' },
  rank: { width: 28, fontWeight: '800', fontSize: 14 },
  playerName: { flex: 1, color: '#c8d6e5', fontSize: 15, fontWeight: '500' },
  points: { color: '#4ade80', fontWeight: '800', fontSize: 16, marginRight: 8 },
  subStat: { color: '#364f68', fontSize: 12, width: 70, textAlign: 'right' },
  pair: { color: '#c9d1d9', fontSize: 15, paddingVertical: 3 },
  pairBlock: { borderRadius: 12, backgroundColor: '#070d15', borderWidth: 1, borderColor: '#1c3250', padding: 12, marginBottom: 8 },
  winnerBlock: { backgroundColor: '#031a0a', borderColor: '#22c55e' },
  winnerBadge: { color: '#4ade80', fontSize: 10, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.5 },
  pairHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pairNames: { color: '#f1f5f9', fontWeight: '700', fontSize: 15, flex: 1 },
  pairPoints: { color: '#4ade80', fontWeight: '900', fontSize: 22 },
  pairMember: { color: '#7a8fa8', fontSize: 13, paddingTop: 3 },
  btn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#1c3250' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  libraryRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  libraryBtn: { flex: 1, backgroundColor: '#0c1a28', borderRadius: 12, borderWidth: 1, borderColor: '#1c3250', padding: 14, alignItems: 'center' },
  libraryBtnText: { color: '#7a8fa8', fontWeight: '600', fontSize: 13 },
  deleteCardBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  deleteCardBtnText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
  deleteTournamentBtn: { borderRadius: 12, borderWidth: 1, borderColor: '#f87171', padding: 14, alignItems: 'center', marginTop: 12 },
  deleteTournamentBtnText: { color: '#f87171', fontWeight: '700', fontSize: 15 },
});
