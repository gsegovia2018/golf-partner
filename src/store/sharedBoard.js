// Pure model builder for the public shareable-board screen (see
// docs/superpowers/plans/2026-08-16-shareable-live-board.md, build item 2).
//
// Input: the whitelisted JSON projection `get_shared_board(p_share_token)`
// (a SECURITY DEFINER RPC, built separately) returns — see that migration's
// authoritative shape at
// supabase/migrations/20260811000000_restore_player_identity_projection.sql.
// This module never calls the RPC itself and has no supabase/network/
// AsyncStorage imports of its own; it only maps the already-fetched payload
// through the app's existing scoring/leaderboard math.
//
// Reused, not reimplemented:
// - `roundLeaderboard` / `tournamentLeaderboardResolved` / `formatRoundLabel`
//   / `isRoundInProgress` (src/store/tournamentStore.js) — same functions
//   src/lib/liveRoundSummary.js already imports from there for the Home
//   "live round" card; they take a plain tournament-shaped object and do no
//   IO themselves.
// - `assignPlacements` / `comparatorForBoardMode` (leaderboardPlacement.js)
//   — the same tie-aware ranking HomeScreen uses for its on-screen board.
// - `roundScoringMode` / `isScrambleMode` / `scrambleUnits` (scoring.js) —
//   mode resolution and the scramble team-unit mapping (team score lives
//   under the captain/pair[0]), reused for the "thru N" calc below.
import {
  roundLeaderboard,
  tournamentLeaderboardResolved,
  formatRoundLabel,
  isRoundInProgress,
} from './tournamentStore';
import { assignPlacements, comparatorForBoardMode } from './leaderboardPlacement';
import { roundScoringMode, isScrambleMode, scrambleUnits } from './scoring';

// How many holes, counting from hole 1, are fully entered for every scoring
// unit (each player, or — for scramble modes — each team, keyed by captain
// per scrambleUnits). Nothing in the existing stores computes this "thru N"
// presentation figure (liveRoundSummary's `thru` is scoped to a single
// device's player id, which the public board has no equivalent of), so it's
// new here rather than reused, but it does no scoring math of its own.
function computeThru(round, players, mode) {
  const holes = [...(round?.holes ?? [])].sort(
    (a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0),
  );
  if (holes.length === 0) return 0;
  const units = isScrambleMode(mode) ? scrambleUnits(round, players) : players;
  if (!units || units.length === 0) return 0;
  let thru = 0;
  for (const hole of holes) {
    const allEntered = units.every((u) => round?.scores?.[u.id]?.[hole.number] != null);
    if (!allEntered) break;
    thru += 1;
  }
  return thru;
}

// Map the shared-board RPC payload into `{ tournamentName, rounds, overall,
// liveRoundIndex }` for the (later) SharedBoardScreen to render as-is. Null
// for a falsy/malformed payload; tolerant of missing/empty players, rounds,
// and scores otherwise — this comes from an anon RPC over the network, so
// nothing here may throw on partial data.
export function buildSharedBoardModel(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const players = Array.isArray(payload.players) ? payload.players : [];
  const roundsIn = Array.isArray(payload.rounds) ? payload.rounds : [];
  // Shape roundLeaderboard/tournamentLeaderboardResolved expect: a
  // tournament-like object with players/rounds arrays plus whatever
  // round-scoped keys (scoringMode, playerHandicaps, pairs, ...) the payload
  // already carries per round.
  const tournament = { ...payload, players, rounds: roundsIn };

  const live = isRoundInProgress(tournament);
  const liveRoundIndex = live ? tournament.currentRound : null;

  const rounds = roundsIn.map((round, index) => {
    const mode = roundScoringMode(tournament, round);
    let board;
    try {
      board = roundLeaderboard(tournament, round);
    } catch {
      board = { mode, unit: 'pts', entries: [] };
    }
    const entries = assignPlacements(board.entries, comparatorForBoardMode(board.mode));
    const holes = Array.isArray(round?.holes) ? round.holes : [];
    return {
      id: round?.id ?? `round-${index}`,
      label: formatRoundLabel({
        kind: payload.kind,
        courseName: round?.courseName || round?.course?.name || '',
        roundIndex: index,
      }),
      leaderboard: { ...board, entries },
      isLive: live && index === liveRoundIndex,
      holesPlayed: holes.length,
      thru: computeThru(round, players, mode),
    };
  });

  let overall = [];
  try {
    const overallBoard = tournamentLeaderboardResolved(tournament);
    overall = assignPlacements(overallBoard.entries, comparatorForBoardMode(overallBoard.mode));
  } catch {
    overall = [];
  }

  return {
    tournamentName: payload.name || '',
    rounds,
    overall,
    liveRoundIndex,
  };
}
