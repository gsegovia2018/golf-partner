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
  return {
    analysis: live,
    marks: draftToMarks({
      draft: next,
      base,
      live,
      swingId: analysis.swingId,
      video: v ? { width: v.width, height: v.height, fps: v.containerFps } : null,
      handedness: analysis.handedness,
      editedAt: new Date().toISOString(),
      passState: 'done', // results only open once the marking pass is done: placing a head never reopens it
    }),
  };
}
