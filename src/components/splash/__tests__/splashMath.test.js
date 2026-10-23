import {
  pickScene, SCENES, cubicBezier, ellipsePath, ballDimples,
  puttFrame, PUTT_CYCLE, PUTT_ROLL,
  greenFrame, GREEN_CYCLE, GREEN_CUP,
  swingPose, swingSolve, swingFrame, SWING_KEYS, SWING_IMPACT, SWING_BALL, SWING_CYCLE,
  ARM_UPPER, ARM_FORE,
  waterFrame, WATER_CYCLE, WATER_SPLASH,
} from '../splashMath';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const times = (cycle, step = 0.01) => Array.from({ length: Math.floor(cycle / step) }, (_, i) => i * step);

describe('pickScene', () => {
  it('maps the whole random range onto the four scenes', () => {
    expect(pickScene(() => 0)).toBe('putt');
    expect(pickScene(() => 0.3)).toBe('green');
    expect(pickScene(() => 0.6)).toBe('swing');
    expect(pickScene(() => 0.9999)).toBe('water');
    expect(SCENES).toHaveLength(4);
  });
});

describe('helpers', () => {
  it('cubicBezier matches its endpoints and stays monotonic for an ease-out', () => {
    expect(cubicBezier(0.2, 0.35, 0.8, 0.95, 0)).toBe(0);
    expect(cubicBezier(0.2, 0.35, 0.8, 0.95, 1)).toBe(1);
    let prev = 0;
    for (let p = 0.05; p < 1; p += 0.05) {
      const v = cubicBezier(0.2, 0.35, 0.8, 0.95, p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('ellipsePath draws a closed two-arc ellipse', () => {
    expect(ellipsePath(10, 10, 4, 2, 30)).toMatch(/^M[\d.\- ]+ A4\.00 2\.00 30\.00 1 0 .+ Z$/);
  });

  it('ballDimples covers the visible hemisphere inside the ball', () => {
    const dimples = ballDimples();
    expect(dimples.length).toBeGreaterThan(60);
    dimples.forEach((d) => expect(Math.hypot(d.cx - 8, d.cy - 8)).toBeLessThanOrEqual(8));
  });
});

describe('putt scene', () => {
  it('rests until the strike, rolls forward only, and ends sunk in the cup', () => {
    expect(puttFrame(0.2 * PUTT_CYCLE).ballX).toBe(0);
    let prev = 0;
    times(PUTT_CYCLE).forEach((t) => {
      const { ballX } = puttFrame(t);
      expect(ballX).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = ballX;
    });
    const end = puttFrame(0.9 * PUTT_CYCLE);
    expect(end.ballX).toBeGreaterThan(PUTT_ROLL);
    expect(end.ballY).toBeCloseTo(22);
    expect(end.putterOpacity).toBe(0);
  });
});

describe('green scene', () => {
  it('sinks the ball at the cup and keeps the putter face behind it before impact', () => {
    const atLip = greenFrame(0.795 * GREEN_CYCLE);
    expect(dist([atLip.ballX, atLip.ballY], GREEN_CUP)).toBeLessThan(2);
    expect(atLip.ballOpacity).toBeLessThan(0.1);
    const address = greenFrame(0.05 * GREEN_CYCLE);
    expect(address.ballX).toBe(48);
    expect(address.ballY).toBe(112);
  });
});

describe('swing scene', () => {
  const frames = times(SWING_KEYS[SWING_KEYS.length - 1][0] + 0.2, 0.005).map((t) => swingSolve(swingPose(t)));

  it('keeps both arms at their real length and never stretches them', () => {
    frames.forEach((f) => {
      expect(dist(f.shR, f.elR)).toBeCloseTo(ARM_UPPER, 5);
      expect(dist(f.shL, f.elL)).toBeCloseTo(ARM_UPPER, 5);
      expect(dist(f.elR, f.hands)).toBeLessThanOrEqual(ARM_FORE + 0.1);
      expect(dist(f.elL, f.handT)).toBeLessThanOrEqual(ARM_FORE + 0.1);
    });
  });

  it('never crosses the legs', () => {
    frames.forEach((f) => {
      expect(f.knL[0]).toBeLessThan(f.knR[0]);
      expect(f.ankL[0]).toBeLessThan(f.ankR[0]);
    });
  });

  it('points both elbows at the ground', () => {
    // Of the two elbow positions that fit shoulder -> hand, the chosen one is the lower.
    const mirror = (sh, el, h) => {
      const dx = h[0] - sh[0];
      const dy = h[1] - sh[1];
      const k = ((el[0] - sh[0]) * dx + (el[1] - sh[1]) * dy) / (dx * dx + dy * dy);
      const foot = [sh[0] + k * dx, sh[1] + k * dy];
      return [2 * foot[0] - el[0], 2 * foot[1] - el[1]];
    };
    frames.forEach((f) => {
      expect(f.elR[1]).toBeGreaterThanOrEqual(mirror(f.shR, f.elR, f.hands)[1] - 1e-6);
      expect(f.elL[1]).toBeGreaterThanOrEqual(mirror(f.shL, f.elL, f.handT)[1] - 1e-6);
    });
  });

  it('brings the clubhead back to the ball at impact, with the hands ahead of it', () => {
    const f = swingSolve(swingPose(SWING_IMPACT));
    expect(Math.abs(f.club[0] - SWING_BALL[0])).toBeLessThan(0.01);
    expect(Math.abs(f.club[1] - SWING_BALL[1])).toBeLessThan(3);
    expect(f.hands[0]).toBeGreaterThan(f.club[0]);
  });

  it('holds the wrist angle into the downswing and releases late (no casting)', () => {
    const hinge = (t) => { const q = swingPose(t); return q[2] - q[0]; };   // club angle - arm angle
    const top = SWING_KEYS[3][0];
    const p5 = SWING_KEYS[4][0];
    expect(hinge(p5)).toBeGreaterThan(0.9 * hinge(top));
    expect(Math.abs(hinge(SWING_IMPACT))).toBeLessThan(5);
  });

  it('launches the ball after impact and fades the figure out before the loop', () => {
    expect(swingFrame(SWING_IMPACT - 0.05).ballX).toBeCloseTo(SWING_BALL[0]);
    expect(swingFrame(SWING_IMPACT + 0.2).ballX).toBeGreaterThan(SWING_BALL[0] + 50);
    expect(swingFrame(3.3).figureOpacity).toBeLessThan(0.5);
    expect(swingFrame(SWING_CYCLE - 0.001).figureOpacity).toBeGreaterThan(0.9);
  });
});

describe('water scene', () => {
  it('lands the ball at the splash point, then hides it under the surface', () => {
    const landing = waterFrame(0.36 * WATER_CYCLE);
    expect(dist([landing.ballX, landing.ballY], WATER_SPLASH)).toBeLessThan(1.5);
    expect(waterFrame(0.45 * WATER_CYCLE).ballOpacity).toBe(0);
  });

  it('opens the rings only after the ball lands, and they spread as they fade', () => {
    expect(waterFrame(0.2 * WATER_CYCLE).ripples[0].opacity).toBe(0);
    const early = waterFrame(0.45 * WATER_CYCLE).ripples[0];
    const late = waterFrame(0.8 * WATER_CYCLE).ripples[0];
    expect(late.rx).toBeGreaterThan(early.rx);
    expect(late.opacity).toBeLessThan(early.opacity);
  });

  it('throws droplets up and lets them fall back', () => {
    const up = waterFrame(0.45 * WATER_CYCLE).drops[1];
    const down = waterFrame(0.53 * WATER_CYCLE).drops[1];
    expect(up.y).toBeLessThan(WATER_SPLASH[1] - 10);
    expect(down.y).toBeGreaterThan(up.y);
    expect(waterFrame(0.6 * WATER_CYCLE).drops[1].opacity).toBe(0);
  });
});
