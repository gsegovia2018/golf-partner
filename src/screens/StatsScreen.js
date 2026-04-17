import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { loadTournament } from '../store/tournamentStore';
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
} from '../store/statsEngine';

const TABS = ['Overview', 'Players', 'Holes', 'Pairs'];

export default function StatsScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [tournament, setTournament] = useState(null);
  const [tab, setTab] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(0);
  const [h2hPlayer, setH2hPlayer] = useState(1);

  useEffect(() => {
    loadTournament().then(t => { setTournament(t); });
  }, []);

  if (!tournament) return null;

  const { players } = tournament;
  const completedRounds = tournament.rounds.filter(r => r.scores && Object.keys(r.scores).length > 0);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Statistics</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={s.tabBar}>
        {TABS.map((t, i) => (
          <TouchableOpacity key={t} style={[s.tab, tab === i && s.tabActive]} onPress={() => setTab(i)} activeOpacity={0.7}>
            <Text style={[s.tabText, tab === i && s.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
        {tab === 0 && <OverviewTab tournament={tournament} theme={theme} s={s} />}
        {tab === 1 && <PlayersTab tournament={tournament} players={players} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} theme={theme} s={s} />}
        {tab === 2 && <HolesTab tournament={tournament} completedRounds={completedRounds} theme={theme} s={s} />}
        {tab === 3 && <PairsTab tournament={tournament} players={players} h2hPlayer={h2hPlayer} setH2hPlayer={setH2hPlayer} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} theme={theme} s={s} />}
      </ScrollView>
    </View>
  );
}

// ── Overview Tab ──
function OverviewTab({ tournament, theme, s }) {
  const highlights = tournamentHighlights(tournament);
  if (!highlights.bestRound) {
    return <Text style={s.emptyText}>No scores entered yet. Play a round first!</Text>;
  }
  return (
    <View>
      <Text style={s.sectionTitle}>TOURNAMENT HIGHLIGHTS</Text>
      {highlights.bestRound && (
        <HighlightCard icon="award" label="Best Round" value={`${highlights.bestRound.player.name} — ${highlights.bestRound.points} pts`} sub={highlights.bestRound.courseName} theme={theme} s={s} />
      )}
      {highlights.mostBirdies && highlights.mostBirdies.count > 0 && (
        <HighlightCard icon="zap" label="Most Birdies+" value={`${highlights.mostBirdies.player.name} — ${highlights.mostBirdies.count}`} sub="Birdies + Eagles (net)" theme={theme} s={s} />
      )}
      {highlights.longestParStreak && highlights.longestParStreak.count > 1 && (
        <HighlightCard icon="trending-up" label="Longest Par Streak" value={`${highlights.longestParStreak.player.name} — ${highlights.longestParStreak.count} holes`} sub="Consecutive holes at par or better (net)" theme={theme} s={s} />
      )}
      {highlights.bestHole && (
        <HighlightCard icon="thumbs-up" label="Easiest Hole" value={`Hole ${highlights.bestHole.holeNumber} — ${highlights.bestHole.avgPoints} avg pts`} sub={`${highlights.bestHole.courseName} · Par ${highlights.bestHole.par}`} theme={theme} s={s} />
      )}
      {highlights.worstHole && (
        <HighlightCard icon="thumbs-down" label="Hardest Hole" value={`Hole ${highlights.worstHole.holeNumber} — ${highlights.worstHole.avgPoints} avg pts`} sub={`${highlights.worstHole.courseName} · Par ${highlights.worstHole.par}`} theme={theme} s={s} />
      )}
    </View>
  );
}

function HighlightCard({ icon, label, value, sub, theme, s }) {
  return (
    <View style={s.highlightCard}>
      <View style={s.highlightIcon}>
        <Feather name={icon} size={20} color={theme.accent.primary} />
      </View>
      <View style={s.highlightContent}>
        <Text style={s.highlightLabel}>{label}</Text>
        <Text style={s.highlightValue}>{value}</Text>
        {sub && <Text style={s.highlightSub}>{sub}</Text>}
      </View>
    </View>
  );
}

// ── Players Tab ──
function PlayersTab({ tournament, players, selectedPlayer, setSelectedPlayer, theme, s }) {
  const player = players[selectedPlayer];
  if (!player) return null;

  const dist = playerScoreDistribution(tournament, player.id);
  const streaks = playerStreaks(tournament, player.id);
  const history = playerRoundHistory(tournament, player.id);
  const avg = playerAvgStableford(tournament, player.id);

  return (
    <View>
      {/* Player selector */}
      <View style={s.playerSelector}>
        {players.map((p, i) => (
          <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
            <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {dist.total === 0 ? (
        <Text style={s.emptyText}>No scores for {player.name} yet.</Text>
      ) : (
        <>
          {/* Avg */}
          <View style={s.card}>
            <Text style={s.cardLabel}>Average per Round</Text>
            <Text style={s.bigNumber}>{avg}</Text>
            <Text style={s.cardSub}>Stableford points</Text>
          </View>

          {/* Score Distribution */}
          <Text style={s.sectionTitle}>SCORE DISTRIBUTION</Text>
          <View style={s.card}>
            <View style={s.distRow}>
              <DistBar label="Eagle+" count={dist.eagles} total={dist.total} color={theme.scoreColor('excellent')} s={s} />
              <DistBar label="Birdie" count={dist.birdies} total={dist.total} color={theme.scoreColor('excellent')} s={s} />
              <DistBar label="Par" count={dist.pars} total={dist.total} color={theme.scoreColor('good')} s={s} />
              <DistBar label="Bogey" count={dist.bogeys} total={dist.total} color={theme.scoreColor('neutral')} s={s} />
              <DistBar label="Dbl+" count={dist.doubles + dist.worse} total={dist.total} color={theme.scoreColor('poor')} s={s} />
            </View>
          </View>

          {/* Streaks */}
          <Text style={s.sectionTitle}>STREAKS</Text>
          <View style={s.card}>
            <View style={s.streakRow}>
              <View style={s.streakItem}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestParStreak}</Text>
                <Text style={s.streakLabel}>Par streak</Text>
              </View>
              <View style={s.streakItem}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestBirdieStreak}</Text>
                <Text style={s.streakLabel}>Birdie streak</Text>
              </View>
              <View style={s.streakItem}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('poor') }]}>{streaks.worstBogeyStreak}</Text>
                <Text style={s.streakLabel}>Bogey streak</Text>
              </View>
            </View>
          </View>

          {/* Round history */}
          <Text style={s.sectionTitle}>ROUND HISTORY</Text>
          {history.map((r, i) => (
            <View key={i} style={s.historyRow}>
              <Text style={s.historyRound}>R{r.roundIndex + 1}</Text>
              <Text style={s.historyCourse}>{r.courseName}</Text>
              <Text style={s.historyPts}>{r.points} pts</Text>
              <Text style={s.historyStr}>{r.strokes} str</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function DistBar({ label, count, total, color, s }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={s.distItem}>
      <View style={s.distBarBg}>
        <View style={[s.distBarFill, { height: `${Math.max(pct, 2)}%`, backgroundColor: color }]} />
      </View>
      <Text style={s.distCount}>{count}</Text>
      <Text style={s.distLabel}>{label}</Text>
    </View>
  );
}

// ── Holes Tab ──
function HolesTab({ tournament, completedRounds, theme, s }) {
  const bw = bestWorstHoles(tournament);
  const firstRoundIdx = tournament.rounds.indexOf(completedRounds[0]);
  const heatmap = firstRoundIdx >= 0 ? holeDifficultyMap(tournament, firstRoundIdx) : [];

  return (
    <View>
      {bw.best.length > 0 && (
        <>
          <Text style={s.sectionTitle}>EASIEST HOLES</Text>
          {bw.best.map((h, i) => (
            <View key={`b${i}`} style={s.holeCard}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('excellent') }]}>{h.avgPoints} avg</Text>
            </View>
          ))}
        </>
      )}

      {bw.worst.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HARDEST HOLES</Text>
          {bw.worst.map((h, i) => (
            <View key={`w${i}`} style={s.holeCard}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('poor') }]}>{h.avgPoints} avg</Text>
            </View>
          ))}
        </>
      )}

      {heatmap.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HOLE HEATMAP — {completedRounds[0]?.courseName}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={s.heatRow}>
                <Text style={[s.heatCell, s.heatHeader]}>Hole</Text>
                {tournament.players.map(p => (
                  <Text key={p.id} style={[s.heatCell, s.heatHeader]}>{p.name.split(' ')[0]}</Text>
                ))}
                <Text style={[s.heatCell, s.heatHeader]}>Avg</Text>
              </View>
              {heatmap.map(h => (
                <View key={h.holeNumber} style={s.heatRow}>
                  <Text style={[s.heatCell, s.heatHoleNum]}>{h.holeNumber}</Text>
                  {tournament.players.map(p => {
                    const ps = h.playerScores.find(x => x.playerId === p.id);
                    const pts = ps?.points ?? '-';
                    const color = pts === '-' ? theme.text.muted
                      : pts >= 3 ? theme.scoreColor('excellent')
                      : pts === 2 ? theme.scoreColor('good')
                      : pts === 1 ? theme.scoreColor('neutral')
                      : theme.scoreColor('poor');
                    return (
                      <View key={p.id} style={[s.heatCell, s.heatValue, { backgroundColor: color + '18' }]}>
                        <Text style={[s.heatValueText, { color }]}>{pts}</Text>
                      </View>
                    );
                  })}
                  <View style={[s.heatCell, s.heatValue]}>
                    <Text style={s.heatAvgText}>{h.avgPoints}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      )}

      {bw.best.length === 0 && <Text style={s.emptyText}>No scores entered yet.</Text>}
    </View>
  );
}

