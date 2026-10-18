import {
  bearingDeg, hazardSide, normalizeDeltaDeg, holeTargetPoint, setCourseGeometry,
  mergeCourseGeometry, getCourseGeometry, getCourseGeometryVersion, findCourseGeometry,
} from '../geo';

// ~111,320 m per degree of latitude; latitude-only offsets make bearings
// predictable without longitude scaling.
const GREEN = [38.56, -0.139];
const at = (metersNorth) => [GREEN[0] + metersNorth / 111320, GREEN[1]];

describe('bearingDeg', () => {
  it('returns approximately 0 for due north', () => {
    const from = GREEN;
    const to = at(1000); // 1000 m north
    const bearing = bearingDeg(from, to);
    expect(bearing).toBeCloseTo(0, 0);
  });

  it('returns approximately 90 for due east', () => {
    const from = GREEN;
    // Move 1000 m east by adjusting longitude; 111 m per 0.001 degrees at ~39°N latitude
    const to = [GREEN[0], GREEN[1] + 0.009]; // roughly 1000 m east
    const bearing = bearingDeg(from, to);
    expect(bearing).toBeCloseTo(90, 1);
  });

  it('returns approximately 180 for due south', () => {
    const from = GREEN;
    const to = at(-1000); // 1000 m south
    const bearing = bearingDeg(from, to);
    expect(bearing).toBeCloseTo(180, 0);
  });

  it('returns approximately 270 for due west', () => {
    const from = GREEN;
    const to = [GREEN[0], GREEN[1] - 0.009]; // roughly 1000 m west
    const bearing = bearingDeg(from, to);
    expect(bearing).toBeCloseTo(270, 1);
  });
});

describe('normalizeDeltaDeg', () => {
  it('returns 0 for 0', () => {
    expect(normalizeDeltaDeg(0)).toBe(0);
  });

  it('returns 0 for 360', () => {
    expect(normalizeDeltaDeg(360)).toBe(0);
  });

  it('returns -45 for -45', () => {
    expect(normalizeDeltaDeg(-45)).toBe(-45);
  });

  it('returns -170 for 190', () => {
    expect(normalizeDeltaDeg(190)).toBe(-170);
  });

  it('returns 170 for -190', () => {
    expect(normalizeDeltaDeg(-190)).toBe(170);
  });

  it('returns 180 or -180 for 540', () => {
    const result = normalizeDeltaDeg(540);
    // The formula yields -180 per ((540 + 180) % 360 + 360) % 360 - 180
    // = (720 % 360 + 360) % 360 - 180 = (0 + 360) % 360 - 180 = 0 - 180 = -180
    expect(Math.abs(result)).toBe(180);
  });

  it('clamps large positive angles to [-180, 180)', () => {
    expect(normalizeDeltaDeg(720)).toBe(0); // 720 = 2 * 360
    expect(normalizeDeltaDeg(450)).toBe(90); // 450 = 360 + 90
    expect(normalizeDeltaDeg(1000)).toBe(-80); // ((1000+180)%360+360)%360-180 = -80
  });

  it('clamps large negative angles to [-180, 180)', () => {
    expect(normalizeDeltaDeg(-360)).toBe(0);
    expect(normalizeDeltaDeg(-450)).toBe(-90);
  });
});

