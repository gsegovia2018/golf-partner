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

// Handicap Index from ALL of the user's rounds (chronological). Uses the
// last 20 eligible differentials — deliberately independent of the My Stats
// round selector, because WHS always uses the most recent scores.
export function computeHandicapIndex(myRounds) {
  const eligible = (myRounds ?? []).map(roundDifferential).filter(Boolean);
  const window = eligible.slice(-20);
  const base = {
    windowCount: window.length,
    eligibleCount: eligible.length,
    totalCount: (myRounds ?? []).length,
  };
  if (window.length < MIN_DIFFERENTIALS) {
    return {
      ...base,
      index: null,
      usedCount: 0,
      differentials: window.map((d) => ({ ...d, counting: false })),
    };
  }
  const { use, adj } = whsCounting(window.length);
  const sorted = [...window].sort((a, b) => a.differential - b.differential);
  const countingKeys = new Set(sorted.slice(0, use).map((d) => d.key));
  const avg = sorted.slice(0, use).reduce((s, d) => s + d.differential, 0) / use;
  return {
    ...base,
    index: Math.min(MAX_INDEX, round1(avg + adj)),
    usedCount: use,
    differentials: window.map((d) => ({ ...d, counting: countingKeys.has(d.key) })),
  };
}
