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

import { scoringModeUsesTeams, isScrambleMode } from '../components/scoringModes';

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
  const parsed = parseFloat(index);
  const idx = Number.isFinite(parsed) ? parsed : 0;
  const sv = parseInt(slope, 10) || 0;
  if (sv <= 0) return Math.round(idx) || 0; // No slope → round to integer course handicap (matches WHS).
  const slopeAdj = idx * (sv / STANDARD_SLOPE);
  const cr = parseFloat(rating);
  const pv = parseInt(par, 10) || 0;
  const crAdj = (Number.isFinite(cr) && pv > 0) ? (cr - pv) : 0;
  return Math.round(slopeAdj + crAdj) || 0;
}

// Resolve the slope + course rating a player plays off in a round. Prefers
// the player's per-player tee snapshot (round.playerTees); falls back to the
// round-level slope/courseRating for legacy rounds created before per-player
// tees existed.
export function resolveRoundTee(round, playerId) {
  const tee = round?.playerTees?.[playerId];
  if (tee) return { slope: tee.slope, rating: tee.rating };
  return { slope: round?.slope, rating: round?.courseRating };
}

// Convenience: derive a player's auto playing handicap for a given round,
// using that player's tee. `playerId` is optional — when omitted (e.g. legacy
// call sites, tests) it falls back to the round-level slope/rating.
export function deriveRoundPlayingHandicap(handicap, round, playerId) {
  const { slope, rating } = resolveRoundTee(round, playerId);
  return calcPlayingHandicap(
    handicap,
    slope,
    rating,
    totalParFromHoles(round?.holes),
  );
}

// Ensure every current player has an entry in round.playerHandicaps. Missing
// entries are backfilled from the player's base index applied to their tee
// (round.playerTees), or round.slope for legacy rounds. For legacy rounds
// lacking manualHandicaps, infer manual overrides by comparing the stored
// value to the slope-derived value.
export function normalizeRoundHandicaps(round, players) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manualHandicaps = { ...(round.manualHandicaps ?? {}) };
  const hasLegacyFlags = round.manualHandicaps != null;
  players.forEach((p) => {
    const auto = deriveRoundPlayingHandicap(p.handicap, round, p.id);
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
  return deriveRoundPlayingHandicap(player.handicap, round, player.id);
}

// Recompute playerHandicaps for non-manual entries when base index or slope
// changes. Preserves manual overrides.
export function recomputeRoundPlayingHandicaps(round, players) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manual = round.manualHandicaps ?? {};
  players.forEach((p) => {
    if (manual[p.id]) return;
    playerHandicaps[p.id] = deriveRoundPlayingHandicap(p.handicap, round, p.id);
  });
  return { ...round, playerHandicaps };
}

