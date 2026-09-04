// Pure shot-math: turn a flat list of logged shots into per-club carry
// averages, and pick the club for a given distance. No I/O — shotStore.js
// loads the shots, this crunches them. All distances in metres.
import { haversineMeters } from './geo';
import { CLUB_CATALOG, clubLabel, clubNominal, clubOrder, sanitizeBag } from './clubs';

// A shot: { roundId, roundIndex, holeNumber, seq, lat, lng, club, holed }.
// Spots are ball positions in order; each spot's `club` is the club played
// FROM there, so its carry is the straight-line distance to the NEXT spot.
// The last spot on a hole is where the ball came to rest and earns no carry.
function holeKey(s) { return `${s.roundId}|${s.roundIndex}|${s.holeNumber}`; }

// -> flat list of measured carries, one per tagged spot that has a next spot:
// { club, meters, roundId, roundIndex, holeNumber, seq }. The straight-line
// distance to the next spot on the same hole, credited to the club played
// FROM this one. This is the shared primitive every aggregation below builds
// on. Encounter order of holes/rounds is preserved.
export function shotCarries(shots) {
  const byHole = new Map();
  for (const s of shots) {
    if (!Number.isFinite(s?.lat) || !Number.isFinite(s?.lng)) continue;
    const k = holeKey(s);
    if (!byHole.has(k)) byHole.set(k, []);
    byHole.get(k).push(s);
  }
  const out = [];
  for (const holeShots of byHole.values()) {
    holeShots.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < holeShots.length - 1; i += 1) {
      const cur = holeShots[i];
      const next = holeShots[i + 1];
      if (!cur.club) continue; // spot not yet tagged with the club played from it
      const d = haversineMeters([cur.lat, cur.lng], [next.lat, next.lng]);
      if (!Number.isFinite(d) || d <= 0) continue;
      out.push({
        club: cur.club,
        meters: d,
        roundId: cur.roundId,
        roundIndex: cur.roundIndex,
        holeNumber: cur.holeNumber,
        seq: cur.seq,
      });
    }
  }
  return out;
}

