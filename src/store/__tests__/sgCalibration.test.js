// Calibration contract for the per-handicap SG baselines: a typical golfer of
// handicap H, logging a typical round, scores ≈ 0 in every category against
// target H; a better target is always harder; no target clamps.
import { sgTotal, sgReconciliation } from '../statsEngine';
import { HANDICAP_ANCHORS } from '../strokesGainedBaseline';

const { simulateTypicalRounds } = require('../../../scripts/lib/sgBaselineModel');

const CATS = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];
const ROUNDS = 800; // ≈ ±0.08/round Monte-Carlo noise per category (seeded, deterministic).
// If a seed ever lands outside the ±0.3 band, raise ROUNDS — never widen the band.
const perRound = (round, h) => {
  const t = sgTotal(round, 'me', h);
  return Object.fromEntries(CATS.map((c) => [c, t.byCategory[c] / ROUNDS]));
};

describe('typical golfer vs own target', () => {
  [0, 10, 15, 25, 36].forEach((h) => {
    test(`handicap ${h}: every category within ±0.3 strokes/round of zero`, () => {
      const i = HANDICAP_ANCHORS.indexOf(h);
      const sg = perRound(simulateTypicalRounds(i, ROUNDS, 100 + i), h);
      CATS.forEach((c) => expect(Math.abs(sg[c])).toBeLessThan(0.3));
    });
  });
  test('typical 15 gains in every category against a 30 target and loses in every one against scratch', () => {
    const round = simulateTypicalRounds(HANDICAP_ANCHORS.indexOf(15), ROUNDS, 7);
    const vs30 = perRound(round, 30);
    const vs0 = perRound(round, 0);
    CATS.forEach((c) => { expect(vs30[c]).toBeGreaterThan(0.5); expect(vs0[c]).toBeLessThan(-0.5); });
  });
  test('reconciliation expects the typical score of the target, not par + handicap', () => {
    // (The simulator only produces engine-visible strokes, so its score sits
    // below the typical score; the residual identity is covered elsewhere.)
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: { me: { 1: 5 } },
      shotDetails: { me: { 1: { putts: 2, firstPuttBucket: '2-3' } } }, isComplete: true,
    };
    expect(sgReconciliation([round], 'me', 15).perRound[0].expected).toBeCloseTo(4 + 18.4 / 18, 10);
    expect(sgReconciliation([round], 'me', 0).perRound[0].expected).toBeCloseTo(4 + 2.0 / 18, 10);
  });
});

describe('monotone in the target, no clamp', () => {
  // The brief's 15-like round: fairway 125 m, 30 % greens hit to 4.5 m, misses chipped to 1-2 m, 2 putts, one tee penalty.
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const scores = {}; const details = {};
  holes.forEach((h, i) => {
    const green = i % 10 < 3;
    details[h.number] = {
      drive: i % 2 === 0 ? 'fairway' : 'left', driveLie: i % 2 === 0 ? 'fairway' : 'rough',
      driveDistBucket: i % 3 === 0 ? '210-240' : '180-210',
      approachBucket: '100-150', approachResult: green ? 'green' : 'miss',
      putts: 2, firstPuttBucket: green ? '3-6' : '1-2', sandShots: 0, teePenalties: i === 4 ? 1 : 0,
    };
    scores[h.number] = (green ? 4 : 5) + (i === 4 ? 1 : 0);
  });
  const round = { holes, scores: { me: scores }, shotDetails: { me: details }, isComplete: true };

  test('every category is non-decreasing from target 0 to 60', () => {
    let prev = null;
    for (let h = 0; h <= 60; h += 1) {
      const t = sgTotal(round, 'me', h).byCategory;
      if (prev) CATS.forEach((c) => expect(t[c]).toBeGreaterThanOrEqual(prev[c] - 1e-9));
      prev = t;
    }
  });
  test('28, 30 and 40 are three different baselines', () => {
    const a = sgTotal(round, 'me', 28).byCategory, b = sgTotal(round, 'me', 30).byCategory, c = sgTotal(round, 'me', 40).byCategory;
    CATS.forEach((k) => { expect(b[k]).toBeGreaterThan(a[k]); expect(c[k]).toBeGreaterThan(b[k]); });
  });
  test('the brief: a 15 who misses 70 % of greens from 125 m gains on approach against a 30 target', () => {
    expect(sgTotal(round, 'me', 30).byCategory.approach).toBeGreaterThan(2);   // ≈ +3.9
    expect(sgTotal(round, 'me', 0).byCategory.approach).toBeLessThan(0);        // ≈ −1.4
  });
});
