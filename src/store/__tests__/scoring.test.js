import {
  STANDARD_SLOPE,
  totalParFromHoles,
  calcPlayingHandicap,
  deriveRoundPlayingHandicap,
  resolveRoundTee,
  getPlayingHandicap,
  recomputeRoundPlayingHandicaps,
  normalizeRoundHandicaps,
  calcExtraShots,
  calcStablefordPoints,
  matchPlayHolePts,
  matchPlayRoundTally,
  pickupStrokes,
  randomPairs,
  buildTeamsForMode,
  isRoundPlayed,
  sindicatoHolePoints,
  sindicatoRoundTally,
  tournamentSindicatoLeaderboard,
  tournamentSindicatoClinched,
  tournamentMatchPlayStandings,
  recoveryOutcomeFromState,
  isGIR,
  shotDetailStrokeCount,
  reconcileShotDetail,
  listRoundConflicts,
  roundHasConflicts,
} from '../scoring';

describe('calcExtraShots', () => {
  it('gives no extra shots to a scratch player', () => {
    expect(calcExtraShots(0, 1)).toBe(0);
    expect(calcExtraShots(0, 18)).toBe(0);
  });

  it('distributes the remainder across the hardest holes', () => {
    // handicap 9 -> a stroke on stroke-index 1..9, none on 10..18
    expect(calcExtraShots(9, 9)).toBe(1);
    expect(calcExtraShots(9, 10)).toBe(0);
    expect(calcExtraShots(9, 1)).toBe(1);
  });

  it('gives one stroke on every hole at handicap 18', () => {
    expect(calcExtraShots(18, 1)).toBe(1);
    expect(calcExtraShots(18, 18)).toBe(1);
  });

  it('stacks base shots plus the remainder above 18', () => {
    // handicap 20 -> base 1 everywhere, +1 on SI 1 and 2
    expect(calcExtraShots(20, 1)).toBe(2);
    expect(calcExtraShots(20, 2)).toBe(2);
    expect(calcExtraShots(20, 3)).toBe(1);
  });

  it('handles a 36 handicap (exactly two shots per hole)', () => {
    expect(calcExtraShots(36, 1)).toBe(2);
    expect(calcExtraShots(36, 18)).toBe(2);
  });
});

describe('calcStablefordPoints', () => {
  it('scores a gross par as 2 points for a scratch player', () => {
    expect(calcStablefordPoints(4, 4, 0, 1)).toBe(2);
  });

  it('scores birdie/eagle above par points', () => {
    expect(calcStablefordPoints(4, 3, 0, 1)).toBe(3); // birdie
    expect(calcStablefordPoints(4, 2, 0, 1)).toBe(4); // eagle
  });

  it('scores bogey below par and floors at zero', () => {
    expect(calcStablefordPoints(4, 5, 0, 1)).toBe(1); // bogey
    expect(calcStablefordPoints(4, 6, 0, 1)).toBe(0); // double bogey
    expect(calcStablefordPoints(4, 8, 0, 1)).toBe(0); // never negative
  });

  it('returns 0 when no score has been entered', () => {
    expect(calcStablefordPoints(4, 0, 0, 1)).toBe(0);
    expect(calcStablefordPoints(4, null, 0, 1)).toBe(0);
    expect(calcStablefordPoints(4, undefined, 0, 1)).toBe(0);
  });

  it('applies handicap strokes (net par scores 2)', () => {
    // handicap 18 -> one stroke on SI 1; gross bogey becomes net par
    expect(calcStablefordPoints(4, 5, 18, 1)).toBe(2);
  });
});

describe('calcPlayingHandicap', () => {
  it('returns the raw index when there is no slope', () => {
    expect(calcPlayingHandicap(18, 0, null, null)).toBe(18);
    expect(calcPlayingHandicap(7, undefined, null, null)).toBe(7);
  });

  it('is identity at the standard slope with no CR adjustment', () => {
    expect(calcPlayingHandicap(10, STANDARD_SLOPE, null, null)).toBe(10);
  });

  it('scales the index by slope/113', () => {
    expect(calcPlayingHandicap(20, 130, null, null)).toBe(23);
  });

  it('adds the course rating minus par adjustment', () => {
    expect(calcPlayingHandicap(10, STANDARD_SLOPE, 74, 72)).toBe(12);
  });
});

