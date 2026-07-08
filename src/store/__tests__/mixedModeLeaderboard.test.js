import { tournamentStablefordLeaderboard, tournamentScrambleLeaderboard } from '../scoring';

const P = (id, name, handicap = 0) => ({ id, name, handicap });
const players = [P('a', 'Ann'), P('b', 'Bob'), P('c', 'Cam'), P('d', 'Dan')];
const HOLE = { number: 1, par: 4, strokeIndex: 1 };

// Round 1: plain stableford, everyone scores their own ball.
const stablefordRound = {
  id: 'r0',
  holes: [HOLE],
  pairs: players.map((p) => [p]),
  playerHandicaps: {},
  scores: { a: { 1: 3 }, b: { 1: 4 }, c: { 1: 5 }, d: { 1: 4 } }, // 3/2/1/2 pts
};

// Round 2: scramble pairs — team balls under captains a and c.
const scrambleRound = {
  id: 'r1',
  scoringMode: 'scramblepairs',
  holes: [HOLE],
  pairs: [[players[0], players[1]], [players[2], players[3]]],
  playerHandicaps: {},
  scores: { a: { 1: 3 }, c: { 1: 4 } }, // team a/b: 3 pts, team c/d: 2 pts
};

const t = {
  settings: { scoringMode: 'stableford' },
  players,
  rounds: [stablefordRound, scrambleRound],
  currentRound: 1,
};

describe('tournamentStablefordLeaderboard', () => {
  it('sums individual stableford, with team stableford for scramble rounds', () => {
    const board = tournamentStablefordLeaderboard(t);
    const byId = Object.fromEntries(board.map((e) => [e.player.id, e]));
    expect(byId.a.points).toBe(3 + 3); // own 3 + team 3
    expect(byId.b.points).toBe(2 + 3); // own 2 + team 3
    expect(byId.c.points).toBe(1 + 2);
    expect(byId.d.points).toBe(2 + 2);
    expect(board[0].player.id).toBe('a');
  });

  it('scramble rounds contribute team strokes, not zeros', () => {
    const board = tournamentStablefordLeaderboard(t);
    const byId = Object.fromEntries(board.map((e) => [e.player.id, e]));
    expect(byId.b.strokes).toBe(4 + 3); // own 4 + team ball 3
  });
});

describe('mode-family gating of cumulative boards', () => {
  it('tournamentScrambleLeaderboard ignores non-scramble rounds', () => {
    const board = tournamentScrambleLeaderboard(t);
    const byId = Object.fromEntries(board.map((e) => [e.player.id, e]));
    // Only the scramble round contributes.
    expect(byId.a.points).toBe(3);
    expect(byId.c.points).toBe(2);
  });
});
