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

describe('buildCourseBreakdown holes', () => {
  test('pools each hole across rounds: averages, best score, latest-wins metadata', () => {
    const h1 = mkHoles(18);
    // Second visit: hole 1 re-labelled par 5, SI unchanged.
    const h2 = mkHoles(18).map((h) => (h.number === 1 ? { ...h, par: 5 } : h));
    const s1 = evenScores(h1, 5); // hole 1: 5 (+1 on par 4)
    const s2 = evenScores(h2, 4); // hole 1: 4 (-1 on par 5)
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', holes: h1, scores: { p1: s1 } }),
      mkRound({ courseId: 'c-1', holes: h2, scores: { p1: s2 } }),
    ]);
    const { holes } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(holes).toHaveLength(18);
    const hole1 = holes[0];
    expect(hole1).toMatchObject({
      holeNumber: 1,
      par: 5,               // latest round's metadata wins
      strokeIndex: 1,
      timesPlayed: 2,
      avgStrokes: 4.5,
      avgVsPar: 0,          // (+1 + -1) / 2
      bestStrokes: 4,
    });
    // hole 2 (par 4 both rounds): 5 then 4 → avgVsPar +0.5, points (1+2)/2
    expect(holes[1]).toMatchObject({ avgVsPar: 0.5, avgPoints: 1.5, bestStrokes: 4 });
  });

  test('partial rounds contribute only their scored holes', () => {
    const h = mkHoles(18);
    const partial = evenScores(h, 6);
    delete partial[18];
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 4) } }),
      mkRound({ courseId: 'c-1', scores: { p1: partial } }),
    ]);
    const { holes } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(holes[0].timesPlayed).toBe(2);
    expect(holes[17].timesPlayed).toBe(1);   // hole 18 unscored in round 2
    expect(holes[17].avgStrokes).toBe(4);
  });

  test('per-hole putts average and penalty totals; null putts when never logged', () => {
    const h = mkHoles(18);
    const d1 = { 1: { putts: 3, teePenalties: 1 }, 2: { putts: 2 } };
    const d2 = { 1: { putts: 1, otherPenalties: 1 } };
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) }, shotDetails: { p1: d1 } }),
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) }, shotDetails: { p1: d2 } }),
    ]);
    const { holes } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(holes[0].avgPutts).toBe(2);       // (3+1)/2
    expect(holes[0].penalties).toBe(2);      // 1 tee + 1 other
    expect(holes[1].avgPutts).toBe(2);       // logged once
    expect(holes[2].avgPutts).toBeNull();
    expect(holes[2].penalties).toBe(0);
  });

  test('9-hole course produces 9 rows', () => {
    const h = mkHoles(9);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-9', holes: h, scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-9')).holes).toHaveLength(9);
  });
});

describe('buildCourseBreakdown highlights', () => {
  test('nemesis is the worst pooled hole, best the lowest, needing 2+ rounds per hole', () => {
    const h = mkHoles(18);
    const bad = evenScores(h, 5);
    bad[7] = 8;   // hole 7 blows up both rounds
    const good = evenScores(h, 5);
    good[7] = 8;
    good[3] = 3;  // hole 3 shines once
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: bad } }),
      mkRound({ courseId: 'c-1', scores: { p1: good } }),
    ]);
    const { highlights } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(highlights.nemesis.holeNumber).toBe(7);
    expect(highlights.best.holeNumber).toBe(3);
  });

  test('a single-round course makes no highlight claim', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1')).highlights).toBeNull();
  });
});
