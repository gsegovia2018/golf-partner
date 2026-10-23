// The radial shaft search and the clubhead address track, ported from modules/golf-swing Clubhead.kt.

import { Ball } from './ball';
import { Rect } from './geom';

/** Java Math.rint: round half to even. */
const rint = (x) => {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** Java Math.floorMod for ints. */
const floorMod = (a, n) => ((a % n) + n) % n;

/** Java Math.toRadians (JDK 9+: a multiplication by the constant). */
const toRadians = (deg) => deg * 0.017453292519943295;

const coerceIn = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * One radial shaft search (plan §4.3), ported from tools/swing-lab/detect.py `ShaftSearch`
 * (d15). v1 (D16) runs it only at address and impact, seeded with the hands → ball direction.
 * Everything is in working-image px.
 *
 * Its result (ShaftFound): `{ angleDeg, lengthPx, ratio, endX, endY, headX, headY, hidden, conf }`.
 */
export const ShaftSearch = {
  HALF_WIDTH_DEG: 15,
  LENGTH_DROP: 0.35,
  HIDDEN_RATIO: 2.5,
  HIDDEN_LENGTH: 0.3,

  /** Half size of the patch `search` reads around the hands: the rays, the blob window, Sobel and bilinear margins. */
  patchHalf(exp, ballD) {
    return Math.ceil(exp) + blobHalf(ballD) + 4;
  },

  /**
   * `g` must cover patchHalf around the hands (clipped to the image); `imgW` × `imgH` is the
   * whole working image (rays leaving it read 0, like cv2.remap's constant border).
   * `centerDeg` null = free 360° search. Angles are image angles (y down), 0° = +x.
   */
  search(g, imgW, imgH, hx, hy, exp, ballD, centerDeg) {
    const grad = new Sobel(g);
    const r0 = Math.max(2, 0.15 * exp);
    const nr = Math.max(1, Math.trunc(Math.ceil((exp + 1e-6 - r0) / 1)));
    const prof = Array.from({ length: 360 }, () => new Float32Array(nr));
    const score = new Float64Array(360);
    for (let t = 0; t < 360; t += 1) {
      const th = toRadians(t);
      const dx = Math.cos(th);
      const dy = Math.sin(th);
      const row = prof[t];
      let s = 0;
      for (let k = 0; k < nr; k += 1) {
        const r = r0 + k;
        const x = Math.fround(hx + dx * r);
        const y = Math.fround(hy + dy * r);
        const gx = grad.sample(grad.gx, x, y, imgW, imgH);
        const gy = grad.sample(grad.gy, x, y, imgW, imgH);
        const par = Math.abs(gx * dx + gy * dy);
        const perp = Math.abs(-gx * dy + gy * dx);
        row[k] = perp - par;
        s += row[k];
      }
      score[t] = s;
    }
    const med = ShaftSearch.median(score);
    const hw = ShaftSearch.HALF_WIDTH_DEG;
    const cand = centerDeg == null
      ? Array.from({ length: 360 }, (_, i) => i)
      : Array.from({ length: 2 * hw + 1 }, (_, i) => floorMod(rint(centerDeg + i - hw), 360));
    let k = cand[0];
    for (const c of cand) if (score[c] > score[k]) k = c;
    const best = score[k];
    const ratio = med > 0 ? best / med : best > 0 ? Infinity : 0;

    // length along the best ray: where the window-averaged profile drops below 35 % of its peak
    const win = Math.max(3, rint(0.05 * exp));
    const p = ShaftSearch.boxSame(prof[k], win);
    let kp = 0;
    for (let i = 0; i < p.length; i += 1) if (p[i] > p[kp]) kp = i;
    let below = -1;
    for (let i = kp + 1; i < p.length; i += 1) {
      if (p[i] < ShaftSearch.LENGTH_DROP * p[kp]) {
        below = i;
        break;
      }
    }
    const length = r0 + (below >= 0 ? below : nr - 1);
    const rad = toRadians(k);
    const ex = hx + Math.cos(rad) * length;
    const ey = hy + Math.sin(rad) * length;
    const [bx, by] = ShaftSearch.blob(g, imgW, imgH, ex, ey, ballD);
    const conf = coerceIn((ratio - 1) / 4, 0, 1) * Math.min(1, length / exp);
    const hidden = ratio < ShaftSearch.HIDDEN_RATIO || length < ShaftSearch.HIDDEN_LENGTH * exp;
    return { angleDeg: k, lengthPx: length, ratio, endX: ex, endY: ey, headX: bx, headY: by, hidden, conf };
  },

  /** numpy.convolve(v, ones(n) / n, "same"): the window of output i starts at i − n / 2. */
  boxSame(v, n) {
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i += 1) {
      let s = 0;
      const lo = i - Math.trunc(n / 2);
      for (let j = lo; j < lo + n; j += 1) if (j >= 0 && j < v.length) s += v[j];
      out[i] = s / n;
    }
    return out;
  },

  /**
   * The clubhead blob: the most contrasting pixel (|3×3 Gaussian − window median|) within a
   * window of 1.5 ball diameters around the shaft end; the end itself when the window leaves
   * the image. Returns [x, y].
   */
  blob(g, imgW, imgH, x, y, ballD) {
    const half = blobHalf(ballD);
    const x0 = rint(x) - half;
    const y0 = rint(y) - half;
    const n = 2 * half + 1;
    if (x0 < 0 || y0 < 0 || x0 + n > imgW || y0 + n > imgH) return [x, y];
    if (!g.contains(x0, y0) || !g.contains(x0 + n - 1, y0 + n - 1)) return [x, y];
    const { reflect } = ShaftSearch;
    // cv2.GaussianBlur((3, 3), 0) = separable [1/4, 1/2, 1/4], BORDER_REFLECT_101 at the window edge
    const at = (i, j) => g.at(x0 + reflect(i, n), y0 + reflect(j, n));
    const h = new Float64Array(n * n);
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) h[j * n + i] = 0.25 * at(i - 1, j) + 0.5 * at(i, j) + 0.25 * at(i + 1, j);
    const b = new Float64Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        b[j * n + i] = 0.25 * h[reflect(j - 1, n) * n + i] + 0.5 * h[j * n + i] + 0.25 * h[reflect(j + 1, n) * n + i];
      }
    }
    const m = ShaftSearch.median(b);
    let best = 0;
    for (let q = 0; q < b.length; q += 1) if (Math.abs(b[q] - m) > Math.abs(b[best] - m)) best = q;
    return [x0 + (best % n), y0 + Math.trunc(best / n)];
  },

  /** BORDER_REFLECT_101: −1 → 1, n → n − 2. */
  reflect(i, n) {
    if (n === 1) return 0;
    if (i < 0) return -i;
    if (i >= n) return 2 * n - 2 - i;
    return i;
  },

  median(v) {
    const s = Float64Array.from(v).sort();
    const m = s.length >> 1;
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
};