describe('totalParFromHoles', () => {
  it('sums hole pars', () => {
    expect(totalParFromHoles([{ par: 4 }, { par: 3 }, { par: 5 }])).toBe(12);
  });

  it('coerces strings and ignores missing pars', () => {
    expect(totalParFromHoles([{ par: '4' }, {}, { par: 5 }])).toBe(9);
  });

  it('returns 0 for non-arrays', () => {
    expect(totalParFromHoles(null)).toBe(0);
    expect(totalParFromHoles(undefined)).toBe(0);
  });
});

describe('deriveRoundPlayingHandicap / getPlayingHandicap', () => {
  const round = {
    slope: STANDARD_SLOPE,
    courseRating: 72,
    holes: Array.from({ length: 18 }, () => ({ par: 4 })),
  };

  it('derives from index, slope and course par', () => {
    expect(deriveRoundPlayingHandicap(10, round)).toBe(10);
  });

  it('prefers a stored per-round handicap when present', () => {
    expect(getPlayingHandicap({ playerHandicaps: { p1: 12 } }, { id: 'p1' }))
      .toBe(12);
  });

  it('falls back to deriving when no stored handicap exists', () => {
    const player = { id: 'p1', handicap: 10 };
    expect(getPlayingHandicap({ ...round, playerHandicaps: {} }, player))
      .toBe(10);
  });
});

describe('resolveRoundTee', () => {
  it('prefers the player tee snapshot when present', () => {
    const round = {
      slope: 113, courseRating: 72,
      playerTees: { p1: { label: 'White', slope: 132, rating: 71.8 } },
    };
    expect(resolveRoundTee(round, 'p1')).toEqual({ slope: 132, rating: 71.8 });
  });

  it('falls back to round-level slope/rating for legacy rounds', () => {
    const round = { slope: 125, courseRating: 70.1 };
    expect(resolveRoundTee(round, 'p1')).toEqual({ slope: 125, rating: 70.1 });
  });
});

describe('deriveRoundPlayingHandicap with per-player tees', () => {
  const holes = Array.from({ length: 18 }, () => ({ par: 4 })); // par 72

  it('derives each player from their own tee', () => {
    const round = {
      holes,
      playerTees: {
        p1: { label: 'White',  slope: 132, rating: 71.8 },
        p2: { label: 'Yellow', slope: 113, rating: 69.0 },
      },
    };
    // p1: 10 * 132/113 + (71.8 - 72) = 11.68 - 0.2 = 11.48 -> 11
    expect(deriveRoundPlayingHandicap(10, round, 'p1')).toBe(11);
    // p2: 10 * 113/113 + (69.0 - 72) = 10 - 3 = 7
    expect(deriveRoundPlayingHandicap(10, round, 'p2')).toBe(7);
  });

  it('falls back to round.slope when the player has no tee entry', () => {
    const round = { holes, slope: 113, courseRating: 72, playerTees: {} };
    expect(deriveRoundPlayingHandicap(10, round, 'p1')).toBe(10);
  });
});

describe('recomputeRoundPlayingHandicaps', () => {
  it('refreshes auto handicaps but preserves manual overrides', () => {
    const round = {
      slope: STANDARD_SLOPE,
      courseRating: 72,
      holes: Array.from({ length: 18 }, () => ({ par: 4 })),
      playerHandicaps: { p1: 99, p2: 99 },
      manualHandicaps: { p1: true },
    };
    const players = [
      { id: 'p1', handicap: 10 },
      { id: 'p2', handicap: 14 },
    ];
    const out = recomputeRoundPlayingHandicaps(round, players);
    expect(out.playerHandicaps.p1).toBe(99); // manual preserved
    expect(out.playerHandicaps.p2).toBe(14); // auto recomputed
  });
});

describe('normalizeRoundHandicaps', () => {
  it('backfills missing handicap entries', () => {
    const round = {
      slope: STANDARD_SLOPE,
      courseRating: 72,
      holes: Array.from({ length: 18 }, () => ({ par: 4 })),
      playerHandicaps: {},
      manualHandicaps: {},
    };
    const out = normalizeRoundHandicaps(round, [{ id: 'p1', handicap: 8 }]);
    expect(out.playerHandicaps.p1).toBe(8);
  });
});

