// Port of modules/golf-swing ClubheadTest.kt.

import { Gray, Rect } from '../geom';
import { ShaftSearch, ClubheadTrack, headPos } from '../clubhead';
import { JavaRandom } from './javaRandom';

const toRadians = (deg) => deg * 0.017453292519943295;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Grass-like grey: 100 plus seeded, isotropic noise of 0-8 grey levels. */
function grass(w, h, seed = 1) {
  const rnd = new JavaRandom(seed);
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i += 1) px[i] = 100 + rnd.nextInt(9);
  return new Gray(0, 0, w, h, px);
}

/** A dark 2 px shaft from (hx, hy) at `deg` for `len` px, ending in a darker clubhead blob. */
function drawShaft(g, hx, hy, deg, len, headR = 3.0) {
  const dx = Math.cos(toRadians(deg));
  const dy = Math.sin(toRadians(deg));
  for (let y = 0; y < g.h; y += 1) {
    for (let x = 0; x < g.w; x += 1) {
      const rx = x - hx;
      const ry = y - hy;
      const along = rx * dx + ry * dy;
      const across = Math.abs(-rx * dy + ry * dx);
      if (along >= 0 && along <= len && across <= 1.0) g.px[y * g.w + x] = 30;
      if (Math.hypot(x - (hx + dx * len), y - (hy + dy * len)) <= headR) g.px[y * g.w + x] = 10;
    }
  }
}

describe('ShaftSearch', () => {
  test('finds a drawn shaft angle, length and head from the hands-to-ball seed', () => {
    const g = grass(240, 240);
    drawShaft(g, 60, 50, 60, 110);
    const s = ShaftSearch.search(g, 240, 240, 60, 50, 120, 6, 55);
    expect(Math.abs(s.angleDeg - 60)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.lengthPx - 110)).toBeLessThanOrEqual(0.05 * 110);
    expect(s.hidden).toBe(false);
    expect(s.conf).toBeGreaterThan(0.35);
    const ex = 60 + Math.cos(toRadians(60)) * 110;
    const ey = 50 + Math.sin(toRadians(60)) * 110;
    expect(Math.hypot(s.headX - ex, s.headY - ey)).toBeLessThanOrEqual(4);
  });

  test('the seed window is honoured over a stronger line elsewhere', () => {
    const g = grass(240, 240);
    drawShaft(g, 120, 60, 60, 100);
    drawShaft(g, 120, 60, 150, 110);
    const s = ShaftSearch.search(g, 240, 240, 120, 60, 120, 6, 55);
    expect(Math.abs(s.angleDeg - 60)).toBeLessThanOrEqual(2);
  });

  test('no edges means hidden', () => {
    const g = new Gray(0, 0, 240, 240, new Uint8Array(240 * 240).fill(100));
    const s = ShaftSearch.search(g, 240, 240, 120, 120, 100, 6, 60);
    expect(s.hidden).toBe(true);
    expect(s.conf).toBe(0);
  });

  test('a shaft end-on to the camera is hidden', () => {
    // the visible shaft is far shorter than 0.3 × expected (takeaway, transition)
    const g = grass(240, 240);
    drawShaft(g, 120, 120, 60, 18, 0);
    const s = ShaftSearch.search(g, 240, 240, 120, 120, 100, 6, 60);
    expect(s.hidden).toBe(true);
  });

  test('a patch clipped to the image reads zero outside, like remap', () => {
    // hands near the right edge: rays leaving the image must not throw and the shaft is still found
    const full = grass(200, 200);
    drawShaft(full, 180, 40, 120, 90);
    const half = ShaftSearch.patchHalf(100, 6);
    const r = new Rect(Math.max(0, 180 - half), Math.max(0, 40 - half), Math.min(200, 180 + half + 1), Math.min(200, 40 + half + 1));
    const px = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y += 1) for (let x = 0; x < r.w; x += 1) px[y * r.w + x] = full.px[(y + r.y0) * 200 + x + r.x0];
    const s = ShaftSearch.search(new Gray(r.x0, r.y0, r.w, r.h, px), 200, 200, 180, 40, 100, 6, 115);
    expect(Math.abs(s.angleDeg - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.lengthPx - 90)).toBeLessThanOrEqual(0.05 * 90);
  });

  test('boxSame matches numpy convolve "same"', () => {
    const v = Float32Array.from([1, 5, 2, 8, 3, 9, 4, 0, 6, 7]);
    // numpy.convolve(v, ones(n) / n, "same") for n = 3 and n = 4
    const n3 = [2.0, 2.666667, 5.0, 4.333333, 6.666667, 5.333333, 4.333333, 3.333333, 4.333333, 4.333333];
    const n4 = [1.5, 2.0, 4.0, 4.5, 5.5, 6.0, 4.0, 4.75, 4.25, 3.25];
    ShaftSearch.boxSame(v, 3).forEach((x, i) => expect(Math.abs(x - n3[i])).toBeLessThanOrEqual(1e-5));
    ShaftSearch.boxSame(v, 4).forEach((x, i) => expect(Math.abs(x - n4[i])).toBeLessThanOrEqual(1e-5));
  });

  test('reflect 101', () => {
    expect(ShaftSearch.reflect(-1, 5)).toBe(1);
    expect(ShaftSearch.reflect(5, 5)).toBe(3);
    expect(ShaftSearch.reflect(-1, 1)).toBe(0);
  });
});

