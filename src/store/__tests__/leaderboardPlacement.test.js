import { assignPlacements, comparatorForBoardMode } from '../leaderboardPlacement';
import { stablefordComparator } from '../scoring';

describe('assignPlacements', () => {
  test('a two-way tie at the top shares place 1 and is flagged tied', () => {
    const rows = [
      { player: { id: 'a' }, points: 30, strokes: 90 },
      { player: { id: 'b' }, points: 30, strokes: 90 },
      { player: { id: 'c' }, points: 20, strokes: 90 },
    ];
    const result = assignPlacements(rows, stablefordComparator);
    expect(result.map((r) => r.place)).toEqual([1, 1, 3]);
    expect(result.map((r) => r.isTie)).toEqual([true, true, false]);
  });

  test('a fully untied sequence is unchanged: 1,2,3, none flagged as tied', () => {
    const rows = [
      { player: { id: 'a' }, points: 30, strokes: 80 },
      { player: { id: 'b' }, points: 25, strokes: 80 },
      { player: { id: 'c' }, points: 20, strokes: 80 },
    ];
    const result = assignPlacements(rows, stablefordComparator);
    expect(result.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(result.every((r) => r.isTie === false)).toBe(true);
  });

  test('a three-way tie at the top all share place 1; the next player lands at 4', () => {
    const rows = [
      { player: { id: 'a' }, points: 30, strokes: 80 },
      { player: { id: 'b' }, points: 30, strokes: 80 },
      { player: { id: 'c' }, points: 30, strokes: 80 },
      { player: { id: 'd' }, points: 20, strokes: 80 },
    ];
    const result = assignPlacements(rows, stablefordComparator);
    expect(result.map((r) => r.place)).toEqual([1, 1, 1, 4]);
    expect(result.map((r) => r.isTie)).toEqual([true, true, true, false]);
  });

  test('a tie in the middle: 1, 2, 2, 4 (not 1,2,2,3)', () => {
    const rows = [
      { player: { id: 'a' }, points: 40, strokes: 80 },
      { player: { id: 'b' }, points: 30, strokes: 80 },
      { player: { id: 'c' }, points: 30, strokes: 80 },
      { player: { id: 'd' }, points: 20, strokes: 80 },
    ];
    const result = assignPlacements(rows, stablefordComparator);
    expect(result.map((r) => r.place)).toEqual([1, 2, 2, 4]);
    expect(result.map((r) => r.isTie)).toEqual([false, true, true, false]);
  });

  test('a strokes-only tiebreak keeps rows distinct (stablefordComparator, not just points)', () => {
    const rows = [
      { player: { id: 'a' }, points: 30, strokes: 85 },
      { player: { id: 'b' }, points: 30, strokes: 90 },
    ];
    const result = assignPlacements(rows, stablefordComparator);
    expect(result.map((r) => r.place)).toEqual([1, 2]);
    expect(result.every((r) => r.isTie === false)).toBe(true);
  });

  test('empty input returns empty output', () => {
    expect(assignPlacements([], stablefordComparator)).toEqual([]);
  });

  test('a single row is place 1 and not tied', () => {
    const rows = [{ player: { id: 'a' }, points: 10, strokes: 80 }];
    const result = assignPlacements(rows, stablefordComparator);
    expect(result).toEqual([{ player: { id: 'a' }, points: 10, strokes: 80, place: 1, isTie: false }]);
  });

  test('does not mutate the input rows', () => {
    const rows = [{ player: { id: 'a' }, points: 10, strokes: 80 }];
    const result = assignPlacements(rows, stablefordComparator);
    expect(rows[0].place).toBeUndefined();
    expect(result).not.toBe(rows);
    expect(result[0]).not.toBe(rows[0]);
  });

  test('works with a plain points-desc comparator (non-Stableford boards)', () => {
    const pointsComparator = (a, b) => b.points - a.points;
    const rows = [
      { player: { id: 'a' }, points: 5 },
      { player: { id: 'b' }, points: 5 },
      { player: { id: 'c' }, points: 3 },
    ];
    const result = assignPlacements(rows, pointsComparator);
    expect(result.map((r) => r.place)).toEqual([1, 1, 3]);
    expect(result.map((r) => r.isTie)).toEqual([true, true, false]);
  });
});

describe('comparatorForBoardMode', () => {
  test('routes the "stableford" mode to stablefordComparator (points, then strokes)', () => {
    const cmp = comparatorForBoardMode('stableford');
    expect(cmp).toBe(stablefordComparator);
  });

  test('routes modes with no strokes tiebreak wired yet (matchplay, sindicato, pairsmatchplay) to a points-desc comparator', () => {
    for (const mode of ['matchplay', 'sindicato', 'pairsmatchplay']) {
      const cmp = comparatorForBoardMode(mode);
      expect(cmp({ points: 3 }, { points: 5 })).toBeGreaterThan(0);
      expect(cmp({ points: 5 }, { points: 3 })).toBeLessThan(0);
      expect(cmp({ points: 5 }, { points: 5 })).toBe(0);
    }
  });

  test('routes bestball and scramble* modes to stablefordComparator, same as "stableford" (points, then fewer strokes)', () => {
    for (const mode of ['bestball', 'scramblepairs', 'scramble3v1', 'scramble4']) {
      expect(comparatorForBoardMode(mode)).toBe(stablefordComparator);
    }
  });
});
