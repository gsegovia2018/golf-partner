// ============================================================================
// Pure scoring & handicap math.
// ============================================================================
//
// Extracted from tournamentStore.js so the leaderboard / Stableford / match-play
// math can be imported and unit-tested WITHOUT pulling in AsyncStorage, the
// Supabase client, or the sync layer. tournamentStore.js re-exports everything
// here for backwards compatibility, so existing `import { ... } from
// '../store/tournamentStore'` call sites keep working.
//
// Everything in this file is a pure function (no IO, no module state) except
// randomPairs, which is deliberately non-deterministic.
// ============================================================================

export const STANDARD_SLOPE = 113;

// Sum hole pars; used as the "Par" term in the WHS course-handicap formula.
export function totalParFromHoles(holes) {
  if (!Array.isArray(holes)) return 0;
  return holes.reduce((sum, h) => sum + (parseInt(h?.par, 10) || 0), 0);
}

// WHS course handicap: HI × (slope/113) + (CR − par), rounded.
// No slope → raw index (can't compute either term meaningfully).
// Missing CR or par → slope-only fallback.
export function calcPlayingHandicap(index, slope, rating, par) {
  const idx = parseInt(index, 10) || 0;
  const sv = parseInt(slope, 10) || 0;
  if (sv <= 0) return idx;
  const slopeAdj = idx * (sv / STANDARD_SLOPE);
  const cr = parseFloat(rating);
  const pv = parseInt(par, 10) || 0;
  const crAdj = (Number.isFinite(cr) && pv > 0) ? (cr - pv) : 0;
  return Math.round(slopeAdj + crAdj);
}

// Convenience: derive a player's auto playing handicap for a given round.
export function deriveRoundPlayingHandicap(handicap, round) {
  return calcPlayingHandicap(
    handicap,
    round?.slope,
    round?.courseRating,
    totalParFromHoles(round?.holes),
  );
}

// Ensure every current player has an entry in round.playerHandicaps. Missing
// entries are backfilled from the player's base index applied to round.slope.
// For legacy rounds lacking manualHandicaps, infer manual overrides by
// comparing stored value to the slope-derived value.
export function normalizeRoundHandicaps(round, players) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manualHandicaps = { ...(round.manualHandicaps ?? {}) };
  const hasLegacyFlags = round.manualHandicaps != null;
  players.forEach((p) => {
    const auto = deriveRoundPlayingHandicap(p.handicap, round);
    const current = playerHandicaps[p.id];
    if (current == null) {
      playerHandicaps[p.id] = auto;
    } else if (!hasLegacyFlags && round.slope && Number(current) !== auto) {
      manualHandicaps[p.id] = true;
    }
  });
  return { ...round, playerHandicaps, manualHandicaps };
}

// Read the playing handicap for a player in a round. Falls back to deriving
// from the player's base index × round slope when the round has no stored
// entry (e.g. legacy data).
export function getPlayingHandicap(round, player) {
  const stored = round.playerHandicaps?.[player.id];
  if (stored != null) return Number(stored);
  return deriveRoundPlayingHandicap(player.handicap, round);
}

// Recompute playerHandicaps for non-manual entries when base index or slope
// changes. Preserves manual overrides.
export function recomputeRoundPlayingHandicaps(round, players) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manual = round.manualHandicaps ?? {};
  players.forEach((p) => {
    if (manual[p.id]) return;
    playerHandicaps[p.id] = deriveRoundPlayingHandicap(p.handicap, round);
  });
  return { ...round, playerHandicaps };
}

// Strokes received on a hole: floor(handicap/18) on every hole, plus one more
// on holes whose stroke index is within the handicap's remainder.
export function calcExtraShots(playerHandicap, holeStrokeIndex) {
  const base = Math.floor(playerHandicap / 18);
  const remainder = playerHandicap % 18;
  return base + (holeStrokeIndex <= remainder ? 1 : 0);
}

// Stableford points = 2 + par − net strokes (handicap-adjusted), floored at 0.
export function calcStablefordPoints(par, strokes, playerHandicap, holeStrokeIndex) {
  if (!strokes || strokes <= 0) return 0;
  const extra = calcExtraShots(playerHandicap, holeStrokeIndex);
  const points = 2 + par - strokes + extra;
  return Math.max(0, points);
}

// Match Play: 2 players, per-hole 1-vs-1. Returns 1 if `playerId` won the hole
// (lower net strokes), 0 if they lost OR halved, null if either side hasn't
// scored yet. Caller can derive halved holes by checking that both sides
// returned 0 for the same hole.
export function matchPlayHolePts(hole, playerId, players, scores, playerHandicapsByPlayerId) {
  if (!players || players.length !== 2) return null;
  const [a, b] = players;
  const strA = scores?.[a.id]?.[hole.number];
  const strB = scores?.[b.id]?.[hole.number];
  if (strA == null || strB == null) return null;
  const hA = playerHandicapsByPlayerId?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicapsByPlayerId?.[b.id] ?? b.handicap ?? 0;
  const netA = strA - calcExtraShots(hA, hole.strokeIndex);
  const netB = strB - calcExtraShots(hB, hole.strokeIndex);
  if (netA === netB) return 0;
  const winnerId = netA < netB ? a.id : b.id;
  return playerId === winnerId ? 1 : 0;
}

// Match Play round tally: holes won by each player + halved count + status.
// Status is one of "A up 2", "All square", or "A wins 3&2" (clinched).
export function matchPlayRoundTally(round, players) {
  if (!players || players.length !== 2) return null;
  const [a, b] = players;
  const scores = round?.scores ?? {};
  const playerHandicaps = round?.playerHandicaps ?? {};
  const holes = round?.holes ?? [];
  let aWins = 0;
  let bWins = 0;
  let halved = 0;
  let played = 0;
  for (const hole of holes) {
    const pts = matchPlayHolePts(hole, a.id, players, scores, playerHandicaps);
    if (pts == null) continue;
    played++;
    if (pts === 1) aWins++;
    else {
      // a didn't win — either b did or it was halved
      const bPts = matchPlayHolePts(hole, b.id, players, scores, playerHandicaps);
      if (bPts === 1) bWins++;
      else halved++;
    }
  }
  const holesLeft = holes.length - played;
  const lead = Math.abs(aWins - bWins);
  const leaderIdx = aWins > bWins ? 0 : bWins > aWins ? 1 : null;
  const clinched = leaderIdx !== null && lead > holesLeft;
  return { aWins, bWins, halved, played, holesLeft, lead, leaderIdx, clinched };
}

// Lowest stroke count that still yields 0 Stableford points on this hole for
// this player. Use as the recorded score when a player picks up the ball.
export function pickupStrokes(par, playerHandicap, holeStrokeIndex) {
  const extra = calcExtraShots(playerHandicap, holeStrokeIndex);
  return par + 2 + extra;
}

// Split players into pairs at random. Uses an unbiased Fisher-Yates shuffle
// (the old `sort(() => Math.random() - 0.5)` produced a skewed distribution).
export function randomPairs(players) {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const pairs = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const pair = [shuffled[i], shuffled[i + 1]].filter(Boolean);
    if (pair.length > 0) pairs.push(pair);
  }
  return pairs;
}

// A round counts toward tournament totals once it's been reached (its index is
// at or before the tournament's currentRound) and has a scores object.
export function isRoundPlayed(round, index, tournament) {
  if (index > (tournament.currentRound ?? 0)) return false;
  return !!round.scores;
}
