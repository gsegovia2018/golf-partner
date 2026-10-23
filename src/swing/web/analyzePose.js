// analyzePose on the web (PoseAnalyzer.kt): one sequential decode; pose on the frames the
// SamplingPolicy wants; ball strips once the swing has started; the ball found once the club has
// left it; ballGoneFrame. Same options and the same result map as the native method.
//
// Differences from Android, all about how, not what:
// - no threads: decode → pose → policy runs in one loop, so no epochs or in-flight results.
// - no frame ring: a back-fill (the trigger, the top) decodes again from the sync frame before the
//   frames it re-runs. It always reaches the frames it wants, where the Android ring can be shorter.
// - grey is the luma of the browser's RGB (webFrame.js).

import {
  Lm, PoseSample, Rect, Stats, Grip, pt, CancelledError,
} from './core/geom';
import { SamplingPolicy } from './core/samplingPolicy';
import { Ball, BallWindow } from './core/ball';
import { Probe } from './core/probe';
import { WebFrame, makeCanvas, decimation } from './webFrame';
import { PoseRunner } from './pose';

/** Long side fed to the pose model (its crops are 256 px; the lab clip goes in at 850). */
const MAX_SIDE = 960;
/** Strip margin around the ball ROI: ballGoneFrame reads ±(3.1 diameters + 2 px) ≈ 13.3 cm around the ball. */
const SEARCH_MARGIN_CM = 14;
const MIN_HEIGHT_CM = 120;
const MAX_HEIGHT_CM = 230;

const round5 = (v) => Math.round(v * 100000) / 100000;

/**
 * @param clip   openClip() result
 * @param opts   { model, sampling: { sparseEvery, midEvery, followEvery }, handedness, heightCm, captureFps }
 * @param ctx    { cancelled() → bool, progress(stage, done, total), pose?: PoseRunner }
 */
