// The marking pass (plan D25, D26): which positions the golfer marks, where each one stands
// (confirmed / skipped / to do) and the swing's `marked` state for the index. Pure.
//
// Six positions are marked; P2 takeaway, P5 transition, P9 trail arm and P10 finish stay
// automatic (playback, Compare and the checks still read them; the finish has a "Fix it" door).
// The pass state lives in marks.json (`pass: { state, skipped }`, `confirmed` per frame); a file
// written before the mark-first flow has no `pass`: its corrected frames count as confirmed and
// the pass reads as partial until all six are.

export const MARKED_KEYS = ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough'];
export const AUTO_KEYS = ['takeaway', 'transition', 'trailArm', 'finish'];
export const MARK_TOTAL = MARKED_KEYS.length;
const STATES = ['none', 'partial', 'done'];

export const isMarkedKey = (key) => MARKED_KEYS.includes(key);
export const newPass = () => ({ state: 'none', skipped: [] });

/** { [key]: 'confirmed' | 'skipped' } as stored in marks.json (sparse: to do is absent). */
export function statusFromMarks(marks) {
  const out = {};
  if (!marks) return out;
  const legacy = !marks.pass;
  const skipped = marks.pass?.skipped || [];
  (marks.frames || []).forEach((f) => {
    if (legacy ? f.corrected : f.confirmed) out[f.checkpoint] = 'confirmed';
  });
  skipped.forEach((k) => { if (!out[k]) out[k] = 'skipped'; });
  return out;
}

/** 'confirmed' | 'skipped' | 'todo' for one marked position. */
export const positionStatus = (status, key) => status?.[key] ?? 'todo';

/** { confirmed, skipped, todo } over the six. */
export function passCounts(status) {
  const n = { confirmed: 0, skipped: 0, todo: 0 };
  MARKED_KEYS.forEach((k) => { n[positionStatus(status, k)] += 1; });
  return n;
}

/** The index row's `marked`: { state: 'none' | 'partial' | 'done', count } (count = confirmed of six). */
export function markedFromMarks(marks) {
  const count = passCounts(statusFromMarks(marks)).confirmed;
  if (marks?.pass) return { state: STATES.includes(marks.pass.state) ? marks.pass.state : 'partial', count };
  return { state: count === MARK_TOTAL ? 'done' : 'partial', count }; // before D26, or no file at all
}

/** Results are shown only after the pass (D26). A row from before D26 has no `marked` yet: unknown. */
export const passDone = (marked) => marked?.state === 'done';

/** The first position still to do after `from` (in pass order), or null when none is left. */
export function nextTodo(status, from = null) {
  const start = from == null ? 0 : MARKED_KEYS.indexOf(from) + 1;
  return MARKED_KEYS.slice(start).find((k) => positionStatus(status, k) === 'todo') ?? null;
}

/** Where a resumed pass opens: the first position to do, or null for the finish sheet. */
export const resumeKey = (status) => nextTodo(status, null);
