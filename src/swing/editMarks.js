// The model behind Edit marks (plan 6, 7.3, D8, D16): a draft of the golfer's corrections,
// the live recompute of the club-dependent checks, and the conversion to marks.json.
// Pure: no I/O, no React. Coordinates are normalised to the decoded frame.
//
// A draft holds, per checkpoint (the nine plus the three internal frames):
//   frame   the checkpoint's frame (the user can move it: "Set <checkpoint> to this frame")
//   hands   [x, y] the user placed, or null = automatic (the smoothed grip at that frame)
//   head    [x, y] | null  the clubhead; null with hidden=false means "not placed yet" (D16)
//   hidden  the clubhead is end-on or out of frame
// plus the ball ([x, y, r], one for the swing, markable at address). `base` keeps what
// analyze() proposed, so every label stores proposed and final side by side (the v2 training
// data) and "Reset to auto" has something to go back to.

import { analyze } from './analyze';
import { CHECKPOINT_KEYS } from './phases';
import {
  emptyMarks, frameLabel, withFrame, withBall, handsPlaced,
} from './labels';
import { frameOfKey } from './checkpointChecks';

export const EDIT_KEYS = [...CHECKPOINT_KEYS, 'lateBackswing', 'preImpact', 'postImpact'];
export const HIT_RADIUS_PX = 28; // 56 px across: comfortably over the 44 px minimum

const sameXY = (a, b) => (a == null && b == null) || (a != null && b != null && a[0] === b[0] && a[1] === b[1]);
const sameBall = (a, b) => (a == null && b == null) || (a != null && b != null && a.length === b.length && a.every((v, i) => v === b[i]));

/**
 * @param {object} analysis  the stored analysis (marks already applied)
 * @param {object|null} pose  pose.json (for the proposed ball)
 * @param {object|null} marks  marks.json
 * @returns {{ draft: object, base: object }}
 */
export function buildDraft(analysis, pose, marks) {
  const cps = {};
  const proposed = {};
  EDIT_KEYS.forEach((k) => {
    const cm = analysis.clubMarks[k];
    const frame = frameOfKey(analysis, k);
    const label = marks?.frames?.find((f) => f.checkpoint === k) ?? null;
    const placed = label && handsPlaced(label) ? label.hands.final : null;
    cps[k] = { frame, hands: placed, head: cm.head ?? null, hidden: !!cm.hidden };
    proposed[k] = label
      ? {
        frame: label.iProposed ?? label.i,
        hands: label.hands.proposed,
        head: label.head.proposed,
        hidden: !!label.head.proposedHidden,
        conf: label.head.proposedConf,
        source: label.head.proposedSource,
      }
      : { frame, hands: cm.hands, head: cm.head ?? null, hidden: !!cm.hidden, conf: cm.conf, source: cm.source };
  });
  const nativeBall = pose?.ball ? [pose.ball.x, pose.ball.y, pose.ball.r] : null;
  const ballProposed = marks?.ball?.proposed ?? nativeBall ?? (analysis.reference?.ball ? [...analysis.reference.ball, 0.012] : null);
  const ball = marks?.ball?.final ?? ballProposed;
  return { draft: { cps, ball }, base: { cps: proposed, ball: ballProposed } };
}

const headChanged = (d, p) => !sameXY(d.head, p.head) || d.hidden !== p.hidden;
const touched = (d, p) => d.frame !== p.frame || !!d.hands || headChanged(d, p);

/** What analyze() takes as opts.marks: only what differs from the proposal. */
export function analyzeMarks(draft, base) {
  const out = {};
  EDIT_KEYS.forEach((k) => {
    const d = draft.cps[k];
    const p = base.cps[k];
    const m = {};
    if (d.frame !== p.frame) m.frame = d.frame;
    if (d.hands) m.hands = d.hands;
    if (headChanged(d, p)) {
      if (d.hidden) m.hidden = true;
      else if (d.head) m.head = d.head;
    }
    if (Object.keys(m).length) out[k] = m;
  });
  return out;
}

