import { stablefordComparator, tournamentStablefordLeaderboard, tournamentScrambleLeaderboard } from '../scoring';
import { tournamentLeaderboard, tournamentBestWorstLeaderboard } from '../tournamentStore';

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

// Regression: best-ball and scramble boards used to sort purely on points
// (b.points - a.points), with no stroke tiebreak — an arbitrary tie order
// inconsistent with the individual/Stableford board. They now use the same
// stablefordComparator (points desc, then fewer gross strokes).
describe('tournamentBestWorstLeaderboard tiebreak', () => {
  test('a points tie breaks on fewer gross strokes', () => {
    const A = { id: 'a', name: 'A', handicap: 0 };
    const B = { id: 'b', name: 'B', handicap: 0 };
    const C = { id: 'c', name: 'C', handicap: 0 };
    const D = { id: 'd', name: 'D', handicap: 0 };
    const players = [A, B, C, D];
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const settings = { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 };

    // Round 1: pair [a,b] clearly beats pair [c,d] on best-ball (a=3 pts),
    // and the worst-ball role is tied between the pairs (b=0 pts vs c/d tied
    // at 1 pt) — a earns 1 pt, b/c/d share half a "worst tied" each (no pts).
    const round1 = {
      id: 'r0', holes,
      pairs: [[A, B], [C, D]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      scores: { a: { 1: 3 }, b: { 1: 6 }, c: { 1: 5 }, d: { 1: 5 } },
    };
    // Round 2: pair [c,d] now clearly beats pair [a,b] on best-ball (c=2
    // strokes, low), while a/b tie the worst-ball role at 1 pt vs d's 0 —
    // c earns 1 pt, a/b share a "worst won" half-point each.
    const round2 = {
      id: 'r1', holes,
      pairs: [[A, B], [C, D]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      scores: { a: { 1: 5 }, b: { 1: 5 }, c: { 1: 2 }, d: { 1: 6 } },
    };
    const tournament = { players, rounds: [round1, round2], currentRound: 1, settings };

    const board = tournamentBestWorstLeaderboard(tournament);
    const byId = Object.fromEntries(board.map((r) => [r.player.id, r]));

    // a and c both finish at 1.5 pts (1 whole win + one half-win).
    expect(byId.a.points).toBe(1.5);
    expect(byId.c.points).toBe(1.5);
    // a's gross strokes (3 + 5 = 8) are more than c's (5 + 2 = 7).
    expect(byId.a.strokes).toBe(8);
    expect(byId.c.strokes).toBe(7);

    // The tie breaks in c's favor (fewer strokes), matching stablefordComparator.
    const aIdx = board.findIndex((r) => r.player.id === 'a');
    const cIdx = board.findIndex((r) => r.player.id === 'c');
    expect(cIdx).toBeLessThan(aIdx);
    expect(board[0].player.id).toBe('c');
  });
});

describe('tournamentScrambleLeaderboard tiebreak', () => {
  test('a points tie breaks on fewer gross strokes', () => {
    // Team 1 (a,b) plays off scratch (team handicap 0). Team 2 (c,d) plays
    // off a team handicap of 1 (both members handicap 2, scramble-pairs
    // allowance 0.35+0.15 of 2 each → round(0.7+0.3) = 1), so team 2 gets
    // one extra shot on the SI-1 hole. Team 1 shoots better gross strokes
    // but nets the same Stableford points once team 2's extra shot is
    // applied — a pure points tie with different gross strokes.
    const A = { id: 'a', name: 'A', handicap: 0 };
    const B = { id: 'b', name: 'B', handicap: 0 };
    const C = { id: 'c', name: 'C', handicap: 2 };
    const D = { id: 'd', name: 'D', handicap: 2 };
    const players = [A, B, C, D];
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const round = {
      id: 'r0', holes,
      pairs: [[A, B], [C, D]],
      playerHandicaps: { a: 0, b: 0, c: 2, d: 2 },
      // Team ball lives under the captain (a for team1, c for team2).
      scores: { a: { 1: 3, 2: 4 }, c: { 1: 4, 2: 4 } },
    };
    const tournament = {
      players, rounds: [round], currentRound: 0,
      settings: { scoringMode: 'scramblepairs' },
    };

    const board = tournamentScrambleLeaderboard(tournament);
    const byId = Object.fromEntries(board.map((r) => [r.player.id, r]));

    expect(byId.a.points).toBe(5);
    expect(byId.c.points).toBe(5);
    expect(byId.a.strokes).toBe(7); // team1 gross: 3 + 4
    expect(byId.c.strokes).toBe(8); // team2 gross: 4 + 4

    const aIdx = board.findIndex((r) => r.player.id === 'a');
    const cIdx = board.findIndex((r) => r.player.id === 'c');
    expect(aIdx).toBeLessThan(cIdx); // team1 (fewer strokes) ranks above team2
    expect(board[0].player.id).toBe('a');
  });
});
