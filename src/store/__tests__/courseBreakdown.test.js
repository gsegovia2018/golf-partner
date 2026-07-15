import { collectMyRounds } from '../personalStats';
import {
  roundCourseKey, filterRoundsToCourse, buildCourseBreakdown,
} from '../courseBreakdown';

// ── Fixture helpers (same conventions as personalStats.test.js) ──
// par 4 everywhere, SI = hole number, handicap 0 → strokes 5 = 1 pt, 4 = 2 pts.
function mkHoles(n) {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}
function mkRound({ courseId, courseName = 'Pine', holes = mkHoles(18), scores, shotDetails = {} }) {
  return { courseId, courseName, holes, scores, shotDetails, playerHandicaps: {} };
}
function myRoundsFor(rounds) {
  const t = {
    id: 1, name: 'T',
    players: [{ id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' }],
    rounds,
  };
  return collectMyRounds([t], 'u1');
}

describe('roundCourseKey / filterRoundsToCourse', () => {
  test('keys by courseId first, so a rename does not split the course', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', courseName: 'Pine', scores: { p1: evenScores(h, 5) } }),
      mkRound({ courseId: 'c-1', courseName: 'Pine Valley GC', scores: { p1: evenScores(h, 4) } }),
      mkRound({ courseId: 'c-2', courseName: 'Oak', scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(filterRoundsToCourse(rounds, 'c-1')).toHaveLength(2);
    expect(filterRoundsToCourse(rounds, 'c-2')).toHaveLength(1);
  });

  test('falls back to courseName for library-less courses; null key matches nothing', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseName: 'Oak', scores: { p1: evenScores(h, 5) } }),
      { holes: h, scores: { p1: evenScores(h, 5) }, shotDetails: {}, playerHandicaps: {} }, // unnamed
    ]);
    expect(roundCourseKey(rounds[0])).toBe('Oak');
    expect(roundCourseKey(rounds[1])).toBeNull();
    expect(filterRoundsToCourse(rounds, 'Oak')).toHaveLength(1);
    expect(filterRoundsToCourse(rounds, null)).toHaveLength(0);
  });
});

describe('buildCourseBreakdown summary', () => {
  test('returns null for an empty course', () => {
    expect(buildCourseBreakdown([])).toBeNull();
    expect(buildCourseBreakdown(null)).toBeNull();
  });

  test('round-total metrics come from complete rounds and match courseMastery scale', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }), // 18 pts, 90 strokes
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 4) } }), // 36 pts, 72 strokes
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(b.summary.rounds).toBe(2);
    expect(b.summary.avgPoints).toBe(27);      // (18+36)/2, courseMastery's roundPoints
    expect(b.summary.bestPoints).toBe(36);
    expect(b.summary.trend).toBe(1);           // 36 vs 18, above the ±2 noise band
    expect(b.summary.avgStrokes).toBe(81);     // (90+72)/2
    expect(b.summary.holesPlayed).toBe(36);
  });

  test('a partial round contributes holes but not round-total metrics', () => {
    const h = mkHoles(18);
    const partial = evenScores(h, 5);
    delete partial[18];
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }),
      mkRound({ courseId: 'c-1', scores: { p1: partial } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(b.summary.rounds).toBe(1);           // only the complete round
    expect(b.summary.holesPlayed).toBe(35);     // but every scored hole counts
    expect(b.summary.scoreMix.total).toBe(35);
  });

  test('courseName is the most recent label; score mix and front/back populate', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', courseName: 'Pine', scores: { p1: evenScores(h, 4) } }),
      mkRound({ courseId: 'c-1', courseName: 'Pine Valley GC', scores: { p1: evenScores(h, 5) } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(b.courseName).toBe('Pine Valley GC');
    expect(b.summary.scoreMix).toMatchObject({ pars: 18, bogeys: 18, total: 36 });
    expect(b.summary.frontBack).toMatchObject({ frontAvg: 1.5, backAvg: 1.5, rounds: 2 });
  });

  test('frontBack is null for a 9-hole course', () => {
    const h = mkHoles(9);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-9', holes: h, scores: { p1: evenScores(h, 5) } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-9'));
    expect(b.summary.frontBack).toBeNull();
    expect(b.summary.rounds).toBe(1);
  });

  test('shots is null without shot detail, populated when logged', () => {
    const h = mkHoles(18);
    const noDetail = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(buildCourseBreakdown(filterRoundsToCourse(noDetail, 'c-1')).shots).toBeNull();

    const detail = {};
    h.forEach((hole) => { detail[hole.number] = { putts: 2, drive: 'fairway' }; });
    const withDetail = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) }, shotDetails: { p1: detail } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(withDetail, 'c-1'));
    expect(b.shots.hasData).toBe(true);
    expect(b.shots.putts.perRound).toBe(36);
    expect(b.shots.drives.fairwayPct).toBe(100);
  });
});
