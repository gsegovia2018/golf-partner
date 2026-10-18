// The marking pass (plan D25, D26): which positions the golfer marks, where each one stands
// (confirmed / skipped / to do) and the swing's `marked` state for the index. Pure.
//
// The seven positions of swing checks v2 are marked (P1, P2, P3, P4, P6, P7, P9); the P10 finish
// stays automatic (the extras read it; it has a "Fix it" door). P5 and P8 are no longer marked.
// The pass state lives in marks.json (`pass: { state, skipped }`, `confirmed` per frame); a file
// written before the mark-first flow has no `pass`: its corrected frames count as confirmed and
// the pass reads as partial until all seven are.

export const MARKED_KEYS = ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'];
export const AUTO_KEYS = ['finish'];
export const MARK_TOTAL = MARKED_KEYS.length;
const LEGACY_KEYS = ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough']; // the D25 pass
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

/** { confirmed, skipped, todo } over the seven. */
export function passCounts(status) {
  const n = { confirmed: 0, skipped: 0, todo: 0 };
  MARKED_KEYS.forEach((k) => { n[positionStatus(status, k)] += 1; });
  return n;
}

/** The index row's `marked`: { state: 'none' | 'partial' | 'done', count } (count = confirmed of seven). */
export function markedFromMarks(marks) {
  const status = statusFromMarks(marks);
  const count = passCounts(status).confirmed;
  if (marks?.pass) return { state: STATES.includes(marks.pass.state) ? marks.pass.state : 'partial', count };
  // before D26, or no file at all: done when every position of that time's pass was corrected, so
  // checks v2 (seven positions) does not hide the results of a swing that was finished then
  const done = count === MARK_TOTAL || LEGACY_KEYS.every((k) => status[k] === 'confirmed');
  return { state: done ? 'done' : 'partial', count };
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
