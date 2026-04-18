import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { loadTournament, getPlayingHandicap, calcStablefordPoints } from '../store/tournamentStore';
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
  hallOfShame, pairHoleWins, pairDifferenceByHole,
} from '../store/statsEngine';
import StatDetailSheet from '../components/StatDetailSheet';

const TABS = ['Overview', 'Players', 'Holes', 'Pairs', 'Shame'];

const firstName = (p) => p.name.split(' ')[0];
const joinNames = (players) => {
  const counts = new Map();
  players.forEach(p => {
    const n = firstName(p);
    counts.set(n, (counts.get(n) || 0) + 1);
  });
  const tokens = [...counts.entries()].map(([n, c]) => c > 1 ? `${n} ×${c}` : n);
  if (tokens.length <= 1) return tokens[0] || '';
  if (tokens.length === 2) return `${tokens[0]} & ${tokens[1]}`;
  return `${tokens.slice(0, -1).join(', ')} & ${tokens[tokens.length - 1]}`;
};
const toneForPoints = (p) => p >= 3 ? 'excellent' : p === 2 ? 'good' : p === 1 ? 'neutral' : 'poor';
const holeRowFromBreakdown = (b, i, tone) => ({
  key: `${b.roundIndex}-${b.holeNumber}-${i}`,
  primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
  secondary: `Par ${b.par} · ${b.strokes} strokes`,
  rightPrimary: `${b.points} pts`,
  tone: tone || toneForPoints(b.points),
});
const sectionRow = (key, label, rightLabel) => ({ key: `sec-${key}`, section: true, label, rightLabel });
const tiedRowsByPlayer = (entries, makeRows, headerRight) => {
  if (entries.length === 1) return makeRows(entries[0]);
  const groups = new Map();
  entries.forEach(e => {
    const list = groups.get(e.player.id) || { player: e.player, items: [] };
    list.items.push(e);
    groups.set(e.player.id, list);
  });
  const result = [];
  let idx = 0;
  for (const { player, items } of groups.values()) {
    const count = items.length;
    const label = count > 1 ? `${firstName(player)} ×${count}` : firstName(player);
    const right = count === 1 && headerRight ? headerRight(items[0]) : null;
    result.push(sectionRow(`${idx}`, label, right));
    items.forEach(e => result.push(...makeRows(e)));
    idx++;
  }
  return result;
};

export default function StatsScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [tournament, setTournament] = useState(null);
  const [tab, setTab] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(0);
  const [h2hPlayer, setH2hPlayer] = useState(1);
  const [metric, setMetric] = useState('points');

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

      {(tab === 0 || tab === 1 || tab === 2 || tab === 3 || tab === 4) && (
        <View style={s.scoringToggle}>
          <Text style={[s.scoringLabel, metric === 'strokes' && s.scoringLabelActive]}>Strokes</Text>
          <Switch
            value={metric === 'points'}
            onValueChange={(v) => setMetric(v ? 'points' : 'strokes')}
            trackColor={{ false: theme.border.default, true: theme.accent.primary }}
            thumbColor="#fff"
          />
          <Text style={[s.scoringLabel, metric === 'points' && s.scoringLabelActive]}>Points</Text>
        </View>
      )}

      <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
        {tab === 0 && <OverviewTab tournament={tournament} metric={metric} theme={theme} s={s} />}
        {tab === 1 && <PlayersTab tournament={tournament} players={players} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} metric={metric} theme={theme} s={s} />}
        {tab === 2 && <HolesTab tournament={tournament} completedRounds={completedRounds} metric={metric} theme={theme} s={s} />}
        {tab === 3 && <PairsTab tournament={tournament} players={players} h2hPlayer={h2hPlayer} setH2hPlayer={setH2hPlayer} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} metric={metric} theme={theme} s={s} />}
        {tab === 4 && <ShameTab tournament={tournament} metric={metric} theme={theme} s={s} />}
      </ScrollView>
    </View>
  );
}

