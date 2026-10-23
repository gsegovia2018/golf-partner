// Ported from modules/golf-swing SamplingPolicy.kt. Pure: no IO, no platform.

import { Stats, dist, pt } from './geom';

/**
 * Pass-1 sampling policy "sparse165" (plan §4.2, owner decision 2026-10-12: reach the time goal
 * by inferring fewer frames). Strides:
 *
 *   STILL      every `sparseEvery` (16)  until the grip leaves its still reference (trigger)
 *   BACKSWING  every `midEvery` (4)      motion start → the top is seen
 *   DOWNSWING  every frame               from the top back-fill to impact + `margin` (6)
 *   FOLLOW     every `followEvery` (2)   → the grip and the nose stop (the finish)
 *   DONE       every `sparseEvery`
 *
 * The top is only known once the grip has come down from it, so the policy reports it late
 * (Event Top, ~14 frames at 240 fps on the lab clip) with the frame to back-fill from:
 * `topBack` (20) frames before the one it was seen at. The caller re-runs those frames from
 * its ring of decoded frames. The trigger likewise back-fills the 16-stride gap at the 4-stride.
 * Validated in the lab: tools/swing-lab/detect.py --sampling sparse165 mirrors this class
 * (SparsePolicy) — keep the two in step.
 *
 * It never decides a phase; it only decides which frames get a pose inference. Pure: fed pose
 * observations, it answers `wants` per frame and reports transitions from `observe`.
 *
 * Time base: `fps` is the capture rate of one container frame step (captureFps, else 240 —
 * plan §4.2: a 30 fps slow-mo container samples like a 240 fps recording), used only to turn
 * the plan's seconds (0.5 s calibration, 0.15 s hold, 1.5 s / 3 s caps) into frames.
 *
 * Thresholds are per clip, from the pose jitter, never a fixed H/s constant (§4.2):
 * - σ (grip, nose) = jitter from consecutive differences over the first 0.5 s of the still
 *   run (PLAN-GAP: differences, not raw − smoothed, so a slow drift at address does not
 *   inflate σ or fire the trigger).
 * - moving = the grip is more than 3σ√2 away from the median of the last 4 still samples.
 * - top = the grip has risen ≥ 0.2 H above its trigger height and then dropped more than 3σ√2
 *   below its highest sample (H = landmark box height).
 * - stopped = the 0.15 s displacement is ≤ 3 × its 25th percentile over the still run,
 *   floored at 3σ√2.
 *
 * PLAN-GAPs:
 * - A trigger with no rise afterwards (waggle, forward press) falls back to sparse once the
 *   grip has been stopped for 0.15 s, and the still run restarts there.
 * - Impact = the grip has descended ≥ 0.2 H from the top, then come back up by 0.02 H; the
 *   frames to impact + `margin` stay dense.
 * - FOLLOW also ends 1.5 s after impact; the swing zones end 3 s after the trigger even with
 *   no impact (Event DenseCapped, `impactFrame` left −1).
 * - DONE is final: only the first swing in a clip gets the dense pass.
 */

const Zone = Object.freeze({
  STILL: 'STILL',
  BACKSWING: 'BACKSWING',
  DOWNSWING: 'DOWNSWING',
  FOLLOW: 'FOLLOW',
  DONE: 'DONE',
});

/** Events are plain objects tagged by `type`; `Event.None` is a shared singleton. */
const Event = Object.freeze({
  None: Object.freeze({ type: 'None' }),
  /** Motion started at `frame`; re-run `from` … `frame` at the `midEvery` stride. */
  Trigger: (frame, from) => ({ type: 'Trigger', frame, from }),
  /** The trigger was a waggle: back to sparse from `frame`. */
  Reset: (frame) => ({ type: 'Reset', frame }),
  /** The top was seen at `frame`; re-run every frame `from` … `frame`. */
  Top: (frame, from) => ({ type: 'Top', frame, from }),
  Impact: (frame) => ({ type: 'Impact', frame }),
  /** The swing zones hit their 3 s cap at `frame` without an impact. */
  DenseCapped: (frame) => ({ type: 'DenseCapped', frame }),
  Done: (frame) => ({ type: 'Done', frame }),
});

/** One observation: `grip` and `nose` are `{ x, y }` display px, `bodyH` the landmark box height. */
class Obs {
  constructor(frame, grip, nose, bodyH) {
    this.frame = frame;
    this.grip = grip;
    this.nose = nose;
    this.bodyH = bodyH;
  }
}

