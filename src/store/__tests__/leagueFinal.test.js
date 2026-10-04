import {
  suggestFinalStrokes, applyFinalStrokes, finalStrokeList, finalStrokesRecord, clampFinalStrokes,
} from '../leagueFinal';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));

describe('suggestFinalStrokes', () => {
  test('1st gets 0 and each lower place one more', () => {
    const table = ['a', 'b', 'c', 'd'].map((userId, i) => ({ userId, place: i + 1 }));
    expect(suggestFinalStrokes(table)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });

  test('capped at 10', () => {
    const table = Array.from({ length: 14 }, (_, i) => ({ userId: `u${i}`, place: i + 1 }));
    const out = suggestFinalStrokes(table);
    expect(out.u10).toBe(10);
    expect(out.u13).toBe(10);
  });

  test('tied members share a place and the next place is one more', () => {
    const table = [
      { userId: 'a', place: 1 }, { userId: 'b', place: 1 }, { userId: 'c', place: 3 },
    ];
    expect(suggestFinalStrokes(table)).toEqual({ a: 0, b: 0, c: 1 });
  });

  test('no places yet: falls back to position', () => {
    expect(suggestFinalStrokes([{ userId: 'a', place: null }, { userId: 'b', place: null }]))
      .toEqual({ a: 0, b: 1 });
  });

  test('empty', () => {
    expect(suggestFinalStrokes([])).toEqual({});
  });
});

test('clampFinalStrokes bounds and rounds', () => {
  expect(clampFinalStrokes(-3)).toBe(0);
  expect(clampFinalStrokes(11)).toBe(10);
  expect(clampFinalStrokes('2')).toBe(2);
  expect(clampFinalStrokes(undefined)).toBe(0);
});

describe('applyFinalStrokes', () => {
  const players = [
    { id: 'p1', name: 'A', handicap: 10, user_id: 'u1' },
    { id: 'p2', name: 'B', handicap: 20, user_id: 'u2' },
    { id: 'p3', name: 'Guest', handicap: 30, user_id: null },
  ];
  const round = {
    holes, tees: [], playerTees: null,
    playerHandicaps: { p1: 11, p2: 22, p3: 33 }, manualHandicaps: { p3: true },
  };

  test('adds to the computed playing handicap and flags manual only for raised players', () => {
    const out = applyFinalStrokes(round, players, { u1: 0, u2: 3 });
    expect(out.playerHandicaps).toEqual({ p1: 11, p2: 25, p3: 33 });
    expect(out.manualHandicaps).toEqual({ p3: true, p2: true });
    expect(round.playerHandicaps.p2).toBe(22);
  });

  test('derives the base when the round has no stored handicap', () => {
    const out = applyFinalStrokes({ ...round, playerHandicaps: {} }, [players[0]], { u1: 2 });
    expect(out.playerHandicaps.p1).toBe(12);
  });

  test('no extra strokes leaves the round untouched', () => {
    const out = applyFinalStrokes(round, players, { u1: 0 });
    expect(out.playerHandicaps).toEqual(round.playerHandicaps);
    expect(out.manualHandicaps).toEqual(round.manualHandicaps);
  });
});

test('finalStrokeList and finalStrokesRecord', () => {
  const players = [{ id: 'p1', user_id: 'u1' }, { id: 'p2', user_id: 'u2' }, { id: 'p3', user_id: null }];
  expect(finalStrokeList(players, { u1: 0, u2: 2 }).map((r) => [r.player.id, r.extra])).toEqual([['p2', 2]]);
  expect(finalStrokesRecord(players, { u1: 0, u2: 2 })).toEqual({ u1: 0, u2: 2 });
});