// Strokes received on a hole: floor(handicap/18) on every hole, plus one more
// on holes whose stroke index is within the handicap's remainder. Plus
// handicaps (negative) give strokes back starting from the easiest hole
// (highest stroke index) instead.
export function calcExtraShots(playerHandicap, holeStrokeIndex) {
  if (playerHandicap < 0) {
    const given = -playerHandicap;
    const base = Math.floor(given / 18);
    const remainder = given % 18;
    return (holeStrokeIndex > 18 - remainder ? -1 : 0) - base;
  }
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

// scores shape: { [playerId]: { [holeNumber]: strokes } }
export function roundTotals(round, players) {
  return players.map((player) => {
    const handicap = getPlayingHandicap(round, player);
    let totalPoints = 0;
    let totalStrokes = 0;
    round.holes.forEach((hole) => {
      const strokes = round.scores?.[player.id]?.[hole.number];
      if (strokes) {
        totalStrokes += strokes;
        totalPoints += calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex);
      }
    });
    return { player, handicap, totalPoints, totalStrokes };
  });
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

// ── Sindicato ───────────────────────────────────────────────────────────────
// 3-player per-hole points game. Each hole splits 6 points by net-stroke rank:
//   all three net-equal      → 2 / 2 / 2
//   two tied lowest, one up  → 3 / 3 / 0
//   one lowest, two tied up  → 4 / 1 / 1
//   three distinct           → 4 / 2 / 0
// Returns { [playerId]: points }, or null when there are not exactly 3 players
// or any of them has not scored the hole yet.
export function sindicatoHolePoints(hole, players, scores, playerHandicapsByPlayerId) {
  if (!players || players.length !== 3) return null;
  const nets = [];
  for (const p of players) {
    const strokes = scores?.[p.id]?.[hole.number];
    if (strokes == null) return null;
    const h = playerHandicapsByPlayerId?.[p.id] ?? p.handicap ?? 0;
    nets.push({ id: p.id, net: strokes - calcExtraShots(h, hole.strokeIndex) });
  }
  const [lo, mid, hi] = [...nets].sort((a, b) => a.net - b.net);
  if (lo.net === mid.net && mid.net === hi.net) {
    return { [lo.id]: 2, [mid.id]: 2, [hi.id]: 2 };
  }
  if (lo.net === mid.net) {
    return { [lo.id]: 3, [mid.id]: 3, [hi.id]: 0 };
  }
  if (mid.net === hi.net) {
    return { [lo.id]: 4, [mid.id]: 1, [hi.id]: 1 };
  }
  return { [lo.id]: 4, [mid.id]: 2, [hi.id]: 0 };
}

// Cumulative Sindicato points for one round. Returns null for the wrong player
// count. `totals` is sorted points-descending; `leaderIdx` is the index of the
// sole leader within `totals` (null when the top two are tied). A trailing
// player gains at most 4 per hole, so the leader has clinched the round when
// `lead > holesLeft × 4`.
export function sindicatoRoundTally(round, players) {
  if (!players || players.length !== 3) return null;
  const scores = round?.scores ?? {};
  const playerHandicaps = round?.playerHandicaps ?? {};
  const holes = round?.holes ?? [];
  const pointsById = Object.fromEntries(players.map((p) => [p.id, 0]));
  let played = 0;
  for (const hole of holes) {
    const hp = sindicatoHolePoints(hole, players, scores, playerHandicaps);
    if (!hp) continue;
    played++;
    for (const p of players) pointsById[p.id] += hp[p.id];
  }
  const totals = players
    .map((player) => ({ player, points: pointsById[player.id] }))
    .sort((a, b) => b.points - a.points);
  const holesLeft = holes.length - played;
  const lead = totals[0].points - totals[1].points;
  const leaderIdx = totals[0].points > totals[1].points ? 0 : null;
  const clinched = leaderIdx === 0 && lead > holesLeft * 4;
  return { totals, played, holesLeft, leaderIdx, lead, clinched };
}

// Lowest stroke count that still yields 0 Stableford points on this hole for
// this player. Use as the recorded score when a player picks up the ball.
export function pickupStrokes(par, playerHandicap, holeStrokeIndex) {
  const extra = calcExtraShots(playerHandicap, holeStrokeIndex);
  return par + 2 + extra;
}

// Fisher-Yates copy-shuffle shared by randomPairs and buildTeamsForMode.
export function shufflePlayers(players) {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Split players into pairs at random. Uses an unbiased Fisher-Yates shuffle
// (the old `sort(() => Math.random() - 0.5)` produced a skewed distribution).
export function randomPairs(players) {
  const shuffled = shufflePlayers(players);
  const pairs = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const pair = [shuffled[i], shuffled[i + 1]].filter(Boolean);
    if (pair.length > 0) pairs.push(pair);
  }
  return pairs;
}

// Team shapes per mode. 2x2 modes ride randomPairs; scramble3v1 splits a
// shuffled roster 3+1 (the solo player is random); scramble4 is one team.
// Invalid mode/roster combos degrade to singleton pairs, matching the
// existing non-team fallback everywhere pairs are built.
export function buildTeamsForMode(mode, players) {
  if (!scoringModeUsesTeams(mode, players.length)) {
    return players.map((p) => [p]);
  }
  if (mode === 'scramble4') return [shufflePlayers(players)];
  if (mode === 'scramble3v1') {
    const shuffled = shufflePlayers(players);
    return [shuffled.slice(0, 3), shuffled.slice(3)];
  }
  return randomPairs(players);
}

// ── Per-round scoring modes ─────────────────────────────────────────────────
// A round may override the tournament's default mode. This helper is the
// single source of truth for a round's effective mode — every round-scoped
// consumer reads it instead of settings.scoringMode.
export function roundScoringMode(tournament, round) {
  return round?.scoringMode ?? tournament?.settings?.scoringMode ?? 'stableford';
}

// True when the tournament's rounds do not all share one effective mode.
// Mixed tournaments rank by the Stableford total board.
export function tournamentHasMixedModes(tournament) {
  const rounds = tournament?.rounds ?? [];
  if (rounds.length < 2) return false;
  const first = roundScoringMode(tournament, rounds[0]);
  return rounds.some((r) => roundScoringMode(tournament, r) !== first);
}

// The team shape a mode's pairs take. fixedTeams reuses partnerships only
// across rounds whose modes share a shape.
export function teamShapeOf(mode) {
  if (mode === 'scramble4') return '1x4';
  if (mode === 'scramble3v1') return '3+1';
  if (mode === 'stableford' || mode === 'bestball'
    || mode === 'scramblepairs' || mode === 'pairsmatchplay') return '2x2';
  return 'solo';
}

// A round counts toward tournament totals once it's been reached (its index is
// at or before the tournament's currentRound) and has a scores object.
export function isRoundPlayed(round, index, tournament) {
  if (index > (tournament.currentRound ?? 0)) return false;
  return !!round.scores;
}

// Cumulative Sindicato standings across all played rounds. Returns
// [{ player, points, strokes }] sorted points-descending. `strokes` is the
// player's total gross strokes (kept shape-compatible with tournamentLeaderboard
// so leaderboard UI can render either without branching).
export function tournamentSindicatoLeaderboard(tournament) {
  const { players, rounds } = tournament;
  const pointsById = Object.fromEntries(players.map((p) => [p.id, 0]));
  const strokesById = Object.fromEntries(players.map((p) => [p.id, 0]));
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    if (roundScoringMode(tournament, round) !== 'sindicato') return;
    const tally = sindicatoRoundTally(round, players);
    if (!tally) return;
    tally.totals.forEach(({ player, points }) => {
      pointsById[player.id] += points;
    });
    players.forEach((p) => {
      const holeScores = round.scores?.[p.id] ?? {};
      for (const v of Object.values(holeScores)) strokesById[p.id] += (v || 0);
    });
  });
  return players
    .map((player) => ({
      player,
      points: pointsById[player.id],
      strokes: strokesById[player.id],
    }))
    .sort((a, b) => b.points - a.points);
}

