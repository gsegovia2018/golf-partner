import { holePoints, roundTotals, summaryState } from '../scoreModel';

const holes = [
  { number: 1, par: 4, strokeIndex: 5 },
  { number: 2, par: 3, strokeIndex: 11 },
];
const players = [
  { id: 'a', name: 'Ana', handicap: 0 },
  { id: 'b', name: 'Ben', handicap: 0 },
];
const handicaps = { a: 0, b: 0 };

const sindicatoPlayers = [
  { id: 'a', name: 'Ana', handicap: 0 },
  { id: 'b', name: 'Ben', handicap: 0 },
  { id: 'c', name: 'Cal', handicap: 0 },
];
const sindicatoHandicaps = { a: 0, b: 0, c: 0 };

describe('holePoints', () => {
  test('stableford: par = 2 points, birdie = 3', () => {
    const scores = { a: { 1: 4 }, b: { 1: 3 } };
    const pts = holePoints({ mode: 'stableford', hole: holes[0], players, scores, handicaps });
    expect(pts).toEqual({ a: 2, b: 3 });
  });

  test('unscored hole yields null for that player', () => {
    const scores = { a: { 1: 4 } };
    const pts = holePoints({ mode: 'stableford', hole: holes[0], players, scores, handicaps });
    expect(pts.a).toBe(2);
    expect(pts.b).toBeNull();
  });

  test('bestball scores per player exactly like stableford', () => {
    const scores = { a: { 1: 4 }, b: { 1: 3 } };
    expect(holePoints({ mode: 'bestball', hole: holes[0], players, scores, handicaps }))
      .toEqual({ a: 2, b: 3 });
  });

  test('matchplay: hole winner gets 1, loser 0', () => {
    const scores = { a: { 1: 3 }, b: { 1: 5 } };
    const pts = holePoints({ mode: 'matchplay', hole: holes[0], players, scores, handicaps });
    expect(pts).toEqual({ a: 1, b: 0 });
  });

  describe('sindicato', () => {
    test('three distinct net scores → 4/2/0 split (lowest gets 4, middle 2, highest 0)', () => {
      // All handicap 0, strokeIndex 5 → no extra shots, net = gross.
      // Scores: a=3 (lowest), b=4 (middle), c=5 (highest)
      const scores = { a: { 1: 3 }, b: { 1: 4 }, c: { 1: 5 } };
      const pts = holePoints({
        mode: 'sindicato',
        hole: holes[0],
        players: sindicatoPlayers,
        scores,
        handicaps: sindicatoHandicaps,
      });
      expect(pts).toEqual({ a: 4, b: 2, c: 0 });
    });

    test('one player has not scored → every player entry is null', () => {
      // Player c has no score for hole 1; sindicatoHolePoints returns null for the whole hole.
      const scores = { a: { 1: 3 }, b: { 1: 4 } };
      const pts = holePoints({
        mode: 'sindicato',
        hole: holes[0],
        players: sindicatoPlayers,
        scores,
        handicaps: sindicatoHandicaps,
      });
      expect(pts.a).toBeNull();
      expect(pts.b).toBeNull();
      expect(pts.c).toBeNull();
    });
  });
});

describe('roundTotals', () => {
  test('sums strokes, points and par across scored holes', () => {
    const scores = { a: { 1: 4, 2: 3 }, b: { 1: 5 } };
    const round = { holes };
    const totals = roundTotals({ mode: 'stableford', round, players, scores, handicaps });
    expect(totals.get('a')).toEqual({ pts: 4, str: 7, parPlayed: 7 });
    expect(totals.get('b')).toEqual({ pts: 1, str: 5, parPlayed: 4 });
  });
});

