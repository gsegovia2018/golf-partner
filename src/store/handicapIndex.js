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