describe('pickupStrokes', () => {
  it('returns the lowest stroke count worth zero Stableford points', () => {
    const strokes = pickupStrokes(4, 0, 1);
    expect(calcStablefordPoints(4, strokes, 0, 1)).toBe(0);
    expect(calcStablefordPoints(4, strokes - 1, 0, 1)).toBe(1);
  });

  it('accounts for handicap strokes on the hole', () => {
    const strokes = pickupStrokes(4, 18, 1);
    expect(calcStablefordPoints(4, strokes, 18, 1)).toBe(0);
  });
});

describe('matchPlayHolePts', () => {
  const players = [
    { id: 'a', handicap: 0 },
    { id: 'b', handicap: 0 },
  ];
  const hole = { number: 1, strokeIndex: 1 };

  it('credits the lower net score with the hole', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 } };
    expect(matchPlayHolePts(hole, 'a', players, scores, {})).toBe(1);
    expect(matchPlayHolePts(hole, 'b', players, scores, {})).toBe(0);
  });

  it('returns 0 for both players on a halved hole', () => {
    const scores = { a: { 1: 4 }, b: { 1: 4 } };
    expect(matchPlayHolePts(hole, 'a', players, scores, {})).toBe(0);
    expect(matchPlayHolePts(hole, 'b', players, scores, {})).toBe(0);
  });

  it('returns null when a side has not scored', () => {
    expect(matchPlayHolePts(hole, 'a', players, { a: { 1: 4 } }, {})).toBeNull();
  });

  it('returns null unless exactly two players are passed', () => {
    expect(matchPlayHolePts(hole, 'a', [players[0]], {}, {})).toBeNull();
  });
});

describe('matchPlayRoundTally', () => {
  it('tallies wins, halves and clinch status', () => {
    const players = [
      { id: 'a', handicap: 0 },
      { id: 'b', handicap: 0 },
    ];
    const round = {
      holes: [
        { number: 1, strokeIndex: 1 },
        { number: 2, strokeIndex: 2 },
      ],
      scores: {
        a: { 1: 4, 2: 4 },
        b: { 1: 5, 2: 4 }, // a wins hole 1, hole 2 halved
      },
      playerHandicaps: {},
    };
    const tally = matchPlayRoundTally(round, players);
    expect(tally.aWins).toBe(1);
    expect(tally.bWins).toBe(0);
    expect(tally.halved).toBe(1);
    expect(tally.played).toBe(2);
    expect(tally.holesLeft).toBe(0);
    expect(tally.leaderIdx).toBe(0);
    expect(tally.clinched).toBe(true);
  });
});

describe('randomPairs', () => {
  it('splits four players into two pairs without losing anyone', () => {
    const players = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    const pairs = randomPairs(players);
    expect(pairs).toHaveLength(2);
    expect(pairs.flat()).toHaveLength(4);
    expect(new Set(pairs.flat().map((p) => p.id)).size).toBe(4);
  });

  it('leaves an odd player as a singleton pair', () => {
    const pairs = randomPairs([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(pairs.map((p) => p.length).sort()).toEqual([1, 2]);
  });

  it('returns no pairs for an empty roster', () => {
    expect(randomPairs([])).toEqual([]);
  });
});

describe('isRoundPlayed', () => {
  it('is true for a reached round that has scores', () => {
    expect(isRoundPlayed({ scores: {} }, 0, { currentRound: 0 })).toBe(true);
    expect(isRoundPlayed({ scores: {} }, 1, { currentRound: 2 })).toBe(true);
  });

  it('is false for a round the user has not advanced to', () => {
    expect(isRoundPlayed({ scores: {} }, 2, { currentRound: 0 })).toBe(false);
  });

  it('is false when the round has no scores object', () => {
    expect(isRoundPlayed({}, 0, { currentRound: 0 })).toBe(false);
  });
});

describe('sindicatoHolePoints', () => {
  // Handicap 0 for all → net strokes equal gross, so gross controls rank.
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];
  const hole = { number: 1, par: 4, strokeIndex: 5 };

  test('three distinct results split 4 / 2 / 0', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 4, b: 2, c: 0 });
  });
  test('one winner, two tied behind split 4 / 1 / 1', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 4, b: 1, c: 1 });
  });
  test('two tied for the win split 3 / 3 / 0', () => {
    const scores = { a: { 1: 4 }, b: { 1: 4 }, c: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 3, b: 3, c: 0 });
  });
  test('all three tied split 2 / 2 / 2', () => {
    const scores = { a: { 1: 5 }, b: { 1: 5 }, c: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 2, b: 2, c: 2 });
  });
  test('the four point values always sum to 6', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } };
    const pts = sindicatoHolePoints(hole, players, scores, {});
    expect(pts.a + pts.b + pts.c).toBe(6);
  });
  test('returns null when a player has not scored the hole', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toBeNull();
  });
  test('returns null when not exactly 3 players', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players.slice(0, 2), scores, {})).toBeNull();
  });
  test('ranks by net strokes — a handicap stroke flips equal gross', () => {
    // a gets one stroke on this hole (handicap 18, any strokeIndex → +1),
    // so a's net 4 beats b's net 5 despite both carding gross 5.
    const scores = { a: { 1: 5 }, b: { 1: 5 }, c: { 1: 6 } };
    const handicaps = { a: 18, b: 0, c: 0 };
    expect(sindicatoHolePoints(hole, players, scores, handicaps)).toEqual({ a: 4, b: 2, c: 0 });
  });
});

