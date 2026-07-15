import { DRILLS, drillsForInsight } from '../coachDrills';

describe('DRILLS catalog', () => {
  test('every drill is complete and well-formed', () => {
    expect(DRILLS.length).toBeGreaterThanOrEqual(18);
    const ids = new Set();
    DRILLS.forEach((d) => {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(['offTheTee', 'approach', 'putting', 'shortGame', 'penalties', 'roundShape', 'scoring']).toContain(d.area);
      expect(typeof d.title).toBe('string');
      expect(d.instruction.length).toBeGreaterThan(10);
      expect(d.passTarget.length).toBeGreaterThan(5);
      expect(['green', 'range', 'course']).toContain(d.location);
    });
  });
  test('every area has at least one bucketless (generic) drill', () => {
    ['offTheTee', 'approach', 'putting', 'shortGame', 'penalties', 'roundShape', 'scoring'].forEach((area) => {
      expect(DRILLS.some((d) => d.area === area && d.bucket == null)).toBe(true);
    });
  });
});

describe('drillsForInsight', () => {
  test('bucket-matched drill ranks first for a putting bucket leak', () => {
    const drills = drillsForInsight({ area: 'putting', title: '6+ m putts' });
    expect(drills[0].area).toBe('putting');
    expect(drills[0].bucket).toBe('6+');
  });
  test('approach bucket parsed from title', () => {
    const drills = drillsForInsight({ area: 'approach', title: '150-200 m approaches' });
    expect(drills[0].bucket).toBe('150-200');
  });
  test('driving area maps to offTheTee drills', () => {
    const drills = drillsForInsight({ area: 'driving', title: 'Off the tee' });
    expect(drills.length).toBeGreaterThan(0);
    expect(drills[0].area).toBe('offTheTee');
  });
  test('area without bucket returns generic drills for that area', () => {
    const drills = drillsForInsight({ area: 'shortGame', title: 'Short game' });
    expect(drills[0].area).toBe('shortGame');
  });
  test('form/unknown areas fall back to scoring drills', () => {
    expect(drillsForInsight({ area: 'form', title: 'Points / round' })[0].area).toBe('scoring');
    expect(drillsForInsight({ area: 'nonsense', title: 'x' })[0].area).toBe('scoring');
    expect(drillsForInsight(null)).toEqual([]);
  });
});
