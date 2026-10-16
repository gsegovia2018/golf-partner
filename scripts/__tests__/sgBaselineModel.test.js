const {
  HANDICAP_ANCHORS, buildTables, lookup, DRIVE_DISTANCE_ANCHORS, PENALTIES_ANCHORS, SCORE_VS_PAR_ANCHORS,
} = require('../lib/sgBaselineModel');
const { SHOT_HANDICAP_BENCHMARKS } = require('../../src/store/shotBenchmarks');

const tables = buildTables();
const E = (lie, h, d) => lookup(tables[lie].distances, tables[lie].byHandicap[h], d);

describe('sgBaselineModel tables', () => {
  test('every lie has a row per anchor, sorted distances, 2-dp values', () => {
    Object.values(tables).forEach(({ distances, byHandicap }) => {
      for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1]);
      HANDICAP_ANCHORS.forEach((h) => {
        expect(byHandicap[h]).toHaveLength(distances.length);
        byHandicap[h].forEach((v) => expect(v).toBeCloseTo(Math.round(v * 100) / 100, 10));
      });
    });
  });
  test('monotone in handicap at every distance, and in distance for every lie', () => {
    Object.values(tables).forEach(({ distances, byHandicap }) => {
      distances.forEach((_, r) => {
        for (let i = 1; i < HANDICAP_ANCHORS.length; i++) {
          expect(byHandicap[HANDICAP_ANCHORS[i]][r]).toBeGreaterThanOrEqual(byHandicap[HANDICAP_ANCHORS[i - 1]][r]);
        }
      });
      HANDICAP_ANCHORS.forEach((h) => {
        for (let r = 1; r < distances.length; r++) expect(byHandicap[h][r]).toBeGreaterThanOrEqual(byHandicap[h][r - 1]);
      });
    });
    [DRIVE_DISTANCE_ANCHORS].forEach((a) => { for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThan(a[i - 1]); });
    [PENALTIES_ANCHORS, SCORE_VS_PAR_ANCHORS].forEach((a) => { for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]); });
  });
  test('published anchors: Arccos 10 hcp 100 yd fairway 3.38 / rough 3.5; Broadie tour 100 / 150 yd 2.80 / 2.98', () => {
    expect(E('fairway', 10, 91.4)).toBeCloseTo(3.38, 0);   // ±0.5 band; model ≈ 3.30
    expect(Math.abs(E('fairway', 10, 91.4) - 3.38)).toBeLessThan(0.15);
    expect(Math.abs(E('rough', 10, 91.4) - 3.5)).toBeLessThan(0.15);
    expect(E('fairway', 0, 91.4) - 2.80).toBeGreaterThan(0.1);   // scratch amateur sits above tour
    expect(E('fairway', 0, 91.4) - 2.80).toBeLessThan(0.35);
    expect(E('fairway', 0, 137.2) - 2.98).toBeLessThan(0.3);
  });
  test('score-vs-par anchors ≤ 25 are the Shot Scope rows in shotBenchmarks', () => {
    SHOT_HANDICAP_BENCHMARKS.forEach((row) => {
      const i = HANDICAP_ANCHORS.indexOf(row.handicap);
      expect(SCORE_VS_PAR_ANCHORS[i]).toBeCloseTo(row.avgScoreVsPar, 0);
    });
  });
});
