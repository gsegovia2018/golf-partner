// Phases (plan 5.1, D15, D17), ported from the swing lab reference
// `tools/swing-lab/detect.py --variant d15` (series_d15, detect_phases_d15, d15_rules,
// enforce_order and the ball / address refinements of main()).
//
// The rules are geometric, one per D15 definition, evaluated on the zero-lag smoothed
// series interpolated to every frame, so crossings land at frame resolution. Every
// threshold comes from the clip (grip jitter, "stopped" speed, body size, fps) or from
// anatomy; there are no timing fractions of the backswing or downswing.

import { LM } from './geometry';
import { buildSeries, interp, percentile, GRIP_K, NOISE_MULT } from './smoothing';
import {
  descents, largestDescent, factorFromDownswing, provisionalFactor, fpsInfo,
} from './fpsModel';

export const CHECKPOINT_KEYS = [
  'address', 'takeaway', 'leadArm', 'top', 'transition', 'shaftDown', 'impact', 'trailArm', 'finish',
];
export const LEVEL_TOL_DEG = 5; // "arm level": within 5 degrees of the shoulder's height
export const FINISH_HOLD_S = 0.15; // grip and head stopped this long
const BALL_GONE_SLACK_S = 0.02; // the pose impact's sampling slack
const PRE_IMPACT_S = 0.025; // preImpact = impact - 25 ms
const POST_IMPACT_FRAMES = 10;

// Python's round() is banker's rounding; the lab's window midpoints rely on it.
const pyRound = (x) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** Body height in px from the first pose: the landmark bounding box. */
export const bodyHeightPx = (lm) => {
  const ys = lm.map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys);
};

/** Speed averaged over the next w frames, px/s (NaN at the end): robust to a one-sample glitch that comes back. */
function netSpeed(P, w, fps) {
  return P.map((p, k) => (k + w < P.length ? Math.hypot(P[k + w][0] - p[0], P[k + w][1] - p[1]) / (w / fps) : NaN));
}

/** Per-clip "stopped" speed: 3 x the 25th percentile of the windowed speed over the clip. */
const stillThreshold = (v) => NOISE_MULT * percentile(v, 25);

/** The downswing: the fastest (mean speed) descent of the grip among descents of at least 0.2 H. */
function downswingAnchor(S) {
  const y = S.hands.map((p) => p[1]);
  const { t, bodyH } = S;
  const vy = y.map((v, k) => (k ? (v - y[k - 1]) / (t[k] - t[k - 1]) : 0));
  const runs = descents(y, 0.02 * bodyH).filter(([a, b]) => y[b] - y[a] >= 0.2 * bodyH);
  const pick = runs.length
    ? runs.reduce((best, r) => ((y[r[1]] - y[r[0]]) / (t[r[1]] - t[r[0]]) > (y[best[1]] - y[best[0]]) / (t[best[1]] - t[best[0]]) ? r : best))
    : largestDescent(y, 0.02 * bodyH);
  const [a, b] = pick;
  let kMax = a;
  for (let k = a; k <= b; k++) if (vy[k] > vy[kMax]) kMax = k;
  return [kMax, b];
}

/** First frame in [lo, hi] where cond(k) holds, else null. */
function firstFrame(F, cond, lo, hi) {
  for (let k = 0; k < F.length; k++) if (F[k] >= lo && F[k] <= hi && cond(k)) return F[k];
  return null;
}