describe('sindicatoRoundTally', () => {
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  test('accumulates points across played holes and sorts descending', () => {
    // Hole 1: 4/5/6 → 4/2/0. Hole 2: 4/5/5 → 4/1/1. Totals a8 b3 c1.
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
    };
    const tally = sindicatoRoundTally(round, players);
    expect(tally.totals.map((t) => [t.player.id, t.points]))
      .toEqual([['a', 8], ['b', 3], ['c', 1]]);
    expect(tally.played).toBe(2);
    expect(tally.holesLeft).toBe(0);
    expect(tally.leaderIdx).toBe(0);
    expect(tally.lead).toBe(5);
  });
  test('counts an unscored hole as not played', () => {
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const tally = sindicatoRoundTally(round, players);
    expect(tally.played).toBe(1);
    expect(tally.holesLeft).toBe(1);
  });
  test('leaderIdx is null when the top two are tied', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 4 }, c: { 1: 5 } },
    };
    const tally = sindicatoRoundTally(round, players);
    expect(tally.leaderIdx).toBeNull();
    expect(tally.clinched).toBe(false);
  });
  test('not clinched when lead equals holesLeft × 4', () => {
    // 1 hole played (4/2/0 → lead 2), 1 hole left → max gain 4. lead 2 ≤ 4.
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    expect(sindicatoRoundTally(round, players).clinched).toBe(false);
  });
  test('clinched when lead exceeds holesLeft × 4', () => {
    // Both holes played, holesLeft 0, lead 5 > 0 → clinched.
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
    };
    expect(sindicatoRoundTally(round, players).clinched).toBe(true);
  });
  test('returns null when not exactly 3 players', () => {
    expect(sindicatoRoundTally({ holes, scores: {} }, players.slice(0, 2))).toBeNull();
  });
});

describe('tournamentSindicatoLeaderboard', () => {
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];
  const holes = [{ number: 1, par: 4, strokeIndex: 1 }];

  test('sums Sindicato points across played rounds, sorted descending', () => {
    // Each round: hole 1 scored 4/5/6 → 4/2/0.
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const tournament = { players, rounds: [round, round], currentRound: 1 };
    const lb = tournamentSindicatoLeaderboard(tournament);
    expect(lb.map((e) => [e.player.id, e.points])).toEqual([['a', 8], ['b', 4], ['c', 0]]);
  });
  test('ignores rounds not yet reached', () => {
    const played = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const future = { holes, playerHandicaps: {}, scores: {} };
    const tournament = { players, rounds: [played, future], currentRound: 0 };
    const lb = tournamentSindicatoLeaderboard(tournament);
    expect(lb.map((e) => [e.player.id, e.points])).toEqual([['a', 4], ['b', 2], ['c', 0]]);
  });
});

