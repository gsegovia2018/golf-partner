import { scoreCellState, defaultOfficialHoles } from './officialScoring';
import { calcStablefordPoints, stablefordComparator } from './scoring';

// One resolved stroke value per (subject, hole), plus which holes are still
// stuck in an unresolved self/marker discrepancy.
//   - empty holes (neither side entered) are dropped entirely.
//   - a "waiting" hole (only one side entered) still counts — the entered
//     value is provisional but real.
//   - a "discrepancy" hole (both entered, disagreeing) is EXCLUDED from
//     strokes/points — until it's resolved it must not move the player's
//     rank in either direction — but its hole number is kept so the row can
//     flag the player as disputed.
function resolvedByPlayer(scores) {
  const byKey = new Map(); // `${subject}|${hole}` -> { self, marker }
  for (const s of scores) {
    const k = `${s.subject_roster_id}|${s.hole}`;
    const e = byKey.get(k) || {};
    e[s.source] = s.strokes;
    byKey.set(k, e);
  }
  const out = new Map(); // subject -> { holes: Map(hole -> strokes), discrepancyHoles: Set<hole> }
  const entryFor = (subject) => {
    if (!out.has(subject)) out.set(subject, { holes: new Map(), discrepancyHoles: new Set() });
    return out.get(subject);
  };
  for (const [k, e] of byKey) {
    const [subject, hole] = k.split('|');
    const state = scoreCellState(e.self, e.marker);
    if (state === 'empty') continue;
    if (state === 'discrepancy') {
      entryFor(subject).discrepancyHoles.add(Number(hole));
      continue;
    }
    const strokes = e.self ?? e.marker;
    entryFor(subject).holes.set(Number(hole), strokes);
  }
  return out;
}

// Net Stableford points for one player's resolved holes — the canonical
// handicap-aware math from scoring.js (calcStablefordPoints/calcExtraShots),
// never reimplemented here.
function netStablefordPoints(handicap, holesMap, holesByNumber) {
  let points = 0;
  for (const [holeNumber, strokes] of holesMap) {
    const hole = holesByNumber.get(holeNumber) ?? { par: 4, strokeIndex: holeNumber };
    points += calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex);
  }
  return points;
}

// Reduce the flat score rows to ranked leaderboard rows.
//
// Ranks by NET Stableford points (handicap-aware) — matching the casual
// side's board (per product decision: the official live leaderboard always
// ranks net Stableford, regardless of the round's configured scoring
// format). `format` selects the ranking method; today every format maps to
// net Stableford, but the switch below is the seam for a future
// format-specific ranking (e.g. match play). `gross` and `thru` stay on the
// row as plain columns for the UI.
//
// `holes` should be the round's real course holes ({ number, par,
// strokeIndex }[]); a flat par-4 fallback is used only if the caller
// doesn't have course data yet (e.g. round not hydrated).
export function buildLeaderboard({ members, scores, holes, format = 'net_stableford' }) {
  const holesByNumber = new Map(
    (holes && holes.length ? holes : defaultOfficialHoles()).map((h) => [h.number, h]),
  );
  const resolved = resolvedByPlayer(scores);

  const rows = members.map((m) => {
    const { holes: holesMap, discrepancyHoles } = resolved.get(m.roster_id)
      ?? { holes: new Map(), discrepancyHoles: new Set() };
    const gross = [...holesMap.values()].reduce((s, v) => s + v, 0);
    let points;
    switch (format) {
      case 'net_stableford':
      default:
        points = netStablefordPoints(m.handicap ?? 0, holesMap, holesByNumber);
    }
    return {
      rosterId: m.roster_id,
      name: m.display_name,
      handicap: m.handicap,
      thru: holesMap.size,
      gross,
      points,
      // Gross strokes over RESOLVED holes only — the tiebreak field
      // stablefordComparator expects, and what "fewer strokes" means here.
      strokes: gross,
      discrepancy: discrepancyHoles.size > 0,
    };
  });

  // Net Stableford, higher points first; ties broken by fewer strokes over
  // resolved holes (mirrors stablefordComparator), then rosterId as a stable
  // tiebreak so equal rows don't jitter between refreshes.
  // stablefordComparator already sorts a strokes<=0 row last on a points
  // tie, so a player with no resolved holes never floats above one who has
  // actually posted a (possibly poor) score.
  rows.sort((a, b) => stablefordComparator(a, b) || a.rosterId.localeCompare(b.rosterId));
  return rows;
}
