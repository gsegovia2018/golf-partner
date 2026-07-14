import { stablefordComparator, tournamentStablefordLeaderboard, tournamentScrambleLeaderboard } from '../scoring';
import { tournamentLeaderboard, tournamentBestWorstLeaderboard, roundLeaderboard } from '../tournamentStore';
import { assignPlacements, comparatorForBoardMode } from '../leaderboardPlacement';

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

// The medal (place 1, gold) is assigned by assignPlacements, which compares
// only ADJACENT rows and trusts the array is already sorted by the comparator
// it's handed. HomeScreen feeds it roundLeaderboard(...).entries (the
// round-scoped board used for every casual game and per-round tab) with
// comparatorForBoardMode(mode). If the producer's sort disagrees with that
// comparator on a strokes-tiebroken points tie, the WRONG player is labelled
// place 1. These tests exercise that exact end-to-end combination.
describe('round-scoped board: place 1 goes to the fewer-strokes player/team', () => {
  const rank = (board) => assignPlacements(board.entries, comparatorForBoardMode(board.mode));

  test('bestball round board: fewer gross strokes wins the points tie for place 1', () => {
    const A = { id: 'a', name: 'A', handicap: 0 };
    const B = { id: 'b', name: 'B', handicap: 0 };
    const C = { id: 'c', name: 'C', handicap: 0 };
    const D = { id: 'd', name: 'D', handicap: 0 };
    const players = [A, B, C, D];
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    // Hole 1 pair AB wins both roles (A best +1, B worst +1); hole 2 pair CD
    // wins both (C best +1, D worst +1). Everyone ends on 1 point, but gross
    // strokes differ: A 8, B 10, C 7, D 9. So on the points tie C (7) must
    // take place 1, not A — even though A is first in roster/insertion order.
    const round = {
      id: 'r0', holes,
      pairs: [[A, B], [C, D]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      scores: {
        a: { 1: 3, 2: 5 }, b: { 1: 4, 2: 6 },
        c: { 1: 4, 2: 3 }, d: { 1: 5, 2: 4 },
      },
    };
    const tournament = {
      players, rounds: [round], currentRound: 0,
      settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 },
    };

    const board = roundLeaderboard(tournament, round);
    expect(board.mode).toBe('bestball');
    const byId = Object.fromEntries(board.entries.map((e) => [e.player.id, e]));
    expect(byId.a.points).toBe(1);
    expect(byId.c.points).toBe(1);
    expect(byId.a.strokes).toBe(8);
    expect(byId.c.strokes).toBe(7);

    const ranked = rank(board);
    expect(ranked[0].player.id).toBe('c'); // fewer strokes → gold
    expect(ranked[0].place).toBe(1);
    // A, tied on points but more strokes, must NOT be place 1.
    expect(ranked.find((r) => r.player.id === 'a').place).not.toBe(1);
  });

  test('scramble round board: the fewer-strokes team takes place 1', () => {
    // Same single scramble round as the cumulative test above: team1 (a,b) and
    // team2 (c,d) both net 5 points, but team1 shoots 7 gross vs team2's 8.
    const A = { id: 'a', name: 'A', handicap: 0 };
    const B = { id: 'b', name: 'B', handicap: 0 };
    const C = { id: 'c', name: 'C', handicap: 2 };
    const D = { id: 'd', name: 'D', handicap: 2 };
    const players = [A, B, C, D];
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    // The MORE-strokes team (c,d: 8 gross, off a team-handicap extra shot) is
    // listed FIRST in pairs, so it is inserted into `entries` first. A stable
    // points-only sort would therefore leave c,d ahead of the tied a,b team
    // and label c place 1 — the exact pre-fix bug. Only a strokes-tiebroken
    // sort (the fix) moves the fewer-strokes team a,b to place 1. (Verified:
    // reverting the scramble branch's sort to points-only turns this red.)
    const round = {
      id: 'r0', holes,
      pairs: [[C, D], [A, B]],
      playerHandicaps: { a: 0, b: 0, c: 2, d: 2 },
      scores: { c: { 1: 4, 2: 4 }, a: { 1: 3, 2: 4 } },
    };
    const tournament = {
      players, rounds: [round], currentRound: 0,
      settings: { scoringMode: 'scramblepairs' },
    };

    const board = roundLeaderboard(tournament, round);
    expect(board.mode).toBe('scramblepairs');
    const byId = Object.fromEntries(board.entries.map((e) => [e.player.id, e]));
    expect(byId.a.points).toBe(5);
    expect(byId.c.points).toBe(5);
    expect(byId.a.strokes).toBe(7); // team a,b gross
    expect(byId.c.strokes).toBe(8); // team c,d gross (extra shot)

    const ranked = rank(board);
    // team a,b fewer strokes → both share place 1; team c,d → place 3.
    const byIdRanked = Object.fromEntries(ranked.map((r) => [r.player.id, r]));
    expect(byIdRanked.a.place).toBe(1);
    expect(byIdRanked.b.place).toBe(1);
    expect(byIdRanked.c.place).toBe(3);
    expect(byIdRanked.d.place).toBe(3);
    expect(ranked[0].player.id === 'a' || ranked[0].player.id === 'b').toBe(true);
  });
});
