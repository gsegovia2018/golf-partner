import {
  BASELINES, BUCKETS, expectedStrokes, expectedFromBucket,
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
    const fairway150 = BASELINES.fairway.find((r) => r.distance === 150);
    expect(expectedStrokes('fairway', 150)).toBeCloseTo(fairway150.expected);
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
    const v = expectedFromBucket('firstPutt', '6-10');
    expect(v).toBeCloseTo(expectedStrokes('green', BUCKETS.firstPutt['6-10']));
  });
});