describe('tournamentSindicatoClinched', () => {
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];

  test('returns the leader id when the lead cannot be overcome', () => {
    // One round, both holes played. a8 b3 c1, lead 5, 0 holes left → clinched.
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
    };
    const tournament = { players, rounds: [round], currentRound: 0 };
    expect(tournamentSindicatoClinched(tournament)).toBe('a');
  });
  test('returns null when remaining holes could still overturn the lead', () => {
    // One hole played (lead 2), one hole left → max gain 4. Not clinched.
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const tournament = { players, rounds: [round], currentRound: 0 };
    expect(tournamentSindicatoClinched(tournament)).toBeNull();
  });
  test('returns null before any hole is scored', () => {
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const tournament = {
      players, rounds: [{ holes, playerHandicaps: {}, scores: {} }], currentRound: 0,
    };
    expect(tournamentSindicatoClinched(tournament)).toBeNull();
  });
});

describe('tournamentMatchPlayStandings', () => {
  const players = [
    { id: 'a', name: 'Alex', handicap: 0 },
    { id: 'b', name: 'Bo', handicap: 0 },
  ];
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  test('ranks the two players by holes won and reports the lead', () => {
    // Hole 1: a 4, b 5 → a wins. Hole 2: a 4, b 5 → a wins. a 2 holes, b 0.
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 } },
    };
    const t = { players, rounds: [round], currentRound: 0 };
    const r = tournamentMatchPlayStandings(t);
    expect(r.board.map((e) => [e.player.id, e.points])).toEqual([['a', 2], ['b', 0]]);
    expect(r.board[0].strokes).toBe(8);
    expect(r.status).toBe('Alex wins');
  });

  test('reports a running lead when holes remain', () => {
    // Hole 1 only: a wins. Hole 2 unscored → 1 hole left, lead 1, not clinched.
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 } },
    };
    const t = { players, rounds: [round], currentRound: 0 };
    const r = tournamentMatchPlayStandings(t);
    expect(r.status).toBe('Alex leads by 1');
  });

  test('reports all square when holes won are equal', () => {
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 5 }, b: { 1: 5, 2: 4 } },
    };
    const t = { players, rounds: [round], currentRound: 0 };
    expect(tournamentMatchPlayStandings(t).status).toBe('All square');
  });

  test('returns null when not exactly 2 players', () => {
    const round = { holes, playerHandicaps: {}, scores: { a: { 1: 4 } } };
    const t = { players: players.slice(0, 1), rounds: [round], currentRound: 0 };
    expect(tournamentMatchPlayStandings(t)).toBeNull();
  });

  test('shows both players all square before any hole is scored', () => {
    const t = {
      players, rounds: [{ holes, playerHandicaps: {}, scores: {} }], currentRound: 0,
    };
    const r = tournamentMatchPlayStandings(t);
    expect(r.board.map((e) => [e.player.id, e.points])).toEqual([['a', 0], ['b', 0]]);
    expect(r.status).toBe('All square');
  });

  test('future rounds keep their holes in the remaining count', () => {
    // Round 0 fully played — a wins both holes, lead 2, 0 holes left in R0.
    // Round 1 is a future round (currentRound 0); its 2 holes keep the match
    // alive, so a lead of 2 does NOT yet clinch ("leads by", not "wins").
    const played = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 } },
    };
    const future = { holes, playerHandicaps: {}, scores: {} };
    const t = { players, rounds: [played, future], currentRound: 0 };
    expect(tournamentMatchPlayStandings(t).status).toBe('Alex leads by 2');
  });
});

describe('isGIR', () => {
  test('GIR hit when strokes - putts <= par - 2', () => {
    expect(isGIR({ strokes: 4, putts: 2, par: 4 })).toBe(true);   // 4-2=2 <= 4-2
    expect(isGIR({ strokes: 3, putts: 1, par: 4 })).toBe(true);   // 3-1=2 <= 2
  });
  test('par-3 GIR formula: reached green in 1 stroke', () => {
    expect(isGIR({ strokes: 3, putts: 2, par: 3 })).toBe(true);   // 3-2=1 <= 3-2
    expect(isGIR({ strokes: 4, putts: 2, par: 3 })).toBe(false);  // 4-2=2 > 1
  });
  test('GIR missed when strokes - putts > par - 2', () => {
    expect(isGIR({ strokes: 5, putts: 2, par: 4 })).toBe(false);  // 5-2=3 > 2
    expect(isGIR({ strokes: 6, putts: 3, par: 4 })).toBe(false);
  });
  test('returns null when putts missing', () => {
    expect(isGIR({ strokes: 4, putts: null, par: 4 })).toBeNull();
  });
  test('returns null when strokes missing', () => {
    expect(isGIR({ strokes: null, putts: 2, par: 4 })).toBeNull();
  });
});

