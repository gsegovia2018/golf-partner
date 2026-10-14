// "Your fixes": plain-language coaching for the checks that need work (strings.fixCopy), the
// drill that goes with each, and a short ordered list for the results screen. Pure.

import { DRILLS, drillsForFault } from './drills';
import { FAULTS, PHASES, significantFaults } from './priority';
import { SWING_STRINGS as T } from './strings';

// Checks with no `dir` (or a dir that is not a copy key) read their key from the value.
const SINGLE = { downswing_path: 'out', spine_loss: 'lost', hip_drift: 'toward', head_drift: 'moved', finish_balance: 'off' };
const POSTURE_MID = 30; // degrees of spine tilt: below = too upright, above = bent over (both clubs)

// Checks whose fault has no drill of its own in FAULTS.
const DRILL_ID = { 'clubhead_vs_plane.under': 'pl-palo-atras', 'top_direction.across': 'atl-objetivo', 'top_direction.laid_off': 'lo-objetivo' };

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
  const byId = DRILL_ID[`${check.id}.${fixKey(check)}`];
  if (byId) return DRILLS.find((d) => d.id === byId) || null;
  const fault = FAULTS.find((f) => f.pick(check));
  if (!fault) return null;
  const own = drillsForFault(fault.id);
  return own.find((d) => !d.checks) || own[0] || null;
}

const phaseRank = (p) => PHASES.indexOf(p);
const severity = (c) => (c.status === 'red' ? 1 : 0);

/**
 * Up to `max` fixes in swing order: one per significant fault (its worst check), then the
 * remaining reds, then the remaining yellows while there is room.
 * @returns {{check: object, copy: object, drill: object|null, fault: string|null}[]}
 */
export function fixesFor(analysis, max = 3) {
  const checks = analysis?.checks || [];
  const out = [];
  const used = new Set();
  const add = (check, fault) => {
    used.add(check);
    out.push({ check, copy: fixCopy(check), drill: drillForCheck(check), fault });
  };
  const faultOf = (c) => FAULTS.find((f) => f.pick(c))?.id ?? null;

  [...significantFaults(checks)]
    .sort((a, b) => phaseRank(a.fault.phase) - phaseRank(b.fault.phase) || b.score - a.score)
    .forEach(({ fault, evidence }) => {
      // red before yellow; a tie keeps analysis order (values in cm and degrees don't compare)
      const worst = evidence.filter(fixCopy).sort((a, b) => severity(b) - severity(a))[0];
      if (worst && !used.has(worst)) add(worst, fault.id);
    });

  // one fix per fault: a fault already listed is not listed again through another of its checks
  const listed = (fault) => fault && out.some((f) => f.fault === fault);
  ['red', 'yellow'].forEach((status) => {
    checks
      .filter((c) => c.status === status && !used.has(c) && fixCopy(c))
      .sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase))
      .forEach((c) => { if (!listed(faultOf(c))) add(c, faultOf(c)); });
  });

  return out.slice(0, max);
}
