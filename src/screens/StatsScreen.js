import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { loadTournament, getPlayingHandicap, calcStablefordPoints } from '../store/tournamentStore';
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
  hallOfShame, pairHoleWins,
} from '../store/statsEngine';
import StatDetailSheet from '../components/StatDetailSheet';

const TABS = ['Overview', 'Players', 'Holes', 'Pairs', 'Shame'];

export default function StatsScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [tournament, setTournament] = useState(null);
  const [tab, setTab] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(0);
  const [h2hPlayer, setH2hPlayer] = useState(1);
  const [useNet, setUseNet] = useState(false);

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

      {(tab === 0 || tab === 1 || tab === 4) && (
        <View style={s.scoringToggle}>
          <Text style={[s.scoringLabel, !useNet && s.scoringLabelActive]}>Strokes</Text>
          <Switch
            value={useNet}
            onValueChange={setUseNet}
            trackColor={{ false: theme.border.default, true: theme.accent.primary }}
            thumbColor="#fff"
          />
          <Text style={[s.scoringLabel, useNet && s.scoringLabelActive]}>Points</Text>
        </View>
      )}

      <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
        {tab === 0 && <OverviewTab tournament={tournament} useNet={useNet} theme={theme} s={s} />}
        {tab === 1 && <PlayersTab tournament={tournament} players={players} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} useNet={useNet} theme={theme} s={s} />}
        {tab === 2 && <HolesTab tournament={tournament} completedRounds={completedRounds} theme={theme} s={s} />}
        {tab === 3 && <PairsTab tournament={tournament} players={players} h2hPlayer={h2hPlayer} setH2hPlayer={setH2hPlayer} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} theme={theme} s={s} />}
        {tab === 4 && <ShameTab tournament={tournament} useNet={useNet} theme={theme} s={s} />}
      </ScrollView>
    </View>
  );
}

