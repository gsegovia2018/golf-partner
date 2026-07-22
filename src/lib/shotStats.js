// Pure shot-math: turn a flat list of logged shots into per-club carry
// averages, and pick the club for a given distance. No I/O — shotStore.js
// loads the shots, this crunches them. All distances in metres.
import { haversineMeters } from './geo';
import { CLUB_CATALOG, clubLabel, clubNominal, clubOrder, sanitizeBag } from './clubs';

// A shot: { roundId, roundIndex, holeNumber, seq, lat, lng, club, holed }.
// Spots are ball positions in order; the FIRST spot is the origin (the tee),
// carrying no club. Each later spot's `club` is the club that got the ball
// THERE, so its carry is the straight-line distance from the PREVIOUS spot.
function holeKey(s) { return `${s.roundId}|${s.roundIndex}|${s.holeNumber}`; }

// -> Map<club, number[]> of carries (metres) attributed to the club hit.
export function carriesByClub(shots) {
  const byHole = new Map();
  for (const s of shots) {
    if (!Number.isFinite(s?.lat) || !Number.isFinite(s?.lng)) continue;
    const k = holeKey(s);
    if (!byHole.has(k)) byHole.set(k, []);
    byHole.get(k).push(s);
  }
  const out = new Map();
  for (const holeShots of byHole.values()) {
    holeShots.sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < holeShots.length; i += 1) {
      const prev = holeShots[i - 1];
      const cur = holeShots[i];
      if (!cur.club) continue; // spot not yet tagged with the club that reached it
      const d = haversineMeters([prev.lat, prev.lng], [cur.lat, cur.lng]);
      if (!Number.isFinite(d) || d <= 0) continue;
      if (!out.has(cur.club)) out.set(cur.club, []);
      out.get(cur.club).push(d);
    }
  }
  return out;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Per-club summary rows, longest-club first (catalog order). One row per club
// that has at least one measured carry: { club, label, count, avg, min, max }.
export function clubDistances(shots) {
  const rows = [];
  for (const [club, carries] of carriesByClub(shots)) {
    if (!carries.length) continue;
    rows.push({
      club,
      label: clubLabel(club),
      count: carries.length,
      avg: avg(carries),
      min: Math.min(...carries),
      max: Math.max(...carries),
    });
  }
  return rows.sort((a, b) => clubOrder(a.club) - clubOrder(b.club));
}

// Map<club, avgMetres> for quick lookup (personal data only).
export function clubAverages(shots) {
  const m = new Map();
  for (const r of clubDistances(shots)) m.set(r.club, r.avg);
  return m;
}

// Recommend the club for `targetMeters`, restricted to `bag`. Prefers a club
// with real logged data whose average is closest to the target; if no bagged
// club has data yet, falls back to the closest nominal carry. Returns
// { club, label, distance, source: 'personal' | 'nominal', delta } or null
// (no target, or an empty bag). `delta` is signed target − club distance:
// positive means the club is a touch short, negative means a touch long.
export function recommendClub(targetMeters, bag, shots = []) {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;
  const clubs = sanitizeBag(bag).filter((k) => k !== 'putter');
  if (!clubs.length) return null;
  const averages = clubAverages(shots);

  const pick = (distFor, source) => {
    let best = null;
    for (const club of clubs) {
      const d = distFor(club);
      if (!Number.isFinite(d) || d <= 0) continue;
      const gap = Math.abs(targetMeters - d);
      if (!best || gap < best.gap) best = { club, distance: d, gap };
    }
    return best && { club: best.club, label: clubLabel(best.club), distance: best.distance, source, delta: targetMeters - best.distance };
  };

  return pick((c) => averages.get(c), 'personal')
    ?? pick((c) => clubNominal(c), 'nominal');
}

// Re-exported so callers can render a full-bag reference table (nominal for
// clubs not yet measured) without importing both modules.
export { CLUB_CATALOG };
