import { holeStrokeAccount, shotDetailStrokeCount } from '../scoring';

const spots = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));
const acc = (o) => holeStrokeAccount(o);

describe('holeStrokeAccount', () => {
  test('the case that looked contradictory: 6 strokes, 2 putts, 2 shots marked', () => {
    // 4 strokes are full swings, not putts/penalties/sand; 2 of those swings
    // have no spot on the map. Two different questions, both right.
    expect(acc({ strokes: 6, detail: { putts: 2 }, spots: spots(2) }))
      .toEqual({ leftToAssign: 4, notOnMap: 2 });
  });

  test('leftToAssign matches the shot-detail counters it caps', () => {
    const detail = { putts: 2, teePenalties: 1, otherPenalties: 1, sandShots: 1 };
    expect(acc({ strokes: 8, detail }).leftToAssign).toBe(8 - shotDetailStrokeCount(detail));
    expect(acc({ strokes: 3, detail }).leftToAssign).toBe(0); // never negative
    expect(acc({ strokes: null, detail }).leftToAssign).toBeNull();
    expect(acc({ strokes: 5 }).leftToAssign).toBe(5);
  });

  test('a penalty stroke has no spot, so it is not missing from the map', () => {
    // OB off the tee: tee, penalty, re-tee from the same spot, approach, 2 putts = 6.
    const detail = { putts: 2, teePenalties: 1 };
    expect(acc({ strokes: 6, detail, spots: spots(3) }).notOnMap).toBe(0);
    expect(acc({ strokes: 6, detail, spots: spots(2) }).notOnMap).toBe(1);
    expect(acc({ strokes: 6, detail: { putts: 2, otherPenalties: 1 }, spots: spots(2) }).notOnMap).toBe(1);
  });

  test('sand shots are swings from a spot: they still need a pin', () => {
    expect(acc({ strokes: 5, detail: { putts: 2, sandShots: 1 }, spots: spots(2) }).notOnMap).toBe(1);
  });

  test('a spot on the green is a putt, not another swing', () => {
    const chain = [...spots(2), { id: 'g', onGreen: true }];
    expect(acc({ strokes: 5, detail: { putts: 2 }, spots: chain, isOnGreen: (s) => !!s.onGreen }).notOnMap).toBe(1);
  });

  test('more marked shots than strokes is never negative', () => {
    expect(acc({ strokes: 4, detail: { putts: 2 }, spots: spots(4) }).notOnMap).toBe(0);
  });

  test('zero putts (holed from off the green) still counts', () => {
    expect(acc({ strokes: 3, detail: { putts: 0 }, spots: spots(2) }).notOnMap).toBe(1);
  });

  test('notOnMap stays quiet: no score, putts not entered, a pick-up, nothing marked', () => {
    expect(acc({ strokes: null, detail: { putts: 2 }, spots: spots(2) }).notOnMap).toBeNull();
    expect(acc({ strokes: 0, detail: { putts: 0 }, spots: spots(1) }).notOnMap).toBeNull();
    expect(acc({ strokes: 5, detail: null, spots: spots(2) }).notOnMap).toBeNull();
    expect(acc({ strokes: 5, detail: { teePenalties: 1 }, spots: spots(2) }).notOnMap).toBeNull();
    expect(acc({ strokes: 8, detail: { putts: 2 }, spots: spots(2), pickedUp: true }).notOnMap).toBeNull();
    expect(acc({ strokes: 5, detail: { putts: 2 }, spots: [] }).notOnMap).toBeNull();
  });
});
