// Pure per-mode scoring for the scorecard. Wraps the scoring engines in
// store/tournamentStore.js so components never branch on mode themselves.
import {
  calcStablefordPoints,
  matchPlayHolePts,
  sindicatoHolePoints,
} from '../../store/tournamentStore';

// Points for every player on one hole. Returns { [playerId]: number|null };
// null means the player has not scored the hole yet.
export function holePoints({ mode, hole, players, scores, handicaps }) {
  const result = {};
  for (const p of players) {
    const str = scores?.[p.id]?.[hole.number];
    if (str == null) { result[p.id] = null; continue; }
    if (mode === 'matchplay') {
      result[p.id] = matchPlayHolePts(hole, p.id, players, scores, handicaps);
    } else if (mode === 'sindicato') {
      result[p.id] = sindicatoHolePoints(hole, players, scores, handicaps)?.[p.id] ?? null;
    } else {
      const hcp = handicaps?.[p.id] ?? p.handicap ?? 0;
      result[p.id] = calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
    }
  }
  return result;
}

// Per-player round totals. Returns Map<playerId, { pts, str, parPlayed }>.
export function roundTotals({ mode, round, players, scores, handicaps }) {
  const map = new Map();
  const holes = round?.holes ?? [];
  for (const p of players) {
    let pts = 0;
    let str = 0;
    let parPlayed = 0;
    for (const hole of holes) {
      const sc = scores?.[p.id]?.[hole.number];
      if (sc == null) continue;
      str += sc;
      parPlayed += hole.par;
      const hp = holePoints({ mode, hole, players, scores, handicaps });
      pts += hp[p.id] ?? 0;
    }
    map.set(p.id, { pts, str, parPlayed });
  }
  return map;
}
