// The steps of the results screen (swing checks v2, design D "summary + stepper"): the seven
// positions and an Extras step, which step it opens on, what each step's dot says and which rows it
// lists. Pure: the screen only draws what this returns.

import {
  POSITIONS, unplacedCheckpoint, CHECK_KEY, positionsOf,
} from './checkpointChecks';
import { positionStatuses } from './priority';
import { clubheadOpen, askAt } from './rowNeeds';

export { clubheadOpen };

export const EXTRAS = 'extras';
export const STEPS = [...POSITIONS, EXTRAS];
/** The steps of a swing's results: its view's positions, then Extras. */
export const stepsOf = (analysis) => [...positionsOf(analysis?.view), EXTRAS];
export const DOWNSWING = 'shaftDown';

const RANK = { red: 3, yellow: 2, green: 1 };

/** The rows a step lists: its position's rows, or every extra on the Extras step. */
export const stepRows = (checks, step) => (step === EXTRAS
  ? checks.filter((c) => c.extra)
  : checks.filter((c) => !c.extra && c.position === step));

/** { [position]: true } for each position with a row still waiting for its clubhead (extras do not count). */
export function pendingSteps(analysis) {
  const out = {};
  analysis.checks.forEach((c) => {
    if (c.extra) return;
    if (unplacedCheckpoint(c, analysis.clubMarks) === c.position) out[c.position] = true;
  });
  return out;
}

/** 'red' | 'yellow' | 'green' | 'unknown' per step; the Extras step is the worst extra (drawn grey-ringed). */
export function stepStatuses(analysis) {
  const out = positionStatuses(analysis.checks, analysis.view);
  const extras = analysis.checks.filter((c) => c.extra && c.status in RANK);
  out[EXTRAS] = extras.length ? extras.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'green') : 'unknown';
  return out;
}

/** The Downswing is the main-fault candidate that usually arrives unplaced: the headline is "so far" until it is. */
export const mainSoFar = (analysis) => !!pendingSteps(analysis)[DOWNSWING] && clubheadOpen(analysis.clubMarks, DOWNSWING);

/**
 * Where the screen opens (owner's pick, design D with E's mix): on the Downswing step in place mode
 * when its clubhead is unplaced AND placing it lets a row compute (without the ball there is no address
 * plane: the step opens without place mode and the summary asks for the ball); else on the main fault's position (its Extras step for an extra);
 * with no fault, on Address.
 * @returns {{ step: string, place: boolean }}
 */
export function openingStep(analysis) {
  if (mainSoFar(analysis)) {
    const ask = askAt(analysis, DOWNSWING);
    return { step: DOWNSWING, place: ask?.kind === 'clubhead' && ask.cp === DOWNSWING };
  }
  const main = analysis.main;
  if (!main) return { step: POSITIONS[0], place: false };
  return { step: main.position ?? EXTRAS, place: false };
}

/** 'first' (the main fault's step), 'starts' (where it likely starts) or null. */
export function tagOf(step, main) {
  if (!main) return null;
  if (step === (main.position ?? EXTRAS)) return 'first';
  return step === main.startsAt ? 'starts' : null;
}

/** The step to the left / right of `step` among `steps` (null at either end). */
export const neighbour = (step, dir, steps = STEPS) => steps[steps.indexOf(step) + dir] ?? null;

/**
 * The row selected when a step opens: on the main fault's step its first red evidence (else its first),
 * elsewhere the worst row (red, then yellow, else the first). Extras select nothing: they draw no line.
 */
export function defaultRow(checks, step, main) {
  if (step === EXTRAS) return null;
  const rows = stepRows(checks, step);
  if (main && step === main.position) {
    const ev = main.evidence.filter((c) => c.position === step);
    const first = ev.find((c) => c.status === 'red') ?? ev[0];
    if (first) return rows.find((c) => CHECK_KEY(c) === CHECK_KEY(first)) ?? first;
  }
  return rows.find((c) => c.status === 'red') ?? rows.find((c) => c.status === 'yellow') ?? rows[0] ?? null;
}

/** A horizontal swipe of `dx` px (right is positive) that is not mostly vertical: +1 = next (a swipe left), -1 = previous, 0 = none. */
export function swipeDir(dx, dy, min = 48) {
  if (Math.abs(dx) < min || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
