// ============================================================================
// WHS Handicap Index math (pure, no IO).
// ============================================================================
//
// Computes World Handicap System (2020) score differentials and the Handicap
// Index from the user's MyRound records (see personalStats.collectMyRounds).
// PCC (playing conditions), soft/hard caps and exceptional-score reduction
// are intentionally out of scope — the app has no data for them.

import {
  getPlayingHandicap, calcExtraShots, resolveRoundTee, STANDARD_SLOPE,
} from './scoring';

const round1 = (n) => Math.round(n * 10) / 10;

// Why a round doesn't qualify for a differential. Check order matters: an
// unfinished short round reads as 'partial' (the actionable problem), only a
// finished non-18-hole round reads as 'nine-holes'.
export function roundEligibility(myRound) {
  if (!myRound?.isComplete) return { eligible: false, reason: 'partial' };
  const holes = myRound.round?.holes ?? [];
  if (holes.length !== 18) return { eligible: false, reason: 'nine-holes' };
  const { slope, rating } = resolveRoundTee(myRound.round, myRound.playerId);
  const sv = parseInt(slope, 10) || 0;
  const cr = parseFloat(rating);
  if (sv <= 0 || !Number.isFinite(cr)) return { eligible: false, reason: 'no-rating' };
  return { eligible: true };
}

// WHS score differential for one MyRound, or null when the round doesn't
// qualify: must be a complete 18-hole round with a numeric slope > 0 and a
// numeric course rating (from the player's tee snapshot, with round-level
// legacy fallback). Gross scores are capped per hole at net double bogey
// (par + 2 + extra shots) before the differential is computed.
export function roundDifferential(myRound) {
  if (!myRound?.isComplete) return null;
  const { round, player, playerId } = myRound;
  const holes = round?.holes ?? [];
  if (holes.length !== 18) return null;
  const { slope, rating } = resolveRoundTee(round, playerId);
  const sv = parseInt(slope, 10) || 0;
  const cr = parseFloat(rating);
  if (sv <= 0 || !Number.isFinite(cr)) return null;
  const scores = round?.scores?.[playerId] ?? {};
  const playingHandicap = getPlayingHandicap(round, player);
  let ags = 0;
  for (const h of holes) {
    const gross = scores[h.number];
    if (gross == null) return null;
    const cap = h.par + 2 + calcExtraShots(playingHandicap, h.strokeIndex);
    ags += Math.min(gross, cap);
  }
  return {
    key: myRound.key,
    differential: round1((STANDARD_SLOPE / sv) * (ags - cr)),
    ags,
    slope: sv,
    rating: cr,
    courseName: myRound.courseName,
    date: myRound.tournamentDate ?? null,
  };
}

// WHS "number of differentials → how many count + adjustment" table (2020).
function whsCounting(n) {
  if (n <= 3) return { use: 1, adj: -2 };
  if (n === 4) return { use: 1, adj: -1 };
  if (n === 5) return { use: 1, adj: 0 };
  if (n === 6) return { use: 2, adj: -1 };
  if (n <= 8) return { use: 2, adj: 0 };
  if (n <= 11) return { use: 3, adj: 0 };
  if (n <= 14) return { use: 4, adj: 0 };
  if (n <= 16) return { use: 5, adj: 0 };
  if (n <= 18) return { use: 6, adj: 0 };
  if (n === 19) return { use: 7, adj: 0 };
  return { use: 8, adj: 0 };
}

export const MIN_DIFFERENTIALS = 3;
export const MAX_INDEX = 54;

// Window + WHS table over an already-filtered chronological differential
// list. Shared by computeHandicapIndex and handicapIndexSeries.
function indexFromDifferentials(diffs) {
  const window = diffs.slice(-20);
  if (window.length < MIN_DIFFERENTIALS) {
    return { index: null, usedCount: 0, windowCount: window.length, countingKeys: new Set(), window };
  }
  const { use, adj } = whsCounting(window.length);
  const sorted = [...window].sort((a, b) => a.differential - b.differential);
  const countingKeys = new Set(sorted.slice(0, use).map((d) => d.key));
  const avg = sorted.slice(0, use).reduce((s, d) => s + d.differential, 0) / use;
  return {
    index: Math.min(MAX_INDEX, round1(avg + adj)),
    usedCount: use,
    windowCount: window.length,
    countingKeys,
    window,
  };
}

