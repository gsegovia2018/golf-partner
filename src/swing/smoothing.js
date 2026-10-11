// Smoothing and sanity (plan 4.5), ported from tools/swing-lab/detect.py
// `--variant d15` (OneEuro, gated_hands, smooth_zero_lag, series_d15).
//
// Offline and zero-lag: every coordinate runs through the One-Euro filter forwards
// and backwards in time and the two outputs are averaged, in pixels and in
// captured time, over irregularly sampled frames. Hands are a grip estimate
// (wrist + k * (wrist - elbow)), not the wrist midpoint (D17).

import { LM } from './geometry';

export const EURO_HANDS = { minCutoff: 1.5, beta: 0.05, dCutoff: 1.0 };
export const EURO_BODY = { minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 };
// Anatomy, not a fit: hand ~ 0.74 x forearm, the shaft crosses the palm at ~half of it.
export const GRIP_K = 0.35;
// A signal is "moving" when it leaves 3 x its measured noise.
export const NOISE_MULT = 3;

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

/** One-Euro filter for irregular sampling (t in seconds, x = [x, y] in px). */
export class OneEuro {
  constructor({ minCutoff, beta, dCutoff }) {
    this.mc = minCutoff;
    this.beta = beta;
    this.dc = dCutoff;
    this.x = null;
    this.dx = null;
    this.t = null;
  }

  filter(t, x) {
    if (this.x === null) {
      this.x = x.slice();
      this.dx = x.map(() => 0);
      this.t = t;
      return this.x.slice();
    }
    const dt = Math.max(t - this.t, 1e-6);
    const ad = alpha(this.dc, dt);
    this.dx = this.dx.map((d, c) => d + ad * ((x[c] - this.x[c]) / dt - d));
    this.x = this.x.map((p, c) => p + alpha(this.mc + this.beta * Math.abs(this.dx[c]), dt) * (x[c] - p));
    this.t = t;
    return this.x.slice();
  }
}

export function smoothSeries(t, xy, params) {
  const f = new OneEuro(params);
  return xy.map((p, k) => f.filter(t[k], p));
}

/** Forwards and backwards in time, averaged: no phase lag. */
export function smoothZeroLag(t, xy, params) {
  const fwd = smoothSeries(t, xy, params);
  const bwd = smoothSeries(t.map((v) => -v).reverse(), xy.slice().reverse(), params).reverse();
  return fwd.map((p, k) => p.map((v, c) => (v + bwd[k][c]) / 2));
}

