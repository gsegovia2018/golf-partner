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
