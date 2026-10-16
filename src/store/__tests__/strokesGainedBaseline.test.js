import {
  BASELINES, BUCKETS, HANDICAP_ANCHORS, SG_BASELINE_VERSION,
  expectedStrokes, expectedFromBucket, interpHandicap, typicalDriveMix,
  benchmarkDriveDistance, benchmarkTeeShotDistance, PAR_ANCHOR_DISTANCE,
  expectedPenaltiesPerRound, typicalScoreVsPar,
} from '../strokesGainedBaseline';

describe('BASELINES', () => {
  test('one row set per lie, every anchor present, sorted, monotone in handicap', () => {
    expect(HANDICAP_ANCHORS).toEqual([0, 5, 10, 15, 20, 25, 30, 36, 54]);
    ['tee', 'fairway', 'rough', 'sand', 'recovery', 'greenside', 'green'].forEach((lie) => {
      const { distances, byHandicap } = BASELINES[lie];
      for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1]);
      HANDICAP_ANCHORS.forEach((h, k) => {
        expect(byHandicap[h]).toHaveLength(distances.length);
        if (k > 0) byHandicap[h].forEach((v, r) => expect(v).toBeGreaterThanOrEqual(byHandicap[HANDICAP_ANCHORS[k - 1]][r]));
      });
    });
    expect(SG_BASELINE_VERSION).toBe(2);
  });
  test('greenside and sand carry an explicit 20 m row (the only distance the engine reads)', () => {
    expect(BASELINES.greenside.distances).toContain(20);
    expect(BASELINES.sand.distances).toContain(20);
  });
});

describe('interpHandicap', () => {
  const v = [0, 5, 10, 15, 20, 25, 30, 36, 54]; // identity on the anchors
  test('exact on anchors, linear between, extrapolates past both ends, never clamps', () => {
    expect(interpHandicap(v, 15)).toBe(15);
    expect(interpHandicap(v, 12.5)).toBeCloseTo(12.5, 10);
    expect(interpHandicap(v, 40)).toBeCloseTo(40, 10);
    expect(interpHandicap(v, 60)).toBeCloseTo(60, 10);
    expect(interpHandicap(v, -2)).toBeCloseTo(-2, 10);
    expect(interpHandicap(v, null)).toBe(0);
  });
});

describe('expectedStrokes(lie, distance, targetHandicap)', () => {
  test('anchor rows read back exactly; distance interpolates and clamps', () => {
    expect(expectedStrokes('fairway', 125, 0)).toBeCloseTo(BASELINES.fairway.byHandicap[0][4], 10);
    expect(expectedStrokes('fairway', 125, 15)).toBeCloseTo(BASELINES.fairway.byHandicap[15][4], 10);
    const a = BASELINES.green.byHandicap[0];
    expect(expectedStrokes('green', 0, 0)).toBeCloseTo(a[0], 10);                       // clamp low
    expect(expectedStrokes('green', 100, 0)).toBeCloseTo(a[a.length - 1], 10);          // clamp high
    expect(expectedStrokes('green', (0.91 + 1.83) / 2, 0)).toBeCloseTo((a[0] + a[1]) / 2, 10);
  });
  test('default target is scratch; unknown lie is null', () => {
    expect(expectedStrokes('fairway', 125)).toBeCloseTo(expectedStrokes('fairway', 125, 0), 10);
    expect(expectedStrokes('lava', 150)).toBeNull();
  });
  test('no clamp: 28, 30 and 40 differ, and every lie is non-decreasing in the target', () => {
    const lies = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'greenside', 'green', 'typicalDrive'];
    const dist = { tee: 125, fairway: 125, rough: 125, sand: 20, recovery: 91.4, greenside: 20, green: 4.5, typicalDrive: 135 };
    lies.forEach((lie) => {
      expect(expectedStrokes(lie, dist[lie], 30)).toBeGreaterThan(expectedStrokes(lie, dist[lie], 28));
      expect(expectedStrokes(lie, dist[lie], 40)).toBeGreaterThan(expectedStrokes(lie, dist[lie], 30));
      let prev = -Infinity;
      for (let h = 0; h <= 60; h += 0.5) { const v = expectedStrokes(lie, dist[lie], h); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    });
  });
  test('typicalDrive is the target\'s lie mix and sits above a fairway-only drive', () => {
    const mix = typicalDriveMix(15);
    expect(mix.fairway + mix.rough + mix.sand + mix.recovery).toBeCloseTo(1, 10);
    const mixed = mix.fairway * expectedStrokes('fairway', 135, 15) + mix.rough * expectedStrokes('rough', 135, 15)
      + mix.sand * expectedStrokes('sand', 135, 15) + mix.recovery * expectedStrokes('recovery', 135, 15);
    expect(expectedStrokes('typicalDrive', 135, 15)).toBeCloseTo(mixed, 10);
    expect(expectedStrokes('typicalDrive', 135, 15)).toBeGreaterThan(expectedStrokes('fairway', 135, 15));
  });
  test('published sanity: 10 hcp from 100 yd fairway ≈ 3.3 (Arccos 3.38); scratch 6 ft putt ≈ 1.33; typical 15 chip node 2.75', () => {
    expect(expectedStrokes('fairway', 91.4, 10)).toBeCloseTo(3.30, 1);
    expect(expectedStrokes('green', 1.83, 0)).toBeCloseTo(1.33, 2);
    expect(expectedStrokes('greenside', 20, 15)).toBeCloseTo(2.75, 2);
  });
});

