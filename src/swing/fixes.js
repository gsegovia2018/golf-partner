// "Your fixes": plain-language coaching for the checks that need work (strings.fixCopy), the
// drill that goes with each, and a short ordered list for the results screen. Pure.

import { DRILLS, drillsForFault } from './drills';
import { rankedRows } from './priority';
import { SWING_STRINGS as T } from './strings';

// Checks with no `dir` (or a dir that is not a copy key) read their key from the value.
const SINGLE = {
  spine_loss: 'lost', hip_drift: 'toward', head_drift: 'moved', finish_balance: 'off', down_vs_takeaway: 'steeper',
};
const POSTURE_MID = 30; // degrees of spine tilt: a row without a dir (schema 1) reads below = too upright

/** 'over', 'tall', ... the key into fixCopy[check.id], or null for a green / unknown row. */
export function fixKey(check) {
  if (!check || (check.status !== 'red' && check.status !== 'yellow')) return null;
  const copy = T.fixCopy[check.id];
  if (!copy) return null;
  if (check.dir && copy[check.dir]) return check.dir;
  if (SINGLE[check.id]) return SINGLE[check.id];
  const v = check.value;
  switch (check.id) {
    case 'posture_address': return v < POSTURE_MID ? 'tall' : 'over';
    case 'hands_height_impact': return v > 0 ? 'up' : 'down';
    case 'hands_out_impact': return v > 0 ? 'in' : 'out'; // + = toward the ball
    case 'shaft_angle_impact': return v >= 0 ? 'up' : 'down';
    default: return null;
  }
}

/** { headline, cost, cue, steps } for a check that needs work, else null. */
export function fixCopy(check) {
  const key = fixKey(check);
  return key ? T.fixCopy[check.id][key] : null;
}

/** The catalogue drill for a check: one aimed at it, else its fault's generic drill, else null. */
export function drillForCheck(check) {
  const aimed = DRILLS.find((d) => d.checks?.includes(check.id));
  if (aimed) return aimed;
  if (!check.fault) return null;
  const own = drillsForFault(check.fault);
  return own.find((d) => !d.checks) || own[0] || null;
}

/**
 * Up to `max` fixes, most important first (the order of the main fault, spec §6): one per fault
 * (its worst check), reds before yellows.
 * @returns {{check: object, copy: object, drill: object|null, fault: string|null}[]}
 */
export function fixesFor(analysis, max = 3) {
  const out = [];
  rankedRows(analysis?.checks || []).forEach((check) => {
    if (!fixCopy(check) || out.some((f) => f.fault === check.fault)) return;
    out.push({ check, copy: fixCopy(check), drill: drillForCheck(check), fault: check.fault });
  });
  return out.slice(0, max);
}
