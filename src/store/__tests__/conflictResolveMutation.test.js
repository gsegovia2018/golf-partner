import { applyToTournament } from '../mutate';

function roundWithConflict() {
  return {
    id: 't1',
    rounds: [{
      id: 'r1',
      scores: { p1: { 5: 6 } },
      scoreConflicts: {
        p1: { 5: { candidates: [{ value: 6, ts: 200 }, { value: 4, ts: 100 }], detectedAt: 300 } },
      },
    }],
  };
}

describe('conflict.resolve mutation', () => {
  test('sets the chosen score and clears the conflict marker', () => {
    const t = roundWithConflict();
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 5, value: 4,
    });
    expect(t.rounds[0].scores.p1[5]).toBe(4);
    expect(t.rounds[0].scoreConflicts.p1[5]).toBeUndefined();
  });

  test('is a no-op for an unknown round', () => {
    const t = roundWithConflict();
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'rX', playerId: 'p1', hole: 5, value: 4,
    });
    expect(t.rounds[0].scores.p1[5]).toBe(6);
  });

  test('sets the score even when the cell has no marker', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 7, value: 3,
    });
    expect(t.rounds[0].scores.p1[7]).toBe(3);
  });
});