// ---- image-based address (apiVersion 6: the clubhead's track)

/** A track standing still, then moving at `speed` (frame → cm/s along x) from a frame on. */
function trackOf([lo, hi], fps, speed, score = () => 0.95) {
  const out = new Map();
  let x = 0;
  for (let f = lo; f <= hi; f += 1) {
    x += speed(f) / fps;
    out.set(f, headPos(x, 0, score(f), false));
  }
  return out;
}

/** A textured strip with a fixed ball and a bright clubhead block at (hx, hy) (sub-pixel by area). */
function stripWith(hx, hy, seed) {
  const w = 120;
  const h = 120;
  const rnd = new JavaRandom(seed);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // static texture (the same in every frame) plus a little sensor noise
      let v = 80.0 + 20 * Math.sin(x * 0.7) * Math.cos(y * 0.45) + rnd.nextInt(3);
      if (Math.hypot(x - 60.0, y - 60.0) <= 4.5) v = 230.0;
      // the head: a 12 × 6 block, its edges covered by area for sub-pixel moves
      const cx = clamp(Math.min(x + 1.0, hx + 6) - Math.max(x, hx - 6), 0, 1);
      const cy = clamp(Math.min(y + 1.0, hy + 3) - Math.max(y, hy - 3), 0, 1);
      v = v * (1 - cx * cy) + 200 * cx * cy;
      px[y * w + x] = clamp(Math.trunc(v), 0, 255);
    }
  }
  return new Gray(0, 0, w, h, px);
}