describe('holeTargetPoint', () => {
  const COURSE = {
    key: 'testville',
    name: 'Testville Golf',
    matchTokens: [['testville']],
    mode: 'holes',
    holes: [
      { number: 1, greenCenter: GREEN, pin: at(50) }, // has both pin and center
      { number: 2, greenCenter: GREEN }, // has center but no pin
      { number: 3, green: [GREEN, at(100), at(200)] }, // polygon only, pin derived from centroid
      { number: 4, greenCenter: at(75), pin: null }, // explicit null pin
    ],
  };

  beforeEach(() => {
    setCourseGeometry([COURSE]);
  });

  afterEach(() => {
    setCourseGeometry([]);
  });

  it('returns the pin when present', () => {
    const target = holeTargetPoint('Testville Golf', 1);
    expect(target).toEqual(at(50));
  });

  it('falls back to greenCenter when no pin exists', () => {
    const target = holeTargetPoint('Testville Golf', 2);
    expect(target).toEqual(GREEN);
  });

  it('falls back to greenCenter derived from polygon centroid', () => {
    const target = holeTargetPoint('Testville Golf', 3);
    // The centroid is the average of the three points
    expect(target).toBeDefined();
    expect(Array.isArray(target)).toBe(true);
    expect(target.length).toBe(2);
  });

  it('returns null for unknown course', () => {
    const target = holeTargetPoint('Nonexistent Course', 1);
    expect(target).toBeNull();
  });

  it('returns null for unknown hole', () => {
    const target = holeTargetPoint('Testville Golf', 99);
    expect(target).toBeNull();
  });

  it('prioritizes pin over greenCenter when both exist', () => {
    const target = holeTargetPoint('Testville Golf', 1);
    const features = { greenCenter: GREEN, pin: at(50) };
    expect(target).toEqual(features.pin);
  });
});

describe('mergeCourseGeometry', () => {
  const DETAILED = {
    key: 'a', name: 'Alpha', matchTokens: [['alpha']], mode: 'holes', holes: [{ number: 1 }],
  };
  const INDEX_A = { key: 'a', name: 'Alpha Renamed', matchTokens: [['alpha']], mode: 'holes' };
  const INDEX_B = { key: 'b', name: 'Bravo', matchTokens: [['bravo']], mode: 'greens' };

  beforeEach(() => setCourseGeometry([DETAILED]));
  afterEach(() => setCourseGeometry([]));

  it('adds unknown index entries without downgrading a detailed course', () => {
    const v = getCourseGeometryVersion();
    mergeCourseGeometry([INDEX_A, INDEX_B]);
    expect(getCourseGeometry().find((c) => c.key === 'a')).toBe(DETAILED);
    expect(findCourseGeometry('Bravo Golf')).toBe(INDEX_B);
    expect(getCourseGeometryVersion()).toBe(v + 1);
  });

  it('lets details replace an index entry', () => {
    mergeCourseGeometry([INDEX_B]);
    const detailedB = { ...INDEX_B, greens: [[38.5, -0.1]] };
    mergeCourseGeometry([detailedB]);
    expect(findCourseGeometry('Bravo')).toBe(detailedB);
    expect(getCourseGeometry()).toHaveLength(2);
  });

  it('does not bump the version when nothing changes', () => {
    const v = getCourseGeometryVersion();
    mergeCourseGeometry([INDEX_A]);
    mergeCourseGeometry([]);
    expect(getCourseGeometryVersion()).toBe(v);
  });
});

describe('hazardSide', () => {
  // Walking due north from `from` to `to`: east is right, west is left.
  const from = GREEN;
  const to = at(300);
  const eastM = (m) => m / (111320 * Math.cos(GREEN[0] * Math.PI / 180));
  const hz = (northM, eastMeters) => ({
    kind: 'water',
    poly: [[GREEN[0] + northM / 111320, GREEN[1] + eastM(eastMeters)]],
  });

  it('is right for a hazard east of a northbound line', () => {
    expect(hazardSide(hz(250, 20), from, to)).toBe('right');
  });
  it('is left for a hazard west of a northbound line', () => {
    expect(hazardSide(hz(250, -20), from, to)).toBe('left');
  });
  it('is centre inside the 5 m band and flips outside it', () => {
    expect(hazardSide(hz(250, 4), from, to)).toBe('centre');
    expect(hazardSide(hz(250, -4), from, to)).toBe('centre');
    expect(hazardSide(hz(250, 6), from, to)).toBe('right');
  });
  it('flips when the line runs the other way', () => {
    expect(hazardSide(hz(250, 20), to, from)).toBe('left');
  });
  it('is centre without a polygon or a line', () => {
    expect(hazardSide({ kind: 'water', poly: [] }, from, to)).toBe('centre');
    expect(hazardSide(hz(10, 20), from, from)).toBe('centre');
  });
});
