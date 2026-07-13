import {
  scrambleTeamHandicap,
  scrambleUnits,
  scrambleRoundTally,
  tournamentScrambleLeaderboard,
} from '../scoring';

const P = (id, name, handicap = 0) => ({ id, name, handicap });

describe('scrambleTeamHandicap (USGA Appendix C)', () => {
  it('2-man: 35% low + 15% high, rounded', () => {
    // 35% of 8 + 15% of 20 = 2.8 + 3.0 = 5.8 → 6
    expect(scrambleTeamHandicap([20, 8])).toBe(6);
  });
  it('3-man: 20/15/10 low→high', () => {
    // 20% of 5 + 15% of 10 + 10% of 20 = 1 + 1.5 + 2 = 4.5 → 5 (Math.round)
    expect(scrambleTeamHandicap([10, 20, 5])).toBe(5);
  });
  it('4-man: 25/20/15/10 low→high', () => {
    // 25% of 4 + 20% of 8 + 15% of 12 + 10% of 20 = 1+1.6+1.8+2 = 6.4 → 6
    expect(scrambleTeamHandicap([12, 8, 20, 4])).toBe(6);
  });
  it('solo side plays full handicap', () => {
    expect(scrambleTeamHandicap([13])).toBe(13);
  });
  it('unknown team size → 0', () => {
    expect(scrambleTeamHandicap([])).toBe(0);
    expect(scrambleTeamHandicap([1, 2, 3, 4, 5])).toBe(0);
  });
});

describe('scramble round', () => {
  const players = [P('a', 'Ann Lee', 10), P('b', 'Bob Ray', 20), P('c', 'Cam Fox', 5), P('d', 'Dan Oak', 8)];
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  it('scrambleUnits builds synthetic team players keyed by captain', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1]], [players[2], players[3]]],
      playerHandicaps: { a: 10, b: 20, c: 5, d: 8 },
      scores: {},
    };
    const units = scrambleUnits(round, players);
    expect(units.map((u) => u.id)).toEqual(['a', 'c']);
    expect(units[0].name).toBe('Ann & Bob');
    // 35% of 10 + 15% of 20 = 6.5 → 7 ; 35% of 5 + 15% of 8 = 2.95 → 3
    expect(units[0].handicap).toBe(7);
    expect(units[1].handicap).toBe(3);
    expect(units[0].members.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('tally: points, lead, clinch when lead exceeds max remaining', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1]], [players[2], players[3]]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      // team a: birdie+birdie (3 pts each) = 6; team c: no scores yet
      scores: { a: { 1: 3, 2: 3 } },
    };
    const tally = scrambleRoundTally(round, players);
    expect(tally.totals[0].unit.id).toBe('a');
    expect(tally.totals[0].points).toBe(6);
    expect(tally.totals[1].points).toBe(0);
    // c can still out-score on both holes → not clinched
    expect(tally.clinched).toBe(false);
  });

  it('single-team round (scramble4 shape) tallies without clinch semantics', () => {
    const round = {
      holes,
      pairs: [[players[0], players[1], players[2], players[3]]],
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
      scores: { a: { 1: 4 } },
    };
    const tally = scrambleRoundTally(round, players);
    expect(tally.totals).toHaveLength(1);
    expect(tally.totals[0].points).toBe(2);
    expect(tally.clinched).toBe(false);
    expect(tally.holesLeft).toBe(1);
  });

  it('3v1: solo side scores under own id with full handicap', () => {
    const round = {
      holes: [holes[0]],
      pairs: [[players[0], players[1], players[2]], [players[3]]],
      playerHandicaps: { a: 10, b: 20, c: 5, d: 8 },
      scores: { a: { 1: 4 }, d: { 1: 4 } },
    };
    const units = scrambleUnits(round, players);
    // 20% of 5 + 15% of 10 + 10% of 20 = 1 + 1.5 + 2 = 4.5 → 5
    expect(units[0].handicap).toBe(5);
    expect(units[1].handicap).toBe(8);
    const tally = scrambleRoundTally(round, players);
    expect(tally.totals.map((t) => t.points).every((p) => p >= 2)).toBe(true);
  });
});

