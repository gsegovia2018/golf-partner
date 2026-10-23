// Shared types of the web swing engine, ported from modules/golf-swing (Pose.kt, Ball.kt). Pure JS:
// the Kotlin unit tests are ported next to them in __tests__.

/** MediaPipe pose landmark indices (33-point topology). */
export const Lm = {
  COUNT: 33,
  NOSE: 0,
  L_SH: 11,
  R_SH: 12,
  L_EL: 13,
  R_EL: 14,
  L_WR: 15,
  R_WR: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANK: 27,
  R_ANK: 28,
  L_TOE: 31,
  R_TOE: 32,
};

/**
 * One pose sample in display pixels. `lm` packs x, y, visibility per landmark (33 × 3). `frame` is
 * the container frame index, `ptsUs` its presentation time.
 */
export class PoseSample {
  constructor(frame, ptsUs, lm) {
    this.frame = frame;
    this.ptsUs = ptsUs;
    this.lm = lm;
  }

  x(j) { return this.lm[3 * j]; }

  y(j) { return this.lm[3 * j + 1]; }

  vis(j) { return this.lm[3 * j + 2]; }

  /** Landmark bounding-box height: the lab's body height H (detect.py SamplingPolicy). */
  bodyHeight() {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < Lm.COUNT; j += 1) {
      const v = this.y(j);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  }
}

export const pt = (x, y) => ({ x, y });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A grey patch of the working image. `x0`, `y0` place it in working-image coordinates; `px` holds
 * 0–255 grey (a Uint8Array, row-major `w` × `h`), like the lab's cv2 grey.
 */
export class Gray {
  constructor(x0, y0, w, h, px) {
    this.x0 = x0;
    this.y0 = y0;
    this.w = w;
    this.h = h;
    this.px = px;
  }

  at(x, y) { return this.px[(y - this.y0) * this.w + (x - this.x0)]; }

  contains(x, y) { return x >= this.x0 && y >= this.y0 && x < this.x0 + this.w && y < this.y0 + this.h; }
}

/** Integer rectangle [x0, x1) × [y0, y1). */
export class Rect {
  constructor(x0, y0, x1, y1) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }

  get w() { return this.x1 - this.x0; }

  get h() { return this.y1 - this.y0; }

  isEmpty() { return this.w <= 0 || this.h <= 0; }

  equals(o) { return !!o && o.x0 === this.x0 && o.y0 === this.y0 && o.x1 === this.x1 && o.y1 === this.y1; }
}

export const Stats = {
  median(v) {
    if (!v.length) return NaN;
    const s = Float64Array.from(v).sort();
    const m = s.length >> 1;
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  },

  /** numpy.percentile with the default linear interpolation. */
  percentile(v, q) {
    if (!v.length) return NaN;
    const s = Float64Array.from(v).sort();
    const pos = (q / 100) * (s.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, s.length - 1);
    return s[lo] + (pos - lo) * (s[hi] - s[lo]);
  },

  /** 1.4826 × MAD: σ for Gaussian noise, robust to outliers (detect.py robust_sigma). */
  robustSigma(v) {
    const m = Stats.median(v);
    return 1.4826 * Stats.median(Array.from(v, (x) => Math.abs(x - m)));
  },

  /** Jitter σ of a slowly drifting point from consecutive differences (MAD of the steps / √2). */
  diffSigma(xs) {
    if (xs.length < 3) return NaN;
    const d = [];
    for (let i = 0; i + 1 < xs.length; i += 1) d.push(xs[i + 1] - xs[i]);
    return Stats.robustSigma(d) / Math.SQRT2;
  },
};

