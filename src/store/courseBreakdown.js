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
  shotStats, playerScoreDistribution, courseDNA,
} from './statsEngine';

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

  // Gross classification (metric: 'strokes') — the score mix answers "what
  // did I actually shoot on this course", so handicap shots must not
  // upgrade a bogey to a par.
  const dist = playerScoreDistribution(synthetic, CANON_ID, { metric: 'strokes' });
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
      // The course record proper: fewest gross strokes in a complete round
      // here. Gross, so unlike bestPoints it holds its meaning across a
      // handicap change — the same round stays the best round for life.
      bestStrokes: dnaCourse?.roundTotals?.length
        ? dnaCourse.roundTotals.reduce((m, e) => Math.min(m, e.strokes), Infinity)
        : null,
      holesPlayed: courseRounds.reduce((s, r) => s + (r.holesPlayed ?? 0), 0),
      scoreMix: {
        eagles: dist.eagles, birdies: dist.birdies, pars: dist.pars,
        bogeys: dist.bogeys, doubles: dist.doubles, worse: dist.worse,
        total: dist.total,
      },
      frontBack: grossFrontBack(synthetic),
    },
    shots: shots.hasData ? shots : null,
    rounds: buildRoundRows(courseRounds),
    holes,
    highlights: buildHighlights(holes),
  };
}

// ── Latest rounds ──
// The rounds actually played here, newest first, each carrying the ids the
// RoundSummary screen needs to open it. Unlike every aggregate above this
// keeps INCOMPLETE rounds: "the last time I played here" is a fact about the
// day, not a round-total metric, and the row says how many holes it was.
// Strokes are gross and summed over the scored holes only — a partial round's
// total is a partial total, flagged as such by `isComplete`.
const RECENT_ROUNDS_LIMIT = 10;

function buildRoundRows(courseRounds) {
  return [...courseRounds].reverse().slice(0, RECENT_ROUNDS_LIMIT).map((mr) => {
    const scores = mr.round?.scores?.[mr.playerId] ?? {};
    let strokes = 0;
    (mr.round?.holes ?? []).forEach((hole) => {
      const sc = scores[hole.number];
      if (sc != null) strokes += sc;
    });
    return {
      key: mr.key,
      tournamentId: mr.tournamentId,
      tournamentName: mr.tournamentName,
      // null for a legacy round with no id — the row still renders, it just
      // can't be opened (RoundSummary is addressed by roundId).
      roundId: mr.round?.id ?? null,
      date: mr.tournamentDate ?? null,
      points: mr.points,
      strokes,
      holesPlayed: mr.holesPlayed ?? 0,
      isComplete: !!mr.isComplete,
    };
  });
}

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

// Gross strokes vs par on each nine, averaged over the rounds where BOTH
// nines were fully scored (statsEngine.frontBackSplit's rule, which this
// replaces here).
//
// It used to report Stableford points per hole, and that was the most badly
// contaminated figure on the screen. Points hide a handicap change unevenly
// across the two nines: a course handicap of 18 hands a shot to every hole —
// nine on each nine, perfectly balanced — while a handicap of 9 hands them to
// stroke indexes 1-9 only, and those are not evenly split between the front
// and the back. So a falling handicap skewed the front-vs-back DELTA itself,
// not merely both levels together, and the card could report a "stronger
// finish" that was purely an artefact of the stroke-index layout.
//
// delta is frontVsPar - backVsPar: positive means the back nine is played in
// fewer strokes over par, i.e. a stronger finisher — the same polarity
// frontBackSplit's points delta had.
function grossFrontBack(synthetic) {
  let front = 0;
  let back = 0;
  let rounds = 0;
  (synthetic.rounds ?? []).forEach((round) => {
    const scores = round.scores?.[CANON_ID];
    if (!scores || (round.holes?.length ?? 0) < 18) return;
    let f = 0;
    let b = 0;
    let fc = 0;
    let bc = 0;
    round.holes.forEach((hole) => {
      const sc = scores[hole.number];
      if (sc == null) return;
      if (hole.number <= 9) { f += sc - hole.par; fc += 1; } else { b += sc - hole.par; bc += 1; }
    });
    if (fc < 9 || bc < 9) return;
    front += f;
    back += b;
    rounds += 1;
  });
  if (rounds === 0) return null;
  return {
    frontVsPar: round1(front / rounds),
    backVsPar: round1(back / rounds),
    delta: round1((front - back) / rounds),
    rounds,
  };
}

// One row per physical hole, pooled by hole number across every round that
// scored it (courseDNA's partial-rounds-count-their-holes rule). Chronological
// iteration makes par/SI metadata and row order latest-wins.
//
// `birdies`/`eagles` count how many times the hole was played under par, so
// the grid can filter down to "where do I actually make birdies here".
//
// Every figure here is GROSS. A net points-per-hole average used to sit
// alongside them, but pooling net points across rounds played off different
// handicaps averages together holes that were worth different amounts for the
// same score — and avgVsPar, which already colours the grid, says the same
// thing exactly.
function buildHoleRows(synthetic) {
  const byNumber = new Map();
  let latestOrder = [];

  synthetic.rounds.forEach((round) => {
    const scores = round.scores?.[CANON_ID];
    if (!scores) return;
    (round.holes ?? []).forEach((hole) => {
      const sc = scores[hole.number];
      if (sc == null) return;
      let e = byNumber.get(hole.number);
      if (!e) {
        e = {
          holeNumber: hole.number, timesPlayed: 0, strokesSum: 0, vsParSum: 0,
          bestStrokes: Infinity, puttsSum: 0, puttsCount: 0, penalties: 0,
          birdies: 0, eagles: 0,
        };
        byNumber.set(hole.number, e);
      }
      e.par = hole.par;
      e.strokeIndex = hole.strokeIndex ?? null;
      e.timesPlayed += 1;
      e.strokesSum += sc;
      e.vsParSum += sc - hole.par;
      // Gross vs par, same cut points as playerScoreDistribution's strokes
      // metric — an albatross counts as an eagle here, not its own tier.
      if (sc - hole.par <= -2) e.eagles += 1;
      else if (sc - hole.par === -1) e.birdies += 1;
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
    bestStrokes: e.bestStrokes,
    avgPutts: e.puttsCount > 0 ? round1(e.puttsSum / e.puttsCount) : null,
    penalties: e.penalties,
    birdies: e.birdies,
    eagles: e.eagles,
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