// Player id who has clinched a Sindicato tournament, or null. Sums the holes
// still to play across the current round and every future round; a trailing
// player can gain at most 4 per hole, so the leader has clinched when their
// lead over second place exceeds holesRemaining × 4.
export function tournamentSindicatoClinched(tournament) {
  const { players, rounds } = tournament;
  if (!players || players.length !== 3) return null;
  const hasAnyScore = rounds.some((r) => r.scores && Object.keys(r.scores).length > 0);
  if (!hasAnyScore) return null;
  const lb = tournamentSindicatoLeaderboard(tournament);
  if (lb.length < 2) return null;
  let holesRemaining = 0;
  rounds.forEach((round, idx) => {
    const future = idx > (tournament.currentRound ?? 0);
    if (future) {
      holesRemaining += round.holes?.length ?? 0;
      return;
    }
    const tally = sindicatoRoundTally(round, players);
    holesRemaining += tally ? tally.holesLeft : (round.holes?.length ?? 0);
  });
  if (lb[0].points - lb[1].points > holesRemaining * 4) return lb[0].player.id;
  return null;
}

// ── Scramble ────────────────────────────────────────────────────────────────
// One ball per team, scored Stableford off a team handicap. The team score
// lives under the CAPTAIN (first member) in round.scores, so the sync layer
// is untouched. USGA Rules of Handicapping Appendix C allowances, low→high
// course handicap. A solo "team" (3v1's individual) plays 100%.

export const SCRAMBLE_ALLOWANCES = {
  1: [1],
  2: [0.35, 0.15],
  3: [0.20, 0.15, 0.10],
  4: [0.25, 0.20, 0.15, 0.10],
};

export function scrambleTeamHandicap(handicaps) {
  const weights = SCRAMBLE_ALLOWANCES[handicaps?.length];
  if (!weights) return 0;
  const sorted = [...handicaps].sort((a, b) => a - b);
  return Math.round(sorted.reduce((acc, h, i) => acc + h * weights[i], 0));
}

