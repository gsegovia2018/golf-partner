// ============================================================================
// Friend player stats (pure, no IO).
// ============================================================================
//
// The Player Stats screen renders a friend's game from the same MyRound
// records personal stats runs on — the friend's rounds are already on this
// device because buildFeed fetches friends' tournament docs. This module is
// the derivation layer between those rounds and the screen:
//
//   sharedRounds / headToHead  — the "Together" tab: rounds you both played.
//   buildFriendSummary         — the "Summary" tab's numbers.
//   friendVerdict              — the one-sentence read at the top of it.
//
// Nothing here fetches: hand it the two MyRound lists from
// friendStore.loadFriendStatsData.

import {
  resolveSelection, computeMyStats,
} from './personalStats';
import {
  computeHandicapIndex, handicapIndexSeries, roundDifferential,
} from './handicapIndex';

const round1 = (n) => Math.round(n * 10) / 10;

// ── sharedRounds ──
// The rounds both players actually played, joined on the MyRound key
// (`${tournamentId}:${roundIndex}`) — the same round of the same tournament,
// so no scores can be crossed. Both sides must be isComplete: a half-played
// card would compare 9 holes of points against 18. A join landing on the same
// player slot is dropped defensively — with strict user_id resolution on both
// sides it cannot happen, and if it ever did it would render as a player
// beating themselves.
//
// myRounds is chronological (collectMyRounds), so the result is too.
export function sharedRounds(myRounds, friendRounds) {
  const byKey = new Map((friendRounds || []).map((r) => [r.key, r]));
  const out = [];
  (myRounds || []).forEach((mine) => {
    const theirs = byKey.get(mine.key);
    if (!theirs) return;
    if (!mine.isComplete || !theirs.isComplete) return;
    if (mine.playerId === theirs.playerId) return;
    out.push({
      key: mine.key,
      tournamentId: mine.tournamentId,
      tournamentName: mine.tournamentName,
      courseName: mine.courseName,
      date: mine.tournamentDate ?? null,
      roundIndex: mine.roundIndex,
      mePoints: mine.points,
      themPoints: theirs.points,
      meHoles: mine.holesPlayed,
      themHoles: theirs.holesPlayed,
      partners: onSameTeam(mine.round, mine.playerId, theirs.playerId),
      scoringMode: mine.round?.scoringMode ?? null,
    });
  });
  return out;
}

// Were the two players on the same side that round? round.pairs persists ids
// only (scoring.thinPairs), so match on member id.
function onSameTeam(round, a, b) {
  return (round?.pairs || []).some((team) => (
    Array.isArray(team)
    && team.some((m) => m?.id === a)
    && team.some((m) => m?.id === b)
  ));
}

