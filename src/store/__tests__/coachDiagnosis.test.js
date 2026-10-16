import {
  buildDiagnosis, confidenceOf, compareLeaks, tieBand,
  LEAK_MIN, TIE_MIN, CATEGORY_MIN_HOLES, CATEGORY_MIN_ROUNDS, BUCKET_MIN_SHOTS, TRAINABILITY,
} from '../coachDiagnosis';
import { SG_CATEGORIES } from '../coachMetrics';
import { collectMyRounds, computeMyStats } from '../personalStats';

// Stats slice the diagnosis reads. `cats` gives each category's per-round SG
// (one entry per round; null = round did not sample it); `holes` is the
// sampled holes per round. Buckets take per-shot SG lists.
function makeStats({ cats = {}, holes = 18, putting = {}, approach = {}, targetHandicap = 15 } = {}) {
  const roundCount = Math.max(0, ...Object.values(cats).map((a) => a.length));
  const perRound = Array.from({ length: roundCount }, (_, i) => {
    const byCategory = {};
    const sampleHolesByCategory = {};
    SG_CATEGORIES.forEach((c) => {
      const v = cats[c]?.[i];
      byCategory[c] = Number.isFinite(v) ? v : 0;
      sampleHolesByCategory[c] = Number.isFinite(v) ? holes : 0;
    });
    return { index: i, total: 0, sampleHoles: holes, byCategory, sampleHolesByCategory };
  });
  const bucketsOf = (lists, field) => Object.fromEntries(Object.entries(lists).map(([b, sgs]) => [b, {
    [field]: sgs.length,
    breakdown: sgs.map((sg) => ({ sg })),
  }]));
  return {
    targetHandicap,
    strokesGained: { perRound },
    puttingTarget: { buckets: bucketsOf(putting, 'attempts') },
    approachTarget: { buckets: bucketsOf(approach, 'holes') },
  };
}

// n values around `mean` with ± spread (alternating), so mean is exact.
function around(mean, spread, count = 6) {
  return Array.from({ length: count }, (_, i) => {
    if (count % 2 === 1 && i === count - 1) return mean;
    return mean + (i % 2 === 0 ? spread : -spread);
  });
}
const repeat = (value, count) => Array.from({ length: count }, () => value);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

describe('constants', () => {
  test('floor, tie band, gates and trainability order are pinned', () => {
    expect(LEAK_MIN).toBe(0.4);
    expect(TIE_MIN).toBe(0.3);
    expect(CATEGORY_MIN_HOLES).toBe(10);
    expect(CATEGORY_MIN_ROUNDS).toBe(3);
    expect(BUCKET_MIN_SHOTS).toBe(8);
    expect(TRAINABILITY).toEqual(['putting', 'aroundGreen', 'approach', 'penalties', 'offTheTee']);
  });

  test('confidence: high at 2·se, medium at 1·se, low below', () => {
    expect(confidenceOf(-0.5, 0.25)).toBe('high');
    expect(confidenceOf(-0.49, 0.25)).toBe('medium');
    expect(confidenceOf(0.25, 0.25)).toBe('medium');
    expect(confidenceOf(-0.24, 0.25)).toBe('low');
    expect(confidenceOf(-0.5, null)).toBe('low');
  });

  test('tie band is max(0.3, se₁ + se₂)', () => {
    expect(tieBand({ se: 0.1 }, { se: 0.1 })).toBe(0.3);
    expect(tieBand({ se: 0.25 }, { se: 0.2 })).toBeCloseTo(0.45, 10);
  });
});

