// The one main fault (plan 5.5, D21): the earliest fault in the swing, not the loudest.
//
// A fault is a cluster of checks with a swing phase and a weight. A fault is *significant*
// when its cluster has a red check or two agreeing signals (a single yellow is a "watch",
// never the thing to work on). The main fault is the significant fault of the EARLIEST
// phase (setup -> backswing -> transition / downswing -> impact -> finish): a setup or
// backswing fault usually causes what shows up later, so fixing it first is what moves the
// swing. Within one phase the weighted score decides: weight x (red 1, yellow 0.5) summed
// over the cluster, x (1 + 0.25 x (agreeing signals - 1)); a tie goes to the order of
// FAULTS. The significant faults of later phases are returned as `consequences`: what the
// main fault is likely also causing. With no significant fault there is no main fault (the
// weighted score never promotes a lone yellow either). across_the_line / laid_off
// (top_direction) are not clusters: never main on their own.

import { drillsForFault } from './drills';
import { SWING_STRINGS as T } from './strings';

const isDir = (c, ids, dir) => ids.includes(c.id) && c.dir === dir;

export const PHASES = ['setup', 'backswing', 'transition', 'impact', 'finish'];

export const FAULTS = [
  {
    id: 'posture', phase: 'setup', weight: 0.7,
    pick: (c) => ['posture_address', 'hands_under_shoulders', 'waist_bend', 'back_line', 'hand_gap'].includes(c.id),
  },
  { id: 'steep_backswing', phase: 'backswing', weight: 0.8, pick: (c) => isDir(c, ['hands_between_planes', 'butt_extension'], 'steep') },
  { id: 'flat_backswing', phase: 'backswing', weight: 0.8, pick: (c) => isDir(c, ['hands_between_planes', 'butt_extension'], 'flat') },
  { id: 'top_position', phase: 'backswing', weight: 0.8, pick: (c) => c.id === 'hands_over_heels' || c.id === 'lead_arm_shoulder_plane' },
  { id: 'tempo_fast', phase: 'transition', weight: 0.6, pick: (c) => isDir(c, ['tempo'], 'fast') },
  { id: 'tempo_slow', phase: 'transition', weight: 0.6, pick: (c) => isDir(c, ['tempo'], 'slow') },
  { id: 'over_the_top', phase: 'transition', weight: 0.95, pick: (c) => c.id === 'downswing_path' || isDir(c, ['clubhead_vs_plane'], 'steep') },
  { id: 'early_extension', phase: 'impact', weight: 1.0, pick: (c) => c.cluster === 'early_extension' },
  { id: 'head_sway', phase: 'impact', weight: 0.7, pick: (c) => c.id === 'head_drift' },
  { id: 'balance', phase: 'finish', weight: 0.5, pick: (c) => c.id === 'finish_balance' },
];

const round2 = (v) => Math.round(v * 100) / 100;

/** Every significant fault with its score, in FAULTS order. */
export function significantFaults(checks) {
  const out = [];
  FAULTS.forEach((f) => {
    const ev = checks.filter((c) => (c.status === 'red' || c.status === 'yellow') && f.pick(c));
    if (!ev.length) return;
    if (ev.length < 2 && ev[0].status !== 'red') return;
    const sum = ev.reduce((s, c) => s + (c.status === 'red' ? 1 : 0.5), 0);
    out.push({ fault: f, evidence: ev, score: f.weight * sum * (1 + 0.25 * (ev.length - 1)) });
  });
  return out;
}

/**
 * @param {object[]} checks  rows from runChecks
 * @returns {{fault: string, label: string, phase: string, score: number, evidence: object[],
 *   drills: string[], consequences: string[]} | null}
 */
export function mainFault(checks) {
  const sig = significantFaults(checks);
  if (!sig.length) return null;
  const rank = (x) => PHASES.indexOf(x.fault.phase);
  const best = sig.reduce((b, x) => (rank(x) < rank(b) || (rank(x) === rank(b) && x.score > b.score + 1e-9) ? x : b));
  return {
    fault: best.fault.id,
    label: T.fault[best.fault.id],
    phase: best.fault.phase,
    score: round2(best.score),
    evidence: best.evidence,
    drills: drillsForFault(best.fault.id).map((d) => d.id),
    consequences: sig.filter((x) => rank(x) > rank(best)).map((x) => x.fault.id),
  };
}