// { [captainId]: teamHandicap } from the round's frozen playerHandicaps.
export function scrambleTeamHandicaps(round, players) {
  const byId = Object.fromEntries((players ?? []).map((p) => [p.id, p]));
  const result = {};
  for (const team of round?.pairs ?? []) {
    const captain = team?.[0];
    if (!captain) continue;
    const handicaps = team.map((m) => (
      round?.playerHandicaps?.[m.id] ?? byId[m.id]?.handicap ?? m.handicap ?? 0
    ));
    result[captain.id] = scrambleTeamHandicap(handicaps);
  }
  return result;
}

// Synthetic "team players" for the scorecard: one entry per team, carrying
// the captain's id (where the team ball's scores live), a joined first-name
// label, and the team handicap. Members kept for chips/labels.
export function scrambleUnits(round, players) {
  const teamHcps = scrambleTeamHandicaps(round, players);
  const byId = Object.fromEntries((players ?? []).map((p) => [p.id, p]));
  return (round?.pairs ?? [])
    .filter((team) => team?.length > 0)
    .map((team) => {
      const members = team.map((m) => byId[m.id] ?? m);
      const captain = members[0];
      return {
        id: captain.id,
        name: members.map((m) => m?.name?.split(' ')[0] ?? '—').join(' & '),
        handicap: teamHcps[captain.id] ?? 0,
        members,
      };
    });
}

// Round tally across teams. Clinch only applies to two-sided games
// (scramblepairs, scramble3v1): leader clinches when the trailing side
// cannot catch up even scoring 1 stroke on every remaining hole.
export function scrambleRoundTally(round, players) {
  const units = scrambleUnits(round, players);
  if (units.length === 0) return null;
  const holes = round?.holes ?? [];
  const scores = round?.scores ?? {};

  const rows = units.map((unit) => {
    let points = 0;
    let strokes = 0;
    let scored = 0;
    for (const hole of holes) {
      const str = scores?.[unit.id]?.[hole.number];
      if (str == null) continue;
      scored++;
      strokes += str;
      points += calcStablefordPoints(hole.par, str, unit.handicap, hole.strokeIndex);
    }
    let maxRemaining = 0;
    for (const hole of holes) {
      if (scores?.[unit.id]?.[hole.number] != null) continue;
      maxRemaining += calcStablefordPoints(hole.par, 1, unit.handicap, hole.strokeIndex);
    }
    return { unit, points, strokes, scored, maxRemaining };
  });

  const totals = [...rows].sort((a, b) => b.points - a.points);
  const played = Math.min(...rows.map((r) => r.scored));
  const holesLeft = holes.length - played;
  let leaderIdx = null;
  let lead = 0;
  let clinched = false;
  if (totals.length >= 2) {
    lead = totals[0].points - totals[1].points;
    leaderIdx = lead > 0 ? 0 : null;
    clinched = leaderIdx === 0 && totals[0].points > totals[1].points + totals[1].maxRemaining;
  }
  return { totals, played, holesLeft, leaderIdx, lead, clinched };
}

// ── Pairs Match Play ────────────────────────────────────────────────────────
// Two pairs; each player duels the same-index member of the other pair
// (within-pair order is random via randomPairs, so duel draw is random).
// Every fully-scored hole distributes exactly 2 points: 1 per duel to the
// net winner, ½ each on a halve. Nets use calcExtraShots by stroke index.

export function pairsMatchDuels(pairs) {
  if (!pairs || pairs.length !== 2) return null;
  const [t1, t2] = pairs;
  if (!Array.isArray(t1) || !Array.isArray(t2) || t1.length !== 2 || t2.length !== 2) return null;
  return [[t1[0], t2[0]], [t1[1], t2[1]]];
}

// 1 = first player wins, 2 = second, 0 = halved, null = not fully scored.
function duelNetWinner(hole, a, b, scores, playerHandicaps) {
  const strA = scores?.[a.id]?.[hole.number];
  const strB = scores?.[b.id]?.[hole.number];
  if (strA == null || strB == null) return null;
  const hA = playerHandicaps?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicaps?.[b.id] ?? b.handicap ?? 0;
  const netA = strA - calcExtraShots(hA, hole.strokeIndex);
  const netB = strB - calcExtraShots(hB, hole.strokeIndex);
  if (netA === netB) return 0;
  return netA < netB ? 1 : 2;
}

