// Which checks belong to which of the ten user-facing checkpoints (D10, D22), the worst status
// per checkpoint for the timeline dots, and where a "Place clubhead" CTA should send the
// user (D16). Pure.

import { CHECKPOINT_KEYS } from './phases';

// Where a check is read. The impact-vs-address comparisons are read at impact (that is
// where the golfer sees the loss), and the pre-impact clubhead row lives with impact too:
// preImpact is an internal frame (D10).
const HOME = {
  posture_address: ['address'],
  hands_under_shoulders: ['address'],
  waist_bend: ['address'],
  back_line: ['address'],
  hand_gap: ['address'],
  hands_between_planes: ['leadArm', 'top'],
  butt_extension: ['leadArm'],
  top_direction: ['top'],
  hands_over_heels: ['top'],
  lead_arm_shoulder_plane: ['top'],
  downswing_path: ['shaftDown'],
  shaft_down_shallow: ['shaftDown'],
  shaft_through_steep: ['shaftThrough'],
  clubhead_vs_plane: ['impact'],
  hands_height_impact: ['impact'],
  hands_out_impact: ['impact'],
  shaft_angle_impact: ['impact'],
  spine_loss: ['impact'],
  hip_drift: ['impact'],
  head_drift: ['impact'],
  tempo: ['impact'],
  finish_balance: ['finish'],
};

export const CHECK_KEY = (c) => (c.cp ? `${c.id}@${c.cp}` : c.id);

/** The checks to list under a checkpoint, in analysis order. */
export const checksAt = (checks, cp) => checks.filter((c) => (HOME[c.id] || []).includes(cp));

/** 'red' | 'yellow' | 'green' | 'none' (nothing measured there, or only unknowns). */
export function worstAt(checks, cp) {
  const at = checksAt(checks, cp).filter((c) => c.status !== 'unknown');
  if (!at.length) return 'none';
  return at.some((c) => c.status === 'red') ? 'red' : at.some((c) => c.status === 'yellow') ? 'yellow' : 'green';
}

export const worstByCheckpoint = (checks) => Object.fromEntries(CHECKPOINT_KEYS.map((k) => [k, worstAt(checks, k)]));

/** The checkpoint to show for a check (its first home). */
export const homeOf = (check) => (HOME[check.id] || ['impact'])[0];

/**
 * The checkpoint whose clubhead the user still has to place for this check (D16), or null
 * when the check is not waiting on a placement. Only an `unplaced` unknown qualifies: a
 * hidden mark is a decision, not a gap.
 */
export function unplacedCheckpoint(check, clubMarks = {}) {
  if (check.status !== 'unknown' || check.reason !== 'unplaced') return null;
  const wants = check.cp ? [check.cp] : check.cps || [];
  const hit = wants.find((k) => clubMarks[k] && !clubMarks[k].hidden && !clubMarks[k].head);
  return hit ?? null;
}

/** Frame index of any of the thirteen checkpoints (ten on the timeline, three internal). */
export const frameOfKey = (analysis, key) => analysis.checkpoints[key]?.i ?? analysis.internal?.[key];