describe('tournamentScrambleLeaderboard', () => {
  const roster = [P('a', 'Ann Lee'), P('b', 'Bob Ray'), P('c', 'Cam Fox'), P('d', 'Dan Oak')];
  const mk = (pairs, scores) => ({
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs,
    playerHandicaps: {},
    scores,
  });
  const samePairs = [[roster[0], roster[1]], [roster[2], roster[3]]];

  it('one row per real player; teammates share their team points per round', () => {
    const t = {
      players: roster,
      settings: { scoringMode: 'scramblepairs' },
      currentRound: 1,
      rounds: [
        // r1: team a/b birdie (3 pts), team c/d par (2 pts)
        mk(samePairs, { a: { 1: 3 }, c: { 1: 4 } }),
        // r2: team a/b birdie (3 pts), team c/d bogey (1 pt)
        mk(samePairs, { a: { 1: 3 }, c: { 1: 5 } }),
      ],
    };
    const board = tournamentScrambleLeaderboard(t);
    expect(board).toHaveLength(4);
    const byId = Object.fromEntries(board.map((r) => [r.player.id, r]));
    expect(byId.a.points).toBe(6);
    expect(byId.b.points).toBe(6); // teammate carries the same team points
    expect(byId.c.points).toBe(3);
    expect(byId.d.points).toBe(3);
    expect(byId.a.player.name).toBe('Ann Lee'); // real player, not a team label
    expect(byId.b.strokes).toBe(6); // team strokes, not individual
    expect(byId.d.strokes).toBe(9);
    expect(board[0].points).toBe(6);
    expect(board[3].points).toBe(3);
  });

  it('follows a player across re-shuffled teams', () => {
    const t = {
      players: roster,
      settings: { scoringMode: 'scramblepairs' },
      currentRound: 1,
      rounds: [
        // r1: a+b (birdie, 3 pts) vs c+d (par, 2 pts)
        mk(samePairs, { a: { 1: 3 }, c: { 1: 4 } }),
        // r2: a+c (par, 2 pts) vs b+d (birdie, 3 pts)
        mk([[roster[0], roster[2]], [roster[1], roster[3]]], { a: { 1: 4 }, b: { 1: 3 } }),
      ],
    };
    const byId = Object.fromEntries(
      tournamentScrambleLeaderboard(t).map((r) => [r.player.id, r]));
    expect(byId.a.points).toBe(5); // 3 + 2
    expect(byId.b.points).toBe(6); // 3 + 3
    expect(byId.c.points).toBe(4); // 2 + 2
    expect(byId.d.points).toBe(5); // 2 + 3
  });

  it('counts every scored round even when currentRound is stale', () => {
    // currentRound is an unreliable cross-device pointer that can lag at 0
    // while later rounds are fully scored — a scored round must still count.
    const t = {
      players: roster,
      settings: { scoringMode: 'scramblepairs' },
      currentRound: 0,
      rounds: [
        mk(samePairs, { a: { 1: 3 }, c: { 1: 4 } }),
        mk(samePairs, { a: { 1: 3 }, c: { 1: 5 } }),
      ],
    };
    const board = tournamentScrambleLeaderboard(t);
    // Both birdie rounds count: 3 + 3 = 6, not just the first round.
    expect(board.find((r) => r.player.id === 'a').points).toBe(6);
  });

  it('ignores a round whose effective mode is not scramble', () => {
    const t = {
      players: roster,
      settings: { scoringMode: 'scramblepairs' },
      currentRound: 1,
      rounds: [
        mk(samePairs, { a: { 1: 3 }, c: { 1: 4 } }),
        // round overridden to plain stableford — no team ball, must not count.
        { ...mk(samePairs, { a: { 1: 3 }, b: { 1: 3 }, c: { 1: 4 }, d: { 1: 4 } }), scoringMode: 'stableford' },
      ],
    };
    const board = tournamentScrambleLeaderboard(t);
    const byId = Object.fromEntries(board.map((r) => [r.player.id, r]));
    expect(byId.a.points).toBe(3);
    expect(byId.c.points).toBe(2);
  });
});