export function pairsMatchHolePts(hole, pairs, scores, playerHandicaps) {
  const duels = pairsMatchDuels(pairs);
  if (!duels) return null;
  let team1 = 0;
  let team2 = 0;
  let decidedDuels = 0;
  for (const [a, b] of duels) {
    const w = duelNetWinner(hole, a, b, scores, playerHandicaps);
    if (w == null) continue;
    decidedDuels++;
    if (w === 1) team1 += 1;
    else if (w === 2) team2 += 1;
    else { team1 += 0.5; team2 += 0.5; }
  }
  return { team1, team2, decidedDuels };
}

// The player's own duel result on one hole: 1 / 0.5 / 0, or null while the
// duel is not fully scored (mirrors matchPlayHolePts semantics).
export function pairsMatchDuelPts(hole, playerId, pairs, scores, playerHandicaps) {
  const duels = pairsMatchDuels(pairs);
  if (!duels) return null;
  const duel = duels.find(([a, b]) => a.id === playerId || b.id === playerId);
  if (!duel) return null;
  const [a, b] = duel;
  const w = duelNetWinner(hole, a, b, scores, playerHandicaps);
  if (w == null) return null;
  if (w === 0) return 0.5;
  const winnerId = w === 1 ? a.id : b.id;
  return playerId === winnerId ? 1 : 0;
}

export function pairsMatchRoundTally(round, _players) {
  const duels = pairsMatchDuels(round?.pairs);
  if (!duels) return null;
  const holes = round?.holes ?? [];
  const scores = round?.scores ?? {};
  const playerHandicaps = round?.playerHandicaps ?? {};

  let team1 = 0;
  let team2 = 0;
  const duelRows = duels.map(([a, b]) => ({ aId: a.id, bId: b.id, aPts: 0, bPts: 0 }));
  let team1Remaining = 0;
  let team2Remaining = 0;
  let fullyPlayed = 0;

  for (const hole of holes) {
    let decided = 0;
    duels.forEach(([a, b], i) => {
      const w = duelNetWinner(hole, a, b, scores, playerHandicaps);
      if (w == null) {
        team1Remaining += 1;
        team2Remaining += 1;
        return;
      }
      decided++;
      if (w === 1) { team1 += 1; duelRows[i].aPts += 1; }
      else if (w === 2) { team2 += 1; duelRows[i].bPts += 1; }
      else {
        team1 += 0.5; team2 += 0.5;
        duelRows[i].aPts += 0.5; duelRows[i].bPts += 0.5;
      }
    });
    if (decided === duels.length) fullyPlayed++;
  }

  const holesLeft = holes.length - fullyPlayed;
  const lead = Math.abs(team1 - team2);
  const leaderIdx = team1 > team2 ? 0 : team2 > team1 ? 1 : null;
  const clinched = leaderIdx !== null && (
    leaderIdx === 0 ? team1 > team2 + team2Remaining : team2 > team1 + team1Remaining
  );
  return { team1, team2, played: fullyPlayed, holesLeft, lead, leaderIdx, clinched, duels: duelRows };
}

// ── Team tournament leaderboards ────────────────────────────────────────────
// Both boards aggregate PER REAL PLAYER (one row per player, never per team),
// following the tournamentBestWorstLeaderboard precedent: teams re-shuffle
// every round, so each player earns their own team's result each round and
// the rows stay stable across shuffles. Row shape matches the other
// tournament boards ({ player, points, ... }) so the HomeScreen leaderboard
// row renderer works unchanged.

// The round.pairs entry containing this player, or null.
function teamOfPlayer(round, playerId) {
  return (round?.pairs ?? []).find(
    (pair) => Array.isArray(pair) && pair.some((m) => m?.id === playerId),
  ) ?? null;
}

