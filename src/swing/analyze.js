// Orchestration (plan 2.3, 5): native output in, analysis out. Pure JS, synchronous,
// milliseconds of arithmetic. It never touches a pixel: the image-derived signals arrive as
// plain numbers from the native module (ball, ballGoneFrame, address onset, clubhead seeds).
//
// Inputs and the stored result use coordinates normalised to the decoded frame (plan 7);
// pixels exist only inside the maths.

import { LM, trailShoulder, planeAngles } from './geometry';
import { interp, median } from './smoothing';
import { defaultHeightCm, scaleFromWindow } from './scale';
import { detectPhases, CHECKPOINT_KEYS } from './phases';
import { resolveClub } from './club';
import { runChecks, normClub } from './checks';
import { mainFault } from './priority';

export const SCHEMA = 'swing-analysis/1';
export const MAX_CLIP_S = 15; // captured seconds; the importer warns above this
const MIN_USABLE = 10;
const MIN_COVERAGE = 0.8;
const BODY_VISIBLE = 0.5;
const CLUB_KEYS = [...CHECKPOINT_KEYS, 'lateBackswing', 'preImpact', 'postImpact'];
const BODY_LM = [LM.lSh, LM.rSh, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnk, LM.rAnk];

const toPx = (p, W, H) => (p ? { x: p[0] * W, y: p[1] * H } : null);
const toNorm = (p, W, H) => (p ? [p.x / W, p.y / H] : null);

/** Landmarks at any frame: the sample itself or a linear interpolation of its neighbours. */
function makePoseAt(idx, L) {
  return (f) => {
    const exact = idx.indexOf(f);
    if (exact >= 0) return L[exact];
    if (f < idx[0] || f > idx[idx.length - 1]) return null;
    return L[0].map((_, j) => [0, 1, 2].map((c) => interp(f, idx, L.map((lm) => lm[j][c]))));
  };
}

/**
 * @param {object} native  analyzePose output (plan 3): { video, frames: [{i, tMs, lm}], ball, ballGoneFrame }
 *   ball = { x, y, r } normalised (r as a fraction of the frame width)
 * @param {object} [opts]
 * @param {{captureFps?:number|null, duplicateFrameRatio?:number}} [opts.probe]  probeVideo result
 * @param {object} [opts.pass2]  extractCheckpoints result: { shaft: { [frame]: { head: [x, y] px, hidden, conf, source } },
 *   addressFrame } (D16: only address and impact are proposed; addressFrame = last still frame before the clubhead moves)
 * @param {Object<string,{hands?:number[],head?:number[]|null,hidden?:boolean,frame?:number}>} [opts.marks]  user marks
 *   (normalised). `frame` moves the checkpoint itself (Edit marks: "Set to this frame"). A mark with neither a
 *   head nor `hidden` is a hands-only correction: the club stays whatever it was proposed (or unplaced).
 * @param {number[]|null} [opts.ball]  [x, y, r] normalised, the user's ball mark
 * @param {'right'|'left'} [opts.handedness]
 * @param {number|null} [opts.heightCm]  the golfer's height; default by gender, flagged approximate
 * @param {'male'|'female'} [opts.gender]
 * @param {'iron'|'driver'|null} [opts.club]  selects the per-club thresholds (checks.js THRESHOLDS); null reads as iron
 * @param {'camera'|'import'} [opts.source]
 * @returns {object|{error:'no_pose'|'partial_pose'|'too_long'}}
 */
