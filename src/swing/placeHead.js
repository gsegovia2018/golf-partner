// Place (or confirm) one clubhead from the results screen (swing checks v2, design D): two taps, no
// trip to Edit marks. It is the marking canvas's own model: the position's draft takes the point (or
// keeps the proposal), the head is confirmed, the analysis is re-derived and the marks are rebuilt.
// The pass stays done (it was, or the results would not be open). Pure: the screen saves what comes back.

import {
  buildDraft, recompute, draftToMarks, placeMark, confirmMark,
} from './editMarks';

/**
 * @param {{analysis: object, pose: object, probe: object|null, marks: object|null}} stored
 * @param {string} cp  the position whose clubhead is placed
 * @param {[number, number]|null} pt  the normalised point the golfer tapped; null confirms the proposed dot
 * @returns {{analysis: object, marks: object}|null}  null when the analysis could not be re-derived
 */
export function placeHead({
  analysis, pose, probe, marks,
}, cp, pt) {
  const { draft, base } = buildDraft(analysis, pose, marks);
  if (!draft.cps[cp]) return null;
  if (!pt && !draft.cps[cp].head) return null;
  const next = confirmMark(pt ? placeMark(draft, cp, 'head', pt) : draft, base, cp, 'head');
  const live = recompute({
    pose, probe, analysis, draft: next, base,
  });
  if (live.error) return null;
  const v = pose.video;
  const built = draftToMarks({
      draft: next,
      base,
      live,
      swingId: analysis.swingId,
      video: v ? { width: v.width, height: v.height, fps: v.containerFps } : null,
      handedness: analysis.handedness,
      editedAt: new Date().toISOString(),
      passState: 'done', // results only open once the marking pass is done: placing a head never reopens it
    });
  // Only the placed position's label changes: every other label stays exactly as stored (draftToMarks rebuilds
  // them from the draft, which can differ on an older swing whose detection frame is not the label's proposed one).
  const stored = marks?.frames ?? [];
  const mine = built.frames.find((f) => f.checkpoint === cp);
  const frames = stored.filter((f) => f.checkpoint !== cp);
  if (mine) frames.push(mine);
  const order = (f) => (stored.findIndex((x) => x.checkpoint === f.checkpoint) + 1 || 1e9);
  frames.sort((a, b) => order(a) - order(b));
  const out = { ...built, frames, ball: marks?.ball ?? built.ball };
  // marks.json from before the pass has no `pass`: its confirmed positions are the corrected frames. Stamping a
  // pass on it would flip every stored label to "not confirmed" (phone test: 1 unconfirmed became 2).
  if (marks && !marks.pass) delete out.pass;
  else out.pass = marks?.pass ?? built.pass;
  return { analysis: live, marks: out };
}
