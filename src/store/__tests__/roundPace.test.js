import {
  sunTimes, priorPace, holesToPlay, projectRound, DEFAULT_MIN_PER_HOLE, clockLabel,
} from '../roundPace';

const MIN = 60 * 1000;
const MADRID = [40.4168, -3.7038];
const at = (iso) => Date.parse(iso);

describe('sunTimes', () => {
  // Madrid, 2 Nov 2026: sunset 18:13 CET, civil dusk 18:41.
  it('matches Madrid sunset and dusk on 2 Nov within 2 min', () => {
    const r = sunTimes(at('2026-11-02T12:00:00Z'), ...MADRID);
    expect(Math.abs(r.sunset - at('2026-11-02T17:13:00Z'))).toBeLessThan(2 * MIN);
    expect(Math.abs(r.dusk - at('2026-11-02T17:41:00Z'))).toBeLessThan(2 * MIN);
  });

  // Midsummer: sunset 21:48 CEST, and civil twilight lasts longer than in autumn.
  it('matches Madrid midsummer sunset, with a longer twilight', () => {
    const r = sunTimes(at('2026-06-21T12:00:00Z'), ...MADRID);
    expect(Math.abs(r.sunset - at('2026-06-21T19:48:00Z'))).toBeLessThan(2 * MIN);
    const twilight = (r.dusk - r.sunset) / MIN;
    expect(twilight).toBeGreaterThan(30);
    expect(twilight).toBeLessThan(36);
  });

  it('gives the same day for a morning or an evening call', () => {
    const a = sunTimes(at('2026-11-02T07:00:00Z'), ...MADRID);
    const b = sunTimes(at('2026-11-02T20:00:00Z'), ...MADRID);
    expect(Math.abs(a.sunset - b.sunset)).toBeLessThan(MIN);
  });

  it('is null without coordinates or when the sun never sets', () => {
    expect(sunTimes(Date.now(), null, 3)).toBeNull();
    expect(sunTimes(at('2026-06-21T12:00:00Z'), 78, 15)).toBeNull();
  });
});

describe('priorPace', () => {
  const history = [
    { course: 'Centro Nacional de Golf', minPerHole: 15 },
    { course: 'centro nacional de golf ', minPerHole: 16 },
    { course: 'Lomas-Bosque', minPerHole: 12 },
    { course: 'Lomas-Bosque', minPerHole: 13 },
  ];
  it("uses the club's median when it has two rounds or more", () => {
    expect(priorPace(history, 'Centro Nacional de Golf')).toEqual({ minPerHole: 15.5, source: 'club' });
  });
  it('falls back to every round, then to the default', () => {
    expect(priorPace(history, 'RACE')).toEqual({ minPerHole: 14, source: 'usual' });
    expect(priorPace([], 'RACE')).toEqual({ minPerHole: DEFAULT_MIN_PER_HOLE, source: 'default' });
  });
  it('ignores implausible paces', () => {
    expect(priorPace([{ course: 'X', minPerHole: 2 }, { course: 'X', minPerHole: 90 }], 'X').source).toBe('default');
  });
});

describe('holesToPlay', () => {
  const all = Array.from({ length: 18 }, (_, i) => i + 1);
  it('continues after the last hole scored', () => {
    expect(holesToPlay(all, [1, 2, 3])).toEqual(all.slice(3));
  });
  it('wraps for a round started on the 10th', () => {
    expect(holesToPlay(all, [10, 11])).toEqual([12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('starts at the first hole before any score', () => {
    expect(holesToPlay([1, 2, 3], [])).toEqual([1, 2, 3]);
  });
});

describe('projectRound', () => {
  const remaining = [11, 12, 13, 14, 15, 16, 17, 18];
  const startAt = at('2026-11-02T13:20:00Z'); // 14:20 CET
  const lastAt = startAt + 160 * MIN; // 10 holes at 16 min
  const dusk = at('2026-11-02T17:40:00Z'); // 18:40 CET

  it('blends the live pace with the prior and names the hole where it gets dark', () => {
    const r = projectRound({ now: lastAt + 2 * MIN, startAt, lastAt, played: 10, remaining, prior: 16, dusk });
    expect(r.minPerHole).toBeCloseTo(16);
    expect(r.finishAt).toBe(lastAt + 8 * 16 * MIN); // 19:06
    expect(r.level).toBe('risk');
    expect(r.darkHole).toBe(17); // 17 would end 18:50, 16 ends 18:34
    expect(r.darkAfter).toBe(6); // 11–16 in daylight
  });

  it('weights the prior as three holes', () => {
    const r = projectRound({ now: lastAt, startAt, lastAt, played: 10, remaining, prior: 13 });
    expect(r.minPerHole).toBeCloseTo((10 * 16 + 3 * 13) / 13);
  });

  it('is tight when it finishes less than 15 min before dark', () => {
    const r = projectRound({ now: lastAt, startAt, lastAt, played: 10, remaining, prior: 16, dusk: lastAt + 8 * 16 * MIN + 10 * MIN });
    expect(r.level).toBe('tight');
    expect(r.darkHole).toBeNull();
  });

  it('is ok with light to spare, and without a dusk', () => {
    expect(projectRound({ now: lastAt, startAt, lastAt, played: 10, remaining, prior: 16, dusk: dusk + 3 * 3600e3 }).level).toBe('ok');
    expect(projectRound({ now: lastAt, startAt, lastAt, played: 10, remaining, prior: 16 }).level).toBe('ok');
  });

  it('uses the prior alone before the first hole, from now', () => {
    const now = at('2026-11-02T13:20:00Z');
    const r = projectRound({ now, played: 0, remaining: Array.from({ length: 18 }, (_, i) => i + 1), prior: 14 });
    expect(r.finishAt).toBe(now + 18 * 14 * MIN);
  });

  it('moves the finish later while the current hole runs long', () => {
    const r = projectRound({ now: lastAt + 40 * MIN, startAt, lastAt, played: 10, remaining, prior: 16 });
    expect(r.finishAt).toBe(lastAt + 40 * MIN - 16 * MIN + 8 * 16 * MIN);
  });

  it('ignores a live pace that is not a round (holes typed in one go)', () => {
    const r = projectRound({ now: lastAt, startAt, lastAt: startAt + 5 * MIN, played: 10, remaining, prior: 15 });
    expect(r.minPerHole).toBe(15);
  });

  it('is null when nothing is left to play', () => {
    expect(projectRound({ now: lastAt, remaining: [] })).toBeNull();
  });
});

describe('clockLabel', () => {
  it('pads hours and minutes', () => {
    const d = new Date(2026, 10, 2, 9, 5);
    expect(clockLabel(d.getTime())).toBe('09:05');
  });
});
