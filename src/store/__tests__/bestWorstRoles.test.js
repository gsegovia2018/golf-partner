import {
  assignBestWorstRoles,
  playerRoundBestWorstPoints,
  tournamentBestWorstLeaderboard,
} from '../tournamentStore';

// tournamentStore imports the supabase client at module load; stub it out so
// these pure-function tests don't touch IO (same pattern as tournamentStore.test.js).
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({}),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

// Four players, handicap 0, so on a par-4 hole Stableford points = 6 − strokes.
const A1 = { id: 'a1', name: 'A1', handicap: 0 };
const A2 = { id: 'a2', name: 'A2', handicap: 0 };
const B1 = { id: 'b1', name: 'B1', handicap: 0 };
const B2 = { id: 'b2', name: 'B2', handicap: 0 };
const players = [A1, A2, B1, B2];

// strokesByHole: { a1: [h1, h2, ...], ... } — hole numbers start at 1.
function makeRound(strokesByHole) {
  const holeCount = strokesByHole.a1.length;
  const holes = Array.from({ length: holeCount }, (_, i) => ({
    number: i + 1, par: 4, strokeIndex: i + 1,
  }));
  const scores = {};
  players.forEach((p) => {
    scores[p.id] = {};
    strokesByHole[p.id].forEach((s, i) => {
      if (s != null) scores[p.id][i + 1] = s;
    });
  });
  return {
    holes,
    scores,
    pairs: [[A1, A2], [B1, B2]],
    playerHandicaps: { a1: 0, a2: 0, b1: 0, b2: 0 },
  };
}

describe('assignBestWorstRoles — within-pair ties share the role', () => {
  test('tied partners who win both comparisons each get half a win', () => {
    // A1/A2 tie on 2 pts; B pair's best is 1 pt → pair A wins BB and WB.
    const round = makeRound({ a1: [4], a2: [4], b1: [5], b2: [5] });
    const roles = assignBestWorstRoles(round, players);

    expect(roles.a1.bestWon).toBe(0.5);
    expect(roles.a2.bestWon).toBe(0.5);
    expect(roles.a1.worstWon).toBe(0.5);
    expect(roles.a2.worstWon).toBe(0.5);
    // Losing pair also tied → losses split too.
    expect(roles.b1.bestLost).toBe(0.5);
    expect(roles.b2.bestLost).toBe(0.5);
  });

  test('tied partners share the best/worst role counts equally', () => {
    const round = makeRound({ a1: [4], a2: [4], b1: [5], b2: [5] });
    const roles = assignBestWorstRoles(round, players);

    expect(roles.a1.best).toBe(0.5);
    expect(roles.a1.worst).toBe(0.5);
    expect(roles.a2.best).toBe(0.5);
    expect(roles.a2.worst).toBe(0.5);
  });

  test('tied partners whose comparison is halved each get half a tie and no points', () => {
    // A1/A2 tie on 2 pts; B1 has 2 pts (BB halved), B2 has 1 pt (A wins WB).
    const round = makeRound({ a1: [4], a2: [4], b1: [4], b2: [5] });
    const roles = assignBestWorstRoles(round, players);

    expect(roles.a1.bestTied).toBe(0.5);
    expect(roles.a2.bestTied).toBe(0.5);
    expect(roles.a1.worstWon).toBe(0.5);
    expect(roles.a2.worstWon).toBe(0.5);
    expect(playerRoundBestWorstPoints(round, 'a1', players, {})).toBe(0.5);
  });

  test('untied partners keep whole roles and whole points', () => {
    // A1 3 pts, A2 1 pt — no tie; B best 2 pts, B worst 1 pt.
    const round = makeRound({ a1: [3], a2: [5], b1: [4], b2: [5] });
    const roles = assignBestWorstRoles(round, players);

    expect(roles.a1.best).toBe(1);
    expect(roles.a1.bestWon).toBe(1);
    expect(roles.a2.worst).toBe(1);
    expect(roles.a2.worstTied).toBe(1); // A worst 1 vs B worst 1
    expect(playerRoundBestWorstPoints(round, 'a1', players, {})).toBe(1);
    expect(playerRoundBestWorstPoints(round, 'a2', players, {})).toBe(0);
  });

  test('handicap no longer decides tied holes', () => {
    // Same Stableford tie but different handicaps: previously the lower
    // handicap took the best-ball role and the full point. Now it splits.
    const round = {
      ...makeRound({ a1: [4], a2: [4], b1: [5], b2: [5] }),
      playerHandicaps: { a1: 12, a2: 18, b1: 0, b2: 0 },
    };
    // hcp 12 → 1 extra shot on SI 1 (3 pts); hcp 18 → 1 extra shot everywhere
    // (3 pts) — still tied, and both should share the win.
    const roles = assignBestWorstRoles(round, players);
    expect(roles.a1.bestWon).toBe(0.5);
    expect(roles.a2.bestWon).toBe(0.5);
  });
});

describe('tournamentBestWorstLeaderboard with shared ties', () => {
  test('accumulates half points into the leaderboard totals', () => {
    const round = makeRound({ a1: [4], a2: [4], b1: [5], b2: [5] });
    const tournament = {
      players,
      rounds: [round],
      currentRound: 0,
      settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 },
    };
    const board = tournamentBestWorstLeaderboard(tournament);
    const byName = Object.fromEntries(board.map((e) => [e.player.id, e]));

    // A1 and A2 each: ½ BB win + ½ WB win = 1 point.
    expect(byName.a1.points).toBe(1);
    expect(byName.a2.points).toBe(1);
    expect(byName.a1.bestWins).toBe(0.5);
    expect(byName.a1.worstWins).toBe(0.5);
    expect(byName.b1.points).toBe(0);
  });
});