// ── Overview Tab ──
function OverviewTab({ tournament, metric, theme, s }) {
  const [roundIndex, setRoundIndex] = useState(null);
  const highlights = tournamentHighlights(tournament, { metric, roundIndex });
  const isStrokes = metric === 'strokes';
  const modeLabel = isStrokes ? 'strokes (gross)' : 'points (net Stableford)';
  const fmtValue = (v, unit) => `${v} ${unit}`;
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
    const unit = isStrokes ? 'strokes' : 'pts';
    setSheet({
      title: `${joinNames(h.entries.map(e => e.player))} — ${h.value} ${unit}`,
      subtitle: `${roundIndex === null ? 'Best round' : 'Top scorer'} · ${modeLabel}`,
      explainer: isStrokes
        ? 'The player(s) with the lowest total strokes in the selected scope.'
        : 'The player(s) with the highest Stableford points total in the selected scope. Points are handicap-adjusted (net).',
      rows: tiedRowsByPlayer(
        h.entries,
        (e) => e.breakdown.map(b => ({
          key: `${e.player.id}-${b.holeNumber}`,
          primary: `Hole ${b.holeNumber}`,
          secondary: `Par ${b.par} · ${b.strokes} strokes`,
          rightPrimary: isStrokes ? `${b.strokes} str` : `${b.points} pts`,
          tone: toneForPoints(b.points),
        })),
        (e) => `${e.courseName} · ${isStrokes ? e.strokes + ' str' : e.points + ' pts'}`,
      ),
    });
  };

  const openBirdies = () => {
    const h = highlights.mostBirdies;
    setSheet({
      title: `${joinNames(h.entries.map(e => e.player))} — ${h.value} birdies+`,
      subtitle: `Birdies & Eagles · ${modeLabel}`,
      explainer: 'Count of holes where the player scored at least one under par (birdies and eagles combined).',
      rows: tiedRowsByPlayer(
        h.entries,
        (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
          secondary: `Par ${b.par} · ${b.strokes} strokes`,
          rightPrimary: b.vsPar <= -2 ? 'Eagle' : 'Birdie',
          tone: 'excellent',
        })),
        (e) => `${e.count} birdies+`,
      ),
    });
  };

  const openParStreak = () => {
    const h = highlights.longestParStreak;
    setSheet({
      title: `${joinNames(h.entries.map(e => e.player))} — ${h.value} holes`,
      subtitle: `Longest par streak · ${modeLabel}`,
      explainer: 'The longest run of consecutive holes scored at par or better (no interruption by a bogey or worse).',
      rows: tiedRowsByPlayer(
        h.entries,
        (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
          secondary: `Par ${b.par} · ${b.strokes} strokes`,
          rightPrimary: `${b.points} pts`,
          tone: b.vsPar <= -1 ? 'excellent' : 'good',
        })),
        (e) => `${e.count} holes`,
      ),
    });
  };

  const openHole = (h, label, explainer) => {
    const avg = isStrokes ? `${h.avgStrokes ?? '—'} avg str (${h.avgVsPar >= 0 ? '+' : ''}${h.avgVsPar ?? 0} vs par)` : `${h.avgPoints} avg pts`;
    setSheet({
      title: `Hole ${h.holeNumber} · ${h.courseName}`,
      subtitle: `${label} · Par ${h.par} · SI ${h.si} · ${avg}`,
      explainer,
      rows: h.playerScores.map(ps => ({
        key: ps.playerId,
        primary: ps.playerName,
        secondary: `${ps.strokes} strokes`,
        rightPrimary: isStrokes ? `${ps.strokes} str` : `${ps.points} pts`,
        tone: toneForPoints(ps.points),
      })),
    });
  };

  const bestRoundLabel = roundIndex === null ? 'Best Round' : 'Top Scorer';
  const br = highlights.bestRound;
  const mb = highlights.mostBirdies;
  const ps = highlights.longestParStreak;

  return (
    <View>
      <RoundSelector tournament={tournament} selected={roundIndex} onSelect={setRoundIndex} theme={theme} s={s} />
      <Text style={s.sectionTitle}>{roundIndex === null ? 'TOURNAMENT HIGHLIGHTS' : 'ROUND HIGHLIGHTS'}</Text>
      <Text style={s.scopeText}>{scope}</Text>
      {!br && <Text style={s.emptyText}>No scores for this round yet.</Text>}
      {br && (
        <HighlightCard
          icon="award"
          label={bestRoundLabel}
          value={`${joinNames(br.entries.map(e => e.player))} — ${br.value} ${isStrokes ? 'str' : 'pts'}`}
          sub={br.entries.length === 1 ? br.entries[0].courseName : `${br.entries.length} tied`}
          onPress={openBestRound} theme={theme} s={s}
        />
      )}
      {mb && mb.value > 0 && (
        <HighlightCard
          icon="zap"
          label="Most Birdies+"
          value={`${joinNames(mb.entries.map(e => e.player))} — ${mb.value}`}
          sub={`Birdies + Eagles (${modeLabel})`}
          onPress={openBirdies} theme={theme} s={s}
        />
      )}
      {ps && ps.value > 1 && (
        <HighlightCard
          icon="trending-up"
          label="Longest Par Streak"
          value={`${joinNames(ps.entries.map(e => e.player))} — ${ps.value} holes`}
          sub={`Consecutive holes at par or better (${modeLabel})`}
          onPress={openParStreak} theme={theme} s={s}
        />
      )}
      {highlights.bestHole && (
        <HighlightCard
          icon="thumbs-up"
          label="Easiest Hole"
          value={`Hole ${highlights.bestHole.holeNumber} — ${isStrokes ? `${highlights.bestHole.avgVsPar >= 0 ? '+' : ''}${highlights.bestHole.avgVsPar} avg` : `${highlights.bestHole.avgPoints} avg pts`}`}
          sub={`${highlights.bestHole.courseName} · Par ${highlights.bestHole.par} · SI ${highlights.bestHole.si}`}
          onPress={() => openHole(highlights.bestHole, 'Easiest Hole', isStrokes ? 'Hole with the lowest average strokes-vs-par across all players in scope.' : 'Hole with the highest average Stableford points across all players in scope.')}
          theme={theme} s={s}
        />
      )}
      {highlights.worstHole && (
        <HighlightCard
          icon="thumbs-down"
          label="Hardest Hole"
          value={`Hole ${highlights.worstHole.holeNumber} — ${isStrokes ? `${highlights.worstHole.avgVsPar >= 0 ? '+' : ''}${highlights.worstHole.avgVsPar} avg` : `${highlights.worstHole.avgPoints} avg pts`}`}
          sub={`${highlights.worstHole.courseName} · Par ${highlights.worstHole.par} · SI ${highlights.worstHole.si}`}
          onPress={() => openHole(highlights.worstHole, 'Hardest Hole', isStrokes ? 'Hole with the highest average strokes-vs-par across all players in scope.' : 'Hole with the lowest average Stableford points across all players in scope.')}
          theme={theme} s={s}
        />
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        explainer={sheet?.explainer}
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
function PlayersTab({ tournament, players, selectedPlayer, setSelectedPlayer, metric, theme, s }) {
  const player = players[selectedPlayer];
  const [sheet, setSheet] = useState(null);
  if (!player) return null;

  const isStrokes = metric === 'strokes';
  const dist = playerScoreDistribution(tournament, player.id, { metric });
  const streaks = playerStreaks(tournament, player.id, { metric });
  const history = playerRoundHistory(tournament, player.id);
  const avg = playerAvgStableford(tournament, player.id);
  const modeLabel = isStrokes ? 'strokes (gross)' : 'points (net Stableford)';

  const defaultTone = (b) => toneForPoints(b.points);

  const holeRows = (holes, toneFn) => holes.map((b, i) => holeRowFromBreakdown(b, i, toneFn(b)));

  const openStreak = (title, holes, toneFn, explainer) => setSheet({
    title,
    subtitle: `${player.name} · ${modeLabel}`,
    explainer,
    rows: holeRows(holes, toneFn),
  });

  const openBucket = (label, holes, explainer) => {
    if (holes.length === 0) return;
    setSheet({
      title: `${player.name} — ${holes.length} ${label}`,
      subtitle: modeLabel,
      explainer,
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
        primary: `Hole ${h.number}`,
        secondary: `Par ${h.par} · ${sc} strokes`,
        rightPrimary: `${pts} pts`,
        tone: toneForPoints(pts),
      };
    }).filter(Boolean);
    setSheet({
      title: `R${r.roundIndex + 1} · ${r.courseName}`,
      subtitle: `${player.name} — ${r.points} pts · ${r.strokes} strokes`,
      explainer: 'Hole-by-hole breakdown for this round.',
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
              <DistBar label="Eagle+" count={dist.eagles} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('Eagles', dist.eagleHoles, 'Holes scored at least 2 under par.')} s={s} />
              <DistBar label="Birdie" count={dist.birdies} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('Birdies', dist.birdieHoles, 'Holes scored exactly 1 under par.')} s={s} />
              <DistBar label="Par" count={dist.pars} total={dist.total} color={theme.scoreColor('good')} onPress={() => openBucket('Pars', dist.parHoles, 'Holes scored at par.')} s={s} />
              <DistBar label="Bogey" count={dist.bogeys} total={dist.total} color={theme.scoreColor('neutral')} onPress={() => openBucket('Bogeys', dist.bogeyHoles, 'Holes scored exactly 1 over par.')} s={s} />
              <DistBar label="Dbl+" count={dist.doubles + dist.worse} total={dist.total} color={theme.scoreColor('poor')} onPress={() => openBucket('Doubles or worse', [...dist.doubleHoles, ...dist.worseHoles], 'Holes scored 2 or more over par.')} s={s} />
            </View>
          </View>

          <Text style={s.sectionTitle}>STREAKS</Text>
          <View style={s.card}>
            <View style={s.streakRow}>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bestBirdieStreak > 0 && openStreak(`Birdie streak — ${streaks.bestBirdieStreak} holes`, streaks.birdieStreakHoles, () => 'excellent', 'Longest run of consecutive holes at birdie or better.')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestBirdieStreak}</Text>
                <Text style={s.streakLabel}>Birdie streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bestParStreak > 0 && openStreak(`Par streak — ${streaks.bestParStreak} holes`, streaks.parStreakHoles, defaultTone, 'Longest run of consecutive holes at par or better.')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('good') }]}>{streaks.bestParStreak}</Text>
                <Text style={s.streakLabel}>Par streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bogeyOnlyStreak > 0 && openStreak(`Bogey streak — ${streaks.bogeyOnlyStreak} holes`, streaks.bogeyOnlyStreakHoles, () => 'neutral', 'Longest run of consecutive holes at exactly 1 over par.')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('neutral') }]}>{streaks.bogeyOnlyStreak}</Text>
                <Text style={s.streakLabel}>Bogey streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.doubleBogeyPlusStreak > 0 && openStreak(`Dbl+ streak — ${streaks.doubleBogeyPlusStreak} holes`, streaks.doubleBogeyPlusStreakHoles, () => 'poor', 'Longest run of consecutive holes at 2 or more over par.')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('poor') }]}>{streaks.doubleBogeyPlusStreak}</Text>
                <Text style={s.streakLabel}>Dbl+ streak</Text>
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
        explainer={sheet?.explainer}
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
function HolesTab({ tournament, completedRounds, metric, theme, s }) {
  const isStrokes = metric === 'strokes';
  const bw = bestWorstHoles(tournament, { metric });
  const firstCompletedIdx = tournament.rounds.findIndex(r => r.scores && Object.keys(r.scores).length > 0);
  const [heatRound, setHeatRound] = useState(firstCompletedIdx >= 0 ? firstCompletedIdx : 0);
  const heatmap = holeDifficultyMap(tournament, heatRound);
  const [sheet, setSheet] = useState(null);

  const renderAvg = (h) => isStrokes
    ? `${h.avgVsPar >= 0 ? '+' : ''}${h.avgVsPar} avg`
    : `${h.avgPoints} avg pts`;

  const openHole = (h, label, explainer) => setSheet({
    title: `Hole ${h.holeNumber} · ${h.courseName}`,
    subtitle: `${label} · Par ${h.par} · SI ${h.si} · ${renderAvg(h)}`,
    explainer,
    rows: h.playerScores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: `${ps.strokes} strokes`,
      rightPrimary: isStrokes ? `${ps.strokes} str` : `${ps.points} pts`,
      tone: toneForPoints(ps.points),
    })),
  });

  return (
    <View>
      {bw.best.length > 0 && (
        <>
          <Text style={s.sectionTitle}>EASIEST HOLES</Text>
          {bw.best.map((h, i) => (
            <TouchableOpacity key={`b${i}`} style={s.holeCard} onPress={() => openHole(h, 'Easiest Hole', isStrokes ? 'Hole with the lowest average strokes-vs-par.' : 'Hole with the highest average Stableford points.')} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par} · SI {h.si}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('excellent') }]}>{renderAvg(h)}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {bw.worst.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HARDEST HOLES</Text>
          {bw.worst.map((h, i) => (
            <TouchableOpacity key={`w${i}`} style={s.holeCard} onPress={() => openHole(h, 'Hardest Hole', isStrokes ? 'Hole with the highest average strokes-vs-par.' : 'Hole with the lowest average Stableford points.')} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par} · SI {h.si}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('poor') }]}>{renderAvg(h)}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {completedRounds.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HOLE HEATMAP</Text>
          <RoundSelector tournament={tournament} selected={heatRound} onSelect={(v) => v !== null && setHeatRound(v)} theme={theme} s={s} />
          <Text style={s.scopeText}>{tournament.rounds[heatRound]?.courseName}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={s.heatRow}>
                <Text style={[s.heatCell, s.heatHeader, s.heatHoleCol]}>Hole</Text>
                <Text style={[s.heatCell, s.heatHeader, s.heatSiCol]}>SI</Text>
                {tournament.players.map(p => (
                  <Text key={p.id} style={[s.heatCell, s.heatHeader]}>{firstName(p)}</Text>
                ))}
                <Text style={[s.heatCell, s.heatHeader]}>Avg</Text>
              </View>
              {heatmap.map(h => (
                <View key={h.holeNumber} style={s.heatRow}>
                  <Text style={[s.heatCell, s.heatHoleNum, s.heatHoleCol]}>{h.holeNumber}</Text>
                  <Text style={[s.heatCell, s.heatSiCol, s.heatSi]}>{h.si}</Text>
                  {tournament.players.map(p => {
                    const ps = h.playerScores.find(x => x.playerId === p.id);
                    if (isStrokes) {
                      const strokes = ps?.strokes ?? null;
                      const vsPar = strokes != null ? strokes - h.par : null;
                      const color = vsPar == null ? theme.text.muted
                        : vsPar < 0 ? theme.scoreColor('excellent')
                        : vsPar === 0 ? theme.scoreColor('good')
                        : vsPar === 1 ? theme.scoreColor('neutral')
                        : theme.scoreColor('poor');
                      return (
                        <View key={p.id} style={[s.heatCell, s.heatValue, { backgroundColor: color + '18' }]}>
                          <Text style={[s.heatValueText, { color }]}>{strokes ?? '-'}</Text>
                        </View>
                      );
                    }
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
                    <Text style={s.heatAvgText}>{isStrokes ? (h.avgStrokes ?? '-') : h.avgPoints}</Text>
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
        explainer={sheet?.explainer}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

// ── Pairs Tab ──
function PairsTab({ tournament, players, h2hPlayer, setH2hPlayer, selectedPlayer, setSelectedPlayer, metric, theme, s }) {
  const pairs = pairPerformance(tournament);
  const [hwRound, setHwRound] = useState(null);
  const holeWins = pairHoleWins(tournament, { metric, roundIndex: hwRound });
  const firstCompletedRound = tournament.rounds.findIndex(r => r.scores && Object.keys(r.scores).length > 0);
  const [pdRound, setPdRound] = useState(firstCompletedRound >= 0 ? firstCompletedRound : null);
  const pdData = pdRound != null ? pairDifferenceByHole(tournament, pdRound, { metric }) : null;
  const [h2hRound, setH2hRound] = useState(null);
  const p1 = players[selectedPlayer];
  const p2Idx = h2hPlayer >= players.length ? 0 : h2hPlayer;
  const p2 = players[p2Idx];
  const h2h = p1 && p2 && p1.id !== p2.id ? headToHead(tournament, p1.id, p2.id, { roundIndex: h2hRound }) : null;
  const [sheet, setSheet] = useState(null);

  const openPair = (pair) => setSheet({
    title: `${pair.players[0].name} & ${pair.players[1].name}`,
    subtitle: `${pair.avgPoints} avg pts · ${pair.rounds} round${pair.rounds !== 1 ? 's' : ''}`,
    explainer: 'Combined Stableford points this pairing scored together each round, averaged across rounds played.',
    rows: pair.roundList.map(r => ({
      key: `r${r.roundIndex}`,
      primary: `R${r.roundIndex + 1} · ${r.courseName}`,
      secondary: r.memberPoints.map(m => `${firstName({ name: m.playerName })} ${m.points}`).join(' · '),
      rightPrimary: `${r.combinedPoints} pts`,
      rightSecondary: `${r.combinedStrokes} strokes`,
    })),
  });

  const openHoleWinsInfo = () => setSheet({
    title: 'Hole Wins — how W·T·L works',
    subtitle: 'Total · Best Ball · Worst Ball',
    explainer:
      (metric === 'strokes'
        ? 'Each hole your pair plays against the other pair. Best Ball (BB) = the lower-strokes score of the two partners. Worst Ball (WB) = the higher. Your pair wins BB (or WB) by beating the other pair\'s corresponding score; equal = tie. You earn a BB W/T/L only when your score is your pair\'s BB; a WB W/T/L only when it is your pair\'s WB. Total = BB + WB credits.'
        : 'Each hole your pair plays against the other pair. Best Ball (BB) = the higher-points score of the two partners. Worst Ball (WB) = the lower. Your pair wins BB (or WB) by beating the other pair\'s corresponding score; equal = tie. You earn a BB W/T/L only when your score is your pair\'s BB; a WB W/T/L only when it is your pair\'s WB. Total = BB + WB credits.')
      + '\n\nRole tiebreaker within a pair (when partners tie on the metric): lower playing handicap is BB. If handicap ties, the partner who did better on the previous hole is BB — walking backwards hole by hole until broken. Final fallback is a stable id sort.\n\nHoles where any of the 4 scores is missing are skipped entirely, so W+T+L may be below 18 if the round is incomplete.',
    rows: [],
  });

  const openPairDiffInfo = () => setSheet({
    title: 'Pair difference — how the chart works',
    subtitle: 'Cumulative advantage, hole by hole',
    explainer:
      (metric === 'strokes'
        ? 'At each hole we sum both partners\' strokes per pair, then track the running strokes-saved advantage (pair2 strokes − pair1 strokes). Bars above the baseline mean Pair 1 is ahead (taking fewer strokes); bars below mean Pair 2 is ahead. '
        : 'At each hole we sum both partners\' Stableford points per pair, then track the running points-difference (pair1 − pair2). Bars above the baseline mean Pair 1 is ahead; bars below mean Pair 2 is ahead. ')
      + 'Height is proportional to the absolute cumulative gap, so longer bars = bigger distance. Crossovers are the holes where the lead flips. Tap any hole for the exact split.',
    rows: [],
  });

  const openHoleWins = (row, metricMode) => {
    const unit = metricMode === 'strokes' ? 'str' : 'pts';
    setSheet({
      title: `${row.player.name} — hole-by-hole wins`,
      subtitle: `Total ${row.total.W}·${row.total.T}·${row.total.L}  BB ${row.best.W}·${row.best.T}·${row.best.L}  WB ${row.worst.W}·${row.worst.T}·${row.worst.L}`,
      explainer: metricMode === 'strokes'
        ? 'On each hole, pairs compare strokes (lower is better). BB (Best Ball) = fewer-strokes player of your pair vs theirs; WB (Worst Ball) = higher-strokes player. W/T/L = Won/Tied/Lost. Total sums both roles.'
        : 'On each hole, pairs compare Stableford points (higher is better). BB (Best Ball) = higher-scorer of your pair vs theirs; WB (Worst Ball) = lower-scorer. W/T/L = Won/Tied/Lost. Total sums both roles.',
      rows: row.breakdown.map((b, i) => {
        const roleParts = [];
        if (b.bestRole) roleParts.push(`BB ${b.bestOutcome}`);
        if (b.worstRole) roleParts.push(`WB ${b.worstOutcome}`);
        const tone = roleParts.some(p => p.endsWith('W')) && !roleParts.some(p => p.endsWith('L'))
          ? 'excellent'
          : roleParts.every(p => p.endsWith('L'))
            ? 'poor'
            : 'neutral';
        return {
          key: `${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
          secondary: `Par ${b.par} · you ${b.playerValue} ${unit} (team ${b.teamBest}/${b.teamWorst} · opp ${b.oppBest}/${b.oppWorst})`,
          rightPrimary: roleParts.join(' · '),
          tone,
        };
      }),
    });
  };

  const openPairDiffHole = (holeEntry) => {
    if (!pdData) return;
    const unit = metric === 'strokes' ? 'str' : 'pts';
    const isStr = metric === 'strokes';
    const pair1Label = pdData.pair1.map(p => firstName(p)).join(' & ');
    const pair2Label = pdData.pair2.map(p => firstName(p)).join(' & ');
    const cum = holeEntry.cumulative;
    const leader = cum > 0 ? pair1Label : cum < 0 ? pair2Label : 'Tied';
    const leadText = cum === 0 ? 'Level' : `${leader} +${Math.abs(cum)} ${unit}`;
    const holeSplit = holeEntry.pair1Total != null
      ? `${pair1Label} ${holeEntry.pair1Total} · ${pair2Label} ${holeEntry.pair2Total}`
      : 'hole not played';
    const holeDeltaLabel = holeEntry.holeDelta == null
      ? '—'
      : holeEntry.holeDelta === 0
        ? 'even'
        : holeEntry.holeDelta > 0
          ? `${pair1Label} +${holeEntry.holeDelta}`
          : `${pair2Label} +${Math.abs(holeEntry.holeDelta)}`;
    setSheet({
      title: `Hole ${holeEntry.holeNumber} — pair split`,
      subtitle: `${pdData.courseName} · Par ${holeEntry.par} · ${isStr ? 'strokes' : 'points'}`,
      explainer: `After this hole: ${leadText}. Hole result: ${holeDeltaLabel}. Combined totals: ${holeSplit}.`,
      rows: [],
    });
  };

  const openH2H = (metricMode) => {
    if (!h2h) return;
    const isStr = metricMode === 'strokes';
    const bucket = isStr ? h2h.strokes : h2h.points;
    setSheet({
      title: `${firstName(p1)} vs ${firstName(p2)} — by ${isStr ? 'strokes' : 'points'}`,
      subtitle: `Holes won: ${firstName(p1)} ${bucket.p1Wins} · ${firstName(p2)} ${bucket.p2Wins} · ${bucket.ties} ties`,
      explainer: isStr
        ? "On each hole both players played, we count who took fewer strokes. Fewer = win. Equal strokes = tie."
        : "On each hole both players played, we count who scored more Stableford points (handicap-adjusted). Higher = win. Equal = tie.",
      rows: h2h.holes.map((h, i) => {
        const v1 = isStr ? h.p1Strokes : h.p1Points;
        const v2 = isStr ? h.p2Strokes : h.p2Points;
        const p1Won = isStr ? v1 < v2 : v1 > v2;
        const p2Won = isStr ? v2 < v1 : v2 > v1;
        const winner = p1Won ? firstName(p1) : p2Won ? firstName(p2) : 'Tie';
        const tone = v1 === v2 ? 'neutral' : 'good';
        return {
          key: `${h.roundIndex}-${h.courseName}-${h.holeNumber}-${i}`,
          primary: `R${h.roundIndex + 1} · ${h.courseName} · Hole ${h.holeNumber}`,
          secondary: `${firstName(p1)} ${v1} · ${firstName(p2)} ${v2}`,
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
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{metric === 'strokes' ? 'HOLE WINS ON STROKES' : 'HOLE WINS ON POINTS'}</Text>
            <TouchableOpacity
              onPress={openHoleWinsInfo}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={s.sectionTitleInfo}
            >
              <Feather name="info" size={14} color={theme.text.muted} />
            </TouchableOpacity>
          </View>
          <RoundSelector tournament={tournament} selected={hwRound} onSelect={setHwRound} theme={theme} s={s} />
          <HoleWinsTable rows={holeWins} metricMode={metric} openRow={openHoleWins} theme={theme} s={s} />
        </>
      )}

      {firstCompletedRound >= 0 && tournament.rounds.some(r => r.pairs && r.scores && Object.keys(r.scores).length > 0) && (
        <>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{metric === 'strokes' ? 'PAIR DIFFERENCE ON STROKES' : 'PAIR DIFFERENCE ON POINTS'}</Text>
            <TouchableOpacity
              onPress={openPairDiffInfo}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={s.sectionTitleInfo}
            >
              <Feather name="info" size={14} color={theme.text.muted} />
            </TouchableOpacity>
          </View>
          <PairRoundSelector tournament={tournament} selected={pdRound} onSelect={setPdRound} theme={theme} s={s} />
          {pdData ? (
            <PairDifferenceChart data={pdData} metric={metric} onHolePress={openPairDiffHole} theme={theme} s={s} />
          ) : (
            <Text style={s.emptyText}>No pair data for this round.</Text>
          )}
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
        <>
          <RoundSelector tournament={tournament} selected={h2hRound} onSelect={setH2hRound} theme={theme} s={s} />
          <H2HCard
            label={metric === 'strokes' ? 'Holes won by strokes' : 'Holes won by points'}
            explainer={metric === 'strokes' ? 'Fewer strokes on the hole' : 'Higher Stableford points on the hole'}
            p1={p1} p2={p2}
            bucket={metric === 'strokes' ? h2h.strokes : h2h.points}
            onPress={() => openH2H(metric)}
            theme={theme} s={s}
          />
          <View style={s.h2hTotals}>
            <Text style={s.h2hTotalsText}>
              Totals · {firstName(p1)} {metric === 'strokes' ? `${h2h.totals.p1Strokes} str` : `${h2h.totals.p1Points} pts`} · {firstName(p2)} {metric === 'strokes' ? `${h2h.totals.p2Strokes} str` : `${h2h.totals.p2Points} pts`}
            </Text>
            <Text style={s.h2hTotalsSub}>{h2h.totals.holesCompared} holes compared</Text>
          </View>
        </>
      ) : (
        <Text style={s.emptyText}>Select two different players to compare.</Text>
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        explainer={sheet?.explainer}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

// Round selector that requires a round (no "Total" option) — used by the
// pair-difference chart, since the cumulative view is inherently per-round.
function PairRoundSelector({ tournament, selected, onSelect, theme, s }) {
  return (
    <View style={s.roundSelector}>
      {tournament.rounds.map((r, i) => {
        const hasData = r.scores && Object.keys(r.scores).length > 0 && r.pairs && r.pairs.length >= 2;
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

function PairDifferenceChart({ data, metric, onHolePress, theme, s }) {
  const CHART_HEIGHT = 160;
  const HALF = CHART_HEIGHT / 2;
  const PADDING = 10;
  const unit = metric === 'strokes' ? 'str' : 'pts';
  const pair1Label = data.pair1.map(p => p.name.split(' ')[0]).join(' & ');
  const pair2Label = data.pair2.map(p => p.name.split(' ')[0]).join(' & ');
  const scale = data.maxAbs > 0 ? (HALF - PADDING) / data.maxAbs : 0;

  const maxLeadHole = data.holes.reduce((best, h) => {
    if (h.cumulative == null) return best;
    if (!best || Math.abs(h.cumulative) > Math.abs(best.cumulative)) return h;
    return best;
  }, null);
  const leaderLabel = data.finalDelta > 0 ? pair1Label : data.finalDelta < 0 ? pair2Label : 'Level';
  const maxLeadLabel = maxLeadHole && maxLeadHole.cumulative !== 0
    ? `${maxLeadHole.cumulative > 0 ? pair1Label : pair2Label} +${Math.abs(maxLeadHole.cumulative)} ${unit} @ H${maxLeadHole.holeNumber}`
    : 'Never apart';

  return (
    <View style={s.pdCard}>
      <View style={s.pdLegend}>
        <View style={s.pdLegendItem}>
          <View style={[s.pdLegendDot, { backgroundColor: theme.pairA }]} />
          <Text style={s.pdLegendText}>{pair1Label}</Text>
        </View>
        <Text style={s.pdLegendVs}>vs</Text>
        <View style={s.pdLegendItem}>
          <View style={[s.pdLegendDot, { backgroundColor: theme.pairB }]} />
          <Text style={s.pdLegendText}>{pair2Label}</Text>
        </View>
      </View>

      <View style={[s.pdChart, { height: CHART_HEIGHT }]}>
        <View style={[s.pdBaseline, { top: HALF }]} />
        <View style={s.pdBarsRow}>
          {data.holes.map((h) => {
            const isPlayed = h.cumulative != null && h.holeDelta != null;
            const absDelta = isPlayed ? Math.abs(h.cumulative) : 0;
            const barH = Math.max(isPlayed && absDelta > 0 ? 2 : 0, absDelta * scale);
            const positive = isPlayed && h.cumulative > 0;
            const negative = isPlayed && h.cumulative < 0;
            return (
              <TouchableOpacity
                key={h.holeNumber}
                style={[s.pdCol, { height: CHART_HEIGHT }]}
                onPress={() => onHolePress(h)}
                activeOpacity={0.6}
                disabled={!isPlayed}
              >
                {positive && (
                  <View style={[s.pdBarPos, {
                    bottom: HALF,
                    height: barH,
                    backgroundColor: theme.pairA,
                  }]} />
                )}
                {negative && (
                  <View style={[s.pdBarNeg, {
                    top: HALF,
                    height: barH,
                    backgroundColor: theme.pairB,
                  }]} />
                )}
                {isPlayed && h.cumulative === 0 && (
                  <View style={[s.pdBarZero, { top: HALF - 1 }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={s.pdAxis}>
        {data.holes.map(h => (
          <Text key={h.holeNumber} style={s.pdAxisLabel}>{h.holeNumber}</Text>
        ))}
      </View>

      <View style={s.pdSummary}>
        <View style={s.pdSummaryCell}>
          <Text style={s.pdSummaryLabel}>Max lead</Text>
          <Text style={s.pdSummaryValue}>{maxLeadLabel}</Text>
        </View>
        <View style={s.pdSummaryCell}>
          <Text style={s.pdSummaryLabel}>Final</Text>
          <Text style={s.pdSummaryValue}>
            {data.finalDelta === 0 ? 'Tied' : `${leaderLabel} +${Math.abs(data.finalDelta)} ${unit}`}
          </Text>
        </View>
        <View style={s.pdSummaryCell}>
          <Text style={s.pdSummaryLabel}>Crossovers</Text>
          <Text style={s.pdSummaryValue}>{data.crossovers}</Text>
        </View>
      </View>
    </View>
  );
}

function HoleWinsTable({ rows, metricMode, openRow, theme, s }) {
  const empty = rows.length === 0 || rows.every(r => r.total.W + r.total.T + r.total.L === 0);
  return (
    <View style={s.hwSubSection}>
      <View style={s.hwCard}>
        <View style={s.hwGroupHeader}>
          <View style={{ flex: 1.2 }} />
          <Text style={s.hwGroupTitle}>TOTAL</Text>
          <Text style={s.hwGroupTitle}>BB</Text>
          <Text style={s.hwGroupTitle}>WB</Text>
        </View>
        <View style={s.hwSubHeader}>
          <View style={{ flex: 1.2 }} />
          <HwGEPLabels theme={theme} s={s} />
          <HwGEPLabels theme={theme} s={s} />
          <HwGEPLabels theme={theme} s={s} />
        </View>
        {empty ? (
          <Text style={s.hwEmpty}>No data for this view.</Text>
        ) : (
          rows.map(row => {
            const rowEmpty = row.total.W + row.total.T + row.total.L === 0;
            return (
              <TouchableOpacity
                key={row.player.id}
                style={s.hwBigRow}
                onPress={() => !rowEmpty && openRow(row, metricMode)}
                activeOpacity={0.7}
                disabled={rowEmpty}
              >
                <Text style={[s.hwPlayerName, rowEmpty && s.hwDimmed]}>{row.player.name.split(' ')[0]}</Text>
                <HwGEPCells stats={row.total} strong theme={theme} s={s} />
                <HwGEPCells stats={row.best} theme={theme} s={s} />
                <HwGEPCells stats={row.worst} theme={theme} s={s} />
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </View>
  );
}

function H2HCard({ label, explainer, p1, p2, bucket, onPress, theme, s }) {
  return (
    <TouchableOpacity style={s.h2hMetricCard} onPress={onPress} activeOpacity={0.7}>
      <View style={s.h2hMetricHeader}>
        <Text style={s.h2hMetricLabel}>{label}</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </View>
      <View style={s.h2hMetricRow}>
        <View style={s.h2hMetricPlayer}>
          <Text style={s.h2hMetricName}>{firstName(p1)}</Text>
          <Text style={[s.h2hMetricScore, bucket.p1Wins > bucket.p2Wins && { color: theme.accent.primary }]}>{bucket.p1Wins}</Text>
        </View>
        <Text style={s.h2hMetricTies}>{bucket.ties} ties</Text>
        <View style={s.h2hMetricPlayer}>
          <Text style={s.h2hMetricName}>{firstName(p2)}</Text>
          <Text style={[s.h2hMetricScore, bucket.p2Wins > bucket.p1Wins && { color: theme.accent.primary }]}>{bucket.p2Wins}</Text>
        </View>
      </View>
      <Text style={s.h2hMetricExplainer}>{explainer}</Text>
    </TouchableOpacity>
  );
}

function HwGEPLabels({ theme, s }) {
  return (
    <View style={s.hwGepRow}>
      <Text style={[s.hwGepLabel, { color: theme.scoreColor('excellent') }]}>W</Text>
      <Text style={[s.hwGepLabel, { color: theme.text.muted }]}>T</Text>
      <Text style={[s.hwGepLabel, { color: theme.scoreColor('poor') }]}>L</Text>
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

function ShameTab({ tournament, metric, theme, s }) {
  const shame = hallOfShame(tournament, { metric });
  const [sheet, setSheet] = useState(null);
  const modeLabel = metric === 'strokes' ? 'strokes (gross)' : 'points (net Stableford)';

  const holeRows = (holes, playerId) => holes.map((b, i) => ({
    key: `${playerId || ''}-${b.roundIndex}-${b.holeNumber}-${i}`,
    primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
    secondary: `Par ${b.par} · ${b.strokes} strokes`,
    rightPrimary: `${b.points} pts`,
    tone: b.points === 0 ? 'poor' : b.vsPar >= 1 ? 'neutral' : 'good',
  }));

  const openSingleHoleTied = (stat, label, explainer, formatRow) => setSheet({
    title: `${joinNames(stat.entries.map(e => e.player))} — ${label}`,
    subtitle: modeLabel,
    explainer,
    rows: tiedRowsByPlayer(
      stat.entries,
      (e) => formatRow(e),
      (e) => `R${e.roundIndex + 1} · ${e.courseName} · Hole ${e.holeNumber}`,
    ),
  });

  const openTripleBogey = () => openSingleHoleTied(
    shame.tripleBogey,
    `+${shame.tripleBogey.value} over par`,
    'Single hole with the highest number of strokes above par across all players.',
    (e) => [{
      key: `${e.player.id}-tb`,
      primary: `Par ${e.par} · SI ${e.si}`,
      secondary: `${e.strokes} strokes`,
      rightPrimary: `${e.points} pts`,
      tone: 'poor',
    }],
  );

  const openStreakTied = (stat, titleSuffix, explainer) => setSheet({
    title: `${joinNames(stat.entries.map(e => e.player))} — ${stat.value} ${titleSuffix}`,
    subtitle: modeLabel,
    explainer,
    rows: tiedRowsByPlayer(
      stat.entries,
      (e) => holeRows(e.breakdown, e.player.id),
      (e) => `${e.count} holes`,
    ),
  });

  const openBogeyStreak = () => openStreakTied(
    shame.bogeyStreak,
    'bogeys in a row',
    'Longest run of consecutive holes scored exactly 1 over par. Bogey-only (not triggered by doubles or worse).',
  );

  const openDoubleBogeyStreak = () => openStreakTied(
    shame.doubleBogeyStreak,
    'dbl+ in a row',
    'Longest run of consecutive holes scored 2 or more over par.',
  );

  const openPointless = () => openStreakTied(
    shame.pointlessStreak,
    '0-pt holes',
    'Longest run of consecutive holes scoring zero Stableford points.',
  );

  const openGift = () => {
    const stat = shame.gift;
    setSheet({
      title: `${joinNames(stat.entries.map(e => e.player))} — gap ${stat.value} pts`,
      subtitle: modeLabel,
      explainer: "The biggest positive gap between the other players' average points on a hole and this player's points on the same hole.",
      rows: tiedRowsByPlayer(
        stat.entries,
        (e) => e.breakdown.map(b => ({
          key: `${e.player.id}-${b.playerId}`,
          primary: b.playerName,
          secondary: `${b.strokes} strokes`,
          rightPrimary: `${b.points} pts`,
          tone: b.playerId === e.player.id ? 'poor' : toneForPoints(b.points),
        })),
        (e) => `R${e.roundIndex + 1} · ${e.courseName} · Hole ${e.holeNumber}`,
      ),
    });
  };

  const openCollapse = () => {
    const stat = shame.collapse;
    setSheet({
      title: `${joinNames(stat.entries.map(e => e.player))} — drop of ${stat.value} pts`,
      subtitle: modeLabel,
      explainer: 'Biggest drop-off in Stableford points between the front 9 and the back 9 within a single round.',
      rows: tiedRowsByPlayer(
        stat.entries,
        (e) => e.breakdown.map(b => ({
          key: `${e.player.id}-${b.holeNumber}`,
          primary: `Hole ${b.holeNumber} ${b.holeNumber <= 9 ? '(front)' : '(back)'}`,
          secondary: `Par ${b.par} · ${b.strokes} strokes`,
          rightPrimary: `${b.points} pts`,
          tone: toneForPoints(b.points),
        })),
        (e) => `R${e.roundIndex + 1} · ${e.courseName} · ${e.front}/${e.back}`,
      ),
    });
  };

  const openBlowup = () => openSingleHoleTied(
    shame.blowup,
    `${shame.blowup.value} strokes on one hole`,
    'The highest raw stroke count recorded on any single hole.',
    (e) => [{
      key: `${e.player.id}-bu`,
      primary: `Par ${e.par} · SI ${e.si}`,
      secondary: `${e.strokes} strokes · +${e.vsPar} over par`,
      rightPrimary: `${e.points} pts`,
      tone: 'poor',
    }],
  );

  const any = shame.tripleBogey || shame.bogeyStreak || shame.doubleBogeyStreak || shame.pointlessStreak || shame.gift || shame.collapse || shame.blowup;

  return (
    <View>
      {!any && <Text style={s.emptyText}>Not enough data yet. Play some rounds first!</Text>}

      {shame.tripleBogey && (
        <HighlightCard
          icon="alert-triangle"
          label="🏌️ Triple Bogey Club"
          value={`${joinNames(shame.tripleBogey.entries.map(e => e.player))} — +${shame.tripleBogey.value} over par`}
          sub={shame.tripleBogey.entries.length === 1 ? `${shame.tripleBogey.entries[0].courseName} · Hole ${shame.tripleBogey.entries[0].holeNumber}` : `${shame.tripleBogey.entries.length} tied`}
          onPress={openTripleBogey} theme={theme} s={s}
        />
      )}
      {shame.bogeyStreak && (
        <HighlightCard
          icon="trending-down"
          label="💀 Bogey Streak"
          value={`${joinNames(shame.bogeyStreak.entries.map(e => e.player))} — ${shame.bogeyStreak.value} bogeys`}
          sub={`Consecutive bogeys only (${modeLabel})`}
          onPress={openBogeyStreak} theme={theme} s={s}
        />
      )}
      {shame.doubleBogeyStreak && (
        <HighlightCard
          icon="alert-octagon"
          label="🔥 Double Bogey+ Streak"
          value={`${joinNames(shame.doubleBogeyStreak.entries.map(e => e.player))} — ${shame.doubleBogeyStreak.value} holes`}
          sub={`Consecutive dbl or worse (${modeLabel})`}
          onPress={openDoubleBogeyStreak} theme={theme} s={s}
        />
      )}
      {shame.pointlessStreak && (
        <HighlightCard
          icon="minus-circle"
          label="🕳️ Pointless Streak"
          value={`${joinNames(shame.pointlessStreak.entries.map(e => e.player))} — ${shame.pointlessStreak.value} holes`}
          sub={`Zero Stableford points (${modeLabel})`}
          onPress={openPointless} theme={theme} s={s}
        />
      )}
      {shame.gift && (
        <HighlightCard
          icon="gift"
          label="🎁 The Gift"
          value={`${joinNames(shame.gift.entries.map(e => e.player))} — gap ${shame.gift.value} pts`}
          sub={shame.gift.entries.length === 1 ? `${shame.gift.entries[0].courseName} · Hole ${shame.gift.entries[0].holeNumber}` : `${shame.gift.entries.length} tied`}
          onPress={openGift} theme={theme} s={s}
        />
      )}
      {shame.collapse && (
        <HighlightCard
          icon="activity"
          label="📉 The Collapse"
          value={`${joinNames(shame.collapse.entries.map(e => e.player))} — drop ${shame.collapse.value} pts`}
          sub={shame.collapse.entries.length === 1 ? `${shame.collapse.entries[0].courseName} · front ${shame.collapse.entries[0].front} vs back ${shame.collapse.entries[0].back}` : `${shame.collapse.entries.length} tied`}
          onPress={openCollapse} theme={theme} s={s}
        />
      )}
      {shame.blowup && (
        <HighlightCard
          icon="flag"
          label="🪣 Blow-up Hole"
          value={`${joinNames(shame.blowup.entries.map(e => e.player))} — ${shame.blowup.value} strokes`}
          sub={shame.blowup.entries.length === 1 ? `${shame.blowup.entries[0].courseName} · Hole ${shame.blowup.entries[0].holeNumber}` : `${shame.blowup.entries.length} tied`}
          onPress={openBlowup} theme={theme} s={s}
        />
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        explainer={sheet?.explainer}
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
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTitleInfo: { marginLeft: 6, marginBottom: 12, marginTop: 20, padding: 2 },

  // Pair Difference chart
  pdCard: {
    backgroundColor: t.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 14, marginBottom: 12, ...(t.isDark ? {} : t.shadow.card),
  },
  pdLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 },
  pdLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pdLegendDot: { width: 8, height: 8, borderRadius: 4 },
  pdLegendText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: t.text.primary },
  pdLegendVs: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: t.text.muted, marginHorizontal: 2 },
  pdChart: { position: 'relative', marginBottom: 4 },
  pdBaseline: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: t.border.default,
  },
  pdBarsRow: { flexDirection: 'row', alignItems: 'stretch' },
  pdCol: { flex: 1, alignItems: 'center', position: 'relative' },
  pdBarPos: {
    position: 'absolute', width: '62%', borderTopLeftRadius: 2, borderTopRightRadius: 2,
  },
  pdBarNeg: {
    position: 'absolute', width: '62%', borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
  },
  pdBarZero: {
    position: 'absolute', width: '62%', height: 2, borderRadius: 1,
    backgroundColor: t.text.muted,
  },
  pdAxis: { flexDirection: 'row', marginTop: 2 },
  pdAxisLabel: {
    flex: 1, textAlign: 'center',
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 9, color: t.text.muted,
  },
  pdSummary: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.border.subtle,
  },
  pdSummaryCell: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  pdSummaryLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, letterSpacing: 1,
    color: t.text.muted, textTransform: 'uppercase', marginBottom: 4,
  },
  pdSummaryValue: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: t.text.primary,
    textAlign: 'center',
  },
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
  heatHoleCol: { width: 40 },
  heatSiCol: { width: 36 },
  heatSi: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11 },
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
  hwSubSection: { marginBottom: 4 },
  hwSubTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 12,
    letterSpacing: 0.5, marginBottom: 6, marginTop: 6,
  },
  h2hMetricCard: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 14, marginBottom: 8, ...(t.isDark ? {} : t.shadow.card),
  },
  h2hMetricHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  h2hMetricLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 10,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  h2hMetricRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 4,
  },
  h2hMetricPlayer: { alignItems: 'center', gap: 2 },
  h2hMetricName: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.secondary, fontSize: 12 },
  h2hMetricScore: { fontFamily: 'PlayfairDisplay-Black', color: t.text.primary, fontSize: 28 },
  h2hMetricTies: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12 },
  h2hMetricExplainer: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11,
    textAlign: 'center', marginTop: 4,
  },
  h2hTotals: {
    backgroundColor: t.bg.secondary, borderRadius: 10, padding: 10, marginTop: 6,
  },
  h2hTotalsText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.secondary, fontSize: 12,
    textAlign: 'center',
  },
  h2hTotalsSub: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11,
    textAlign: 'center', marginTop: 2,
  },
});
