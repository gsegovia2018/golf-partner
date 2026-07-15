// Per-course drill-down statistics for the CourseStats screen.
//
// Pure module: the screen does the async loading (tournaments → collectMyRounds
// → filterRoundsToCourse); this module only transforms. It reuses the
// statsEngine per-player functions via a synthetic single-course tournament so
// every number here agrees with MyStats (courseMastery scale, shotStats
// semantics). See docs/superpowers/specs/2026-07-15-course-breakdown-design.md
import {
  buildSyntheticTournament, courseMastery, CANON_ID,
} from './personalStats';
import {
  shotStats, playerScoreDistribution, frontBackSplit, courseDNA,
} from './statsEngine';
import {
  getPlayingHandicap, calcStablefordPoints,
} from './tournamentStore';

// Navigable identity of a collectMyRounds entry — courseId when the round has
// one, else the raw (non-empty) courseName, else null. Must match the
// `courseKey` field courseDNA emits, or the drill-down would show a different
// set of rounds than the Course Mastery row that opened it.
export function roundCourseKey(mr) {
  return mr?.round?.courseId ?? (mr?.round?.courseName || null);
}

export function filterRoundsToCourse(myRounds, courseKey) {
  if (courseKey == null) return [];
  return (myRounds || []).filter((mr) => roundCourseKey(mr) === courseKey);
}

// courseRounds: collectMyRounds entries already filtered to one course
// (chronological, oldest first). Returns null when there is nothing to show.
export function buildCourseBreakdown(courseRounds) {
  if (!courseRounds || courseRounds.length === 0) return null;
  const synthetic = buildSyntheticTournament(courseRounds);

  // Round-total metrics share courseMastery/courseDNA exactly (complete
  // rounds only) — reusing them instead of re-deriving keeps the drill-down
  // header identical to the Course Mastery row the user just tapped.
  const mastery = courseMastery(synthetic)[0] ?? null;
  const completeRounds = synthetic.rounds.filter((r) => r.isComplete);
  const dnaCourse = completeRounds.length > 0
    ? (courseDNA({ ...synthetic, rounds: completeRounds })[0]?.courses[0] ?? null)
    : null;

  const dist = playerScoreDistribution(synthetic, CANON_ID);
  const fb = frontBackSplit(synthetic)[0] ?? null;
  const shots = shotStats(synthetic, CANON_ID);
  const holes = buildHoleRows(synthetic);

  return {
    // Latest label wins — same convention as courseDNA's display name.
    courseName: courseRounds[courseRounds.length - 1].courseName,
    summary: {
      rounds: mastery?.rounds ?? 0,
      avgPoints: mastery?.avgPoints ?? null,
      bestPoints: mastery?.bestPoints ?? null,
      trend: mastery?.trend ?? null,
      avgStrokes: dnaCourse?.roundStrokes ?? null,
      holesPlayed: courseRounds.reduce((s, r) => s + (r.holesPlayed ?? 0), 0),
      scoreMix: {
        eagles: dist.eagles, birdies: dist.birdies, pars: dist.pars,
        bogeys: dist.bogeys, doubles: dist.doubles, worse: dist.worse,
        total: dist.total,
      },
      frontBack: fb
        ? { frontAvg: fb.frontAvg, backAvg: fb.backAvg, delta: fb.delta, rounds: fb.rounds.length }
        : null,
    },
    shots: shots.hasData ? shots : null,
    holes,
    highlights: buildHighlights(holes),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

// One row per physical hole, pooled by hole number across every round that
// scored it (courseDNA's partial-rounds-count-their-holes rule). Chronological
// iteration makes par/SI metadata and row order latest-wins.
function buildHoleRows(synthetic) {
  const me = synthetic.players[0];
  const byNumber = new Map();
  let latestOrder = [];

  synthetic.rounds.forEach((round) => {
    const scores = round.scores?.[CANON_ID];
    if (!scores) return;
    const handicap = getPlayingHandicap(round, me);
    (round.holes ?? []).forEach((hole) => {
      const sc = scores[hole.number];
      if (sc == null) return;
      let e = byNumber.get(hole.number);
      if (!e) {
        e = {
          holeNumber: hole.number, timesPlayed: 0, strokesSum: 0, vsParSum: 0,
          pointsSum: 0, bestStrokes: Infinity, puttsSum: 0, puttsCount: 0, penalties: 0,
        };
        byNumber.set(hole.number, e);
      }
      e.par = hole.par;
      e.strokeIndex = hole.strokeIndex ?? null;
      e.timesPlayed += 1;
      e.strokesSum += sc;
      e.vsParSum += sc - hole.par;
      e.pointsSum += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
      if (sc < e.bestStrokes) e.bestStrokes = sc;
      const d = round.shotDetails?.[CANON_ID]?.[hole.number];
      if (d?.putts != null) { e.puttsSum += d.putts; e.puttsCount += 1; }
      e.penalties += (d?.teePenalties ?? 0) + (d?.otherPenalties ?? 0);
    });
    if (round.holes?.length) latestOrder = round.holes.map((h) => h.number);
  });

  // Latest round's hole order first; holes that only exist in older rounds
  // (course edited/renumbered) append in number order.
  const ordered = [];
  const seen = new Set();
  latestOrder.forEach((n) => {
    const e = byNumber.get(n);
    if (e) { ordered.push(e); seen.add(n); }
  });
  [...byNumber.keys()].filter((n) => !seen.has(n)).sort((a, b) => a - b)
    .forEach((n) => ordered.push(byNumber.get(n)));

  return ordered.map((e) => ({
    holeNumber: e.holeNumber,
    par: e.par,
    strokeIndex: e.strokeIndex,
    timesPlayed: e.timesPlayed,
    avgStrokes: round2(e.strokesSum / e.timesPlayed),
    avgVsPar: round2(e.vsParSum / e.timesPlayed),
    avgPoints: round2(e.pointsSum / e.timesPlayed),
    bestStrokes: e.bestStrokes,
    avgPutts: e.puttsCount > 0 ? round1(e.puttsSum / e.puttsCount) : null,
    penalties: e.penalties,
  }));
}

// Nemesis/best claims need at least 2 observations of a hole (one bad day is
// noise, not a nemesis) and at least 2 distinct eligible holes — with one,
// "nemesis" and "best" would be the same row.
const HIGHLIGHT_MIN_ROUNDS = 2;

function buildHighlights(holes) {
  const eligible = holes.filter((h) => h.timesPlayed >= HIGHLIGHT_MIN_ROUNDS);
  if (eligible.length < 2) return null;
  const nemesis = eligible.reduce((m, h) => (h.avgVsPar > m.avgVsPar ? h : m));
  const best = eligible.reduce((m, h) => (h.avgVsPar < m.avgVsPar ? h : m));
  if (nemesis === best) return null;
  return { nemesis, best };
}
