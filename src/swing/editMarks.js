// The model behind Edit marks (plan 6, 7.3, D8, D16): a draft of the golfer's corrections,
// the live recompute of the club-dependent checks, and the conversion to marks.json.
// Pure: no I/O, no React. Coordinates are normalised to the decoded frame.
//
// A draft holds, per checkpoint (the ten plus the three internal frames):
//   frame   the checkpoint's frame (the user can move it: "Set <checkpoint> to this frame")
//   hands   [x, y] the user placed, or null = automatic (the smoothed grip at that frame)
//   head    [x, y] | null  the clubhead; null with hidden=false means "not placed yet" (D16)
//   hidden  the clubhead is end-on or out of frame
//   confirmed { hands, head }  the golfer confirmed that mark (D26); moving it clears the flag
//   frameOk the golfer chose this frame in step 1 ("Find the frame", D28)
// plus the ball ([x, y, r], one for the swing, markable at address) with `ballConfirmed`, and
// `status` { [key]: 'confirmed' | 'skipped' } for the positions of the marking pass (markPass.js).
// `base` keeps what analyze() proposed, so every label stores proposed and final side by side
// (the v2 training data) and a status word can say whether a mark moved.

import { analyze } from './analyze';
import { CHECKPOINT_KEYS } from './phases';
import {
  emptyMarks, frameLabel, withFrame, withBall, handsPlaced,
} from './labels';
import { frameOfKey } from './checkpointChecks';
import { MARKED_KEYS, statusFromMarks, passCounts, MARK_TOTAL } from './markPass';

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
  const legacy = !!marks && !marks.pass; // written before D26: a corrected frame was the golfer's word
  EDIT_KEYS.forEach((k) => {
    const cm = analysis.clubMarks[k];
    const frame = frameOfKey(analysis, k);
    const label = marks?.frames?.find((f) => f.checkpoint === k) ?? null;
    const placed = label && handsPlaced(label) ? label.hands.final : null;
    const ok = (m) => !!label && (legacy ? !!label.corrected : !!label[m]?.confirmed);
    cps[k] = {
      frame, hands: placed, head: cm.head ?? null, hidden: !!cm.hidden, confirmed: { hands: ok('hands'), head: ok('head') }, frameOk: !!label?.confirmedFrame,
    };
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
  const ballConfirmed = !!(marks?.ball?.confirmed ?? (legacy && marks.ball?.corrected));
  return {
    draft: {
      cps, ball, ballConfirmed, status: statusFromMarks(marks),
    },
    base: { cps: proposed, ball: ballProposed },
  };
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
    // On a moved frame the clubhead is what the golfer saw there, never the old frame's proposal
    // read again by analyze() (marks.json stores it as head.final the same way).
    if (headChanged(d, p) || d.frame !== p.frame) {
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

/**
 * The draft as marks.json (swing-club-labels/1): proposed and final for every corrected or
 * confirmed frame, plus the pass (D26). `passState` defaults to done once all six are confirmed.
 */
export function draftToMarks({
  draft, base, live, swingId, video = null, handedness = 'right', editedAt, passState,
}) {
  let m = emptyMarks({ swingId, video, handedness });
  const status = draft.status ?? {};
  EDIT_KEYS.forEach((k) => {
    const d = draft.cps[k];
    const p = base.cps[k];
    const ok = d.confirmed ?? {};
    const confirmed = status[k] === 'confirmed';
    // Only frames the user touched or confirmed: preImpact / postImpact follow impact by themselves.
    if (!touched(d, p) && !confirmed && !ok.hands && !ok.head) return;
    const label = frameLabel({
      i: d.frame,
      checkpoint: k,
      iProposed: p.frame,
      hands: {
        proposed: p.hands, final: d.hands ?? live.clubMarks[k].hands, placed: !!d.hands, confirmed: !!ok.hands,
      },
      head: {
        proposed: p.head,
        proposedHidden: p.hidden,
        proposedConf: p.conf ?? null,
        proposedSource: p.source ?? null,
        final: d.hidden ? null : d.head,
        finalHidden: d.hidden,
        confirmed: !!ok.head,
      },
      confirmed,
      confirmedFrame: !!d.frameOk,
      editedAt,
    });
    if (label.corrected || confirmed || ok.hands || ok.head) m = withFrame(m, label);
  });
  const state = passState ?? (passCounts(status).confirmed === MARK_TOTAL ? 'done' : 'partial');
  m = withBall(m, { proposed: base.ball, final: draft.ball, confirmed: !!draft.ballConfirmed });
  return { ...m, pass: { state, skipped: MARKED_KEYS.filter((k) => status[k] === 'skipped') } };
}

export const isDirty = (draft, initial) => JSON.stringify(draft) !== JSON.stringify(initial);
export const ballChanged = (draft, base) => !sameBall(draft.ball, base.ball);

export const patchCheckpoint = (draft, key, patch) => ({ ...draft, cps: { ...draft.cps, [key]: { ...draft.cps[key], ...patch } } });

// --- The marking canvas (D26): per-mark status, confirmation, skip and discard -------------------

const MARKS_AT = (key) => (key === 'address' ? ['hands', 'head', 'ball'] : ['hands', 'head']);
const okOf = (d) => d.confirmed ?? { hands: false, head: false };

/**
 * The dock's status word for one mark: 'proposed' | 'confirmed' | 'hidden' | 'missing' | 'moved'.
 * Moved = changed from the proposal and not confirmed yet.
 */
export function markStatus(draft, base, key, mark) {
  if (mark === 'ball') {
    if (!draft.ball) return 'missing';
    if (draft.ballConfirmed) return 'confirmed';
    return sameBall(draft.ball, base.ball) ? 'proposed' : 'moved';
  }
  const d = draft.cps[key];
  const ok = okOf(d);
  if (mark === 'head') {
    if (d.hidden) return 'hidden';
    if (!d.head) return 'missing';
    if (ok.head) return 'confirmed';
    return sameXY(d.head, base.cps[key].head) && !base.cps[key].hidden ? 'proposed' : 'moved';
  }
  if (ok.hands) return 'confirmed';
  return d.hands ? 'moved' : 'proposed';
}

/**
 * Step 1's "Use frame N" / "Proposed frame looks right" (D28): the position takes `frame`. On a
 * different frame its marks start again, because a hand placed on frame 495 is wrong on 497: the
 * hands follow the tracked grip at the new frame, the clubhead goes back to the proposal on the
 * proposed frame and to Missing anywhere else, nothing is confirmed. The ball (one per swing) stays.
 * @returns {{ draft: object, reset: boolean }}  reset = the frame changed, so the marks did
 */
export function chooseFrame(draft, base, key, frame) {
  const d = draft.cps[key];
  if (d.frame === frame) return { draft: d.frameOk ? draft : patchCheckpoint(draft, key, { frameOk: true }), reset: false };
  const p = base.cps[key];
  const atProposal = frame === p.frame;
  return {
    draft: patchCheckpoint(draft, key, {
      frame,
      hands: null,
      head: atProposal ? p.head : null,
      hidden: atProposal ? p.hidden : false,
      confirmed: { hands: false, head: atProposal && p.hidden },
      frameOk: true,
    }),
    reset: true,
  };
}

/** Put a mark at a normalised point; a moved mark needs confirming again. */
export function placeMark(draft, key, mark, pt, ballR = 0.012) {
  if (mark === 'ball') return { ...draft, ball: [pt[0], pt[1], draft.ball?.[2] ?? ballR], ballConfirmed: false };
  const ok = okOf(draft.cps[key]);
  return mark === 'hands'
    ? patchCheckpoint(draft, key, { hands: pt, confirmed: { ...ok, hands: false } })
    : patchCheckpoint(draft, key, { head: pt, hidden: false, confirmed: { ...ok, head: false } });
}

/** The clubhead hidden toggle: hidden is itself a decision, so it needs no Confirm. */
export function setHidden(draft, key, hidden) {
  return patchCheckpoint(draft, key, { hidden, confirmed: { ...okOf(draft.cps[key]), head: hidden } });
}

/** Confirm one mark (a missing one has nothing to confirm). */
export function confirmMark(draft, base, key, mark) {
  const st = markStatus(draft, base, key, mark);
  if (st === 'missing' || st === 'confirmed') return draft;
  if (mark === 'ball') return { ...draft, ballConfirmed: true };
  return patchCheckpoint(draft, key, { confirmed: { ...okOf(draft.cps[key]), [mark]: true } });
}

/** "Looks right": every mark that is there is confirmed, and so is the position. */
export function confirmPosition(draft, base, key) {
  let next = draft;
  MARKS_AT(key).forEach((m) => { next = confirmMark(next, base, key, m); });
  return { ...next, status: { ...next.status, [key]: 'confirmed' } };
}

/** "Confirm and leave": confirm the marks that moved, without deciding the position. */
export function confirmMoves(draft, base, key) {
  let next = draft;
  MARKS_AT(key).forEach((m) => { if (markStatus(next, base, key, m) === 'moved') next = confirmMark(next, base, key, m); });
  return next;
}

/** "Discard the move": the position (and the ball at address) as it was when the golfer came in. */
export function restorePosition(draft, snapshot, key) {
  const next = { ...draft, cps: { ...draft.cps, [key]: snapshot.cps[key] } };
  return key === 'address' ? { ...next, ball: snapshot.ball, ballConfirmed: snapshot.ballConfirmed } : next;
}

/** Skip: drop what moved here and leave the position to the proposal (D26: Results say so). */
export function skipPosition(draft, snapshot, key) {
  const next = restorePosition(draft, snapshot, key);
  return { ...next, status: { ...next.status, [key]: 'skipped' } };
}

/** Leaving this position would lose an unconfirmed move: ask first (the discard sheet). */
export function pendingMoves(draft, base, snapshot, key) {
  const pick = (d) => JSON.stringify([d.cps[key], key === 'address' ? [d.ball, d.ballConfirmed] : null]);
  if (pick(draft) === pick(snapshot)) return false;
  return MARKS_AT(key).some((m) => markStatus(draft, base, key, m) === 'moved');
}

/**
 * What step 2's primary button does, so it can say so (D26):
 * 'save' (something moved) | 'noHead' | 'looks'.
 */
export function primaryAction(draft, base, key) {
  if (MARKS_AT(key).some((m) => markStatus(draft, base, key, m) === 'moved')) return 'save';
  if (markStatus(draft, base, key, 'head') === 'missing') return 'noHead';
  return 'looks';
}

/** Clamp a normalised point into the frame. A worklet: the mark drag runs on the UI thread (D28). */
export function clampPt(p) {
  'worklet';
  return [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))];
}

/**
 * Which handle a touch grabs. `pt` and the handles are in view px (inside the picture's
 * rect); the nearest handle within HIT_RADIUS_PX wins, ties go to `prefer`.
 * @returns {'hands'|'head'|'ball'|null}
 */
export function hitTest(pt, handles, prefer = 'hands', radius = HIT_RADIUS_PX) {
  'worklet'; // read on the UI thread when a drag starts (D28)
  const names = ['hands', 'head', 'ball'];
  let best = null;
  let bestD = 0;
  for (let k = 0; k < names.length; k += 1) {
    const t = names[k];
    const p = handles[t];
    if (p) {
      const d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
      if (d <= radius && (best === null || d < bestD || (d === bestD && t === prefer))) { best = t; bestD = d; }
    }
  }
  return best;
}