// ── Pairs Tab ──
function PairsTab({ tournament, players, h2hPlayer, setH2hPlayer, selectedPlayer, setSelectedPlayer, theme, s }) {
  const pairs = pairPerformance(tournament);
  const p1 = players[selectedPlayer];
  const p2Idx = h2hPlayer >= players.length ? 0 : h2hPlayer;
  const p2 = players[p2Idx];
  const h2h = p1 && p2 && p1.id !== p2.id ? headToHead(tournament, p1.id, p2.id) : null;

  return (
    <View>
      {pairs.length > 0 && (
        <>
          <Text style={s.sectionTitle}>PAIR CHEMISTRY</Text>
          {pairs.map((p, i) => (
            <View key={i} style={s.pairCard}>
              <View style={s.pairNames}>
                <Text style={s.pairName}>{p.players[0].name}</Text>
                <Text style={s.pairAmp}>&</Text>
                <Text style={s.pairName}>{p.players[1].name}</Text>
              </View>
              <View style={s.pairStats}>
                <Text style={s.pairAvg}>{p.avgPoints} avg pts</Text>
                <Text style={s.pairRounds}>{p.rounds} round{p.rounds !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={s.sectionTitle}>HEAD TO HEAD</Text>
      <View style={s.h2hSelector}>
        <View style={s.h2hCol}>
          {players.map((p, i) => (
            <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
              <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.h2hVs}>vs</Text>
        <View style={s.h2hCol}>
          {players.filter((_, i) => i !== selectedPlayer).map((p, i) => {
            const realIdx = players.indexOf(p);
            return (
              <TouchableOpacity key={p.id} style={[s.playerChip, p2Idx === realIdx && s.playerChipActive]} onPress={() => setH2hPlayer(realIdx)} activeOpacity={0.7}>
                <Text style={[s.playerChipText, p2Idx === realIdx && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {h2h ? (
        <View style={s.card}>
          <View style={s.h2hResult}>
            <View style={s.h2hPlayer}>
              <Text style={s.h2hName}>{p1.name.split(' ')[0]}</Text>
              <Text style={[s.h2hScore, h2h.p1Wins > h2h.p2Wins && { color: theme.accent.primary }]}>{h2h.p1Wins}</Text>
            </View>
            <View style={s.h2hCenter}>
              <Text style={s.h2hTies}>{h2h.ties} ties</Text>
            </View>
            <View style={s.h2hPlayer}>
              <Text style={s.h2hName}>{p2.name.split(' ')[0]}</Text>
              <Text style={[s.h2hScore, h2h.p2Wins > h2h.p1Wins && { color: theme.accent.primary }]}>{h2h.p2Wins}</Text>
            </View>
          </View>
          <Text style={s.h2hSub}>{h2h.holes.length} holes compared</Text>
        </View>
      ) : (
        <Text style={s.emptyText}>Select two different players to compare.</Text>
      )}
    </View>
  );
}

// ── Styles ──
const makeStyles = (t) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: t.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 100 },

  // Tabs
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 6, paddingBottom: 8 },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default },
  tabActive: { backgroundColor: t.accent.primary, borderColor: t.accent.primary },
  tabText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: t.text.muted },
  tabTextActive: { color: t.text.inverse },

  // Cards
  card: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 12, ...(t.isDark ? {} : t.shadow.card),
  },
  cardLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  cardSub: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 12, marginTop: 2 },
  bigNumber: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary, fontSize: 36 },

  sectionTitle: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12, marginTop: 20 },
  emptyText: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 14, textAlign: 'center', paddingVertical: 40 },

  // Highlights
  highlightCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 8, ...(t.isDark ? {} : t.shadow.card),
  },
  highlightIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.accent.light, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  highlightContent: { flex: 1 },
  highlightLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  highlightValue: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 15, marginTop: 2 },
  highlightSub: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 11, marginTop: 1 },

  // Player selector
  playerSelector: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  playerChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default },
  playerChipActive: { backgroundColor: t.accent.primary, borderColor: t.accent.primary },
  playerChipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: t.text.muted },
  playerChipTextActive: { color: t.text.inverse },

  // Distribution
  distRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 120 },
  distItem: { alignItems: 'center', flex: 1 },
  distBarBg: { width: 24, height: 80, borderRadius: 12, backgroundColor: t.bg.secondary, justifyContent: 'flex-end', overflow: 'hidden', marginBottom: 6 },
  distBarFill: { width: '100%', borderRadius: 12, minHeight: 2 },
  distCount: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14 },
  distLabel: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 9, marginTop: 2 },

  // Streaks
  streakRow: { flexDirection: 'row', justifyContent: 'space-around' },
  streakItem: { alignItems: 'center' },
  streakNumber: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 28 },
  streakLabel: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 4 },

  // Round history
  historyRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  historyRound: { fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 13, width: 30 },
  historyCourse: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 13, flex: 1 },
  historyPts: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14, width: 55, textAlign: 'right' },
  historyStr: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12, width: 50, textAlign: 'right' },

  // Holes
  holeCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 14, marginBottom: 8, ...(t.isDark ? {} : t.shadow.card),
  },
  holeRank: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  holeRankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  holeInfo: { flex: 1 },
  holeName: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14 },
  holeCourse: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 1 },
  holeAvg: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 16 },

  // Heatmap
  heatRow: { flexDirection: 'row', alignItems: 'center' },
  heatCell: { width: 52, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  heatHeader: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 10, paddingBottom: 8 },
  heatHoleNum: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.secondary, fontSize: 12 },
  heatValue: { borderRadius: 6, margin: 1, paddingVertical: 8 },
  heatValueText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  heatAvgText: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12 },

  // Pairs
  pairCard: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 14, marginBottom: 8, ...(t.isDark ? {} : t.shadow.card),
  },
  pairNames: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  pairName: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14 },
  pairAmp: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 14 },
  pairStats: { flexDirection: 'row', gap: 12 },
  pairAvg: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.accent.primary, fontSize: 13 },
  pairRounds: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12 },

  // Head to Head
  h2hSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 },
  h2hCol: { gap: 6 },
  h2hVs: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.muted, fontSize: 16 },
  h2hResult: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  h2hPlayer: { alignItems: 'center', gap: 4 },
  h2hName: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.secondary, fontSize: 13 },
  h2hScore: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.text.primary, fontSize: 32 },
  h2hCenter: { alignItems: 'center' },
  h2hTies: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 13 },
  h2hSub: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
});
