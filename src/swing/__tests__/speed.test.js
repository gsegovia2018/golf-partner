// Face-on speed (plan 2026-10-30 §5): pass 2's pixels -> m/s, smash factor, launch, and the gates.
// The raw numbers are the lab's iPhone 240 fps amateur iron (tools/swing-lab/ball_flight.py):
// ball 70.9 px / frame at 26° up, diameter 16.6 px, clubhead 47.5 px / frame.
import { speedOf, speedRows } from '../speed';
import { valueText } from '../highlights';
import * as settings from '../../store/settingsStore';

const raw = {
  x: 611, y: 684, d: 16.56, step: 2, ball: { vx: 63.6, vy: -31.3, residual: 3.5, kept: 7 }, club: 47.5, clubPoints: 3,
};
const ctx = { fps: 240, pxPerCm: 16.56 / 4.27 / 1.1, dir: 1, ankles: null };

describe('speedOf', () => {
  test('px per frame at the ball\'s own scale and the capture fps', () => {
    const s = speedOf(raw, ctx);
    expect(s.reason).toBeNull();
    expect(s.ballMs).toBeCloseTo((Math.hypot(63.6, -31.3) * 240) / (16.56 / 4.27) / 100, 6);
    expect(s.ballMs * 2.23694).toBeGreaterThan(95);
    expect(s.ballMs * 2.23694).toBeLessThan(100);
    expect(s.clubMs * 2.23694).toBeCloseTo(65.6, 0);
    expect(s.smash).toBeCloseTo(1.49, 2);
    expect(s.launchDeg).toBeCloseTo(26.2, 0);
  });

  test('the launch is read against the ground line, toward the target', () => {
    // the camera tilted: the ankles rise 3° toward the target, so the ball's launch is 3° less
    const t = Math.tan((3 * Math.PI) / 180) * 100;
    const s = speedOf(raw, { ...ctx, ankles: { trail: [500, 700], lead: [600, 700 - t] } });
    expect(s.launchDeg).toBeCloseTo(23.2, 0);
    // a left-hander: the target is to the left, the flight mirrored
    const m = speedOf({ ...raw, ball: { ...raw.ball, vx: -63.6 } }, { ...ctx, dir: -1 });
    expect(m.launchDeg).toBeCloseTo(26.2, 0);
  });

  test('the gates: binary, frame rate, the ball at rest, its scale, plausible speeds and smash', () => {
    expect(speedOf({ unsupported: true }, ctx).reason).toBe('unsupported');
    expect(speedOf(raw, { ...ctx, fps: 60 }).reason).toBe('fps');
    expect(speedOf(null, ctx).reason).toBe('no_ball');
    // the ball read half its size against the legs: a misread, no speed at all
    expect(speedOf(raw, { ...ctx, pxPerCm: (2 * 16.56) / 4.27 }).reason).toBe('scale');
    expect(speedOf({ ...raw, ball: null, club: null }, ctx).reason).toBe('no_flight');
    // a 400 mph ball is a misread; the club still stands on its own
    const fast = speedOf({ ...raw, ball: { vx: 300, vy: 0 } }, ctx);
    expect(fast.ballMs).toBeNull();
    expect(fast.clubMs).not.toBeNull();
    // a smash of 2: the club reading is the worse one and is dropped
    const slow = speedOf({ ...raw, club: 32 }, ctx);
    expect(slow.clubMs).toBeNull();
    expect(slow.smash).toBeNull();
    expect(slow.ballMs).not.toBeNull();
  });
});

describe('speedRows', () => {
  afterEach(() => jest.restoreAllMocks());

  test('four Extras estimates: no dot, no rank', () => {
    const rows = speedRows(raw, ctx);
    expect(rows.map((r) => r.id)).toEqual(['speed_ball', 'speed_club', 'speed_smash', 'speed_launch']);
    rows.forEach((r) => {
      expect(r).toMatchObject({ extra: true, info: true, status: 'unknown', position: null });
    });
  });

  test('one row saying why, and none when pass 2 was never asked', () => {
    const rows = speedRows({ unsupported: true }, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeNull();
    expect(rows[0].text).toBeTruthy();
    expect(speedRows(undefined, ctx)).toEqual([]);
  });

  test('stored in m/s, shown in the player\'s units', () => {
    const ball = speedRows(raw, ctx)[0];
    expect(valueText(ball)).toMatch(/^≈ \d+ km\/h$/);
    jest.spyOn(settings, 'getAppSettings').mockReturnValue({ units: 'yards' });
    expect(valueText(ball)).toMatch(/^≈ 9\d mph$/);
    expect(valueText(speedRows(raw, ctx)[2])).toMatch(/^≈ 1[.,]49$/);
  });
});