describe('summaryState', () => {
  test('solo variant with no holes scored returns em dash for vsParLabel', () => {
    const round = { holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
    const solo = [{ id: 'a', name: 'Ana', handicap: 0 }];
    const s = summaryState({
      mode: 'stableford', round, players: solo,
      scores: {}, settings: {}, currentHole: 1, meId: 'a',
    });
    expect(s.variant).toBe('solo');
    expect(s.solo.vsParLabel).toBe('—');
    expect(s.solo.str).toBe(0);
    expect(s.solo.pts).toBe(0);
  });

  test('solo variant returns the stat ribbon', () => {
    const round = { holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
    const solo = [{ id: 'a', name: 'Ana', handicap: 0 }];
    const s = summaryState({
      mode: 'stableford', round, players: solo,
      scores: { a: { 1: 3 } }, settings: {}, currentHole: 1, meId: 'a',
    });
    expect(s.variant).toBe('solo');
    expect(s.solo).toEqual({ str: 3, pts: 3, vsParLabel: '-1' });
  });

  test('players variant lists chips, me first, leader flagged', () => {
    const round = { holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
    const playersTwo = [
      { id: 'a', name: 'Ana', handicap: 0 },
      { id: 'b', name: 'Ben', handicap: 0 },
    ];
    const s = summaryState({
      mode: 'stableford', round, players: playersTwo,
      scores: { a: { 1: 3 }, b: { 1: 5 } },
      settings: {}, currentHole: 1, meId: 'b',
    });
    expect(s.variant).toBe('players');
    expect(s.chips.map((c) => c.id)).toEqual(['b', 'a']);
    expect(s.chips.find((c) => c.id === 'a').isLeader).toBe(true);
  });

  test('matchplay: 1v1 players variant — 2 chips, leader has higher points', () => {
    // Match Play is strictly 1 vs 1 — exactly 2 individual players.
    // Two par-4 holes, all handicap 0. Ana wins hole 1 (3 vs 5),
    // hole 2 halved (4 vs 4). Ana leads 1-0.
    const round = {
      holes: [
        { number: 1, par: 4, strokeIndex: 1 },
        { number: 2, par: 4, strokeIndex: 2 },
      ],
    };
    const matchPlayers = [
      { id: 'a', name: 'Ana Diaz', handicap: 0 },
      { id: 'b', name: 'Ben Cruz', handicap: 0 },
    ];
    const s = summaryState({
      mode: 'matchplay', round, players: matchPlayers,
      scores: { a: { 1: 3, 2: 4 }, b: { 1: 5, 2: 4 } },
      settings: {}, currentHole: 2, meId: 'b',
    });
    expect(s.variant).toBe('players');
    expect(s.eyebrow).toBe('MATCH PLAY');
    expect(s.chips).toHaveLength(2);
    // me-first: Ben then Ana.
    expect(s.chips.map((c) => c.id)).toEqual(['b', 'a']);
    const ana = s.chips.find((c) => c.id === 'a');
    const ben = s.chips.find((c) => c.id === 'b');
    expect(ana.points).toBe(1);
    expect(ben.points).toBe(0);
    expect(ana.points).toBeGreaterThan(ben.points);
    expect(ana.isLeader).toBe(true);
    expect(ben.isLeader).toBe(false);
  });

  test('pairs variant — best ball: two pairs with combined names and round points', () => {
    // Two pairs of two, all handicap 0, single par-4 hole (SI 1).
    // pair1: p1 strokes 3 (birdie, 3 pts), p2 strokes 5 (bogey, 1 pt)
    // pair2: p3 strokes 4 (par, 2 pts), p4 strokes 6 (double, 0 pts)
    // best ball: best of pair1 = 3, best of pair2 = 2 -> pair1 wins best ball
    // worst ball: worst of pair1 = 1, worst of pair2 = 0 -> pair1 wins worst ball
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      pairs: [
        [{ id: 'p1', name: 'Ann Lee', handicap: 0 }, { id: 'p2', name: 'Bob Ray', handicap: 0 }],
        [{ id: 'p3', name: 'Cam Fox', handicap: 0 }, { id: 'p4', name: 'Dan Oak', handicap: 0 }],
      ],
    };
    const pairsPlayers = round.pairs.flat();
    const s = summaryState({
      mode: 'bestball', round, players: pairsPlayers,
      scores: { p1: { 1: 3 }, p2: { 1: 5 }, p3: { 1: 4 }, p4: { 1: 6 } },
      settings: { bestBallValue: 1, worstBallValue: 1 },
      currentHole: 1, meId: 'p1',
    });
    expect(s.variant).toBe('pairs');
    expect(s.eyebrow).toBe('BEST BALL');
    expect(s.pairs).toHaveLength(2);
    expect(s.pairs[0].name).toBe('Ann & Bob');
    expect(s.pairs[1].name).toBe('Cam & Dan');
    // pair1 won both best and worst ball -> 2 round points; pair2 -> 0.
    expect(s.pairs[0].roundPts).toBe(2);
    expect(s.pairs[1].roundPts).toBe(0);
    expect(s.pairs[0].holePts).toBe(2);
  });

  test('players variant — sindicato: three players, leader status', () => {
    // Two holes, all handicap 0. sindicato awards 4/2/0 by net rank per hole.
    const round = {
      holes: [
        { number: 1, par: 4, strokeIndex: 1 },
        { number: 2, par: 4, strokeIndex: 2 },
      ],
    };
    const tri = [
      { id: 'a', name: 'Ana Diaz', handicap: 0 },
      { id: 'b', name: 'Ben Cruz', handicap: 0 },
      { id: 'c', name: 'Cal Vega', handicap: 0 },
    ];
    // Hole 1: a=3,b=4,c=5 -> a 4, b 2, c 0
    // Hole 2: a=3,b=4,c=5 -> a 4, b 2, c 0
    // Totals: a 8, b 4, c 0. a leads by 4, both holes played, none left.
    const s = summaryState({
      mode: 'sindicato', round, players: tri,
      scores: {
        a: { 1: 3, 2: 3 }, b: { 1: 4, 2: 4 }, c: { 1: 5, 2: 5 },
      },
      settings: {}, currentHole: 2, meId: 'b',
    });
    expect(s.variant).toBe('players');
    expect(s.eyebrow).toBe('SINDICATO');
    expect(s.chips.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(s.chips.find((c) => c.id === 'a').points).toBe(8);
    expect(s.chips.find((c) => c.id === 'a').isLeader).toBe(true);
  });
});
