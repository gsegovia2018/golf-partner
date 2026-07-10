import { applyToTournament, metaPathFor } from '../mutate';

describe('index.set mutation', () => {
  test('records a per-round index override for a player', () => {
    const t = { rounds: [{ id: 'r1', playerHandicaps: { p1: 12 } }] };

    applyToTournament(t, { type: 'index.set', roundId: 'r1', playerId: 'p1', index: 18 });

    expect(t.rounds[0].playerIndexes).toEqual({ p1: 18 });
    // The playing handicap is written on its own handicap.set path — index.set
    // only records the index.
    expect(t.rounds[0].playerHandicaps).toEqual({ p1: 12 });
  });

  test('merges into existing playerIndexes without clobbering others', () => {
    const t = { rounds: [{ id: 'r1', playerIndexes: { p2: 9 } }] };

    applyToTournament(t, { type: 'index.set', roundId: 'r1', playerId: 'p1', index: 20 });

    expect(t.rounds[0].playerIndexes).toEqual({ p2: 9, p1: 20 });
  });

  test('no-ops for an unknown round', () => {
    const t = { rounds: [{ id: 'r1' }] };
    applyToTournament(t, { type: 'index.set', roundId: 'zzz', playerId: 'p1', index: 5 });
    expect(t.rounds[0].playerIndexes).toBeUndefined();
  });

  test('stamps the per-round playerIndexes sync path', () => {
    expect(metaPathFor({ type: 'index.set', roundId: 'r1', playerId: 'p1' }))
      .toBe('rounds.r1.playerIndexes.p1');
  });
});
