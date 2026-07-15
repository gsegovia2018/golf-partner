import {
  BASELINES, BASELINES_SCRATCH,
  expectedStrokes, expectedFromBucket,
  BASELINES_AMATEUR, AMATEUR_ANCHOR_HANDICAP,
  benchmarkDriveDistance, PAR_ANCHOR_DISTANCE, BUCKETS,
  expectedPenaltiesPerRound,
} from '../strokesGainedBaseline';

describe('BASELINES', () => {
  test('every category is sorted ascending by distance', () => {
    Object.entries(BASELINES).forEach(([_lie, rows]) => {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].distance).toBeGreaterThan(rows[i - 1].distance);
      }
    });
  });
});

describe('expectedStrokes', () => {
  test('returns exact row when distance matches', () => {
    const fairway150m = BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1);
    expect(expectedStrokes('fairway', 137.2)).toBeCloseTo(fairway150m.expected);
  });
  test('interpolates between rows', () => {
    const a = BASELINES.fairway[0];
    const b = BASELINES.fairway[1];
    const mid = (a.distance + b.distance) / 2;
    const expectedMid = (a.expected + b.expected) / 2;
    expect(expectedStrokes('fairway', mid)).toBeCloseTo(expectedMid, 2);
  });
  test('clamps below minimum distance', () => {
    const min = BASELINES.green[0];
    expect(expectedStrokes('green', 0)).toBeCloseTo(min.expected);
  });
  test('clamps above maximum distance', () => {
    const rows = BASELINES.fairway;
    const max = rows[rows.length - 1];
    expect(expectedStrokes('fairway', max.distance + 100)).toBeCloseTo(max.expected);
  });
  test('unknown lie returns null', () => {
    expect(expectedStrokes('lava', 150)).toBeNull();
  });
});

describe('expectedFromBucket', () => {
  test('maps bucket key to midpoint then to expected', () => {
    const v = expectedFromBucket('approach', '100-150');
    expect(v).toBeCloseTo(expectedStrokes('fairway', 125));
  });
});

describe('BASELINES_AMATEUR', () => {
  test('every category is sorted ascending by distance', () => {
    Object.entries(BASELINES_AMATEUR).forEach(([_lie, rows]) => {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].distance).toBeGreaterThan(rows[i - 1].distance);
      }
    });
  });
  test('amateur values are worse than scratch at same distance', () => {
    expect(BASELINES_AMATEUR.fairway[0].expected)
      .toBeGreaterThan(BASELINES_SCRATCH.fairway[0].expected);
    expect(BASELINES_AMATEUR.green[2].expected)
      .toBeGreaterThan(BASELINES_SCRATCH.green[2].expected);
  });
  test('AMATEUR_ANCHOR_HANDICAP is 14', () => {
    expect(AMATEUR_ANCHOR_HANDICAP).toBe(14);
  });
});

describe('expectedStrokes(lie, distance, targetHandicap)', () => {
  test('targetHandicap=0 returns scratch values (Phase B regression)', () => {
    expect(expectedStrokes('fairway', 137.2, 0))
      .toBeCloseTo(BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected);
  });
  test('targetHandicap=14 returns amateur values', () => {
    expect(expectedStrokes('fairway', 137.2, 14))
      .toBeCloseTo(BASELINES_AMATEUR.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected);
  });
  test('targetHandicap=7 returns midpoint between scratch and amateur', () => {
    const s = BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    const a = BASELINES_AMATEUR.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    expect(expectedStrokes('fairway', 137.2, 7)).toBeCloseTo((s + a) / 2, 3);
  });
  test('targetHandicap=28 extrapolates at t=2', () => {
    const s = BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    const a = BASELINES_AMATEUR.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    expect(expectedStrokes('fairway', 137.2, 28)).toBeCloseTo(s + 2 * (a - s), 3);
  });
  test('targetHandicap>28 clamps to t=2', () => {
    expect(expectedStrokes('fairway', 137.2, 50))
      .toBeCloseTo(expectedStrokes('fairway', 137.2, 28));
  });
  test('targetHandicap default is 0 (no arg)', () => {
    expect(expectedStrokes('fairway', 137.2))
      .toBeCloseTo(expectedStrokes('fairway', 137.2, 0));
  });
});

describe('expectedFromBucket(category, bucketKey, targetHandicap)', () => {
  test('passes targetHandicap through to expectedStrokes', () => {
    const direct = expectedStrokes('fairway', 125, 10);
    const via = expectedFromBucket('approach', '100-150', 10);
    expect(via).toBeCloseTo(direct);
  });
});

describe('drive benchmark constants', () => {
  test('driveDist bucket midpoints', () => {
    expect(BUCKETS.driveDist).toEqual({
      '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255,
    });
  });
  test('par anchors', () => {
    expect(PAR_ANCHOR_DISTANCE).toEqual({ 4: 340, 5: 470 });
  });
  test('benchmarkDriveDistance blends 230 (scratch) to 200 (14 hcp) and clamps', () => {
    expect(benchmarkDriveDistance(0)).toBe(230);
    expect(benchmarkDriveDistance(14)).toBe(200);
    expect(benchmarkDriveDistance(7)).toBe(215);
    expect(benchmarkDriveDistance(28)).toBe(170);
    expect(benchmarkDriveDistance(50)).toBe(170); // clamped at t = 2
    expect(benchmarkDriveDistance()).toBe(230);   // default scratch
  });
});

describe('expectedPenaltiesPerRound', () => {
  test('anchored at 0 (scratch) and 1.0 (14 hcp), clamped at 2.0', () => {
    expect(expectedPenaltiesPerRound(0)).toBe(0);
    expect(expectedPenaltiesPerRound()).toBe(0);
    expect(expectedPenaltiesPerRound(14)).toBeCloseTo(1.0, 10);
    expect(expectedPenaltiesPerRound(25)).toBeCloseTo(25 / 14, 10);
    expect(expectedPenaltiesPerRound(50)).toBeCloseTo(2.0, 10);
  });
});