/** Hands = grip estimate (plan §4.5, D17). */
export const Grip = {
  /** Grip point per arm = wrist + k·(wrist − elbow). Anatomy prior, not a fit (§4.5). */
  K: 0.35,
  VIS_MIN: 0.5,

  arm(s, wr, el, k = Grip.K) {
    return pt(s.x(wr) + k * (s.x(wr) - s.x(el)), s.y(wr) + k * (s.y(wr) - s.y(el)));
  },

  /**
   * Single-sample grip with the visibility half of the §4.5 wrist gate: a wrist with visibility
   * < 0.5 is dropped (with its arm's grip point) when the other is visible; both hidden → both kept.
   */
  point(s, k = Grip.K) {
    const l = Grip.arm(s, Lm.L_WR, Lm.L_EL, k);
    const r = Grip.arm(s, Lm.R_WR, Lm.R_EL, k);
    const lv = s.vis(Lm.L_WR) >= Grip.VIS_MIN;
    const rv = s.vis(Lm.R_WR) >= Grip.VIS_MIN;
    if (lv && !rv) return l;
    if (rv && !lv) return r;
    return pt((l.x + r.x) / 2, (l.y + r.y) / 2);
  },

  /**
   * Port of detect.py `gated_hands(idx, L, fixed=True, pts)`: per-side points are rejected when
   * the wrist's visibility is < 0.5 AND (it jumped > 1.5 × that forearm's median length since the
   * last accepted sample, OR the other wrist is visible). Accepted sides are averaged; samples with
   * no accepted side are linearly interpolated in frame index. `k` = null combines the wrists
   * themselves (the lab's wrist midpoint).
   */
  gatedSeries(samples, k = Grip.K) {
    const n = samples.length;
    const ok = Array.from({ length: n }, () => [true, true]);
    const sides = [[Lm.L_WR, Lm.L_EL], [Lm.R_WR, Lm.R_EL]];
    sides.forEach(([wr, el], side) => {
      const other = wr === Lm.L_WR ? Lm.R_WR : Lm.L_WR;
      const fore = Stats.median(samples.map((s) => Math.hypot(s.x(wr) - s.x(el), s.y(wr) - s.y(el))));
      let lastX = n > 0 ? samples[0].x(wr) : 0;
      let lastY = n > 0 ? samples[0].y(wr) : 0;
      for (let i = 0; i < n; i += 1) {
        const s = samples[i];
        const jump = Math.hypot(s.x(wr) - lastX, s.y(wr) - lastY);
        if (s.vis(wr) < Grip.VIS_MIN && (jump > 1.5 * fore || s.vis(other) >= Grip.VIS_MIN)) {
          ok[i][side] = false;
        } else {
          lastX = s.x(wr);
          lastY = s.y(wr);
        }
      }
    });
    const at = (s, side) => {
      const [wr, el] = sides[side];
      return k == null ? pt(s.x(wr), s.y(wr)) : Grip.arm(s, wr, el, k);
    };
    const out = samples.map((s, i) => {
      if (ok[i][0] && ok[i][1]) {
        const a = at(s, 0);
        const b = at(s, 1);
        return pt((a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      if (ok[i][0]) return at(s, 0);
      if (ok[i][1]) return at(s, 1);
      return null;
    });
    return interpolateGaps(samples.map((s) => s.frame), out);
  },
};

function interpolateGaps(frames, pts) {
  const known = [];
  pts.forEach((p, i) => { if (p) known.push(i); });
  if (!known.length) return pts.map(() => pt(NaN, NaN));
  return pts.map((p, i) => {
    if (p) return p;
    const after = known.find((j) => j > i);
    let before;
    for (let j = known.length - 1; j >= 0; j -= 1) if (known[j] < i) { before = known[j]; break; }
    if (before == null) return pts[after];
    if (after == null) return pts[before];
    const t = (frames[i] - frames[before]) / (frames[after] - frames[before]);
    const a = pts[before];
    const b = pts[after];
    return pt(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
  });
}

/** Thrown into a running job by cancelAnalysis (the bridge rejects with ERR_CANCELLED). */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.code = 'ERR_CANCELLED';
  }
}

/** The clip can't be analysed in this browser (no decoder for it, no readable frames). */
export class UnsupportedVideoError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ERR_UNSUPPORTED_VIDEO';
  }
}
