import { buildShotRoundIndex, shotRoundContext, shotRoundKey } from '../shotRounds';

const tournaments = [{
  id: 't1',
  name: 'Weekender',
  createdAt: '2026-05-01',
  rounds: [
    { id: 'r1', courseName: 'La Faisanera', courseId: 'c1', holes: [{ number: 4, par: 4, strokeIndex: 7 }] },
    { id: 'r2', courseName: 'Olivar de la Hinojosa', holes: [] },
  ],
}];

describe('buildShotRoundIndex', () => {
  it('keys every round by its id and position', () => {
    const idx = buildShotRoundIndex(tournaments);
    expect(idx.get(shotRoundKey('r1', 0)).courseName).toBe('La Faisanera');
    expect(idx.get(shotRoundKey('r2', 1)).courseName).toBe('Olivar de la Hinojosa');
  });

  it('skips rounds with no id — a shot could never reference them', () => {
    const idx = buildShotRoundIndex([{ id: 't', rounds: [{ courseName: 'X' }] }]);
    expect(idx.size).toBe(0);
  });
});

describe('shotRoundContext', () => {
  const idx = buildShotRoundIndex(tournaments);

  it('resolves a carry to its course and that round’s hole metadata', () => {
    const ctx = shotRoundContext(idx, { roundId: 'r1', roundIndex: 0, holeNumber: 4 });
    expect(ctx).toMatchObject({
      courseName: 'La Faisanera', holeNumber: 4, par: 4, strokeIndex: 7,
    });
  });

  it('returns null for an unknown round', () => {
    expect(shotRoundContext(idx, { roundId: 'gone', roundIndex: 0, holeNumber: 1 })).toBeNull();
  });

  it('leaves par/SI null when the round has no hole list', () => {
    const ctx = shotRoundContext(idx, { roundId: 'r2', roundIndex: 1, holeNumber: 3 });
    expect(ctx.par).toBeNull();
    expect(ctx.strokeIndex).toBeNull();
  });

  it('returns null without a carry or an index', () => {
    expect(shotRoundContext(null, { roundId: 'r1', roundIndex: 0, holeNumber: 4 })).toBeNull();
    expect(shotRoundContext(idx, null)).toBeNull();
  });
});
