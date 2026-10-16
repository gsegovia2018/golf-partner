// marks.json: the user's corrections and the v2 training labels (plan 7.3,
// schema swing-club-labels/1). Pure data shaping, no I/O. Coordinates are
// normalised (0-1 of the decoded frame).
//
// The mark-first flow (D26) extends the schema compatibly, so the name stays /1: optional
// `confirmed` per frame and per mark (hands, head, ball) and an optional top-level `pass`
// ({ state, skipped }, see markPass.js) and, per head, `proposedAt` (club on demand). Files without them
// parse as before.

export const LABELS_SCHEMA = 'swing-club-labels/1';

/** An empty label file for a freshly analysed swing. */
export function emptyMarks({ swingId, video = null, handedness = 'right' }) {
  return {
    schema: LABELS_SCHEMA,
    swingId,
    video,
    view: 'dtl',
    handedness,
    ball: { proposed: null, final: null, corrected: false },
    frames: [],
  };
}

const sameXY = (a, b) => (a == null && b == null) || (a != null && b != null && a[0] === b[0] && a[1] === b[1]);

/**
 * One frame entry. `proposed` is what analyze() suggested, `final` what the user
 * left (equal when untouched); `corrected` is derived, never typed by callers.
 */
export function frameLabel({
  i, checkpoint, iProposed = null, hands, head, editedAt = null, confirmed = false, confirmedFrame = false,
}) {
  const corrected = (iProposed != null && iProposed !== i)
    || !sameXY(hands.proposed, hands.final)
    || !sameXY(head.proposed, head.final)
    || !!head.proposedHidden !== !!head.finalHidden;
  return {
    i,
    checkpoint,
    iProposed: iProposed ?? i,
    // placed: the user put the hands there (false = they follow the smoothed grip at the frame)
    hands: {
      proposed: hands.proposed ?? null,
      final: hands.final ?? null,
      placed: hands.placed ?? !sameXY(hands.proposed, hands.final),
      confirmed: !!hands.confirmed,
    },
    head: {
      proposed: head.proposed ?? null,
      proposedHidden: !!head.proposedHidden,
      proposedConf: head.proposedConf ?? null,
      proposedSource: head.proposedSource ?? null,
      // the frame the proposal belongs to; absent = the proposed frame (iProposed). A model proposal asked
      // for on the frame the golfer chose (club on demand) names that frame.
      ...(head.proposedAt != null ? { proposedAt: head.proposedAt } : {}),
      final: head.final ?? null,
      finalHidden: !!head.finalHidden,
      confirmed: !!head.confirmed,
    },
    corrected,
    confirmed: !!confirmed, // the golfer confirmed the position (D26), moved or not
    confirmedFrame: !!confirmedFrame, // the golfer chose this frame in step 1, "Find the frame" (D28)
    editedAt: corrected || confirmed ? editedAt : null,
  };
}

/** Insert or replace one frame (keyed by checkpoint), kept sorted by frame index. */
export function withFrame(marks, label) {
  const frames = marks.frames.filter((f) => f.checkpoint !== label.checkpoint).concat(label)
    .sort((a, b) => a.i - b.i);
  return { ...marks, frames };
}

export function withBall(marks, { proposed = marks.ball.proposed, final, confirmed = false }) {
  const same = (a, b) => (a == null && b == null) || (a != null && b != null && a.every((v, k) => v === b[k]));
  return { ...marks, ball: { proposed, final, corrected: !same(proposed, final), confirmed: !!confirmed } };
}

/** Did the user place the hands (older files without the flag: they did if they differ from the proposal)? */
export const handsPlaced = (f) => f.hands.placed ?? !sameXY(f.hands.final, f.hands.proposed);

/** Marks in the shape analyze() takes as opts.marks: { [checkpoint]: { hands, head, hidden } }. */
export function marksForAnalyze(marks) {
  const out = {};
  (marks?.frames || []).filter((f) => f.corrected).forEach((f) => {
    out[f.checkpoint] = { hands: handsPlaced(f) ? f.hands.final : null, head: f.head.final, hidden: f.head.finalHidden };
    if (f.iProposed != null && f.iProposed !== f.i) out[f.checkpoint].frame = f.i; // the checkpoint itself moved
  });
  return out;
}

/** Parsed marks, or null if the input is not a swing-club-labels/1 file. */
export function parseMarks(raw) {
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return m && m.schema === LABELS_SCHEMA && Array.isArray(m.frames) ? m : null;
  } catch {
    return null;
  }
}
