import { roundLeaderboard } from '../tournamentStore';

const holes = [
  { number: 1, par: 4, strokeIndex: 1 },
  { number: 2, par: 4, strokeIndex: 2 },
];
const P = (id, name = id, handicap = 0) => ({ id, name, handicap });

test('stableford: ranks by points then strokes, entries carry player/points/strokes', () => {
  const players = [P('a'), P('b')];
  const round = { id: 'r0', holes, scores: { a: { 1: 4, 2: 4 }, b: { 1: 4, 2: 5 } } };
  const t = { players, settings: { scoringMode: 'stableford' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('stableford');
  expect(unit).toBe('pts');
  expect(entries[0].player.id).toBe('a'); // same points, fewer strokes
  expect(entries[0]).toMatchObject({ points: expect.any(Number), strokes: expect.any(Number) });
});

test('matchplay: two per-player entries carrying holes won, unit = holes', () => {
  const players = [P('a'), P('b')];
  const round = { id: 'r0', scoringMode: 'matchplay', holes, scores: { a: { 1: 3, 2: 4 }, b: { 1: 5, 2: 4 } } };
  const t = { players, settings: { scoringMode: 'matchplay' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('matchplay');
  expect(unit).toBe('holes');
  expect(entries).toHaveLength(2);
  expect(entries[0].player.id).toBe('a');
});

test('empty round yields entries array, never throws', () => {
  const t = { players: [P('a'), P('b')], settings: { scoringMode: 'matchplay' }, rounds: [] };
  expect(Array.isArray(roundLeaderboard(t, { id: 'x', scoringMode: 'matchplay', holes, scores: {} }).entries)).toBe(true);
});

test('sindicato: 3-player round-robin points, sorted descending, entries carry player/points/strokes', () => {
  // Hole 1: 4/5/6 -> 4/2/0. Hole 2: 4/5/5 -> 4/1/1. Totals: a8, b3, c1.
  const players = [P('a'), P('b'), P('c')];
  const round = {
    id: 'r0',
    holes,
    playerHandicaps: {},
    scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
  };
  const t = { players, settings: { scoringMode: 'sindicato' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('sindicato');
  expect(unit).toBe('pts');
  expect(entries).toHaveLength(3);
  expect(entries.map((e) => [e.player.id, e.points, e.strokes])).toEqual([
    ['a', 8, 8],
    ['b', 3, 10],
    ['c', 1, 11],
  ]);
});

test('pairsmatchplay: each player carries their own duel points, sorted descending', () => {
  // team1 (a,b) sweeps all duels on both holes: duel a-vs-c and duel b-vs-d,
  // each decided in a's/b's favor on both holes -> a 2, b 2, c 0, d 0.
  const pmpHoles = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];
  const players = [P('a'), P('b'), P('c'), P('d')];
  const round = {
    id: 'r0',
    holes: pmpHoles,
    pairs: [[P('a'), P('b')], [P('c'), P('d')]],
    playerHandicaps: {},
    scores: {
      a: { 1: 3, 2: 3 }, c: { 1: 5, 2: 5 },
      b: { 1: 3, 2: 3 }, d: { 1: 5, 2: 5 },
    },
  };
  const t = { players, settings: { scoringMode: 'pairsmatchplay' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('pairsmatchplay');
  expect(unit).toBe('pts');
  expect(entries).toHaveLength(4);
  const byId = Object.fromEntries(entries.map((e) => [e.player.id, e.points]));
  expect(byId.a).toBe(2); // a's own duel points (vs c), not the team total
  expect(byId.b).toBe(2); // b's own duel points (vs d), not the team total
  expect(byId.c).toBe(0);
  expect(byId.d).toBe(0);
  expect(entries[0].points).toBe(2);
  expect(entries[3].points).toBe(0);
});

test('scramble: teammates carry the shared team points and strokes', () => {
  // Team a/b (captain a): birdie then par -> 5 pts, 7 strokes.
  // Team c/d (captain c): par then bogey -> 3 pts, 9 strokes.
  const scrambleHoles = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];
  const players = [P('a'), P('b'), P('c'), P('d')];
  const round = {
    id: 'r0',
    holes: scrambleHoles,
    scoringMode: 'scramblepairs',
    pairs: [[P('a'), P('b')], [P('c'), P('d')]],
    playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
    scores: { a: { 1: 3, 2: 4 }, c: { 1: 4, 2: 5 } },
  };
  const t = { players, settings: { scoringMode: 'scramblepairs' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('scramblepairs');
  expect(unit).toBe('pts');
  expect(entries.map((e) => e.player.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  const byId = Object.fromEntries(entries.map((e) => [e.player.id, e]));
  expect(byId.a).toMatchObject({ points: 5, strokes: 7 });
  expect(byId.b).toMatchObject({ points: 5, strokes: 7 }); // shares team a/b's tally
  expect(byId.c).toMatchObject({ points: 3, strokes: 9 });
  expect(byId.d).toMatchObject({ points: 3, strokes: 9 }); // shares team c/d's tally
});

test('bestball: points = bestWon*bestBallValue + worstWon*worstBallValue per player', () => {
  // Pair A (a1,a2): birdie (3pts) + par (2pts). Pair B (b1,b2): bogey (1pt) + double bogey (0pts).
  // Pair A's best (3) beats pair B's best (1) -> a1 wins best ball.
  // Pair A's worst (2) beats pair B's worst (0) -> a2 wins worst ball.
  const bbHoles = [{ number: 1, par: 4, strokeIndex: 1 }];
  const players = [P('a1'), P('a2'), P('b1'), P('b2')];
  const round = {
    id: 'r0',
    holes: bbHoles,
    pairs: [[P('a1'), P('a2')], [P('b1'), P('b2')]],
    playerHandicaps: { a1: 0, a2: 0, b1: 0, b2: 0 },
    scores: { a1: { 1: 3 }, a2: { 1: 4 }, b1: { 1: 5 }, b2: { 1: 6 } },
  };
  const t = {
    players,
    settings: { scoringMode: 'bestball', bestBallValue: 2, worstBallValue: 3 },
    rounds: [round],
  };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('bestball');
  expect(unit).toBe('pts');
  expect(entries).toHaveLength(4);
  const byId = Object.fromEntries(entries.map((e) => [e.player.id, e.points]));
  expect(byId.a1).toBe(2); // bestWon 1 * bestBallValue 2
  expect(byId.a2).toBe(3); // worstWon 1 * worstBallValue 3
  expect(byId.b1).toBe(0);
  expect(byId.b2).toBe(0);
  entries.forEach((e) => expect(e).toMatchObject({ player: expect.any(Object), points: expect.any(Number) }));
});
