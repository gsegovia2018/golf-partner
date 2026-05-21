import { holePoints, roundTotals } from '../scoreModel';

const holes = [
  { number: 1, par: 4, strokeIndex: 5 },
  { number: 2, par: 3, strokeIndex: 11 },
];
const players = [
  { id: 'a', name: 'Ana', handicap: 0 },
  { id: 'b', name: 'Ben', handicap: 0 },
];
const handicaps = { a: 0, b: 0 };

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
