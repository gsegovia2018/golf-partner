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

// Implemented in the next task.
function buildHoleRows() {
  return [];
}
function buildHighlights() {
  return null;
}