function blobHalf(ballD) {
  return Math.max(2, rint(0.75 * ballD));
}

/** 3×3 Sobel of a patch (cv2.Sobel ksize 3, BORDER_REFLECT_101 at the patch edge). */
class Sobel {
  constructor(g) {
    this.g = g;
    const { w, h } = g;
    this.gx = new Float32Array(w * h);
    this.gy = new Float32Array(w * h);
    const { reflect } = ShaftSearch;
    const v = (i, j) => g.px[reflect(j, h) * w + reflect(i, w)];
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        this.gx[j * w + i] = (v(i + 1, j - 1) + 2 * v(i + 1, j) + v(i + 1, j + 1)) - (v(i - 1, j - 1) + 2 * v(i - 1, j) + v(i - 1, j + 1));
        this.gy[j * w + i] = (v(i - 1, j + 1) + 2 * v(i, j + 1) + v(i + 1, j + 1)) - (v(i - 1, j - 1) + 2 * v(i, j - 1) + v(i + 1, j - 1));
      }
    }
  }

  /**
   * cv2.remap INTER_LINEAR with a constant 0 border: coordinates quantised to 1/32 px as
   * OpenCV does, neighbours outside the image (or the patch) read 0.
   */
  sample(a, x, y, imgW, imgH) {
    const { g } = this;
    const ix = rint(Math.fround(x * 32));
    const iy = rint(Math.fround(y * 32));
    const x0 = ix >> 5;
    const y0 = iy >> 5;
    const fx = (ix & 31) / 32;
    const fy = (iy & 31) / 32;
    const px = (xx, yy) => {
      if (xx < 0 || yy < 0 || xx >= imgW || yy >= imgH || !g.contains(xx, yy)) return 0;
      return a[(yy - g.y0) * g.w + (xx - g.x0)];
    };
    return (1 - fy) * ((1 - fx) * px(x0, y0) + fx * px(x0 + 1, y0)) + fy * ((1 - fx) * px(x0, y0 + 1) + fx * px(x0 + 1, y0 + 1));
  }
}