// Handicap Index from ALL of the user's rounds (chronological). Uses the
// last 20 eligible differentials — deliberately independent of the My Stats
// round selector, because WHS always uses the most recent scores.
// `excludedKeys` (Set of MyRound keys) removes rounds BEFORE windowing, as
// if they were never played; excluded eligible rounds are returned in
// `excluded` so the UI can offer re-inclusion, and non-qualifying rounds in
// `ineligible` with the reason.
export function computeHandicapIndex(myRounds, { excludedKeys } = {}) {
  const rounds = myRounds ?? [];
  const included = [];
  const excluded = [];
  const ineligible = [];
  rounds.forEach((r) => {
    const d = roundDifferential(r);
    if (!d) {
      const { reason } = roundEligibility(r);
      ineligible.push({
        key: r?.key,
        courseName: r?.courseName,
        date: r?.tournamentDate ?? null,
        reason,
        holesPlayed: r?.holesPlayed ?? 0,
      });
      return;
    }
    if (excludedKeys?.has(d.key)) excluded.push(d);
    else included.push(d);
  });
  const { index, usedCount, windowCount, countingKeys, window } = indexFromDifferentials(included);
  return {
    index,
    usedCount,
    windowCount,
    eligibleCount: included.length + excluded.length,
    totalCount: rounds.length,
    excludedCount: excluded.length,
    differentials: window.map((d) => ({ ...d, counting: countingKeys.has(d.key) })),
    excluded,
    ineligible,
  };
}

// Index after hypothetically posting one more differential `d` on top of the
// current included list. `d` is passed in tenths to keep the search grid exact.
function simulateNext(included, tenths) {
  return indexFromDifferentials(
    [...included, { key: '__next__', differential: tenths / 10 }],
  ).index;
}

// The simulated index is monotone non-decreasing in the posted differential,
// so both thresholds are binary searches over the 0.1 grid in [-10.0, 60.0].
const GRID_LO = -100;
const GRID_HI = 600;

// Largest differential (to 0.1) whose simulated index lands BELOW `target`,
// or null when even a -10.0 day can't get there.
function largestDiffBelow(included, target) {
  if (simulateNext(included, GRID_LO) >= target) return null;
  let lo = GRID_LO;
  let hi = GRID_HI;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (simulateNext(included, mid) < target) lo = mid; else hi = mid - 1;
  }
  return lo / 10;
}

// Smallest differential (to 0.1) whose simulated index lands ABOVE `target`,
// or null when no round can push it there.
function smallestDiffAbove(included, target) {
  if (simulateNext(included, GRID_HI) <= target) return null;
  let lo = GRID_LO;
  let hi = GRID_HI;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (simulateNext(included, mid) > target) hi = mid; else lo = mid + 1;
  }
  return lo / 10;
}