// Cumulative scramble standings across all played rounds. Each player earns
// their team's Stableford points and gross strokes for the round (the team's
// tally row lives under the team captain's id in scrambleRoundTally).
export function tournamentScrambleLeaderboard(tournament) {
  const { players = [], rounds = [] } = tournament ?? {};
  const acc = new Map(players.map((p) => [p.id, { player: p, points: 0, strokes: 0 }]));
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    if (!isScrambleMode(roundScoringMode(tournament, round))) return;
    const tally = scrambleRoundTally(round, players);
    if (!tally) return;
    const rowByCaptain = new Map(tally.totals.map((r) => [r.unit.id, r]));
    for (const p of players) {
      const team = teamOfPlayer(round, p.id);
      const row = team ? rowByCaptain.get(team[0]?.id) : null;
      if (!row) continue;
      const cur = acc.get(p.id);
      cur.points += row.points;
      cur.strokes += row.strokes;
    }
  });
  return [...acc.values()].sort((a, b) => b.points - a.points);
}

// Cumulative pairs match play standings across all played rounds. Each player
// earns their team's match points per round (round.pairs[0] → tally.team1,
// round.pairs[1] → tally.team2).
export function tournamentPairsMatchStandings(tournament) {
  const { players = [], rounds = [] } = tournament ?? {};
  const acc = new Map(players.map((p) => [p.id, { player: p, points: 0 }]));
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    if (roundScoringMode(tournament, round) !== 'pairsmatchplay') return;
    const tally = pairsMatchRoundTally(round, players);
    if (!tally) return;
    for (const p of players) {
      const idx = (round.pairs ?? []).findIndex(
        (pair) => Array.isArray(pair) && pair.some((m) => m?.id === p.id),
      );
      if (idx !== 0 && idx !== 1) continue;
      acc.get(p.id).points += idx === 0 ? tally.team1 : tally.team2;
    }
  });
  const board = [...acc.values()].sort((a, b) => b.points - a.points);
  return { board };
}

// Individual Stableford board across all rounds. Scramble rounds have no
// individual balls, so each player contributes their TEAM's Stableford
// points/strokes there. This is the overall board for mixed-mode
// tournaments and the Stableford alternate view everywhere.
export function tournamentStablefordLeaderboard(tournament) {
  const { players = [], rounds = [] } = tournament ?? {};
  const acc = new Map(players.map((p) => [p.id, { player: p, points: 0, strokes: 0 }]));
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    const mode = roundScoringMode(tournament, round);
    if (isScrambleMode(mode)) {
      const tally = scrambleRoundTally(round, players);
      if (!tally) return;
      const rowByCaptain = new Map(tally.totals.map((r) => [r.unit.id, r]));
      for (const p of players) {
        const team = teamOfPlayer(round, p.id);
        const row = team ? rowByCaptain.get(team[0]?.id) : null;
        if (!row) continue;
        const cur = acc.get(p.id);
        cur.points += row.points;
        cur.strokes += row.strokes;
      }
      return;
    }
    for (const rt of roundTotals(round, players)) {
      const cur = acc.get(rt.player.id);
      if (!cur) continue;
      cur.points += rt.totalPoints;
      cur.strokes += rt.totalStrokes;
    }
  });
  return [...acc.values()].sort((a, b) => b.points - a.points);
}

// ── Phase A helpers ─────────────────────────────────────────────────────────

// Green-in-Regulation: reached the green with at least two strokes left
// for putting (strokes − putts ≤ par − 2). Returns null when putts is unknown.
export function isGIR({ strokes, putts, par }) {
  if (strokes == null || putts == null || par == null) return null;
  return (strokes - putts) <= (par - 2);
}

// Auto-derives the recoveryOutcome chip value from the rest of the hole's
// state. Returns null when the situation doesn't fit a clear outcome — the
// UI keeps the chips tappable so the user can override manually.
export function recoveryOutcomeFromState({ strokes, putts, sandShots = 0, par }) {
  const gir = isGIR({ strokes, putts, par });
  if (gir !== false) return null;        // GIR hit OR unknown → no recovery
  if (strokes > par) return null;        // a save means par or better
  if (putts !== 1 && putts !== 0) return null; // 1-putt saves and holed-out chips are unambiguous
  return sandShots >= 1 ? 'sand-save' : 'up-and-down';
}

// Total strokes already accounted for by a hole's shot detail: every putt,
// penalty, and sand shot is itself one of the hole's strokes. Missing or
// null fields count as 0.
export function shotDetailStrokeCount(detail) {
  if (!detail) return 0;
  return (detail.putts ?? 0)
    + (detail.teePenalties ?? 0)
    + (detail.otherPenalties ?? 0)
    + (detail.sandShots ?? 0);
}

