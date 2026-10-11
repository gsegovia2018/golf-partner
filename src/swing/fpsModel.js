// Frame rate and slow-motion factor (plan 4.4), ported from detect.py
// (`provisional_factor`, `factor_from_downswing`, the fake slow-mo rule).
//
// Frames in a clip are always capture frames: a slow-mo clip is a 240 fps capture
// played back at 30 fps, so `factor` = captureFps / containerFps and captured time
// is frame index / (containerFps x factor).

import { gatedHands, median } from './smoothing';

export const SLOWMO_FACTORS = [1, 2, 4, 8];
export const DOWNSWING_S = 0.27; // top -> impact of a real swing: 0.22-0.32 s
export const DUPLICATE_RATIO_FAKE = 0.4; // above this the clip was frame-doubled
export const APPROX_FPS = 100; // below this impact checks are approximate

/** The factor in {1, 2, 4, 8} that brings a downswing of `frames` closest to 0.27 s. */
export function factorFromDownswing(frames, containerFps) {
  return SLOWMO_FACTORS.reduce((best, c) =>
    (Math.abs(frames / containerFps / c - DOWNSWING_S) < Math.abs(frames / containerFps / best - DOWNSWING_S) ? c : best));
}

/** All descending runs [start, end] of y (image y grows downwards); up-moves smaller than `tol` do not end a run. */
export function descents(y, tol) {
  const out = [];
  let start = 0;
  let kMax = 0;
  for (let k = 1; k < y.length; k++) {
    if (y[k] > y[kMax]) kMax = k;
    if (y[k] < y[kMax] - tol || k === y.length - 1) {
      if (kMax > start) out.push([start, kMax]);
      start = k;
      kMax = k;
    }
  }
  return out;
}

/** [start, end] of the descent with the largest total drop (scale-free: no time involved). */
export function largestDescent(y, tol) {
  let best = [0, 0];
  let bestDrop = 0;
  let start = 0;
  let kMax = 0;
  for (let k = 1; k < y.length; k++) {
    if (y[k] > y[kMax]) kMax = k;
    if (y[k] < y[kMax] - tol || k === y.length - 1) {
      const drop = y[kMax] - y[start];
      if (drop > bestDrop) {
        best = [start, kMax];
        bestDrop = drop;
      }
      start = k;
      kMax = k;
    }
  }
  return best;
}

/**
 * Scale-free first guess of the factor, before any phase exists: the largest sustained
 * descent of the gated wrist midpoint (a 5-sample median) is the downswing, and its length
 * picks the factor. The real phase run then re-checks it from its own top -> impact.
 */
export function provisionalFactor(idx, L, bodyH, containerFps) {
  const y = gatedHands(idx, L).map((p) => p[1]);
  const smooth = y.map((_, k) => median([-2, -1, 0, 1, 2].map((d) => y[Math.min(y.length - 1, Math.max(0, k + d))])));
  const [a, b] = largestDescent(smooth, 0.02 * bodyH);
  return factorFromDownswing(idx[b] - idx[a], containerFps);
}

/**
 * The fps block of the analysis (plan 7.2).
 * @param {{containerFps:number, captureFps?:number|null, duplicateFrameRatio?:number}} probe
 * @param {number} factor
 * @param {'metadata'|'estimate'} source
 */
export function fpsInfo(probe, factor, source) {
  const interpolated = (probe.duplicateFrameRatio || 0) > DUPLICATE_RATIO_FAKE;
  const capture = (probe.containerFps * factor) / (interpolated ? 2 : 1);
  return {
    container: probe.containerFps,
    capture,
    factor,
    source,
    interpolated,
    effective: capture,
    approximate: interpolated || capture < APPROX_FPS,
  };
}