describe('ClubheadTrack', () => {
  test('address is the last frame before the head moves back', () => {
    // 100 fps: lag 4 frames, hold 10. Still to 100, then 30 cm/s: the backward speed is 7.5 cm/s
    // at 101 and 15 at 102, so 101 is the last "not moving" frame (a frame of latency at this speed)
    const t = trackOf([0, 200], 100, (f) => (f > 100 ? 30 : 0));
    expect(ClubheadTrack.address(t, 10, 200, 100, false)).toBe(101);
  });

  test('the slow creep counts and a short pause inside it does not', () => {
    // creep at 15 cm/s from 60, a 6-frame pause (< hold) at 90, faster from 110, gone at 150
    const t = trackOf([0, 200], 100, (f) => {
      if (f <= 60) return 0;
      if (f >= 90 && f <= 95) return 0;
      if (f < 110) return 15;
      return 25;
    }, (f) => (f >= 150 ? 0.3 : 0.95));
    const a = ClubheadTrack.address(t, 10, 200, 100, false);
    expect(a).toBeGreaterThanOrEqual(60);
    expect(a).toBeLessThanOrEqual(62);
  });

  test('jitter below the moving speed is still', () => {
    // ±0.02 cm frame to frame (2 cm/s over the lag at most), then the takeaway
    const out = new Map();
    for (let f = 0; f <= 200; f += 1) {
      out.set(f, headPos(f > 120 ? (f - 120) * 0.5 : f % 2 === 0 ? 0.02 : 0, 0, 0.95, false));
    }
    expect(ClubheadTrack.address(out, 0, 200, 100, false)).toBe(120);
  });

  test('a track that starts mid-creep is the clip start only at the clip start', () => {
    const t = trackOf([0, 100], 100, (f) => (f < 80 ? 15 : 60));
    expect(ClubheadTrack.address(t, 0, 100, 100, true)).toBe(4); // the first frame with a speed
    expect(ClubheadTrack.address(t, 0, 100, 100, false)).toBeNull();
  });

  test('samples spread over the window and the earliest head at the ball wins', () => {
    expect(ClubheadTrack.samples(100, 200)).toEqual([100, 117, 133, 150, 167, 183]);
    const heads = new Map([
      [100, null],
      [117, [500, 500, 0.9]], // far from the ball (a spare club)
      [133, [110, 210, 0.2]], // too weak
      [150, [112, 212, 0.8]],
      [167, [111, 211, 0.9]],
    ]);
    expect(ClubheadTrack.restingHead(heads, 100, 200, 2)).toEqual([150, 112, 212]);
    expect(ClubheadTrack.restingHead(new Map([[1, null]]), 100, 200, 2)).toBeNull();
  });

  test('fallback head sits toward the golfer and the camera', () => {
    // d = 4.27 × 2 = 8.54 px; hands left of the ball (right-hander filmed down the line)
    const [x, y] = ClubheadTrack.fallbackHead(100, 200, 40, 2);
    expect(x).toBeCloseTo(100 - 0.5 * 8.54, 9);
    expect(y).toBeCloseTo(200 + 0.8 * 8.54, 9);
    expect(ClubheadTrack.fallbackHead(100, 200, 160, 2)[0]).toBeCloseTo(100 + 0.5 * 8.54, 9);
  });

  test('the strip is six diameters, sampled to eight per diameter', () => {
    // d = 4.27 × 5 = 21.35 px: half 128, step 2
    const [r, step] = ClubheadTrack.stripRect(500, 900, 5, 1080, 1920);
    expect(r).toEqual(new Rect(372, 772, 629, 1029));
    expect(step).toBe(2);
    expect(ClubheadTrack.stripRect(-51, 0.4, 5, 1080, 1920)[0]).toEqual(new Rect(0, 0, 78, 129));
    expect(ClubheadTrack.stripRect(500, 900, 1.5, 1080, 1920)[1]).toBe(1);
  });

  test('track follows the head past the ball it rests beside', () => {
    // strip px = frame px (step 1), 2 px/cm: d = 8.5 px; the head rests below-left of the ball
    const strips = new Map();
    for (let f = 0; f <= 20; f += 1) strips.set(f, stripWith(54 + (f > 10 ? (f - 10) * 0.5 : 0), 67, f));
    const t = ClubheadTrack.track(strips, [0, 0], 1, 0, 54, 67, 60, 60, 2);
    expect(t.size).toBe(21);
    expect(Math.abs(t.get(5).dx)).toBeLessThanOrEqual(0.05);
    // 10 frames × 0.5 px = 5 px = 2.5 cm
    expect(Math.abs(t.get(20).dx - 2.5)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(t.get(20).dy)).toBeLessThanOrEqual(0.15);
    // the static texture inside the template lowers the score as the head moves off: still tracked
    expect([...t.values()].every((p) => p.score > ClubheadTrack.LOST_NCC && !p.edge)).toBe(true);
    expect(t.get(0).score).toBeCloseTo(1, 9);
  });

  test('no track when the search leaves the strip', () => {
    const strips = new Map([[0, stripWith(54, 67, 0)]]);
    expect(ClubheadTrack.track(strips, [0, 0], 1, 0, 3, 67, 60, 60, 2).size).toBe(0);
    expect(ClubheadTrack.track(strips, [0, 0], 1, 7, 54, 67, 60, 60, 2).size).toBe(0); // no strip at ref
  });

  test('masked NCC ignores the masked pixels', () => {
    // a window equal to the template except inside the "masked" pixels: a perfect match
    const rnd = new JavaRandom(3);
    const px = new Uint8Array(25);
    for (let i = 0; i < 25; i += 1) px[i] = 50 + rnd.nextInt(150);
    const g = new Gray(0, 0, 5, 5, px);
    const idx = [0, 1, 2, 4, 6, 8]; // a 3-wide template without offsets 3, 5, 7
    const tpl = Float64Array.from(idx, (o) => g.at(1 + (o % 3), 1 + Math.trunc(o / 3)));
    g.px[2 * 5 + 1] = 0; // offset 3 at (1, 1): masked, so the match stays perfect
    const out = new Float64Array(9);
    ClubheadTrack.maskedNcc(g, 0, 0, 3, idx, tpl, 3, out);
    expect(out[4]).toBeCloseTo(1, 9);
    expect([...out].every((v, i) => i === 4 || v < 0.99)).toBe(true);
  });
});
