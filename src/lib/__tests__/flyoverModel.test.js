import { anchorFor, ANCHOR_MAX_GPS_METERS, resolveScorecardDistances } from '../flyoverModel';
import { setCourseGeometry } from '../geo';

// ~111,320 m per degree of latitude; latitude-only offsets make distances
// predictable without longitude scaling.
const GREEN = [38.56, -0.139];
const at = (metersNorth) => [GREEN[0] + metersNorth / 111320, GREEN[1]];
const TEE = at(400);

describe('anchorFor', () => {
  it('uses the player when within 1 km of the green', () => {
    const r = anchorFor({ player: at(250), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('gps');
    expect(r.anchor).toEqual(at(250));
    expect(r.playerDistance).toBeCloseTo(250, 0);
  });

  it('1 km exactly still counts as on-course (inclusive)', () => {
    const r = anchorFor({ player: at(ANCHOR_MAX_GPS_METERS), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('gps');
  });

  it('falls back to the tee beyond 1 km', () => {
    const r = anchorFor({ player: at(1200), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('tee');
    expect(r.anchor).toEqual(TEE);
    expect(r.playerDistance).toBeCloseTo(1200, -1);
  });

  it('falls back to the tee with no player at all', () => {
    const r = anchorFor({ player: null, tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('tee');
    expect(r.playerDistance).toBeNull();
  });

  it('returns no anchor when far away and no tee is mapped', () => {
    const r = anchorFor({ player: at(1200), tee: null, greenCenter: GREEN });
    expect(r).toEqual({ anchor: null, source: null, playerDistance: expect.any(Number) });
  });

  it('treats invalid coordinates as missing', () => {
    expect(anchorFor({ player: [NaN, 0], tee: TEE, greenCenter: GREEN }).source).toBe('tee');
    expect(anchorFor({ player: null, tee: ['a', 0], greenCenter: GREEN }).source).toBeNull();
  });

  it('no greenCenter → player distance unknown → tee', () => {
    const r = anchorFor({ player: at(100), tee: TEE, greenCenter: null });
    expect(r.source).toBe('tee');
    expect(r.playerDistance).toBeNull();
  });
});

describe('resolveScorecardDistances', () => {
  // Small square bunker around a point 150 m north of the green — on the
  // tee→green line, so the hazard filter keeps it when measured from the tee.
  const bunkerPoly = [at(145), at(155), [at(150)[0], GREEN[1] + 0.0001], [at(150)[0], GREEN[1] - 0.0001]];
  const COURSE = {
    key: 'testville',
    name: 'Testville Golf',
    matchTokens: [['testville']],
    mode: 'holes',
    holes: [
      { number: 1, start: TEE, greenCenter: GREEN, hazards: [{ kind: 'bunker', poly: bunkerPoly }] },
      { number: 2, greenCenter: GREEN }, // no tee mapped
      { number: 3, greenFront: at(-10), greenBack: at(10) }, // admin points, no center
    ],
  };
  const GREENS_COURSE = {
    key: 'greensville',
    name: 'Greensville Golf',
    matchTokens: [['greensville']],
    mode: 'greens',
    greens: [GREEN],
  };

  beforeEach(() => setCourseGeometry([COURSE, GREENS_COURSE]));
  afterEach(() => setCourseGeometry([]));

  it('uses the GPS fix while within 1 km of the green', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: at(250) });
    expect(r.source).toBe('gps');
    expect(r.distances.center).toBeCloseTo(250, 0);
  });

  it('measures from the tee beyond 1 km', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: at(1500) });
    expect(r.source).toBe('tee');
    expect(r.distances.center).toBeCloseTo(400, 0);
  });

  it('measures from the tee with no fix at all', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: null });
    expect(r.source).toBe('tee');
    expect(r.distances.center).toBeCloseTo(400, 0);
  });

  it('tee distances include hazards ahead of the tee', () => {
    const r = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 1, fix: null });
    expect(r.distances.hazards).toHaveLength(1);
    expect(r.distances.hazards[0].kind).toBe('bunker');
    expect(r.distances.hazards[0].reach).toBeGreaterThan(200);
    expect(r.distances.hazards[0].reach).toBeLessThan(300);
  });

  it('no tee mapped: live GPS on the hole, nothing off the hole (never a far GPS distance)', () => {
    // On the hole (within 1 km): live distance to the green.
    const near = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 2, fix: at(250) });
    expect(near.source).toBe('gps');
    expect(near.distances.center).toBeCloseTo(250, 0);
    // Off the hole with no tee to measure from: show nothing, not the
    // straight-line distance to the far-away fix.
    const far = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 2, fix: at(1500) });
    expect(far).toEqual({ distances: null, source: 'gps' });
    // No fix yet, no tee: nothing.
    const none = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 2, fix: null });
    expect(none).toEqual({ distances: null, source: 'gps' });
  });

  it('no green center (front/back only): never treated as on-the-hole — null <= 1000 must not pass', () => {
    // Without a center distance the 1 km rule can't be applied; showing a
    // "live" card here from any distance on earth was the fail-open bug.
    const far = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 3, fix: at(250000) });
    expect(far).toEqual({ distances: null, source: 'gps' });
    const near = resolveScorecardDistances({ courseName: 'Testville Golf', holeNumber: 3, fix: at(250) });
    expect(near).toEqual({ distances: null, source: 'gps' });
  });

  it('greens-mode course: live GPS on the hole, nothing off the hole', () => {
    const near = resolveScorecardDistances({ courseName: 'Greensville Golf', holeNumber: 1, fix: at(250) });
    expect(near.source).toBe('gps');
    expect(near.distances.kind).toBe('nearest');
    const far = resolveScorecardDistances({ courseName: 'Greensville Golf', holeNumber: 1, fix: at(1500) });
    expect(far).toEqual({ distances: null, source: 'gps' });
  });
});
