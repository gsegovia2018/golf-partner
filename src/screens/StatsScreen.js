import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { loadTournament, getPlayingHandicap, calcStablefordPoints, playerPartnerSplits } from '../store/tournamentStore';
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
  hallOfShame, pairHoleWins, pairDifferenceByHole,
  tournamentMomentum, clutchOnHardest, playerConsistency, courseDNA,
  parTypeSplit, warmupVsClosing, handicapROI,
  playerNemesisAndCrushed, chaosHoles, collectiveExtremes,
  pairSynergy, pairCarryRatio, swingHole,
  par3Heartbreak, pickupChampion, anchor, zeroHero,
  skinsLeaderboard, matchPlayResults, pairConfigMatrix,
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
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
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
    </SafeAreaView>
  );
}

// ── Overview Tab ──
function OverviewTab({ tournament, metric, theme, s }) {
  const [roundIndex, setRoundIndex] = useState(null);
  const highlights = tournamentHighlights(tournament, { metric, roundIndex });
  const momentum = tournamentMomentum(tournament);
  const clutch = clutchOnHardest(tournament, { topN: 3 });
  const consistency = playerConsistency(tournament);
  const dna = courseDNA(tournament);
  const skins = skinsLeaderboard(tournament, { metric });
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

  const openMomentum = (row) => setSheet({
    title: `${row.player.name} — momentum`,
    subtitle: `Points by round`,
    explainer: 'Stableford points each round, to see trajectory across the weekend.',
    rows: row.rounds.filter(r => r.points != null).map(r => ({
      key: `r${r.roundIndex}`,
      primary: `R${r.roundIndex + 1} · ${r.courseName}`,
      secondary: `${r.strokes} strokes over ${r.holesPlayed} holes`,
      rightPrimary: `${r.points} pts`,
      tone: toneForPoints(Math.round(r.points / Math.max(r.holesPlayed, 1))),
    })),
  });

  const openClutch = (row) => setSheet({
    title: `${row.player.name} — SI top-3 holes`,
    subtitle: `${row.avgPoints} avg pts · ${row.holesPlayed} hardest holes`,
    explainer: 'Performance on the three lowest-stroke-index (hardest) holes of each round.',
    rows: row.breakdown.map((b, i) => holeRowFromBreakdown(b, i)),
  });

  const openConsistency = (row) => setSheet({
    title: `${row.player.name} — consistency`,
    subtitle: `σ ${row.stdev} · mean ${row.mean} pts/hole`,
    explainer: 'Standard deviation of Stableford points across every hole played. Lower numbers mean fewer big swings.',
    rows: [],
  });

  const openSkins = (player) => {
    const rec = skins.leaderboard.find(r => r.player.id === player.id);
    if (!rec) return;
    setSheet({
      title: `${player.name} — ${rec.skins} skin${rec.skins === 1 ? '' : 's'}`,
      subtitle: `${rec.ties} tied holes · ${skins.totalSkins} total skins awarded`,
      explainer:
        (isStrokes
          ? 'A skin on a hole goes to the player with the strictly lowest strokes. Ties on a hole = no skin awarded (no carry-over).'
          : 'A skin on a hole goes to the player with the strictly highest Stableford points. Ties on a hole = no skin awarded (no carry-over).'),
      rows: rec.breakdown.map(b => ({
        key: `${b.roundIndex}-${b.holeNumber}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
        secondary: `Par ${b.par} · SI ${b.si}`,
        rightPrimary: isStrokes ? `${b.bestVal} str` : `${b.bestVal} pts`,
        tone: 'excellent',
      })),
    });
  };

  const openDna = (row) => setSheet({
    title: `${row.player.name} — Course DNA`,
    subtitle: 'Avg pts per hole by course',
    explainer: 'Average Stableford points on each course. Surfaces which tracks suit the player.',
    rows: row.courses.map(c => ({
      key: c.courseName,
      primary: c.courseName,
      secondary: `${c.rounds} round${c.rounds === 1 ? '' : 's'} · ${c.holesPlayed} holes`,
      rightPrimary: `${c.avgPoints} pts/hole`,
      rightSecondary: `${c.roundPoints} pts/round`,
      tone: c.avgPoints >= 2 ? 'good' : c.avgPoints >= 1.5 ? 'neutral' : 'poor',
    })),
  });

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

      {roundIndex === null && momentum.some(m => m.rounds.some(r => r.points != null)) && (
        <>
          <Text style={s.sectionTitle}>TOURNAMENT MOMENTUM</Text>
          <View style={s.card}>
            {momentum.map(row => (
              <TouchableOpacity
                key={row.player.id}
                style={s.momentumRow}
                onPress={() => openMomentum(row)}
                activeOpacity={0.7}
              >
                <Text style={s.momentumName}>{firstName(row.player)}</Text>
                <View style={s.momentumBars}>
                  {row.rounds.map(r => {
                    const played = r.points != null;
                    const range = Math.max(row.maxPts - row.minPts, 1);
                    const pct = played ? Math.max(0.12, (r.points - row.minPts + 2) / (range + 4)) : 0;
                    return (
                      <View key={r.roundIndex} style={s.momentumBarWrap}>
                        <View
                          style={[
                            s.momentumBar,
                            {
                              height: 32 * pct,
                              backgroundColor: played ? theme.scoreColor(
                                r.points >= 32 ? 'excellent' : r.points >= 28 ? 'good' : r.points >= 22 ? 'neutral' : 'poor'
                              ) : theme.border.default,
                            },
                          ]}
                        />
                        <Text style={s.momentumBarLabel}>{played ? r.points : '—'}</Text>
                      </View>
                    );
                  })}
                </View>
              </TouchableOpacity>
            ))}
            <View style={s.momentumLegend}>
              {momentum[0]?.rounds.map(r => (
                <Text key={r.roundIndex} style={s.momentumLegendLabel}>R{r.roundIndex + 1}</Text>
              ))}
            </View>
          </View>
        </>
      )}

      {roundIndex === null && skins.totalSkins > 0 && (
        <>
          <Text style={s.sectionTitle}>SKINS LEADERBOARD</Text>
          <Text style={s.scopeText}>
            Outright winner of each hole ({isStrokes ? 'fewer strokes' : 'more points'}) takes 1 skin · ties = no skin
          </Text>
          <View style={s.card}>
            {skins.leaderboard.map((rec, i) => (
              <TouchableOpacity
                key={rec.player.id}
                style={s.leaderRow}
                onPress={() => openSkins(rec.player)}
                activeOpacity={0.7}
                disabled={rec.skins === 0}
              >
                <Text style={[s.leaderRank, { color: i === 0 && rec.skins > 0 ? theme.semantic.rank.gold : theme.text.muted }]}>#{i + 1}</Text>
                <Text style={s.leaderName}>{firstName(rec.player)}</Text>
                <Text style={s.leaderValue}>
                  {rec.skins} <Text style={s.leaderUnit}>{rec.skins === 1 ? 'skin' : 'skins'}</Text>
                </Text>
              </TouchableOpacity>
            ))}
            <Text style={s.skinsFooter}>
              {skins.rounds.map(r => `R${r.roundIndex + 1}: ${Object.values(r.skinsPerPlayer).reduce((a, b) => a + b, 0)}`).join(' · ')} skins · {skins.totalSkins} total
            </Text>
          </View>
        </>
      )}

      {roundIndex === null && clutch.length > 0 && (
        <>
          <Text style={s.sectionTitle}>CLUTCH ON HARDEST HOLES</Text>
          <Text style={s.scopeText}>Avg points on the 3 lowest-SI holes of each round</Text>
          <View style={s.card}>
            {clutch.map((row, i) => (
              <TouchableOpacity key={row.player.id} style={s.leaderRow} onPress={() => openClutch(row)} activeOpacity={0.7}>
                <Text style={[s.leaderRank, { color: i === 0 ? theme.semantic.rank.gold : theme.text.muted }]}>#{i + 1}</Text>
                <Text style={s.leaderName}>{firstName(row.player)}</Text>
                <Text style={s.leaderValue}>{row.avgPoints} <Text style={s.leaderUnit}>pts/hole</Text></Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {roundIndex === null && consistency.length > 0 && (
        <>
          <Text style={s.sectionTitle}>CONSISTENCY INDEX</Text>
          <Text style={s.scopeText}>Stdev of pts per hole — lower is steadier</Text>
          <View style={s.card}>
            {consistency.map((row, i) => (
              <TouchableOpacity key={row.player.id} style={s.leaderRow} onPress={() => openConsistency(row)} activeOpacity={0.7}>
                <Text style={[s.leaderRank, { color: i === 0 ? theme.semantic.rank.gold : theme.text.muted }]}>#{i + 1}</Text>
                <Text style={s.leaderName}>{firstName(row.player)}</Text>
                <Text style={s.leaderValue}>σ {row.stdev} <Text style={s.leaderUnit}>μ {row.mean}</Text></Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {roundIndex === null && dna.length > 0 && dna[0].courses.length > 0 && (
        <>
          <Text style={s.sectionTitle}>COURSE DNA</Text>
          <Text style={s.scopeText}>Avg pts/hole per course · tap a player</Text>
          {dna.map(row => {
            if (row.courses.length === 0) return null;
            const top = row.courses[0];
            return (
              <TouchableOpacity
                key={row.player.id}
                style={s.dnaCard}
                onPress={() => openDna(row)}
                activeOpacity={0.7}
              >
                <Text style={s.dnaName}>{firstName(row.player)}</Text>
                <View style={s.dnaChips}>
                  {row.courses.map(c => (
                    <View key={c.courseName} style={[s.dnaChip, { backgroundColor: theme.scoreColor(c.avgPoints >= 2 ? 'good' : c.avgPoints >= 1.5 ? 'neutral' : 'poor') + '22' }]}>
                      <Text style={[s.dnaChipCourse, { color: theme.scoreColor(c.avgPoints >= 2 ? 'good' : c.avgPoints >= 1.5 ? 'neutral' : 'poor') }]}>{c.courseName}</Text>
                      <Text style={[s.dnaChipValue, { color: theme.scoreColor(c.avgPoints >= 2 ? 'good' : c.avgPoints >= 1.5 ? 'neutral' : 'poor') }]}>{c.avgPoints}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
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
  const parSplit = parTypeSplit(tournament, player.id);
  const wc = warmupVsClosing(tournament, player.id);
  const roi = handicapROI(tournament, player.id);
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

  const openWarmupClosing = () => setSheet({
    title: `${player.name} — warm-up vs closing`,
    subtitle: `${wc.warmup.avgPoints} pts on H1-3 · ${wc.closing.avgPoints} pts on closing 3`,
    explainer: 'Average Stableford points on the opening 3 holes compared with the closing 3 holes across every round. Surfaces nerves on tee one or fatigue at the finish.',
    rows: [
      { key: 'sec-w', section: true, label: 'Warm-up (H1-3)' },
      ...wc.warmup.breakdown.map((b, i) => ({
        key: `w-${i}`,
        primary: `${b.courseName} · H${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} strokes`,
        rightPrimary: `${b.points} pts`,
        tone: toneForPoints(b.points),
      })),
      { key: 'sec-c', section: true, label: 'Closing (H16-18)' },
      ...wc.closing.breakdown.map((b, i) => ({
        key: `c-${i}`,
        primary: `${b.courseName} · H${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} strokes`,
        rightPrimary: `${b.points} pts`,
        tone: toneForPoints(b.points),
      })),
    ],
  });

  const openROI = () => roi && setSheet({
    title: `${player.name} — handicap ROI`,
    subtitle: `${roi.actual} actual / ${roi.expected} expected`,
    explainer: 'Ratio of actual Stableford points to the 2 pts/hole baseline a player whose handicap exactly matches their level would score. Above 1.00 means they are outplaying their handicap.',
    rows: [],
  });

  const openParSplit = (label, bucket) => bucket.holes > 0 && setSheet({
    title: `${player.name} — ${label}`,
    subtitle: `${bucket.avgPoints} avg pts · ${bucket.avgStrokes} avg str · ${bucket.holes} holes`,
    explainer: `Aggregated performance across every ${label} hole played in this tournament.`,
    rows: [],
  });

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

          <Text style={s.sectionTitle}>PAR-TYPE SPLIT</Text>
          <View style={s.card}>
            <View style={s.parSplitRow}>
              {[
                { key: 'par3', label: 'Par 3', bucket: parSplit.par3 },
                { key: 'par4', label: 'Par 4', bucket: parSplit.par4 },
                { key: 'par5', label: 'Par 5', bucket: parSplit.par5 },
              ].map(({ key, label, bucket }) => (
                <TouchableOpacity
                  key={key}
                  style={s.parSplitCell}
                  onPress={() => openParSplit(label, bucket)}
                  activeOpacity={0.7}
                  disabled={bucket.holes === 0}
                >
                  <Text style={s.parSplitLabel}>{label}</Text>
                  <Text style={[s.parSplitValue, {
                    color: bucket.holes === 0
                      ? theme.text.muted
                      : theme.scoreColor(bucket.avgPoints >= 2 ? 'good' : bucket.avgPoints >= 1.5 ? 'neutral' : 'poor'),
                  }]}>
                    {bucket.holes === 0 ? '—' : bucket.avgPoints}
                  </Text>
                  <Text style={s.parSplitSub}>{bucket.holes} holes</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {(wc.warmup.holes > 0 || wc.closing.holes > 0) && (
            <>
              <Text style={s.sectionTitle}>WARM-UP vs CLOSING</Text>
              <TouchableOpacity style={s.card} onPress={openWarmupClosing} activeOpacity={0.7}>
                <View style={s.wcRow}>
                  <View style={s.wcCol}>
                    <Text style={s.wcLabel}>Warm-up (H1-3)</Text>
                    <Text style={[s.wcValue, { color: theme.scoreColor(wc.warmup.avgPoints >= 2 ? 'good' : 'neutral') }]}>{wc.warmup.avgPoints}</Text>
                    <Text style={s.wcSub}>{wc.warmup.holes} holes</Text>
                  </View>
                  <View style={s.wcCol}>
                    <Text style={s.wcLabel}>Closing (H16-18)</Text>
                    <Text style={[s.wcValue, { color: theme.scoreColor(wc.closing.avgPoints >= 2 ? 'good' : 'neutral') }]}>{wc.closing.avgPoints}</Text>
                    <Text style={s.wcSub}>{wc.closing.holes} holes</Text>
                  </View>
                  <View style={s.wcCol}>
                    <Text style={s.wcLabel}>Δ</Text>
                    <Text style={[s.wcValue, {
                      color: wc.delta > 0 ? theme.scoreColor('excellent') : wc.delta < 0 ? theme.scoreColor('poor') : theme.text.primary,
                    }]}>
                      {wc.delta > 0 ? '+' : ''}{wc.delta}
                    </Text>
                    <Text style={s.wcSub}>close − warm</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </>
          )}

          {roi && (
            <>
              <Text style={s.sectionTitle}>HANDICAP ROI</Text>
              <TouchableOpacity style={s.card} onPress={openROI} activeOpacity={0.7}>
                <View style={s.roiRow}>
                  <View style={s.roiCol}>
                    <Text style={s.roiLabel}>Actual</Text>
                    <Text style={s.roiValue}>{roi.actual}</Text>
                  </View>
                  <View style={s.roiCol}>
                    <Text style={s.roiLabel}>Expected</Text>
                    <Text style={s.roiValue}>{roi.expected}</Text>
                  </View>
                  <View style={s.roiCol}>
                    <Text style={s.roiLabel}>Ratio</Text>
                    <Text style={[s.roiValue, {
                      color: roi.ratio >= 1 ? theme.scoreColor('excellent') : roi.ratio >= 0.75 ? theme.scoreColor('neutral') : theme.scoreColor('poor'),
                    }]}>{roi.ratio}</Text>
                  </View>
                </View>
                <Text style={s.roiSub}>Baseline: 2 pts/hole (a handicap that matches the player's level)</Text>
              </TouchableOpacity>
            </>
          )}

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
  const nemesisCrushed = playerNemesisAndCrushed(tournament);
  const chaos = chaosHoles(tournament);
  const extremes = collectiveExtremes(tournament);
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

  const openNemesis = (row) => setSheet({
    title: `${row.player.name} — Nemesis hole`,
    subtitle: `R${row.nemesis.roundIndex + 1} · ${row.nemesis.courseName} · Hole ${row.nemesis.holeNumber}`,
    explainer: 'Single worst hole for this player in the tournament, by Stableford points (ties broken by strokes over par).',
    rows: [{
      key: 'n', primary: `Par ${row.nemesis.par} · SI ${row.nemesis.si}`,
      secondary: `${row.nemesis.strokes} strokes (+${row.nemesis.vsPar} vs par)`,
      rightPrimary: `${row.nemesis.points} pts`, tone: 'poor',
    }],
  });

  const openCrushed = (row) => setSheet({
    title: `${row.player.name} — Crushed it`,
    subtitle: `R${row.crushed.roundIndex + 1} · ${row.crushed.courseName} · Hole ${row.crushed.holeNumber}`,
    explainer: 'Single best hole for this player in the tournament, by Stableford points (ties broken by strokes below par).',
    rows: [{
      key: 'c', primary: `Par ${row.crushed.par} · SI ${row.crushed.si}`,
      secondary: `${row.crushed.strokes} strokes (${row.crushed.vsPar >= 0 ? '+' : ''}${row.crushed.vsPar} vs par)`,
      rightPrimary: `${row.crushed.points} pts`, tone: 'excellent',
    }],
  });

  const openChaos = (hole) => setSheet({
    title: `Chaos · Hole ${hole.holeNumber}`,
    subtitle: `R${hole.roundIndex + 1} · ${hole.courseName} · Par ${hole.par} · SI ${hole.si}`,
    explainer: `Range of ${hole.range} strokes (${hole.minStrokes} → ${hole.maxStrokes}) across the group — the biggest split the group produced on a single hole.`,
    rows: hole.scores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: `${ps.strokes} strokes`,
      rightPrimary: `${ps.points} pts`,
      tone: toneForPoints(ps.points),
    })),
  });

  const openCollective = (hole, kind) => setSheet({
    title: `${kind === 'disaster' ? 'Collective disaster' : 'Everybody easy'} · Hole ${hole.holeNumber}`,
    subtitle: `R${hole.roundIndex + 1} · ${hole.courseName} · Par ${hole.par} · SI ${hole.si}`,
    explainer: kind === 'disaster'
      ? 'Hole where every player in the field scored 0 Stableford points.'
      : 'Hole where every player in the field netted at least 2 Stableford points (par-or-better net).',
    rows: hole.scores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: `${ps.strokes} strokes`,
      rightPrimary: `${ps.points} pts`,
      tone: ps.points === 0 ? 'poor' : toneForPoints(ps.points),
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

      {nemesisCrushed.length > 0 && (
        <>
          <Text style={s.sectionTitle}>NEMESIS & CRUSHED</Text>
          <Text style={s.scopeText}>Each player's single worst and best hole</Text>
          {nemesisCrushed.map(row => (
            <View key={row.player.id} style={s.ncRow}>
              <Text style={s.ncName}>{firstName(row.player)}</Text>
              <TouchableOpacity style={s.ncCell} onPress={() => openNemesis(row)} activeOpacity={0.7}>
                <Text style={[s.ncLabel, { color: theme.scoreColor('poor') }]}>Nemesis</Text>
                <Text style={s.ncValue}>H{row.nemesis.holeNumber} · {row.nemesis.points} pts</Text>
                <Text style={s.ncSub}>{row.nemesis.courseName}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ncCell} onPress={() => openCrushed(row)} activeOpacity={0.7}>
                <Text style={[s.ncLabel, { color: theme.scoreColor('excellent') }]}>Crushed</Text>
                <Text style={s.ncValue}>H{row.crushed.holeNumber} · {row.crushed.points} pts</Text>
                <Text style={s.ncSub}>{row.crushed.courseName}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {chaos.length > 0 && (
        <>
          <Text style={s.sectionTitle}>CHAOS HOLES</Text>
          <Text style={s.scopeText}>Where the group diverged most in strokes</Text>
          {chaos.map((hole, i) => (
            <TouchableOpacity key={`c${i}`} style={s.holeCard} onPress={() => openChaos(hole)} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('neutral') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('neutral') }]}>Δ{hole.range}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>R{hole.roundIndex + 1} · Hole {hole.holeNumber} · Par {hole.par} · SI {hole.si}</Text>
                <Text style={s.holeCourse}>{hole.courseName} · {hole.minStrokes} → {hole.maxStrokes} strokes</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {(extremes.disasters.length > 0 || extremes.gimmes.length > 0) && (
        <>
          <Text style={s.sectionTitle}>COLLECTIVE EXTREMES</Text>
          {extremes.disasters.length > 0 && (
            <>
              <Text style={s.scopeText}>Everybody scored 0 pts</Text>
              {extremes.disasters.map((hole, i) => (
                <TouchableOpacity key={`d${i}`} style={s.holeCard} onPress={() => openCollective(hole, 'disaster')} activeOpacity={0.7}>
                  <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                    <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>🫠</Text>
                  </View>
                  <View style={s.holeInfo}>
                    <Text style={s.holeName}>R{hole.roundIndex + 1} · Hole {hole.holeNumber} · Par {hole.par} · SI {hole.si}</Text>
                    <Text style={s.holeCourse}>{hole.courseName}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
          {extremes.gimmes.length > 0 && (
            <>
              <Text style={s.scopeText}>Everybody cruised (≥2 pts each)</Text>
              {extremes.gimmes.map((hole, i) => (
                <TouchableOpacity key={`g${i}`} style={s.holeCard} onPress={() => openCollective(hole, 'gimme')} activeOpacity={0.7}>
                  <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                    <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>🧁</Text>
                  </View>
                  <View style={s.holeInfo}>
                    <Text style={s.holeName}>R{hole.roundIndex + 1} · Hole {hole.holeNumber} · Par {hole.par} · SI {hole.si}</Text>
                    <Text style={s.holeCourse}>{hole.courseName}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
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
  const splitsPlayer = players[selectedPlayer] ?? null;
  const splits = splitsPlayer
    ? playerPartnerSplits(tournament, splitsPlayer.id)
    : { baseline: 0, partners: [] };
  const [hwRound, setHwRound] = useState(null);
  const holeWins = pairHoleWins(tournament, { metric, roundIndex: hwRound });
  const firstCompletedRound = tournament.rounds.findIndex(r => r.scores && Object.keys(r.scores).length > 0);
  const [pdRound, setPdRound] = useState(firstCompletedRound >= 0 ? firstCompletedRound : null);
  const pdData = pdRound != null ? pairDifferenceByHole(tournament, pdRound, { metric }) : null;
  const synergy = pairSynergy(tournament);
  const carry = pairCarryRatio(tournament);
  const swing = pdRound != null ? swingHole(tournament, pdRound) : null;
  const matchPlay = matchPlayResults(tournament, { metric });
  const configMatrix = pairConfigMatrix(tournament);
  const [h2hRound, setH2hRound] = useState(null);
  const p1 = players[selectedPlayer];
  const p2Idx = h2hPlayer >= players.length ? 0 : h2hPlayer;
  const p2 = players[p2Idx];
  const h2h = p1 && p2 && p1.id !== p2.id ? headToHead(tournament, p1.id, p2.id, { roundIndex: h2hRound }) : null;

  // H2H heatmap matrix — for each (row=i, col=j) cell, the net holes won
  // by player i against player j in the active metric (points or strokes).
  // Diagonal entries are null (no self-comparison). The values are
  // antisymmetric (matrix[i][j] === -matrix[j][i]).
  const h2hMatrix = useMemo(() => {
    if (!players || players.length < 2) return [];
    return players.map((rowPlayer, i) => players.map((colPlayer, j) => {
      if (i === j) return null;
      const result = headToHead(tournament, rowPlayer.id, colPlayer.id);
      const bucket = metric === 'strokes' ? result.strokes : result.points;
      const totalHoles = bucket.p1Wins + bucket.p2Wins + bucket.ties;
      if (totalHoles === 0) return null;
      return { net: bucket.p1Wins - bucket.p2Wins, wins: bucket.p1Wins, losses: bucket.p2Wins, ties: bucket.ties };
    }));
  }, [tournament, players, metric]);

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

  const openSynergy = (pair) => setSheet({
    title: `${pair.members[0].name} & ${pair.members[1].name} — synergy`,
    subtitle: `${pair.synergy}× baseline · ${pair.rounds} round${pair.rounds === 1 ? '' : 's'}`,
    explainer: `Actual combined Stableford (${pair.combined}) over expected-from-each-members-average (${pair.expected}). 1.00 = as expected, above = lift each other, below = drag each other.`,
    rows: [],
  });

  const openCarry = (pair) => setSheet({
    title: `${pair.members[0].name} & ${pair.members[1].name} — carry split`,
    subtitle: `${pair.totalPoints} combined pts`,
    explainer: 'Share of the pair\'s total points contributed by each member across every round they played together.',
    rows: pair.shares.map(sh => ({
      key: sh.player.id,
      primary: sh.player.name,
      secondary: `${sh.points} pts`,
      rightPrimary: `${Math.round(sh.share * 100)}%`,
      tone: sh.share >= 0.55 ? 'excellent' : sh.share >= 0.45 ? 'good' : 'poor',
    })),
  });

  const openMatchPlay = (round) => {
    if (!round.available) return;
    const p1Label = round.pair1.map(p => firstName(p)).join(' & ');
    const p2Label = round.pair2.map(p => firstName(p)).join(' & ');
    const winner = round.winnerPair ? round.winnerPair.map(p => firstName(p)).join(' & ') : 'Halved';
    setSheet({
      title: `R${round.roundIndex + 1} · ${p1Label} vs ${p2Label}`,
      subtitle: `${round.scoreline} · Winner: ${winner}`,
      explainer: (metric === 'strokes'
        ? 'Match play scoring: each hole the pair with the lower combined strokes wins a hole. "3&2" means 3 holes up with 2 to play — the match closes early.'
        : 'Match play scoring: each hole the pair with the higher combined Stableford points wins a hole. "3&2" means 3 holes up with 2 to play — the match closes early.')
        + (round.closedAt ? ` Closed at hole ${round.closedAt}.` : ''),
      rows: round.holes.map((h, i) => ({
        key: `${i}`,
        primary: `Hole ${h.holeNumber}`,
        secondary: `${p1Label} ${h.pair1Score ?? '—'} · ${p2Label} ${h.pair2Score ?? '—'}`,
        rightPrimary: h.winner === 'pair1' ? p1Label : h.winner === 'pair2' ? p2Label : h.winner == null ? '—' : 'halve',
        rightSecondary: `${h.pair1UpAfter > 0 ? p1Label + ' +' + h.pair1UpAfter : h.pair1UpAfter < 0 ? p2Label + ' +' + Math.abs(h.pair1UpAfter) : 'AS'}`,
        tone: h.winner === 'pair1' ? 'excellent' : h.winner === 'pair2' ? 'good' : 'neutral',
      })),
    });
  };

  const openConfig = (cfg) => {
    const sideALabel = cfg.sideA.map(p => firstName(p)).join(' & ');
    const sideBLabel = cfg.sideB.map(p => firstName(p)).join(' & ');
    setSheet({
      title: `${sideALabel} vs ${sideBLabel}`,
      subtitle: `${cfg.holeWins.A}·${cfg.holeWins.T}·${cfg.holeWins.B} holes · ${cfg.pointsA}/${cfg.pointsB} pts`,
      explainer: 'Per-hole W/T/L between this specific 2-vs-2 configuration across every round they played together. Pair points = sum of both partners\' Stableford points on the hole.',
      rows: cfg.rounds.map(r => ({
        key: `r${r.roundIndex}`,
        primary: `R${r.roundIndex + 1} · ${r.courseName}`,
        secondary: `${r.wins.A}·${r.wins.T}·${r.wins.B} holes`,
        rightPrimary: `${r.points.A} / ${r.points.B}`,
        tone: r.points.A > r.points.B ? 'excellent' : r.points.A < r.points.B ? 'poor' : 'neutral',
      })),
    });
  };

  const openSwing = () => swing && setSheet({
    title: `Swing Hole · H${swing.holeNumber}`,
    subtitle: `${swing.courseName} · Par ${swing.par}`,
    explainer: `The hole with the biggest one-hole swing in this round's cumulative pair-vs-pair gap. Outcome: ${swing.holeDelta > 0 ? swing.pair1.map(p=>firstName(p)).join('+') : swing.pair2.map(p=>firstName(p)).join('+')} +${Math.abs(swing.holeDelta)} pts on this hole alone.`,
    rows: [
      { key: 'p1', primary: swing.pair1.map(p => p.name).join(' & '), secondary: `Combined ${swing.pair1Total} pts`, rightPrimary: swing.holeDelta > 0 ? 'Swing +' : swing.holeDelta < 0 ? '—' : 'Even', tone: swing.holeDelta > 0 ? 'excellent' : 'neutral' },
      { key: 'p2', primary: swing.pair2.map(p => p.name).join(' & '), secondary: `Combined ${swing.pair2Total} pts`, rightPrimary: swing.holeDelta < 0 ? 'Swing +' : swing.holeDelta > 0 ? '—' : 'Even', tone: swing.holeDelta < 0 ? 'excellent' : 'neutral' },
    ],
  });

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

      {splitsPlayer && (
        <>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>PARTNER SPLITS · {firstName(splitsPlayer)}</Text>
            <Text style={s.scopeText}>baseline {splits.baseline} pts</Text>
          </View>
          <View style={s.splitsChipRow}>
            {players.map((p, i) => (
              <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
                <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {splits.partners.length === 0 ? (
            <Text style={s.emptyText}>No completed rounds with partners for {firstName(splitsPlayer)} yet.</Text>
          ) : (
            <View style={s.splitsTable}>
              <View style={s.splitsHeader}>
                <Text style={[s.splitsHeaderText, { flex: 1 }]}>Partner</Text>
                <Text style={[s.splitsHeaderText, { width: 36, textAlign: 'right' }]}>R</Text>
                <Text style={[s.splitsHeaderText, { width: 64, textAlign: 'right' }]}>Avg</Text>
                <Text style={[s.splitsHeaderText, { width: 56, textAlign: 'right' }]}>Δ vs base</Text>
              </View>
              {splits.partners.map((row) => {
                const tone = row.delta >= 2 ? 'excellent' : row.delta <= -2 ? 'poor' : 'neutral';
                const deltaColor = tone === 'excellent' ? theme.scoreColor('excellent')
                  : tone === 'poor' ? theme.scoreColor('poor')
                  : theme.text.muted;
                return (
                  <TouchableOpacity
                    key={row.partner.id}
                    style={s.splitsRow}
                    activeOpacity={0.7}
                    onPress={() => setSheet({
                      title: `${splitsPlayer.name} with ${row.partner.name}`,
                      subtitle: `${row.avgPlayerPoints} avg · ${row.rounds} round${row.rounds === 1 ? '' : 's'} · baseline ${splits.baseline}`,
                      explainer: `Average individual Stableford points scored by ${splitsPlayer.name} when partnered with ${row.partner.name}, vs their overall ${splits.baseline} pts/round baseline. Delta is signed; positive means ${firstName(splitsPlayer)} overperforms when paired with ${firstName(row.partner)}.`,
                      rows: row.perRoundPoints.map((pts, i) => ({
                        key: `${row.partner.id}-${i}`,
                        primary: `R${row.roundIndices[i] + 1}`,
                        rightPrimary: `${pts} pts`,
                      })),
                    })}
                  >
                    <Text style={[s.splitsCell, { flex: 1, color: theme.text.primary, fontFamily: 'PlusJakartaSans-Medium' }]}>{row.partner.name}</Text>
                    <Text style={[s.splitsCell, { width: 36, textAlign: 'right', color: theme.text.muted }]}>{row.rounds}</Text>
                    <Text style={[s.splitsCell, { width: 64, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary }]}>{row.avgPlayerPoints}</Text>
                    <Text style={[s.splitsCell, { width: 56, textAlign: 'right', fontFamily: 'PlusJakartaSans-ExtraBold', color: deltaColor }]}>
                      {row.delta >= 0 ? '+' : ''}{row.delta}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
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
          {swing && (
            <TouchableOpacity style={s.swingCard} onPress={openSwing} activeOpacity={0.7}>
              <View>
                <Text style={s.swingLabel}>SWING HOLE</Text>
                <Text style={s.swingValue}>
                  Hole {swing.holeNumber} · {swing.holeDelta > 0 ? firstName(swing.pair1[0]) + '+' + firstName(swing.pair1[1]) : swing.holeDelta < 0 ? firstName(swing.pair2[0]) + '+' + firstName(swing.pair2[1]) : 'Even'} {swing.holeDelta !== 0 ? `+${Math.abs(swing.holeDelta)} pts` : ''}
                </Text>
                <Text style={s.swingSub}>Par {swing.par} · cum. after: {swing.cumulativeAfter > 0 ? '+' : ''}{swing.cumulativeAfter} pts</Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
        </>
      )}

      {synergy.length > 0 && (
        <>
          <Text style={s.sectionTitle}>PAIR SYNERGY</Text>
          <Text style={s.scopeText}>Combined pts vs expected from each partner's average</Text>
          {synergy.map((pair, i) => (
            <TouchableOpacity key={i} style={s.pairCard} onPress={() => openSynergy(pair)} activeOpacity={0.7}>
              <View style={s.pairNames}>
                <Text style={s.pairName}>{pair.members[0].name}</Text>
                <Text style={s.pairAmp}>&</Text>
                <Text style={s.pairName}>{pair.members[1].name}</Text>
              </View>
              <View style={s.pairStats}>
                <Text style={[s.pairAvg, {
                  color: pair.synergy >= 1.05 ? theme.scoreColor('excellent')
                    : pair.synergy >= 0.95 ? theme.scoreColor('good')
                    : theme.scoreColor('poor'),
                }]}>×{pair.synergy}</Text>
                <Text style={s.pairRounds}>{pair.combined} / {pair.expected} pts</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {carry.length > 0 && (
        <>
          <Text style={s.sectionTitle}>CARRY RATIO</Text>
          <Text style={s.scopeText}>Who contributed more inside the pair</Text>
          {carry.map((pair, i) => (
            <TouchableOpacity key={i} style={s.carryCard} onPress={() => openCarry(pair)} activeOpacity={0.7}>
              <View style={s.carryBar}>
                <View style={[s.carryFill, {
                  width: `${Math.round(pair.shares[0].share * 100)}%`,
                  backgroundColor: theme.pairA,
                }]} />
                <View style={[s.carryFill, {
                  width: `${Math.round(pair.shares[1].share * 100)}%`,
                  backgroundColor: theme.pairB,
                }]} />
              </View>
              <View style={s.carryLabels}>
                <Text style={s.carryName}>{firstName(pair.shares[0].player)} {Math.round(pair.shares[0].share * 100)}%</Text>
                <Text style={s.carryName}>{Math.round(pair.shares[1].share * 100)}% {firstName(pair.shares[1].player)}</Text>
              </View>
              <Text style={s.carryMeta}>{pair.totalPoints} combined pts · imbalance {pair.imbalance}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {matchPlay.some(r => r.available) && (
        <>
          <Text style={s.sectionTitle}>MATCH PLAY</Text>
          <Text style={s.scopeText}>Per round, hole-by-hole up/down — closes when lead > holes remaining</Text>
          {matchPlay.filter(r => r.available).map(round => {
            const p1Label = round.pair1.map(p => firstName(p)).join(' + ');
            const p2Label = round.pair2.map(p => firstName(p)).join(' + ');
            const isTie = round.finalPair1Up === 0;
            const p1Won = round.finalPair1Up > 0;
            return (
              <TouchableOpacity key={round.roundIndex} style={s.matchCard} onPress={() => openMatchPlay(round)} activeOpacity={0.7}>
                <View style={s.matchHeader}>
                  <Text style={s.matchRound}>R{round.roundIndex + 1}</Text>
                  <Text style={s.matchCourse}>{round.courseName}</Text>
                  <Text style={[s.matchScoreline, {
                    color: isTie ? theme.text.muted : theme.scoreColor('excellent'),
                  }]}>{round.scoreline}</Text>
                </View>
                <View style={s.matchTeams}>
                  <Text style={[s.matchTeam, {
                    color: p1Won ? theme.scoreColor('excellent') : isTie ? theme.text.primary : theme.text.muted,
                    fontFamily: p1Won ? 'PlusJakartaSans-ExtraBold' : 'PlusJakartaSans-SemiBold',
                  }]}>{p1Label}</Text>
                  <Text style={s.matchVs}>vs</Text>
                  <Text style={[s.matchTeam, {
                    color: !p1Won && !isTie ? theme.scoreColor('excellent') : isTie ? theme.text.primary : theme.text.muted,
                    fontFamily: !p1Won && !isTie ? 'PlusJakartaSans-ExtraBold' : 'PlusJakartaSans-SemiBold',
                  }]}>{p2Label}</Text>
                </View>
                {round.closedAt && (
                  <Text style={s.matchSub}>Closed at hole {round.closedAt}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {configMatrix.length > 0 && (
        <>
          <Text style={s.sectionTitle}>PAIR CONFIG MATRIX</Text>
          <Text style={s.scopeText}>The 2-vs-2 combinations that actually played · W·T·L by holes won</Text>
          {configMatrix.map((cfg, i) => {
            const aWon = cfg.holeWins.A > cfg.holeWins.B;
            const bWon = cfg.holeWins.B > cfg.holeWins.A;
            return (
              <TouchableOpacity key={i} style={s.configCard} onPress={() => openConfig(cfg)} activeOpacity={0.7}>
                <View style={s.configRow}>
                  <Text style={[s.configSide, {
                    color: aWon ? theme.scoreColor('excellent') : bWon ? theme.text.muted : theme.text.primary,
                  }]}>
                    {cfg.sideA.map(p => firstName(p)).join(' + ')}
                  </Text>
                  <View style={s.configWTL}>
                    <Text style={s.configScore}>{cfg.holeWins.A}</Text>
                    <Text style={s.configSep}>·</Text>
                    <Text style={s.configScoreT}>{cfg.holeWins.T}</Text>
                    <Text style={s.configSep}>·</Text>
                    <Text style={s.configScore}>{cfg.holeWins.B}</Text>
                  </View>
                  <Text style={[s.configSide, { textAlign: 'right',
                    color: bWon ? theme.scoreColor('excellent') : aWon ? theme.text.muted : theme.text.primary,
                  }]}>
                    {cfg.sideB.map(p => firstName(p)).join(' + ')}
                  </Text>
                </View>
                <Text style={s.configSub}>{cfg.pointsA} / {cfg.pointsB} combined pts · {cfg.rounds.length} round{cfg.rounds.length === 1 ? '' : 's'}</Text>
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {players.length >= 2 && (() => {
        const flat = h2hMatrix.flat().filter((c) => c != null);
        const maxAbs = flat.reduce((m, c) => Math.max(m, Math.abs(c.net)), 0) || 1;
        const cellColor = (net) => {
          if (net === 0) return theme.text.muted;
          return net > 0 ? theme.scoreColor('excellent') : theme.scoreColor('poor');
        };
        const cellBg = (net) => {
          const intensity = Math.min(1, Math.abs(net) / maxAbs);
          const opacity = 0.10 + intensity * 0.30;
          if (net === 0) return theme.bg.secondary;
          const hex = net > 0 ? theme.scoreColor('excellent') : theme.scoreColor('poor');
          return hex + Math.round(opacity * 255).toString(16).padStart(2, '0');
        };
        return (
          <>
            <Text style={s.sectionTitle}>H2H HEATMAP</Text>
            <Text style={s.scopeText}>
              Net holes won across the tournament — row vs column ({metric === 'strokes' ? 'lower strokes wins' : 'higher Stableford wins'}). Tap to load that matchup below.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.h2hMatrixWrap}>
                <View style={s.h2hMatrixRow}>
                  <View style={[s.h2hMatrixCell, s.h2hMatrixCornerCell]} />
                  {players.map((p) => (
                    <View key={p.id} style={[s.h2hMatrixCell, s.h2hMatrixHeaderCell]}>
                      <Text style={s.h2hMatrixHeaderText} numberOfLines={1}>{firstName(p)}</Text>
                    </View>
                  ))}
                </View>
                {players.map((rowPlayer, i) => (
                  <View key={rowPlayer.id} style={s.h2hMatrixRow}>
                    <View style={[s.h2hMatrixCell, s.h2hMatrixRowLabelCell]}>
                      <Text style={s.h2hMatrixHeaderText} numberOfLines={1}>{firstName(rowPlayer)}</Text>
                    </View>
                    {players.map((colPlayer, j) => {
                      const cell = h2hMatrix[i]?.[j];
                      if (i === j) {
                        return (
                          <View key={colPlayer.id} style={[s.h2hMatrixCell, s.h2hMatrixDiagonalCell]}>
                            <Text style={s.h2hMatrixDiagonalText}>—</Text>
                          </View>
                        );
                      }
                      if (cell == null) {
                        return (
                          <View key={colPlayer.id} style={[s.h2hMatrixCell, s.h2hMatrixEmptyCell]}>
                            <Text style={s.h2hMatrixEmptyText}>·</Text>
                          </View>
                        );
                      }
                      const sign = cell.net > 0 ? '+' : '';
                      return (
                        <TouchableOpacity
                          key={colPlayer.id}
                          style={[s.h2hMatrixCell, { backgroundColor: cellBg(cell.net) }]}
                          activeOpacity={0.7}
                          onPress={() => { setSelectedPlayer(i); setH2hPlayer(j); }}
                        >
                          <Text style={[s.h2hMatrixValueText, { color: cellColor(cell.net) }]}>
                            {sign}{cell.net}
                          </Text>
                          <Text style={s.h2hMatrixSubText}>{cell.wins}-{cell.losses}-{cell.ties}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </>
        );
      })()}

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
  const par3 = par3Heartbreak(tournament);
  const pickup = pickupChampion(tournament);
  const anchorStat = anchor(tournament);
  const zero = zeroHero(tournament);
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

  const openPar3 = () => par3 && setSheet({
    title: `${par3.player.name} — Par-3 heartbreak`,
    subtitle: `${par3.avgStrokes} avg str on ${par3.holes} par-3 holes`,
    explainer: 'Highest average strokes on par-3 holes. Par-3s are meant to be the free lunch of a round.',
    rows: par3.breakdown.map((b, i) => ({
      key: `${i}`,
      primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
      secondary: `Par ${b.par} · SI ${b.si}`,
      rightPrimary: `${b.strokes} str · ${b.points} pts`,
      tone: b.points === 0 ? 'poor' : b.points === 1 ? 'neutral' : 'good',
    })),
  });

  const openPickup = () => pickup && setSheet({
    title: `${joinNames(pickup.entries.map(e => e.player))} — ${pickup.value} pickups`,
    subtitle: 'Ball-in-pocket champion',
    explainer: 'Holes where the recorded strokes equal the "pickup" value (par + 2 + extra shots) — i.e. the player bailed out of that hole. Ties listed together.',
    rows: tiedRowsByPlayer(
      pickup.entries,
      (e) => e.breakdown.map((b, i) => ({
        key: `${e.player.id}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hole ${b.holeNumber}`,
        secondary: `Par ${b.par} · SI ${b.si} · ${b.strokes} strokes`,
        rightPrimary: '0 pts',
        tone: 'poor',
      })),
      (e) => `${e.pickups} pickups`,
    ),
  });

  const openAnchor = () => anchorStat && setSheet({
    title: `${joinNames(anchorStat.entries.map(e => e.player))} — the anchor`,
    subtitle: `${anchorStat.value} more PB than MB`,
    explainer: 'Player who was their pair\'s worst ball (PB) far more often than the best ball (MB). Tiebreakers inside the pair: lower handicap → better prior hole → stable id sort.',
    rows: anchorStat.all.filter(a => a.mbCount + a.pbCount > 0).map(a => ({
      key: a.player.id,
      primary: a.player.name,
      secondary: `MB ${a.mbCount} · PB ${a.pbCount}`,
      rightPrimary: `${a.anchorScore >= 0 ? '+' : ''}${a.anchorScore}`,
      tone: a.anchorScore >= 5 ? 'poor' : a.anchorScore > 0 ? 'neutral' : 'good',
    })),
  });

  const openZero = () => zero && setSheet({
    title: `${joinNames([...new Set(zero.entries.map(e => e.player.id))].map(id => zero.entries.find(e => e.player.id === id).player))} — Zero Hero`,
    subtitle: `Rounds with 3+ zero-point holes`,
    explainer: 'Rounds where the player scored zero Stableford points on three or more holes. Tap through the rounds below to see which holes drowned the round.',
    rows: zero.entries.flatMap((e, i) => [
      { key: `sec-${i}`, section: true, label: `${e.player.name} · R${e.roundIndex + 1} · ${e.courseName}`, rightLabel: `${e.count} zero-pt holes` },
      ...e.breakdown.map((b, j) => ({
        key: `${i}-${j}`,
        primary: `Hole ${b.holeNumber}`,
        secondary: `Par ${b.par} · SI ${b.si} · ${b.strokes} strokes`,
        rightPrimary: '0 pts',
        tone: 'poor',
      })),
    ]),
  });

  const any = shame.tripleBogey || shame.bogeyStreak || shame.doubleBogeyStreak || shame.pointlessStreak || shame.gift || shame.collapse || shame.blowup || par3 || pickup || anchorStat || zero;

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
      {par3 && (
        <HighlightCard
          icon="target"
          label="⛳ Par-3 Heartbreak"
          value={`${firstName(par3.player)} — ${par3.avgStrokes} avg str`}
          sub={`${par3.holes} par-3 holes · ${par3.totalPoints} total pts`}
          onPress={openPar3} theme={theme} s={s}
        />
      )}
      {pickup && (
        <HighlightCard
          icon="hand"
          label="🥄 Pickup Champion"
          value={`${joinNames(pickup.entries.map(e => e.player))} — ${pickup.value} pickups`}
          sub={pickup.entries.length === 1 ? 'Ball-in-pocket specialist' : `${pickup.entries.length} tied`}
          onPress={openPickup} theme={theme} s={s}
        />
      )}
      {anchorStat && (
        <HighlightCard
          icon="anchor"
          label="⚓ The Anchor"
          value={`${joinNames(anchorStat.entries.map(e => e.player))} — +${anchorStat.value} PB`}
          sub={'More worst-ball than best-ball across the tournament'}
          onPress={openAnchor} theme={theme} s={s}
        />
      )}
      {zero && (
        <HighlightCard
          icon="slash"
          label="🧟 Zero Hero"
          value={`${zero.entries.length} round${zero.entries.length === 1 ? '' : 's'} with ≥3 zero-pt holes`}
          sub={`Worst: ${zero.value} zero-point holes in one round`}
          onPress={openZero} theme={theme} s={s}
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

  // Tournament momentum
  momentumRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6,
  },
  momentumName: {
    flex: 1.2, fontFamily: 'PlusJakartaSans-SemiBold',
    color: t.text.primary, fontSize: 13,
  },
  momentumBars: {
    flex: 3, flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-around', height: 36,
  },
  momentumBarWrap: { alignItems: 'center', flex: 1 },
  momentumBar: { width: '70%', borderRadius: 3, minHeight: 2 },
  momentumBarLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: t.text.muted, marginTop: 2,
  },
  momentumLegend: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingLeft: '30%', marginTop: 4, paddingTop: 4,
    borderTopWidth: 1, borderTopColor: t.border.subtle,
  },
  momentumLegendLabel: {
    flex: 1, textAlign: 'center',
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9,
    color: t.text.muted, letterSpacing: 1,
  },

  // Leader rows (clutch / consistency)
  leaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  leaderRank: {
    width: 28, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13,
  },
  leaderName: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14,
    color: t.text.primary,
  },
  leaderValue: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: t.text.primary,
  },
  leaderUnit: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: t.text.muted,
  },

  // Course DNA
  dnaCard: {
    backgroundColor: t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.border.default, padding: 12, marginBottom: 8,
    ...(t.isDark ? {} : t.shadow.card),
  },
  dnaName: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: t.text.primary,
    marginBottom: 8,
  },
  dnaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dnaChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  dnaChipCourse: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11 },
  dnaChipValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },

  // Par-type split + warmup-closing + ROI (Players tab)
  parSplitRow: { flexDirection: 'row' },
  parSplitCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  parSplitLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 1,
    color: t.text.muted, textTransform: 'uppercase',
  },
  parSplitValue: {
    fontFamily: 'PlayfairDisplay-Black', fontSize: 26, marginVertical: 2,
  },
  parSplitSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted },
  wcRow: { flexDirection: 'row' },
  wcCol: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  wcLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 1,
    color: t.text.muted, textTransform: 'uppercase',
  },
  wcValue: { fontFamily: 'PlayfairDisplay-Black', fontSize: 24, marginVertical: 2 },
  wcSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted },
  roiRow: { flexDirection: 'row' },
  roiCol: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  roiLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, letterSpacing: 1,
    color: t.text.muted, textTransform: 'uppercase',
  },
  roiValue: { fontFamily: 'PlayfairDisplay-Black', fontSize: 24, color: t.text.primary },
  roiSub: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted,
    textAlign: 'center', marginTop: 6,
  },

  // Nemesis/Crushed (Holes tab)
  ncRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  ncName: {
    flex: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13,
    color: t.text.primary,
  },
  ncCell: { flex: 1.5, alignItems: 'center', paddingHorizontal: 4 },
  ncLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, letterSpacing: 1,
    textTransform: 'uppercase',
  },
  ncValue: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
    color: t.text.primary, marginTop: 2,
  },
  ncSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted },

  // Swing hole card
  swingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.border.default, padding: 14, marginBottom: 12,
    ...(t.isDark ? {} : t.shadow.card),
  },
  swingLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, letterSpacing: 1.2,
    color: t.text.muted, textTransform: 'uppercase',
  },
  swingValue: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: t.text.primary,
    marginTop: 4,
  },
  swingSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: t.text.muted, marginTop: 2 },

  // Carry ratio bar
  carryCard: {
    backgroundColor: t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.border.default, padding: 12, marginBottom: 8,
    ...(t.isDark ? {} : t.shadow.card),
  },
  carryBar: {
    flexDirection: 'row', height: 10, borderRadius: 5,
    backgroundColor: t.bg.secondary, overflow: 'hidden', marginBottom: 6,
  },
  carryFill: { height: '100%' },
  carryLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  carryName: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: t.text.primary },
  carryMeta: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted,
    marginTop: 6, textAlign: 'center',
  },

  // Skins footer
  skinsFooter: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted,
    marginTop: 8, textAlign: 'center',
  },

  // Match Play cards
  matchCard: {
    backgroundColor: t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.border.default, padding: 12, marginBottom: 8,
    ...(t.isDark ? {} : t.shadow.card),
  },
  matchHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 6,
  },
  matchRound: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11,
    color: t.accent.primary, letterSpacing: 1, marginRight: 8,
  },
  matchCourse: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12,
    color: t.text.secondary,
  },
  matchScoreline: {
    fontFamily: 'PlayfairDisplay-Black', fontSize: 16,
  },
  matchTeams: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  matchTeam: {
    flex: 1, fontSize: 13, color: t.text.primary,
  },
  matchVs: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: t.text.muted,
    marginHorizontal: 8,
  },
  matchSub: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted,
    marginTop: 6,
  },

  // Pair Config Matrix
  configCard: {
    backgroundColor: t.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: t.border.default, padding: 12, marginBottom: 8,
    ...(t.isDark ? {} : t.shadow.card),
  },
  configRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  configSide: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
  },
  configWTL: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10,
  },
  configScore: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: t.text.primary,
    minWidth: 22, textAlign: 'center',
  },
  configScoreT: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: t.text.muted,
    minWidth: 18, textAlign: 'center',
  },
  configSep: { color: t.text.muted, fontSize: 14, marginHorizontal: 2 },
  configSub: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: t.text.muted,
    marginTop: 6, textAlign: 'center',
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

  // Partner splits
  splitsChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  splitsTable: {
    backgroundColor: t.isDark ? t.bg.card : t.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12,
    ...(t.isDark ? {} : t.shadow.card),
  },
  splitsHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  splitsHeaderText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 10, letterSpacing: 1,
  },
  splitsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  splitsCell: { fontSize: 13 },

  // H2H heatmap
  h2hMatrixWrap: { marginBottom: 12, alignSelf: 'flex-start' },
  h2hMatrixRow: { flexDirection: 'row' },
  h2hMatrixCell: {
    width: 60, height: 52,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.border.subtle,
  },
  h2hMatrixCornerCell: {
    backgroundColor: t.bg.secondary,
  },
  h2hMatrixHeaderCell: {
    backgroundColor: t.bg.secondary,
  },
  h2hMatrixRowLabelCell: {
    backgroundColor: t.bg.secondary,
  },
  h2hMatrixHeaderText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11,
    color: t.text.secondary, paddingHorizontal: 4,
  },
  h2hMatrixDiagonalCell: {
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
  },
  h2hMatrixDiagonalText: { color: t.text.muted, fontSize: 14 },
  h2hMatrixEmptyCell: { backgroundColor: t.bg.primary },
  h2hMatrixEmptyText: { color: t.text.muted, fontSize: 12 },
  h2hMatrixValueText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15,
  },
  h2hMatrixSubText: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 9,
    color: t.text.muted, marginTop: 2, letterSpacing: 0.3,
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
