import { tournamentBestWorstLeaderboard } from '../tournamentStore';

// One hole; handicaps 0. a scores 3 (stableford 3), everyone else 5
// (stableford 1): pair1 [a,b] wins BEST via a, WORST is halved (1 vs 1).
// So per round: a gets bestWon=1 → bestBallValue points; nobody gets worst points.
const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
const players = [
  { id: 'a', name: 'A', handicap: 0 }, { id: 'b', name: 'B', handicap: 0 },
  { id: 'c', name: 'C', handicap: 0 }, { id: 'd', name: 'D', handicap: 0 },
];
const mkRound = (id, extra = {}) => ({
  id, holes,
  pairs: [[players[0], players[1]], [players[2], players[3]]],
  playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
  scores: { a: { 1: 3 }, b: { 1: 5 }, c: { 1: 5 }, d: { 1: 5 } },
  ...extra,
});

test('per-round bestBallValue override scales only its own round', () => {
  const tournament = {
    players,
    currentRound: 1,
    settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 },
    rounds: [
      mkRound('r0'),
      mkRound('r1', { bestBallValue: 5 }),
    ],
  };
  const board = tournamentBestWorstLeaderboard(tournament);
  const a = board.find((row) => row.player.id === 'a');
  // r0: 1 best win × 1 pt; r1: 1 best win × 5 pts.
  expect(a.points).toBe(6);
  expect(a.bestWins).toBe(2);
});
