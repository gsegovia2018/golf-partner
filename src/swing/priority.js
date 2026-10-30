// The one main fault (swing checks v2, spec §6): importance first, then how bad.
//
// Every measured row names its fault (checks.js). A position's status is its worst measured row;
// extras never colour a position. The main fault is the red row of the most important tier
// (1 = address, downswing, impact; 2 = halfway back, top; 3 = takeaway, follow-through, extras),
// the most severe within the tier (how far past its yellow limit, in yellow bands); with no red
// row the same over the yellow rows; with neither there is no main fault. An earlier position
// with a red row is where the fault likely starts (`startsAt`); the red positions after it are
// what it is likely also causing (`consequences`, as fault ids). This replaces D21's earliest
// fault first: one noisy early reading no longer decides the swing.

import { drillsForMain } from './drills';
import { SWING_STRINGS as T } from './strings';
import { POSITIONS, TIER, EXTRA_TIER } from './checkpointChecks';

/** Every fault id a row can name (each has a label, copy and drills). */
export const FAULTS = [
  'posture', 'posture_loss', 'steep_backswing', 'flat_backswing', 'top_position', 'over_the_top', 'stuck',
  'early_extension', 'flip', 'head_sway', 'tempo_fast', 'tempo_slow', 'balance',
];

const RANK = { red: 0, yellow: 1 };
export const tierOf = (row) => (row.extra ? EXTRA_TIER : TIER[row.position] ?? EXTRA_TIER);
const orderOf = (row) => (row.extra ? POSITIONS.length : POSITIONS.indexOf(row.position));

/**
 * The red and yellow rows that name a fault, most important first: red before yellow, then tier,
 * then severity (highest first), then swing order; a full tie keeps the analysis order.
 */
export function rankedRows(checks) {
  return checks
    .map((c, n) => ({ c, n }))
    .filter(({ c }) => c.status in RANK && c.fault)
    .sort((a, b) => RANK[a.c.status] - RANK[b.c.status]
      || tierOf(a.c) - tierOf(b.c)
      || (b.c.severity ?? 0) - (a.c.severity ?? 0)
      || orderOf(a.c) - orderOf(b.c)
      || a.n - b.n)
    .map(({ c }) => c);
}

/** { address: 'red' | 'yellow' | 'green' | 'unknown', ... } over the seven positions (extras excluded). */
export function positionStatuses(checks) {
  return Object.fromEntries(POSITIONS.map((k) => {
    const at = checks.filter((c) => !c.extra && c.position === k && c.status !== 'unknown');
    const s = !at.length ? 'unknown'
      : at.some((c) => c.status === 'red') ? 'red' : at.some((c) => c.status === 'yellow') ? 'yellow' : 'green';
    return [k, s];
  }));
}

/**
 * @param {object[]} checks  rows from runChecks
 * @returns {{fault: string, label: string, position: string|null, phase: string, tier: number,
 *   severity: number, startsAt: string|null, evidence: object[], consequences: string[], drills: string[]} | null}
 *   `position` is null for an extra; `phase` repeats the position ('extras' for an extra) for older readers.
 */
export function mainFault(checks) {
  const ranked = rankedRows(checks);
  if (!ranked.length) return null;
  const top = ranked[0];
  const status = positionStatuses(checks);
  const position = top.extra ? null : top.position;
  const idx = orderOf(top);
  const worstRed = (k) => rankedRows(checks.filter((c) => !c.extra && c.position === k && c.status === 'red'))[0];
  const evidence = ranked.filter((c) => c.fault === top.fault);
  return {
    fault: top.fault,
    label: T.fault[top.fault],
    position,
    phase: position ?? 'extras',
    tier: tierOf(top),
    severity: top.severity ?? 0,
    startsAt: POSITIONS.slice(0, idx).find((k) => status[k] === 'red') ?? null,
    evidence,
    drills: drillsForMain({ fault: top.fault, evidence }).map((d) => d.id),
    consequences: [...new Set(POSITIONS.slice(idx + 1)
      .filter((k) => status[k] === 'red')
      .map((k) => worstRed(k)?.fault)
      .filter((f) => f && f !== top.fault))],
  };
}
