import { teeShotImpact, lagPuttingQuality, sandSaveRate, upAndDownRate, bunkerVisits, sgPutting, sgAroundGreen, sgApproach, sgOffTheTee, sgTotal, sgSeason, driveScoreImpact, puttDeepDive, approachScoreImpact } from '../statsEngine';

// 18 par-4 holes, strokeIndex = hole number.
function holes18() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}

describe('teeShotImpact', () => {
  test('reports no data when no shot detail exists', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(teeShotImpact(t, 'p1').hasData).toBe(false);
  });

  test('separates fairway-hit holes from missed holes by average points', () => {
    const h = holes18();
    // holes 1-2 fairway scoring 4 (par, 2 pts); holes 3-4 missed scoring 6 (0 pts)
    const shotDetails = {
      p1: {
        1: { drive: 'fairway' }, 2: { drive: 'super' },
        3: { drive: 'left' }, 4: { drive: 'right' },
      },
    };
    const scores = { ...evenScores(h, 4) };
    scores[3] = 6; scores[4] = 6;
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.fairway.holes).toBe(2);
    expect(r.fairway.avgPoints).toBe(2);
    expect(r.missed.holes).toBe(2);
    expect(r.missed.avgPoints).toBe(0);
    expect(r.byDirection.left.holes).toBe(1);
    expect(r.byDirection.right.holes).toBe(1);
  });

  test('ignores par 3 holes', () => {
    const h = holes18().map((hole, i) => (i === 0 ? { ...hole, par: 3 } : hole));
    const shotDetails = { p1: { 1: { drive: 'fairway' } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    expect(teeShotImpact(t, 'p1').fairway.holes).toBe(0);
  });

  test('measures tee-penalty holes against tracked penalty-free holes', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[1] = 6; // penalty hole scores worse
    // Every hole has shot detail: hole 1 took a tee penalty, the rest are clean.
    const shotDetails = { p1: {} };
    h.forEach((hole) => {
      shotDetails.p1[hole.number] = hole.number === 1
        ? { teePenalties: 1 }
        : { drive: 'fairway' };
    });
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.teePenalty.holes).toBe(1);
    expect(r.teePenalty.penaltyCount).toBe(1);
    expect(r.teePenalty.avgPoints).toBe(0);     // hole 1: 6 on par 4 → 0 pts
    expect(r.withoutPenalty.holes).toBe(17);    // holes 2-18, tracked, no penalty
    expect(r.withoutPenalty.avgPoints).toBe(2); // par → 2 pts each
    expect(r.penaltyDrag).toBe(2);              // 2 - 0
  });

  test('untracked holes do not pad the penalty-free baseline', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[1] = 6;
    // Only hole 1 has shot detail (a tee penalty); holes 2-18 are untracked.
    const shotDetails = { p1: { 1: { teePenalties: 1 } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.withoutPenalty.holes).toBe(0); // untracked holes are not counted
    expect(r.penaltyDrag).toBe(0);          // no clean baseline → no drag figure
  });
});

// ── lagPuttingQuality helpers ──
const makeRound = (holes, details, playerId = 'me') => ({
  holes: holes.map((h, i) => ({ number: i + 1, par: h.par, strokeIndex: i + 1 })),
  scores: { [playerId]: Object.fromEntries(holes.map((h, i) => [i + 1, h.strokes])) },
  shotDetails: { [playerId]: Object.fromEntries(details.map((d, i) => [i + 1, d])) },
});

describe('lagPuttingQuality', () => {
  test('returns null per bucket below 12-putt threshold', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['2-3']).toBeNull();
  });

  test('aggregates putts per bucket above threshold', () => {
    const holes = Array.from({ length: 12 }, () => ({ par: 4, strokes: 4 }));
    const details = Array.from({ length: 12 }, () => ({ putts: 2, firstPuttBucket: '2-3' }));
    const round = makeRound(holes, details);
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['2-3']).toBeCloseTo(2.0);
    expect(result.sample.perBucket['2-3']).toBe(12);
  });
});

describe('sandSaveRate', () => {
  test('returns null below 4-attempt threshold', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: 'sand-save' }],
    );
    expect(sandSaveRate([round], 'me').rate).toBeNull();
  });

  test('counts saves over sand-shot attempts on missed-GIR holes', () => {
    const rounds = Array.from({ length: 5 }, (_, i) => makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: i < 3 ? 'sand-save' : 'none' }],
    ));
    const r = sandSaveRate(rounds, 'me');
    expect(r.attempts).toBe(5);
    expect(r.saves).toBe(3);
    expect(r.rate).toBeCloseTo(0.6);
  });
});