export function analyze(native, opts = {}) {
  const t0 = Date.now();
  const { probe = {}, pass2 = {}, marks = {}, handedness = 'right', source = 'import' } = opts;
  const club = normClub(opts.club);
  const { width: W, height: H, containerFps, frameCount } = native.video;

  const samples = (native.frames || []).filter((f) => f && Array.isArray(f.lm) && f.lm.length === 33);
  if (samples.length < MIN_USABLE) return { error: 'no_pose' };
  const total = native.frames.length;
  const bodyVis = median(samples.flatMap((f) => BODY_LM.map((j) => f.lm[j][2])));
  if (samples.length / total < MIN_COVERAGE || bodyVis < BODY_VISIBLE) return { error: 'partial_pose' };

  const idx = samples.map((f) => f.i);
  const L = samples.map((f) => f.lm.map(([x, y, v]) => [x * W, y * H, v]));
  // opts.ball: the golfer's own ball mark from Edit marks, [x, y, r] normalised; it wins over the proposal.
  const ballN = opts.ball ?? (native.ball ? [native.ball.x, native.ball.y, native.ball.r] : null);
  const ballPx = ballN ? { x: ballN[0] * W, y: ballN[1] * H, r: ballN[2] * W } : null;

  let ph;
  try {
    ph = detectPhases(idx, L, {
      containerFps,
      captureFps: probe.captureFps ?? null,
      duplicateFrameRatio: probe.duplicateFrameRatio ?? 0,
      handedness,
      ballGoneFrame: native.ballGoneFrame ?? null,
      addressFrame: pass2.addressFrame ?? null,
    });
  } catch {
    return { error: 'partial_pose' };
  }
  if (frameCount / ph.fps.capture > MAX_CLIP_S) return { error: 'too_long' };

  const approxHeight = opts.heightCm == null;
  const heightCm = approxHeight ? defaultHeightCm(opts.gender) : opts.heightCm;
  const scale = scaleFromWindow(idx, L, ph.addressRun, handedness, heightCm, approxHeight);
  const poseAt = makePoseAt(idx, L);
  const S = ph.series;
  const handsAt = (f) => ({ x: interp(f, idx, S.hands.map((p) => p[0])), y: interp(f, idx, S.hands.map((p) => p[1])) });

  // The thirteen checkpoints: frame, smoothed grip, and the club (user mark > native seed > prior).
  const frames = { ...Object.fromEntries(CHECKPOINT_KEYS.map((k) => [k, ph.checkpoints[k].i])), ...ph.internal };
  const checkpoints = { ...ph.checkpoints };
  const moved = CHECKPOINT_KEYS.filter((k) => Number.isFinite(marks[k]?.frame) && marks[k].frame !== frames[k]);
  moved.forEach((k) => {
    const d = marks[k].frame - frames[k];
    frames[k] = marks[k].frame;
    checkpoints[k] = { ...checkpoints[k], i: marks[k].frame, conf: 1 };
    if (k === 'impact') { frames.preImpact += d; frames.postImpact += d; }
  });
  if (moved.some((k) => k === 'leadArm' || k === 'top')) frames.lateBackswing = Math.round((frames.leadArm + frames.top) / 2);
  const resolved = {};
  const cps = {};
  CLUB_KEYS.forEach((k) => {
    const f = frames[k];
    const m = marks[k];
    const placed = !!(m && (m.head || m.hidden));
    const mark = placed ? { hands: toPx(m.hands, W, H), head: toPx(m.head, W, H), hidden: m.hidden } : null;
    const cand = pass2.shaft?.[f] ?? null;
    const c = resolveClub(k, handsAt(f), cand, mark, ballPx);
    if (m?.hands && !placed) c.hands = toPx(m.hands, W, H); // hands-only correction
    resolved[k] = c;
    cps[k] = { frame: f, ...c };
  });

  const { checks } = runChecks({
    checkpoints: cps,
    ball: ballPx,
    pose: poseAt,
    handedness,
    club,
    pxPerCm: scale.pxPerCm,
    heightCm,
    motionStart: ph.internal.motionStart,
    finishQuietS: ph.finishQuietS,
    approximate: ph.fps.approximate,
  });
  const main = mainFault(checks);

  const addr = poseAt(frames.address);
  const reference = ballPx && addr ? {
    ball: toNorm(ballPx, W, H),
    handsAddress: toNorm(cps.address.hands, W, H),
    trailShoulder: toNorm(trailShoulder(addr, handedness), W, H),
    ...planeAngles(ballPx, cps.address.hands, trailShoulder(addr, handedness)),
  } : null;

  return {
    schema: SCHEMA,
    swingId: opts.swingId ?? null,
    createdAt: opts.createdAt ?? null,
    source,
    club,
    handedness,
    view: 'dtl',
    fps: ph.fps,
    approximate: ph.fps.approximate,
    scale: { pxPerCm: scale.pxPerCm, heightCm, approx: approxHeight },
    checkpoints: Object.fromEntries(CHECKPOINT_KEYS.map((k) => [k, checkpoints[k]])),
    internal: Object.fromEntries(Object.keys(ph.internal).map((k) => [k, frames[k] ?? ph.internal[k]])),
    addressSearch: ph.addressSearch, // pass 2's image-based address window (runAnalysis)
    reference,
    clubMarks: Object.fromEntries(CLUB_KEYS.map((k) => [k, {
      hands: toNorm(resolved[k].hands, W, H),
      head: toNorm(resolved[k].head, W, H),
      hidden: resolved[k].hidden,
      source: resolved[k].source,
      conf: resolved[k].conf,
      priorHead: toNorm(resolved[k].priorHead, W, H) ?? undefined,
    }])),
    checks,
    counts: {
      green: checks.filter((c) => c.status === 'green').length,
      yellow: checks.filter((c) => c.status === 'yellow').length,
      red: checks.filter((c) => c.status === 'red').length,
      unknown: checks.filter((c) => c.status === 'unknown').length,
    },
    main,
    notes: ph.notes,
    timings: { analyzeMs: Date.now() - t0 },
  };
}