// What the next qualifying round can do to the index — every number is an
// exact simulation of the WHS window (eviction, counting table and
// small-sample adjustments included, so it is honest even at 3-5 rounds
// where a good round can still raise the index).
//   dropThreshold    beat this differential and the index drops
//   dropGross/Course the same target as adjusted gross strokes at the most
//                    played course in the window (null without course data)
//   low/lowDate      personal-low index over the whole walk (first time set)
//   newLowThreshold  differential that would set a new personal low
//   newLowIndex      the index that round would produce
//   newLowReachable  true when the target is no harder than the best
//                    differential already in the window
//   canRise/riseAt   whether (and from which differential) a bad round
//                    raises the index; worstCase is the ceiling
//   leaving          the differential aging out of a full window (+ whether
//                    it currently counts) — null while under 20 rounds
export function nextRoundOutlook(myRounds, { excludedKeys } = {}) {
  const included = (myRounds ?? [])
    .map(roundDifferential)
    .filter(Boolean)
    .filter((d) => !excludedKeys?.has(d.key));
  const { index, window, countingKeys } = indexFromDifferentials(included);
  if (index == null) return null;

  let low = Infinity;
  let lowDate = null;
  for (let i = MIN_DIFFERENTIALS - 1; i < included.length; i += 1) {
    const v = indexFromDifferentials(included.slice(0, i + 1)).index;
    if (v < low) { low = v; lowDate = included[i].date; }
  }

  const dropThreshold = largestDiffBelow(included, index);
  let dropGross = null;
  let dropCourse = null;
  if (dropThreshold != null) {
    const counts = new Map();
    window.forEach((d) => counts.set(d.courseName, (counts.get(d.courseName) ?? 0) + 1));
    let top = null;
    counts.forEach((n, name) => { if (name && (!top || n > top.n)) top = { name, n }; });
    const latest = top && [...window].reverse().find((d) => d.courseName === top.name);
    if (latest && latest.slope > 0 && Number.isFinite(latest.rating)) {
      dropGross = Math.floor(latest.rating + (dropThreshold * latest.slope) / STANDARD_SLOPE);
      dropCourse = top.name;
    }
  }

  let newLowThreshold = null;
  let newLowIndex = null;
  let newLowReachable = false;
  if (index > low) {
    newLowThreshold = largestDiffBelow(included, low);
    if (newLowThreshold != null) {
      newLowIndex = simulateNext(included, Math.round(newLowThreshold * 10));
      const bestInWindow = Math.min(...window.map((d) => d.differential));
      newLowReachable = newLowThreshold >= bestInWindow;
    }
  }

  const worstCase = simulateNext(included, GRID_HI);
  const canRise = worstCase > index;
  const riseAt = canRise ? smallestDiffAbove(included, index) : null;

  const leavingDiff = included.length >= 20 ? window[0] : null;
  const leaving = leavingDiff ? {
    differential: leavingDiff.differential,
    courseName: leavingDiff.courseName,
    counting: countingKeys.has(leavingDiff.key),
  } : null;

  return {
    index,
    low,
    lowDate,
    dropThreshold,
    dropGross,
    dropCourse,
    newLowThreshold,
    newLowIndex,
    newLowReachable,
    canRise,
    riseAt,
    worstCase,
    leaving,
  };
}

// Month-by-month view of an index walk (handicapIndexSeries output): one
// entry per calendar month from the first point to the last, carrying the
// index flat through months without a qualifying round (played: false) so
// idle stretches stay visible instead of being compressed away.
export function monthlyIndexSeries(seriesPoints) {
  const pts = (seriesPoints ?? []).filter((p) => p.value != null && p.date);
  if (pts.length === 0) return [];
  const ym = (iso) => String(iso).slice(0, 7);
  const lastInMonth = new Map(); // chronological input → last write wins
  pts.forEach((p) => lastInMonth.set(ym(p.date), p.value));
  const [y0, m0] = ym(pts[0].date).split('-').map(Number);
  const [y1, m1] = ym(pts[pts.length - 1].date).split('-').map(Number);
  if (!y0 || !m0 || !y1 || !m1) return [];
  const out = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m += 1) {
    if (m > 12) { m = 1; y += 1; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const played = lastInMonth.has(key);
    out.push({
      ym: key,
      value: played ? lastInMonth.get(key) : out[out.length - 1].value,
      played,
    });
  }
  return out;
}

// Evolution of the index over the full history: one point per included
// eligible round from the 3rd onward, each valued at the index as it stood
// after that round (the walk re-windows to the last 20 at every step, so
// old differentials age out exactly as they did in reality).
export function handicapIndexSeries(myRounds, { excludedKeys } = {}) {
  const included = (myRounds ?? [])
    .map(roundDifferential)
    .filter(Boolean)
    .filter((d) => !excludedKeys?.has(d.key));
  const points = [];
  for (let i = MIN_DIFFERENTIALS - 1; i < included.length; i += 1) {
    const { index } = indexFromDifferentials(included.slice(0, i + 1));
    points.push({
      key: included[i].key,
      value: index,
      date: included[i].date,
      courseName: included[i].courseName,
    });
  }
  return points;
}
