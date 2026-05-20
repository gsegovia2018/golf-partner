import { teeShotImpact, lagPuttingQuality, sandSaveRate, upAndDownRate, bunkerVisits, sgPutting, sgAroundGreen, sgApproach, sgOffTheTee } from '../statsEngine';

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
      [{ putts: 2, firstPuttBucket: '6-10' }],
    );
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['6-10']).toBeNull();
  });

  test('aggregates putts per bucket above threshold', () => {
    const holes = Array.from({ length: 12 }, () => ({ par: 4, strokes: 4 }));
    const details = Array.from({ length: 12 }, () => ({ putts: 2, firstPuttBucket: '6-10' }));
    const round = makeRound(holes, details);
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['6-10']).toBeCloseTo(2.0);
    expect(result.sample.perBucket['6-10']).toBe(12);
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
      [{ putts: 2, sandShots: 0, firstPuttBucket: '6-10' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0]).toBeNull();
  });
  test('SG = expected(start lie, ~20y) - expected(green, putt bucket) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-3', recoveryOutcome: 'sand-save' }],
    );
    // start: sand @20y = 2.55. end: green @1.5ft clamp → 1.05. SG = 2.55 - 1.05 - 1 = 0.50
    const r = sgAroundGreen(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.50, 1);
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
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '10-20' }],
    );
    // expected(fairway, 125) ≈ 2.86. expected(green, 15ft) = 1.83. SG = 2.86 - 1.83 - 1 = 0.03
    const r = sgApproach(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.03, 1);
  });
});

describe('sgOffTheTee', () => {
  test('fairway drive on a 400y par-4 → SG ≈ +0.43', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    const r = sgOffTheTee(round, 'me');
    // expected(tee, 400) ≈ 4.29. expected(fairway, 125) ≈ 2.86. SG ≈ 4.29 - 2.86 - 1 ≈ 0.43.
    expect(r.perHole[0]).toBeCloseTo(0.43, 1);
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
  test('SG = expectedStrokes(green, midpoint) - putts on a 2-putt from 6-10', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '6-10' }],
    );
    // midpoint 8ft interpolates to ~1.60 → SG = 1.60 − 2 = −0.40
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(-0.40, 1);
    expect(r.sampleHoles).toBe(1);
  });
});