/** The analysis for a draft (analyze() on the stored pose: milliseconds). */
export function recompute({ pose, probe, analysis, draft, base }) {
  return analyze(pose, {
    pass2: pose.pass2 ?? {},
    probe: probe ?? {},
    marks: analyzeMarks(draft, base),
    ball: draft.ball ?? undefined,
    handedness: analysis.handedness,
    heightCm: analysis.scale?.approx ? undefined : analysis.scale?.heightCm,
    club: analysis.club,
    source: analysis.source,
    swingId: analysis.swingId,
    createdAt: analysis.createdAt,
  });
}

/** The draft as marks.json (swing-club-labels/1): proposed and final for every corrected frame. */
export function draftToMarks({ draft, base, live, swingId, video = null, handedness = 'right', editedAt }) {
  let m = emptyMarks({ swingId, video, handedness });
  EDIT_KEYS.forEach((k) => {
    const d = draft.cps[k];
    const p = base.cps[k];
    // Only frames the user touched: preImpact / postImpact follow impact by themselves.
    if (!touched(d, p)) return;
    const label = frameLabel({
      i: d.frame,
      checkpoint: k,
      iProposed: p.frame,
      hands: { proposed: p.hands, final: d.hands ?? live.clubMarks[k].hands, placed: !!d.hands },
      head: {
        proposed: p.head,
        proposedHidden: p.hidden,
        proposedConf: p.conf ?? null,
        proposedSource: p.source ?? null,
        final: d.hidden ? null : d.head,
        finalHidden: d.hidden,
      },
      editedAt,
    });
    if (label.corrected) m = withFrame(m, label);
  });
  return withBall(m, { proposed: base.ball, final: draft.ball });
}

export const isDirty = (draft, initial) => JSON.stringify(draft) !== JSON.stringify(initial);
export const ballChanged = (draft, base) => !sameBall(draft.ball, base.ball);

/** A checkpoint reset to what analyze() proposed (the ball too, at address). */
export function resetCheckpoint(draft, base, key) {
  const p = base.cps[key];
  const next = { ...draft, cps: { ...draft.cps, [key]: { frame: p.frame, hands: null, head: p.head, hidden: p.hidden } } };
  return key === 'address' ? { ...next, ball: base.ball } : next;
}

export const patchCheckpoint = (draft, key, patch) => ({ ...draft, cps: { ...draft.cps, [key]: { ...draft.cps[key], ...patch } } });

/** Clamp a normalised point into the frame. */
export const clampPt = (p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))];

/**
 * Which handle a touch grabs. `pt` and the handles are in view px (inside the picture's
 * rect); the nearest handle within HIT_RADIUS_PX wins, ties go to `prefer`.
 * @returns {'hands'|'head'|'ball'|null}
 */
export function hitTest(pt, { hands, head, ball }, prefer = 'hands', radius = HIT_RADIUS_PX) {
  let best = null;
  [['hands', hands], ['head', head], ['ball', ball]].forEach(([t, p]) => {
    if (!p) return;
    const d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
    if (d <= radius && (!best || d < best.d || (d === best.d && t === prefer))) best = { t, d };
  });
  return best ? best.t : null;
}

// The club-dependent rows the live card shows, and the one that goes on the picture for a checkpoint.
const CLUB_IDS = ['clubhead_vs_plane', 'butt_extension', 'top_direction', 'shaft_angle_impact'];
export const liveChecks = (checks) => checks.filter((c) => CLUB_IDS.includes(c.id));
export function pillCheck(key, checks) {
  const find = (id, cp) => checks.find((c) => c.id === id && (!cp || c.cp === cp)) ?? null;
  switch (key) {
    case 'preImpact': case 'impact': return find('clubhead_vs_plane', key);
    case 'leadArm': return find('butt_extension');
    case 'top': return find('top_direction');
    case 'address': return find('shaft_angle_impact');
    default: return null;
  }
}
