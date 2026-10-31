// Which checks belong to which position (swing checks v2, spec §3), the worst status per
// position, and where a "tap to place" should send the user (D16, spec §5). Pure.
//
// CHECKPOINT_KEYS (phases.js) stays the ten frames detection finds; the checks are read at the
// seven POSITIONS below, plus the finish for the extras. Every row says its `position` (or
// `extra: true`); an extra is listed under its home checkpoint but never colours it.

import { CHECKPOINT_KEYS } from './phases';
import { headTrusted } from './club';

/** The seven positions, in swing order: P1, P2, P3 (halfway back), P4, P6 (downswing), P7, P9 (follow-through). */
export const POSITIONS = ['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm'];

/** Importance tiers (spec §6): 1 = address, downswing, impact; 2 = halfway back, top; 3 = takeaway, follow-through, extras. */
export const TIER = {
  address: 1, shaftDown: 1, impact: 1, leadArm: 2, top: 2, takeaway: 3, trailArm: 3,
};
export const EXTRA_TIER = 3;

// Face-on (plan 2026-10-30 §3, §4): five positions; tiers 1 = address, impact; 2 = top, downswing; 3 = finish.
export const POSITIONS_FO = ['address', 'top', 'shaftDown', 'impact', 'finish'];
export const TIER_FO = {
  address: 1, impact: 1, top: 2, shaftDown: 2, finish: 3,
};

/** 'faceOn' | 'dtl': anything that is not face-on (an analysis from before the view existed) reads as down the line. */
export const normView = (view) => (view === 'faceOn' ? 'faceOn' : 'dtl');
/** The positions of a view, in swing order. */
export const positionsOf = (view) => (normView(view) === 'faceOn' ? POSITIONS_FO : POSITIONS);
/** The importance tiers of a view. */
export const tiersOf = (view) => (normView(view) === 'faceOn' ? TIER_FO : TIER);

// Where an extra is listed on the results screen (it does not colour that checkpoint).
const EXTRA_HOME = {
  tempo: 'impact',
  head_drift: 'impact',
  hands_height_impact: 'impact',
  hands_out_impact: 'impact',
  shaft_angle_impact: 'impact',
  finish_balance: 'finish',
  finish_trail_foot: 'finish',
  swing_symmetry: 'trailArm',
};

export const CHECK_KEY = (c) => (c.cp ? `${c.id}@${c.cp}` : c.id);

/** The checkpoint to show for a check: its position, else (an extra) its home. */
export const homeOf = (check) => check.position ?? EXTRA_HOME[check.id] ?? 'impact';

/** The checks to list under a checkpoint, in analysis order (extras included at their home). */
export const checksAt = (checks, cp) => checks.filter((c) => homeOf(c) === cp);

/** 'red' | 'yellow' | 'green' | 'none' (nothing measured there, or only unknowns). Extras never count. */
export function worstAt(checks, cp) {
  const at = checks.filter((c) => !c.extra && c.position === cp && c.status !== 'unknown');
  if (!at.length) return 'none';
  return at.some((c) => c.status === 'red') ? 'red' : at.some((c) => c.status === 'yellow') ? 'yellow' : 'green';
}

export const worstByCheckpoint = (checks) => Object.fromEntries(CHECKPOINT_KEYS.map((k) => [k, worstAt(checks, k)]));

/**
 * The checks grouped for the priority list: red, yellow, unknown (not measured), green. Each group
 * is in swing order (the position of the check's home among the checkpoints), ties keep their order.
 */
export function prioritizeChecks(checks) {
  const out = { red: [], yellow: [], unknown: [], green: [] };
  checks.forEach((c) => out[c.status in out ? c.status : 'unknown'].push(c));
  const at = (c) => CHECKPOINT_KEYS.indexOf(homeOf(c));
  Object.values(out).forEach((g) => g.sort((a, b) => at(a) - at(b)));
  return out;
}

/**
 * The checkpoint whose clubhead the user still has to place for this check (D16), or null
 * when the check is not waiting on a placement. Only an `unplaced` unknown qualifies: a
 * hidden mark is a decision, not a gap. A detection below the checks' gate (spec §5) is not
 * a placement either.
 */
export function unplacedCheckpoint(check, clubMarks = {}) {
  if (check.status !== 'unknown' || check.reason !== 'unplaced') return null;
  const wants = check.cp ? [check.cp] : check.cps || [];
  const open = (m) => m && !m.hidden && (!m.head || !headTrusted(m.source, m.conf));
  const hit = wants.find((k) => open(clubMarks[k]));
  return hit ?? null;
}

/** Frame index of a checkpoint (the ten on the timeline) or an internal frame. */
export const frameOfKey = (analysis, key) => analysis.checkpoints[key]?.i ?? analysis.internal?.[key];
