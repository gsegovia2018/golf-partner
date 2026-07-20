import { anchorFor, ANCHOR_MAX_GPS_METERS } from '../flyoverModel';

// ~111,320 m per degree of latitude; latitude-only offsets make distances
// predictable without longitude scaling.
const GREEN = [38.56, -0.139];
const at = (metersNorth) => [GREEN[0] + metersNorth / 111320, GREEN[1]];
const TEE = at(400);

describe('anchorFor', () => {
  it('uses the player when within 700 m of the green', () => {
    const r = anchorFor({ player: at(250), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('gps');
    expect(r.anchor).toEqual(at(250));
    expect(r.playerDistance).toBeCloseTo(250, 0);
  });

  it('700 m exactly still counts as on-course (inclusive)', () => {
    const r = anchorFor({ player: at(ANCHOR_MAX_GPS_METERS), tee: TEE, greenCenter: GREEN });
    expect(r.source).toBe('gps');
  });

  it('falls back to the tee beyond 700 m', () => {
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