// ── headToHead ──
// The record over sharedRounds output. Points, not strokes: every round here
// is Stableford, and points already carry each player's own handicap, so the
// comparison is like-for-like across two different indexes.
// `last5` is the last five results in CHRONOLOGICAL order (oldest first),
// matching the list it is derived from.
export function headToHead(shared) {
  const list = shared || [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let mePts = 0;
  let themPts = 0;
  let partnerRounds = 0;
  const results = [];
  list.forEach((s) => {
    mePts += s.mePoints;
    themPts += s.themPoints;
    if (s.partners) partnerRounds += 1;
    if (s.mePoints > s.themPoints) { wins += 1; results.push('W'); }
    else if (s.mePoints < s.themPoints) { losses += 1; results.push('L'); }
    else { ties += 1; results.push('T'); }
  });
  const n = list.length;
  return {
    n,
    wins,
    losses,
    ties,
    avgMe: n > 0 ? round1(mePts / n) : null,
    avgThem: n > 0 ? round1(themPts / n) : null,
    last5: results.slice(-5),
    partnerRounds,
  };
}

// How many days back the index "3-month move" looks.
const MOVE_WINDOW_DAYS = 90;
// A ranking cell needs this many holes behind it before it is worth calling a
// strength or a weakness out loud about someone else's game. rankStrengths
// already applies a looser floor (12 holes) for the Breakdown tab.
const RANK_SAMPLE_MIN = 30;
// How many differentials the Summary sparkline shows.
const SERIES_POINTS = 10;

// ── buildFriendSummary ──
// The Summary tab's whole view-model, plus the raw computeMyStats result the
// Form/Handicap/Breakdown tabs reuse (so the screen computes the pipeline
// once).
//
// The index and the differentials both come from the SELECTED rounds — the
// same list HandicapTab is handed — so the hero number and the Handicap tab
// can never disagree. `targetHandicap: 0` because there is no "target" for
// someone else's game; it only feeds strokes-gained benchmarks the friend
// screen doesn't show.
export function buildFriendSummary(friendRounds, { n = 5 } = {}) {
  const selected = resolveSelection(friendRounds);
  const stats = computeMyStats(selected, { n, targetHandicap: 0 });

  // Chronological, rated rounds only — a nine, a walked-in card or an
  // unrated course simply has no differential.
  const diffs = selected.map(roundDifferential).filter(Boolean);
  const recent = diffs.slice(-n);
  const recentDiff = {
    value: recent.length > 0
      ? round1(recent.reduce((s, d) => s + d.differential, 0) / recent.length)
      : null,
    count: recent.length,
  };

  const indexValue = computeHandicapIndex(selected).index;
  const index = { value: indexValue, move3m: indexMove(selected, indexValue) };
  const gap = recentDiff.value != null && indexValue != null
    ? round1(recentDiff.value - indexValue)
    : null;

  const milestones = stats.careerMilestones;
  const formMetric = (stats.form?.metrics ?? []).find((m) => m.key === 'avgDifferential') ?? null;

  return {
    roundCount: selected.length,
    ratedCount: diffs.length,
    recentDiff,
    index,
    gap,
    bestDiff: milestones.bestDifferential != null ? {
      value: milestones.bestDifferential,
      courseName: milestones.bestDifferentialCourse,
      date: milestones.bestDifferentialDate,
    } : null,
    bestRound: milestones.bestRound != null ? {
      points: milestones.bestRound,
      handicap: milestones.bestRoundHandicap,
      courseName: milestones.bestRoundCourse,
      date: milestones.bestRoundDate,
    } : null,
    form: {
      recent: formMetric?.recent ?? null,
      history: formMetric?.history ?? null,
      delta: formMetric?.delta ?? null,
      chip: formChip(formMetric?.delta ?? null),
    },
    series: diffs.slice(-SERIES_POINTS).map((d) => ({
      key: d.key, value: d.differential, courseName: d.courseName, date: d.date,
    })),
    strengths: rankCells(stats.ranking?.strengths),
    weaknesses: rankCells(stats.ranking?.weaknesses),
    baseline: stats.ranking?.baseline ?? null,
    scoreMix: scoreMixOf(stats.distribution),
    homeCourse: homeCourseOf(stats.courseMastery, diffs),
    milestones: {
      longestParStreak: milestones.longestParStreak,
      bestNine: milestones.bestNine,
    },
    stats,
    selected,
  };
}

// Index today minus the index as it stood ~3 months ago: the last series
// point dated at or before the cutoff. Null while the walk doesn't reach
// back that far (a series shorter than the window has no "before" point).
function indexMove(selectedRounds, indexValue) {
  if (indexValue == null) return null;
  const cutoff = Date.now() - MOVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let past = null;
  handicapIndexSeries(selectedRounds).forEach((p) => {
    const ts = Date.parse(p.date);
    if (Number.isFinite(ts) && ts <= cutoff && p.value != null) past = p;
  });
  return past ? round1(indexValue - past.value) : null;
}

// Lower differential is better, so a negative delta is improvement.
function formChip(delta) {
  if (delta == null) return 'steady';
  if (delta <= -3) return 'hot';
  if (delta <= -1) return 'up';
  if (delta >= 1) return 'down';
  return 'steady';
}

function rankCells(cells) {
  return (cells ?? [])
    .filter((c) => c.sample >= RANK_SAMPLE_MIN)
    .slice(0, 3)
    .map((c) => ({
      label: c.label, avgPoints: c.avgPoints, sample: c.sample, deviation: c.deviation,
    }));
}

function scoreMixOf(dist) {
  return {
    eagles: dist?.eagles ?? 0,
    birdies: dist?.birdies ?? 0,
    pars: dist?.pars ?? 0,
    bogeys: dist?.bogeys ?? 0,
    doubles: dist?.doubles ?? 0,
    worse: dist?.worse ?? 0,
    total: dist?.total ?? 0,
  };
}

// The most-played course (courseMastery is already sorted rounds-desc), with
// the one figure courseMastery doesn't carry: the mean differential there.
// Matched by courseName — courseMastery keys on `courseId ?? courseName`
// (courseDNA) while a differential only carries the name, and the name is
// what the card shows either way. avgDifferential/ratedCount are null/0 for
// a nine-hole or unrated home course.
function homeCourseOf(mastery, diffs) {
  const top = (mastery ?? [])[0];
  if (!top) return null;
  const here = diffs.filter((d) => d.courseName === top.courseName);
  return {
    courseName: top.courseName,
    rounds: top.rounds,
    avgPoints: top.avgPoints,
    bestPoints: top.bestPoints,
    avgDifferential: here.length > 0
      ? round1(here.reduce((s, d) => s + d.differential, 0) / here.length)
      : null,
    ratedCount: here.length,
  };
}

// ── friendVerdict ──
// One deterministic sentence describing a friend's game, built from the
// summary above. DESCRIPTIVE, never prescriptive: this is someone else's
// golf, so it reports what the numbers say rather than telling them what to
// work on. Null under 3 rated rounds (and without an index or a gap) — with
// that little evidence any sentence would be a guess.
// Keyed by the side of the ledger the cell came from: every phrase only
// reads correctly on one side ("deadly from the fairway" is not a weakness,
// "par 3s are the leak" is not a compliment), so a cell landing on the
// other side is simply skipped.
const TRAIT_PHRASES = {
  strength: {
    'Tee shot on the fairway': 'deadly from the fairway',
    'Opening 3 holes': 'fast out of the gate',
    'Closing 3 holes': 'a closer',
    'Par 5s': 'a par-5 specialist',
    'Hard holes': 'thrives on the hard holes',
  },
  weakness: {
    'Tee shot missing the fairway': 'lives and dies by the tee shot',
    'Par 3s': 'par 3s are the leak',
    'After a tee penalty': 'one penalty ruins a hole',
    'Back nine': 'fades after the turn',
    'Front nine': 'slow to get going',
  },
};

const PRONOUNS = {
  male: { possessive: 'his', object: 'him' },
  female: { possessive: 'her', object: 'her' },
};
const NEUTRAL_PRONOUNS = { possessive: 'their', object: 'them' };

const MIN_VERDICT_ROUNDS = 3;

export function friendVerdict(summary, { gender } = {}) {
  if (!summary || summary.ratedCount < MIN_VERDICT_ROUNDS) return null;
  if (summary.gap == null || summary.index?.value == null) return null;
  const { possessive, object } = PRONOUNS[gender] ?? NEUTRAL_PRONOUNS;
  const idx = summary.index.value;

  let level;
  if (summary.gap <= 0.5) level = `playing right to the ${idx} the app rates ${object}`;
  else if (summary.gap <= 2.5) level = `a touch over the ${idx} the app rates ${object}`;
  else level = `averaging ${summary.gap} strokes over the ${idx} the app rates ${object}`;

  const trait = traitPhrase(summary);

  const delta = summary.form?.delta ?? null;
  let form;
  if (delta != null && delta <= -3) form = `on ${possessive} hottest stretch yet`;
  else if (delta != null && delta <= -1) form = 'trending the right way';
  else if (delta != null && delta >= 1) form = 'grinding through a rough patch';
  else form = 'holding steady';

  const head = level.charAt(0).toUpperCase() + level.slice(1);
  return trait ? `${head}, ${trait} — and ${form}.` : `${head} — and ${form}.`;
}

// The single most extreme ranked cell — strength or weakness — that has a
// phrase written for its side of the ledger.
function traitPhrase(summary) {
  const cells = [
    ...(summary.strengths ?? []).map((c) => ({ ...c, phrase: TRAIT_PHRASES.strength[c.label] })),
    ...(summary.weaknesses ?? []).map((c) => ({ ...c, phrase: TRAIT_PHRASES.weakness[c.label] })),
  ]
    .filter((c) => c.sample >= RANK_SAMPLE_MIN && c.phrase)
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  return cells.length > 0 ? cells[0].phrase : null;
}
