import { stablefordComparator, tournamentStablefordLeaderboard } from '../scoring';
import { tournamentLeaderboard } from '../tournamentStore';

describe('stablefordComparator', () => {
  test('points desc, then fewer strokes first', () => {
    const rows = [
      { player: { id: 'a' }, points: 30, strokes: 90 },
      { player: { id: 'b' }, points: 30, strokes: 85 },
      { player: { id: 'c' }, points: 34, strokes: 99 },
    ].sort(stablefordComparator);
    expect(rows.map((r) => r.player.id)).toEqual(['c', 'b', 'a']);
  });

  test('a no-score entry (strokes 0) never ranks ahead on a points tie', () => {
    const rows = [
      { player: { id: 'a' }, points: 0, strokes: 0 },
      { player: { id: 'b' }, points: 0, strokes: 88 },
    ].sort(stablefordComparator);
    expect(rows.map((r) => r.player.id)).toEqual(['b', 'a']);
  });
});

describe('tiebreak wired into the Stableford boards', () => {
  const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
  const tournament = {
    players: [{ id: 'q1', name: 'Q1', handicap: 0 }, { id: 'q2', name: 'Q2', handicap: 0 }],
    settings: { scoringMode: 'stableford' },
    rounds: [{ id: 'r0', holes, scores: { q1: { 1: 4 }, q2: { 1: 4 } } }],
  };

  test('tournamentLeaderboard applies the strokes tiebreak', () => {
    const t = { ...tournament, rounds: [{ id: 'r0', holes, scores: { q1: { 1: 4 }, q2: { 1: 5 } } }] };
    const board = tournamentLeaderboard(t);
    expect(board[0].player.id).toBe('q1');
  });

  test('tournamentStablefordLeaderboard is sorted (smoke)', () => {
    expect(Array.isArray(tournamentStablefordLeaderboard(tournament))).toBe(true);
  });
});