/** One frame of the head track (HeadPos): where the head is relative to the reference frame, cm, the match score, on the search border. */
export const headPos = (dx, dy, score, edge) => ({ dx, dy, score, edge });

/**
 * P1 address from the image (apiVersion 6, detect.py `clubhead_address`): the last frame before
 * the clubhead starts moving back, the slow creep of a takeaway included. The clubhead itself is
 * followed with a template (masked around the ball, which it rests next to) through grey strips
 * around the ball, and its speed in cm/s decides.
 *
 * Strips are frame px (display-oriented, decimated like the copies) point-sampled every `step`
 * px over stripRect: `new Gray(0, 0, …)` in sample units. Frame-keyed inputs and outputs are
 * `Map`s with number keys.
 */
export const ClubheadTrack = {
  /** The head track starts this long before the hands' still run (the creep can start earlier). */
  PRE_S: 0.5,
  STRIP_D: 6.0,
  SAMPLES: 6,
  HEAD_MIN: 0.25,
  HEAD_CM: 30.0,
  TPL_W_CM: 8.0,
  TPL_H_CM: 6.0,
  BALL_MASK_D: 0.6,
  SEARCH_D: 1.5,
  LAG_S: 0.04,
  HOLD_S: 0.1,
  MOVING_CMS: 10.0,
  FAST: 3.0,
  LOST_NCC: 0.5,

  /** The strip in frame px and its sampling step: [Rect, step]; ± STRIP_D ball diameters, ≥ 8 samples per diameter. */
  stripRect(ballX, ballY, pxPerCm, frameW, frameH) {
    const d = Ball.BALL_CM * pxPerCm;
    const half = Math.max(4, rint(ClubheadTrack.STRIP_D * d));
    const step = Math.max(1, Math.floor(d / 8));
    const bx = rint(ballX);
    const by = rint(ballY);
    return [new Rect(Math.max(0, bx - half), Math.max(0, by - half), Math.min(frameW, bx + half + 1), Math.min(frameH, by + half + 1)), step];
  },

  /** First frame of the track: PRE_S before the hands' still run. */
  start(runStart, fps) {
    return Math.max(0, runStart - rint(ClubheadTrack.PRE_S * fps));
  },

  /** The detector frames for the resting head: SAMPLES evenly over [lo, leadArm). */
  samples(lo, leadArm) {
    const { SAMPLES } = ClubheadTrack;
    const out = [];
    for (let i = 0; i < SAMPLES; i += 1) out.push(lo + Math.floor((i * (leadArm - lo)) / SAMPLES + 0.5));
    return [...new Set(out)].sort((a, b) => a - b);
  },

  /**
   * The earliest sample whose head (`heads`: Map frame → [x, y, score] | null, frame px) scores
   * ≥ HEAD_MIN within HEAD_CM of the ball: [frame, x, y], else null.
   */
  restingHead(heads, ballX, ballY, pxPerCm) {
    for (const f of [...heads.keys()].sort((a, b) => a - b)) {
      const h = heads.get(f);
      if (h == null) continue;
      if (h[2] >= ClubheadTrack.HEAD_MIN && Math.hypot(h[0] - ballX, h[1] - ballY) / pxPerCm <= ClubheadTrack.HEAD_CM) return [f, h[0], h[1]];
    }
    return null;
  },

  /** Where the head rests without a detector: ½ diameter towards the golfer, 0.8 below the ball (toward the camera). [x, y]. */
  fallbackHead(ballX, ballY, handsX, pxPerCm) {
    const d = Ball.BALL_CM * pxPerCm;
    const sgn = ballX >= handsX ? 1 : -1;
    return [ballX - 0.5 * sgn * d, ballY + 0.8 * d];
  },

  /**
   * Per frame of `strips` (Map frame → Gray): the head relative to where it is at `ref` (cm), the
   * masked NCC and whether the best offset lies on the search border. `origin` = the strip rect's
   * top-left [x, y] and `step` its sampling, frame px; `headX`, `headY`, `ballX`, `ballY` frame px.
   * Empty when the template and its search do not fit in the strip.
   */
  track(strips, origin, step, ref, headX, headY, ballX, ballY, pxPerCm) {
    const C = ClubheadTrack;
    const pps = pxPerCm / step;
    const d = Ball.BALL_CM * pps;
    const x = rint((headX - origin[0]) / step);
    const y = rint((headY - origin[1]) / step);
    const tw = Math.max(2, rint((C.TPL_W_CM / 2) * pps));
    const th = Math.max(2, rint((C.TPL_H_CM / 2) * pps));
    const s = Math.max(2, rint(C.SEARCH_D * d));
    const g = strips.get(ref);
    if (g == null) return new Map();
    if (y - th - s < 0 || x - tw - s < 0 || y + th + s >= g.h || x + tw + s >= g.w) return new Map();
    const nw = 2 * tw + 1;
    const nh = 2 * th + 1;
    const bx = (ballX - origin[0]) / step;
    const by = (ballY - origin[1]) / step;
    const maskR2 = (C.BALL_MASK_D * d) * (C.BALL_MASK_D * d);
    // template pixels outside the ball's disc, as offsets into the window
    const idx = [];
    for (let j = 0; j < nh; j += 1) {
      for (let i = 0; i < nw; i += 1) {
        const px = x - tw + i;
        const py = y - th + j;
        if ((px - bx) * (px - bx) + (py - by) * (py - by) > maskR2) idx.push(j * nw + i);
      }
    }
    if (idx.length < 4) return new Map();
    const tpl = Float64Array.from(idx, (o) => g.at(x - tw + (o % nw), y - th + Math.trunc(o / nw)));
    const out = new Map();
    const n = 2 * s + 1;
    const r = new Float64Array(n * n);
    for (const f of [...strips.keys()].sort((a, b) => a - b)) {
      const w = strips.get(f);
      if (w.w !== g.w || w.h !== g.h) continue;
      ClubheadTrack.maskedNcc(w, x - tw - s, y - th - s, nw, idx, tpl, n, r);
      let best = 0;
      for (let k = 0; k < r.length; k += 1) if (r[k] > r[best]) best = k;
      const mx = best % n;
      const my = Math.trunc(best / n);
      const v = r[best];
      const ox = mx >= 1 && mx < n - 1 ? ClubheadTrack.parabola(r[best - 1], r[best + 1], v) : 0;
      const oy = my >= 1 && my < n - 1 ? ClubheadTrack.parabola(r[best - n], r[best + n], v) : 0;
      const edge = mx === 0 || my === 0 || mx === n - 1 || my === n - 1;
      out.set(f, headPos((mx + ox - s) / pps, (my + oy - s) / pps, v, edge));
    }
    return out;
  },

  /**
   * Zero-mean NCC of the template (values `tpl` at window offsets `idx`, window row width `nw`)
   * at each of the `n` × `n` offsets of `g` from (`x0`, `y0`), row-major into `out`; −1 where
   * either side is flat (detect.py masked_ncc).
   */
  maskedNcc(g, x0, y0, nw, idx, tpl, n, out) {
    let tm = 0;
    for (const v of tpl) tm += v;
    tm /= tpl.length;
    let tn = 0;
    for (const v of tpl) tn += (v - tm) * (v - tm);
    tn = Math.sqrt(tn);
    const q = new Float64Array(idx.length);
    for (let dy = 0; dy < n; dy += 1) {
      for (let dx = 0; dx < n; dx += 1) {
        let sum = 0;
        for (let k = 0; k < idx.length; k += 1) {
          q[k] = g.at(x0 + dx + (idx[k] % nw), y0 + dy + Math.trunc(idx[k] / nw));
          sum += q[k];
        }
        const qm = sum / idx.length;
        let qn = 0;
        let dot = 0;
        for (let k = 0; k < idx.length; k += 1) {
          const a = q[k] - qm;
          qn += a * a;
          dot += a * (tpl[k] - tm);
        }
        qn = Math.sqrt(qn);
        out[dy * n + dx] = qn > 0 && tn > 0 ? dot / (qn * tn) : -1;
      }
    }
  },

  /** Sub-sample offset of a peak from its neighbours (a parabola through three samples). */
  parabola(a, b, c) {
    const d = a - 2 * c + b;
    return d >= 0 ? 0 : (0.5 * (a - b)) / d;
  },

  /**
   * The address from a track (detect.py `address_from_track`). speed(f) = displacement over
   * LAG_S, cm/s. The head has gone at the first frame after `ref` where tracking is lost
   * (score < LOST_NCC or on the search border) or the speed passes FAST × MOVING_CMS, else
   * `leadArm`. Walking back from there through the moving frames (> MOVING_CMS), the address is
   * the end of the first stretch of HOLD_S not-moving frames (a pause inside the takeaway is
   * shorter). Reaching the first tracked frame: that frame when the track starts at the clip's
   * start (`clipStart`: the clip begins mid-creep), else null.
   */
  address(track, ref, leadArm, fps, clipStart) {
    const C = ClubheadTrack;
    const lag = Math.max(1, rint(C.LAG_S * fps));
    const hold = Math.max(2, rint(C.HOLD_S * fps));
    const speed = (f) => {
      const a = track.get(f);
      if (a == null) return null;
      const b = track.get(f - lag);
      if (b == null) return null;
      return Math.hypot(a.dx - b.dx, a.dy - b.dy) / (lag / fps);
    };
    let gone = leadArm;
    for (const f of [...track.keys()].sort((a, b) => a - b)) {
      if (f <= ref) continue;
      const p = track.get(f);
      const v = speed(f);
      if (p.score < C.LOST_NCC || p.edge || (v != null && v > C.FAST * C.MOVING_CMS)) {
        gone = f;
        break;
      }
    }
    const moving = new Map();
    for (const f of track.keys()) {
      if (f >= gone) continue;
      const v = speed(f);
      if (v == null) continue;
      moving.set(f, v > C.MOVING_CMS);
    }
    if (moving.size === 0) return null;
    const first = Math.min(...moving.keys());
    let f = gone - 1;
    for (;;) {
      while (f >= first && moving.get(f) !== false) f -= 1;
      if (f - hold < first) return clipStart ? first : null;
      let still = true;
      for (let i = f - hold; i <= f; i += 1) {
        if (moving.get(i) !== false) {
          still = false;
          break;
        }
      }
      if (still) return f;
      f -= 1;
    }
  },
};