describe('recoveryOutcomeFromState', () => {
  test('GIR hit → null (no recovery)', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 2, sandShots: 0, par: 4,
    })).toBeNull();
  });
  test('missed GIR, 1 putt saving par → up-and-down', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 1, sandShots: 0, par: 4,
    })).toBe('up-and-down');
  });
  test('missed GIR, 1 putt saving par from sand → sand-save', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 1, sandShots: 1, par: 4,
    })).toBe('sand-save');
  });
  test('1-putt bogey → null (up-and-down requires par or better)', () => {
    expect(recoveryOutcomeFromState({
      strokes: 5, putts: 1, sandShots: 0, par: 4,
    })).toBeNull();
  });
  test('missed GIR, 2 putts → null (heuristic abstains)', () => {
    expect(recoveryOutcomeFromState({
      strokes: 6, putts: 2, sandShots: 0, par: 4,
    })).toBeNull();
  });
  test('holed-out chip (0 putts) saving par → up-and-down', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 0, sandShots: 0, par: 4,
    })).toBe('up-and-down');
  });
  test('holed-out bunker shot (0 putts) saving par → sand-save', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 0, sandShots: 1, par: 4,
    })).toBe('sand-save');
  });
});

describe('shotDetailStrokeCount', () => {
  test('sums the four counter fields', () => {
    expect(shotDetailStrokeCount({
      putts: 2, teePenalties: 1, otherPenalties: 1, sandShots: 1,
    })).toBe(5);
  });

  test('treats null and missing fields as zero', () => {
    expect(shotDetailStrokeCount({ putts: null })).toBe(0);
    expect(shotDetailStrokeCount({})).toBe(0);
  });

  test('returns 0 for a missing detail', () => {
    expect(shotDetailStrokeCount(null)).toBe(0);
    expect(shotDetailStrokeCount(undefined)).toBe(0);
  });
});

describe('reconcileShotDetail', () => {
  test('returns the input unchanged when the detail already fits', () => {
    const d = { putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 };
    expect(reconcileShotDetail(d, 4)).toBe(d);
  });

  test('returns the input unchanged when strokes is null', () => {
    const d = { putts: 9, teePenalties: 0, otherPenalties: 0, sandShots: 0 };
    expect(reconcileShotDetail(d, null)).toBe(d);
  });

  test('returns the input unchanged when strokes is undefined', () => {
    const d = { putts: 9, teePenalties: 0, otherPenalties: 0, sandShots: 0 };
    expect(reconcileShotDetail(d, undefined)).toBe(d);
  });

  test('trims putts first', () => {
    const r = reconcileShotDetail(
      { putts: 5, teePenalties: 0, otherPenalties: 0, sandShots: 0 }, 3);
    expect(r.putts).toBe(3);
  });

  test('trims sand shots after putts are exhausted', () => {
    // count 5, strokes 2, over by 3: putts 1->0, sandShots 4->2
    const r = reconcileShotDetail(
      { putts: 1, teePenalties: 0, otherPenalties: 0, sandShots: 4 }, 2);
    expect(r.putts).toBe(0);
    expect(r.sandShots).toBe(2);
  });

  test('trims other penalties before tee penalties, both last', () => {
    // count 6, strokes 4, over by 2: otherPenalties 3->1, teePenalties untouched
    const r = reconcileShotDetail(
      { putts: 0, teePenalties: 3, otherPenalties: 3, sandShots: 0 }, 4);
    expect(r.otherPenalties).toBe(1);
    expect(r.teePenalties).toBe(3);
  });

  test('clears firstPuttBucket when putts is trimmed to 0', () => {
    const r = reconcileShotDetail(
      { putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0, firstPuttBucket: '1-2' }, 0);
    expect(r.putts).toBe(0);
    expect(r.firstPuttBucket).toBeNull();
  });

  test('leaves a null putts field as null', () => {
    const r = reconcileShotDetail(
      { putts: null, teePenalties: 5, otherPenalties: 0, sandShots: 0 }, 3);
    expect(r.putts).toBeNull();
    expect(r.teePenalties).toBe(3);
  });

  test('is idempotent', () => {
    const once = reconcileShotDetail(
      { putts: 5, teePenalties: 2, otherPenalties: 0, sandShots: 0 }, 4);
    const twice = reconcileShotDetail(once, 4);
    expect(twice).toBe(once);
  });
});