const moveRadius = (sigma) => 3 * Math.sqrt(2) * sigma;

export class SamplingPolicy {
  static Zone = Zone;

  static Event = Event;

  static Obs = Obs;

  constructor(fps, sparseEvery = 16, midEvery = 4, followEvery = 2, margin = 6, topBack = 20) {
    this.sparseEvery = sparseEvery;
    this.midEvery = midEvery;
    this.followEvery = followEvery;
    this.margin = margin;
    this.topBack = topBack;

    this.holdFrames = Math.max(2, Math.ceil(0.15 * fps));
    this.calibFrames = Math.ceil(0.5 * fps);
    this.afterImpactMaxFrames = Math.ceil(1.5 * fps);
    this.denseMaxFrames = Math.ceil(3.0 * fps);
    this.afterFrom = -1;

    this.zone = Zone.STILL;
    this.origin = 0;
    /** FOLLOW: every frame up to here (impact + margin), then `followEvery`. */
    this.denseUntil = -1;
    this.lastFrame = -1;

    this.still = [];
    this.calibrated = false;
    this.sigmaGrip = NaN;
    this.sigmaNose = NaN;
    this.stopGrip = NaN;
    this.stopNose = NaN;
    this.bodyH = NaN;

    this.window = [];
    this.refY = 0;
    this.topY = Number.MAX_VALUE;
    this.bottomY = -Number.MAX_VALUE;
    this.bottomFrame = -1;
    this.risen = false;

    this.triggerFrame = -1;
    this.topSeenFrame = -1;
    this.impactFrame = -1;
  }

  /** The stride of the current zone. */
  get every() {
    switch (this.zone) {
      case Zone.BACKSWING: return this.midEvery;
      case Zone.DOWNSWING: return 1;
      case Zone.FOLLOW: return this.followEvery;
      default: return this.sparseEvery;
    }
  }

  wants(frame) {
    // FOLLOW starts at impact + margin, but the frames up to it stay dense
    if (this.zone === Zone.FOLLOW && frame <= this.denseUntil) return true;
    if (frame < this.origin) return false;
    return (frame - this.origin) % this.every === 0;
  }

  /** Feed observations in frame order; older or repeated frames are ignored. */
  observe(o) {
    if (o.frame <= this.lastFrame) return Event.None;
    this.lastFrame = o.frame;
    switch (this.zone) {
      case Zone.STILL: return this.observeStill(o);
      case Zone.BACKSWING: return this.observeBackswing(o);
      case Zone.DOWNSWING: return this.observeDownswing(o);
      case Zone.FOLLOW: return this.observeFollow(o);
      default: return Event.None;
    }
  }

  observeStill(o) {
    if (!this.calibrated) this.calibrate(o.frame);
    if (this.calibrated && this.still.length >= 4) {
      const ref = this.rollingRef();
      if (dist(o.grip, ref) > moveRadius(this.sigmaGrip)) {
        this.zone = Zone.BACKSWING;
        this.origin = o.frame;
        this.triggerFrame = o.frame;
        this.refY = ref.y;
        this.topY = o.grip.y;
        this.risen = false;
        this.window = [o];
        return Event.Trigger(o.frame, o.frame - (this.sparseEvery - this.midEvery));
      }
    }
    this.still.push(o);
    return Event.None;
  }

  capped(o) {
    if (o.frame - this.triggerFrame <= this.denseMaxFrames) return null;
    this.zone = Zone.FOLLOW;
    this.origin = o.frame;
    this.afterFrom = o.frame;
    this.denseUntil = o.frame;
    this.window = [];
    return Event.DenseCapped(o.frame);
  }

  observeBackswing(o) {
    this.push(o);
    const c = this.capped(o);
    if (c) return c;
    const g = o.grip.y;
    if (!this.risen) {
      this.topY = Math.min(this.topY, g);
      if (this.refY - this.topY >= 0.2 * this.bodyH) {
        this.risen = true;
      } else if (this.stopped(true, false)) {
        this.zone = Zone.STILL;
        this.origin = o.frame;
        this.still = this.window.slice();
        this.window = [];
        return Event.Reset(o.frame);
      }
      return Event.None;
    }
    if (g < this.topY) {
      this.topY = g;
      return Event.None;
    }
    if (g > this.topY + moveRadius(this.sigmaGrip)) {
      this.zone = Zone.DOWNSWING;
      this.origin = o.frame;
      this.topSeenFrame = o.frame;
      this.bottomY = g;
      this.bottomFrame = o.frame;
      return Event.Top(o.frame, o.frame - this.topBack);
    }
    return Event.None;
  }