/** The pose-only phases of one series (detect_phases_d15), before the ball and address refinements. */
function phasesD15(S) {
  const { idx, effFps: fps } = S;
  const F = Array.from({ length: idx[idx.length - 1] - idx[0] + 1 }, (_, k) => idx[0] + k);
  const dense = (arr) => F.map((f) => [0, 1].map((c) => interp(f, idx, arr.map((p) => p[c]))));
  const grip = dense(S.hands);
  const nose = dense(S.body[LM.nose]);
  const gy = grip.map((p) => p[1]);
  const lShY = dense(S.body[S.lead[0]]).map((p) => p[1]);
  const tShY = dense(S.body[S.trail[0]]).map((p) => p[1]);
  const leadDy = dense(S.ends.lead).map((p, k) => p[1] - lShY[k]);
  const trailDy = dense(S.ends.trail).map((p, k) => p[1] - tShY[k]);
  const hipY = dense(S.body[S.trailHip]).map((p) => p[1]);
  const rGrip = NOISE_MULT * S.sigmaGrip;
  const band = S.armPx * Math.sin((LEVEL_TOL_DEG * Math.PI) / 180);
  const holdW = Math.ceil(FINISH_HOLD_S * fps);
  const vg = netSpeed(grip, holdW, fps);
  const vn = netSpeed(nose, holdW, fps);
  const tg = stillThreshold(vg);
  const tn = stillThreshold(vn);
  const conf = {};
  const notes = [];
  const fi = (f) => f - F[0];

  // P4 top: the END of the hands' plateau before the downswing (the club keeps going back
  // after the hands stop, so the plateau start is always too early).
  const [kAnchor, kBottom] = downswingAnchor(S);
  const aAnchor = fi(idx[kAnchor]);
  let kHi = 0;
  for (let k = 0; k <= aAnchor; k++) if (gy[k] < gy[kHi]) kHi = k;
  let dropAt = -1;
  for (let k = kHi; k <= aAnchor; k++) {
    if (gy[k] > gy[kHi] + rGrip) {
      dropAt = k;
      break;
    }
  }
  const top = dropAt >= 0 ? F[dropAt - 1] : F[kHi];
  const handsTop = F[kHi];

  // motionStart: from the half-rise of the final backswing, back to the last frame whose
  // preceding hold window was still.
  const halfY = (Math.max(...gy.slice(0, kHi + 1)) + gy[kHi]) / 2;
  let kHalf = 0;
  for (let k = kHi; k >= 0; k--) {
    if (gy[k] > halfY) {
      kHalf = k + 1;
      break;
    }
  }
  let kMs = kHalf;
  while (kMs > holdW && !(vg[kMs - holdW] <= tg)) kMs--;
  const motionStart = F[kMs];

  conf.impact = 0.5;
  const kRun = Math.min(kMs, Math.max(0, kMs - (kHi - kMs)));
  const P = {
    motionStart, top, handsTop, impact: idx[kBottom], descentEnd: idx[kBottom], conf, notes,
    addressRun: [F[kRun], motionStart],
    d: { F, gy, leadDy, trailDy, hipY, vg, vn, tg, tn, band, holdW },
  };
  conf.address = 0.5;
  conf.top = 0.7;
  P.address = motionStart;
  applyRules(P);
  return P;
}

/** Checkpoints between address and finish given top and impact (re-run whenever impact moves). */
function applyRules(P) {
  const { F, gy, hipY, leadDy, trailDy, band, vg, vn, tg, tn } = P.d;
  const { top, impact, motionStart: ms, conf, notes } = P;
  const pick = (key, f, lo, hi, why) => {
    if (f === null) {
      P[key] = pyRound((lo + hi) / 2);
      conf[key] = 0.2;
      notes.push(`${key} fallback: no ${why} in [${lo}, ${hi}] -> window midpoint`);
    } else {
      P[key] = f;
      conf[key] = 0.7;
    }
  };
  // P2: shaft level going back puts the grip at about trail-hip height (P2 and P6 mirror each other).
  pick('takeaway', firstFrame(F, (k) => gy[k] <= hipY[k], ms, top), ms, top, 'grip at trail-hip height');
  // P3: the lead wrist rises into the level band around the lead shoulder's height.
  pick('leadArm', firstFrame(F, (k) => leadDy[k] <= band, P.takeaway, top), P.takeaway, top, 'lead wrist at shoulder height');
  // P5: the lead wrist is back in the band on the way down.
  pick('transition', firstFrame(F, (k) => leadDy[k] >= -band, top + 1, impact), top + 1, impact, 'lead wrist back at shoulder height');
  // P6: the grip falls to trail-hip height (the shaft is end-on there, so no image check).
  pick('shaftDown', firstFrame(F, (k) => gy[k] >= hipY[k], P.transition, impact), P.transition, impact, 'grip at trail-hip height');
  // P9: the trail wrist rises into the band around the trail shoulder's height.
  pick('trailArm', firstFrame(F, (k) => trailDy[k] <= band, impact + 1, F[F.length - 1]), impact + 1, F[F.length - 1], 'trail wrist at shoulder height');
  // P10: grip AND head stopped for the hold window.
  const still = (k) => vg[k] <= tg && vn[k] <= tn;
  const fin = firstFrame(F, still, P.trailArm, F[F.length - 1]);
  if (fin === null) {
    P.finish = F[F.length - 1];
    conf.finish = 0.2;
    notes.push('finish fallback: never still for 0.15 s after trailArm -> last frame');
  } else {
    P.finish = fin;
    conf.finish = 0.7;
  }
  P.downswing = impact - top;
  P.backswing = top - ms;
}

