import {
  STANDARD_SLOPE,
  totalParFromHoles,
  calcPlayingHandicap,
  deriveRoundPlayingHandicap,
  getPlayingHandicap,
  recomputeRoundPlayingHandicaps,
  normalizeRoundHandicaps,
  calcExtraShots,
  calcStablefordPoints,
  matchPlayHolePts,
  matchPlayRoundTally,
  pickupStrokes,
  randomPairs,
  isRoundPlayed,
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