  observeDownswing(o) {
    this.push(o);
    const c = this.capped(o);
    if (c) return c;
    const g = o.grip.y;
    if (g < this.topY) {
      this.topY = g;
      this.bottomY = -Number.MAX_VALUE;
      return Event.None;
    }
    if (g > this.bottomY) {
      this.bottomY = g;
      this.bottomFrame = o.frame;
    }
    if (this.bottomY - this.topY >= 0.2 * this.bodyH && g < this.bottomY - 0.02 * this.bodyH) {
      this.impactFrame = this.bottomFrame;
      this.afterFrom = this.bottomFrame;
      this.denseUntil = Math.max(o.frame, this.bottomFrame + this.margin);
      this.zone = Zone.FOLLOW;
      this.origin = this.denseUntil;
      this.window = [];
      return Event.Impact(this.bottomFrame);
    }
    return Event.None;
  }

  observeFollow(o) {
    this.push(o);
    if ((o.frame > this.denseUntil && this.stopped(true, true)) || o.frame - this.afterFrom > this.afterImpactMaxFrames) {
      this.zone = Zone.DONE;
      this.origin = o.frame;
      return Event.Done(o.frame);
    }
    return Event.None;
  }

  push(o) {
    const w = this.window;
    w.push(o);
    while (w.length > 1 && w[0].frame < o.frame - this.holdFrames) w.shift();
  }

  /** The window covers the hold time and its two ends (median of 3) moved less than "stopped". */
  stopped(grip, noseToo) {
    const w = this.window;
    if (w.length < 4 || w[w.length - 1].frame - w[0].frame < this.holdFrames - this.midEvery) return false;
    const end = (sel, from) => {
      const ps = [0, 1, 2].map((i) => sel(w[from + i]));
      return pt(Stats.median(ps.map((p) => p.x)), Stats.median(ps.map((p) => p.y)));
    };
    const gOk = !grip || dist(end((it) => it.grip, 0), end((it) => it.grip, w.length - 3)) <= this.stopGrip;
    const nOk = !noseToo || dist(end((it) => it.nose, 0), end((it) => it.nose, w.length - 3)) <= this.stopNose;
    return gOk && nOk;
  }

  rollingRef() {
    const last = this.still.slice(-4);
    return pt(Stats.median(last.map((o) => o.grip.x)), Stats.median(last.map((o) => o.grip.y)));
  }

  /** σ, "stopped" and H from the first 0.5 s of the still run (at least 4 samples). */
  calibrate(now) {
    const { still, calibFrames, sparseEvery } = this;
    if (still.length < 4 || (now - still[0].frame < calibFrames && still.length < Math.trunc(calibFrames / sparseEvery))) return;
    const first = still.filter((o) => o.frame - still[0].frame <= calibFrames);
    const c = first.length >= 4 ? first : still;
    this.bodyH = Stats.median(c.map((o) => o.bodyH));
    const floor = Math.max(0.5, 0.003 * this.bodyH);
    const sigma = (sel) => Math.max(
      floor,
      Math.max(Stats.diffSigma(c.map((o) => sel(o).x)), Stats.diffSigma(c.map((o) => sel(o).y))),
    );
    this.sigmaGrip = sigma((o) => o.grip);
    this.sigmaNose = sigma((o) => o.nose);
    // 0.15 s displacement between still samples that far apart (P25 × 3, the lab's "stopped")
    const lag = Math.max(1, Math.round(this.holdFrames / sparseEvery));
    const stop = (sel, sig) => {
      const d = [];
      for (let i = 0; i < Math.max(0, c.length - lag); i += 1) d.push(dist(sel(c[i]), sel(c[i + lag])));
      const p25 = d.length === 0 ? 0 : Stats.percentile(d, 25);
      return Math.max(3 * p25, moveRadius(sig));
    };
    this.stopGrip = stop((o) => o.grip, this.sigmaGrip);
    this.stopNose = stop((o) => o.nose, this.sigmaNose);
    this.calibrated = true;
  }
}
