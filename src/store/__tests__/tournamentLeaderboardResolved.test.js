import { tournamentLeaderboardResolved } from '../tournamentStore';

const holes = [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }];
const P = (id) => ({ id, name: id, handicap: 0 });

test('uniform stableford tournament -> stableford board, unit pts', () => {
  const t = {
    players: [P('a'), P('b')],
    settings: { scoringMode: 'stableford' },
    rounds: [{ id: 'r0', holes, scores: { a: { 1: 4 }, b: { 1: 5 } } }],
  };
  const { unit, entries } = tournamentLeaderboardResolved(t);
  expect(unit).toBe('pts');
  expect(entries[0].player.id).toBe('a');
});

test('mixed-mode tournament -> stableford fallback', () => {
  const t = {
    players: [P('a'), P('b'), P('c')],
    settings: { scoringMode: 'stableford' },
    rounds: [
      { id: 'r0', holes, scores: { a: { 1: 4 } } },
      { id: 'r1', scoringMode: 'sindicato', holes, scores: { a: { 1: 4 } } },
    ],
  };
  const { entries } = tournamentLeaderboardResolved(t);
  expect(Array.isArray(entries)).toBe(true);
  expect(entries.length).toBe(3);
});