/** P1 < P2 < ... < P10: a checkpoint at or before its predecessor moves to predecessor + 1. */
function enforceOrder(P) {
  CHECKPOINT_KEYS.slice(1).forEach((b, n) => {
    const a = CHECKPOINT_KEYS[n];
    if (P[b] <= P[a]) {
      P.notes.push(`order: ${b} ${P[b]} <= ${a} ${P[a]} -> ${P[a] + 1}`);
      P[b] = P[a] + 1;
      P.conf[b] = Math.min(P.conf[b] ?? 0.2, 0.2);
    }
  });
}

/** How long the golfer stays still after the finish, seconds (capped by the clip). */
function finishQuietSeconds(P, fps) {
  const { F, vg, vn, tg, tn, holdW } = P.d;
  let k = P.finish - F[0];
  let run = 0;
  while (k < F.length && vg[k] <= tg && vn[k] <= tn) {
    run++;
    k++;
  }
  const toEnd = F[F.length - 1] - P.finish;
  return Math.min(run + holdW, toEnd) / fps;
}

/**
 * Detect the checkpoints of a clip.
 *
 * @param {number[]} idx  sampled frame indices, ascending (irregular is fine)
 * @param {number[][][]} L  per sample, 33 x [x, y, visibility] in pixels
 * @param {object} o
 * @param {number} o.containerFps
 * @param {number|null} [o.captureFps]  from the file's metadata when present
 * @param {number} [o.duplicateFrameRatio]  fake slow-mo probe
 * @param {'right'|'left'} [o.handedness]
 * @param {number} [o.bodyH]  px; default: bounding box of the first pose
 * @param {number|null} [o.ballGoneFrame]  native: first frame the ball patch changes sharply
 * @param {number|null} [o.addressFrame]  native: last still frame before the clubhead moves
 *   back (onset in the ball patch - 1). Without it P1 falls back to `motionStart` (plan 5.1).
 * @param {number} [o.gripK]
 */
export function detectPhases(idx, L, o) {
  const {
    containerFps, captureFps = null, duplicateFrameRatio = 0, handedness = 'right',
    ballGoneFrame = null, addressFrame = null, gripK = GRIP_K,
  } = o;
  const bodyH = o.bodyH || bodyHeightPx(L[0]);
  let factor;
  let source;
  if (captureFps) {
    factor = Math.max(1, pyRound(captureFps / containerFps));
    source = 'metadata';
  } else {
    factor = provisionalFactor(idx, L, bodyH, containerFps);
    source = 'estimate';
  }
  let S;
  let P;
  for (let round = 0; round < 2; round++) {
    S = buildSeries(idx, L, { containerFps, factor, handedness, gripK, bodyH });
    P = phasesD15(S);
    if (source === 'metadata') break;
    const next = factorFromDownswing(P.downswing, containerFps);
    if (next === factor) break;
    if (round === 0) factor = next;
  }
  const fps = S.effFps;

  // Impact: the ball leaving is the direct signal, anywhere in the downswing.
  const slack = Math.ceil(BALL_GONE_SLACK_S * fps);
  const sources = { impact: 'pose', address: 'pose-motionStart' };
  if (ballGoneFrame !== null && P.top < ballGoneFrame && ballGoneFrame <= P.descentEnd + slack) {
    P.impact = ballGoneFrame - 1;
    sources.impact = 'ballGoneFrame';
    applyRules(P);
    P.conf.impact = 0.9;
  }
  // P1: the last still frame before the clubhead moves back (image signal), else motionStart.
  if (addressFrame !== null) {
    P.address = addressFrame;
    P.conf.address = 0.8;
    sources.address = 'clubhead-onset';
  }
  enforceOrder(P);

  const checkpoints = Object.fromEntries(CHECKPOINT_KEYS.map((k) => [k, { i: P[k], conf: P.conf[k] }]));
  const impact = P.impact;
  const internal = {
    motionStart: P.motionStart,
    handsTop: P.handsTop,
    lateBackswing: pyRound((P.leadArm + P.top) / 2),
    preImpact: impact - Math.max(1, Math.round(PRE_IMPACT_S * fps)),
    postImpact: impact + POST_IMPACT_FRAMES,
  };
  return {
    checkpoints,
    internal,
    fps: fpsInfo({ containerFps, duplicateFrameRatio }, factor, source),
    series: S,
    sources,
    notes: [...new Set(P.notes)],
    addressRun: P.addressRun,
    finishQuietS: finishQuietSeconds(P, fps),
    sigmaGrip: S.sigmaGrip,
    bodyH,
  };
}