describe('bunkerVisits', () => {
  test('counts sand shots and holes-with-sand per round', () => {
    const round = makeRound(
      [
        { par: 4, strokes: 5 },
        { par: 4, strokes: 4 },
        { par: 5, strokes: 7 },
      ],
      [
        { putts: 1, sandShots: 2 },
        { putts: 2, sandShots: 0 },
        { putts: 2, sandShots: 1 },
      ],
    );
    const r = bunkerVisits([round, round], 'me');
    expect(r.totalShots).toBe(6);
    expect(r.holesWithSand).toBe(4);
    expect(r.avgPerRound).toBeCloseTo(3.0);          // 6 sand shots / 2 rounds
  });
});

describe('upAndDownRate', () => {
  test('returns null below 6 missed-GIR holes', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 0, recoveryOutcome: 'up-and-down' }],
    );
    expect(upAndDownRate([round], 'me').rate).toBeNull();
  });

  test('splits conversions by sand vs non-sand', () => {
    const rounds = Array.from({ length: 8 }, (_, i) => makeRound(
      [{ par: 4, strokes: 5 }],
      [{
        putts: 1,
        sandShots: i % 2,                  // alternate
        recoveryOutcome: i < 4 ? (i % 2 ? 'sand-save' : 'up-and-down') : 'none',
      }],
    ));
    const r = upAndDownRate(rounds, 'me');
    expect(r.attempts).toBe(8);
    expect(r.conversions).toBe(4);
    expect(r.rate).toBeCloseTo(0.5);
    expect(r.byLie.sand.attempts).toBe(4);
    expect(r.byLie.sand.conversions).toBe(2);
    expect(r.byLie.nonSand.attempts).toBe(4);
    expect(r.byLie.nonSand.conversions).toBe(2);
  });
});

describe('sgAroundGreen', () => {
  test('null on GIR-hit holes', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, sandShots: 0, firstPuttBucket: '2-3' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0]).toBeNull();
  });
  test('SG = expected(start lie, ~20m) - expected(green, putt bucket) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    // start: sand @18.3m=2.55, @27.4m=2.70; t=(20-18.3)/(27.4-18.3)≈0.187 → 2.578
    // end: green @0.5m clamp → 1.05. SG = 2.578 - 1.05 - 1 ≈ 0.53
    const r = sgAroundGreen(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.53, 1);
  });
});

describe('sgApproach', () => {
  test('null on par-3', () => {
    const round = makeRound(
      [{ par: 3, strokes: 3 }],
      [{ putts: 1, approachBucket: null }],
    );
    expect(sgApproach(round, 'me').perHole[0]).toBeNull();
  });
  test('GIR hit from 100-150 bucket → SG = expected(fairway, 125) - expected(green, putt midpoint) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    // fairway@125: interp between 91.4(2.80) and 137.2(2.92): t≈0.734 → 2.888
    // green@4.5m: interp between 3.05(1.70) and 4.57(1.83): t≈0.954 → 1.824
    // SG = 2.888 - 1.824 - 1 ≈ 0.064
    const r = sgApproach(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.06, 1);
  });
});

describe('sgOffTheTee', () => {
  test('fairway drive on a 400m par-4 → SG ≈ +0.60', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    const r = sgOffTheTee(round, 'me');
    // tee@400: interp between 365.8(4.29) and 411.5(4.55): t≈0.749 → 4.485
    // fairway@125: ≈ 2.888. SG = 4.485 - 2.888 - 1 ≈ 0.597
    expect(r.perHole[0]).toBeCloseTo(0.60, 1);
  });
  test('tee penalty drags SG below -0.5', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 6 } },
      shotDetails: { me: { 1: { drive: 'left', teePenalties: 1, approachBucket: '100-150' } } },
    };
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeLessThan(-0.5);
  });
});

describe('sgPutting', () => {
  test('returns null per hole when firstPuttBucket missing', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2 }],
    );
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeNull();
    expect(r.sampleHoles).toBe(0);
  });
  test('SG = expectedStrokes(green, midpoint) - putts on a 2-putt from 2-3', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    // midpoint 2.5m: interp between 1.83(1.50) and 3.05(1.70): t≈0.548 → 1.61 → SG = 1.61 − 2 = −0.39
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(-0.39, 1);
    expect(r.sampleHoles).toBe(1);
  });
});

describe('sgTotal', () => {
  test('sums the four categories', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6',
        sandShots: 0,
      } } },
    };
    const r = sgTotal(round, 'me');
    expect(r.total).toBeCloseTo(
      r.byCategory.tee + r.byCategory.approach + r.byCategory.aroundGreen + r.byCategory.putting,
      5,
    );
    expect(r.sampleHoles).toBeGreaterThan(0);
  });
});