// ── Overview Tab ──
function OverviewTab({ tournament, useNet, theme, s }) {
  const [roundIndex, setRoundIndex] = useState(null);
  const highlights = tournamentHighlights(tournament, { useNet, roundIndex });
  const modeLabel = useNet ? 'points' : 'strokes';
  const [sheet, setSheet] = useState(null);

  const scope = roundIndex === null
    ? 'Tournament · all rounds'
    : `R${roundIndex + 1} · ${tournament.rounds[roundIndex]?.courseName || ''}`;

  const hasAnyData = tournament.rounds.some(r => r.scores && Object.keys(r.scores).length > 0);
  if (!hasAnyData) {
    return <Text style={s.emptyText}>No scores entered yet. Play a round first!</Text>;
  }

  const openBestRound = () => {
    const h = highlights.bestRound;
    setSheet({
      title: `${h.player.name} — ${h.points} pts`,
      subtitle: `Best round · ${h.courseName} · ${modeLabel}`,
      rows: h.breakdown.map(b => ({
        key: `${b.holeNumber}`,
        primary: `Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  const openBirdies = () => {
    const h = highlights.mostBirdies;
    setSheet({
      title: `${h.player.name} — ${h.count} birdies+`,
      subtitle: `Birdies & Eagles · ${modeLabel}`,
      rows: h.breakdown.map((b, i) => ({
        key: `${b.roundIndex}-${b.holeNumber}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: b.vsPar <= -2 ? 'Eagle' : 'Birdie',
        tone: 'excellent',
      })),
    });
  };

  const openParStreak = () => {
    const h = highlights.longestParStreak;
    setSheet({
      title: `${h.player.name} — ${h.count} hoyos`,
      subtitle: `Longest par streak · ${modeLabel}`,
      rows: h.breakdown.map((b, i) => ({
        key: `${b.roundIndex}-${b.holeNumber}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.vsPar <= -1 ? 'excellent' : 'good',
      })),
    });
  };

  const openHole = (h, label) => {
    setSheet({
      title: `Hoyo ${h.holeNumber} · ${h.courseName}`,
      subtitle: `${label} · Par ${h.par} · ${h.avgPoints} avg pts`,
      rows: h.playerScores.map(ps => ({
        key: ps.playerId,
        primary: ps.playerName,
        secondary: `${ps.strokes} golpes`,
        rightPrimary: `${ps.points} pts`,
        tone: ps.points >= 3 ? 'excellent' : ps.points === 2 ? 'good' : ps.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  return (
    <View>
      <RoundSelector tournament={tournament} selected={roundIndex} onSelect={setRoundIndex} theme={theme} s={s} />
      <Text style={s.sectionTitle}>{roundIndex === null ? 'TOURNAMENT HIGHLIGHTS' : 'ROUND HIGHLIGHTS'}</Text>
      <Text style={s.scopeText}>{scope}</Text>
      {!highlights.bestRound && (
        <Text style={s.emptyText}>No scores for this round yet.</Text>
      )}
      {highlights.bestRound && (
        <HighlightCard icon="award" label={roundIndex === null ? 'Best Round' : 'Top Scorer'} value={`${highlights.bestRound.player.name} — ${highlights.bestRound.points} pts`} sub={highlights.bestRound.courseName} onPress={openBestRound} theme={theme} s={s} />
      )}
      {highlights.mostBirdies && highlights.mostBirdies.count > 0 && (
        <HighlightCard icon="zap" label="Most Birdies+" value={`${highlights.mostBirdies.player.name} — ${highlights.mostBirdies.count}`} sub={`Birdies + Eagles (${modeLabel})`} onPress={openBirdies} theme={theme} s={s} />
      )}
      {highlights.longestParStreak && highlights.longestParStreak.count > 1 && (
        <HighlightCard icon="trending-up" label="Longest Par Streak" value={`${highlights.longestParStreak.player.name} — ${highlights.longestParStreak.count} holes`} sub={`Consecutive holes at par or better (${modeLabel})`} onPress={openParStreak} theme={theme} s={s} />
      )}
      {highlights.bestHole && (
        <HighlightCard icon="thumbs-up" label="Easiest Hole" value={`Hole ${highlights.bestHole.holeNumber} — ${highlights.bestHole.avgPoints} avg pts`} sub={`${highlights.bestHole.courseName} · Par ${highlights.bestHole.par}`} onPress={() => openHole(highlights.bestHole, 'Easiest Hole')} theme={theme} s={s} />
      )}
      {highlights.worstHole && (
        <HighlightCard icon="thumbs-down" label="Hardest Hole" value={`Hole ${highlights.worstHole.holeNumber} — ${highlights.worstHole.avgPoints} avg pts`} sub={`${highlights.worstHole.courseName} · Par ${highlights.worstHole.par}`} onPress={() => openHole(highlights.worstHole, 'Hardest Hole')} theme={theme} s={s} />
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

function RoundSelector({ tournament, selected, onSelect, theme, s }) {
  return (
    <View style={s.roundSelector}>
      <TouchableOpacity
        style={[s.roundChip, selected === null && s.roundChipActive]}
        onPress={() => onSelect(null)}
        activeOpacity={0.7}
      >
        <Text style={[s.roundChipText, selected === null && s.roundChipTextActive]}>Total</Text>
      </TouchableOpacity>
      {tournament.rounds.map((r, i) => {
        const hasData = r.scores && Object.keys(r.scores).length > 0;
        return (
          <TouchableOpacity
            key={i}
            style={[s.roundChip, selected === i && s.roundChipActive, !hasData && s.roundChipDisabled]}
            onPress={() => hasData && onSelect(i)}
            disabled={!hasData}
            activeOpacity={0.7}
          >
            <Text style={[s.roundChipText, selected === i && s.roundChipTextActive, !hasData && s.roundChipTextDisabled]}>R{i + 1}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function HighlightCard({ icon, label, value, sub, onPress, theme, s }) {
  const Container = onPress ? TouchableOpacity : View;
  return (
    <Container style={s.highlightCard} onPress={onPress} activeOpacity={0.7}>
      <View style={s.highlightIcon}>
        <Feather name={icon} size={20} color={theme.accent.primary} />
      </View>
      <View style={s.highlightContent}>
        <Text style={s.highlightLabel}>{label}</Text>
        <Text style={s.highlightValue}>{value}</Text>
        {sub && <Text style={s.highlightSub}>{sub}</Text>}
      </View>
      {onPress && <Feather name="chevron-right" size={18} color={theme.text.muted} />}
    </Container>
  );
}

// ── Players Tab ──
function PlayersTab({ tournament, players, selectedPlayer, setSelectedPlayer, useNet, theme, s }) {
  const player = players[selectedPlayer];
  const [sheet, setSheet] = useState(null);
  if (!player) return null;

  const dist = playerScoreDistribution(tournament, player.id, { useNet });
  const streaks = playerStreaks(tournament, player.id, { useNet });
  const history = playerRoundHistory(tournament, player.id);
  const avg = playerAvgStableford(tournament, player.id);
  const modeLabel = useNet ? 'points' : 'strokes';

  const defaultTone = (b) => b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor';

  const holeRows = (holes, toneFn) => holes.map((b, i) => ({
    key: `${b.roundIndex}-${b.holeNumber}-${i}`,
    primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
    secondary: `Par ${b.par} · ${b.strokes} golpes`,
    rightPrimary: `${b.points} pts`,
    tone: toneFn(b),
  }));

  const openStreak = (title, holes, toneFn) => setSheet({
    title,
    subtitle: `${player.name} · ${modeLabel}`,
    rows: holeRows(holes, toneFn),
  });

  const openBucket = (label, holes) => {
    if (holes.length === 0) return;
    setSheet({
      title: `${player.name} — ${holes.length} ${label}`,
      subtitle: `${modeLabel}`,
      rows: holeRows(holes, defaultTone),
    });
  };

  const openRound = (r) => {
    const round = tournament.rounds[r.roundIndex];
    const handicap = getPlayingHandicap(round, player);
    const rows = round.holes.map(h => {
      const sc = round.scores?.[player.id]?.[h.number];
      if (!sc) return null;
      const pts = calcStablefordPoints(h.par, sc, handicap, h.strokeIndex);
      return {
        key: `${h.number}`,
        primary: `Hoyo ${h.number}`,
        secondary: `Par ${h.par} · ${sc} golpes`,
        rightPrimary: `${pts} pts`,
        tone: pts >= 3 ? 'excellent' : pts === 2 ? 'good' : pts === 1 ? 'neutral' : 'poor',
      };
    }).filter(Boolean);
    setSheet({
      title: `R${r.roundIndex + 1} · ${r.courseName}`,
      subtitle: `${player.name} — ${r.points} pts · ${r.strokes} golpes`,
      rows,
    });
  };

  return (
    <View>
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
          <View style={s.card}>
            <Text style={s.cardLabel}>Average per Round</Text>
            <Text style={s.bigNumber}>{avg}</Text>
            <Text style={s.cardSub}>Stableford points</Text>
          </View>

          <Text style={s.sectionTitle}>SCORE DISTRIBUTION</Text>
          <View style={s.card}>
            <View style={s.distRow}>
              <DistBar label="Eagle+" count={dist.eagles} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('Eagles', dist.eagleHoles)} s={s} />
              <DistBar label="Birdie" count={dist.birdies} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('Birdies', dist.birdieHoles)} s={s} />
              <DistBar label="Par" count={dist.pars} total={dist.total} color={theme.scoreColor('good')} onPress={() => openBucket('Pares', dist.parHoles)} s={s} />
              <DistBar label="Bogey" count={dist.bogeys} total={dist.total} color={theme.scoreColor('neutral')} onPress={() => openBucket('Bogeys', dist.bogeyHoles)} s={s} />
              <DistBar label="Dbl+" count={dist.doubles + dist.worse} total={dist.total} color={theme.scoreColor('poor')} onPress={() => openBucket('Dobles o peor', [...dist.doubleHoles, ...dist.worseHoles])} s={s} />
            </View>
          </View>

          <Text style={s.sectionTitle}>STREAKS</Text>
          <View style={s.card}>
            <View style={s.streakRow}>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bestParStreak > 0 && openStreak(`Par streak — ${streaks.bestParStreak} hoyos`, streaks.parStreakHoles, defaultTone)} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestParStreak}</Text>
                <Text style={s.streakLabel}>Par streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bestBirdieStreak > 0 && openStreak(`Birdie streak — ${streaks.bestBirdieStreak} hoyos`, streaks.birdieStreakHoles, () => 'excellent')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestBirdieStreak}</Text>
                <Text style={s.streakLabel}>Birdie streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.worstBogeyStreak > 0 && openStreak(`Bogey streak — ${streaks.worstBogeyStreak} hoyos`, streaks.bogeyStreakHoles, () => 'poor')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('poor') }]}>{streaks.worstBogeyStreak}</Text>
                <Text style={s.streakLabel}>Bogey streak</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={s.sectionTitle}>ROUND HISTORY</Text>
          {history.map((r, i) => (
            <TouchableOpacity key={i} style={s.historyRow} onPress={() => openRound(r)} activeOpacity={0.7}>
              <Text style={s.historyRound}>R{r.roundIndex + 1}</Text>
              <Text style={s.historyCourse}>{r.courseName}</Text>
              <Text style={s.historyPts}>{r.points} pts</Text>
              <Text style={s.historyStr}>{r.strokes} str</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

function DistBar({ label, count, total, color, onPress, s }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const Container = onPress && count > 0 ? TouchableOpacity : View;
  return (
    <Container style={s.distItem} onPress={onPress} activeOpacity={0.7}>
      <View style={s.distBarBg}>
        <View style={[s.distBarFill, { height: `${Math.max(pct, 2)}%`, backgroundColor: color }]} />
      </View>
      <Text style={s.distCount}>{count}</Text>
      <Text style={s.distLabel}>{label}</Text>
    </Container>
  );
}

// ── Holes Tab ──
function HolesTab({ tournament, completedRounds, theme, s }) {
  const bw = bestWorstHoles(tournament);
  const firstRoundIdx = tournament.rounds.indexOf(completedRounds[0]);
  const heatmap = firstRoundIdx >= 0 ? holeDifficultyMap(tournament, firstRoundIdx) : [];
  const [sheet, setSheet] = useState(null);

  const openHole = (h, label) => setSheet({
    title: `Hoyo ${h.holeNumber} · ${h.courseName}`,
    subtitle: `${label} · Par ${h.par} · ${h.avgPoints} avg pts`,
    rows: h.playerScores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: `${ps.strokes} golpes`,
      rightPrimary: `${ps.points} pts`,
      tone: ps.points >= 3 ? 'excellent' : ps.points === 2 ? 'good' : ps.points === 1 ? 'neutral' : 'poor',
    })),
  });

  return (
    <View>
      {bw.best.length > 0 && (
        <>
          <Text style={s.sectionTitle}>EASIEST HOLES</Text>
          {bw.best.map((h, i) => (
            <TouchableOpacity key={`b${i}`} style={s.holeCard} onPress={() => openHole(h, 'Easiest Hole')} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('excellent') }]}>{h.avgPoints} avg</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {bw.worst.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HARDEST HOLES</Text>
          {bw.worst.map((h, i) => (
            <TouchableOpacity key={`w${i}`} style={s.holeCard} onPress={() => openHole(h, 'Hardest Hole')} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('poor') }]}>{h.avgPoints} avg</Text>
            </TouchableOpacity>
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

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

// ── Pairs Tab ──
function PairsTab({ tournament, players, h2hPlayer, setH2hPlayer, selectedPlayer, setSelectedPlayer, theme, s }) {
  const pairs = pairPerformance(tournament);
  const [hwRound, setHwRound] = useState(null);
  const holeWins = pairHoleWins(tournament, { roundIndex: hwRound });
  const p1 = players[selectedPlayer];
  const p2Idx = h2hPlayer >= players.length ? 0 : h2hPlayer;
  const p2 = players[p2Idx];
  const h2h = p1 && p2 && p1.id !== p2.id ? headToHead(tournament, p1.id, p2.id) : null;
  const [sheet, setSheet] = useState(null);

  const openPair = (pair) => setSheet({
    title: `${pair.players[0].name} & ${pair.players[1].name}`,
    subtitle: `${pair.avgPoints} avg pts · ${pair.rounds} round${pair.rounds !== 1 ? 's' : ''}`,
    rows: pair.roundList.map(r => ({
      key: `r${r.roundIndex}`,
      primary: `R${r.roundIndex + 1} · ${r.courseName}`,
      secondary: r.memberPoints.map(m => `${m.playerName.split(' ')[0]} ${m.points}`).join(' · '),
      rightPrimary: `${r.combinedPoints} pts`,
      rightSecondary: `${r.combinedStrokes} golpes`,
    })),
  });

  const openHoleWins = (row) => setSheet({
    title: `${row.player.name} — hoyos a puntos`,
    subtitle: `MB ${row.best.W}·${row.best.T}·${row.best.L}  PB ${row.worst.W}·${row.worst.T}·${row.worst.L}  Tot ${row.total.W}·${row.total.T}·${row.total.L}`,
    rows: row.breakdown.map((b, i) => {
      const roleParts = [];
      if (b.bestRole) roleParts.push(`MB ${b.bestOutcome}`);
      if (b.worstRole) roleParts.push(`PB ${b.worstOutcome}`);
      const tone = roleParts.some(p => p.endsWith('W')) && !roleParts.some(p => p.endsWith('L'))
        ? 'excellent'
        : roleParts.every(p => p.endsWith('L'))
          ? 'poor'
          : 'neutral';
      return {
        key: `${b.roundIndex}-${b.holeNumber}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.playerPoints} pts (equipo ${b.teamBest}/${b.teamWorst} · rival ${b.oppBest}/${b.oppWorst})`,
        rightPrimary: roleParts.join(' · '),
        tone,
      };
    }),
  });

  const openH2H = () => {
    if (!h2h) return;
    setSheet({
      title: `${p1.name.split(' ')[0]} vs ${p2.name.split(' ')[0]}`,
      subtitle: `${h2h.p1Wins} - ${h2h.p2Wins} (${h2h.ties} empates)`,
      rows: h2h.holes.map((h, i) => {
        const winner = h.p1Points > h.p2Points ? p1.name.split(' ')[0] : h.p2Points > h.p1Points ? p2.name.split(' ')[0] : 'Empate';
        const tone = h.p1Points === h.p2Points ? 'neutral' : 'good';
        return {
          key: `${h.courseName}-${h.holeNumber}-${i}`,
          primary: `${h.courseName} · Hoyo ${h.holeNumber}`,
          secondary: `${p1.name.split(' ')[0]} ${h.p1Points} · ${p2.name.split(' ')[0]} ${h.p2Points}`,
          rightPrimary: winner,
          tone,
        };
      }),
    });
  };

  return (
    <View>
      {pairs.length > 0 && (
        <>
          <Text style={s.sectionTitle}>PAIR CHEMISTRY</Text>
          {pairs.map((p, i) => (
            <TouchableOpacity key={i} style={s.pairCard} onPress={() => openPair(p)} activeOpacity={0.7}>
              <View style={s.pairNames}>
                <Text style={s.pairName}>{p.players[0].name}</Text>
                <Text style={s.pairAmp}>&</Text>
                <Text style={s.pairName}>{p.players[1].name}</Text>
              </View>
              <View style={s.pairStats}>
                <Text style={s.pairAvg}>{p.avgPoints} avg pts</Text>
                <Text style={s.pairRounds}>{p.rounds} round{p.rounds !== 1 ? 's' : ''}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {tournament.rounds.some(r => r.pairs && r.scores && Object.keys(r.scores).length > 0) && (
        <>
          <Text style={s.sectionTitle}>HOLE WINS ON POINTS</Text>
          <RoundSelector tournament={tournament} selected={hwRound} onSelect={setHwRound} theme={theme} s={s} />
          <View style={s.hwCard}>
            <View style={s.hwGroupHeader}>
              <View style={{ flex: 1.2 }} />
              <Text style={s.hwGroupTitle}>TOTAL</Text>
              <Text style={s.hwGroupTitle}>MB</Text>
              <Text style={s.hwGroupTitle}>PB</Text>
            </View>
            <View style={s.hwSubHeader}>
              <View style={{ flex: 1.2 }} />
              <HwGEPLabels theme={theme} s={s} />
              <HwGEPLabels theme={theme} s={s} />
              <HwGEPLabels theme={theme} s={s} />
            </View>
            {holeWins.length === 0 || holeWins.every(r => r.total.W + r.total.T + r.total.L === 0) ? (
              <Text style={s.hwEmpty}>No data for this view.</Text>
            ) : (
              holeWins.map(row => {
                const empty = row.total.W + row.total.T + row.total.L === 0;
                return (
                  <TouchableOpacity
                    key={row.player.id}
                    style={s.hwBigRow}
                    onPress={() => !empty && openHoleWins(row)}
                    activeOpacity={0.7}
                    disabled={empty}
                  >
                    <Text style={[s.hwPlayerName, empty && s.hwDimmed]}>{row.player.name.split(' ')[0]}</Text>
                    <HwGEPCells stats={row.total} strong theme={theme} s={s} />
                    <HwGEPCells stats={row.best} theme={theme} s={s} />
                    <HwGEPCells stats={row.worst} theme={theme} s={s} />
                  </TouchableOpacity>
                );
              })
            )}
          </View>
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
          {players.filter((_, i) => i !== selectedPlayer).map((p) => {
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
        <TouchableOpacity style={s.card} onPress={openH2H} activeOpacity={0.7}>
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
        </TouchableOpacity>
      ) : (
        <Text style={s.emptyText}>Select two different players to compare.</Text>
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

function HwGEPLabels({ theme, s }) {
  return (
    <View style={s.hwGepRow}>
      <Text style={[s.hwGepLabel, { color: theme.scoreColor('excellent') }]}>G</Text>
      <Text style={[s.hwGepLabel, { color: theme.text.muted }]}>E</Text>
      <Text style={[s.hwGepLabel, { color: theme.scoreColor('poor') }]}>P</Text>
    </View>
  );
}

function HwGEPCells({ stats, strong, theme, s }) {
  const cell = (value, tone) => {
    const color = tone === 'win'
      ? theme.scoreColor('excellent')
      : tone === 'loss'
        ? theme.scoreColor('poor')
        : theme.text.muted;
    const dim = value === 0;
    return (
      <View style={[s.hwCellBox, { backgroundColor: color + (dim ? '0A' : '1F') }]}>
        <Text style={[strong ? s.hwCellNumStrong : s.hwCellNum, { color: dim ? theme.text.muted : color }]}>
          {value}
        </Text>
      </View>
    );
  };
  return (
    <View style={s.hwGepRow}>
      {cell(stats.W, 'win')}
      {cell(stats.T, 'tie')}
      {cell(stats.L, 'loss')}
    </View>
  );
}

// ── Shame Tab ──

function ShameTab({ tournament, useNet, theme, s }) {
  const shame = hallOfShame(tournament, { useNet });
  const [sheet, setSheet] = useState(null);
  const modeLabel = useNet ? 'points' : 'strokes';

  const holeRows = (holes) => holes.map((b, i) => ({
    key: `${b.roundIndex}-${b.holeNumber}-${i}`,
    primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
    secondary: `Par ${b.par} · ${b.strokes} golpes`,
    rightPrimary: `${b.points} pts`,
    tone: b.points === 0 ? 'poor' : b.vsPar >= 1 ? 'neutral' : 'good',
  }));

  const openTripleBogey = () => {
    const x = shame.tripleBogey;
    setSheet({
      title: `${x.player.name} — +${x.vsPar} sobre par`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · Hoyo ${x.holeNumber} · ${modeLabel}`,
      rows: [{
        key: 'sole',
        primary: `Par ${x.par} · SI ${x.si}`,
        secondary: `${x.strokes} golpes`,
        rightPrimary: `${x.points} pts`,
        tone: 'poor',
      }],
    });
  };

  const openShameStreak = () => {
    const x = shame.shameStreak;
    setSheet({
      title: `${x.player.name} — ${x.count} bogeys+ seguidos`,
      subtitle: `Racha de la vergüenza · ${modeLabel}`,
      rows: holeRows(x.breakdown),
    });
  };

  const openCero = () => {
    const x = shame.ceroPatatero;
    setSheet({
      title: `${x.player.name} — ${x.count} hoyos a 0 pts`,
      subtitle: `Cero patatero · ${modeLabel}`,
      rows: holeRows(x.breakdown),
    });
  };

  const openRegalo = () => {
    const x = shame.regalo;
    setSheet({
      title: `${x.player.name} — ${x.playerPoints} vs avg ${x.othersAvg}`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · Hoyo ${x.holeNumber} · ${modeLabel}`,
      rows: x.breakdown.map(b => ({
        key: b.playerId,
        primary: b.playerName,
        secondary: `${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.playerId === x.player.id ? 'poor' : b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  const openDesmoronamiento = () => {
    const x = shame.desmoronamiento;
    setSheet({
      title: `${x.player.name} — ${x.front} / ${x.back}`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · caída de ${x.drop} pts · ${modeLabel}`,
      rows: x.breakdown.map(b => ({
        key: `${b.holeNumber}`,
        primary: `Hoyo ${b.holeNumber} ${b.holeNumber <= 9 ? '(ida)' : '(vuelta)'}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  const openBucketazo = () => {
    const x = shame.bucketazo;
    setSheet({
      title: `${x.player.name} — ${x.strokes} golpes en un hoyo`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · Hoyo ${x.holeNumber} · ${modeLabel}`,
      rows: [{
        key: 'sole',
        primary: `Par ${x.par} · SI ${x.si}`,
        secondary: `${x.strokes} golpes · +${x.vsPar} sobre par`,
        rightPrimary: `${x.points} pts`,
        tone: 'poor',
      }],
    });
  };

  const any = shame.tripleBogey || shame.shameStreak || shame.ceroPatatero || shame.regalo || shame.desmoronamiento || shame.bucketazo;

  return (
    <View>
      {!any && <Text style={s.emptyText}>No hay suficientes datos todavía. ¡Juega alguna ronda primero!</Text>}

      {shame.tripleBogey && (
        <HighlightCard icon="alert-triangle" label="🏌️ Triple Bogey Club" value={`${shame.tripleBogey.player.name} — +${shame.tripleBogey.vsPar} sobre par`} sub={`${shame.tripleBogey.courseName} · Hoyo ${shame.tripleBogey.holeNumber}`} onPress={openTripleBogey} theme={theme} s={s} />
      )}
      {shame.shameStreak && shame.shameStreak.count > 1 && (
        <HighlightCard icon="trending-down" label="💀 Racha de la Vergüenza" value={`${shame.shameStreak.player.name} — ${shame.shameStreak.count} bogeys+`} sub={`Consecutivos (${modeLabel})`} onPress={openShameStreak} theme={theme} s={s} />
      )}
      {shame.ceroPatatero && shame.ceroPatatero.count > 0 && (
        <HighlightCard icon="minus-circle" label="🕳️ Cero Patatero" value={`${shame.ceroPatatero.player.name} — ${shame.ceroPatatero.count} hoyos`} sub={`Sin sumar puntos (${modeLabel})`} onPress={openCero} theme={theme} s={s} />
      )}
      {shame.regalo && (
        <HighlightCard icon="gift" label="🎁 El Regalo" value={`${shame.regalo.player.name} — brecha ${shame.regalo.gap} pts`} sub={`${shame.regalo.courseName} · Hoyo ${shame.regalo.holeNumber}`} onPress={openRegalo} theme={theme} s={s} />
      )}
      {shame.desmoronamiento && (
        <HighlightCard icon="activity" label="📉 El Desmoronamiento" value={`${shame.desmoronamiento.player.name} — caída ${shame.desmoronamiento.drop} pts`} sub={`${shame.desmoronamiento.courseName} · ida ${shame.desmoronamiento.front} vs vuelta ${shame.desmoronamiento.back}`} onPress={openDesmoronamiento} theme={theme} s={s} />
      )}
      {shame.bucketazo && (
        <HighlightCard icon="flag" label="🪣 El Bucketazo" value={`${shame.bucketazo.player.name} — ${shame.bucketazo.strokes} golpes`} sub={`${shame.bucketazo.courseName} · Hoyo ${shame.bucketazo.holeNumber}`} onPress={openBucketazo} theme={theme} s={s} />
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
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
  scoringToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 6, paddingHorizontal: 16,
  },
  scoringLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 12 },
  scoringLabelActive: { color: t.text.primary },
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
  bigNumber: { fontFamily: 'PlayfairDisplay-Black', color: t.accent.primary, fontSize: 36 },

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
  highlightValue: { fontFamily: 'PlayfairDisplay-Black', color: t.text.primary, fontSize: 15, marginTop: 2 },
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
  streakNumber: { fontFamily: 'PlayfairDisplay-Black', fontSize: 28 },
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
  h2hScore: { fontFamily: 'PlayfairDisplay-Black', color: t.text.primary, fontSize: 32 },
  h2hCenter: { alignItems: 'center' },
  h2hTies: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 13 },
  h2hSub: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },

  // Round selector
  roundSelector: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  roundChip: {
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default,
  },
  roundChipActive: { backgroundColor: t.accent.primary, borderColor: t.accent.primary },
  roundChipDisabled: { opacity: 0.4 },
  roundChipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: t.text.muted, letterSpacing: 0.5 },
  roundChipTextActive: { color: t.text.inverse },
  roundChipTextDisabled: { color: t.text.muted },
  scopeText: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11,
    marginTop: -6, marginBottom: 10,
  },

  // Hole Wins table (new visual layout)
  hwCard: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 12, marginBottom: 12, ...(t.isDark ? {} : t.shadow.card),
  },
  hwGroupHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 2 },
  hwGroupTitle: {
    flex: 1, textAlign: 'center',
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, letterSpacing: 1.2,
    color: t.accent.primary,
  },
  hwSubHeader: {
    flexDirection: 'row', alignItems: 'center', paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle, marginBottom: 4,
  },
  hwBigRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  hwPlayerName: {
    flex: 1.2,
    fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 14,
  },
  hwDimmed: { color: t.text.muted },
  hwGepRow: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  hwGepLabel: {
    width: 22, textAlign: 'center',
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 0.5,
  },
  hwCellBox: {
    width: 22, height: 26, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  hwCellNum: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  hwCellNumStrong: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15 },
  hwEmpty: {
    fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 12,
    textAlign: 'center', paddingVertical: 16,
  },
});
