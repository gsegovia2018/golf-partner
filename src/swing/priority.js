// The one main fault (plan 5.5), ported from the swing lab's mainFault().
//
// A fault is a cluster of checks with a weight (impact-affecting first). score = weight x
// (red 1, yellow 0.5) summed over the cluster, x (1 + 0.25 x (agreeing signals - 1)).
// Ties go to the earliest fault in the causal chain (setup -> backswing -> transition ->
// impact -> finish), which is the order of FAULTS. across_the_line / laid_off
// (top_direction) are never main on their own. A fault needs a red check or two agreeing
// signals: a single yellow is a "watch", never the thing to work on.

import { drillsForFault } from './drills';
import { SWING_STRINGS as T } from './strings';

const isDir = (c, ids, dir) => ids.includes(c.id) && c.dir === dir;

export const FAULTS = [
  { id: 'posture', weight: 0.7, pick: (c) => c.id === 'posture_address' },
  { id: 'steep_backswing', weight: 0.8, pick: (c) => isDir(c, ['hands_between_planes', 'butt_extension'], 'steep') },
  { id: 'flat_backswing', weight: 0.8, pick: (c) => isDir(c, ['hands_between_planes', 'butt_extension'], 'flat') },
  { id: 'head_sway', weight: 0.7, pick: (c) => c.id === 'head_drift' },
  { id: 'tempo_fast', weight: 0.6, pick: (c) => isDir(c, ['tempo'], 'fast') },
  { id: 'tempo_slow', weight: 0.6, pick: (c) => isDir(c, ['tempo'], 'slow') },
  { id: 'over_the_top', weight: 0.95, pick: (c) => c.id === 'downswing_path' || isDir(c, ['clubhead_vs_plane'], 'steep') },
  { id: 'early_extension', weight: 1.0, pick: (c) => c.cluster === 'early_extension' },
  { id: 'balance', weight: 0.5, pick: (c) => c.id === 'finish_balance' },
];

/**
 * @param {object[]} checks  rows from runChecks
 * @returns {{fault: string, label: string, score: number, evidence: object[], drills: string[]} | null}
 */
export function mainFault(checks) {
  let best = null;
  FAULTS.forEach((f) => {
    const ev = checks.filter((c) => (c.status === 'red' || c.status === 'yellow') && f.pick(c));
    if (!ev.length) return;
    if (ev.length < 2 && ev[0].status !== 'red') return;
    const sum = ev.reduce((s, c) => s + (c.status === 'red' ? 1 : 0.5), 0);
    const score = f.weight * sum * (1 + 0.25 * (ev.length - 1));
    if (!best || score > best.score + 1e-9) {
      best = {
        fault: f.id,
        label: T.fault[f.id],
        score: Math.round(score * 100) / 100,
        evidence: ev,
        drills: drillsForFault(f.id).map((d) => d.id),
      };
    }
  });
  return best;
}
