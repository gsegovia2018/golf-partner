import { scoreCellState } from './officialScoring';

// One resolved stroke value per (subject, hole): the agreed number, or the
// single entered side. Holes still in discrepancy (or empty) are omitted.
function resolvedByPlayer(scores) {
  const byKey = new Map(); // `${subject}|${hole}` -> { self, marker }
  for (const s of scores) {
    const k = `${s.subject_roster_id}|${s.hole}`;
    const e = byKey.get(k) || {};
    e[s.source] = s.strokes;
    byKey.set(k, e);
  }
  const out = new Map(); // subject -> Map(hole -> strokes)
  for (const [k, e] of byKey) {
    const [subject, hole] = k.split('|');
    const state = scoreCellState(e.self, e.marker);
    if (state === 'discrepancy' || state === 'empty') continue;
    const strokes = e.self ?? e.marker;
    if (!out.has(subject)) out.set(subject, new Map());
    out.get(subject).set(Number(hole), strokes);
  }
  return out;
}

// Reduce the flat score rows to ranked leaderboard rows. Core ranks on gross
// strokes; net / Stableford columns are a follow-on.
// `format` is reserved for net / Stableford ranking (a follow-on); Core
// ranks on gross strokes only.
export function buildLeaderboard({ members, scores, format }) {
  const resolved = resolvedByPlayer(scores);
  const rows = members.map((m) => {
    const holesMap = resolved.get(m.roster_id) || new Map();
    const gross = [...holesMap.values()].reduce((s, v) => s + v, 0);
    return {
      rosterId: m.roster_id,
      name: m.display_name,
      handicap: m.handicap,
      thru: holesMap.size,
      gross,
    };
  });
  // Players with no resolved holes yet rank last (a gross of 0 must not
  // float an un-started player to the top). Otherwise gross ascending,
  // with rosterId as a stable tiebreak so equal-gross rows don't jitter
  // between refreshes.
  rows.sort((a, b) => {
    if ((a.thru === 0) !== (b.thru === 0)) return a.thru === 0 ? 1 : -1;
    return a.gross - b.gross || a.rosterId.localeCompare(b.rosterId);
  });
  return rows;
}