describe('leak tree', () => {
  test('a category beats its own bucket: one leak, priced at the category', () => {
    // The 150-200 bucket alone is −0.5 × 20 shots / 6 rounds ≈ −1.67 / round,
    // worse than its category; it explains the leak, it never competes with it.
    const d = buildDiagnosis(makeStats({
      cats: { approach: around(-0.6, 0.1), putting: around(0.1, 0.1) },
      approach: { '150-200': repeat(-0.5, 20), '50-100': repeat(0.1, 12) },
    }));
    expect(d.leaks).toHaveLength(1);
    expect(d.top.category).toBe('approach');
    expect(d.top.strokesPerRound).toBeCloseTo(-0.6, 10);
    const child = d.top.children.find((c) => c.bucket === '150-200');
    expect(child.strokesPerRound).toBeCloseTo(-0.5 * 20 / 6, 10);
    expect(d.leaks.filter((l) => l.category === 'approach')).toHaveLength(1);
  });

  test('the worst sufficient bucket is named on the leak', () => {
    const d = buildDiagnosis(makeStats({
      cats: { putting: around(-1.2, 0.1, 5) },
      putting: {
        '1-2': repeat(-0.05, 20),
        '3-6': repeat(-1, 5),             // worse per round, but under 8 putts
        '6+': [...repeat(-0.4, 9), -0.2], // 10 putts, −3.8 SG over 5 rounds
      },
    }));
    expect(d.top.id).toBe('leak:putting:6+');
    expect(d.top.bucket).toBe('6+');
    expect(d.top.metricKey).toBe('sg.putting');
    const six = d.top.children.find((c) => c.bucket === '6+');
    expect(six.strokesPerRound).toBeCloseTo(-3.8 / 5, 10);
    expect(six.perShot).toBeCloseTo(-0.38, 10);
    expect(six.sample).toEqual({ shots: 10 });
    expect(six.metricKey).toBe('sg.putting.bucket.6+');
    expect(d.top.children.find((c) => c.bucket === '3-6').confidence).toBe('insufficient');
    expect(d.top.children.map((c) => c.bucket)).toEqual(['0-1', '1-2', '2-3', '3-6', '6+']);
  });

  test('no bucket is named when none is sufficient and negative', () => {
    const d = buildDiagnosis(makeStats({
      cats: { putting: around(-1, 0.1) },
      putting: { '6+': repeat(-0.5, 7), '1-2': repeat(0.05, 12) },
    }));
    expect(d.top.id).toBe('leak:putting');
    expect(d.top.bucket).toBeNull();
  });

  test('off the tee, around the green and penalties carry evidence, no ranked children', () => {
    const stats = makeStats({ cats: { offTheTee: around(-0.9, 0.1) } });
    stats.driveImpact = { buckets: { left: { holes: 11, avgPoints: 1.2, penaltyRate: 9, breakdown: [] } } };
    stats.driveLies = { drives: 32, troubleRate: 0.28 };
    const d = buildDiagnosis(stats);
    expect(d.top.id).toBe('leak:offTheTee');
    expect(d.top.children).toEqual([]);
    expect(d.top.evidence.directions.left).toEqual({ holes: 11, avgPoints: 1.2, penaltyRate: 9 });
    expect(d.top.evidence.lies).toEqual({ drives: 32, troubleRate: 0.28 });
    expect(d.top.benchmark).toEqual({ targetHandicap: 15 });
  });
});

describe('ranking in one currency', () => {
  test('−0.3 SG/shot × 8 shots does not outrank −1.4 SG/round', () => {
    const d = buildDiagnosis(makeStats({
      cats: { putting: around(-1.4, 0.2), approach: around(-0.5, 0.05) },
      approach: { '150-200': repeat(-0.3, 8) },
    }));
    expect(d.top.category).toBe('putting');
    expect(d.leaks.map((l) => l.id)).toEqual(['leak:putting', 'leak:approach:150-200']);
  });

  test('a bad bucket inside a category above the floor makes no leak', () => {
    const d = buildDiagnosis(makeStats({
      cats: { approach: around(-0.2, 0.05, 3) },
      approach: { '150-200': repeat(-0.3, 8) }, // −0.8 / round as a bucket
    }));
    expect(d.leaks).toEqual([]);
    expect(d.top).toBeNull();
    expect(d.candidate.id).toBe('leak:approach:150-200');
  });

  test('the floor: a −0.35 category is a candidate, never a leak', () => {
    const d = buildDiagnosis(makeStats({ cats: { putting: around(-0.35, 0.02) } }));
    expect(d.top).toBeNull();
    expect(d.candidate.category).toBe('putting');
    expect(d.candidate.confidence).toBe('high');
  });

  test('no candidate when every sufficient category gains', () => {
    const d = buildDiagnosis(makeStats({ cats: { putting: around(0.3, 0.1) } }));
    expect(d.candidate).toBeNull();
  });

  test('a low-confidence leak still ranks; a positive category never does', () => {
    const d = buildDiagnosis(makeStats({
      cats: { approach: [-2.5, 1.5, -1.5, 0.5], putting: around(0.8, 0.1, 4) },
    }));
    expect(d.top.category).toBe('approach');
    expect(d.top.confidence).toBe('low');
    expect(d.leaks).toHaveLength(1);
  });
});

