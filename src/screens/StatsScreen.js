import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { useAuth } from '../context/AuthContext';
import {
  loadTournament, getTournament, getPlayingHandicap, calcStablefordPoints,
  playerPartnerSplits, getActiveTournamentSnapshot, getTournamentSnapshot,
  roundScoringMode,
} from '../store/tournamentStore';
import { holeCountOf } from '../store/scoring';
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
  hallOfShame, pairHoleWins, pairDifferenceByHole,
  tournamentMomentum, clutchOnHardest, playerConsistency, courseDNA,
  playingToHandicap, hotStretch,
  parTypeSplit, warmupVsClosing, handicapROI,
  playerNemesisAndCrushed, chaosHoles, collectiveExtremes,
  pairSynergy, pairCarryRatio, swingHole,
  par3Heartbreak, pickupChampion, anchor, zeroHero, nemesisEncore,
  skinsLeaderboard, matchPlayResults, pairConfigMatrix,
  shotStats, playersWithShotData, driveScoreImpact, puttDeepDive,
  approachScoreImpact,
  bounceBackRate, frontBackSplit, strokeIndexAccuracy, scramblingStats,
  withoutScrambleScores, pairCoverage, girByDriveResult,
} from '../store/statsEngine';
// holeDifficultySplit already takes (tournament, playerId) generically — no
// synthetic-tournament assumptions inside it — so the Players tab reuses it
// directly instead of adding a thin wrapper in statsEngine.js.
import { holeDifficultySplit } from '../store/personalStats';
import StatDetailSheet, { captureAndShare } from '../components/StatDetailSheet';
import { scoringModeUsesTeams, isScrambleMode, getScoringMode } from '../components/scoringModes';
import PtsBadge from '../components/PtsBadge';
// Same 6-sample floor MyStats' Breakdown tab uses (metricTone.js) — below it
// a bucket's average is too noisy to paint as a good/bad verdict.
import { isLowSample } from '../components/mystats/metricTone';
import { t, tr, useT, formatNumber } from '../i18n';

// Numbers reach the catalogue already formatted (decimal comma in Spanish).
const num = (v) => formatNumber(v);
const sgn = (v) => (v >= 0 ? '+' : '') + num(v);
const sgnPos = (v) => (v > 0 ? '+' : '') + num(v);
const ptsLabel = (v) => t('stats.screen.pts', { n: num(v) });
const strLabel = (v) => t('stats.screen.str', { n: num(v) });
const roundHoleLabel = (b) => t('stats.screen.roundHole', { round: b.roundIndex + 1, course: b.courseName, hole: b.holeNumber });
const roundTag = (i) => t('stats.screen.roundShort', { n: i + 1 });
const andSep = () => t('stats.screen.andSep');
const parStrokesLabel = (b) => t('stats.screen.parStrokes', { par: b.par, strokes: b.strokes });

const ALL_TABS = [
  { key: 'overview', labelKey: 'stats.screen.tab.overview' },
  { key: 'players', labelKey: 'stats.screen.tab.players' },
  { key: 'holes', labelKey: 'stats.screen.tab.holes' },
  { key: 'pairs', labelKey: 'stats.screen.tab.pairs' },
  { key: 'shots', labelKey: 'stats.screen.tab.shots' },
  { key: 'shame', labelKey: 'stats.screen.tab.shame' },
];

const DRIVE_KEYS = ['fairway', 'left', 'right', 'short', 'super'];
const DRIVE_LABELS = {
  fairway: 'stats.screen.drive.fairway', left: 'stats.screen.drive.left', right: 'stats.screen.drive.right',
  short: 'stats.screen.drive.short', super: 'stats.screen.drive.super',
};