describe('sgOffTheTee with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    expect(sgOffTheTee(round, 'me').perHole[0])
      .toBeCloseTo(sgOffTheTee(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG up', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    const scratchSG = sgOffTheTee(round, 'me', 0).perHole[0];
    const amateurSG = sgOffTheTee(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgPutting with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    expect(sgPutting(round, 'me').perHole[0])
      .toBeCloseTo(sgPutting(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap → less-negative SG (bar is lower)', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    const scratchSG = sgPutting(round, 'me', 0).perHole[0];
    const amateurSG = sgPutting(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgAroundGreen with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0])
      .toBeCloseTo(sgAroundGreen(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG toward less-negative', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    const scratchSG = sgAroundGreen(round, 'me', 0).perHole[0];
    const amateurSG = sgAroundGreen(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgApproach with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    expect(sgApproach(round, 'me').perHole[0])
      .toBeCloseTo(sgApproach(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG toward zero or positive', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    const scratchSG = sgApproach(round, 'me', 0).perHole[0];
    const amateurSG = sgApproach(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgTotal with targetHandicap', () => {
  test('threads targetHandicap into all four categories', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      } } },
    };
    const r0 = sgTotal(round, 'me', 0);
    const r14 = sgTotal(round, 'me', 14);
    expect(r14.total).toBeGreaterThan(r0.total);
    expect(r14.total).toBeCloseTo(
      r14.byCategory.tee + r14.byCategory.approach
      + r14.byCategory.aroundGreen + r14.byCategory.putting,
      5,
    );
  });
});

describe('sgSeason with targetHandicap', () => {
  test('threads targetHandicap through sgTotal', () => {
    const mkRound = () => ({
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      }])) },
    });
    const r0 = sgSeason([mkRound(), mkRound()], 'me', 0);
    const r14 = sgSeason([mkRound(), mkRound()], 'me', 14);
    expect(r14.total).toBeGreaterThan(r0.total);
  });
});

describe('sgSeason', () => {
  test('returns null total below 18-hole sample', () => {
    expect(sgSeason([], 'me').total).toBeNull();
  });
  test('aggregates across rounds when enough sample holes exist', () => {
    const mkRound = () => ({
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6',
        sandShots: 0,
      }])) },
    });
    const r = sgSeason([mkRound(), mkRound()], 'me');
    expect(r.perRound.length).toBe(2);
    expect(r.sampleHoles).toBeGreaterThanOrEqual(18);
    expect(r.total).not.toBeNull();
  });
});