describe('insufficient gates', () => {
  test('under 3 rounds the category is insufficient and says how many more', () => {
    const d = buildDiagnosis(makeStats({ cats: { putting: [-2, -2.2] } }));
    expect(d.leaks).toEqual([]);
    expect(d.candidate).toBeNull();
    expect(d.insufficient).toHaveLength(1);
    expect(d.insufficient[0]).toMatchObject({
      category: 'putting', confidence: 'insufficient', needs: { holes: 0, rounds: 1 },
    });
  });

  test('under 10 holes the category is insufficient even with 3 rounds', () => {
    const d = buildDiagnosis(makeStats({ cats: { approach: [-1.5, -1.4, -1.6] }, holes: 3 }));
    expect(d.top).toBeNull();
    expect(d.insufficient[0]).toMatchObject({
      category: 'approach', sample: { rounds: 3, holes: 9 }, needs: { holes: 1, rounds: 0 },
    });
  });

  test('a bucket under 8 shots is insufficient', () => {
    const d = buildDiagnosis(makeStats({
      cats: { approach: around(-1, 0.1) },
      approach: { '100-150': repeat(-0.6, BUCKET_MIN_SHOTS - 1) },
    }));
    const child = d.top.children.find((c) => c.bucket === '100-150');
    expect(child.confidence).toBe('insufficient');
    expect(d.top.bucket).toBeNull();
  });

  test('rounds that did not sample a category do not count toward it', () => {
    const d = buildDiagnosis(makeStats({
      cats: { putting: [-1, null, -1.2, null, null], approach: around(0, 0.1, 5) },
    }));
    const putting = d.categories.find((c) => c.category === 'putting');
    expect(putting.sample).toEqual({ rounds: 2, holes: 36 });
    expect(putting.strokesPerRound).toBeCloseTo(-1.1, 10);
    expect(putting.confidence).toBe('insufficient');
  });

  test('a category with no sample at all is not listed as insufficient', () => {
    const d = buildDiagnosis(makeStats({ cats: { putting: around(-1, 0.1) } }));
    expect(d.insufficient.map((l) => l.category)).toEqual([]);
    const tee = d.categories.find((c) => c.category === 'offTheTee');
    expect(tee).toMatchObject({ strokesPerRound: null, confidence: 'insufficient', sample: { rounds: 0, holes: 0 } });
  });

  test('empty or missing stats diagnose nothing', () => {
    [undefined, null, {}].forEach((stats) => {
      const d = buildDiagnosis(stats);
      expect(d.leaks).toEqual([]);
      expect(d.top).toBeNull();
      expect(d.tie).toBeNull();
      expect(d.candidate).toBeNull();
      expect(d.insufficient).toEqual([]);
      expect(d.categories.map((c) => c.category)).toEqual(SG_CATEGORIES);
    });
  });
});

describe('tie', () => {
  test('two leaks within 0.3 are a tie', () => {
    const d = buildDiagnosis(makeStats({
      cats: { approach: around(-1.0, 0.05), offTheTee: around(-0.8, 0.05) },
    }));
    expect(d.top.category).toBe('approach');
    expect(d.tie.category).toBe('offTheTee');
  });

  test('two leaks further apart than max(0.3, se₁+se₂) are not', () => {
    const d = buildDiagnosis(makeStats({
      cats: { approach: around(-1.4, 0.05), offTheTee: around(-0.8, 0.05) },
    }));
    expect(d.tie).toBeNull();
  });

  test('wide standard errors widen the band past 0.3', () => {
    const d = buildDiagnosis(makeStats({
      cats: { putting: around(-1.4, 0.8), approach: around(-0.9, 0.8) },
    }));
    const gap = Math.abs(d.top.strokesPerRound - d.leaks[1].strokesPerRound);
    expect(gap).toBeGreaterThan(TIE_MIN);
    expect(d.top.se + d.leaks[1].se).toBeGreaterThan(gap);
    expect(d.top.category).toBe('putting');
    expect(d.tie.category).toBe('approach');
  });

  test('a single leak has no tie', () => {
    const d = buildDiagnosis(makeStats({ cats: { putting: around(-1, 0.1) } }));
    expect(d.tie).toBeNull();
  });
});