// Pair members resolve against the roster (scoring.js resolvePairs), but a
// player dropped from it stays thin — render a dash rather than throwing.
const firstName = (p) => p?.name?.split(' ')[0] ?? '—';
// How many players in this roster share each first name. joinNames uses it
// to fold duplicate names into a single "Name ×N" token; the Players tab
// chip selector (Task 20) reuses the same tally to tell two same-first-name
// players' chips apart instead of rendering two identical "Bob" buttons.
const firstNameCounts = (players) => {
  const counts = new Map();
  players.forEach(p => {
    const n = firstName(p);
    counts.set(n, (counts.get(n) || 0) + 1);
  });
  return counts;
};
const joinNames = (players) => {
  const counts = firstNameCounts(players);
  const tokens = [...counts.entries()].map(([n, c]) => c > 1 ? `${n} ×${c}` : n);
  if (tokens.length <= 1) return tokens[0] || '';
  if (tokens.length === 2) return t('stats.screen.join.two', { a: tokens[0], b: tokens[1] });
  return t('stats.screen.join.many', { list: tokens.slice(0, -1).join(', '), last: tokens[tokens.length - 1] });
};
// Chip label for a player within `players` — the full name when their first
// name collides with another player's on the roster, otherwise just the
// first name (the common case, kept short for the chip row).
const disambiguatedFirstName = (player, players) => (
  firstNameCounts(players).get(firstName(player)) > 1 ? player.name : firstName(player)
);
// Compact scoring-mode labels for a small badge chip — SCORING_MODES' own
// `label` strings ("Stableford with Partners") are too long for a Round
// History row. A round's EFFECTIVE mode can override the tournament default
// (roundScoringMode), so a mixed tournament's history can legitimately show
// different badges per row. Scramble rounds never reach here: the tab reads
// the screen-level scramble-sanitized tournament, and playerRoundHistory
// only returns rounds with real personal scores.
const MODE_BADGE_LABELS = {
  individual: 'stats.screen.modeBadge.individual',
  stableford: 'stats.screen.modeBadge.stableford',
  matchplay: 'stats.screen.modeBadge.matchplay',
  sindicato: 'stats.screen.modeBadge.sindicato',
  bestball: 'stats.screen.modeBadge.bestball',
  pairsmatchplay: 'stats.screen.modeBadge.pairsmatchplay',
};
const modeBadgeLabel = (mode) => (MODE_BADGE_LABELS[mode] ? t(MODE_BADGE_LABELS[mode]) : t(getScoringMode(mode).labelKey));
// Match-play result text: closed matches read "3&2"; otherwise the engine hands
// back a descriptor ("Halved" / "N up") to render in the active language.
const scorelineText = (round) => (round.scorelineMsg ? tr(round.scorelineMsg) : round.scoreline);
const toneForPoints = (p) => p >= 3 ? 'excellent' : p === 2 ? 'good' : p === 1 ? 'neutral' : 'poor';
// Ranks a list already sorted best-first so equal values share a rank
// (1,1,3 rather than 1,2,3) instead of a plain array index. `valueFn` reads
// whatever "best" means for that list (higher skins, higher avg points,
// lower stdev) — direction doesn't matter here since the list is presorted.
const tiedRanks = (items, valueFn) => {
  let rank = 0;
  let prevValue;
  return items.map((item, i) => {
    const v = valueFn(item);
    if (i === 0 || v !== prevValue) rank = i + 1;
    prevValue = v;
    return rank;
  });
};
const holeRowFromBreakdown = (b, i, tone) => ({
  key: `${b.roundIndex}-${b.holeNumber}-${i}`,
  primary: roundHoleLabel(b),
  secondary: parStrokesLabel(b),
  rightPrimary: ptsLabel(b.points),
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

export default function StatsScreen({ navigation, route }) {
  useT(); // re-render on language change; the helpers below use the shared t()
  const { theme } = useTheme();
  const { user } = useAuth();
  // Which tournament to show: an explicit id when opened from a specific
  // game (History, My Stats round link), otherwise the active tournament.
  const routeTournamentId = route?.params?.tournamentId ?? null;
  const routeRoundId = route?.params?.roundId ?? null;
  // Memoised so StyleSheet.create only re-runs when the theme actually
  // changes — not on every tab switch / metric toggle re-render.
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [tournament, setTournament] = useState(() => (
    routeTournamentId ? getTournamentSnapshot(routeTournamentId) : getActiveTournamentSnapshot()
  ));
  const [tab, setTab] = useState('overview');
  // Each tab keeps its own player selection so navigating tabs no longer
  // silently changes the selection elsewhere.
  const [playersTabPlayer, setPlayersTabPlayer] = useState(0);
  const [pairsTabPlayer, setPairsTabPlayer] = useState(0);
  const [h2hP1, setH2hP1] = useState(0);
  const [h2hP2, setH2hP2] = useState(1);
  const [metric, setMetric] = useState('points');
  // Single screen-level round scope: null = whole tournament, otherwise a
  // round index. Sections that are inherently per-round read this scope and
  // fall back to the first completed round when it is null.
  const [roundScope, setRoundScope] = useState(null);
  // Per-tab scroll refs + section anchor offsets, for the sticky section index.
  const overviewScrollRef = useRef(null);
  const pairsScrollRef = useRef(null);
  const playersScrollRef = useRef(null);

  useEffect(() => {
    const load = routeTournamentId ? getTournament(routeTournamentId) : loadTournament();
    load.then(loaded => {
      setTournament(loaded);
      // Only preselect a round scope when there's more than one round — the
      // chip row is hidden for single-round games, so scoping there would
      // strand the user off "Total" with no way back, and whole-game scope
      // shows strictly more for a one-round game anyway.
      if (routeRoundId && loaded?.rounds?.length > 1) {
        const idx = loaded.rounds.findIndex((r) => r.id === routeRoundId);
        if (idx >= 0) setRoundScope(idx);
      }
      // Default selections to the signed-in user when they're one of the
      // players in this tournament. Falls back to the first player otherwise.
      if (loaded?.players?.length && user?.id) {
        const mine = loaded.players.findIndex((p) => p.user_id === user.id);
        if (mine >= 0) {
          setPlayersTabPlayer(mine);
          setPairsTabPlayer(mine);
          setH2hP1(mine);
          setH2hP2(mine === 0 ? 1 : 0);
        }
      }
    }).catch((e) => {
      // Without this catch a load failure is an unhandled rejection and the
      // screen silently stays blank. Leaving `tournament` null renders the
      // "no tournament" fallback below.
      console.warn('StatsScreen: failed to load tournament', e);
    });
  }, [user?.id, routeTournamentId, routeRoundId]);

  // Every personal-stat tab (Overview/Players/Holes/Pairs/Shots/Shame) reads
  // `statsTournament` instead of the raw `tournament` — scramble rounds
  // store one team ball under the captain, scored off a team handicap, and
  // withoutScrambleScores blanks that round's scores/shotDetails/pairs so it
  // never gets misattributed to the captain personally (see statsEngine).
  // The header and RoundScopeChips below still read the raw `tournament` —
  // chips label scramble rounds by name too, which needs the real round
  // data, not the blanked one. Computed above the `!tournament` guard (with
  // a null-safe fallback) so this hook always runs in the same order.
  const statsTournament = useMemo(
    () => (tournament ? withoutScrambleScores(tournament) : null),
    [tournament],
  );

  if (!tournament) return null;

  const { players } = tournament;
  const completedRounds = tournament.rounds.filter(r => r.scores && Object.keys(r.scores).length > 0);
  const isSolo = players.length === 1;
  // A round can now override the tournament's default scoring mode (see
  // roundScoringMode) — a "mixed" tournament may have some scramble rounds,
  // some real team rounds, and some solo rounds all at once. Scramble scores
  // exist only under each team's captain — players have no individual
  // scores — so BOTH the pair stats and the Head-to-Head section are
  // meaningless for a scramble round. These two aggregates read every
  // round's EFFECTIVE mode instead of one tournament-level default:
  //   - allScramble: every round is scramble → nothing per-player to show
  //     anywhere, gates the whole-screen placeholder below.
  //   - anyTeams: at least one round has real (non-scramble) team data →
  //     gates the Pairs tab and anything else that assumes partners exist.
  // `allScramble` must ALSO gate anything that assumes per-player scores
  // (e.g. H2H), which `!anyTeams` alone would re-enable for an all-scramble
  // tournament (scramble rounds have anyTeams === false too).
  const roundModes = (tournament.rounds ?? []).map((r) => roundScoringMode(tournament, r));
  const allScramble = roundModes.length > 0 && roundModes.every((m) => isScrambleMode(m));
  const anyTeams = !isSolo
    && roundModes.some((m) => scoringModeUsesTeams(m, players.length) && !isScrambleMode(m));
  const hasMulti = players.length > 1;
  const visibleTabs = ALL_TABS.filter(tb => tb.key !== 'pairs' || anyTeams);
  const activeTab = visibleTabs.some(tb => tb.key === tab) ? tab : 'overview';
  const firstCompletedIdx = tournament.rounds.findIndex(r => r.scores && Object.keys(r.scores).length > 0);
  const showRoundScope = tournament.rounds.length > 1
    && (activeTab === 'overview' || activeTab === 'holes' || activeTab === 'pairs' || activeTab === 'players');
  // Effective per-round scope: when "Total" is selected, per-round sections
  // fall back to the first completed round so they still show data.
  const effectiveRound = roundScope != null ? roundScope : (firstCompletedIdx >= 0 ? firstCompletedIdx : null);

  // Scramble tournaments store ONE team ball under each team's captain
  // (pair[0]), scored off the scramble team handicap — there are no personal
  // scores at all. Every stats tab here is built from per-player aggregates
  // (highlights, streaks, hole heatmaps, shame, shot impact), so running them
  // on scramble data would credit the whole team's play to the captain and
  // show nothing for everyone else. Same reasoning as the H2H/Pairs gating
  // below, applied to the whole stats body: show a friendly placeholder
  // instead of misleading numbers. Gated on `allScramble` (every round, not
  // just the tournament default) so a mixed tournament with even one
  // non-scramble round still gets the real stats body.
  if (allScramble) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>{t('stats.screen.title')}</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={s.scrambleNotice}>
          <View style={s.scrambleNoticeIcon}>
            <Feather name="users" size={26} color={theme.accent.primary} />
          </View>
          <Text style={s.scrambleNoticeTitle}>{t('stats.screen.scrambleNotice.title')}</Text>
          <Text style={s.scrambleNoticeText}>{t('stats.screen.scrambleNotice.body')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{t('stats.screen.title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabScroller}
        contentContainerStyle={s.tabBar}
      >
        {visibleTabs.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tab, activeTab === tb.key && s.tabActive]} onPress={() => setTab(tb.key)} activeOpacity={0.7}>
            <Text style={[s.tabText, activeTab === tb.key && s.tabTextActive]}>{t(tb.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Unified scope controls: Strokes/Points + a single round chip set. */}
      <View style={s.scopeBar}>
        <View style={s.scoringToggle}>
          <Text style={[s.scoringLabel, metric === 'strokes' && s.scoringLabelActive]}>{t('stats.screen.strokes')}</Text>
          <Switch
            value={metric === 'points'}
            onValueChange={(v) => setMetric(v ? 'points' : 'strokes')}
            trackColor={{ false: theme.border.default, true: theme.accent.primary }}
            thumbColor="#fff"
          />
          <Text style={[s.scoringLabel, metric === 'points' && s.scoringLabelActive]}>{t('stats.screen.points')}</Text>
        </View>
        {/* Round scope drives the per-round sections on Overview / Holes /
            Pairs / Players (distribution + streaks there — the rest of
            Players is tournament-wide and labeled "All rounds"). Shame stays
            a tournament-wide aggregate, so the chip set is hidden there to
            avoid a control that does nothing. */}
        {showRoundScope && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.scopeScroller}
            contentContainerStyle={s.scopeChips}
          >
            <RoundScopeChips tournament={tournament} selected={roundScope} onSelect={setRoundScope} theme={theme} s={s} />
          </ScrollView>
        )}
      </View>

      {activeTab === 'overview' && (
        <ScrollView ref={overviewScrollRef} style={s.scrollView} contentContainerStyle={s.content}>
          <OverviewTab tournament={statsTournament} metric={metric} hasMulti={hasMulti} anyTeams={anyTeams}
            allScramble={allScramble} roundScope={roundScope} scrollRef={overviewScrollRef} theme={theme} s={s} />
        </ScrollView>
      )}
      {activeTab === 'players' && (
        <ScrollView ref={playersScrollRef} style={s.scrollView} contentContainerStyle={s.content}>
          <PlayersTab tournament={statsTournament} players={players} selectedPlayer={playersTabPlayer}
            setSelectedPlayer={setPlayersTabPlayer} metric={metric} roundScope={roundScope}
            scrollRef={playersScrollRef} theme={theme} s={s} />
        </ScrollView>
      )}
      {activeTab === 'holes' && (
        <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
          <HolesTab tournament={statsTournament} completedRounds={completedRounds} hasMulti={hasMulti}
            metric={metric} effectiveRound={effectiveRound} roundScope={roundScope} theme={theme} s={s} />
        </ScrollView>
      )}
      {activeTab === 'pairs' && anyTeams && (
        <ScrollView ref={pairsScrollRef} style={s.scrollView} contentContainerStyle={s.content}>
          <PairsTab tournament={statsTournament} players={players}
            h2hP1={h2hP1} setH2hP1={setH2hP1} h2hP2={h2hP2} setH2hP2={setH2hP2}
            selectedPlayer={pairsTabPlayer} setSelectedPlayer={setPairsTabPlayer}
            metric={metric} effectiveRound={effectiveRound} roundScope={roundScope}
            scrollRef={pairsScrollRef} theme={theme} s={s} />
        </ScrollView>
      )}
      {activeTab === 'shots' && (
        <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
          <ShotsTab tournament={statsTournament} theme={theme} s={s} />
        </ScrollView>
      )}
      {activeTab === 'shame' && (
        <ScrollView style={s.scrollView} contentContainerStyle={s.content}>
          <ShameTab tournament={statsTournament} hasMulti={hasMulti} usesTeams={anyTeams} metric={metric} theme={theme} s={s} />
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

// Single round-scope chip set ("Total" + each round). Reused by the scope bar.
function RoundScopeChips({ tournament, selected, onSelect, theme, s }) {
  return (
    <>
      <TouchableOpacity
        style={[s.roundChip, selected === null && s.roundChipActive]}
        onPress={() => onSelect(null)}
        activeOpacity={0.7}
      >
        <Text style={[s.roundChipText, selected === null && s.roundChipTextActive]}>{t('stats.screen.total')}</Text>
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
            <Text style={[s.roundChipText, selected === i && s.roundChipTextActive, !hasData && s.roundChipTextDisabled]}>{roundTag(i)}</Text>
          </TouchableOpacity>
        );
      })}
    </>
  );
}

// Sticky section index — horizontal chips that scroll the parent ScrollView to
// a registered section anchor. `sections` is [{key,label}]; `anchors` is a ref
// to a {key: yOffset} map populated by SectionAnchor onLayout.
function SectionIndex({ sections, anchors, scrollRef, theme, s }) {
  if (!sections || sections.length < 2) return null;
  return (
    <View style={s.sectionIndexWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sectionIndexRow}>
        {sections.map(sec => (
          <TouchableOpacity
            key={sec.key}
            style={s.sectionIndexChip}
            activeOpacity={0.7}
            onPress={() => {
              const y = anchors.current[sec.key];
              if (y != null && scrollRef?.current) {
                scrollRef.current.scrollTo({ y: Math.max(0, y - 8), animated: true });
              }
            }}
          >
            <Text style={s.sectionIndexText}>{sec.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// Wrap a section so its scroll offset is registered for the SectionIndex.
function SectionAnchor({ anchorKey, anchors, children }) {
  return (
    <View onLayout={(e) => { anchors.current[anchorKey] = e.nativeEvent.layout.y; }}>
      {children}
    </View>
  );
}

// ── Overview Tab ──
function OverviewTab({ tournament, metric, hasMulti, anyTeams, allScramble, roundScope, scrollRef, theme, s }) {
  // Round scope is now screen-level; treat the prop as the source of truth.
  const roundIndex = roundScope;
  // Each of these is an O(players×rounds×holes) pass (tournamentHighlights
  // fans out further per player). The tab holds local `sheet` state below,
  // so without memoization tapping a highlight card to open its detail
  // sheet would re-run every one of these on the JS thread. Deps are keyed
  // on exactly the scope vars each function reads — `sheet` must never be a
  // dep, or opening a sheet would defeat the memo entirely. Mirrors the
  // useMemo pattern in ShotsTab (~line 2893).
  const highlights = useMemo(
    () => tournamentHighlights(tournament, { metric, roundIndex }),
    [tournament, metric, roundIndex],
  );
  const momentum = useMemo(() => tournamentMomentum(tournament), [tournament]);
  const clutch = useMemo(() => clutchOnHardest(tournament, { topN: 3 }), [tournament]);
  const consistency = useMemo(() => playerConsistency(tournament), [tournament]);
  const dna = useMemo(() => courseDNA(tournament), [tournament]);
  const skins = useMemo(() => skinsLeaderboard(tournament, { metric }), [tournament, metric]);
  const pth = useMemo(() => playingToHandicap(tournament), [tournament]);
  const hotStretchList = useMemo(() => hotStretch(tournament), [tournament]);
  const siAccuracy = useMemo(
    () => strokeIndexAccuracy(tournament, { roundIndex }),
    [tournament, roundIndex],
  );
  const isStrokes = metric === 'strokes';
  const modeLabel = isStrokes ? t('stats.screen.modeLabel.strokes') : t('stats.screen.modeLabel.points');
  const [sheet, setSheet] = useState(null);
  const anchors = useRef({});

  const scope = roundIndex === null
    ? t('stats.screen.scopeAll')
    : `${roundTag(roundIndex)} · ${tournament.rounds[roundIndex]?.courseName || ''}`;

  // Stroke-index-accuracy rows pool observations across every round on a
  // course, so a row's `roundIndices` may span more than one round — label
  // it "R1+R3" rather than assuming a single round.
  const roundsLabel = (h) => h.roundIndices.map(ri => `${roundTag(ri)}`).join('+');

  const hasAnyData = tournament.rounds.some(r => r.scores && Object.keys(r.scores).length > 0);
  if (!hasAnyData) {
    return <Text style={s.emptyText}>{t('stats.screen.noScores')}</Text>;
  }

  const openBestRound = () => {
    const h = highlights.bestRound;
    const names = joinNames(h.entries.map(e => e.player));
    setSheet({
      title: isStrokes
        ? t('stats.screen.namesStrokes', { names, value: num(h.value) })
        : t('stats.screen.namesPts', { names, value: num(h.value) }),
      subtitle: t(roundIndex === null ? 'stats.screen.best.subtitleBest' : 'stats.screen.best.subtitleTop', { mode: modeLabel }),
      explainer: isStrokes
        ? t('stats.screen.best.explainerStrokes')
        : t('stats.screen.best.explainerPoints'),
      rows: tiedRowsByPlayer(
        h.entries,
        (e) => e.breakdown.map(b => ({
          key: `${e.player.id}-${b.holeNumber}`,
          primary: t('stats.screen.hole', { n: b.holeNumber }),
          secondary: parStrokesLabel(b),
          rightPrimary: isStrokes ? strLabel(b.strokes) : ptsLabel(b.points),
          tone: toneForPoints(b.points),
        })),
        (e) => `${e.courseName} · ${isStrokes ? strLabel(e.strokes) : ptsLabel(e.points)}`,
      ),
    });
  };

  const openBirdies = () => {
    const h = highlights.mostBirdies;
    setSheet({
      title: t('stats.screen.birdies.title', { names: joinNames(h.entries.map(e => e.player)), value: num(h.value) }),
      subtitle: t('stats.screen.birdies.subtitle', { mode: modeLabel }),
      explainer: t('stats.screen.birdies.explainer'),
      rows: tiedRowsByPlayer(
        h.entries,
        (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: roundHoleLabel(b),
          secondary: parStrokesLabel(b),
          rightPrimary: b.vsPar <= -2 ? t('stats.screen.eagle') : t('stats.screen.birdie'),
          tone: 'excellent',
        })),
        (e) => t('stats.screen.birdies.count', { count: e.count }),
      ),
    });
  };

  const openParStreak = () => {
    const h = highlights.longestParStreak;
    setSheet({
      title: t('stats.screen.parStreak.title', { names: joinNames(h.entries.map(e => e.player)), value: num(h.value) }),
      subtitle: t('stats.screen.parStreak.subtitle', { mode: modeLabel }),
      explainer: t('stats.screen.parStreak.explainer'),
      rows: tiedRowsByPlayer(
        h.entries,
        (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: roundHoleLabel(b),
          secondary: parStrokesLabel(b),
          rightPrimary: ptsLabel(b.points),
          tone: b.vsPar <= -1 ? 'excellent' : 'good',
        })),
        (e) => t('stats.screen.nHoles', { count: e.count }),
      ),
    });
  };

  const openHole = (h, label, explainer) => {
    const avg = isStrokes
      ? t('stats.screen.hole.avgStr', { avg: h.avgStrokes != null ? num(h.avgStrokes) : '—', vs: sgn(h.avgVsPar ?? 0) })
      : t('stats.screen.hole.avgPts', { avg: num(h.avgPoints) });
    setSheet({
      title: t('stats.screen.holeCourse', { n: h.holeNumber, course: h.courseName }),
      subtitle: `${label} · ${t('stats.screen.parSi', { par: h.par, si: h.si })} · ${avg}`,
      explainer,
      rows: h.playerScores.map(ps => ({
        key: ps.playerId,
        primary: ps.playerName,
        secondary: t('stats.screen.strokesN', { n: ps.strokes }),
        rightPrimary: isStrokes ? strLabel(ps.strokes) : ptsLabel(ps.points),
        tone: toneForPoints(ps.points),
      })),
    });
  };

  const openMomentum = (row) => setSheet({
    title: t('stats.screen.momentum.title', { name: row.player.name }),
    subtitle: t('stats.screen.momentum.subtitle'),
    explainer: t('stats.screen.momentum.explainer'),
    rows: row.rounds.filter(r => r.points != null).map(r => ({
      key: `r${r.roundIndex}`,
      primary: `${roundTag(r.roundIndex)} · ${r.courseName}`,
      secondary: t('stats.screen.strokesOverHoles', { strokes: r.strokes, holes: r.holesPlayed }),
      rightPrimary: ptsLabel(r.points),
      tone: toneForPoints(Math.round(r.points / Math.max(r.holesPlayed, 1))),
    })),
  });

  const openClutch = (row) => setSheet({
    title: t('stats.screen.clutch.title', { name: row.player.name }),
    subtitle: t('stats.screen.clutch.subtitle', { avg: num(row.avgPoints), holes: row.holesPlayed }),
    explainer: t('stats.screen.clutch.explainer'),
    rows: row.breakdown.map((b, i) => holeRowFromBreakdown(b, i)),
  });

  const openConsistency = (row) => setSheet({
    title: t('stats.screen.consistency.title', { name: row.player.name }),
    subtitle: t('stats.screen.consistency.subtitle', { stdev: num(row.stdev), mean: num(row.mean) }),
    explainer: t('stats.screen.consistency.explainer'),
    rows: (row.breakdown || []).map((b, i) => ({
      key: `${b.roundIndex}-${b.holeNumber}-${i}`,
      primary: roundHoleLabel(b),
      secondary: t('stats.screen.parSiStrokes', { par: b.par, si: b.si, strokes: b.strokes }),
      rightPrimary: ptsLabel(b.points),
      rightSecondary: `${sgn(b.deviation)} vs μ`,
      tone: Math.abs(b.deviation) <= 0.5 ? 'good' : Math.abs(b.deviation) <= 1.2 ? 'neutral' : 'poor',
    })),
  });

  const openSiAccuracy = () => setSheet({
    title: t('stats.screen.si.title'),
    subtitle: t('stats.screen.si.subtitle', { count: siAccuracy.length, scope }),
    explainer: t('stats.screen.si.explainer'),
    rows: siAccuracy.map((h, i) => ({
      key: `${h.courseName}-${h.holeNumber}-${i}`,
      primary: `${roundsLabel(h)} · ${h.courseName} · ${t('stats.screen.hole', { n: h.holeNumber })}`,
      secondary: t('stats.screen.si.row', { par: h.par, printed: h.printedSi, actual: h.actualSi, avg: sgn(h.avgVsPar) }),
      rightPrimary: `${sgnPos(h.siGap)}`,
      rightSecondary: t('stats.screen.si.gap'),
      tone: Math.abs(h.siGap) >= 6 ? 'poor' : Math.abs(h.siGap) >= 3 ? 'neutral' : 'good',
    })),
  });

  const openSkins = (player) => {
    const rec = skins.leaderboard.find(r => r.player.id === player.id);
    if (!rec) return;
    // A player with zero skins but at least one tie still has something to
    // show — the holes where they matched the best score but no skin was
    // awarded to anyone. Surface those instead of an empty sheet.
    if (rec.skins === 0 && rec.ties > 0) {
      const tiedHoles = skins.rounds.flatMap(r =>
        r.holes.filter(h => h.tiedLeaders?.some(p => p.id === player.id)));
      setSheet({
        title: t('stats.screen.skins.tiedTitle', { name: player.name, count: rec.ties }),
        subtitle: t('stats.screen.skins.tiedSubtitle', { total: skins.totalSkins }),
        explainer: t(isStrokes ? 'stats.screen.skins.tiedExplainerStrokes' : 'stats.screen.skins.tiedExplainerPoints'),
        rows: tiedHoles.map((h, i) => ({
          key: `${h.roundIndex}-${h.holeNumber}-${i}`,
          primary: roundHoleLabel(h),
          secondary: t('stats.screen.parSi', { par: h.par, si: h.si }),
          rightPrimary: isStrokes ? strLabel(h.bestVal) : ptsLabel(h.bestVal),
          tone: 'neutral',
        })),
      });
      return;
    }
    setSheet({
      title: t('stats.screen.skins.title', { name: player.name, count: rec.skins }),
      subtitle: t('stats.screen.skins.subtitle', { ties: rec.ties, total: skins.totalSkins }),
      explainer: t(isStrokes ? 'stats.screen.skins.explainerStrokes' : 'stats.screen.skins.explainerPoints'),
      rows: rec.breakdown.map(b => ({
        key: `${b.roundIndex}-${b.holeNumber}`,
        primary: roundHoleLabel(b),
        secondary: t('stats.screen.parSi', { par: b.par, si: b.si }),
        rightPrimary: isStrokes ? strLabel(b.bestVal) : ptsLabel(b.bestVal),
        tone: 'excellent',
      })),
    });
  };

  const openDna = (row) => setSheet({
    title: t('stats.screen.dna.title', { name: row.player.name }),
    subtitle: t('stats.screen.dna.subtitle'),
    explainer: t('stats.screen.dna.explainer'),
    rows: row.courses.map(c => ({
      key: c.courseName,
      primary: c.courseName,
      secondary: t('stats.screen.dna.row', { count: c.rounds, holes: c.holesPlayed }),
      rightPrimary: t('stats.screen.ptsPerHole', { n: num(c.avgPoints) }),
      rightSecondary: t('stats.screen.ptsPerRound', { n: num(c.roundPoints) }),
      tone: c.avgPoints >= 2 ? 'good' : c.avgPoints >= 1.5 ? 'neutral' : 'poor',
    })),
  });

  const openPth = (row) => setSheet({
    title: `${row.player.name} — ${sgn(row.delta)}`,
    subtitle: t('stats.screen.pth.subtitle', { points: num(row.points), holes: row.holesPlayed }),
    explainer: t('stats.screen.pth.explainer'),
    rows: row.rounds.map((r) => ({
      key: `${row.player.id}-${r.roundIndex}`,
      primary: `${roundTag(r.roundIndex)} · ${r.courseName}`,
      secondary: t('stats.screen.ptsOverHoles', { points: num(r.points), holes: r.holesPlayed }),
      rightPrimary: `${sgn(r.delta)}`,
      tone: r.delta >= 0 ? 'good' : 'poor',
    })),
  });

  const openHotStretch = (row) => setSheet({
    title: t('stats.screen.namesPts', { names: row.player.name, value: num(row.points) }),
    subtitle: `${roundTag(row.roundIndex)} · ${row.breakdown[0]?.courseName} · H${row.startHole}–H${row.endHole}`,
    explainer: t('stats.screen.hotStretch.explainer'),
    rows: row.breakdown.map((b, i) => holeRowFromBreakdown(b, i)),
  });

  const bestRoundLabel = roundIndex === null ? t('stats.screen.best.labelBest') : t('stats.screen.best.labelTop');
  const br = highlights.bestRound;
  const mb = highlights.mostBirdies;
  const ps = highlights.longestParStreak;

  // Shared tie-aware ranks for the leaderboard-style lists below (skins is
  // already sorted desc by skins, clutch desc by avgPoints, consistency asc
  // by stdev — see statsEngine).
  const skinsRanks = tiedRanks(skins.leaderboard, (r) => r.skins);
  const clutchRanks = tiedRanks(clutch, (r) => r.avgPoints);
  // A stdev over a handful of holes is noise, not signal — only players with
  // a full round's worth of counted holes get a ranked row; the rest get an
  // honest "not enough data yet" note instead of a misleading number.
  const qualifiedConsistency = consistency.filter((r) => r.holesPlayed >= 18);
  const unqualifiedConsistency = consistency.filter((r) => r.holesPlayed < 18);
  const consistencyRanks = tiedRanks(qualifiedConsistency, (r) => r.stdev);
  const pthRanks = tiedRanks(pth, (r) => r.delta);

  // Build the sticky section index from whichever sections will actually render.
  // Playing to Handicap and Hot Stretch are tournament-wide-only (like
  // Clutch/Consistency/Course DNA below), so both gate on roundIndex === null.
  const showPth = roundIndex === null && pth.length > 0;
  const showHotStretch = roundIndex === null && hotStretchList.length > 0;
  const showMomentum = hasMulti && roundIndex === null && momentum.some(m => m.rounds.some(r => r.points != null));
  const showSkins = hasMulti && roundIndex === null && skins.totalSkins > 0;
  const showClutch = roundIndex === null && clutch.length > 0;
  const showConsistency = roundIndex === null && consistency.length > 0;
  const showDna = roundIndex === null && dna.length > 0 && dna[0].courses.length > 0;
  const showSi = siAccuracy.length > 0;
  // H2H compares per-player scores, which scramble rounds don't have (the
  // team ball lives under the captain) — so the whole-tournament placeholder
  // (allScramble) must still hide this section even though its anyTeams
  // flag is false. A mixed tournament with SOME scramble rounds among
  // non-team ones shows the section, but `tournament` here is already the
  // screen-level statsTournament (scramble rounds' scores blanked — see
  // withoutScrambleScores) so that two team CAPTAINS, who both hold real
  // team-ball scores in a scramble round, never have their teams' play
  // counted as a personal duel.
  const showH2H = hasMulti && !anyTeams && !allScramble && roundIndex === null;
  const indexSections = [
    { key: 'highlights', label: t('stats.screen.index.highlights') },
    showPth && { key: 'pth', label: t('stats.screen.index.pth') },
    showHotStretch && { key: 'hotstretch', label: t('stats.screen.index.hotStretch') },
    showMomentum && { key: 'momentum', label: t('stats.screen.index.momentum') },
    showSkins && { key: 'skins', label: t('stats.screen.index.skins') },
    showClutch && { key: 'clutch', label: t('stats.screen.index.clutch') },
    showConsistency && { key: 'consistency', label: t('stats.screen.index.consistency') },
    showDna && { key: 'dna', label: t('stats.screen.index.dna') },
    showSi && { key: 'si', label: t('stats.screen.index.si') },
    showH2H && { key: 'h2h', label: t('stats.screen.index.h2h') },
  ].filter(Boolean);

  return (
    <View>
      <SectionIndex sections={indexSections} anchors={anchors} scrollRef={scrollRef} theme={theme} s={s} />
      <SectionAnchor anchorKey="highlights" anchors={anchors}>
      <Text style={s.sectionTitle}>{roundIndex === null ? t('stats.screen.highlights.tournament') : t('stats.screen.highlights.round')}</Text>
      <Text style={s.scopeText}>{scope}</Text>
      {!br && (
        <Text style={s.emptyText}>
          {isStrokes
            ? t('stats.screen.highlights.emptyStrokes')
            : t('stats.screen.highlights.emptyPoints')}
        </Text>
      )}
      {br && (
        <HighlightCard
          icon="award"
          label={bestRoundLabel}
          value={t(isStrokes ? 'stats.screen.namesStr' : 'stats.screen.namesPts', { names: joinNames(br.entries.map(e => e.player)), value: num(br.value) })}
          sub={br.entries.length === 1 ? br.entries[0].courseName : t('stats.screen.nTied', { count: br.entries.length })}
          onPress={openBestRound} theme={theme} s={s}
        />
      )}
      {mb && mb.value > 0 && (
        <HighlightCard
          icon="zap"
          label={t('stats.screen.birdies.label')}
          value={`${joinNames(mb.entries.map(e => e.player))} — ${mb.value}`}
          sub={t('stats.screen.birdies.sub', { mode: modeLabel })}
          onPress={openBirdies} theme={theme} s={s}
        />
      )}
      {ps && ps.value > 1 && (
        <HighlightCard
          icon="trending-up"
          label={t('stats.screen.parStreak.label')}
          value={t('stats.screen.parStreak.title', { names: joinNames(ps.entries.map(e => e.player)), value: num(ps.value) })}
          sub={t('stats.screen.parStreak.sub', { mode: modeLabel })}
          onPress={openParStreak} theme={theme} s={s}
        />
      )}
      {highlights.bestHole && (
        <HighlightCard
          icon="thumbs-up"
          label={t('stats.screen.easiestLabel')}
          value={isStrokes
            ? t('stats.screen.hole.valueStrokes', { n: highlights.bestHole.holeNumber, avg: sgn(highlights.bestHole.avgVsPar) })
            : t('stats.screen.hole.valuePoints', { n: highlights.bestHole.holeNumber, avg: num(highlights.bestHole.avgPoints) })}
          sub={`${highlights.bestHole.courseName} · ${t('stats.screen.parSi', { par: highlights.bestHole.par, si: highlights.bestHole.si })}`}
          onPress={() => openHole(highlights.bestHole, t('stats.screen.easiestLabel'), t(isStrokes ? 'stats.screen.easiestExplainerStrokes' : 'stats.screen.easiestExplainerPoints'))}
          theme={theme} s={s}
        />
      )}
      {highlights.worstHole && (
        <HighlightCard
          icon="thumbs-down"
          label={t('stats.screen.hardestLabel')}
          value={isStrokes
            ? t('stats.screen.hole.valueStrokes', { n: highlights.worstHole.holeNumber, avg: sgn(highlights.worstHole.avgVsPar) })
            : t('stats.screen.hole.valuePoints', { n: highlights.worstHole.holeNumber, avg: num(highlights.worstHole.avgPoints) })}
          sub={`${highlights.worstHole.courseName} · ${t('stats.screen.parSi', { par: highlights.worstHole.par, si: highlights.worstHole.si })}`}
          onPress={() => openHole(highlights.worstHole, t('stats.screen.hardestLabel'), t(isStrokes ? 'stats.screen.hardestExplainerStrokes' : 'stats.screen.hardestExplainerPoints'))}
          theme={theme} s={s}
        />
      )}

      </SectionAnchor>

      {showPth && (
        <SectionAnchor anchorKey="pth" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.pth.section')}</Text>
            {isStrokes && <PtsBadge />}
          </View>
          <Text style={s.scopeText}>{t('stats.screen.pth.desc')}</Text>
          <View style={s.card}>
            {pth.map((row, i) => (
              <TouchableOpacity key={row.player.id} style={s.leaderRow} onPress={() => openPth(row)} activeOpacity={0.7}>
                <Text style={[s.leaderRank, { color: pthRanks[i] === 1 ? theme.semantic.rank.gold : theme.text.muted }]}>#{pthRanks[i]}</Text>
                <Text style={s.leaderName}>{firstName(row.player)}</Text>
                <Text style={[s.leaderValue, { color: row.delta >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor') }]}>
                  {sgn(row.delta)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SectionAnchor>
      )}

      {showHotStretch && (
        <SectionAnchor anchorKey="hotstretch" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.hotStretch.section')}</Text>
            {isStrokes && <PtsBadge />}
          </View>
          <Text style={s.scopeText}>{t('stats.screen.hotStretch.desc')}</Text>
          {hotStretchList.slice(0, 3).map((row, i) => (
            <HighlightCard
              key={row.player.id}
              icon="thermometer"
              label={i === 0 ? t('stats.screen.hotStretch.label') : `#${i + 1}`}
              value={`${firstName(row.player)} — ${ptsLabel(row.points)} · ${roundTag(row.roundIndex)} H${row.startHole}–H${row.endHole}`}
              sub={row.breakdown[0]?.courseName}
              onPress={() => openHotStretch(row)}
              theme={theme} s={s}
            />
          ))}
        </SectionAnchor>
      )}

      {showMomentum && (
        <SectionAnchor anchorKey="momentum" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.momentum.section')}</Text>
            {isStrokes && <PtsBadge />}
          </View>
          <MomentumChart momentum={momentum} onRowPress={openMomentum} theme={theme} s={s} />
        </SectionAnchor>
      )}

      {showSkins && (
        <SectionAnchor anchorKey="skins" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.skins.section')}</Text>
          <Text style={s.scopeText}>
            {t(isStrokes ? 'stats.screen.skins.descStrokes' : 'stats.screen.skins.descPoints')}
          </Text>
          <View style={s.card}>
            {skins.leaderboard.map((rec, i) => (
              <TouchableOpacity
                key={rec.player.id}
                style={s.leaderRow}
                onPress={() => openSkins(rec.player)}
                activeOpacity={0.7}
                disabled={rec.skins === 0 && rec.ties === 0}
              >
                <Text style={[s.leaderRank, { color: skinsRanks[i] === 1 && rec.skins > 0 ? theme.semantic.rank.gold : theme.text.muted }]}>#{skinsRanks[i]}</Text>
                <Text style={s.leaderName}>{firstName(rec.player)}</Text>
                <Text style={s.leaderValue}>
                  {rec.skins} <Text style={s.leaderUnit}>{t('stats.screen.skins.unit', { count: rec.skins })}</Text>
                </Text>
              </TouchableOpacity>
            ))}
            <Text style={s.skinsFooter}>
              {t('stats.screen.skins.footer', {
                rounds: skins.rounds.map(r => `${roundTag(r.roundIndex)}: ${Object.values(r.skinsPerPlayer).reduce((a, b) => a + b, 0)}`).join(' · '),
                total: skins.totalSkins,
              })}
            </Text>
          </View>
        </SectionAnchor>
      )}

      {showClutch && (
        <SectionAnchor anchorKey="clutch" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.clutch.section')}</Text>
            {isStrokes && <PtsBadge />}
          </View>
          <Text style={s.scopeText}>{t('stats.screen.clutch.desc')}</Text>
          <View style={s.card}>
            {clutch.map((row, i) => (
              <TouchableOpacity key={row.player.id} style={s.leaderRow} onPress={() => openClutch(row)} activeOpacity={0.7}>
                <Text style={[s.leaderRank, { color: clutchRanks[i] === 1 ? theme.semantic.rank.gold : theme.text.muted }]}>#{clutchRanks[i]}</Text>
                <Text style={s.leaderName}>{firstName(row.player)}</Text>
                <Text style={s.leaderValue}>{num(row.avgPoints)} <Text style={s.leaderUnit}>{t('stats.screen.ptsPerHoleUnit')}</Text></Text>
              </TouchableOpacity>
            ))}
          </View>
        </SectionAnchor>
      )}

      {showConsistency && (
        <SectionAnchor anchorKey="consistency" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.consistency.section')}</Text>
            {isStrokes && <PtsBadge />}
          </View>
          <Text style={s.scopeText}>{t('stats.screen.consistency.desc')}</Text>
          <View style={s.card}>
            {qualifiedConsistency.map((row, i) => (
              <TouchableOpacity key={row.player.id} style={s.leaderRow} onPress={() => openConsistency(row)} activeOpacity={0.7}>
                <Text style={[s.leaderRank, { color: consistencyRanks[i] === 1 ? theme.semantic.rank.gold : theme.text.muted }]}>#{consistencyRanks[i]}</Text>
                <Text style={s.leaderName}>{firstName(row.player)}</Text>
                <Text style={s.leaderValue}>σ {num(row.stdev)} <Text style={s.leaderUnit}>μ {num(row.mean)}</Text></Text>
              </TouchableOpacity>
            ))}
            {unqualifiedConsistency.map((row) => (
              <View key={row.player.id} style={s.leaderRow}>
                <Text style={[s.leaderRank, { color: theme.text.muted }]}>—</Text>
                <Text style={[s.leaderName, { color: theme.text.muted }]}>{firstName(row.player)}</Text>
                <Text style={s.leaderUnit}>{t('stats.screen.consistency.needsData')}</Text>
              </View>
            ))}
          </View>
        </SectionAnchor>
      )}

      {showDna && (
        <SectionAnchor anchorKey="dna" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.dna.section')}</Text>
            {isStrokes && <PtsBadge />}
          </View>
          <Text style={s.scopeText}>{t('stats.screen.dna.desc')}</Text>
          {dna.map(row => {
            if (row.courses.length === 0) return null;
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
                      <Text style={[s.dnaChipValue, { color: theme.scoreColor(c.avgPoints >= 2 ? 'good' : c.avgPoints >= 1.5 ? 'neutral' : 'poor') }]}>{num(c.avgPoints)}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </SectionAnchor>
      )}

      {showSi && (
        <SectionAnchor anchorKey="si" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.si.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.si.question', { scope })}</Text>
          <TouchableOpacity style={s.card} onPress={openSiAccuracy} activeOpacity={0.7}>
            {siAccuracy.slice(0, 4).map((h, i) => (
              <View key={`${h.courseName}-${h.holeNumber}-${i}`} style={s.leaderRow}>
                <Text style={s.leaderName}>{roundsLabel(h)} · H{h.holeNumber}</Text>
                <Text style={s.leaderUnit}>{t('stats.screen.si.rowShort', { printed: h.printedSi, actual: h.actualSi })}</Text>
                <Text style={[s.leaderValue, {
                  color: Math.abs(h.siGap) >= 6 ? theme.scoreColor('poor')
                    : Math.abs(h.siGap) >= 3 ? theme.scoreColor('neutral')
                    : theme.scoreColor('good'),
                }]}>{sgnPos(h.siGap)}</Text>
              </View>
            ))}
            <Text style={s.skinsFooter}>{t('stats.screen.si.footer')}</Text>
          </TouchableOpacity>
        </SectionAnchor>
      )}

      {showH2H && (
        <SectionAnchor anchorKey="h2h" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.h2h.section')}</Text>
          <Text style={s.scopeText}>
            {t(isStrokes ? 'stats.screen.h2h.descStrokes' : 'stats.screen.h2h.descPoints')}
          </Text>
          <H2HMatrix
            tournament={tournament}
            players={tournament.players}
            metric={metric}
            theme={theme}
            s={s}
            onCellPress={(i, j) => {
              const p1 = tournament.players[i];
              const p2 = tournament.players[j];
              const result = headToHead(tournament, p1.id, p2.id);
              const bucket = isStrokes ? result.strokes : result.points;
              setSheet({
                title: t(isStrokes ? 'stats.screen.h2h.titleStrokes' : 'stats.screen.h2h.titlePoints', { a: firstName(p1), b: firstName(p2) }),
                subtitle: t('stats.screen.h2h.subtitle', { a: firstName(p1), aw: bucket.p1Wins, b: firstName(p2), bw: bucket.p2Wins, ties: bucket.ties }),
                explainer: isStrokes
                  ? t('stats.screen.h2h.explainerStrokes')
                  : t('stats.screen.h2h.explainerPoints'),
                rows: result.holes.map((h, idx) => {
                  const v1 = isStrokes ? h.p1Strokes : h.p1Points;
                  const v2 = isStrokes ? h.p2Strokes : h.p2Points;
                  const p1Won = isStrokes ? v1 < v2 : v1 > v2;
                  const p2Won = isStrokes ? v2 < v1 : v2 > v1;
                  const winner = p1Won ? firstName(p1) : p2Won ? firstName(p2) : t('stats.screen.tie');
                  return {
                    key: `${h.roundIndex}-${h.courseName}-${h.holeNumber}-${idx}`,
                    primary: roundHoleLabel(h),
                    secondary: `${firstName(p1)} ${v1} · ${firstName(p2)} ${v2}`,
                    rightPrimary: winner,
                    tone: v1 === v2 ? 'neutral' : 'good',
                  };
                }),
              });
            }}
          />
        </SectionAnchor>
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

// Same excellent/good/neutral/poor cutoffs the bars have always used
// (32/28/22 points over a full 18-hole round), but expressed as a
// points-per-hole rate. A raw points total alone unfairly tones down a
// partial round (front 9, a round cut short) even when the pace was strong,
// so this normalizes against however many holes were actually played.
const momentumTone = (points, holesPlayed) => {
  if (!holesPlayed) return 'poor';
  const perHole = points / holesPlayed;
  if (perHole >= 32 / 18) return 'excellent';
  if (perHole >= 28 / 18) return 'good';
  if (perHole >= 22 / 18) return 'neutral';
  return 'poor';
};

// Momentum bars with axes: a labelled value scale on the left and a zero
// baseline so the per-round trajectory is readable, not just relative.
function MomentumChart({ momentum, onRowPress, theme, s }) {
  const allPts = momentum.flatMap(m => m.rounds.filter(r => r.points != null).map(r => r.points));
  const maxPts = allPts.length ? Math.max(...allPts) : 0;
  const ROW_H = 36;
  const rounds = momentum[0]?.rounds || [];
  return (
    <View style={s.card}>
      <View style={s.momentumScaleRow}>
        <Text style={s.momentumScaleLabel}>0</Text>
        <View style={s.momentumScaleLine} />
        <Text style={s.momentumScaleLabel}>{ptsLabel(maxPts)}</Text>
      </View>
      {momentum.map(row => (
        <TouchableOpacity
          key={row.player.id}
          style={s.momentumRow}
          onPress={() => onRowPress(row)}
          activeOpacity={0.7}
        >
          <Text style={s.momentumName}>{firstName(row.player)}</Text>
          <View style={s.momentumBars}>
            {row.rounds.map(r => {
              const played = r.points != null;
              // Bar height is proportional to absolute points against a true
              // zero baseline (an honest axis, not a relative min/max).
              const pct = played && maxPts > 0 ? Math.max(0.06, r.points / maxPts) : 0;
              return (
                <View key={r.roundIndex} style={s.momentumBarWrap}>
                  <View
                    style={[
                      s.momentumBar,
                      {
                        height: Math.max(played ? 2 : 0, ROW_H * pct),
                        backgroundColor: played ? theme.scoreColor(
                          momentumTone(r.points, r.holesPlayed)
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
        {rounds.map(r => (
          <Text key={r.roundIndex} style={s.momentumLegendLabel}>{roundTag(r.roundIndex)}</Text>
        ))}
      </View>
    </View>
  );
}

function H2HMatrix({ tournament, players, metric, onCellPress, theme, s }) {
  const matrix = useMemo(() => {
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

  const flat = matrix.flat().filter((c) => c != null);
  const maxAbs = flat.reduce((m, c) => Math.max(m, Math.abs(c.net)), 0) || 1;
  const cellColor = (net) => net === 0 ? theme.text.muted : net > 0 ? theme.scoreColor('excellent') : theme.scoreColor('poor');
  const cellBg = (net) => {
    const intensity = Math.min(1, Math.abs(net) / maxAbs);
    const opacity = 0.10 + intensity * 0.30;
    if (net === 0) return theme.bg.secondary;
    const hex = net > 0 ? theme.scoreColor('excellent') : theme.scoreColor('poor');
    return hex + Math.round(opacity * 255).toString(16).padStart(2, '0');
  };

  return (
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
              const cell = matrix[i]?.[j];
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
                  onPress={() => onCellPress?.(i, j, cell)}
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
  );
}

// Branded off-screen card used to share a single highlight as an image.
const ShareableHighlight = React.forwardRef(({ label, value, sub }, ref) => (
  <View ref={ref} collapsable={false} style={shareCardStyles.card}>
    <Text style={shareCardStyles.brand}>GOLF PARTNER</Text>
    <Text style={shareCardStyles.label}>{(label || '').replace(/[^\x00-\x7F\u00C0-\u017F]/g, '').trim()}</Text>
    <Text style={shareCardStyles.value} numberOfLines={3}>{value}</Text>
    {sub ? <Text style={shareCardStyles.sub} numberOfLines={2}>{sub}</Text> : null}
    <Text style={shareCardStyles.footer}>golfpartner.app</Text>
  </View>
));
ShareableHighlight.displayName = 'ShareableHighlight';

function HighlightCard({ icon, label, value, sub, onPress, shareable = true, theme, s }) {
  const Container = onPress ? TouchableOpacity : View;
  const shareRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await captureAndShare(shareRef, `${(label || 'highlight').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    } finally {
      setSharing(false);
    }
  };
  return (
    <Container style={s.highlightCard} onPress={onPress} activeOpacity={0.7}>
      {/* Off-screen capture target. */}
      <View style={s.highlightCaptureHost} pointerEvents="none">
        <ShareableHighlight ref={shareRef} label={label} value={value} sub={sub} />
      </View>
      <View style={s.highlightIcon}>
        <Feather name={icon} size={20} color={theme.accent.primary} />
      </View>
      <View style={s.highlightContent}>
        <Text style={s.highlightLabel}>{label}</Text>
        <Text style={s.highlightValue}>{value}</Text>
        {sub && <Text style={s.highlightSub}>{sub}</Text>}
      </View>
      {shareable && (
        <TouchableOpacity
          onPress={onShare}
          disabled={sharing}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[s.highlightShareBtn, sharing && { opacity: 0.4 }]}
        >
          <Feather name="share-2" size={16} color={theme.accent.primary} />
        </TouchableOpacity>
      )}
      {onPress && <Feather name="chevron-right" size={18} color={theme.text.muted} />}
    </Container>
  );
}

const shareCardStyles = StyleSheet.create({
  card: {
    width: 360, backgroundColor: '#006747', borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)', padding: 28,
  },
  brand: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: semantic.winner.dark,
    fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16,
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.6)',
    fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
  },
  value: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffffff', fontSize: 24, lineHeight: 30 },
  sub: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 8 },
  footer: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.45)',
    fontSize: 10, letterSpacing: 1, marginTop: 20,
  },
});

// ── Players Tab ──
function PlayersTab({ tournament, players, selectedPlayer, setSelectedPlayer, metric, roundScope, scrollRef, theme, s }) {
  const player = players[selectedPlayer];
  const [sheet, setSheet] = useState(null);
  const anchors = useRef({});

  const isStrokes = metric === 'strokes';
  // Distribution and streaks are the only two engine functions here that
  // accept a roundIndex — everything else on this tab pools the whole
  // tournament, so those sections read `roundScope` and the rest are
  // explicitly labeled "All rounds" (via scopeLabel below) rather than
  // silently ignoring the round-scope chip.
  //
  // Each of these does a pass over the tournament for the selected player.
  // The tab holds local `sheet` state for its detail sheets below, so
  // without memoization opening one would re-run every aggregate here.
  // Deps are keyed on exactly the scope vars each function reads — `sheet`
  // must never be a dep. The hooks must run unconditionally (before the
  // `!player` early return further down), so each is guarded on `player`
  // internally rather than skipped — mirrors ShotsTab's `selected`-guarded
  // useMemo pattern (~line 2893).
  const dist = useMemo(
    () => (player ? playerScoreDistribution(tournament, player.id, { metric, roundIndex: roundScope }) : null),
    [tournament, player, metric, roundScope],
  );
  const streaks = useMemo(
    () => (player ? playerStreaks(tournament, player.id, { metric, roundIndex: roundScope }) : null),
    [tournament, player, metric, roundScope],
  );
  const history = useMemo(
    () => (player ? playerRoundHistory(tournament, player.id) : null),
    [tournament, player],
  );
  const avg = useMemo(
    () => (player ? playerAvgStableford(tournament, player.id) : null),
    [tournament, player],
  );
  const parSplit = useMemo(
    () => (player ? parTypeSplit(tournament, player.id) : null),
    [tournament, player],
  );
  const difficulty = useMemo(
    () => (player ? holeDifficultySplit(tournament, player.id) : null),
    [tournament, player],
  );
  const wc = useMemo(
    () => (player ? warmupVsClosing(tournament, player.id) : null),
    [tournament, player],
  );
  const roi = useMemo(
    () => (player ? handicapROI(tournament, player.id) : null),
    [tournament, player],
  );
  const bounceBack = useMemo(
    () => (player ? bounceBackRate(tournament).find(r => r.player.id === player.id) || null : null),
    [tournament, player],
  );
  const frontBack = useMemo(
    () => (player ? frontBackSplit(tournament).find(r => r.player.id === player.id) || null : null),
    [tournament, player],
  );
  if (!player) return null;

  const modeLabel = isStrokes ? t('stats.screen.modeLabel.strokes') : t('stats.screen.modeLabel.points');
  // Same scope-label convention Pairs uses: null reads as "All rounds"
  // instead of silently substituting the first completed round.
  const scopeLabel = (idx) => (idx == null
    ? t('stats.screen.allRounds')
    : `${roundTag(idx)} · ${tournament.rounds[idx]?.courseName ?? ''}`);
  const totalHolesPlayed = history.reduce((sum, r) => sum + r.holesPlayed, 0);

  const defaultTone = (b) => toneForPoints(b.points);

  const holeRows = (holes, toneFn) => holes.map((b, i) => holeRowFromBreakdown(b, i, toneFn(b)));

  const openStreak = (title, holes, toneFn, explainer) => setSheet({
    title,
    subtitle: `${player.name} · ${modeLabel}`,
    explainer,
    rows: holeRows(holes, toneFn),
  });

  const openBucket = (kind, holes) => {
    if (holes.length === 0) return;
    setSheet({
      title: t(`stats.screen.bucket.${kind}`, { name: player.name, count: holes.length }),
      subtitle: modeLabel,
      explainer: t(`stats.screen.bucket.${kind}Explainer`),
      rows: holeRows(holes, defaultTone),
    });
  };

  const wcRange = { start: wc?.range?.warmupStart, end: wc?.range?.warmupEnd, from: wc?.range?.closingStart, to: wc?.range?.closingEnd };
  const openWarmupClosing = () => setSheet({
    title: t('stats.screen.warmup.title', { name: player.name }),
    subtitle: t('stats.screen.warmup.subtitle', { warm: num(wc.warmup.avgPoints), close: num(wc.closing.avgPoints), ...wcRange }),
    explainer: t('stats.screen.warmup.explainer'),
    rows: [
      { key: 'sec-w', section: true, label: t('stats.screen.warmup.label', wcRange) },
      ...wc.warmup.breakdown.map((b, i) => ({
        key: `w-${i}`,
        primary: `${roundTag(b.roundIndex)} · ${b.courseName} · H${b.holeNumber}`,
        secondary: parStrokesLabel(b),
        rightPrimary: ptsLabel(b.points),
        tone: toneForPoints(b.points),
      })),
      { key: 'sec-c', section: true, label: t('stats.screen.warmup.closingLabel', wcRange) },
      ...wc.closing.breakdown.map((b, i) => ({
        key: `c-${i}`,
        primary: `${roundTag(b.roundIndex)} · ${b.courseName} · H${b.holeNumber}`,
        secondary: parStrokesLabel(b),
        rightPrimary: ptsLabel(b.points),
        tone: toneForPoints(b.points),
      })),
    ],
  });

  const openROI = () => roi && setSheet({
    title: t('stats.screen.roi.title', { name: player.name }),
    subtitle: t('stats.screen.roi.subtitle', { actual: num(roi.actual), expected: num(roi.expected), ratio: num(roi.ratio) }),
    explainer: t('stats.screen.roi.explainer'),
    rows: (roi.breakdown || []).map(b => ({
      key: `roi-${b.roundIndex}`,
      primary: `${roundTag(b.roundIndex)} · ${b.courseName}`,
      secondary: t('stats.screen.roi.row', { actual: num(b.actual), expected: num(b.expected), holes: b.holesPlayed }),
      rightPrimary: `×${num(b.ratio)}`,
      tone: b.ratio >= 1 ? 'excellent' : b.ratio >= 0.75 ? 'neutral' : 'poor',
    })),
  });

  const openParSplit = (label, bucket) => bucket.holes > 0 && setSheet({
    title: `${player.name} — ${label}`,
    subtitle: t('stats.screen.parSplit.subtitle', { pts: num(bucket.avgPoints), str: num(bucket.avgStrokes), count: bucket.holes }),
    explainer: t('stats.screen.parSplit.explainer', { label }),
    rows: (bucket.breakdown || []).map((b, i) => ({
      key: `ps-${b.roundIndex}-${b.holeNumber}-${i}`,
      primary: roundHoleLabel(b),
      secondary: t('stats.screen.parSiStrokes', { par: b.par, si: b.si, strokes: b.strokes }),
      rightPrimary: ptsLabel(b.points),
      tone: toneForPoints(b.points),
    })),
  });

  const openDifficulty = (label, bucket) => bucket.holes > 0 && setSheet({
    title: `${player.name} — ${label}`,
    subtitle: t('stats.screen.difficulty.subtitle', { pts: num(bucket.avgPoints), count: bucket.holes }),
    explainer: t('stats.screen.difficulty.explainer', { label }),
    rows: (bucket.breakdown || []).map((b, i) => ({
      key: `df-${b.roundIndex}-${b.holeNumber}-${i}`,
      primary: roundHoleLabel(b),
      secondary: t('stats.screen.parSiStrokes', { par: b.par, si: b.si, strokes: b.strokes }),
      rightPrimary: ptsLabel(b.points),
      tone: toneForPoints(b.points),
    })),
  });

  const openBounceBack = (row) => setSheet({
    title: t('stats.screen.bounce.title', { name: row.player.name }),
    subtitle: t('stats.screen.bounce.subtitle', { done: row.bounceBacks, total: row.opportunities, rate: num(row.rate) }),
    explainer: t('stats.screen.bounce.explainer'),
    rows: row.breakdown.map((b, i) => ({
      key: `bb-${b.roundIndex}-${b.holeNumber}-${i}`,
      primary: roundHoleLabel(b),
      secondary: t('stats.screen.bounce.row', { hole: b.afterHole, over: num(b.afterVsPar), par: b.par, strokes: b.strokes }),
      rightPrimary: b.recovered ? t('stats.screen.bounce.yes') : t('stats.screen.bounce.no'),
      tone: b.recovered ? 'excellent' : 'poor',
    })),
  });

  const openFrontBack = (row) => setSheet({
    title: t('stats.screen.fb.title', { name: row.player.name }),
    subtitle: t('stats.screen.fb.subtitle', { front: num(row.frontAvg), back: num(row.backAvg), delta: sgn(row.delta) }),
    explainer: t('stats.screen.fb.explainer'),
    rows: row.rounds.map(r => ({
      key: `fb-${r.roundIndex}`,
      primary: `${roundTag(r.roundIndex)} · ${r.courseName}`,
      secondary: t('stats.screen.fb.row', { front: num(r.front), back: num(r.back) }),
      rightPrimary: `${sgn(r.delta)}`,
      rightSecondary: t('stats.screen.fb.backMinusFront'),
      tone: r.delta > 0 ? 'excellent' : r.delta < 0 ? 'poor' : 'neutral',
    })),
  });

  const openRound = (r) => {
    const round = tournament.rounds[r.roundIndex];
    const handicap = getPlayingHandicap(round, player);
    const rows = round.holes.map(h => {
      const sc = round.scores?.[player.id]?.[h.number];
      if (!sc) return null;
      const pts = calcStablefordPoints(h.par, sc, handicap, h.strokeIndex, holeCountOf(round));
      return {
        key: `${h.number}`,
        primary: t('stats.screen.hole', { n: h.number }),
        secondary: t('stats.screen.parStrokes', { par: h.par, strokes: sc }),
        rightPrimary: ptsLabel(pts),
        tone: toneForPoints(pts),
      };
    }).filter(Boolean);
    setSheet({
      title: `${roundTag(r.roundIndex)} · ${r.courseName}`,
      subtitle: t('stats.screen.round.subtitle', { name: player.name, points: num(r.points), strokes: r.strokes }),
      explainer: t('stats.screen.round.explainer'),
      rows,
    });
  };

  // history is NOT round-scoped (playerRoundHistory has no roundIndex param)
  // — it's the honest "has this player ever scored anything" check. Gating
  // the whole tab on `dist.total` instead would blank every section
  // (Average, ROI, Round History...) the moment someone picks a round chip
  // for a round this player sat out, even though those sections have real
  // tournament-wide data to show.
  const hasAnyScores = history.length > 0;

  const showWc = wc.warmup.holes > 0 || wc.closing.holes > 0;
  const indexSections = hasAnyScores ? [
    { key: 'avg', label: t('stats.screen.pIndex.avg') },
    { key: 'distribution', label: t('stats.screen.pIndex.distribution') },
    { key: 'streaks', label: t('stats.screen.pIndex.streaks') },
    { key: 'partype', label: t('stats.screen.pIndex.partype') },
    { key: 'difficulty', label: t('stats.screen.pIndex.difficulty') },
    showWc && { key: 'warmup', label: t('stats.screen.pIndex.warmup') },
    roi && { key: 'roi', label: t('stats.screen.pIndex.roi') },
    { key: 'bounceback', label: t('stats.screen.pIndex.bounceback') },
    { key: 'frontback', label: t('stats.screen.pIndex.frontback') },
    { key: 'history', label: t('stats.screen.pIndex.history') },
  ].filter(Boolean) : [];

  return (
    <View>
      <View style={s.playerSelector}>
        {players.map((p, i) => (
          <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
            <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{disambiguatedFirstName(p, players)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!hasAnyScores ? (
        <Text style={s.emptyText}>{t('stats.screen.players.noScores', { name: player.name })}</Text>
      ) : (
        <>
          <SectionIndex sections={indexSections} anchors={anchors} scrollRef={scrollRef} theme={theme} s={s} />

          <SectionAnchor anchorKey="avg" anchors={anchors}>
          <View style={s.card}>
            <Text style={s.cardLabel}>{t('stats.screen.players.avgPerRound')}</Text>
            <Text style={s.bigNumber}>{num(avg)}</Text>
            <Text style={s.cardSub}>{t('stats.screen.players.stablefordPoints')}</Text>
            <Text style={s.cardSub}>{t('stats.screen.dna.row', { count: history.length, holes: totalHolesPlayed })}</Text>
          </View>
          </SectionAnchor>

          <SectionAnchor anchorKey="distribution" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.players.distribution')}</Text>
          <Text style={s.scopeText}>{scopeLabel(roundScope)}</Text>
          {dist.total === 0 ? (
            <Text style={s.mutedNote}>{t('stats.screen.players.noScoresRound', { name: firstName(player) })}</Text>
          ) : (
            <View style={s.card}>
              <View style={s.distRow}>
                <DistBar label={t('stats.data.dist.eagles')} count={dist.eagles} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('eagles', dist.eagleHoles)} s={s} />
                <DistBar label={t('stats.data.dist.birdies')} count={dist.birdies} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('birdies', dist.birdieHoles)} s={s} />
                <DistBar label={t('stats.data.dist.pars')} count={dist.pars} total={dist.total} color={theme.scoreColor('good')} onPress={() => openBucket('pars', dist.parHoles)} s={s} />
                <DistBar label={t('stats.data.dist.bogeys')} count={dist.bogeys} total={dist.total} color={theme.scoreColor('neutral')} onPress={() => openBucket('bogeys', dist.bogeyHoles)} s={s} />
                <DistBar label={t('stats.data.dist.doubles')} count={dist.doubles + dist.worse} total={dist.total} color={theme.scoreColor('poor')} onPress={() => openBucket('doubles', [...dist.doubleHoles, ...dist.worseHoles])} s={s} />
              </View>
            </View>
          )}
          </SectionAnchor>

          <SectionAnchor anchorKey="streaks" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.streak.section')}</Text>
          <Text style={s.scopeText}>{scopeLabel(roundScope)}</Text>
          <View style={s.card}>
            <View style={s.streakRow}>
              {[
                { key: 'birdie', label: t('stats.screen.streak.birdie'), value: streaks.bestBirdieStreak, tone: 'excellent', holes: streaks.birdieStreakHoles, toneFn: () => 'excellent', explainer: t('stats.screen.streak.birdieExplainer') },
                { key: 'par', label: t('stats.screen.streak.par'), value: streaks.bestParStreak, tone: 'good', holes: streaks.parStreakHoles, toneFn: defaultTone, explainer: t('stats.screen.streak.parExplainer') },
                { key: 'bogey', label: t('stats.screen.streak.bogey'), value: streaks.bogeyOnlyStreak, tone: 'neutral', holes: streaks.bogeyOnlyStreakHoles, toneFn: () => 'neutral', explainer: t('stats.screen.streak.bogeyExplainer') },
                { key: 'dbl', label: t('stats.screen.streak.dbl'), value: streaks.doubleBogeyPlusStreak, tone: 'poor', holes: streaks.doubleBogeyPlusStreakHoles, toneFn: () => 'poor', explainer: t('stats.screen.streak.dblExplainer') },
              ].map(st => {
                const zero = st.value === 0;
                return (
                  <TouchableOpacity
                    key={st.key}
                    style={[s.streakItem, zero && s.streakItemDim]}
                    disabled={zero}
                    onPress={() => openStreak(t('stats.screen.streak.title', { label: st.label, count: st.value }), st.holes, st.toneFn, st.explainer)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.streakNumber, { color: zero ? theme.text.muted : theme.scoreColor(st.tone) }]}>{st.value}</Text>
                    <Text style={s.streakLabel}>{st.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          </SectionAnchor>

          <SectionAnchor anchorKey="partype" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.parType.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
          <View style={s.card}>
            <View style={s.parSplitRow}>
              {[
                { key: 'par3', label: t('stats.data.parType.par3'), bucket: parSplit.par3 },
                { key: 'par4', label: t('stats.data.parType.par4'), bucket: parSplit.par4 },
                { key: 'par5', label: t('stats.data.parType.par5'), bucket: parSplit.par5 },
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
                    {bucket.holes === 0 ? '—' : num(bucket.avgPoints)}
                  </Text>
                  <Text style={s.parSplitSub}>{t('stats.screen.nHoles', { count: bucket.holes })}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          </SectionAnchor>

          <SectionAnchor anchorKey="difficulty" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.difficulty.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
          <View style={s.card}>
            <View style={s.parSplitRow}>
              {[
                { key: 'hard', label: t('stats.screen.difficulty.hard'), bucket: difficulty.hard },
                { key: 'mid', label: t('stats.screen.difficulty.mid'), bucket: difficulty.mid },
                { key: 'easy', label: t('stats.screen.difficulty.easy'), bucket: difficulty.easy },
              ].map(({ key, label, bucket }) => (
                <TouchableOpacity
                  key={key}
                  style={s.parSplitCell}
                  onPress={() => openDifficulty(label, bucket)}
                  activeOpacity={0.7}
                  disabled={bucket.holes === 0}
                >
                  <Text style={s.parSplitLabel}>{label}</Text>
                  <Text style={[s.parSplitValue, {
                    color: bucket.holes === 0
                      ? theme.text.muted
                      : theme.scoreColor(bucket.avgPoints >= 2 ? 'good' : bucket.avgPoints >= 1.5 ? 'neutral' : 'poor'),
                  }]}>
                    {bucket.holes === 0 ? '—' : num(bucket.avgPoints)}
                  </Text>
                  <Text style={s.parSplitSub}>{t('stats.screen.nHoles', { count: bucket.holes })}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          </SectionAnchor>

          {showWc && (
            <SectionAnchor anchorKey="warmup" anchors={anchors}>
              <Text style={s.sectionTitle}>{t('stats.screen.warmup.section')}</Text>
              <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
              <TouchableOpacity style={s.card} onPress={openWarmupClosing} activeOpacity={0.7}>
                <View style={s.wcRow}>
                  <View style={s.wcCol}>
                    <Text style={s.wcLabel}>{t('stats.screen.warmup.label', wcRange)}</Text>
                    <Text style={[s.wcValue, { color: theme.scoreColor(wc.warmup.avgPoints >= 2 ? 'good' : 'neutral') }]}>{num(wc.warmup.avgPoints)}</Text>
                    <Text style={s.wcSub}>{t('stats.screen.nHoles', { count: wc.warmup.holes })}</Text>
                  </View>
                  <View style={s.wcCol}>
                    <Text style={s.wcLabel}>{t('stats.screen.warmup.closingLabel', wcRange)}</Text>
                    <Text style={[s.wcValue, { color: theme.scoreColor(wc.closing.avgPoints >= 2 ? 'good' : 'neutral') }]}>{num(wc.closing.avgPoints)}</Text>
                    <Text style={s.wcSub}>{t('stats.screen.nHoles', { count: wc.closing.holes })}</Text>
                  </View>
                  <View style={s.wcCol}>
                    <Text style={s.wcLabel}>Δ</Text>
                    <Text style={[s.wcValue, {
                      color: wc.delta > 0 ? theme.scoreColor('excellent') : wc.delta < 0 ? theme.scoreColor('poor') : theme.text.primary,
                    }]}>
                      {sgnPos(wc.delta)}
                    </Text>
                    <Text style={s.wcSub}>{t('stats.screen.warmup.delta')}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </SectionAnchor>
          )}

          {roi && (
            <SectionAnchor anchorKey="roi" anchors={anchors}>
              <Text style={s.sectionTitle}>{t('stats.screen.roi.section')}</Text>
              <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
              <TouchableOpacity style={s.card} onPress={openROI} activeOpacity={0.7}>
                <View style={s.roiRow}>
                  <View style={s.roiCol}>
                    <Text style={s.roiLabel}>{t('stats.screen.roi.actual')}</Text>
                    <Text style={s.roiValue}>{num(roi.actual)}</Text>
                  </View>
                  <View style={s.roiCol}>
                    <Text style={s.roiLabel}>{t('stats.screen.roi.expected')}</Text>
                    <Text style={s.roiValue}>{num(roi.expected)}</Text>
                  </View>
                  <View style={s.roiCol}>
                    <Text style={s.roiLabel}>{t('stats.screen.roi.ratio')}</Text>
                    <Text style={[s.roiValue, {
                      color: roi.ratio >= 1 ? theme.scoreColor('excellent') : roi.ratio >= 0.75 ? theme.scoreColor('neutral') : theme.scoreColor('poor'),
                    }]}>{num(roi.ratio)}</Text>
                  </View>
                </View>
                <Text style={s.roiSub}>{t('stats.screen.roi.baseline')}</Text>
              </TouchableOpacity>
            </SectionAnchor>
          )}

          <SectionAnchor anchorKey="bounceback" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.bounce.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
          {bounceBack ? (
            <TouchableOpacity style={s.card} onPress={() => openBounceBack(bounceBack)} activeOpacity={0.7}>
              <Text style={s.bigNumber}>{num(bounceBack.rate)}%</Text>
              <Text style={s.cardSub}>
                {t('stats.screen.bounce.cardSub', { done: bounceBack.bounceBacks, total: bounceBack.opportunities })}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.mutedNote}>{t('stats.screen.bounce.empty')}</Text>
          )}
          </SectionAnchor>

          <SectionAnchor anchorKey="frontback" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.fb.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
          {frontBack ? (
            <TouchableOpacity style={s.card} onPress={() => openFrontBack(frontBack)} activeOpacity={0.7}>
              <View style={s.wcRow}>
                <View style={s.wcCol}>
                  <Text style={s.wcLabel}>{t('stats.screen.fb.front')}</Text>
                  <Text style={[s.wcValue, { color: theme.scoreColor(frontBack.frontAvg >= 2 ? 'good' : 'neutral') }]}>{num(frontBack.frontAvg)}</Text>
                  <Text style={s.wcSub}>{t('stats.screen.ptsPerHoleUnit')}</Text>
                </View>
                <View style={s.wcCol}>
                  <Text style={s.wcLabel}>{t('stats.screen.fb.back')}</Text>
                  <Text style={[s.wcValue, { color: theme.scoreColor(frontBack.backAvg >= 2 ? 'good' : 'neutral') }]}>{num(frontBack.backAvg)}</Text>
                  <Text style={s.wcSub}>{t('stats.screen.ptsPerHoleUnit')}</Text>
                </View>
                <View style={s.wcCol}>
                  <Text style={s.wcLabel}>Δ</Text>
                  <Text style={[s.wcValue, {
                    color: frontBack.delta > 0 ? theme.scoreColor('excellent') : frontBack.delta < 0 ? theme.scoreColor('poor') : theme.text.primary,
                  }]}>{sgnPos(frontBack.delta)}</Text>
                  <Text style={s.wcSub}>{t('stats.screen.fb.backMinusFront')}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={s.mutedNote}>{t('stats.screen.fb.empty')}</Text>
          )}
          </SectionAnchor>

          <SectionAnchor anchorKey="history" anchors={anchors}>
          <Text style={s.sectionTitle}>{t('stats.screen.history.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.allRounds')}</Text>
          {history.map((r, i) => {
            const mode = roundScoringMode(tournament, tournament.rounds[r.roundIndex]);
            return (
              <TouchableOpacity key={i} style={s.historyRow} onPress={() => openRound(r)} activeOpacity={0.7}>
                <View style={s.historyMain}>
                  <View style={s.historyTopRow}>
                    <Text style={s.historyRound}>{roundTag(r.roundIndex)}</Text>
                    <Text style={s.historyCourse}>{r.courseName}</Text>
                    <View style={s.historyModeBadge}>
                      <Text style={s.historyModeBadgeText}>{modeBadgeLabel(mode)}</Text>
                    </View>
                  </View>
                  <Text style={s.historySub}>{t('stats.screen.history.sub', { count: r.holesPlayed, avg: num(r.avgPerHole) })}</Text>
                </View>
                <View style={s.historyRight}>
                  <Text style={s.historyPts}>{ptsLabel(r.points)}</Text>
                  <Text style={s.historyStr}>{strLabel(r.strokes)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          </SectionAnchor>
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
function HolesTab({ tournament, completedRounds, hasMulti, metric, effectiveRound, roundScope, theme, s }) {
  const isStrokes = metric === 'strokes';
  // Best/worst honors the screen's round scope directly (null = Total,
  // aggregated across every round) rather than falling back to a single
  // round the way the heatmap does below.
  //
  // bw/nemesisCrushed/chaos/extremes each do a tournament-wide pass. The
  // tab holds local `sheet` state for its detail sheets, so without
  // memoization opening one would re-run every aggregate here. Deps are
  // keyed on exactly the scope vars each function reads — `sheet` must
  // never be a dep. Mirrors ShotsTab's useMemo pattern (~line 2893).
  const bw = useMemo(
    () => bestWorstHoles(tournament, { metric, roundIndex: roundScope }),
    [tournament, metric, roundScope],
  );
  // The heatmap is inherently per-round — it reads the unified screen scope.
  const heatRound = effectiveRound != null ? effectiveRound : 0;
  const heatmap = holeDifficultyMap(tournament, heatRound);
  const nemesisCrushed = useMemo(() => playerNemesisAndCrushed(tournament), [tournament]);
  const chaos = useMemo(() => chaosHoles(tournament), [tournament]);
  const extremes = useMemo(() => collectiveExtremes(tournament), [tournament]);
  const [sheet, setSheet] = useState(null);

  const renderAvg = (h) => isStrokes
    ? t('stats.screen.avgVs', { avg: sgn(h.avgVsPar) })
    : t('stats.screen.hole.avgPts', { avg: num(h.avgPoints) });

  const openHole = (h, label, explainer) => setSheet({
    title: `${roundTag(h.roundIndex)} · ${t('stats.screen.holeCourse', { n: h.holeNumber, course: h.courseName })}`,
    subtitle: `${label} · ${t('stats.screen.parSi', { par: h.par, si: h.si })} · ${renderAvg(h)}`,
    explainer,
    rows: h.playerScores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: t('stats.screen.strokesN', { n: ps.strokes }),
      rightPrimary: isStrokes ? strLabel(ps.strokes) : ptsLabel(ps.points),
      tone: toneForPoints(ps.points),
    })),
  });

  const openNemesis = (row) => setSheet({
    title: t('stats.screen.nemesis.title', { name: row.player.name }),
    subtitle: roundHoleLabel(row.nemesis),
    explainer: t('stats.screen.nemesis.explainer'),
    rows: [{
      key: 'n', primary: t('stats.screen.parSi', { par: row.nemesis.par, si: row.nemesis.si }),
      secondary: t('stats.screen.strokesVsPar', { strokes: row.nemesis.strokes, vs: `+${num(row.nemesis.vsPar)}` }),
      rightPrimary: ptsLabel(row.nemesis.points), tone: 'poor',
    }],
  });

  const openCrushed = (row) => setSheet({
    title: t('stats.screen.crushed.title', { name: row.player.name }),
    subtitle: roundHoleLabel(row.crushed),
    explainer: t('stats.screen.crushed.explainer'),
    rows: [{
      key: 'c', primary: t('stats.screen.parSi', { par: row.crushed.par, si: row.crushed.si }),
      secondary: t('stats.screen.strokesVsPar', { strokes: row.crushed.strokes, vs: sgn(row.crushed.vsPar) }),
      rightPrimary: ptsLabel(row.crushed.points), tone: 'excellent',
    }],
  });

  const openChaos = (hole) => setSheet({
    title: t('stats.screen.chaos.title', { n: hole.holeNumber }),
    subtitle: `${roundTag(hole.roundIndex)} · ${hole.courseName} · ${t('stats.screen.parSi', { par: hole.par, si: hole.si })}`,
    explainer: t('stats.screen.chaos.explainer', { range: hole.range, min: hole.minStrokes, max: hole.maxStrokes }),
    rows: hole.scores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: t('stats.screen.strokesN', { n: ps.strokes }),
      rightPrimary: ptsLabel(ps.points),
      tone: toneForPoints(ps.points),
    })),
  });

  const openCollective = (hole, kind) => setSheet({
    title: t(kind === 'disaster' ? 'stats.screen.collective.disasterTitle' : 'stats.screen.collective.easyTitle', { n: hole.holeNumber }),
    subtitle: `${roundTag(hole.roundIndex)} · ${hole.courseName} · ${t('stats.screen.parSi', { par: hole.par, si: hole.si })}`,
    explainer: kind === 'disaster'
      ? t('stats.screen.collective.disasterExplainer')
      : t('stats.screen.collective.easyExplainer'),
    rows: hole.scores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: t('stats.screen.strokesN', { n: ps.strokes }),
      rightPrimary: ptsLabel(ps.points),
      tone: ps.points === 0 ? 'poor' : toneForPoints(ps.points),
    })),
  });

  return (
    <View>
      {completedRounds.length > 0 && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.heatmap.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.heatmap.scope', { round: heatRound + 1, course: tournament.rounds[heatRound]?.courseName ?? '' })}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={s.heatRow}>
                <Text style={[s.heatCell, s.heatHeader, s.heatHoleCol]}>{t('stats.screen.heatmap.hole')}</Text>
                <Text style={[s.heatCell, s.heatHeader, s.heatSiCol]}>{t('stats.screen.heatmap.si')}</Text>
                {tournament.players.map(p => (
                  <Text key={p.id} style={[s.heatCell, s.heatHeader]}>{firstName(p)}</Text>
                ))}
                <Text style={[s.heatCell, s.heatHeader]}>{t('stats.screen.heatmap.avg')}</Text>
              </View>
              {heatmap.map(h => (
                <View key={h.holeNumber} style={s.heatRow}>
                  <Text style={[s.heatCell, s.heatHoleNum, s.heatHoleCol]}>{h.holeNumber}</Text>
                  <Text style={[s.heatCell, s.heatSiCol, s.heatSi]}>{h.si}</Text>
                  {tournament.players.map(p => {
                    const ps = h.playerScores.find(x => x.playerId === p.id);
                    if (isStrokes) {
                      const strokes = ps?.strokes ?? null;
                      const empty = strokes == null;
                      const vsPar = strokes != null ? strokes - h.par : null;
                      const color = vsPar == null ? theme.text.muted
                        : vsPar < 0 ? theme.scoreColor('excellent')
                        : vsPar === 0 ? theme.scoreColor('good')
                        : vsPar === 1 ? theme.scoreColor('neutral')
                        : theme.scoreColor('poor');
                      return (
                        <View key={p.id} style={[s.heatCell, s.heatValue, empty && s.heatCellEmpty, { backgroundColor: color + (empty ? '08' : '18') }]}>
                          <Text style={[s.heatValueText, { color }]}>{strokes ?? '-'}</Text>
                        </View>
                      );
                    }
                    const pts = ps?.points ?? '-';
                    const empty = pts === '-';
                    const color = pts === '-' ? theme.text.muted
                      : pts >= 3 ? theme.scoreColor('excellent')
                      : pts === 2 ? theme.scoreColor('good')
                      : pts === 1 ? theme.scoreColor('neutral')
                      : theme.scoreColor('poor');
                    return (
                      <View key={p.id} style={[s.heatCell, s.heatValue, empty && s.heatCellEmpty, { backgroundColor: color + (empty ? '08' : '18') }]}>
                        <Text style={[s.heatValueText, { color }]}>{pts}</Text>
                      </View>
                    );
                  })}
                  <View style={[s.heatCell, s.heatValue]}>
                    <Text style={s.heatAvgText}>{isStrokes ? (h.avgStrokes ?? '-') : (h.avgPoints ?? '-')}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      )}

      {bw.best.length > 0 && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.holes.easiestSection')}</Text>
          {bw.best.map((h, i) => (
            <TouchableOpacity key={`b${i}`} style={s.holeCard} onPress={() => openHole(h, t('stats.screen.easiestLabel'), t(isStrokes ? 'stats.screen.holes.easiestExplainerStrokes' : 'stats.screen.holes.easiestExplainerPoints'))} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>{t('stats.screen.holeRowTitle', { round: h.roundIndex + 1, hole: h.holeNumber, par: h.par, si: h.si })}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('excellent') }]}>{renderAvg(h)}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {bw.worst.length > 0 && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.holes.hardestSection')}</Text>
          {bw.worst.map((h, i) => (
            <TouchableOpacity key={`w${i}`} style={s.holeCard} onPress={() => openHole(h, t('stats.screen.hardestLabel'), t(isStrokes ? 'stats.screen.holes.hardestExplainerStrokes' : 'stats.screen.holes.hardestExplainerPoints'))} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>{t('stats.screen.holeRowTitle', { round: h.roundIndex + 1, hole: h.holeNumber, par: h.par, si: h.si })}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('poor') }]}>{renderAvg(h)}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {nemesisCrushed.length > 0 && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.nc.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.nc.desc')}</Text>
          {nemesisCrushed.map(row => (
            <View key={row.player.id} style={s.ncRow}>
              <Text style={s.ncName}>{firstName(row.player)}</Text>
              <TouchableOpacity style={s.ncCell} onPress={() => openNemesis(row)} activeOpacity={0.7}>
                <Text style={[s.ncLabel, { color: theme.scoreColor('poor') }]}>{t('stats.screen.nc.nemesis')}</Text>
                <Text style={s.ncValue}>H{row.nemesis.holeNumber} · {ptsLabel(row.nemesis.points)}</Text>
                <Text style={s.ncSub}>{row.nemesis.courseName}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ncCell} onPress={() => openCrushed(row)} activeOpacity={0.7}>
                <Text style={[s.ncLabel, { color: theme.scoreColor('excellent') }]}>{t('stats.screen.nc.crushed')}</Text>
                <Text style={s.ncValue}>H{row.crushed.holeNumber} · {ptsLabel(row.crushed.points)}</Text>
                <Text style={s.ncSub}>{row.crushed.courseName}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {hasMulti && chaos.length > 0 && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.chaos.section')}</Text>
          <Text style={s.scopeText}>{t('stats.screen.chaos.desc')}</Text>
          {chaos.map((hole, i) => (
            <TouchableOpacity key={`c${i}`} style={s.holeCard} onPress={() => openChaos(hole)} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('neutral') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('neutral') }]}>Δ{hole.range}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>{t('stats.screen.holeRowTitle', { round: hole.roundIndex + 1, hole: hole.holeNumber, par: hole.par, si: hole.si })}</Text>
                <Text style={s.holeCourse}>{t('stats.screen.chaos.row', { course: hole.courseName, min: hole.minStrokes, max: hole.maxStrokes })}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {hasMulti && (extremes.disasters.length > 0 || extremes.gimmes.length > 0) && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.collective.section')}</Text>
          {extremes.disasters.length > 0 && (
            <>
              <Text style={s.scopeText}>{t('stats.screen.collective.disasterDesc')}</Text>
              {extremes.disasters.map((hole, i) => (
                <TouchableOpacity key={`d${i}`} style={s.holeCard} onPress={() => openCollective(hole, 'disaster')} activeOpacity={0.7}>
                  <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                    <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>🫠</Text>
                  </View>
                  <View style={s.holeInfo}>
                    <Text style={s.holeName}>{t('stats.screen.holeRowTitle', { round: hole.roundIndex + 1, hole: hole.holeNumber, par: hole.par, si: hole.si })}</Text>
                    <Text style={s.holeCourse}>{hole.courseName}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
          {extremes.gimmes.length > 0 && (
            <>
              <Text style={s.scopeText}>{t('stats.screen.collective.easyDesc')}</Text>
              {extremes.gimmes.map((hole, i) => (
                <TouchableOpacity key={`g${i}`} style={s.holeCard} onPress={() => openCollective(hole, 'gimme')} activeOpacity={0.7}>
                  <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                    <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>🧁</Text>
                  </View>
                  <View style={s.holeInfo}>
                    <Text style={s.holeName}>{t('stats.screen.holeRowTitle', { round: hole.roundIndex + 1, hole: hole.holeNumber, par: hole.par, si: hole.si })}</Text>
                    <Text style={s.holeCourse}>{hole.courseName}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </>
      )}

      {bw.best.length === 0 && <Text style={s.emptyText}>{t('stats.screen.holes.noScores')}</Text>}

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
function PairsTab({ tournament, players, h2hP1, setH2hP1, h2hP2, setH2hP2, selectedPlayer, setSelectedPlayer, metric, effectiveRound, roundScope, scrollRef, theme, s }) {
  // `tournament` here is already the screen-level statsTournament (scramble
  // rounds' scores/shotDetails/pairs blanked — see withoutScrambleScores).
  // The Pairs tab is visible whenever ANY round has real team data
  // (anyTeams at the screen level), but a mixed tournament can still hold
  // scramble rounds and solo-mode rounds alongside genuine team rounds.
  // Every pair aggregate below keys its output by array position
  // (roundIndex / R{n} labels), so we can't just filter tournament.rounds
  // down to the eligible ones — that would shift every later round's index.
  // Instead we keep the array the same length and strip `pairs` from any
  // round whose effective mode isn't a non-scramble team mode; every
  // consumer here already treats a missing `round.pairs` as "skip this
  // round" (see pairPerformance/pairHoleWins/pairSynergy/pairCarryRatio/
  // matchPlayResults/pairConfigMatrix — each guards on `!round.pairs`).
  // Without this, pairPerformance in particular would misattribute a
  // scramble captain's real score as a "pair" result with their teammate,
  // since roundTotals() reports an unscored teammate as 0 points rather
  // than skipping them. (Scramble rounds already have `pairs: null` from
  // withoutScrambleScores; this additionally strips non-scramble rounds
  // that simply aren't a team mode, e.g. a solo round in a mixed tournament.)
  const pairsTournament = useMemo(() => ({
    ...tournament,
    rounds: (tournament.rounds ?? []).map((r) => {
      const mode = roundScoringMode(tournament, r);
      const isTeamRound = scoringModeUsesTeams(mode, players.length) && !isScrambleMode(mode);
      return isTeamRound ? r : { ...r, pairs: null };
    }),
  }), [tournament, players.length]);

  const pairs = pairPerformance(pairsTournament);
  const splitsPlayer = players[selectedPlayer] ?? null;
  const splits = splitsPlayer
    ? playerPartnerSplits(pairsTournament, splitsPlayer.id)
    : { baseline: 0, partners: [] };
  // Hole-wins and H2H read the raw round scope — both aggregates already
  // support a null roundIndex as "whole tournament", so "Total" means what
  // it says instead of silently substituting the first completed round. The
  // per-hole pair difference chart IS inherently per-round (it's a single
  // round's hole-by-hole chart), so that one still falls back to
  // effectiveRound.
  const holeWins = pairHoleWins(pairsTournament, { metric, roundIndex: roundScope });
  const firstCompletedRound = tournament.rounds.findIndex(r => r.scores && Object.keys(r.scores).length > 0);
  const pdRound = effectiveRound != null ? effectiveRound : (firstCompletedRound >= 0 ? firstCompletedRound : null);
  // Label for sections that now read the raw (nullable) scope, so "Total"
  // reads as "All rounds" instead of silently showing one round's data.
  const scopeLabel = (idx) => (idx == null
    ? t('stats.screen.allRounds')
    : `${roundTag(idx)} · ${tournament.rounds[idx]?.courseName ?? ''}`);
  const pdData = pdRound != null ? pairDifferenceByHole(pairsTournament, pdRound, { metric }) : null;
  // Lead changes / biggest lead / final margin — a one-line "drama strip"
  // under the Pair Difference chart, built entirely from fields
  // pairDifferenceByHole already computes. maxLead is the largest cumulative
  // gap in pair1's favor (>=0), maxDeficit the largest in pair2's favor
  // (<=0) — whichever has the bigger magnitude is the "biggest lead".
  const dramaStrip = pdData ? (() => {
    const pair1Label = pdData.pair1.map(firstName).join(andSep());
    const pair2Label = pdData.pair2.map(firstName).join(andSep());
    const leadMagnitude = Math.max(Math.abs(pdData.maxLead), Math.abs(pdData.maxDeficit));
    const leader = Math.abs(pdData.maxLead) >= Math.abs(pdData.maxDeficit) ? pair1Label : pair2Label;
    return t(metric === 'strokes' ? 'stats.screen.pairs.dramaStrokes' : 'stats.screen.pairs.dramaPoints', {
      changes: pdData.crossovers, leader, lead: num(leadMagnitude), final: sgn(pdData.finalDelta),
    });
  })() : null;
  const synergy = pairSynergy(pairsTournament);
  const carry = pairCarryRatio(pairsTournament);
  const coverage = pairCoverage(pairsTournament);
  const swing = pdRound != null ? swingHole(pairsTournament, pdRound) : null;
  const matchPlay = matchPlayResults(pairsTournament, { metric });
  const configMatrix = pairConfigMatrix(pairsTournament);
  // Pair Chemistry / Pair Synergy / Carry Ratio used to be three separate
  // section lists fragmenting the same pairing. pairPerformance is the
  // primary list (avg pts + rounds); pairSynergy and pairCarryRatio don't
  // necessarily key their pairs in the same order or use the same key
  // separator, so match identity by sorted member ids rather than trusting
  // either function's own key. Task 18 adds a coverage line to these cards —
  // keep this shape easy to extend with another badge/row.
  const pairCardKey = (ids) => [...ids].sort().join('|');
  const synergyByPairKey = {};
  synergy.forEach(p => { synergyByPairKey[pairCardKey(p.members.map(m => m.id))] = p; });
  const carryByPairKey = {};
  carry.forEach(p => { carryByPairKey[pairCardKey(p.members.map(m => m.id))] = p; });
  const coverageByPairKey = {};
  coverage.forEach(p => { coverageByPairKey[pairCardKey(p.pair.map(m => m.id))] = p; });
  const pairCards = pairs.map(p => {
    const key = pairCardKey(p.players.map(pl => pl.id));
    return {
      key,
      players: p.players,
      avgPoints: p.avgPoints,
      rounds: p.rounds,
      roundList: p.roundList,
      synergy: synergyByPairKey[key] || null,
      carry: carryByPairKey[key] || null,
      coverage: coverageByPairKey[key] || null,
    };
  });
  const p1 = players[h2hP1];
  const p2Idx = h2hP2 >= players.length ? 0 : h2hP2;
  const p2 = players[p2Idx];
  // headToHead doesn't read round.pairs, so pairsTournament (pairs stripped)
  // is the wrong input for it — but `tournament` is already scramble-score
  // blanked at the screen level, which is exactly what it needs.
  const h2h = p1 && p2 && p1.id !== p2.id ? headToHead(tournament, p1.id, p2.id, { roundIndex: roundScope }) : null;
  const anchors = useRef({});

  const [sheet, setSheet] = useState(null);

  const openPairCard = (card) => {
    const synergyRoundByIndex = {};
    (card.synergy?.roundList || []).forEach(r => { synergyRoundByIndex[r.roundIndex] = r; });
    const roundRows = card.roundList.map(r => {
      const syn = synergyRoundByIndex[r.roundIndex];
      return {
        key: `r${r.roundIndex}`,
        primary: `${roundTag(r.roundIndex)} · ${r.courseName}`,
        secondary: r.memberPoints.map(m => `${firstName({ name: m.playerName })} ${m.points}`).join(' · '),
        rightPrimary: ptsLabel(r.combinedPoints),
        rightSecondary: syn?.synergy != null ? t('stats.screen.pairs.synergyX', { n: num(syn.synergy) }) : t('stats.screen.strokesN', { n: r.combinedStrokes }),
      };
    });
    const carryRows = card.carry ? [
      { key: 'sec-carry', section: true, label: t('stats.screen.pairs.carrySplit') },
      ...card.carry.shares.map(sh => ({
        key: `carry-${sh.player.id}`,
        primary: sh.player.name,
        secondary: ptsLabel(sh.points),
        rightPrimary: `${Math.round(sh.share * 100)}%`,
        tone: sh.share >= 0.55 ? 'excellent' : sh.share >= 0.45 ? 'good' : 'poor',
      })),
    ] : [];
    setSheet({
      title: t('stats.screen.join.two', { a: card.players[0].name, b: card.players[1].name }),
      subtitle: t(card.synergy ? 'stats.screen.pairs.cardSubtitleSynergy' : 'stats.screen.pairs.cardSubtitle', {
        avg: num(card.avgPoints), count: card.rounds, syn: card.synergy ? num(card.synergy.synergy) : '',
      }),
      explainer: t('stats.screen.pairs.cardExplainer'),
      rows: [...roundRows, ...carryRows],
    });
  };

  const openHoleWinsInfo = () => setSheet({
    title: t('stats.screen.holeWinsInfo.title'),
    subtitle: t('stats.screen.holeWinsInfo.subtitle'),
    explainer: t(metric === 'strokes' ? 'stats.screen.holeWinsInfo.explainerStrokes' : 'stats.screen.holeWinsInfo.explainerPoints'),
    rows: [],
  });

  const openPairDiffInfo = () => setSheet({
    title: t('stats.screen.pairDiffInfo.title'),
    subtitle: t('stats.screen.pairDiffInfo.subtitle'),
    explainer: t(metric === 'strokes' ? 'stats.screen.pairDiffInfo.explainerStrokes' : 'stats.screen.pairDiffInfo.explainerPoints'),
    rows: [],
  });

  const openHoleWins = (row, metricMode) => {
    setSheet({
      title: t('stats.screen.holeWins.title', { name: row.player.name }),
      subtitle: t('stats.data.holeWins.subtitle', { total: `${row.total.W}·${row.total.T}·${row.total.L}`, best: `${row.best.W}·${row.best.T}·${row.best.L}`, worst: `${row.worst.W}·${row.worst.T}·${row.worst.L}` }),
      explainer: t(metricMode === 'strokes' ? 'stats.screen.holeWins.explainerStrokes' : 'stats.screen.holeWins.explainerPoints'),
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
          primary: roundHoleLabel(b),
          secondary: t(metricMode === 'strokes' ? 'stats.screen.holeWins.rowStrokes' : 'stats.screen.holeWins.rowPoints', { par: b.par, v: b.playerValue, tb: b.teamBest, tw: b.teamWorst, ob: b.oppBest, ow: b.oppWorst }),
          rightPrimary: roleParts.join(' · '),
          tone,
        };
      }),
    });
  };

  const openMatchPlay = (round) => {
    if (!round.available) return;
    const p1Label = round.pair1.map(p => firstName(p)).join(andSep());
    const p2Label = round.pair2.map(p => firstName(p)).join(andSep());
    const winner = round.winnerPair ? round.winnerPair.map(p => firstName(p)).join(andSep()) : t('stats.screen.matchPlay.halved');
    setSheet({
      title: `${roundTag(round.roundIndex)} · ${p1Label} vs ${p2Label}`,
      subtitle: t('stats.screen.matchPlay.subtitle', { scoreline: scorelineText(round), winner }),
      explainer: t(`stats.screen.matchPlay.explainer${metric === 'strokes' ? 'Strokes' : 'Points'}${round.closedAt ? 'Closed' : ''}`, { hole: round.closedAt }),
      rows: round.holes.map((h, i) => ({
        key: `${i}`,
        primary: t('stats.screen.hole', { n: h.holeNumber }),
        secondary: `${p1Label} ${h.pair1Score ?? '—'} · ${p2Label} ${h.pair2Score ?? '—'}`,
        rightPrimary: h.winner === 'pair1' ? p1Label : h.winner === 'pair2' ? p2Label : h.winner == null ? '—' : t('stats.screen.matchPlay.halve'),
        rightSecondary: `${h.pair1UpAfter > 0 ? p1Label + ' +' + h.pair1UpAfter : h.pair1UpAfter < 0 ? p2Label + ' +' + Math.abs(h.pair1UpAfter) : 'AS'}`,
        tone: h.winner === 'pair1' ? 'excellent' : h.winner === 'pair2' ? 'good' : 'neutral',
      })),
    });
  };

  const openConfig = (cfg) => {
    const sideALabel = cfg.sideA.map(p => firstName(p)).join(andSep());
    const sideBLabel = cfg.sideB.map(p => firstName(p)).join(andSep());
    setSheet({
      title: `${sideALabel} vs ${sideBLabel}`,
      subtitle: t('stats.screen.config.subtitle', { a: cfg.holeWins.A, t: cfg.holeWins.T, b: cfg.holeWins.B, pa: num(cfg.pointsA), pb: num(cfg.pointsB) }),
      explainer: t('stats.screen.config.explainer'),
      rows: cfg.rounds.map(r => ({
        key: `r${r.roundIndex}`,
        primary: `${roundTag(r.roundIndex)} · ${r.courseName}`,
        secondary: t('stats.screen.config.row', { a: r.wins.A, t: r.wins.T, b: r.wins.B }),
        rightPrimary: `${r.points.A} / ${r.points.B}`,
        tone: r.points.A > r.points.B ? 'excellent' : r.points.A < r.points.B ? 'poor' : 'neutral',
      })),
    });
  };

  const openSwing = () => swing && setSheet({
    title: t('stats.screen.swing.title', { n: swing.holeNumber }),
    subtitle: `${swing.courseName} · Par ${swing.par}`,
    explainer: t('stats.screen.swing.explainer', {
      names: swing.holeDelta > 0 ? swing.pair1.map(p=>firstName(p)).join('+') : swing.pair2.map(p=>firstName(p)).join('+'),
      delta: Math.abs(swing.holeDelta),
    }),
    rows: [
      { key: 'p1', primary: swing.pair1.map(p => p.name).join(andSep()), secondary: t('stats.screen.swing.combined', { n: swing.pair1Total }), rightPrimary: swing.holeDelta > 0 ? t('stats.screen.swing.plus') : swing.holeDelta < 0 ? '—' : t('stats.screen.swing.even'), tone: swing.holeDelta > 0 ? 'excellent' : 'neutral' },
      { key: 'p2', primary: swing.pair2.map(p => p.name).join(andSep()), secondary: t('stats.screen.swing.combined', { n: swing.pair2Total }), rightPrimary: swing.holeDelta < 0 ? t('stats.screen.swing.plus') : swing.holeDelta > 0 ? '—' : t('stats.screen.swing.even'), tone: swing.holeDelta < 0 ? 'excellent' : 'neutral' },
    ],
  });

  const openPairDiffHole = (holeEntry) => {
    if (!pdData) return;
    const isStr = metric === 'strokes';
    const pair1Label = pdData.pair1.map(p => firstName(p)).join(andSep());
    const pair2Label = pdData.pair2.map(p => firstName(p)).join(andSep());
    const cum = holeEntry.cumulative;
    const leader = cum > 0 ? pair1Label : cum < 0 ? pair2Label : '';
    const leadText = cum === 0
      ? t('stats.screen.pairDiffHole.level')
      : t(isStr ? 'stats.screen.pairDiffHole.leadStrokes' : 'stats.screen.pairDiffHole.leadPoints', { leader, n: num(Math.abs(cum)) });
    const holeSplit = holeEntry.pair1Total != null
      ? `${pair1Label} ${holeEntry.pair1Total} · ${pair2Label} ${holeEntry.pair2Total}`
      : t('stats.screen.pairDiffHole.notPlayed');
    const holeDeltaLabel = holeEntry.holeDelta == null
      ? '—'
      : holeEntry.holeDelta === 0
        ? t('stats.screen.pairDiffHole.even')
        : holeEntry.holeDelta > 0
          ? `${pair1Label} +${holeEntry.holeDelta}`
          : `${pair2Label} +${Math.abs(holeEntry.holeDelta)}`;
    // Per-player breakdown for this hole so the sheet is not a dead end.
    const round = tournament.rounds[pdRound];
    const memberRows = [];
    const addPairRows = (pair, pairLabel) => {
      memberRows.push({ key: `sec-${pairLabel}`, section: true, label: pairLabel });
      pair.forEach(member => {
        const player = tournament.players.find(p => p.id === member.id);
        if (!player || !round) return;
        const sc = round.scores?.[player.id]?.[holeEntry.holeNumber];
        const hole = round.holes.find(h => h.number === holeEntry.holeNumber);
        if (sc == null || !hole) {
          memberRows.push({ key: `${pairLabel}-${player.id}`, primary: player.name, secondary: t('stats.screen.pairDiffHole.noScore'), rightPrimary: '—' });
          return;
        }
        const pts = calcStablefordPoints(hole.par, sc, getPlayingHandicap(round, player), hole.strokeIndex, holeCountOf(round));
        memberRows.push({
          key: `${pairLabel}-${player.id}`,
          primary: player.name,
          secondary: t('stats.screen.strokesN', { n: sc }),
          rightPrimary: isStr ? strLabel(sc) : ptsLabel(pts),
          tone: toneForPoints(pts),
        });
      });
    };
    addPairRows(pdData.pair1, pair1Label);
    addPairRows(pdData.pair2, pair2Label);
    setSheet({
      title: t('stats.screen.pairDiffHole.title', { n: holeEntry.holeNumber }),
      subtitle: t(isStr ? 'stats.screen.pairDiffHole.subtitleStrokes' : 'stats.screen.pairDiffHole.subtitlePoints', { course: pdData.courseName, par: holeEntry.par }),
      explainer: t('stats.screen.pairDiffHole.explainer', { lead: leadText, result: holeDeltaLabel, totals: holeSplit }),
      rows: memberRows,
    });
  };

  const openH2H = (metricMode) => {
    if (!h2h) return;
    const isStr = metricMode === 'strokes';
    const bucket = isStr ? h2h.strokes : h2h.points;
    setSheet({
      title: t(isStr ? 'stats.screen.h2h.titleStrokes' : 'stats.screen.h2h.titlePoints', { a: firstName(p1), b: firstName(p2) }),
      subtitle: t('stats.screen.h2h.subtitle', { a: firstName(p1), aw: bucket.p1Wins, b: firstName(p2), bw: bucket.p2Wins, ties: bucket.ties }),
      explainer: isStr
        ? t('stats.screen.h2h.explainerStrokes')
        : t('stats.screen.h2h.explainerPoints'),
      rows: h2h.holes.map((h, i) => {
        const v1 = isStr ? h.p1Strokes : h.p1Points;
        const v2 = isStr ? h.p2Strokes : h.p2Points;
        const p1Won = isStr ? v1 < v2 : v1 > v2;
        const p2Won = isStr ? v2 < v1 : v2 > v1;
        const winner = p1Won ? firstName(p1) : p2Won ? firstName(p2) : t('stats.screen.tie');
        const tone = v1 === v2 ? 'neutral' : 'good';
        return {
          key: `${h.roundIndex}-${h.courseName}-${h.holeNumber}-${i}`,
          primary: roundHoleLabel(h),
          secondary: `${firstName(p1)} ${v1} · ${firstName(p2)} ${v2}`,
          rightPrimary: winner,
          tone,
        };
      }),
    });
  };

  const hasPairRounds = tournament.rounds.some(r => r.pairs && r.scores && Object.keys(r.scores).length > 0);
  const indexSections = [
    { key: 'paircards', label: t('stats.screen.prIndex.paircards') },
    splitsPlayer && { key: 'splits', label: t('stats.screen.prIndex.splits') },
    { key: 'holewins', label: t('stats.screen.prIndex.holewins') },
    { key: 'pairdiff', label: t('stats.screen.prIndex.pairdiff') },
    { key: 'matchplay', label: t('stats.screen.prIndex.matchplay') },
    { key: 'config', label: t('stats.screen.prIndex.config') },
    { key: 'h2h', label: t('stats.screen.index.h2h') },
  ].filter(Boolean);

  return (
    <View>
      <SectionIndex sections={indexSections} anchors={anchors} scrollRef={scrollRef} theme={theme} s={s} />

      <SectionAnchor anchorKey="paircards" anchors={anchors}>
        <Text style={s.sectionTitle}>{t('stats.screen.pairs.section')}</Text>
        <Text style={s.scopeText}>{scopeLabel(null)}</Text>
        {pairCards.length > 0 ? (
          pairCards.map((card) => {
            const synergyValue = card.synergy?.synergy ?? null;
            const synergyTone = synergyValue == null ? null
              : synergyValue >= 1.05 ? 'excellent' : synergyValue >= 0.95 ? 'good' : 'poor';
            const shareA = card.carry ? Math.round(card.carry.shares[0].share * 100) : null;
            // Fix the 101% width bug: derive the second share from the
            // first instead of independently rounding both — two shares
            // that each round up (e.g. 56.5% and 43.5%) used to sum to 101%.
            const shareB = shareA != null ? 100 - shareA : null;
            return (
              <TouchableOpacity
                key={card.key}
                testID={`pair-card-${card.key}`}
                style={s.pairCard}
                onPress={() => openPairCard(card)}
                activeOpacity={0.7}
              >
                <View style={s.pairNames}>
                  <Text style={s.pairName}>{card.players[0].name}</Text>
                  <Text style={s.pairAmp}>&</Text>
                  <Text style={s.pairName}>{card.players[1].name}</Text>
                  {synergyValue != null && (
                    <View style={[s.synergyBadge, { backgroundColor: theme.scoreColor(synergyTone) + '20' }]}>
                      <Text style={[s.synergyBadgeText, { color: theme.scoreColor(synergyTone) }]}>×{num(synergyValue)}</Text>
                    </View>
                  )}
                </View>
                <View style={s.pairStats}>
                  <Text style={s.pairAvg}>{t('stats.screen.hole.avgPts', { avg: num(card.avgPoints) })}</Text>
                  <Text style={s.pairRounds}>{t('stats.screen.pairs.rounds', { count: card.rounds })}</Text>
                </View>
                {card.coverage && (
                  <Text style={s.pairCoverageLine} testID={`pair-coverage-${card.key}`}>
                    {t('stats.screen.pairs.coverage', { pct: num(card.coverage.coveragePct), count: card.coverage.bothBlanked })}
                  </Text>
                )}
                {shareA != null && (
                  <>
                    <View style={s.carryBar}>
                      <View testID={`pair-carry-fill-a-${card.key}`} style={[s.carryFill, {
                        width: `${shareA}%`,
                        backgroundColor: theme.pairA,
                      }]} />
                      <View testID={`pair-carry-fill-b-${card.key}`} style={[s.carryFill, {
                        width: `${shareB}%`,
                        backgroundColor: theme.pairB,
                      }]} />
                    </View>
                    <View style={s.carryLabels}>
                      <Text style={s.carryName}>{firstName(card.carry.shares[0].player)} {shareA}%</Text>
                      <Text style={s.carryName}>{shareB}% {firstName(card.carry.shares[1].player)}</Text>
                    </View>
                  </>
                )}
              </TouchableOpacity>
            );
          })
        ) : (
          <Text style={s.mutedNote}>{t('stats.screen.pairs.empty')}</Text>
        )}
      </SectionAnchor>

      {splitsPlayer && (
        <SectionAnchor anchorKey="splits" anchors={anchors}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionTitle}>{t('stats.screen.splits.section', { name: firstName(splitsPlayer) })}</Text>
            <Text style={s.scopeText}>{t('stats.screen.splits.baseline', { n: num(splits.baseline) })}</Text>
          </View>
          <View style={s.splitsChipRow}>
            {players.map((p, i) => (
              <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
                <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {splits.partners.length === 0 ? (
            <Text style={s.emptyText}>{t('stats.screen.splits.empty', { name: firstName(splitsPlayer) })}</Text>
          ) : (
            <View style={s.splitsTable}>
              <View style={s.splitsHeader}>
                <Text style={[s.splitsHeaderText, { flex: 1 }]}>{t('stats.screen.splits.partner')}</Text>
                <Text style={[s.splitsHeaderText, { width: 36, textAlign: 'right' }]}>{t('stats.screen.splits.roundShort')}</Text>
                <Text style={[s.splitsHeaderText, { width: 64, textAlign: 'right' }]}>{t('stats.screen.heatmap.avg')}</Text>
                <Text style={[s.splitsHeaderText, { width: 56, textAlign: 'right' }]}>{t('stats.screen.splits.deltaBase')}</Text>
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
                      title: t('stats.screen.splits.sheetTitle', { a: splitsPlayer.name, b: row.partner.name }),
                      subtitle: t('stats.screen.splits.sheetSubtitle', { avg: num(row.avgPlayerPoints), count: row.rounds, base: num(splits.baseline) }),
                      explainer: t('stats.screen.splits.sheetExplainer', { a: splitsPlayer.name, b: row.partner.name, base: num(splits.baseline), fa: firstName(splitsPlayer), fb: firstName(row.partner) }),
                      rows: row.perRoundPoints.map((pts, i) => ({
                        key: `${row.partner.id}-${i}`,
                        primary: `${roundTag(row.roundIndices[i])}`,
                        rightPrimary: ptsLabel(pts),
                      })),
                    })}
                  >
                    <Text style={[s.splitsCell, { flex: 1, color: theme.text.primary, fontFamily: 'PlusJakartaSans-Medium' }]}>{row.partner.name}</Text>
                    <Text style={[s.splitsCell, { width: 36, textAlign: 'right', color: theme.text.muted }]}>{row.rounds}</Text>
                    <Text style={[s.splitsCell, { width: 64, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary }]}>{num(row.avgPlayerPoints)}</Text>
                    <Text style={[s.splitsCell, { width: 56, textAlign: 'right', fontFamily: 'PlusJakartaSans-ExtraBold', color: deltaColor }]}>
                      {sgn(row.delta)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </SectionAnchor>
      )}

      <SectionAnchor anchorKey="holewins" anchors={anchors}>
        <View style={s.sectionTitleRow}>
          <Text style={s.sectionTitle}>{t(metric === 'strokes' ? 'stats.screen.holeWins.sectionStrokes' : 'stats.screen.holeWins.sectionPoints')}</Text>
          <TouchableOpacity
            onPress={openHoleWinsInfo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={s.sectionTitleInfo}
          >
            <Feather name="info" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
        <Text style={s.scopeText}>{scopeLabel(roundScope)}</Text>
        {hasPairRounds ? (
          <HoleWinsTable rows={holeWins} metricMode={metric} openRow={openHoleWins} theme={theme} s={s} />
        ) : (
          <Text style={s.mutedNote}>{t('stats.screen.holeWins.empty')}</Text>
        )}
      </SectionAnchor>

      <SectionAnchor anchorKey="pairdiff" anchors={anchors}>
        <View style={s.sectionTitleRow}>
          <Text style={s.sectionTitle}>{t(metric === 'strokes' ? 'stats.screen.pairDiff.sectionStrokes' : 'stats.screen.pairDiff.sectionPoints')}</Text>
          <TouchableOpacity
            onPress={openPairDiffInfo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={s.sectionTitleInfo}
          >
            <Feather name="info" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
        {firstCompletedRound >= 0 && hasPairRounds && pdRound != null ? (
          <>
            <Text style={s.scopeText}>{t('stats.screen.heatmap.scope', { round: pdRound + 1, course: tournament.rounds[pdRound]?.courseName ?? '' })}</Text>
            {pdData ? (
              <>
                <PairDifferenceChart data={pdData} metric={metric} onHolePress={openPairDiffHole} theme={theme} s={s} />
                <Text style={s.dramaStrip}>{dramaStrip}</Text>
              </>
            ) : (
              <Text style={s.mutedNote}>{t('stats.screen.pairDiff.noPairs')}</Text>
            )}
            {swing && (
              <TouchableOpacity style={s.swingCard} onPress={openSwing} activeOpacity={0.7}>
                <View>
                  <Text style={s.swingLabel}>{t('stats.screen.swing.label')}</Text>
                  <Text style={s.swingValue}>
                    {t('stats.screen.swing.value', {
                      n: swing.holeNumber,
                      who: swing.holeDelta > 0 ? firstName(swing.pair1[0]) + '+' + firstName(swing.pair1[1]) : swing.holeDelta < 0 ? firstName(swing.pair2[0]) + '+' + firstName(swing.pair2[1]) : t('stats.screen.swing.even'),
                      delta: swing.holeDelta !== 0 ? `+${ptsLabel(Math.abs(swing.holeDelta))}` : '',
                    })}
                  </Text>
                  <Text style={s.swingSub}>{t('stats.screen.swing.sub', { par: swing.par, delta: sgnPos(swing.cumulativeAfter) })}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            )}
          </>
        ) : (
          <Text style={s.mutedNote}>{t('stats.screen.pairDiff.empty')}</Text>
        )}
      </SectionAnchor>

      <SectionAnchor anchorKey="matchplay" anchors={anchors}>
        <Text style={s.sectionTitle}>{t('stats.screen.matchPlay.section')}</Text>
        {matchPlay.some(r => r.available) ? (
          <>
          <Text style={s.scopeText}>{scopeLabel(null)}</Text>
          <Text style={s.scopeText}>{t('stats.screen.matchPlay.desc')}</Text>
          {matchPlay.filter(r => r.available).map(round => {
            const p1Label = round.pair1.map(p => firstName(p)).join(' + ');
            const p2Label = round.pair2.map(p => firstName(p)).join(' + ');
            const isTie = round.finalPair1Up === 0;
            const p1Won = round.finalPair1Up > 0;
            return (
              <TouchableOpacity key={round.roundIndex} style={s.matchCard} onPress={() => openMatchPlay(round)} activeOpacity={0.7}>
                <View style={s.matchHeader}>
                  <Text style={s.matchRound}>{roundTag(round.roundIndex)}</Text>
                  <Text style={s.matchCourse}>{round.courseName}</Text>
                  <Text style={[s.matchScoreline, {
                    color: isTie ? theme.text.muted : theme.scoreColor('excellent'),
                  }]}>{scorelineText(round)}</Text>
                </View>
                <View style={s.matchTeams}>
                  <Text style={[s.matchTeam, {
                    color: p1Won ? theme.scoreColor('excellent') : isTie ? theme.text.primary : theme.text.muted,
                    fontFamily: p1Won ? 'PlusJakartaSans-ExtraBold' : 'PlusJakartaSans-SemiBold',
                  }]}>{p1Label}</Text>
                  <Text style={s.matchVs}>{t('shared.teams.vs')}</Text>
                  <Text style={[s.matchTeam, {
                    color: !p1Won && !isTie ? theme.scoreColor('excellent') : isTie ? theme.text.primary : theme.text.muted,
                    fontFamily: !p1Won && !isTie ? 'PlusJakartaSans-ExtraBold' : 'PlusJakartaSans-SemiBold',
                  }]}>{p2Label}</Text>
                </View>
                {round.closedAt && (
                  <Text style={s.matchSub}>{t('stats.screen.matchPlay.closedAt', { hole: round.closedAt })}</Text>
                )}
              </TouchableOpacity>
            );
          })}
          </>
        ) : (
          <Text style={s.mutedNote}>{t('stats.screen.matchPlay.empty')}</Text>
        )}
      </SectionAnchor>

      <SectionAnchor anchorKey="config" anchors={anchors}>
        <Text style={s.sectionTitle}>{t('stats.screen.config.section')}</Text>
        {configMatrix.length > 0 ? (
          <>
          <Text style={s.scopeText}>{scopeLabel(null)}</Text>
          <Text style={s.scopeText}>{t('stats.screen.config.desc')}</Text>
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
                <Text style={s.configSub}>{t('stats.screen.config.sub', { pa: num(cfg.pointsA), pb: num(cfg.pointsB), count: cfg.rounds.length })}</Text>
              </TouchableOpacity>
            );
          })}
          </>
        ) : (
          <Text style={s.mutedNote}>{t('stats.screen.config.empty')}</Text>
        )}
      </SectionAnchor>

      <SectionAnchor anchorKey="h2h" anchors={anchors}>
      {players.length >= 2 && (
        <>
          <Text style={s.sectionTitle}>{t('stats.screen.h2h.heatSection')}</Text>
          <Text style={s.scopeText}>
            {t(metric === 'strokes' ? 'stats.screen.h2h.heatDescStrokes' : 'stats.screen.h2h.heatDescPoints')}
          </Text>
          {/* Same scramble-blanked `tournament` as the duel card below — the
              heatmap's cells are headToHead results too. */}
          <H2HMatrix
            tournament={tournament}
            players={players}
            metric={metric}
            theme={theme}
            s={s}
            onCellPress={(i, j) => { setH2hP1(i); setH2hP2(j); }}
          />
        </>
      )}

      <Text style={s.sectionTitle}>{t('stats.screen.h2h.duelSection')}</Text>
      <Text style={s.scopeText}>{scopeLabel(roundScope)}</Text>
      <View style={s.h2hSelector}>
        <View style={s.h2hCol}>
          {players.map((p, i) => (
            <TouchableOpacity key={p.id} style={[s.playerChip, h2hP1 === i && s.playerChipActive]} onPress={() => setH2hP1(i)} activeOpacity={0.7}>
              <Text style={[s.playerChipText, h2hP1 === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.h2hVs}>{t('shared.teams.vs')}</Text>
        <View style={s.h2hCol}>
          {players.filter((_, i) => i !== h2hP1).map((p) => {
            const realIdx = players.indexOf(p);
            return (
              <TouchableOpacity key={p.id} style={[s.playerChip, p2Idx === realIdx && s.playerChipActive]} onPress={() => setH2hP2(realIdx)} activeOpacity={0.7}>
                <Text style={[s.playerChipText, p2Idx === realIdx && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {h2h ? (
        <>
          <H2HCard
            label={t(metric === 'strokes' ? 'stats.screen.h2h.cardStrokes' : 'stats.screen.h2h.cardPoints')}
            explainer={t(metric === 'strokes' ? 'stats.screen.h2h.cardExplainerStrokes' : 'stats.screen.h2h.cardExplainerPoints')}
            p1={p1} p2={p2}
            bucket={metric === 'strokes' ? h2h.strokes : h2h.points}
            onPress={() => openH2H(metric)}
            theme={theme} s={s}
          />
          <View style={s.h2hTotals}>
            <Text style={s.h2hTotalsText}>
              {t('stats.screen.h2h.totals', {
                a: firstName(p1), av: metric === 'strokes' ? strLabel(h2h.totals.p1Strokes) : ptsLabel(h2h.totals.p1Points),
                b: firstName(p2), bv: metric === 'strokes' ? strLabel(h2h.totals.p2Strokes) : ptsLabel(h2h.totals.p2Points),
              })}
            </Text>
            <Text style={s.h2hTotalsSub}>{t('stats.screen.h2h.compared', { count: h2h.totals.holesCompared })}</Text>
          </View>
        </>
      ) : (
        <Text style={s.mutedNote}>{t('stats.screen.h2h.selectTwo')}</Text>
      )}
      </SectionAnchor>

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

function PairDifferenceChart({ data, metric, onHolePress, theme, s }) {
  const CHART_HEIGHT = 160;
  const HALF = CHART_HEIGHT / 2;
  const PADDING = 10;
  const unit = t(metric === 'strokes' ? 'stats.screen.unit.str' : 'stats.screen.unit.pts');
  const pair1Label = data.pair1.map(firstName).join(andSep());
  const pair2Label = data.pair2.map(firstName).join(andSep());
  const scale = data.maxAbs > 0 ? (HALF - PADDING) / data.maxAbs : 0;

  const maxLeadHole = data.holes.reduce((best, h) => {
    if (h.cumulative == null) return best;
    if (!best || Math.abs(h.cumulative) > Math.abs(best.cumulative)) return h;
    return best;
  }, null);
  const leaderLabel = data.finalDelta > 0 ? pair1Label : data.finalDelta < 0 ? pair2Label : t('stats.screen.pairDiffHole.level');
  const maxLeadLabel = maxLeadHole && maxLeadHole.cumulative !== 0
    ? `${maxLeadHole.cumulative > 0 ? pair1Label : pair2Label} +${num(Math.abs(maxLeadHole.cumulative))} ${unit} @ H${maxLeadHole.holeNumber}`
    : t('stats.screen.pairDiffChart.neverApart');

  return (
    <View style={s.pdCard}>
      <View style={s.pdLegend}>
        <View style={s.pdLegendItem}>
          <View style={[s.pdLegendDot, { backgroundColor: theme.pairA }]} />
          <Text style={s.pdLegendText}>{pair1Label}</Text>
        </View>
        <Text style={s.pdLegendVs}>{t('shared.teams.vs')}</Text>
        <View style={s.pdLegendItem}>
          <View style={[s.pdLegendDot, { backgroundColor: theme.pairB }]} />
          <Text style={s.pdLegendText}>{pair2Label}</Text>
        </View>
      </View>

      <View style={[s.pdChart, { height: CHART_HEIGHT }]}>
        {/* Value axis: peak gap at top/bottom, zero on the baseline. */}
        <View style={[s.pdAxisYTop, { top: 0 }]} pointerEvents="none">
          <Text style={s.pdAxisYLabel}>+{data.maxAbs} {unit}</Text>
        </View>
        <View style={[s.pdAxisYZero, { top: HALF - 6 }]} pointerEvents="none">
          <Text style={s.pdAxisYLabel}>0</Text>
        </View>
        <View style={[s.pdAxisYBottom, { bottom: 0 }]} pointerEvents="none">
          <Text style={s.pdAxisYLabel}>−{data.maxAbs} {unit}</Text>
        </View>
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
      <Text style={s.pdAxisTitle}>{t('stats.screen.pairDiffChart.axisTitle', { unit })}</Text>

      <View style={s.pdSummary}>
        <View style={s.pdSummaryCell}>
          <Text style={s.pdSummaryLabel}>{t('stats.screen.pairDiffChart.maxLead')}</Text>
          <Text style={s.pdSummaryValue}>{maxLeadLabel}</Text>
        </View>
        <View style={s.pdSummaryCell}>
          <Text style={s.pdSummaryLabel}>{t('stats.screen.pairDiffChart.final')}</Text>
          <Text style={s.pdSummaryValue}>
            {data.finalDelta === 0 ? t('stats.screen.pairDiffChart.tied') : `${leaderLabel} +${num(Math.abs(data.finalDelta))} ${unit}`}
          </Text>
        </View>
        <View style={s.pdSummaryCell}>
          <Text style={s.pdSummaryLabel}>{t('stats.screen.pairDiffChart.crossovers')}</Text>
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
          <Text style={s.hwGroupTitle}>{t('stats.screen.holeWins.total')}</Text>
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
          <Text style={s.hwEmpty}>{t('stats.screen.holeWins.noData')}</Text>
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
        <Text style={s.h2hMetricTies}>{t('stats.screen.h2h.ties', { count: bucket.ties })}</Text>
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

// ── My Shots Tab ──
// Putting / driving / penalty stats derived from per-hole shot detail. Works
// for ANY player who logged shot detail — a picker selects whose shots to view,
// defaulting to the device "me" player when they have data.
function ShotsTab({ tournament, theme, s }) {
  const withData = useMemo(() => playersWithShotData(tournament), [tournament]);
  const meId = tournament.meId ?? null;
  // Default to the "me" player when they logged data, else the first logger.
  const defaultIdx = (() => {
    const mineIdx = withData.findIndex(p => p.id === meId);
    return mineIdx >= 0 ? mineIdx : 0;
  })();
  const [shotPlayerIdx, setShotPlayerIdx] = useState(defaultIdx);
  const selected = withData[shotPlayerIdx] || withData[0] || null;
  const stats = useMemo(
    () => (selected ? shotStats(tournament, selected.id) : null),
    [tournament, selected],
  );
  const driveImpact = useMemo(
    () => (selected ? driveScoreImpact(tournament, selected.id) : null),
    [tournament, selected],
  );
  const girByDrive = useMemo(
    () => (selected ? girByDriveResult(tournament, selected.id) : null),
    [tournament, selected],
  );
  const puttDive = useMemo(
    () => (selected ? puttDeepDive(tournament, selected.id) : null),
    [tournament, selected],
  );
  const approachImpact = useMemo(
    () => (selected ? approachScoreImpact(tournament, selected.id) : null),
    [tournament, selected],
  );

  if (withData.length === 0) {
    const me = meId ? tournament.players.find((p) => p.id === meId) : null;
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={s.emptyText}>
          {me
            ? t('stats.screen.shots.emptyMe', { name: firstName(me) })
            : t('stats.screen.shots.empty')}
        </Text>
      </View>
    );
  }

  const me = selected;
  const { putts, drives, penalties, gir } = stats;
  const driveColors = {
    fairway: theme.scoreColor('excellent'),
    super: theme.scoreColor('excellent'),
    left: theme.scoreColor('neutral'),
    right: theme.scoreColor('neutral'),
    short: theme.scoreColor('poor'),
  };

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {withData.length > 1 && (
        <View style={s.playerSelector}>
          {withData.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              style={[s.playerChip, shotPlayerIdx === i && s.playerChipActive]}
              onPress={() => setShotPlayerIdx(i)}
              activeOpacity={0.7}
            >
              <Text style={[s.playerChipText, shotPlayerIdx === i && s.playerChipTextActive]}>{firstName(p)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <Text style={s.sectionTitle}>
        {t('stats.screen.shots.header', { name: firstName(me), count: stats.roundsWithData })}
      </Text>

      <View style={s.card}>
        <Text style={s.cardLabel}>{t('stats.screen.shots.putting')}</Text>
        <View style={s.shotStatGrid}>
          <View style={s.shotStatCell}>
            <Text style={s.shotStatNum}>{num(putts.perRound)}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.perRound')}</Text>
          </View>
          <View style={s.shotStatCell}>
            <Text style={s.shotStatNum}>{num(putts.perHole)}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.perHole')}</Text>
          </View>
          <View style={s.shotStatCell}>
            <Text style={s.shotStatNum}>{putts.onePutts}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.onePutts')}</Text>
          </View>
          <View style={s.shotStatCell}>
            <Text style={s.shotStatNum}>{putts.threePuttPlus}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.threePutts')}</Text>
          </View>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>{t('stats.screen.shots.puttDive')}</Text>
        {puttDive && puttDive.hasData ? (
          <>
            <View style={s.shotStatGrid}>
              <View style={s.shotStatCell}>
                <Text style={s.shotStatNum}>{num(puttDive.twoPuttPct)}%</Text>
                <Text style={s.shotStatLabel}>{t('stats.screen.shots.twoPutts')}</Text>
              </View>
              <View style={s.shotStatCell}>
                <Text style={s.shotStatNum}>{puttDive.girPuttsAvg != null ? num(puttDive.girPuttsAvg) : '—'}</Text>
                <Text style={s.shotStatLabel}>{t('stats.screen.shots.onGir')}</Text>
              </View>
              <View style={s.shotStatCell}>
                <Text style={s.shotStatNum}>{puttDive.nonGirPuttsAvg != null ? num(puttDive.nonGirPuttsAvg) : '—'}</Text>
                <Text style={s.shotStatLabel}>{t('stats.screen.shots.offGir')}</Text>
              </View>
              <View style={s.shotStatCell}>
                <Text style={s.shotStatNum}>{num(puttDive.onePuttSave.pct)}%</Text>
                <Text style={s.shotStatLabel}>{t('stats.screen.shots.onePuttSave')}</Text>
              </View>
            </View>
            <View style={s.puttByParRow}>
              {[3, 4, 5].map((par) => {
                const row = puttDive.byPar[par];
                // Same sample floor as the drive/approach impact rows —
                // a 1-5 hole average reads as a verdict it hasn't earned.
                const lowSample = row && isLowSample(row.holes);
                return (
                  <View key={par} style={s.puttByParCell}>
                    <Text style={s.puttByParLabel}>par {par}</Text>
                    <Text style={[s.puttByParVal, lowSample && { color: theme.text.muted }]}>
                      {row ? num(row.avg) : '—'}
                    </Text>
                    <Text style={s.puttByParSub}>
                      {!row ? t('stats.screen.shots.noData')
                        : lowSample ? t('stats.screen.shots.needMore', { count: row.holes })
                          : t('stats.screen.nHoles', { count: row.holes })}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={s.cardSub}>{t('stats.screen.shots.puttEmpty')}</Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>{t('stats.screen.shots.driving')}</Text>
        {drives.recorded > 0 ? (
          <>
            <Text style={s.bigNumber}>{num(drives.fairwayPct)}%</Text>
            <Text style={s.cardSub}>
              {t('stats.screen.shots.fairwaysHit', { hit: drives.fairwaysHit, rec: drives.recorded })}
            </Text>
            {girByDrive && (girByDrive.fairway.holes > 0 || girByDrive.miss.holes > 0) && (
              // A side with zero samples is hidden outright — rendering it
              // as a full-color 0% would read as a verdict on holes that
              // were never logged (isLowSample(0) is false by design; the
              // sibling Drive/Approach Impact rows skip empty buckets the
              // same way). The miss side's lead-in absorbs the "GIR" prefix
              // when it is the only side left.
              <View style={s.girDriveRow}>
                {girByDrive.fairway.holes > 0 && (
                  <>
                    <Text style={s.cardSub}>{t('stats.screen.shots.girAfterFairway')}</Text>
                    <Text style={[s.girDriveValue, isLowSample(girByDrive.fairway.holes) && { color: theme.text.muted }]}>
                      {num(girByDrive.fairway.girPct)}%
                    </Text>
                  </>
                )}
                {girByDrive.miss.holes > 0 && (
                  <>
                    <Text style={s.cardSub}>
                      {girByDrive.fairway.holes > 0 ? t('stats.screen.shots.afterMissCont') : t('stats.screen.shots.girAfterMiss')}
                    </Text>
                    <Text style={[s.girDriveValue, isLowSample(girByDrive.miss.holes) && { color: theme.text.muted }]}>
                      {num(girByDrive.miss.girPct)}%
                    </Text>
                  </>
                )}
              </View>
            )}
            <View style={[s.distRow, { marginTop: 12 }]}>
              {DRIVE_KEYS.map((k) => (
                <DistBar
                  key={k}
                  label={t(DRIVE_LABELS[k])}
                  count={drives.distribution[k]}
                  total={drives.recorded}
                  color={driveColors[k]}
                  s={s}
                />
              ))}
            </View>
          </>
        ) : (
          <Text style={s.cardSub}>{t('stats.screen.shots.noDrives')}</Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>{t('stats.screen.shots.driveImpact')}</Text>
        {driveImpact && driveImpact.hasData ? (
          <View style={{ marginTop: 4 }}>
            {DRIVE_KEYS.map((k) => {
              const b = driveImpact.buckets[k];
              if (b.holes === 0) return null;
              // Below the sample floor, a bucket's average is too noisy to
              // paint as a good/bad verdict — grey it out and say so instead.
              const lowSample = isLowSample(b.holes);
              const vsParColor = lowSample ? theme.text.muted
                : b.avgVsPar > 0
                  ? theme.scoreColor('poor')
                  : b.avgVsPar < 0
                    ? theme.scoreColor('excellent')
                    : theme.text.primary;
              const penColor = lowSample ? theme.text.muted
                : b.penaltyRate > 0 ? theme.scoreColor('poor') : theme.text.muted;
              return (
                <View key={k} style={s.driveImpactRow}>
                  <View style={[s.driveImpactSwatch, { backgroundColor: driveColors[k] }]} />
                  <Text style={s.driveImpactLabel}>{t(DRIVE_LABELS[k])}</Text>
                  <Text style={s.driveImpactCount}>
                    {lowSample ? t('stats.screen.shots.needMore', { count: b.holes }) : t('stats.screen.nHoles', { count: b.holes })}
                  </Text>
                  <View style={s.driveImpactStat}>
                    <Text style={s.driveImpactStatVal}>{num(b.avgPoints)}</Text>
                    <Text style={s.driveImpactStatLabel}>{t('stats.screen.unit.pts')}</Text>
                  </View>
                  <View style={s.driveImpactStat}>
                    <Text style={[s.driveImpactStatVal, { color: vsParColor }]}>
                      {sgnPos(b.avgVsPar)}
                    </Text>
                    <Text style={s.driveImpactStatLabel}>{t('stats.my.hole.col.vspar')}</Text>
                  </View>
                  <View style={s.driveImpactStat}>
                    <Text style={[s.driveImpactStatVal, { color: penColor }]}>{num(b.penaltyRate)}%</Text>
                    <Text style={s.driveImpactStatLabel}>{t('stats.screen.shots.pen')}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={s.cardSub}>{t('stats.screen.shots.driveImpactEmpty')}</Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>{t('stats.screen.shots.approachImpact')}</Text>
        {approachImpact && approachImpact.hasData ? (
          <View style={{ marginTop: 4 }}>
            {['0-50', '50-100', '100-150', '150-200', '200+'].map((k) => {
              const b = approachImpact.buckets[k];
              if (b.holes === 0) return null;
              // Same sample floor as the drive-impact rows above.
              const lowSample = isLowSample(b.holes);
              const vsParColor = lowSample ? theme.text.muted
                : b.avgVsPar > 0
                  ? theme.scoreColor('poor')
                  : b.avgVsPar < 0
                    ? theme.scoreColor('excellent')
                    : theme.text.primary;
              const girColor = lowSample ? theme.text.muted
                : b.girRate == null
                  ? theme.text.muted
                  : b.girRate >= 50
                    ? theme.scoreColor('excellent')
                    : b.girRate >= 25
                      ? theme.scoreColor('neutral')
                      : theme.scoreColor('poor');
              return (
                <View key={k} style={s.driveImpactRow}>
                  <View style={s.approachBucketPill}>
                    <Text style={s.approachBucketPillText}>{k}m</Text>
                  </View>
                  <Text style={s.driveImpactCount}>
                    {lowSample ? t('stats.screen.shots.needMore', { count: b.holes }) : t('stats.screen.nHoles', { count: b.holes })}
                  </Text>
                  <View style={s.driveImpactStat}>
                    <Text style={s.driveImpactStatVal}>{num(b.avgPoints)}</Text>
                    <Text style={s.driveImpactStatLabel}>{t('stats.screen.unit.pts')}</Text>
                  </View>
                  <View style={s.driveImpactStat}>
                    <Text style={[s.driveImpactStatVal, { color: vsParColor }]}>
                      {sgnPos(b.avgVsPar)}
                    </Text>
                    <Text style={s.driveImpactStatLabel}>{t('stats.my.hole.col.vspar')}</Text>
                  </View>
                  <View style={s.driveImpactStat}>
                    <Text style={[s.driveImpactStatVal, { color: girColor }]}>
                      {b.girRate == null ? '—' : `${num(b.girRate)}%`}
                    </Text>
                    <Text style={s.driveImpactStatLabel}>GIR</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={s.cardSub}>{t('stats.screen.shots.approachEmpty')}</Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>{t('stats.screen.shots.penalties')}</Text>
        <View style={s.shotStatGrid}>
          <View style={s.shotStatCell}>
            <Text style={[s.shotStatNum, { color: theme.scoreColor('poor') }]}>{penalties.tee}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.penTee')}</Text>
          </View>
          <View style={s.shotStatCell}>
            <Text style={[s.shotStatNum, { color: theme.scoreColor('neutral') }]}>{penalties.other}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.penOther')}</Text>
          </View>
          <View style={s.shotStatCell}>
            <Text style={s.shotStatNum}>{penalties.total}</Text>
            <Text style={s.shotStatLabel}>{t('stats.screen.shots.penTotal')}</Text>
          </View>
        </View>
      </View>

      {gir.eligible > 0 && (
        <View style={s.card}>
          <Text style={s.cardLabel}>{t('stats.screen.shots.gir')}</Text>
          <Text style={s.bigNumber}>{num(gir.pct)}%</Text>
          <Text style={s.cardSub}>{t('stats.screen.shots.girHoles', { holes: gir.holes, eligible: gir.eligible })}</Text>
        </View>
      )}

      {(() => {
        const scr = scramblingStats(tournament).find(r => r.player.id === me.id);
        return (
          <View style={s.card}>
            <Text style={s.cardLabel}>{t('stats.screen.shots.scrambling')}</Text>
            {scr ? (
              <>
                <Text style={s.bigNumber}>{num(scr.pct)}%</Text>
                <Text style={s.cardSub}>
                  {t('stats.screen.shots.scramblingSub', { saves: scr.saves, missed: scr.missedGir })}
                </Text>
              </>
            ) : (
              <Text style={s.cardSub}>
                {gir.eligible > 0
                  ? t('stats.screen.shots.scramblingNone')
                  : t('stats.screen.shots.scramblingLog')}
              </Text>
            )}
          </View>
        );
      })()}
    </View>
  );
}

function ShameTab({ tournament, hasMulti, usesTeams, metric, theme, s }) {
  // Each of these is a full tournament-wide pass (anchor runs the whole
  // pairHoleWins computation internally). The tab holds local `sheet` state
  // for its detail sheets, so without memoization tapping any highlight
  // card to open one would re-run every one of these on the JS thread.
  // Deps are keyed on exactly the scope vars each function reads — `sheet`
  // must never be a dep. Mirrors ShotsTab's useMemo pattern (~line 2893).
  const shame = useMemo(() => hallOfShame(tournament, { metric }), [tournament, metric]);
  const par3 = useMemo(() => par3Heartbreak(tournament), [tournament]);
  const pickup = useMemo(() => pickupChampion(tournament), [tournament]);
  const anchorStat = useMemo(() => anchor(tournament), [tournament]);
  const zero = useMemo(() => zeroHero(tournament), [tournament]);
  const encore = useMemo(() => nemesisEncore(tournament), [tournament]);
  const [sheet, setSheet] = useState(null);
  const modeLabel = t(metric === 'strokes' ? 'stats.screen.modeLabel.strokes' : 'stats.screen.modeLabel.points');

  const holeRows = (holes, playerId) => holes.map((b, i) => ({
    key: `${playerId || ''}-${b.roundIndex}-${b.holeNumber}-${i}`,
    primary: roundHoleLabel(b),
    secondary: parStrokesLabel(b),
    rightPrimary: ptsLabel(b.points),
    tone: b.points === 0 ? 'poor' : b.vsPar >= 1 ? 'neutral' : 'good',
  }));

  const openSingleHoleTied = (stat, title, explainer, formatRow) => setSheet({
    title: `${joinNames(stat.entries.map(e => e.player))} — ${title}`,
    subtitle: modeLabel,
    explainer,
    rows: tiedRowsByPlayer(
      stat.entries,
      (e) => formatRow(e),
      (e) => roundHoleLabel(e),
    ),
  });

  const openTripleBogey = () => openSingleHoleTied(
    shame.tripleBogey,
    t('stats.screen.shame.tripleLabel', { n: num(shame.tripleBogey.value) }),
    t(metric === 'strokes' ? 'stats.screen.shame.tripleExplainerStrokes' : 'stats.screen.shame.tripleExplainerPoints'),
    (e) => [{
      key: `${e.player.id}-tb`,
      primary: t('stats.screen.parSi', { par: e.par, si: e.si }),
      secondary: t('stats.screen.strokesN', { n: e.strokes }),
      rightPrimary: ptsLabel(e.points),
      tone: 'poor',
    }],
  );

  const openStreakTied = (stat, titleKey, explainerKey) => setSheet({
    title: t(titleKey, { names: joinNames(stat.entries.map(e => e.player)), value: num(stat.value) }),
    subtitle: modeLabel,
    explainer: t(explainerKey),
    rows: tiedRowsByPlayer(
      stat.entries,
      (e) => holeRows(e.breakdown, e.player.id),
      (e) => t('stats.screen.nHoles', { count: e.count }),
    ),
  });

  const openBogeyStreak = () => openStreakTied(
    shame.bogeyStreak,
    'stats.screen.shame.bogeyTitle',
    'stats.screen.shame.bogeyExplainer',
  );

  const openDoubleBogeyStreak = () => openStreakTied(
    shame.doubleBogeyStreak,
    'stats.screen.shame.dblTitle',
    'stats.screen.shame.dblExplainer',
  );

  const openPointless = () => openStreakTied(
    shame.pointlessStreak,
    'stats.screen.shame.pointlessTitle',
    'stats.screen.shame.pointlessExplainer',
  );

  const openGift = () => {
    const stat = shame.gift;
    setSheet({
      title: t('stats.screen.shame.giftTitle', { names: joinNames(stat.entries.map(e => e.player)), value: num(stat.value) }),
      subtitle: modeLabel,
      explainer: t('stats.screen.shame.giftExplainer'),
      rows: tiedRowsByPlayer(
        stat.entries,
        (e) => e.breakdown.map(b => ({
          key: `${e.player.id}-${b.playerId}`,
          primary: b.playerName,
          secondary: t('stats.screen.strokesN', { n: b.strokes }),
          rightPrimary: ptsLabel(b.points),
          tone: b.playerId === e.player.id ? 'poor' : toneForPoints(b.points),
        })),
        (e) => roundHoleLabel(e),
      ),
    });
  };

  const openCollapse = () => {
    const stat = shame.collapse;
    setSheet({
      title: t('stats.screen.shame.collapseTitle', { names: joinNames(stat.entries.map(e => e.player)), value: num(stat.value) }),
      subtitle: modeLabel,
      explainer: t('stats.screen.shame.collapseExplainer'),
      rows: tiedRowsByPlayer(
        stat.entries,
        (e) => e.breakdown.map(b => ({
          key: `${e.player.id}-${b.holeNumber}`,
          primary: t(b.holeNumber <= 9 ? 'stats.screen.shame.holeFront' : 'stats.screen.shame.holeBack', { n: b.holeNumber }),
          secondary: parStrokesLabel(b),
          rightPrimary: ptsLabel(b.points),
          tone: toneForPoints(b.points),
        })),
        (e) => `${roundTag(e.roundIndex)} · ${e.courseName} · ${e.front}/${e.back}`,
      ),
    });
  };

  const openBlowup = () => openSingleHoleTied(
    shame.blowup,
    t('stats.screen.shame.blowupLabel', { n: num(shame.blowup.value) }),
    t('stats.screen.shame.blowupExplainer'),
    (e) => [{
      key: `${e.player.id}-bu`,
      primary: t('stats.screen.parSi', { par: e.par, si: e.si }),
      secondary: t('stats.screen.shame.blowupRow', { strokes: e.strokes, over: num(e.vsPar) }),
      rightPrimary: ptsLabel(e.points),
      tone: 'poor',
    }],
  );

  const openPar3 = () => par3 && setSheet({
    title: t('stats.screen.shame.par3Title', { names: joinNames(par3.entries.map(e => e.player)) }),
    subtitle: t('stats.screen.shame.par3Subtitle', { value: num(par3.value) }),
    explainer: t('stats.screen.shame.par3Explainer'),
    rows: tiedRowsByPlayer(
      par3.entries,
      (e) => e.breakdown.map((b, i) => ({
        key: `${e.player.id}-${i}`,
        primary: roundHoleLabel(b),
        secondary: t('stats.screen.parSi', { par: b.par, si: b.si }),
        rightPrimary: `${strLabel(b.strokes)} · ${ptsLabel(b.points)}`,
        tone: b.points === 0 ? 'poor' : b.points === 1 ? 'neutral' : 'good',
      })),
      (e) => t('stats.screen.shame.par3Header', { avg: num(e.avgStrokes), count: e.holes }),
    ),
  });

  const openPickup = () => pickup && setSheet({
    title: t('stats.screen.shame.pickupTitle', { names: joinNames(pickup.entries.map(e => e.player)), value: num(pickup.value) }),
    subtitle: t('stats.screen.shame.pickupSubtitle'),
    explainer: t('stats.screen.shame.pickupExplainer'),
    rows: tiedRowsByPlayer(
      pickup.entries,
      (e) => e.breakdown.map((b, i) => ({
        key: `${e.player.id}-${i}`,
        primary: roundHoleLabel(b),
        secondary: t('stats.screen.parSiStrokes', { par: b.par, si: b.si, strokes: b.strokes }),
        rightPrimary: ptsLabel(0),
        tone: 'poor',
      })),
      (e) => t('stats.screen.shame.pickups', { count: e.pickups }),
    ),
  });

  const openAnchor = () => anchorStat && setSheet({
    title: t('stats.screen.shame.anchorTitle', { names: joinNames(anchorStat.entries.map(e => e.player)) }),
    subtitle: t('stats.screen.shame.anchorSubtitle', { value: num(anchorStat.value) }),
    explainer: t('stats.screen.shame.anchorExplainer'),
    rows: anchorStat.all.filter(a => a.mbCount + a.pbCount > 0).map(a => ({
      key: a.player.id,
      primary: a.player.name,
      secondary: `MB ${a.mbCount} · PB ${a.pbCount}`,
      rightPrimary: `${sgn(a.anchorScore)}`,
      tone: a.anchorScore >= 5 ? 'poor' : a.anchorScore > 0 ? 'neutral' : 'good',
    })),
  });

  const openZero = () => zero && setSheet({
    title: t('stats.screen.shame.zeroTitle', { names: joinNames([...new Set(zero.entries.map(e => e.player.id))].map(id => zero.entries.find(e => e.player.id === id).player)) }),
    subtitle: t('stats.screen.shame.zeroSubtitle'),
    explainer: t('stats.screen.shame.zeroExplainer'),
    rows: zero.entries.flatMap((e, i) => [
      { key: `sec-${i}`, section: true, label: `${e.player.name} · ${roundTag(e.roundIndex)} · ${e.courseName}`, rightLabel: t('stats.screen.shame.zeroHoles', { count: e.count }) },
      ...e.breakdown.map((b, j) => ({
        key: `${i}-${j}`,
        primary: t('stats.screen.hole', { n: b.holeNumber }),
        secondary: t('stats.screen.parSiStrokes', { par: b.par, si: b.si, strokes: b.strokes }),
        rightPrimary: ptsLabel(0),
        tone: 'poor',
      })),
    ]),
  });

  const openEncore = () => encore && setSheet({
    // joinNames across every offender (dedup by player id) — the openZero
    // convention — since entries can belong to several different players.
    title: t('stats.screen.shame.encoreTitle', { names: joinNames([...new Set(encore.map(e => e.player.id))].map(id => encore.find(e => e.player.id === id).player)) }),
    // Only a lone entry can honestly headline its own hole/course here.
    subtitle: encore.length === 1
      ? t('stats.screen.holeCourse', { n: encore[0].holeNumber, course: encore[0].courseName })
      : t('stats.screen.shame.encoreSubtitle', { count: encore.length }),
    explainer: t('stats.screen.shame.encoreExplainer'),
    rows: encore.flatMap((e, i) => [
      { key: `sec-${i}`, section: true, label: t('stats.screen.shame.encoreSection', { name: e.player.name, hole: e.holeNumber, course: e.courseName }), rightLabel: t('stats.screen.pairs.rounds', { count: e.rounds.length }) },
      ...e.rounds.map((ri, j) => {
        const round = tournament.rounds[ri];
        const holeInfo = round?.holes?.find(h => h.number === e.holeNumber);
        return {
          key: `${i}-${j}`,
          primary: `${roundTag(ri)} · ${round?.courseName ?? e.courseName}`,
          secondary: holeInfo ? t('stats.screen.parSi', { par: holeInfo.par, si: holeInfo.strokeIndex }) : '',
          rightPrimary: ptsLabel(0),
          tone: 'poor',
        };
      }),
    ]),
  });

  const any = shame.tripleBogey || shame.bogeyStreak || shame.doubleBogeyStreak || shame.pointlessStreak || (hasMulti && shame.gift) || shame.collapse || shame.blowup || par3 || pickup || (usesTeams && anchorStat) || zero || encore;

  return (
    <View>
      {!any && <Text style={s.emptyText}>{t('stats.screen.shame.empty')}</Text>}

      {shame.tripleBogey && (
        <HighlightCard
          icon="alert-triangle"
          label={t('stats.screen.shame.tripleCard')}
          value={t('stats.screen.shame.tripleValue', { names: joinNames(shame.tripleBogey.entries.map(e => e.player)), value: num(shame.tripleBogey.value) })}
          sub={shame.tripleBogey.entries.length === 1 ? t('stats.screen.shame.courseHole', { course: shame.tripleBogey.entries[0].courseName, n: shame.tripleBogey.entries[0].holeNumber }) : t('stats.screen.nTied', { count: shame.tripleBogey.entries.length })}
          onPress={openTripleBogey} theme={theme} s={s}
        />
      )}
      {shame.bogeyStreak && (
        <HighlightCard
          icon="trending-down"
          label={t('stats.screen.shame.bogeyCard')}
          value={t('stats.screen.shame.bogeysValue', { names: joinNames(shame.bogeyStreak.entries.map(e => e.player)), value: num(shame.bogeyStreak.value) })}
          sub={t('stats.screen.shame.bogeySub', { mode: modeLabel })}
          onPress={openBogeyStreak} theme={theme} s={s}
        />
      )}
      {shame.doubleBogeyStreak && (
        <HighlightCard
          icon="alert-octagon"
          label={t('stats.screen.shame.dblCard')}
          value={t('stats.screen.parStreak.title', { names: joinNames(shame.doubleBogeyStreak.entries.map(e => e.player)), value: num(shame.doubleBogeyStreak.value) })}
          sub={t('stats.screen.shame.dblSub', { mode: modeLabel })}
          onPress={openDoubleBogeyStreak} theme={theme} s={s}
        />
      )}
      {shame.pointlessStreak && (
        <HighlightCard
          icon="minus-circle"
          label={t('stats.screen.shame.pointlessCard')}
          value={t('stats.screen.parStreak.title', { names: joinNames(shame.pointlessStreak.entries.map(e => e.player)), value: num(shame.pointlessStreak.value) })}
          sub={t('stats.screen.shame.pointlessSub', { mode: modeLabel })}
          onPress={openPointless} theme={theme} s={s}
        />
      )}
      {hasMulti && shame.gift && (
        <HighlightCard
          icon="gift"
          label={t('stats.screen.shame.giftCard')}
          value={t('stats.screen.shame.giftTitle', { names: joinNames(shame.gift.entries.map(e => e.player)), value: num(shame.gift.value) })}
          sub={shame.gift.entries.length === 1 ? t('stats.screen.shame.courseHole', { course: shame.gift.entries[0].courseName, n: shame.gift.entries[0].holeNumber }) : t('stats.screen.nTied', { count: shame.gift.entries.length })}
          onPress={openGift} theme={theme} s={s}
        />
      )}
      {shame.collapse && (
        <HighlightCard
          icon="activity"
          label={t('stats.screen.shame.collapseCard')}
          value={t('stats.screen.shame.collapseValue', { names: joinNames(shame.collapse.entries.map(e => e.player)), value: num(shame.collapse.value) })}
          sub={shame.collapse.entries.length === 1 ? t('stats.screen.shame.collapseSub', { course: shame.collapse.entries[0].courseName, front: num(shame.collapse.entries[0].front), back: num(shame.collapse.entries[0].back) }) : t('stats.screen.nTied', { count: shame.collapse.entries.length })}
          onPress={openCollapse} theme={theme} s={s}
        />
      )}
      {shame.blowup && (
        <HighlightCard
          icon="flag"
          label={t('stats.screen.shame.blowupCard')}
          value={t('stats.screen.namesStrokes', { names: joinNames(shame.blowup.entries.map(e => e.player)), value: num(shame.blowup.value) })}
          sub={shame.blowup.entries.length === 1 ? t('stats.screen.shame.courseHole', { course: shame.blowup.entries[0].courseName, n: shame.blowup.entries[0].holeNumber }) : t('stats.screen.nTied', { count: shame.blowup.entries.length })}
          onPress={openBlowup} theme={theme} s={s}
        />
      )}
      {par3 && (
        <HighlightCard
          icon="target"
          label={t('stats.screen.shame.par3Card')}
          value={t('stats.screen.shame.par3Value', { names: joinNames(par3.entries.map(e => e.player)), value: num(par3.value) })}
          sub={par3.entries.length === 1 ? t('stats.screen.shame.par3Sub', { holes: par3.entries[0].holes, points: num(par3.entries[0].totalPoints) }) : t('stats.screen.nTied', { count: par3.entries.length })}
          onPress={openPar3} theme={theme} s={s}
        />
      )}
      {pickup && (
        <HighlightCard
          icon="hand"
          label={t('stats.screen.shame.pickupCard')}
          value={t('stats.screen.shame.pickupTitle', { names: joinNames(pickup.entries.map(e => e.player)), value: num(pickup.value) })}
          sub={pickup.entries.length === 1 ? t('stats.screen.shame.pickupSub') : t('stats.screen.nTied', { count: pickup.entries.length })}
          onPress={openPickup} theme={theme} s={s}
        />
      )}
      {usesTeams && anchorStat && (
        <HighlightCard
          icon="anchor"
          label={t('stats.screen.shame.anchorCard')}
          value={`${joinNames(anchorStat.entries.map(e => e.player))} — +${num(anchorStat.value)} PB`}
          sub={t('stats.screen.shame.anchorSub')}
          onPress={openAnchor} theme={theme} s={s}
        />
      )}
      {zero && (
        <HighlightCard
          icon="slash"
          label={t('stats.screen.shame.zeroCard')}
          value={t('stats.screen.shame.zeroValue', { name: firstName(zero.entries[0].player), count: zero.entries[0].count, round: zero.entries[0].roundIndex + 1 })}
          sub={t('stats.screen.shame.zeroSub', { count: zero.entries.length })}
          onPress={openZero} theme={theme} s={s}
        />
      )}
      {encore && (
        <HighlightCard
          icon="repeat"
          label={t('stats.screen.shame.encoreCard')}
          value={t('stats.screen.shame.encoreValue', { hole: encore[0].holeNumber, name: firstName(encore[0].player), count: encore[0].rounds.length })}
          sub={encore.length === 1
            ? t('stats.screen.shame.encoreSub1', { course: encore[0].courseName })
            : t('stats.screen.shame.encoreSubN', { count: encore.length })}
          onPress={openEncore} theme={theme} s={s}
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
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 100 },

  // Tabs
  tabScroller: { flexGrow: 0, flexShrink: 0, maxHeight: 42 },
  tabBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 6, paddingBottom: 8 },
  scopeBar: { paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: t.border.subtle },
  scopeScroller: { flexGrow: 0, flexShrink: 0, maxHeight: 36 },
  scopeChips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2 },
  scoringToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 6, paddingHorizontal: 16,
  },
  scoringLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 12 },
  scoringLabelActive: { color: t.text.primary },

  // Sticky section index
  sectionIndexWrap: {
    marginHorizontal: -20, paddingHorizontal: 0, marginBottom: 4,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  sectionIndexRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingVertical: 8 },
  sectionIndexChip: {
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default,
  },
  sectionIndexText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11, color: t.text.secondary },

  // Persistent muted empty-state note
  mutedNote: {
    fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12,
    lineHeight: 18, paddingVertical: 10, paddingHorizontal: 2, marginBottom: 4,
  },
  tab: {
    minHeight: 30, justifyContent: 'center',
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default,
  },
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

  shotStatGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  shotStatCell: { width: '25%', alignItems: 'center', paddingVertical: 6 },
  shotStatNum: { fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary, fontSize: 24 },
  shotStatLabel: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 10, marginTop: 2, textAlign: 'center' },

  // GIR-after-drive-result line under the Driving card's fairways-hit sub —
  // each percentage is its own Text node (not nested) so isLowSample can
  // grey either side independently.
  girDriveRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 6 },
  girDriveValue: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 12 },

  // Drive impact rows — one row per bucket (super/fairway/left/right/short),
  // each with a small colored dot and three mini-stats (pts / vs par / pen).
  driveImpactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  driveImpactSwatch: { width: 10, height: 10, borderRadius: 5 },
  driveImpactLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 13, minWidth: 60 },
  // Approach distance pill — same row template as drive impact, but the
  // bucket key (e.g. "100-150m") replaces the colored swatch + drive name.
  approachBucketPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    backgroundColor: t.bg.secondary, borderWidth: 1, borderColor: t.border.default,
    minWidth: 70, alignItems: 'center',
  },
  approachBucketPillText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 12 },
  driveImpactCount: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, flex: 1 },
  driveImpactStat: { alignItems: 'center', minWidth: 44 },
  driveImpactStatVal: { fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary, fontSize: 15 },
  driveImpactStatLabel: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 9, marginTop: 1 },

  // Putt deep-dive: avg putts split by par 3 / 4 / 5
  puttByParRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  puttByParCell: { flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: t.bg.secondary, borderRadius: 10 },
  puttByParLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.secondary, fontSize: 11 },
  puttByParVal: { fontFamily: 'PlayfairDisplay-Bold', color: t.text.primary, fontSize: 20, marginTop: 2 },
  puttByParSub: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 9, marginTop: 1 },

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
  pdAxisTitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 9, color: t.text.muted,
    textAlign: 'center', marginTop: 4,
  },
  pdAxisYTop: { position: 'absolute', left: 2 },
  pdAxisYZero: { position: 'absolute', left: 2 },
  pdAxisYBottom: { position: 'absolute', left: 2 },
  pdAxisYLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8, color: t.text.muted,
    backgroundColor: t.bg.card, paddingHorizontal: 2,
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
  momentumScaleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 6, paddingLeft: '30%',
  },
  momentumScaleLine: { flex: 1, height: 1, backgroundColor: t.border.default },
  momentumScaleLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: t.text.muted, letterSpacing: 0.5,
  },
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

  // Carry ratio bar (used inside a Pair Card)
  carryBar: {
    flexDirection: 'row', height: 10, borderRadius: 5,
    backgroundColor: t.bg.secondary, overflow: 'hidden', marginBottom: 6, marginTop: 8,
  },
  carryFill: { height: '100%' },
  carryLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  carryName: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: t.text.primary },

  // Pair difference drama strip
  dramaStrip: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: t.text.muted,
    marginTop: 8, marginBottom: 4,
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

  // Scramble placeholder (personal stats hidden — the team plays one ball)
  scrambleNotice: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  scrambleNoticeIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: t.accent.light,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  scrambleNoticeTitle: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: t.text.primary,
    marginBottom: 8, textAlign: 'center',
  },
  scrambleNoticeText: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: t.text.muted,
    textAlign: 'center', lineHeight: 21,
  },

  // Highlights
  highlightCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.isDark ? t.bg.card : t.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: t.isDark ? t.glass?.border || t.border.default : t.border.default,
    padding: 16, marginBottom: 8, ...(t.isDark ? {} : t.shadow.card),
  },
  highlightIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.accent.light, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  highlightCaptureHost: { position: 'absolute', left: -10000, top: 0, width: 360 },
  highlightShareBtn: { padding: 6, marginRight: 2 },
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
  streakItemDim: { opacity: 0.4 },
  streakNumber: { fontFamily: 'PlayfairDisplay-Black', fontSize: 28 },
  streakLabel: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 4 },

  // Round history
  historyRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  historyMain: { flex: 1, marginRight: 8 },
  historyTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyRound: { fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 13, width: 30 },
  historyCourse: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 13, flex: 1 },
  historyModeBadge: {
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: t.accent.light,
  },
  historyModeBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 9, color: t.accent.primary,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  historySub: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 11, marginTop: 2 },
  historyRight: { alignItems: 'flex-end' },
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
  heatCellEmpty: { opacity: 0.45 },
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
  pairCoverageLine: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 12, marginTop: 4 },
  synergyBadge: {
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  synergyBadgeText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },

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
    minHeight: 28, justifyContent: 'center',
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