describe('driveScoreImpact', () => {
  test('reports no data when no drives are logged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    const r = driveScoreImpact(t, 'p1');
    expect(r.hasData).toBe(false);
    expect(r.totalHoles).toBe(0);
  });

  test('aggregates points, strokes-vs-par and penalty rate per bucket', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[5] = 5; scores[6] = 5;   // left: bogey
    scores[7] = 6; scores[8] = 6;   // right: double
    scores[9] = 5; scores[10] = 5;  // short: bogey
    const shotDetails = {
      p1: {
        1: { drive: 'super' }, 2: { drive: 'super' },
        3: { drive: 'fairway' }, 4: { drive: 'fairway' },
        5: { drive: 'left', teePenalties: 1 }, 6: { drive: 'left' },
        7: { drive: 'right' }, 8: { drive: 'right' },
        9: { drive: 'short' }, 10: { drive: 'short' },
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = driveScoreImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.totalHoles).toBe(10);
    expect(r.buckets.super).toMatchObject({ holes: 2, avgPoints: 2, avgVsPar: 0, penaltyRate: 0 });
    expect(r.buckets.fairway).toMatchObject({ holes: 2, avgPoints: 2, avgVsPar: 0, penaltyRate: 0 });
    expect(r.buckets.left).toMatchObject({ holes: 2, avgPoints: 1, avgVsPar: 1, penaltyRate: 50 });
    expect(r.buckets.right).toMatchObject({ holes: 2, avgPoints: 0, avgVsPar: 2, penaltyRate: 0 });
    expect(r.buckets.short).toMatchObject({ holes: 2, avgPoints: 1, avgVsPar: 1, penaltyRate: 0 });
  });

  test('ignores par-3 holes (no driver off the tee)', () => {
    const h = holes18().map((hole, i) => (i === 0 ? { ...hole, par: 3 } : hole));
    const shotDetails = { p1: { 1: { drive: 'fairway' } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    expect(driveScoreImpact(t, 'p1').buckets.fairway.holes).toBe(0);
  });
});

describe('puttDeepDive', () => {
  test('reports no data when no putts are logged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(puttDeepDive(t, 'p1').hasData).toBe(false);
  });

  test('breaks down 2-putt rate, GIR vs non-GIR averages, and 1-putt save rate', () => {
    const h = holes18();
    // 1-6:  4 strokes / 2 putts (GIR, 2-putt)
    // 7-9:  5 strokes / 1 putt  (non-GIR, 1-putt save)
    // 10-12: 5 strokes / 2 putts (non-GIR, 2-putt)
    // 13-15: 4 strokes / 3 putts (GIR, 3-putt)
    // 16-18: untracked
    const scores = { ...evenScores(h, 4) };
    [7, 8, 9, 10, 11, 12].forEach((n) => { scores[n] = 5; });
    const shotDetails = { p1: {} };
    [1, 2, 3, 4, 5, 6].forEach((n) => { shotDetails.p1[n] = { putts: 2 }; });
    [7, 8, 9].forEach((n) => { shotDetails.p1[n] = { putts: 1 }; });
    [10, 11, 12].forEach((n) => { shotDetails.p1[n] = { putts: 2 }; });
    [13, 14, 15].forEach((n) => { shotDetails.p1[n] = { putts: 3 }; });
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = puttDeepDive(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.holes).toBe(15);
    // 9 two-putt holes (1-6 and 10-12) / 15 = 60%
    expect(r.twoPuttPct).toBe(60);
    // GIR holes: 1-6 (2 putts × 6) + 13-15 (3 putts × 3) = 21 putts / 9 holes ≈ 2.3
    expect(r.girHoles).toBe(9);
    expect(r.girPuttsAvg).toBe(2.3);
    // Non-GIR: 7-9 (1 × 3) + 10-12 (2 × 3) = 9 putts / 6 holes = 1.5
    expect(r.nonGirHoles).toBe(6);
    expect(r.nonGirPuttsAvg).toBe(1.5);
    // 1-putt save rate: 3 non-GIR 1-putts / 6 non-GIR = 50%
    expect(r.onePuttSave).toMatchObject({ attempts: 6, saves: 3, pct: 50 });
    // All tracked holes are par 4
    expect(r.byPar[3]).toBeNull();
    expect(r.byPar[4]).toMatchObject({ holes: 15, avg: 2 });
    expect(r.byPar[5]).toBeNull();
  });

  test('splits avg putts by par when the round mixes par 3 / 4 / 5', () => {
    const h = holes18().map((hole, i) => {
      if (i === 0) return { ...hole, par: 3 };
      if (i === 1) return { ...hole, par: 5 };
      return hole;
    });
    const scores = { ...evenScores(h, 4) };
    scores[1] = 3; scores[2] = 5;
    const shotDetails = {
      p1: {
        1: { putts: 1 },        // par 3
        2: { putts: 2 },        // par 5
        3: { putts: 2 },        // par 4
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = puttDeepDive(t, 'p1');
    expect(r.byPar[3]).toMatchObject({ holes: 1, avg: 1 });
    expect(r.byPar[4]).toMatchObject({ holes: 1, avg: 2 });
    expect(r.byPar[5]).toMatchObject({ holes: 1, avg: 2 });
  });
});

describe('approachScoreImpact', () => {
  test('reports no data when no approach buckets are tagged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(approachScoreImpact(t, 'p1').hasData).toBe(false);
  });

  test('aggregates points, strokes-vs-par and GIR rate per bucket', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[4] = 5; scores[5] = 5;   // 100-150 bogeys (non-GIR with 2 putts)
    scores[8] = 6;                  // 200+ double (non-GIR with 2 putts)
    const shotDetails = {
      p1: {
        1: { approachBucket: '100-150', putts: 2 },  // par with 2 putts → GIR
        2: { approachBucket: '100-150', putts: 2 },
        3: { approachBucket: '100-150', putts: 2 },
        4: { approachBucket: '100-150', putts: 2 },  // bogey, non-GIR
        5: { approachBucket: '100-150', putts: 2 },
        6: { approachBucket: '0-50',    putts: 2 },  // par, GIR
        7: { approachBucket: '0-50',    putts: 2 },
        8: { approachBucket: '200+',    putts: 2 },  // double, non-GIR
        9: { approachBucket: '150-200' },            // no putts → GIR not computable
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = approachScoreImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.totalHoles).toBe(9);

    // 100-150: 5 holes; 3 pars + 2 bogeys → avg pts 1.6, avg vs par 0.4, GIR 3/5 = 60%
    expect(r.buckets['100-150']).toMatchObject({
      holes: 5, avgPoints: 1.6, avgVsPar: 0.4, girRate: 60, girEligible: 5,
    });
    expect(r.buckets['0-50']).toMatchObject({
      holes: 2, avgPoints: 2, avgVsPar: 0, girRate: 100,
    });
    expect(r.buckets['200+']).toMatchObject({
      holes: 1, avgPoints: 0, avgVsPar: 2, girRate: 0,
    });
    // 150-200 has the hole counted, but GIR not computable without putts.
    expect(r.buckets['150-200']).toMatchObject({
      holes: 1, avgPoints: 2, avgVsPar: 0, girRate: null, girEligible: 0,
    });
    expect(r.buckets['50-100'].holes).toBe(0);
  });
});