// Trims a hole's shot detail so its counters never exceed `strokes`. Strokes
// is the master value. Trims in order putts -> sandShots -> otherPenalties ->
// teePenalties until the detail fits. Clears firstPuttBucket when putts is
// driven to 0 (its picker is hidden at 0 putts). Idempotent: returns the
// input object unchanged when it already fits or when strokes is null.
export function reconcileShotDetail(detail, strokes) {
  if (detail == null || strokes == null) return detail;
  if (shotDetailStrokeCount(detail) <= strokes) return detail;

  let over = shotDetailStrokeCount(detail) - strokes;
  const out = { ...detail };
  for (const field of ['putts', 'sandShots', 'otherPenalties', 'teePenalties']) {
    if (over <= 0) break;
    const cur = out[field] ?? 0;
    if (cur <= 0) continue;            // nothing to trim here — leave field as-is
    const cut = Math.min(cur, over);
    out[field] = cur - cut;
    over -= cut;
  }
  if (out.putts === 0) out.firstPuttBucket = null;
  return out;
}

// ── Score conflict helpers ───────────────────────────────────────────────────
// A round carries `scoreConflicts` (parallel to `scores`): a marker object at
// scoreConflicts[playerId][hole] when that cell has two competing values. See
// store/merge.js for how markers are written. A merge that clears a marker
// leaves the key set to `undefined`, so test the value, not key presence.

// Every unresolved conflict in a round as { playerId, hole } pairs, hole ascending.
export function listRoundConflicts(round) {
  const byPlayer = round?.scoreConflicts;
  if (!byPlayer || typeof byPlayer !== 'object') return [];
  const out = [];
  for (const [playerId, byHole] of Object.entries(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const [holeKey, marker] of Object.entries(byHole)) {
      if (marker) out.push({ playerId, hole: Number(holeKey) });
    }
  }
  return out.sort((a, b) => a.hole - b.hole);
}

// True when the round has at least one unresolved score conflict.
export function roundHasConflicts(round) {
  return listRoundConflicts(round).length > 0;
}

// ── Match Play tournament ────────────────────────────────────────────────────

// Match Play tournament standing. Across played rounds, sums each of the two
// players' holes won (matchPlayRoundTally) and total gross strokes. Returns
// { board: [{player, points, strokes}] sorted by holes won desc, status } or
// null for the wrong player count / before any hole is scored. `status` is
// "<leader> wins" once the lead exceeds the holes still to play, else
// "<leader> leads by N", else "All square".
export function tournamentMatchPlayStandings(tournament) {
  const { players, rounds } = tournament;
  if (!players || players.length !== 2) return null;
  // No early-out on an unscored match: both players still appear on the
  // leaderboard, all square at 0, so the card is populated from the start.
  const [a, b] = players;
  let aHoles = 0;
  let bHoles = 0;
  let holesRemaining = 0;
  const strokes = { [a.id]: 0, [b.id]: 0 };
  rounds.forEach((round, idx) => {
    const future = idx > (tournament.currentRound ?? 0);
    // A non-matchplay round contributes no match points (and its strokes
    // aren't matchplay strokes) — treat it like a future round for the
    // clinch calculation: its holes stay "remaining", never decided.
    if (future || roundScoringMode(tournament, round) !== 'matchplay') {
      holesRemaining += round.holes?.length ?? 0;
      return;
    }
    players.forEach((p) => {
      const holeScores = round.scores?.[p.id] ?? {};
      for (const v of Object.values(holeScores)) strokes[p.id] += (v || 0);
    });
    const tally = matchPlayRoundTally(round, players);
    if (tally) {
      aHoles += tally.aWins;
      bHoles += tally.bWins;
      holesRemaining += tally.holesLeft;
    } else {
      holesRemaining += round.holes?.length ?? 0;
    }
  });
  const board = [
    { player: a, points: aHoles, strokes: strokes[a.id] },
    { player: b, points: bHoles, strokes: strokes[b.id] },
  ].sort((x, y) => y.points - x.points);
  const lead = Math.abs(aHoles - bHoles);
  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  let status;
  if (lead === 0) status = 'All square';
  else if (lead > holesRemaining) status = `${firstName(board[0].player)} wins`;
  else status = `${firstName(board[0].player)} leads by ${lead}`;
  return { board, status };
}
