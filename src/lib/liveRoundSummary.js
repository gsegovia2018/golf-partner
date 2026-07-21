import { isRoundInProgress, roundLeaderboard } from '../store/tournamentStore';

// Summarize the tournament's live round for the Home "jump back in" hero
// card, or return null when there is nothing live to show.
//
// Real store shapes (see src/store/tournamentStore.js):
// - `isRoundInProgress(tournament)` (line ~1899) is the single source of
//   truth for "is there a round to jump back into" — false when there's no
//   tournament, it's finished, the current round has no scores object, or
//   every player has fully entered every hole.
// - `round.scores` is keyed `{ [playerId]: { [holeNumber]: strokes } }`.
// - `roundLeaderboard(tournament, round)` (line ~1547) does NOT return a
//   flat array of rows — it returns `{ mode, unit, entries }`, where each
//   entry is `{ player, points, strokes, handicap? }` and `player` is the
//   full player object (not a bare id string).
export function liveRoundSummary(tournament) {
  if (!tournament || !isRoundInProgress(tournament)) return null;

  const round = tournament.rounds?.[tournament.currentRound];
  if (!round) return null;

  const holeCount = round.holes?.length ?? 18;
  const myScores = round.scores?.[tournament.meId] ?? {};
  const thru = Object.values(myScores).filter((v) => v != null).length;

  let myPoints = 0;
  try {
    const board = roundLeaderboard(tournament, round);
    const mine = board?.entries?.find((e) => e.player?.id === tournament.meId);
    if (mine && typeof mine.points === 'number') myPoints = mine.points;
  } catch {
    myPoints = 0;
  }

  return {
    name: tournament.name || 'Golf',
    roundLabel: `Round ${Number(tournament.currentRound) + 1}`,
    courseName: round.courseName || round.course?.name || '',
    myPoints,
    thru,
    holeCount,
  };
}
