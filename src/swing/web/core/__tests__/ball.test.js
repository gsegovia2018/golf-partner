// Port of BallTest.kt.

import {
  Gray, Lm, PoseSample, Rect, pt,
} from '../geom';
import { Ball } from '../ball';

/** Grass-like grey with a mild deterministic texture and an optional white disc. */
function frame(w, h, ball, r, seed = 0) {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let v = 90 + ((x * 7 + y * 13 + seed * 5) % 11);
      if (ball != null && Math.hypot(x - ball[0], y - ball[1]) <= r) v = 235;
      px[y * w + x] = v;
    }
  }
  return new Gray(0, 0, w, h, px);
}

/** Map frame → Gray over the inclusive range, like Kotlin `associateWith`. */
const strips = (a, b, fn) => {
  const m = new Map();
  for (let f = a; f <= b; f += 1) m.set(f, fn(f));
  return m;
};

describe('Ball.detect', () => {
  it('finds the ball blob near the shaft ray', () => {
    const roi = new Rect(0, 0, 120, 60);
    const g = frame(120, 60, [80.0, 40.0], 3.0);
    // a bright decoy of the wrong size far from the ray (just below the ball's grey, so both pass the 98th percentile)
    for (let y = 5; y <= 20; y += 1) for (let x = 5; x <= 20; x += 1) g.px[y * 120 + x] = 230;
    const b = Ball.detect([g, g, g], roi, pt(40, 0), 1, 6.0, 1.0);
    expect(b).not.toBeNull();
    expect(Math.abs(b.x - 80.0)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(b.y - 40.0)).toBeLessThanOrEqual(0.6);
    expect(b.r).toBeCloseTo(3.0, 9);
  });

  it('finds no ball without a blob of the expected size', () => {
    const g = frame(120, 60, [80.0, 40.0], 12.0);
    expect(Ball.detect([g], new Rect(0, 0, 120, 60), pt(40, 0), 1, 6.0, 1.0)).toBeNull();
  });

  it('matches numpy for the 98th percentile', () => {
    // numpy.percentile(range(100), 98) == 97.02
    expect(Ball.percentile98(Int32Array.from({ length: 100 }, (_, i) => i))).toBeCloseTo(97.02, 9);
  });
});

// ---- ballGoneFrame (apiVersion 6): the ball matched against its own picture

/** 80 × 60 grass with the ball at (40, 30), r 3 (d 6 px); `cover` paints a club-grey block over it. */
function scene(f, ball, cover = false, dx = 0) {
  const g = frame(80, 60, ball ? [40.0 + dx, 30.0] : null, 3.0, f % 3);
  if (cover) for (let y = 26; y <= 36; y += 1) for (let x = 33; x <= 47; x += 1) g.px[y * 80 + x] = 150;
  return g;
}

describe('Ball.goneFrame', () => {
  it('is the first frame of a lasting absence', () => {
    // fps 40: gone = absent for 4 frames
    const s = strips(100, 140, (f) => scene(f, f < 121));
    expect(Ball.goneFrame(s, 40.0, 30.0, 6.0, [100, 110], 110, 40.0)).toBe(121);
  });

  it('does not take a club passing in front of the ball for it leaving', () => {
    // covered at 115-116, back at 117-120, gone from 121
    const s = strips(100, 140, (f) => scene(f, f < 121, f >= 115 && f <= 116));
    expect(Ball.goneFrame(s, 40.0, 30.0, 6.0, [100, 110], 110, 40.0)).toBe(121);
  });

  it('takes a ball that moves off its spot as gone', () => {
    // the ball leaves its spot by 2 diameters (out of the ±0.4 d search) at 121
    const s = strips(100, 140, (f) => scene(f, true, false, f >= 121 ? 12 : 0));
    expect(Ball.goneFrame(s, 40.0, 30.0, 6.0, [100, 110], 110, 40.0)).toBe(121);
  });

  it('re-centres a reference off the ball, and never calls a ball that stays gone', () => {
    // the ball reference one diameter off: the template is re-centred on the ball
    const gone = strips(100, 140, (f) => scene(f, f < 121));
    expect(Ball.goneFrame(gone, 45.0, 27.0, 6.0, [100, 110], 110, 40.0)).toBe(121);
    const stays = strips(100, 140, (f) => scene(f, true));
    expect(Ball.goneFrame(stays, 40.0, 30.0, 6.0, [100, 110], 110, 40.0)).toBeNull();
    // an absence that runs out of strips before it lasts: not gone either
    const late = strips(100, 140, (f) => scene(f, f < 139));
    expect(Ball.goneFrame(late, 40.0, 30.0, 6.0, [100, 110], 110, 40.0)).toBeNull();
  });

  it('has no gone frame when the patch leaves the strip', () => {
    const s = strips(100, 140, (f) => scene(f, f < 121));
    expect(Ball.goneFrame(s, 8.0, 30.0, 6.0, [100, 110], 110, 40.0)).toBeNull();
    expect(Ball.goneFrame(s, 40.0, 30.0, 6.0, [200, 210], 110, 40.0)).toBeNull(); // no template frames
  });

  it('needs the template contrast to match', () => {
    const tpl = [0.0, 100.0, 0.0, 100.0];
    // the same pattern at a fifth of the contrast correlates perfectly but does not count
    expect(Ball.match([40.0, 60.0, 40.0, 60.0], 2, 2, tpl, 2, 2)).toBeCloseTo(-2.0, 12);
    expect(Ball.match([10.0, 90.0, 10.0, 90.0], 2, 2, tpl, 2, 2)).toBeCloseTo(1.0, 12);
  });
});

describe('Ball.pxPerCm', () => {
  it('scales from the trail leg', () => {
    const lm = new Float32Array(Lm.COUNT * 3);
    const set = (j, x, y) => {
      lm[3 * j] = x;
      lm[3 * j + 1] = y;
      lm[3 * j + 2] = 1;
    };
    set(Lm.R_HIP, 100, 100);
    set(Lm.R_KNEE, 100, 150);
    set(Lm.R_ANK, 100, 200);
    // leg 100 px = 0.49 × 176 cm → 1.1596 px/cm
    expect(Ball.pxPerCm([new PoseSample(0, 0, lm)], true, 176.0)).toBeCloseTo(100 / (0.49 * 176), 4);
  });
});
