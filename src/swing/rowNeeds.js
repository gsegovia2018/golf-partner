// What a row that cannot be read yet is still waiting for, so the results screen only asks the golfer
// for something that will actually let a row compute (phone test 2026-10: placing the Downswing clubhead
// changed nothing because the address plane had no ball). Pure.
//
// A need is { kind: 'clubhead', cp } (a clubhead the golfer has not decided and the checks would not
// read) or { kind: 'ball', cp: 'address' } (the ball, which the address plane and the shaft-line landing
// rows are measured from; it is only markable at address).

import { headTrusted } from './club';

/** Rows measured from the ball: the address plane (clubhead against it) and the shaft line carried to ball height. */
export const BALL_ROWS = [
  'clubhead_plane_takeaway', 'clubhead_plane_down', 'down_vs_takeaway',
  'butt_extension', 'shaft_through_ball', 'through_vs_halfway', 'swing_symmetry',
];

/** A clubhead the golfer has not decided and the checks would not read (below the gate, or none). */
export const clubheadOpen = (clubMarks, key) => {
  const m = clubMarks?.[key];
  return !!m && !m.hidden && (!m.head || !headTrusted(m.source, m.conf));
};

export const ballMissing = (analysis) => !analysis.reference?.ball;

/** The needs of one row: [] for a row that is measured, hidden by the golfer, or not waiting on a mark. */
export function rowNeeds(analysis, row) {
  if (row.status !== 'unknown') return [];
  const needs = [];
  if (row.reason === 'unplaced') {
    (row.cp ? [row.cp] : row.cps || []).forEach((k) => {
      if (clubheadOpen(analysis.clubMarks, k)) needs.push({ kind: 'clubhead', cp: k });
    });
  }
  if ((row.reason === 'unplaced' || row.reason === 'nodata') && BALL_ROWS.includes(row.id) && ballMissing(analysis)) {
    needs.push({ kind: 'ball', cp: 'address' });
  }
  return needs;
}

/** Placing this one clubhead lets the row compute (it waits for nothing else). */
export const unlockedBy = (analysis, row, cp) => {
  const n = rowNeeds(analysis, row);
  return n.length === 1 && n[0].kind === 'clubhead' && n[0].cp === cp;
};

/**
 * The one thing to ask the golfer for at a position, or null: a clubhead whose placement unlocks a row
 * there; else the ball (the address plane is missing, so no clubhead there helps yet); else a clubhead
 * another row there is waiting for.
 * @returns {{kind: 'clubhead'|'ball', cp: string}|null}
 */
export function askAt(analysis, step) {
  const rows = analysis.checks.filter((c) => !c.extra && c.position === step);
  if (rows.some((c) => unlockedBy(analysis, c, step))) return { kind: 'clubhead', cp: step };
  const needs = rows.flatMap((c) => rowNeeds(analysis, c));
  return needs.find((n) => n.kind === 'ball') ?? needs.find((n) => n.kind === 'clubhead') ?? null;
}
