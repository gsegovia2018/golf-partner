// Ported from modules/golf-swing Ball.kt and BallWindow.kt. Pure: no IO, no platform.

import {
  Grip, Lm, Rect, Stats, pt,
} from './geom';

/** Java Math.rint: nearest integer, ties to even. */
const rint = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

const medianOf = (v) => {
  const s = Float64Array.from(v).sort();
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The best blob of one frame inside `r` (see Ball.detect): `{ dist, cx, cy, circ, contrast }` or
 * null.
 */
function bestBlob(g, r, hands, sgn, expArea) {
  const { w, h } = r;
  const v = new Int32Array(w * h);
  for (let i = 0; i < w * h; i += 1) v[i] = g.at(r.x0 + (i % w), r.y0 + Math.trunc(i / w));
  const thr = Ball.percentile98(v);
  const label = new Int32Array(w * h);
  let best = null;
  let next = 0;
  const stack = new Int32Array(w * h);
  const dx = (1 / Math.sqrt(2)) * sgn;
  const dy = 1 / Math.sqrt(2);
  for (let start = 0; start < w * h; start += 1) {
    if (v[start] < thr || label[start] !== 0) continue;
    next += 1;
    // 8-connected flood fill (cv2.connectedComponentsWithStats, connectivity=8)
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let sum = 0;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = Math.trunc(p / w);
      area += 1;
      sx += px;
      sy += py;
      sum += v[p];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const qx = px + ox;
          const qy = py + oy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (label[q] === 0 && v[q] >= thr) {
            label[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    if (area < 0.5 * expArea || area > 1.5 * expArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const rad = Math.max(bw, bh) / 2.0;
    const circ = area / (Math.PI * rad * rad);
    if (circ <= 0.7) continue;
    const cx = sx / area + r.x0;
    const cy = sy / area + r.y0;
    const relX = cx - hands.x;
    const relY = cy - hands.y;
    const along = Math.max(0.0, relX * dx + relY * dy);
    const d = Math.hypot(relX - along * dx, relY - along * dy);
    // contrast = mean inside − median of the bbox grown by 3 px (clipped like a numpy slice)
    const ax0 = Math.max(0, minX - 3);
    const ay0 = Math.max(0, minY - 3);
    const ax1 = Math.min(w, minX + bw + 3);
    const ay1 = Math.min(h, minY + bh + 3);
    const around = new Float64Array((ax1 - ax0) * (ay1 - ay0));
    let k = 0;
    for (let yy = ay0; yy < ay1; yy += 1) for (let xx = ax0; xx < ax1; xx += 1) around[k++] = v[yy * w + xx];
    const contrast = sum / area - Stats.median(around);
    if (best == null || d < best.dist) best = { dist: d, cx, cy, circ, contrast };
  }
  return best;
}

/** Ball blob + impact refinement (plan §4.3), ported from tools/swing-lab/detect.py (d15). */
export const Ball = {
  BALL_CM: 4.27,
  LEG_FRACTION: 0.49,
  DEFAULT_HEIGHT_CM: 176.0,

  /**
   * The lab's ROI (detect_ball): x from the lead-foot toe to hands x ± 0.3 W (towards the
   * ball side), y from ankle y − 0.1 H to ankle y + 0.05 H; display px in, work px out.
   */
  roi(toeX, ankleY, handsX, sgn, w, h, ws, workW, workH) {
    const a = toeX;
    const b = handsX + sgn * 0.3 * w;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return new Rect(
      Math.trunc(Math.max(0.0, lo * ws)),
      Math.trunc(Math.max(0.0, (ankleY - 0.1 * h) * ws)),
      Math.trunc(Math.min(workW, hi * ws)),
      Math.trunc(Math.min(workH, (ankleY + 0.05 * h) * ws)),
    );
  },

  /**
   * detect.py `detect_ball` on the search frames (club in the air, scene static, D17):
   * brightest-2 % components inside `roi`, area within ±50 % of the expected ball, fill of
   * the enclosing circle > 0.7, the one closest to the ray from the hands 45° down towards
   * the ball side. Median over the frames. `hands` and `roi` in work px; result (BallFound
   * `{ x, y, r, conf, frames }`) in display px, or null.
   */
  detect(frames, roi, hands, sgn, expDWork, ws) {
    const expArea = Math.PI * (expDWork / 2) * (expDWork / 2);
    const found = [];
    for (const g of frames) {
      const r = new Rect(
        Math.max(roi.x0, g.x0),
        Math.max(roi.y0, g.y0),
        Math.min(roi.x1, g.x0 + g.w),
        Math.min(roi.y1, g.y0 + g.h),
      );
      if (r.isEmpty()) continue;
      const best = bestBlob(g, r, hands, sgn, expArea);
      if (best) found.push(best);
    }
    if (!found.length) return null;
    const med = (sel) => Stats.median(found.map(sel));
    const circ = med((c) => c.circ);
    const contrast = med((c) => c.contrast);
    return {
      x: med((c) => c.cx) / ws,
      y: med((c) => c.cy) / ws,
      r: expDWork / ws / 2,
      conf: 0.5 * Math.min(1.0, circ) + 0.5 * Math.min(1.0, Math.max(0.0, contrast) / 60),
      frames: found.length,
    };
  },

  /** numpy.percentile(v, 98), linear interpolation, on 0–255 integers via a histogram. */
  percentile98(v) {
    const hist = new Int32Array(256);
    for (const x of v) hist[x] += 1;
    const pos = 0.98 * (v.length - 1);
    const lo = Math.floor(pos);
    const kth = (k) => {
      let acc = 0;
      for (let b = 0; b < 256; b += 1) {
        acc += hist[b];
        if (acc > k) return b;
      }
      return 255;
    };
    const a = kth(lo);
    const b = kth(Math.min(lo + 1, v.length - 1));
    return a + (pos - lo) * (b - a);
  },

  // Impact (apiVersion 6, detect.py ball_gone_frame): the ball still sitting where it was, matched
  // against its own picture. The old rule (the first big frame difference in the ball's footprint
  // after the top) fired when the shaft swept over the ball, 2-7 frames early.
  /** Template half size, ball diameters (the ball and a ring of ground). */
  GONE_TPL_D: 0.7,
  /** The match may shift this much: the ball's spot, not its exact pixel. */
  GONE_SEARCH_D: 0.4,
  /** "Still there": NCC at least this ... */
  GONE_MATCH: 0.7,
  /** ... on a patch with at least this share of the template's contrast. */
  GONE_CONTRAST: 0.7,
  /** Gone = absent this long without coming back. */
  GONE_FOR_S: 0.1,

  /**
   * The first frame after `after` (the hands' top) from which the ball is absent for
   * GONE_FOR_S; impact = that − 1. `strips` is a Map frame → working Gray (same origin for all);
   * the ball at (`ballWorkX`, `ballWorkY`) with diameter `dWork`, work px; `fps` = capture rate.
   * `tplFrames` is an inclusive `[first, last]` range.
   *
   * Template = the per-pixel median over `tplFrames` (lead arm → top: the club is in the air, the
   * ball sits alone) of the UPPER half of a ±GONE_TPL_D patch around the re-centred ball, centre
   * row included (the club arrives from below, so the lower half is covered first). Present =
   * match ≥ GONE_MATCH within ±GONE_SEARCH_D. A brief absence (the hosel in front of the
   * ball) does not count, nor does a match that comes back. null when the patch leaves the strip
   * or the ball never goes.
   */
  goneFrame(strips, ballWorkX, ballWorkY, dWork, tplFrames, after, fps) {
    const fs = [];
    for (let f = tplFrames[0]; f <= tplFrames[1]; f += 1) if (strips.has(f)) fs.push(strips.get(f));
    if (!fs.length) return null;
    const r = Math.max(2, rint(Ball.GONE_TPL_D * dWork));
    const s = Math.max(1, rint(Ball.GONE_SEARCH_D * dWork));
    const h = Math.max(1, rint(dWork));
    const x = rint(ballWorkX);
    const y = rint(ballWorkY);
    const m = 2 * h + r + s + 2;
    if (!fs[0].contains(x - m, y - m) || !fs[0].contains(x + m, y + m)) return null;
    const n = 2 * m + 1;
    // per-pixel median of the static frames over the ±m square (numpy.median: mean of the middle two)
    const med = new Float64Array(n * n);
    const col = new Float64Array(fs.length);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        for (let k = 0; k < fs.length; k += 1) col[k] = fs[k].at(x - m + i, y - m + j);
        med[j * n + i] = medianOf(col);
      }
    }
    const [cx, cy] = Ball.recentre(med, n, m, m, dWork);
    const tw = 2 * r + 1;
    const th = r + 1;
    const tpl = new Float64Array(tw * th);
    for (let i = 0; i < tw * th; i += 1) tpl[i] = med[(cy - r + Math.trunc(i / tw)) * n + (cx - r + (i % tw))];
    const bx = x - m + cx;
    const by = y - m + cy;
    const need = Math.max(2, rint(Ball.GONE_FOR_S * fps));
    const later = [...strips.keys()].filter((f) => f > after).sort((a, b) => a - b);
    const present = new Map();
    const ww = tw + 2 * s;
    const wh = th + 2 * s;
    const win = new Float64Array(ww * wh);
    for (const f of later) {
      const g = strips.get(f);
      if (!g.contains(bx - r - s, by - r - s) || !g.contains(bx + r + s, by + s)) continue;
      for (let j = 0; j < wh; j += 1) {
        for (let i = 0; i < ww; i += 1) win[j * ww + i] = g.at(bx - r - s + i, by - r - s + j);
      }
      present.set(f, Ball.match(win, ww, wh, tpl, tw, th) >= Ball.GONE_MATCH);
    }
    for (const f of later) {
      let all = true;
      for (let k = 0; k < need; k += 1) if (present.get(f + k) !== false) { all = false; break; }
      if (all) return f;
    }
    return null;
  },

  /**
   * The ball's centre in a static grey image `med` (`n` × `n`): the brightest 3 × 3 sum within
   * ±d of (`x`, `y`), then the centroid of the pixels within ±0.7 d of it that are at least half
   * way from the ground (median of ±2 d) to that window's brightest pixel. Returns `[cx, cy]`.
   */
  recentre(med, n, x, y, d) {
    const h = Math.max(1, rint(d));
    const r = Math.max(1, rint(0.7 * d));
    let best = -1.0;
    let cx = x;
    let cy = y;
    for (let yy = y - h; yy <= y + h; yy += 1) {
      for (let xx = x - h; xx <= x + h; xx += 1) {
        let v = 0.0;
        for (let b = -1; b <= 1; b += 1) for (let a = -1; a <= 1; a += 1) v += med[(yy + b) * n + xx + a];
        if (v > best) {
          best = v;
          cx = xx;
          cy = yy;
        }
      }
    }
    let top = -Infinity;
    for (let yy = cy - r; yy <= cy + r; yy += 1) for (let xx = cx - r; xx <= cx + r; xx += 1) top = Math.max(top, med[yy * n + xx]);
    const ring = new Float64Array((4 * h + 1) * (4 * h + 1));
    let k = 0;
    for (let yy = y - 2 * h; yy <= y + 2 * h; yy += 1) for (let xx = x - 2 * h; xx <= x + 2 * h; xx += 1) ring[k++] = med[yy * n + xx];
    const lvl = (top + medianOf(ring)) / 2;
    let sx = 0.0;
    let sy = 0.0;
    let cnt = 0;
    for (let yy = cy - r; yy <= cy + r; yy += 1) {
      for (let xx = cx - r; xx <= cx + r; xx += 1) {
        if (med[yy * n + xx] >= lvl) {
          sx += xx;
          sy += yy;
          cnt += 1;
        }
      }
    }
    return [Math.floor(sx / cnt + 0.5), Math.floor(sy / cnt + 0.5)];
  },

  /**
   * The best zero-mean NCC of `tpl` (`tw` × `th`) over `win` (`ww` × `wh`) among the offsets whose
   * patch keeps ≥ GONE_CONTRAST of the template's contrast (an empty patch of grass can
   * correlate, it can't be as contrasted); −2 when no offset qualifies.
   */
  match(win, ww, wh, tpl, tw, th) {
    let tm = 0;
    for (const v of tpl) tm += v;
    tm /= tpl.length;
    let tn = 0.0;
    for (const v of tpl) tn += (v - tm) * (v - tm);
    tn = Math.sqrt(tn);
    let best = -2.0;
    if (tn === 0.0) return best;
    const np = tw * th;
    for (let dy = 0; dy <= wh - th; dy += 1) {
      for (let dx = 0; dx <= ww - tw; dx += 1) {
        let sum = 0.0;
        for (let j = 0; j < th; j += 1) for (let i = 0; i < tw; i += 1) sum += win[(dy + j) * ww + dx + i];
        const qm = sum / np;
        let qn = 0.0;
        let dot = 0.0;
        for (let j = 0; j < th; j += 1) {
          for (let i = 0; i < tw; i += 1) {
            const q = win[(dy + j) * ww + dx + i] - qm;
            qn += q * q;
            dot += q * (tpl[j * tw + i] - tm);
          }
        }
        qn = Math.sqrt(qn);
        if (qn === 0.0 || qn < Ball.GONE_CONTRAST * tn) continue;
        best = Math.max(best, dot / (qn * tn));
      }
    }
    return best;
  },

  /** pxPerCm from the camera-nearer (trail) leg at address (plan §4.6, detect.py leg_scale). */
  pxPerCm(still, rightHanded, heightCm) {
    const hip = rightHanded ? Lm.R_HIP : Lm.L_HIP;
    const knee = rightHanded ? Lm.R_KNEE : Lm.L_KNEE;
    const ank = rightHanded ? Lm.R_ANK : Lm.L_ANK;
    const legs = still.map((s) => Math.hypot(s.x(hip) - s.x(knee), s.y(hip) - s.y(knee))
      + Math.hypot(s.x(knee) - s.x(ank), s.y(knee) - s.y(ank)));
    return Stats.median(legs) / (Ball.LEG_FRACTION * heightCm);
  },
};

const LEVEL_TOL_DEG = 5.0;

const median5 = (p) => p.map((_, i) => {
  const lo = Math.max(0, i - 2);
  const hi = Math.min(p.length - 1, i + 2);
  const win = p.slice(lo, hi + 1);
  return pt(Stats.median(win.map((q) => q.x)), Stats.median(win.map((q) => q.y)));
});

/**
 * Where to look for the ball (plan §4.3, D17): after the club has left it — from the lead
 * arm reaching level in the backswing to the hands' highest point — the club is in the air
 * and the scene around the ball is static. Native never decides phases (§2.3); this is only
 * a conservative search window, so it uses the hands' highest point (the START of the top
 * plateau, never later than the JS `top`) and the d15 lead-arm rule on lightly filtered
 * series (5-sample median instead of the zero-lag One-Euro: the window only bounds a search).
 */
export const BallWindow = {
  /**
   * `samples` in frame order; the swing runs from `startFrame` to `endFrame` (the policy's
   * impact). Returns `{ leadArm, handsTop }` (frames) or null.
   */
  find(samples, startFrame, endFrame, rightHanded) {
    if (samples.length < 5) return null;
    const grip = median5(Grip.gatedSeries(samples, Grip.K));
    const mid = Grip.gatedSeries(samples, null);
    const leadSh = rightHanded ? Lm.L_SH : Lm.R_SH;
    const leadWr = rightHanded ? Lm.L_WR : Lm.R_WR;
    const trailSh = rightHanded ? Lm.R_SH : Lm.L_SH;
    const trailWr = rightHanded ? Lm.R_WR : Lm.L_WR;
    // arm end = the wrist blended with the gated wrist midpoint by its visibility (d15 arm_end)
    const end = (wr) => median5(samples.map((s, i) => {
      const v = Math.min(1, Math.max(0, s.vis(wr)));
      return pt(v * s.x(wr) + (1 - v) * mid[i].x, v * s.y(wr) + (1 - v) * mid[i].y);
    }));
    const joint = (j) => median5(samples.map((s) => pt(s.x(j), s.y(j))));
    const lead = end(leadWr);
    const trail = end(trailWr);
    const ls = joint(leadSh);
    const ts = joint(trailSh);
    const armPx = Math.max(
      Stats.percentile(lead.map((p, i) => Math.hypot(p.x - ls[i].x, p.y - ls[i].y)), 95),
      Stats.percentile(trail.map((p, i) => Math.hypot(p.x - ts[i].x, p.y - ts[i].y)), 95),
    );
    const band = armPx * Math.sin((LEVEL_TOL_DEG * Math.PI) / 180);

    const inSwing = [];
    samples.forEach((s, i) => { if (s.frame >= startFrame && s.frame <= endFrame) inSwing.push(i); });
    if (inSwing.length < 3) return null;
    // minByOrNull: the FIRST lowest y (Float.compareTo: NaN above everything)
    const below = (a, b) => !Number.isNaN(a) && (Number.isNaN(b) || a < b);
    let top = inSwing[0];
    for (const i of inSwing) if (below(grip[i].y, grip[top].y)) top = i;
    const lead0 = inSwing.find((i) => i <= top && lead[i].y - ls[i].y <= band);
    const leadArm = lead0 != null
      ? samples[lead0].frame
      : Math.trunc((samples[inSwing[0]].frame + samples[top].frame) / 2);
    const handsTop = samples[top].frame;
    return handsTop > leadArm ? { leadArm, handsTop } : null;
  },
};
