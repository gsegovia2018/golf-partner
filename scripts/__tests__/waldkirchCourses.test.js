// Data-integrity guard for scripts/data/waldkirch-courses.json. A bad stroke
// index or a duplicate tee label silently corrupts every round played on the
// course (see src/lib/courseLibrary.js#computeSiIssues), and the import script
// writes straight into the shared library — so the data is checked here rather
// than only at import time.
const fs = require('fs');
const path = require('path');

const { club, courses } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'waldkirch-courses.json'), 'utf8'),
);

describe('Golfpark Waldkirch dataset', () => {
  test('is one Swiss club with its twelve rated layouts', () => {
    expect(club).toEqual({
      name: 'Golfpark Waldkirch', city: 'Waldkirch', province: 'St. Gallen',
    });
    expect(courses).toHaveLength(12);
    expect(courses.filter((c) => c.holeCount === 18)).toHaveLength(8);
    expect(courses.filter((c) => c.holeCount === 9)).toHaveLength(4);
  });

  test.each(courses.map((c) => [c.layoutName, c]))('%s', (_name, course) => {
    expect(course.holes).toHaveLength(course.holeCount);
    expect(course.name).toBe(`Golfpark Waldkirch — ${course.layoutName}`);

    // Holes are numbered 1..N in playing order and the stroke indices are
    // exactly the set 1..N.
    expect(course.holes.map((h) => h.number))
      .toEqual(course.holes.map((_h, i) => i + 1));
    expect(course.holes.map((h) => h.strokeIndex).sort((a, b) => a - b))
      .toEqual(course.holes.map((_h, i) => i + 1));
    for (const h of course.holes) expect(h.par).toBeGreaterThanOrEqual(3);

    // Four tees, uniquely labelled, each rated for men and women, each
    // carrying a distance for every hole.
    expect(course.tees).toHaveLength(4);
    expect(new Set(course.tees.map((t) => t.label)).size).toBe(4);
    for (const tee of course.tees) {
      expect(tee.rating).toBeGreaterThan(0);
      expect(tee.slope).toBeGreaterThanOrEqual(55);
      expect(tee.slope).toBeLessThanOrEqual(155);
      expect(tee.ratingWomen).toBeGreaterThan(tee.rating);
      expect(tee.slopeWomen).toBeGreaterThanOrEqual(55);
      expect(Object.keys(tee.yardages)).toHaveLength(course.holeCount);
    }
    // Tees are ordered longest first.
    const lengths = course.tees.map(
      (t) => Object.values(t.yardages).reduce((a, b) => a + b, 0),
    );
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
  });

  test('Schwarz matches the printed 2026 scorecard', () => {
    const schwarz = courses.find((c) => c.layoutName === 'Schwarz');
    expect(schwarz.holes.map((h) => h.par))
      .toEqual([4, 4, 3, 5, 3, 4, 5, 4, 3, 4, 3, 5, 5, 3, 4, 4, 3, 4]);
    expect(schwarz.holes.map((h) => h.strokeIndex))
      .toEqual([7, 9, 11, 3, 15, 5, 13, 1, 17, 2, 18, 8, 6, 16, 4, 14, 10, 12]);
    expect(schwarz.tees.map((t) => t.label)).toEqual(['56', '53', '49', '47']);
    expect(schwarz.tees[0]).toMatchObject({
      rating: 70.4, slope: 135, ratingWomen: 76.5, slopeWomen: 136,
    });
  });
});