export async function analyzePoseWeb(clip, opts = {}, { cancelled = () => false, progress = () => {}, pose = null } = {}) {
  const t0 = performance.now();
  const { track } = clip;
  const sampling = opts.sampling ?? {};
  const sparseEvery = Math.max(1, sampling.sparseEvery ?? 16);
  const midEvery = Math.max(1, sampling.midEvery ?? 4);
  const followEvery = Math.max(1, sampling.followEvery ?? 2);
  const rightHanded = opts.handedness !== 'left';
  const h = Number(opts.heightCm);
  const heightCm = Math.min(MAX_HEIGHT_CM, Math.max(MIN_HEIGHT_CM, Number.isFinite(h) ? h : Ball.DEFAULT_HEIGHT_CM));
  const capture = Number(opts.captureFps);
  const fps = (Number.isFinite(capture) && capture > 0 ? capture : null) ?? track.captureFps ?? 240;
  const policy = new SamplingPolicy(fps, sparseEvery, midEvery, followEvery);

  const dispW = track.dispW;
  const dispH = track.dispH;
  const total = track.ptsUs.length;
  const scale = Math.min(1, MAX_SIDE / Math.max(dispW, dispH));
  const outW = Math.round(dispW * scale);
  const outH = Math.round(dispH * scale);
  const decim = decimation(dispW, dispH);
  const ws = Math.min(Math.min(dispW, dispH) >= 720 ? 0.5 : 1, 1 / decim);
  const stripStep = Math.round(1 / (ws * decim));

  const runner = pose ?? new PoseRunner({ model: opts.model ?? 'full' });
  if (!pose) await runner.start();
  const input = makeCanvas(outW, outH);
  const quarter = makeCanvas(1, 1);

  const samples = new Map(); // frame -> PoseSample (display px)
  const norm = new Map(); // frame -> Float32Array (normalised)
  const diffs = [];
  let prevQuarter = null;
  const strips = new Map();
  let stripRect = null;
  let stillFrom = 0;
  let addressHands = null;
  let addressRoi = null;
  let expDWork = 0;
  let decodedUpTo = -1;
  let decodeMs = 0;

  const step = Math.max(1, Math.trunc(total / 50));
  const lastSample = () => (samples.size ? Math.max(...samples.keys()) : -1);

  function startStrips(m) {
    const still = [...samples.values()].filter((s) => s.frame >= stillFrom && s.frame < m)
      .sort((a, b) => a.frame - b.frame).slice(-16);
    if (!still.length) return;
    const med = (sel) => Stats.median(still.map(sel));
    const toe = rightHanded ? Lm.L_TOE : Lm.R_TOE;
    const grips = still.map((s) => Grip.point(s));
    const hands = pt(Stats.median(grips.map((g) => g.x)), Stats.median(grips.map((g) => g.y)));
    const ankleY = med((s) => (s.y(Lm.L_ANK) + s.y(Lm.R_ANK)) / 2);
    const pxCm = Ball.pxPerCm(still, rightHanded, heightCm);
    expDWork = Ball.BALL_CM * pxCm * ws;
    const workW = Math.round(dispW * ws);
    const workH = Math.round(dispH * ws);
    const roi = Ball.roi(med((s) => s.x(toe)), ankleY, hands.x, rightHanded ? 1 : -1, dispW, dispH, ws, workW, workH);
    const margin = Math.ceil(SEARCH_MARGIN_CM * pxCm * ws);
    addressRoi = roi;
    addressHands = pt(hands.x * ws, hands.y * ws);
    stripRect = roi.isEmpty() ? null
      : new Rect(Math.max(0, roi.x0 - margin), Math.max(0, roi.y0 - margin), Math.min(workW, roi.x1 + margin), Math.min(workH, roi.y1 + margin));
  }

  async function runPose(wf) {
    wf.drawTo(input, outW, outH);
    const lm = await runner.detect(input, wf.ptsUs);
    if (!lm) return [];
    const px = new Float32Array(lm.length);
    for (let j = 0; j < Lm.COUNT; j += 1) {
      px[3 * j] = lm[3 * j] * dispW;
      px[3 * j + 1] = lm[3 * j + 1] * dispH;
      px[3 * j + 2] = lm[3 * j + 2];
    }
    const s = new PoseSample(wf.frame, wf.ptsUs, px);
    samples.set(wf.frame, s);
    norm.set(wf.frame, lm);
    const e = policy.observe(new SamplingPolicy.Obs(wf.frame, Grip.point(s), pt(s.x(Lm.NOSE), s.y(Lm.NOSE)), s.bodyHeight()));
    return e && e.type !== 'None' ? [e] : [];
  }

  /**
   * Decodes [from, to] and handles each frame. `replay` = { m, stride, upTo }: a back-fill, whose
   * frames up to `upTo` re-run pose only on m's stride grid (and fill missing strips). Returns the
   * back-fill an event asked for, or null at the end of the clip.
   */
  async function pass(from, replay) {
    let first = true;
    const want = clip.backend === 'element'
      ? (f) => (replay && f <= replay.upTo
        ? (stripRect != null && !strips.has(f)) || ((f - replay.m) % replay.stride === 0)
        : policy.wants(f) || stripRect != null)
      : null;
    const tDecode = performance.now();
    let poseMs = 0;
    try {
      for await (const d of clip.frames(from, total - 1, { cancelled, want })) {
        if (cancelled()) throw new CancelledError();
        const n = d.frame;
        const wf = new WebFrame(d, track);
        const fresh = n > decodedUpTo;
        if (fresh) {
          decodedUpTo = n;
          if (clip.backend !== 'element') {
            const q = wf.quarterGray(quarter);
            if (prevQuarter && prevQuarter.length === q.length) diffs.push(Probe.meanAbsDiff(q, prevQuarter));
            prevQuarter = q;
          }
        }
        if (stripRect && !strips.has(n)) strips.set(n, wf.grayStrip(stripRect, stripStep));
        let events = [];
        const tp = performance.now();
        if (replay && n <= replay.upTo) {
          if (((n - replay.m) % replay.stride + replay.stride) % replay.stride === 0) {
            if (first) { await runner.fresh(); first = false; }
            events = await runPose(wf);
          }
        } else if (policy.wants(n)) {
          events = await runPose(wf);
        }
        poseMs += performance.now() - tp;
        if (n % step === 0) {
          progress('decode', n + 1, total);
          progress('pose', lastSample() + 1, total);
        }
        for (const e of events) {
          switch (e.type) {
            case 'Trigger':
              startStrips(e.frame);
              // re-run m − lookback … n at the mid stride, then the next back-fill gets its own instance
              return { from: e.from, m: e.frame, stride: policy.midEvery, upTo: n };
            case 'Top':
              return { from: e.from, m: e.frame, stride: 1, upTo: n };
            case 'Reset':
              strips.clear();
              stripRect = null;
              stillFrom = e.frame;
              runner.startSpare();
              break;
            case 'Done':
              stripRect = null;
              break;
            default:
              break;
          }
        }
      }
      return null;
    } finally {
      decodeMs += performance.now() - tDecode - poseMs;
    }
  }

  try {
    let next = await pass(0, null);
    while (next) {
      // the frames between the back-fill's start and the trigger have strips to fill too
      next = await pass(Math.max(0, next.from), next);
    }
  } finally {
    if (!pose) runner.close();
  }
  progress('pose', total, total);

  const list = [...samples.values()].sort((a, b) => a.frame - b.frame);
  const [ball, ballGoneFrame] = findBall(list);
  const totalMs = performance.now() - t0;
  const frames = [...norm.keys()].sort((a, b) => a - b).map((i) => {
    const lm = norm.get(i);
    const out = [];
    for (let j = 0; j < Lm.COUNT; j += 1) out.push([round5(lm[3 * j]), round5(lm[3 * j + 1]), round5(lm[3 * j + 2])]);
    return { i, tMs: samples.get(i).ptsUs / 1000, lm: out };
  });
  return {
    video: {
      width: dispW, height: dispH, containerFps: track.containerFps, frameCount: total,
    },
    frames,
    ball,
    ballGoneFrame,
    duplicateFrameRatio: Probe.duplicateRatio(diffs),
    timings: {
      decodeMs: Math.round(Math.max(0, decodeMs)),
      inferMs: Math.round(runner.inferMs),
      totalMs: Math.round(totalMs),
      inferences: runner.inferences,
      delegate: runner.delegate === 'GPU' ? 'gpu' : 'cpu',
      createMs: Math.round(runner.createMs),
      stagesMs: {},
      inputSize: `${outW}x${outH}`,
      backend: clip.backend,
    },
  };

  /** Ball on three frames between lead-arm level and the hands' top, then ballGoneFrame. */
  function findBall(list) {
    if (!addressRoi || !addressHands || policy.triggerFrame < 0 || !list.length) return [null, null];
    const end = policy.impactFrame >= 0 ? policy.impactFrame : list[list.length - 1].frame;
    const win = BallWindow.find(list, policy.triggerFrame, end, rightHanded);
    if (!win) return [null, null];
    const mid = Math.trunc((win.leadArm + win.handsTop) / 2);
    const picks = [...new Set([win.leadArm, mid, win.handsTop])].map((f) => strips.get(f)).filter(Boolean);
    const b = Ball.detect(picks, addressRoi, addressHands, rightHanded ? 1 : -1, expDWork, ws);
    if (!b) return [null, null];
    const gone = Ball.goneFrame(strips, b.x * ws, b.y * ws, expDWork, [win.leadArm, win.handsTop], win.handsTop, fps);
    return [{
      x: b.x / dispW, y: b.y / dispH, r: b.r / dispW, conf: b.conf, frame: mid,
    }, gone];
  }
}