export function median(values) {
  const a = values.filter((v) => !Number.isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** numpy-style percentile (linear interpolation), NaNs ignored. */
export function percentile(values, q) {
  const a = values.filter((v) => !Number.isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = ((a.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, a.length - 1);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** 1.4826 x median absolute deviation: sigma for Gaussian jitter, ignores outliers. */
export function robustSigma(values) {
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

/** Grip estimate of one arm: wrist + k (wrist - elbow), in image space. */
export const gripPoint = (wrist, elbow, k = GRIP_K) => [
  wrist[0] + k * (wrist[0] - elbow[0]),
  wrist[1] + k * (wrist[1] - elbow[1]),
];

/**
 * Hands after the wrist gate. A wrist is rejected when its visibility < 0.5 and it
 * either jumped more than 1.5 x forearm length since the last accepted sample or
 * (`fixed`) the other wrist is visible; down the line the lead wrist is hidden much
 * of the time and MediaPipe then returns a stable but wrong guess. Rejected arms
 * are dropped from the midpoint; frames with neither arm are interpolated.
 * `pts` (per frame, per side [left, right], [x, y]) replaces the wrists as the
 * points combined, e.g. the grip estimates; the gate still judges the wrists.
 */
export function gatedHands(idx, L, { fixed = false, pts = null } = {}) {
  const n = idx.length;
  const P = pts || L.map((lm) => [lm[LM.lWr].slice(0, 2), lm[LM.rWr].slice(0, 2)]);
  const ok = L.map(() => [true, true]);
  [[LM.lWr, LM.lEl, LM.rWr], [LM.rWr, LM.rEl, LM.lWr]].forEach(([wr, el, otherWr], side) => {
    const fore = median(L.map((lm) => Math.hypot(lm[wr][0] - lm[el][0], lm[wr][1] - lm[el][1])));
    let last = L[0][wr];
    for (let k = 0; k < n; k++) {
      const jump = Math.hypot(L[k][wr][0] - last[0], L[k][wr][1] - last[1]);
      if (L[k][wr][2] < 0.5 && (jump > 1.5 * fore || (fixed && L[k][otherWr][2] >= 0.5))) {
        ok[k][side] = false;
      } else {
        last = L[k][wr];
      }
    }
  });
  const hands = L.map((_, k) => {
    const [l, r] = ok[k];
    if (l && r) return [(P[k][0][0] + P[k][1][0]) / 2, (P[k][0][1] + P[k][1][1]) / 2];
    if (l) return P[k][0].slice();
    if (r) return P[k][1].slice();
    return null;
  });
  const good = hands.map((h, k) => (h ? k : -1)).filter((k) => k >= 0);
  if (!good.length) return L.map((_, k) => P[k][0].slice());
  return hands.map((h, k) => h || [0, 1].map((c) => interp(idx[k], good.map((g) => idx[g]), good.map((g) => hands[g][c]))));
}

/** Linear interpolation of ys(xs) at x, clamped at the ends (xs ascending). */
export function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

/**
 * Smoothed series of a clip in captured time for one slow-motion factor.
 *
 * @param {number[]} idx  sampled frame indices, ascending
 * @param {number[][][]} L  per sample, 33 x [x, y, vis] in pixels
 * @param {{containerFps:number, factor:number, handedness?:string, gripK?:number, bodyH:number}} o
 * @returns hands (= grip), speed (px/s), body landmarks, arm end points, armPx and the
 *   per-clip jitter of grip and head (sigmaGrip, sigmaHead).
 */
export function buildSeries(idx, L, { containerFps, factor, handedness = 'right', gripK = GRIP_K, bodyH }) {
  const effFps = containerFps * factor;
  const t = idx.map((i) => i / effFps);
  const right = handedness !== 'left';
  const [leadSh, leadWr] = right ? [LM.lSh, LM.lWr] : [LM.rSh, LM.rWr];
  const [trailSh, trailWr] = right ? [LM.rSh, LM.rWr] : [LM.lSh, LM.lWr];
  const trailHip = right ? LM.rHip : LM.lHip;

  const perSide = L.map((lm) => [gripPoint(lm[LM.lWr], lm[LM.lEl], gripK), gripPoint(lm[LM.rWr], lm[LM.rEl], gripK)]);
  const gripRaw = gatedHands(idx, L, { fixed: true, pts: perSide });
  const wrMid = gatedHands(idx, L, { fixed: true });
  const hands = smoothZeroLag(t, gripRaw, EURO_HANDS);
  const body = {};
  [leadSh, trailSh, trailHip, LM.nose].forEach((k) => {
    body[k] = smoothZeroLag(t, L.map((lm) => [lm[k][0], lm[k][1]]), EURO_BODY);
  });
  const armEnd = (wr) => smoothZeroLag(t, L.map((lm, k) => {
    const v = Math.min(1, Math.max(0, lm[wr][2]));
    return [v * lm[wr][0] + (1 - v) * wrMid[k][0], v * lm[wr][1] + (1 - v) * wrMid[k][1]];
  }), EURO_HANDS);
  const ends = { lead: armEnd(leadWr), trail: armEnd(trailWr) };
  // Unforeshortened arm length: the 95th percentile of the projected shoulder -> wrist
  // distance over the clip (at address the arms hang nearly in the image plane).
  const armPx = Math.max(...[['lead', leadSh], ['trail', trailSh]].map(([s, sh]) =>
    percentile(ends[s].map((p, k) => Math.hypot(p[0] - body[sh][k][0], p[1] - body[sh][k][1])), 95)));
  const speed = hands.map((p, k) => (k ? Math.hypot(p[0] - hands[k - 1][0], p[1] - hands[k - 1][1]) / (t[k] - t[k - 1]) : 0));
  return {
    idx, t, L, hands, speed, body, ends, effFps, armPx, bodyH,
    lead: [leadSh, leadWr], trail: [trailSh, trailWr], trailHip,
    sigmaGrip: robustSigma(gripRaw.flatMap((p, k) => [p[0] - hands[k][0], p[1] - hands[k][1]])),
    sigmaHead: robustSigma(L.flatMap((lm, k) => [lm[LM.nose][0] - body[LM.nose][k][0], lm[LM.nose][1] - body[LM.nose][k][1]])),
  };
}