// -> Map<club, number[]> of carries (metres) attributed to the club hit.
export function carriesByClub(shots) {
  const out = new Map();
  for (const c of shotCarries(shots)) {
    if (!out.has(c.club)) out.set(c.club, []);
    out.get(c.club).push(c.meters);
  }
  return out;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

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

// How many good strikes define a club's playing distance, and how far from the
// median a carry may sit before it stops being a golf shot.
const BEST_N = 15;
const MAD_K = 2.5;
const MIN_FOR_OUTLIERS = 5;

// The distance a club actually plays: the mean of its best BEST_N carries,
// outliers thrown out first. A flat mean of every logged carry is dragged down
// by chunks, half-swings and punch-outs and up by a single runaway, so the club
// it recommends is one you cannot reproduce on demand. Two passes:
//   1. Drop freaks — a thinned skull that never stopped, a cart-path bounce —
//      by median absolute deviation. MAD is used rather than a standard
//      deviation because the outliers cannot inflate their own fence.
//   2. Average the longest BEST_N of what survives — the club at its best,
//      which is the number a golfer has in mind when they pull it.
// Under MIN_FOR_OUTLIERS carries there is no distribution to judge: average
// what there is. Returns null for an empty list.
export function typicalCarry(carries) {
  if (!carries?.length) return null;
  let pool = carries;
  if (pool.length >= MIN_FOR_OUTLIERS) {
    const med = median(pool);
    const mad = median(pool.map((m) => Math.abs(m - med)));
    if (mad > 0) {
      const fence = MAD_K * 1.4826 * mad; // 1.4826 puts MAD on a stdev scale
      const kept = pool.filter((m) => Math.abs(m - med) <= fence);
      if (kept.length) pool = kept;
    }
  }
  return avg([...pool].sort((a, b) => b - a).slice(0, BEST_N));
}

// Map<club, playingDistanceMetres> for quick lookup (personal data only) —
// what every club recommendation and the bag editor read.
export function clubAverages(shots) {
  const m = new Map();
  for (const [club, carries] of carriesByClub(shots)) {
    const d = typicalCarry(carries);
    if (Number.isFinite(d) && d > 0) m.set(club, d);
  }
  return m;
}

// Longest carry per hole number: Map<holeNumber, carry> where a carry is a
// shotCarries entry ({ club, meters, roundId, roundIndex, holeNumber, seq }) —
// enough to reopen the hole map on the exact round the shot was played.
// `roundKeys` (a Set of `${roundId}|${roundIndex}`) restricts the pool to
// specific rounds, so a per-course view never picks up another course's hole 4.
// `teeOnly` keeps only the first carry marked on each hole — the drive.
export function longestCarryByHole(shots, { roundKeys = null, teeOnly = false } = {}) {
  const key = (c) => `${c.roundId}|${c.roundIndex}`;
  const carries = shotCarries(shots)
    .filter((c) => !roundKeys || roundKeys.has(key(c)));

  const firstSeq = new Map(); // `round|hole` -> lowest seq that earned a carry
  if (teeOnly) {
    for (const c of carries) {
      const k = `${key(c)}|${c.holeNumber}`;
      const cur = firstSeq.get(k);
      if (cur == null || c.seq < cur) firstSeq.set(k, c.seq);
    }
  }

  const out = new Map();
  for (const c of carries) {
    if (teeOnly && firstSeq.get(`${key(c)}|${c.holeNumber}`) !== c.seq) continue;
    const best = out.get(c.holeNumber);
    if (!best || c.meters > best.meters) out.set(c.holeNumber, c);
  }
  return out;
}

// Recommend the club for `targetMeters`, restricted to `bag`. EVERY bagged club
// gets an effective distance so the pick is the club genuinely closest to the
// target — not merely the closest among clubs that happen to have logged data
// (which used to hand back your only-measured club for any distance). Priority
// per club: a manual `overrides` yardage, else the logged average, else the
// catalog nominal. `overrides` is an optional Map|object of club → metres.
// Returns { club, label, distance, source: 'manual'|'personal'|'nominal', delta }
// or null (no target, or an empty bag). `delta` is signed target − distance.
// `opts.excludeDriver` drops the driver from the candidates — the driver is a
// tee-only club, so it's never recommended for a shot from the fairway.
export function recommendClub(targetMeters, bag, shots = [], overrides = null, opts = {}) {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;
  let clubs = sanitizeBag(bag).filter((k) => k !== 'putter');
  if (opts.excludeDriver) clubs = clubs.filter((k) => k !== 'driver');
  if (!clubs.length) return null;
  const averages = clubAverages(shots);
  const overrideFor = (c) => {
    const v = overrides ? (overrides.get ? overrides.get(c) : overrides[c]) : null;
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  let best = null;
  for (const club of clubs) {
    const manual = overrideFor(club);
    const measured = averages.get(club);
    const hasMeasured = Number.isFinite(measured) && measured > 0;
    const d = manual ?? (hasMeasured ? measured : clubNominal(club));
    if (!Number.isFinite(d) || d <= 0) continue;
    const source = manual != null ? 'manual' : (hasMeasured ? 'personal' : 'nominal');
    const gap = Math.abs(targetMeters - d);
    if (!best || gap < best.gap) best = { club, distance: d, gap, source };
  }
  return best && {
    club: best.club, label: clubLabel(best.club), distance: best.distance,
    source: best.source, delta: targetMeters - best.distance,
  };
}

// Deep stats for ONE club, for the per-club detail screen. Returns null when
// the club has no measured carries. `std` is the carry standard deviation
// (consistency — smaller is tighter). `byRound` is the average carry per round
// in encounter order (for a trend sparkline); `recent` is the last `recentN`
// individual carries, newest last. `longest` is the single best carry with the
// round/hole it was struck on, so the screen can open that hole's map.
export function clubDetail(shots, club, recentN = 12) {
  const mine = shotCarries(shots).filter((c) => c.club === club);
  if (!mine.length) return null;
  const carries = mine.map((c) => c.meters);

  const roundOrder = [];
  const roundBuckets = new Map();
  for (const c of mine) {
    const rk = `${c.roundId}|${c.roundIndex}`;
    if (!roundBuckets.has(rk)) { roundBuckets.set(rk, []); roundOrder.push(rk); }
    roundBuckets.get(rk).push(c.meters);
  }
  const byRound = roundOrder.map((rk) => {
    const xs = roundBuckets.get(rk);
    return { key: rk, avg: avg(xs), count: xs.length };
  });

  return {
    club,
    label: clubLabel(club),
    nominal: clubNominal(club),
    count: carries.length,
    avg: avg(carries),
    std: stdev(carries),
    min: Math.min(...carries),
    max: Math.max(...carries),
    longest: mine.reduce((m, c) => (c.meters > m.meters ? c : m)),
    byRound,
    recent: carries.slice(-recentN),
  };
}

// Re-exported so callers can render a full-bag reference table (nominal for
// clubs not yet measured) without importing both modules.
export { CLUB_CATALOG };
