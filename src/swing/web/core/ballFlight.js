// Ported from modules/golf-swing BallFlight.kt (face-on ball and clubhead speed, plan 2026-10-30
// §5; the lab reference is tools/swing-lab/ball_flight.py). Pure: no IO, no platform. Keep it in
// step with the Kotlin.

import { Gray, Rect, Stats } from './geom';

/** Java Math.rint: nearest integer, ties to even. */
const rint = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

const TAN_UP = Math.tan((40 * Math.PI) / 180);

export const BallFlight = {
  CORRIDOR_D: 35,
  UP_DEG: 40,
  DOWN_D: 1.5,
  FLIGHT_FRAMES: 10,
  DIFF_MIN: 22,
  AREA_MIN: 0.25,
  AREA_MAX: 6,
  MIN_CHAIN: 3,
  CLUB_FRAMES: 3,
  CLUB_BAND_UP_D: 4,
  CLUB_BAND_DOWN_D: 1,
  CLUB_BEHIND_D: 25,
  MOVE_MIN: 30,
  CLUB_MIN_AREA: 0.15,
  BG_HALF: 6,
  BG_EVERY: 2,
  BALL_SAMPLES: 8,
  ORIGIN_D: 1.5,
  MAX_BALL_MS: 94,
  LEAVE_FRAMES: 4,

  step(d) { return Math.max(1, Math.floor(d / BallFlight.BALL_SAMPLES)); },

  bgFrames(top, n) {
    const out = [];
    for (let f = top - BallFlight.BG_HALF; f <= top + BallFlight.BG_HALF; f += BallFlight.BG_EVERY) if (f >= 0 && f < n) out.push(f);
    return out;
  },

  /** The club frames and the one before the first, for a contact up to LEAVE_FRAMES either side of `impact`. */
  clubFrames(impact, n) {
    const out = [];
    for (let f = impact - BallFlight.CLUB_FRAMES - 1 - BallFlight.LEAVE_FRAMES; f < impact + BallFlight.LEAVE_FRAMES; f += 1) if (f >= 0 && f < n) out.push(f);
    return out;
  },

  /** From LEAVE_FRAMES before `impact` (an early contact) to FLIGHT_FRAMES after it. */
  flightFrames(impact, n) {
    const out = [];
    for (let f = impact + 1 - BallFlight.LEAVE_FRAMES; f <= impact + BallFlight.FLIGHT_FRAMES; f += 1) if (f >= 0 && f < n) out.push(f);
    return out;
  },

  /** The frame-px rectangle the corridor and the club band read. */
  area(bx, by, d, sgn, w, h) {
    const ahead = bx + sgn * BallFlight.CORRIDOR_D * d;
    const behind = bx - sgn * BallFlight.CLUB_BEHIND_D * d;
    return new Rect(
      Math.max(0, Math.floor(Math.min(ahead, behind))),
      Math.max(0, Math.floor(by - TAN_UP * BallFlight.CORRIDOR_D * d)),
      Math.min(w, Math.ceil(Math.max(ahead, behind)) + 1),
      Math.min(h, Math.ceil(by + Math.max(BallFlight.DOWN_D, BallFlight.CLUB_BAND_DOWN_D) * d) + 1),
    );
  },

  /** The full-resolution patch `diameter` reads: ±2 d around the ball, clipped to the frame. */
  patch(bx, by, d, w, h) {
    const k = Math.max(2, rint(2 * d));
    const x = rint(bx);
    const y = rint(by);
    return new Rect(Math.max(0, x - k), Math.max(0, y - k), Math.min(w, x + k + 1), Math.min(h, y + k + 1));
  },

  /** Per-pixel median of grids of one geometry (the mean of the middle two, rounded half up). */
  median(frames) {
    const g0 = frames[0];
    const n = g0.w * g0.h;
    const out = new Uint8Array(n);
    const col = new Int32Array(frames.length);
    for (let p = 0; p < n; p += 1) {
      for (let k = 0; k < frames.length; k += 1) col[k] = frames[k].px[p];
      col.sort();
      const m = col.length >> 1;
      out[p] = col.length % 2 === 1 ? col[m] : (col[m - 1] + col[m] + 1) >> 1;
    }
    return new Gray(g0.x0, g0.y0, g0.w, g0.h, out);
  },

  /**
   * The ball's own diameter on the static background patch `bg` (frame px); see BallFlight.kt.
   * [centre x, centre y, diameter] frame px, or null.
   */
  diameter(bg, bx, by, d) {
    const gx = rint(bx);
    const gy = rint(by);
    const dd = rint(d);
    if (!bg.contains(gx - dd, gy - dd) || !bg.contains(gx + dd, gy + dd)) return null;
    const x1 = bg.x0 + bg.w - 1;
    const y1 = bg.y0 + bg.h - 1;
    const at = (x, y) => bg.at(Math.min(Math.max(x, bg.x0), x1), Math.min(Math.max(y, bg.y0), y1));
    const r = Math.max(1, rint(0.5 * d));
    let best = -1;
    let cx = gx;
    let cy = gy;
    for (let y = Math.max(bg.y0, gy - r); y <= Math.min(y1, gy + r); y += 1) {
      for (let x = Math.max(bg.x0, gx - r); x <= Math.min(x1, gx + r); x += 1) {
        let s = 0;
        for (let b = -1; b <= 1; b += 1) for (let a = -1; a <= 1; a += 1) s += at(x + a, y + b);
        if (s > best) {
          best = s;
          cx = x;
          cy = y;
        }
      }
    }
    let top = 0;
    for (let y = Math.max(bg.y0, cy - r); y <= Math.min(y1, cy + r); y += 1) {
      for (let x = Math.max(bg.x0, cx - r); x <= Math.min(x1, cx + r); x += 1) top = Math.max(top, bg.at(x, y));
    }
    const lvl = (top + Stats.median(Float32Array.from(bg.px))) / 2;
    if (bg.at(cx, cy) < lvl) return null;
    const k = rint(1.2 * d);
    const bx0 = Math.max(bg.x0, cx - k);
    const by0 = Math.max(bg.y0, cy - k);
    const bx1 = Math.min(x1, cx + k);
    const by1 = Math.min(y1, cy + k);
    const bw = bx1 - bx0 + 1;
    const seen = new Uint8Array(bw * (by1 - by0 + 1));
    const stack = [(cy - by0) * bw + (cx - bx0)];
    seen[stack[0]] = 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    const lo = [Infinity, Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
    while (stack.length) {
      const p = stack.pop();
      const x = bx0 + (p % bw);
      const y = by0 + Math.trunc(p / bw);
      n += 1;
      sx += x;
      sy += y;
      const proj = [x, y, x + y, x - y];
      for (let i = 0; i < 4; i += 1) {
        lo[i] = Math.min(lo[i], proj[i]);
        hi[i] = Math.max(hi[i], proj[i]);
      }
      for (let b = -1; b <= 1; b += 1) {
        for (let a = -1; a <= 1; a += 1) {
          const qx = x + a;
          const qy = y + b;
          if (qx < bx0 || qy < by0 || qx > bx1 || qy > by1) continue;
          const q = (qy - by0) * bw + (qx - bx0);
          if (!seen[q] && bg.at(qx, qy) >= lvl) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    let ext = 0;
    for (let i = 0; i < 4; i += 1) ext = Math.max(ext, (hi[i] - lo[i]) / (i < 2 ? 1 : Math.SQRT2) + 1);
    return [sx / n, sy / n, ext];
  },

  /** 8-connected components of `mask` (`w` × `h`), in raster order of their first pixel, as sorted pixel indices. */
  components(mask, w, h) {
    const label = new Uint8Array(w * h);
    const out = [];
    const stack = new Int32Array(w * h);
    for (let start = 0; start < w * h; start += 1) {
      if (!mask[start] || label[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      label[start] = 1;
      const pix = [];
      while (sp > 0) {
        const p = stack[--sp];
        pix.push(p);
        const px = p % w;
        const py = Math.trunc(p / w);
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const qx = px + ox;
            const qy = py + oy;
            if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
            const q = qy * w + qx;
            if (mask[q] && !label[q]) {
              label[q] = 1;
              stack[sp++] = q;
            }
          }
        }
      }
      out.push(Int32Array.from(pix).sort());
    }
    return out;
  },

  /** Bright blobs in the corridor ahead of the ball; sample grids and units. */
  candidates(g, bg, bx, by, d, sgn) {
    const x0 = Math.trunc(Math.max(0, Math.min(bx, bx + sgn * BallFlight.CORRIDOR_D * d)));
    const x1 = Math.trunc(Math.min(g.w, Math.max(bx, bx + sgn * BallFlight.CORRIDOR_D * d)));
    const y0 = Math.trunc(Math.max(0, by - TAN_UP * BallFlight.CORRIDOR_D * d));
    const y1 = Math.trunc(Math.min(g.h, by + BallFlight.DOWN_D * d));
    if (x1 <= x0 || y1 <= y0) return [];
    const w = x1 - x0;
    const h = y1 - y0;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      const x = x0 + (i % w);
      const y = y0 + Math.trunc(i / w);
      mask[i] = g.at(x, y) - bg.at(x, y) > BallFlight.DIFF_MIN ? 1 : 0;
    }
    const ballArea = (Math.PI * d * d) / 4;
    const out = [];
    for (const c of BallFlight.components(mask, w, h)) {
      if (c.length < BallFlight.AREA_MIN * ballArea || c.length > BallFlight.AREA_MAX * ballArea) continue;
      let sx = 0;
      let sy = 0;
      for (const p of c) {
        sx += p % w;
        sy += Math.trunc(p / w);
      }
      const cx = sx / c.length + x0;
      const cy = sy / c.length + y0;
      const ahead = (cx - bx) * sgn;
      if (ahead < 0.5 * d) continue;
      if (by - cy > TAN_UP * ahead + d) continue;
      out.push({ x: cx, y: cy, area: c.length });
    }
    return out;
  },

  /** Does the line through the run's first and last blob pass within ORIGIN_D of the ball at rest? */
  throughRest(run, bx, by, d) {
    const a = run[0][1];
    const b = run[run.length - 1][1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l === 0) return false;
    return Math.abs((b.x - a.x) * (by - a.y) - (b.y - a.y) * (bx - a.x)) / l <= BallFlight.ORIGIN_D * d;
  },

  /**
   * Of the runs of blobs through the ball at rest that fit a line, stay under `maxStep` and leave the
   * ball's spot near `impact`, the one that covers the most ground (see BallFlight.kt): [[frame, blob], …].
   */
  chain(cands, d, sgn, bx, by, maxStep = Infinity, impact = null) {
    const runs = [];
    const frames = [...cands.keys()].sort((a, b) => a - b);
    for (const f0 of frames) {
      for (const a of cands.get(f0)) {
        for (const b of cands.get(f0 + 1) ?? []) {
          let sx = b.x - a.x;
          let sy = b.y - a.y;
          if (sx * sgn < d) continue;
          if (-sy < -0.2 * Math.abs(sx) || -sy > TAN_UP * Math.abs(sx)) continue;
          const run = [[f0, a], [f0 + 1, b]];
          let f = f0 + 1;
          let p = b;
          while (cands.has(f + 1)) {
            const px = p.x + sx;
            const py = p.y + sy;
            const tol = 0.25 * Math.hypot(sx, sy) + d;
            let c = null;
            let cd = Infinity;
            for (const q of cands.get(f + 1)) {
              const e = Math.hypot(q.x - px, q.y - py);
              if (e <= tol && e < cd) {
                c = q;
                cd = e;
              }
            }
            if (!c) break;
            sx = (c.x - run[0][1].x) / (f + 1 - run[0][0]);
            sy = (c.y - run[0][1].y) / (f + 1 - run[0][0]);
            run.push([f + 1, c]);
            f += 1;
            p = c;
          }
          if (run.length >= BallFlight.MIN_CHAIN && BallFlight.throughRest(run, bx, by, d)) runs.push(run);
        }
      }
    }
    let best = [];
    let bestSpan = 0;
    for (const run of runs) {
      const r = BallFlight.fit(run, d);
      if (!r) continue;
      const v = Math.hypot(r.vx, r.vy);
      if (r.residual > 0.5 * d || v > maxStep) continue;
      if (impact != null) {
        // when the line is at the ball's spot, along its direction of travel
        const [f0, p0] = run[0];
        const t0 = f0 - ((p0.x - bx) * r.vx + (p0.y - by) * r.vy) / (v * v);
        if (Math.abs(t0 - (impact + 0.5)) > BallFlight.LEAVE_FRAMES) continue;
      }
      const last = run[run.length - 1][1];
      const span = Math.hypot(last.x - run[0][1].x, last.y - run[0][1].y);
      if (!best.length || span > bestSpan + 1e-9 || (Math.abs(span - bestSpan) <= 1e-9 && run.length > best.length)) {
        best = run;
        bestSpan = span;
      }
    }
    return best;
  },

  /** Slope and intercept of the least-squares line v(f). */
  line(f, v) {
    const mf = f.reduce((s, x) => s + x, 0) / f.length;
    const mv = v.reduce((s, x) => s + x, 0) / v.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < f.length; i += 1) {
      num += (f[i] - mf) * (v[i] - mv);
      den += (f[i] - mf) * (f[i] - mf);
    }
    const k = den === 0 ? 0 : num / den;
    return [k, mv - k * mf];
  },

  /** The line through `run`, dropping the worst point while it sits more than half a ball off it. */
  fit(run, d) {
    if (run.length < BallFlight.MIN_CHAIN) return null;
    const pts = [...run];
    for (;;) {
      const f = pts.map((q) => q[0]);
      const [vx, x0] = BallFlight.line(f, pts.map((q) => q[1].x));
      const [vy, y0] = BallFlight.line(f, pts.map((q) => q[1].y));
      let worst = 0;
      let res = -1;
      pts.forEach((q, i) => {
        const e = Math.hypot(q[1].x - (vx * f[i] + x0), q[1].y - (vy * f[i] + y0));
        if (e > res) {
          res = e;
          worst = i;
        }
      });
      if (res <= 0.5 * d || pts.length <= BallFlight.MIN_CHAIN) return { vx, vy, residual: res, kept: pts.length, chain: pts };
      pts.splice(worst, 1);
    }
  },

  /** The leading point of the largest moving, brighter-than-background blob in the band behind the ball. */
  clubEdge(g, prev, bg, bx, by, d, sgn) {
    const x0 = Math.trunc(Math.max(0, Math.min(bx + sgn * d, bx - sgn * BallFlight.CLUB_BEHIND_D * d)));
    const x1 = Math.trunc(Math.min(g.w, Math.max(bx + sgn * d, bx - sgn * BallFlight.CLUB_BEHIND_D * d)));
    const y0 = Math.trunc(Math.max(0, by - BallFlight.CLUB_BAND_UP_D * d));
    const y1 = Math.trunc(Math.min(g.h, by + BallFlight.CLUB_BAND_DOWN_D * d));
    if (x1 <= x0 || y1 <= y0) return null;
    const w = x1 - x0;
    const h = y1 - y0;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      const x = x0 + (i % w);
      const y = y0 + Math.trunc(i / w);
      mask[i] = Math.abs(g.at(x, y) - prev.at(x, y)) > BallFlight.MOVE_MIN && g.at(x, y) - bg.at(x, y) > BallFlight.DIFF_MIN ? 1 : 0;
    }
    let big = null;
    for (const c of BallFlight.components(mask, w, h)) if (!big || c.length > big.length) big = c;
    if (!big || big.length < (BallFlight.CLUB_MIN_AREA * Math.PI * d * d) / 4) return null;
    let lead = big[0];
    for (const p of big) if ((p % w) * sgn > (lead % w) * sgn) lead = p;
    return [(lead % w) + x0, Math.trunc(lead / w) + y0];
  },

  /** The impact the flight says (BallFlight.kt contact): within LEAVE_FRAMES of `impact`, `impact` without a flight. */
  contact(fit, bx, by, impact) {
    if (!fit) return impact;
    const f = fit.chain.map((q) => q[0]);
    const x0 = BallFlight.line(f, fit.chain.map((q) => q[1].x))[1];
    const y0 = BallFlight.line(f, fit.chain.map((q) => q[1].y))[1];
    const t0 = ((bx - x0) * fit.vx + (by - y0) * fit.vy) / (fit.vx * fit.vx + fit.vy * fit.vy);
    return Math.min(Math.max(rint(t0), impact - BallFlight.LEAVE_FRAMES), impact + BallFlight.LEAVE_FRAMES);
  },

  /** [clubhead px per captured frame (sample units) or null, points used]. */
  club(frames, bg, impact, bx, by, d, sgn) {
    const pts = [];
    for (let f = impact - BallFlight.CLUB_FRAMES; f < impact; f += 1) {
      const g = frames.get(f);
      const prev = frames.get(f - 1);
      if (!g || !prev) continue;
      const e = BallFlight.clubEdge(g, prev, bg, bx, by, d, sgn);
      if (e) pts.push([f, e[0], e[1]]);
    }
    if (pts.length < 2) return [null, pts.length];
    const f = pts.map((p) => p[0]);
    const vx = BallFlight.line(f, pts.map((p) => p[1]))[0];
    const vy = BallFlight.line(f, pts.map((p) => p[2]))[0];
    return [vx * sgn > 0 ? Math.hypot(vx, vy) : null, pts.length];
  },

  /** Everything from the decoded grids (see BallFlight.kt measure); frame px in and out, or null. */
  measure(bgArea, bgPatch, frames, rect, step, bx, by, d, sgn, impact, fps) {
    if (!bgArea.length || !bgPatch.length) return null;
    const m = BallFlight.diameter(BallFlight.median(bgPatch), bx, by, d);
    if (!m) return null;
    const [x, y, dd] = m;
    const bg = BallFlight.median(bgArea);
    const sx = (x - rect.x0) / step;
    const sy = (y - rect.y0) / step;
    const sd = dd / step;
    const cands = new Map();
    for (let f = impact + 1 - BallFlight.LEAVE_FRAMES; f <= impact + BallFlight.FLIGHT_FRAMES; f += 1) {
      const g = frames.get(f);
      if (g) cands.set(f, BallFlight.candidates(g, bg, sx, sy, sd, sgn));
    }
    const maxStep = (BallFlight.MAX_BALL_MS * 100 * (dd / 4.27)) / fps / step;
    const r = BallFlight.fit(BallFlight.chain(cands, sd, sgn, sx, sy, maxStep, impact), sd);
    const at = BallFlight.contact(r, sx, sy, impact);
    const ball = r ? {
      vx: r.vx * step,
      vy: r.vy * step,
      residual: r.residual * step,
      kept: r.kept,
      chain: r.chain.map(([f, b]) => [f, { x: rect.x0 + b.x * step, y: rect.y0 + b.y * step, area: b.area }]),
    } : null;
    const [club, n] = BallFlight.club(frames, bg, at, sx, sy, sd, sgn);
    return {
      x, y, d: dd, step, ball, club: club != null ? club * step : null, clubPoints: n, contact: at,
    };
  },
};
