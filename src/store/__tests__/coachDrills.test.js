import { DRILLS, drillsForInsight, drillsForCause } from '../coachDrills';

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

describe('drill causes, kind, minutes and levels', () => {
  const KINDS = ['range', 'shortGame', 'putting', 'course'];
  test('every drill has a kind, 10-25 minutes and three levels', () => {
    DRILLS.forEach((d) => {
      expect(KINDS).toContain(d.kind);
      expect(d.minutes).toBeGreaterThanOrEqual(10);
      expect(d.minutes).toBeLessThanOrEqual(25);
      expect(d.levels).toHaveLength(3);
      d.levels.forEach((level) => expect(level.passTarget.length).toBeGreaterThan(5));
      expect(d.levels[0].passTarget).toBe(d.passTarget);
      expect(Array.isArray(d.causes)).toBe(true);
    });
  });
  test('every cause a drill names is a known cause id shape', () => {
    DRILLS.forEach((d) => d.causes.forEach((c) => expect(c).toMatch(/^cause:[a-z]+(:[a-z]+)*$/)));
  });
});

describe('drillsForCause', () => {
  const ids = (causeId) => drillsForCause(causeId).map((d) => d.id);
  test('cause-matched drills come first, then the rest of the cause area', () => {
    expect(ids('cause:putting:lag')).toEqual([
      'putt-lag-ladder', 'putt-circle-4m',
      'putt-clock-2m', 'putt-gate-short', 'putt-tap-in-pressure', 'putt-mixed-ladder', 'putt-short-circle-80pct',
    ]);
  });
  test('approach short misses rank the club-up drills first', () => {
    expect(ids('cause:approach:short')).toEqual([
      'appr-green-reps-125', 'appr-long-iron-reps', 'appr-club-up-back-half',
      'appr-wedge-ladder', 'appr-distance-windows', 'appr-layup-ladder', 'appr-call-your-half', 'appr-start-line-gate',
    ]);
  });
  test('a cause served outside its area still ranks first (bunker)', () => {
    const list = drillsForCause('cause:approach:bunker');
    expect(list[0].id).toBe('sg-bunker-first-out');
    expect(list.slice(1).every((d) => d.area === 'approach')).toBe(true);
  });
  test('tee and penalty causes map to their drill areas', () => {
    expect(drillsForCause('cause:tee:side:left')[0].id).toBe('tee-fairway-window');
    expect(ids('cause:penalty:other').slice(0, 2)).toEqual(['pen-smart-drop-review', 'pen-provisional-plan']);
    expect(drillsForCause('cause:short:chip')[0].area).toBe('shortGame');
  });
  test('unknown or non-cause ids return an empty list', () => {
    expect(drillsForCause('cause:nope:x')).toEqual([]);
    expect(drillsForCause('leak:putting')).toEqual([]);
    expect(drillsForCause(undefined)).toEqual([]);
  });
  test('the six new drills exist and serve their causes', () => {
    const NEW = {
      'appr-club-up-back-half': 'cause:approach:short',
      'appr-start-line-gate': 'cause:approach:side:right',
      'tee-shape-window': 'cause:tee:side:left',
      'putt-short-circle-80pct': 'cause:putting:short',
      'sg-chip-landing-ladder': 'cause:short:chip',
      'pen-provisional-plan': 'cause:penalty:other',
    };
    Object.entries(NEW).forEach(([id, cause]) => {
      expect(DRILLS.find((d) => d.id === id).causes).toContain(cause);
    });
  });
});