describe('calcPlayingHandicap with decimal index', () => {
  it('honors a decimal index that crosses an integer band (slope-neutral)', () => {
    // 12.5 × 113/113 = 12.5 → Math.round = 13 (today's parseInt drops to 12 → 12)
    expect(calcPlayingHandicap(12.5, 113, 72, 72)).toBe(13);
  });

  it('honors a decimal index that crosses an integer band (slope 130)', () => {
    // 14.5 × 130/113 ≈ 16.681 → 17 (today: 14 × 130/113 ≈ 16.106 → 16)
    expect(calcPlayingHandicap(14.5, 130, 72, 72)).toBe(17);
  });

  it('matches the integer result when index is whole', () => {
    expect(calcPlayingHandicap(12, 130, 72, 72)).toBe(14);
    expect(calcPlayingHandicap(12.0, 130, 72, 72)).toBe(14);
  });

  it('accepts a string decimal (UI passes strings through)', () => {
    expect(calcPlayingHandicap('12.5', 113, 72, 72)).toBe(13);
  });

  it('falls back to 0 on garbage input', () => {
    expect(calcPlayingHandicap('abc', 113, 72, 72)).toBe(0);
    expect(calcPlayingHandicap(undefined, 113, 72, 72)).toBe(0);
  });

  it('rounds the index to integer when slope is missing (slope=0 fallback)', () => {
    expect(calcPlayingHandicap(12.4, 0, 72, 72)).toBe(12);
    expect(calcPlayingHandicap(12.6, 0, 72, 72)).toBe(13);
    expect(calcPlayingHandicap(17.9, 0, 72, 72)).toBe(18);
  });
});

describe('listRoundConflicts / roundHasConflicts', () => {
  it('returns [] and false when the round has no scoreConflicts', () => {
    const round = { id: 'r1', scores: {} };
    expect(listRoundConflicts(round)).toEqual([]);
    expect(roundHasConflicts(round)).toBe(false);
  });

  it('lists each unresolved conflict as { playerId, hole }, sorted by hole', () => {
    const round = {
      id: 'r1',
      scoreConflicts: {
        p1: { 7: { candidates: [], detectedAt: 1 } },
        p2: { 3: { candidates: [], detectedAt: 1 } },
      },
    };
    expect(listRoundConflicts(round)).toEqual([
      { playerId: 'p2', hole: 3 },
      { playerId: 'p1', hole: 7 },
    ]);
    expect(roundHasConflicts(round)).toBe(true);
  });

  it('ignores cells whose marker was cleared to undefined by a merge', () => {
    const round = { id: 'r1', scoreConflicts: { p1: { 7: undefined } } };
    expect(listRoundConflicts(round)).toEqual([]);
    expect(roundHasConflicts(round)).toBe(false);
  });
});

describe('buildTeamsForMode', () => {
  const four = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('scramblepairs / pairsmatchplay → two teams of two', () => {
    for (const mode of ['scramblepairs', 'pairsmatchplay']) {
      const teams = buildTeamsForMode(mode, four);
      expect(teams).toHaveLength(2);
      expect(teams[0]).toHaveLength(2);
      expect(teams[1]).toHaveLength(2);
      expect(teams.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('scramble3v1 → a team of three and a solo side', () => {
    const teams = buildTeamsForMode('scramble3v1', four);
    expect(teams.map((t) => t.length)).toEqual([3, 1]);
    expect(teams.flat().map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('scramble4 → one team of four', () => {
    const teams = buildTeamsForMode('scramble4', four);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toHaveLength(4);
  });

  it('non-team or invalid roster → singleton pairs', () => {
    expect(buildTeamsForMode('individual', four)).toEqual(four.map((p) => [p]));
    expect(buildTeamsForMode('scramble4', four.slice(0, 3))).toEqual(
      four.slice(0, 3).map((p) => [p]),
    );
  });

  it('existing team mode still routes through randomPairs shape', () => {
    const teams = buildTeamsForMode('stableford', four);
    expect(teams).toHaveLength(2);
    expect(teams.every((t) => t.length === 2)).toBe(true);
  });
});