describe('tiebreaks', () => {
  test('equal strokes and confidence fall to trainability', () => {
    const same = around(-1, 0.1);
    const d = buildDiagnosis(makeStats({
      cats: {
        offTheTee: same, penalties: same, approach: same, aroundGreen: same, putting: same,
      },
    }));
    expect(d.leaks.map((l) => l.category)).toEqual(TRAINABILITY);
  });

  test('strokes compare on the 0.1 grid: −1.02 vs −1.04 falls to trainability', () => {
    const d = buildDiagnosis(makeStats({
      cats: { offTheTee: around(-1.04, 0.1), putting: around(-1.02, 0.1) },
    }));
    expect(d.leaks.map((l) => l.category)).toEqual(['putting', 'offTheTee']);
  });

  test('a clear strokes gap beats trainability', () => {
    const d = buildDiagnosis(makeStats({
      cats: { offTheTee: around(-1.2, 0.1), putting: around(-1.0, 0.1) },
    }));
    expect(d.leaks.map((l) => l.category)).toEqual(['offTheTee', 'putting']);
  });

  test('on equal strokes, higher confidence beats trainability', () => {
    const d = buildDiagnosis(makeStats({
      cats: { offTheTee: around(-1, 0.05), putting: around(-1, 2) },
    }));
    expect(d.categories.find((c) => c.category === 'putting').confidence).not.toBe('high');
    expect(d.leaks.map((l) => l.category)).toEqual(['offTheTee', 'putting']);
  });

  test('compareLeaks is a total order over the categories', () => {
    const leak = (category) => ({ category, strokesPerRound: -1, confidence: 'high' });
    expect(compareLeaks(leak('putting'), leak('putting'))).toBe(0);
    expect(compareLeaks(leak('putting'), leak('offTheTee'))).toBeLessThan(0);
  });
});

describe('determinism', () => {
  test('same input → identical output, input untouched', () => {
    const input = deepFreeze(makeStats({
      cats: { putting: around(-1.4, 0.3), approach: around(-1.2, 0.3), offTheTee: around(-0.2, 0.3) },
      putting: { '6+': repeat(-0.3, 30), '1-2': repeat(-0.1, 20) },
      approach: { '150-200': repeat(-0.4, 14) },
    }));
    const a = buildDiagnosis(input);
    const b = buildDiagnosis(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.leaks.map((l) => l.id)).toEqual(['leak:putting:6+', 'leak:approach:150-200']);
  });
});

describe('on real computeMyStats output', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const round = (putts) => ({
    courseName: 'Pine',
    holes,
    scores: { p1: Object.fromEntries(holes.map((h) => [h.number, 4 + putts - 2])) },
    shotDetails: {
      p1: Object.fromEntries(holes.map((h) => [h.number, {
        putts, firstPuttBucket: '6+', drive: 'fairway', driveDistBucket: '210-240',
        approachBucket: '100-150', approachResult: 'green',
      }])),
    },
    playerHandicaps: {},
    slope: 113,
    courseRating: 72,
  });
  const tournaments = [{
    id: 1, name: 'T', players: [{ id: 'p1', handicap: 15, user_id: 'u1' }],
    rounds: [round(3), round(2), round(3), round(3)],
  }];
  const stats = computeMyStats(collectMyRounds(tournaments, 'u1'), { targetHandicap: 15 });
  const d = buildDiagnosis(stats);

  test('category means equal the season SG the stats screen shows', () => {
    const putting = d.categories.find((c) => c.category === 'putting');
    expect(putting.sample).toEqual({ rounds: 4, holes: 72 });
    expect(putting.strokesPerRound).toBeCloseTo(stats.strokesGained.byCategory.putting, 10);
  });

  test('three-putting from 6 m+ is the top leak, bucket named', () => {
    expect(d.top.id).toBe('leak:putting:6+');
    expect(d.top.children.find((c) => c.bucket === '6+').sample).toEqual({ shots: 72 });
  });
});