describe('expectedFromBucket', () => {
  test('maps bucket key to midpoint then to expected, threading the target', () => {
    expect(expectedFromBucket('approach', '100-150')).toBeCloseTo(expectedStrokes('fairway', 125), 10);
    expect(expectedFromBucket('firstPutt', '3-6', 10)).toBeCloseTo(expectedStrokes('green', 4.5, 10), 10);
    expect(expectedFromBucket('approach', '0-50', 0)).toBeCloseTo(BASELINES.fairway.byHandicap[0][0], 10); // 25 m row, no clamp to 45.7
  });
});

describe('drive, penalty and score anchors', () => {
  test('bucket midpoints and par anchors unchanged', () => {
    expect(BUCKETS.driveDist).toEqual({ '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255 });
    expect(PAR_ANCHOR_DISTANCE).toEqual({ 4: 340, 5: 470 });
  });
  test('benchmarkDriveDistance: 230 scratch, 205 at 15, 180 at 30, keeps falling past 36', () => {
    expect(benchmarkDriveDistance(0)).toBe(230);
    expect(benchmarkDriveDistance(15)).toBe(205);
    expect(benchmarkDriveDistance(30)).toBe(180);
    expect(benchmarkDriveDistance(7)).toBeCloseTo(218.4, 1);
    expect(benchmarkDriveDistance(40)).toBeLessThan(benchmarkDriveDistance(36));
    expect(benchmarkDriveDistance()).toBe(230);
    expect(benchmarkTeeShotDistance(0, 'iron')).toBeCloseTo(230 * 0.78, 10);
  });
  test('expectedPenaltiesPerRound: 0.5 scratch, 1.7 at 15, 3.1 at 30, 1.62 at 14, rising past 36', () => {
    expect(expectedPenaltiesPerRound(0)).toBe(0.5);
    expect(expectedPenaltiesPerRound()).toBe(0.5);
    expect(expectedPenaltiesPerRound(15)).toBeCloseTo(1.7, 10);
    expect(expectedPenaltiesPerRound(14)).toBeCloseTo(1.62, 10);
    expect(expectedPenaltiesPerRound(30)).toBeCloseTo(3.1, 10);
    expect(expectedPenaltiesPerRound(50)).toBeGreaterThan(expectedPenaltiesPerRound(36));
  });
  test('typicalScoreVsPar follows the Shot Scope rows and extrapolates', () => {
    expect(typicalScoreVsPar(0)).toBe(2.0);
    expect(typicalScoreVsPar(15)).toBe(18.4);
    expect(typicalScoreVsPar(18)).toBeCloseTo(18.4 + 0.6 * (23.2 - 18.4), 10);
    expect(typicalScoreVsPar(30)).toBe(36.5);
  });
});
