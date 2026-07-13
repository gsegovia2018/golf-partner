import { applyToTournament } from '../mutate';

function roundWithConflict() {
  return {
    id: 't1',
    rounds: [{
      id: 'r1',
      scores: { p1: { 5: 6 } },
      scoreEntries: {
        p1: { 5: { a: { value: 6, ts: 200 }, b: { value: 4, ts: 100 } } },
      },
    }],
  };
}

describe('conflict.resolve mutation', () => {
  test('sets the chosen score and stamps a resolution', () => {
    const t = roundWithConflict();
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 5, value: 4, resolvedBy: 'a', ts: 400,
    });
    expect(t.rounds[0].scores.p1[5]).toBe(4);
    expect(t.rounds[0].scoreResolutions.p1[5]).toEqual({ value: 4, by: 'a', ts: 400 });
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
