import { monthResults, seasonTable, DEFAULT_POINTS_TABLE } from '../leagueStandings';

// Ranked by net differential, lower is better. `points` (Stableford) is
// secondary and carried through as cardPoints.
const card = (userId, netDifferential, status = 'confirmed', points = 36) => ({
  userId, status, netDifferential, points,
});
const byUser = (rows) => Object.fromEntries(rows.map((r) => [r.userId, r]));

describe('DEFAULT_POINTS_TABLE', () => {
  test('is the 12-place league table', () => {
    expect(DEFAULT_POINTS_TABLE).toEqual([500, 300, 190, 135, 110, 90, 75, 60, 45, 35, 25, 15]);
  });
});

describe('monthResults', () => {
  test('ranks by net differential (lowest first) with the table, no ties', () => {
    const rows = monthResults([card('a', 10), card('b', 4), card('c', 7)], ['a', 'b', 'c']);
    expect(rows.map((r) => [r.userId, r.place, r.seasonPoints, r.isTie])).toEqual([
      ['b', 1, 500, false],
      ['c', 2, 300, false],
      ['a', 3, 190, false],
    ]);
    expect(rows[0].netDifferential).toBe(4);
    expect(rows[0].cardPoints).toBe(36);
  });

  test('a tie for 2nd shares (300+190)/2 and the next player is 4th', () => {
    const rows = byUser(monthResults(
      [card('a', 2), card('b', 4), card('c', 4), card('d', 6)],
      ['a', 'b', 'c', 'd'],
    ));
    expect(rows.b).toMatchObject({ place: 2, isTie: true, seasonPoints: 245 });
    expect(rows.c).toMatchObject({ place: 2, isTie: true, seasonPoints: 245 });
    expect(rows.d).toMatchObject({ place: 4, isTie: false, seasonPoints: 135 });
  });

  test('a three-way tie for 1st shares (500+300+190)/3', () => {
    const rows = monthResults([card('a', 4), card('b', 4), card('c', 4), card('d', 10)], ['a', 'b', 'c', 'd']);
    rows.slice(0, 3).forEach((r) => {
      expect(r.place).toBe(1);
      expect(r.isTie).toBe(true);
      expect(r.seasonPoints).toBeCloseTo(990 / 3, 10);
    });
    expect(rows[3]).toMatchObject({ userId: 'd', place: 4, seasonPoints: 135 });
  });

  test('a tie for last place shares the last positions', () => {
    const rows = byUser(monthResults([card('a', 0), card('b', 10), card('c', 10)], ['a', 'b', 'c']));
    expect(rows.a.seasonPoints).toBe(500);
    expect(rows.b).toMatchObject({ place: 2, isTie: true, seasonPoints: 245 });
    expect(rows.c).toMatchObject({ place: 2, isTie: true, seasonPoints: 245 });
  });

  test('positions beyond the table score 0, and a tie straddling the end shares the remainder', () => {
    const table = [10, 5];
    const rows = byUser(monthResults(
      [card('a', 0), card('b', 10), card('c', 10), card('d', 20)],
      ['a', 'b', 'c', 'd'],
      table,
    ));
    expect(rows.a.seasonPoints).toBe(10);
    expect(rows.b.seasonPoints).toBe((5 + 0) / 2);
    expect(rows.c.seasonPoints).toBe(2.5);
    expect(rows.d).toMatchObject({ place: 4, seasonPoints: 0 });
  });

  test('a 13th player gets 0 from the default table', () => {
    const members = Array.from({ length: 13 }, (_, i) => `m${i}`);
    const cards = members.map((m, i) => card(m, i));
    const rows = monthResults(cards, members);
    expect(rows[11].seasonPoints).toBe(15);
    expect(rows[12]).toMatchObject({ place: 13, seasonPoints: 0 });
  });

  test('members without a confirmed card get null place and 0 points, listed last', () => {
    const rows = monthResults([card('a', 10)], ['z', 'a', 'y']);
    expect(rows.map((r) => r.userId)).toEqual(['a', 'z', 'y']);
    expect(rows[1]).toEqual({
      userId: 'z', place: null, isTie: false, netDifferential: null, cardPoints: 0, seasonPoints: 0,
    });
    expect(rows[2].place).toBeNull();
  });

  test('cards that are not confirmed are ignored', () => {
    const rows = byUser(monthResults(
      [card('a', -5, 'submitted'), card('b', -4, 'announced'), card('c', -3, 'playing'),
        card('d', -2, 'void'), card('e', 20)],
      ['a', 'b', 'c', 'd', 'e'],
    ));
    expect(rows.e).toMatchObject({ place: 1, seasonPoints: 500 });
    ['a', 'b', 'c', 'd'].forEach((u) => expect(rows[u]).toMatchObject({ place: null, seasonPoints: 0 }));
  });

  test('accepts member objects, and ranks a confirmed card from someone who left', () => {
    const rows = monthResults([card('gone', 0), card('a', 10)], [{ userId: 'a' }, { userId: 'b' }]);
    expect(rows.map((r) => [r.userId, r.place])).toEqual([['gone', 1], ['a', 2], ['b', null]]);
  });

  test('negative net differentials (better than handicap) rank ahead; ties to one decimal share', () => {
    const rows = byUser(monthResults(
      [card('a', -2.4), card('b', 1.3), card('c', -2.4), card('d', 0)],
      ['a', 'b', 'c', 'd'],
    ));
    expect(rows.a).toMatchObject({ place: 1, isTie: true, seasonPoints: 400, netDifferential: -2.4 });
    expect(rows.c).toMatchObject({ place: 1, isTie: true, seasonPoints: 400 });
    expect(rows.d).toMatchObject({ place: 3, seasonPoints: 190 });
    expect(rows.b).toMatchObject({ place: 4, seasonPoints: 135 });
  });

  test('values equal to one decimal tie even with float noise or string input', () => {
    const rows = byUser(monthResults([card('a', 11.8 - 14.2), card('b', '-2.4')], ['a', 'b']));
    expect(rows.a).toMatchObject({ place: 1, isTie: true });
    expect(rows.b).toMatchObject({ place: 1, isTie: true, netDifferential: -2.4 });
  });

  test("a member's best card is the lowest net differential, not the most points", () => {
    const rows = monthResults(
      [card('a', 3.0, 'confirmed', 40), card('a', 1.5, 'confirmed', 30), card('b', 2.0)],
      ['a', 'b'],
    );
    expect(rows[0]).toMatchObject({ userId: 'a', place: 1, netDifferential: 1.5, cardPoints: 30 });
  });

  test('a confirmed card without a net differential is not ranked (unrated)', () => {
    const rows = monthResults(
      [card('a', null, 'confirmed', 44), card('b', 5.1), card('c', undefined)],
      ['a', 'b', 'c', 'd'],
    );
    expect(rows.map((r) => [r.userId, r.place])).toEqual([['b', 1], ['a', null], ['c', null], ['d', null]]);
    expect(rows[1]).toEqual({
      userId: 'a', place: null, isTie: false, unrated: true, netDifferential: null, cardPoints: 44, seasonPoints: 0,
    });
    expect(rows[3].unrated).toBeUndefined();
  });

  test('a rated card beats an unrated one from the same member', () => {
    const rows = monthResults([card('a', null), card('a', 7.7)], ['a']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ place: 1, netDifferential: 7.7 });
    expect(rows[0].unrated).toBeUndefined();
  });

  test('empty month: everyone unplaced', () => {
    const rows = monthResults([], ['a', 'b']);
    expect(rows.every((r) => r.place === null && r.seasonPoints === 0)).toBe(true);
    expect(monthResults(undefined, undefined)).toEqual([]);
  });
});

describe('seasonTable', () => {
  const members = ['nacho', 'javi', 'you', 'dani', 'pablo', 'alvaro', 'ruben'];

  test('September example: Nacho 500, Javi & You T2 245, Dani 135, Pablo 110, Alvaro 90, Ruben 0', () => {
    const table = seasonTable(members, {
      '2026-09': [
        card('nacho', 2), card('javi', 4), card('you', 4),
        card('dani', 6), card('pablo', 7), card('alvaro', 10),
      ],
    });
    expect(table.map((r) => [r.userId, r.total, r.place, r.isTie])).toEqual([
      ['nacho', 500, 1, false],
      ['javi', 245, 2, true],
      ['you', 245, 2, true],
      ['dani', 135, 4, false],
      ['pablo', 110, 5, false],
      ['alvaro', 90, 6, false],
      ['ruben', 0, 7, false],
    ]);
    expect(table[1].byMonth['2026-09']).toEqual({ place: 2, isTie: true, seasonPoints: 245 });
    expect(table[6].byMonth['2026-09']).toEqual({ place: null, isTie: false, seasonPoints: 0 });
  });

  test('sums across months and orders by total', () => {
    const table = seasonTable(['a', 'b', 'c'], {
      '2026-09': [card('a', 4), card('b', 10), card('c', 12)],
      '2026-10': [card('b', 2), card('c', 7), card('a', 20)],
    });
    expect(table.map((r) => [r.userId, r.total])).toEqual([
      ['b', 300 + 500], ['a', 500 + 190], ['c', 190 + 300],
    ].sort((x, y) => y[1] - x[1]));
    const b = table.find((r) => r.userId === 'b');
    expect(Object.keys(b.byMonth)).toEqual(['2026-09', '2026-10']);
  });

  test('lastMonthDelta is the most recent month with a confirmed card', () => {
    const table = seasonTable(['a', 'b'], {
      '2026-10': [card('a', 10, 'submitted')], // nothing confirmed yet
      '2026-09': [card('b', 4), card('a', 10)],
      '2026-08': [card('a', 4)],
    });
    const a = table.find((r) => r.userId === 'a');
    const b = table.find((r) => r.userId === 'b');
    expect(a.lastMonthDelta).toBe(300);
    expect(b.lastMonthDelta).toBe(500);
  });

  test('lastMonthDelta is 0 for everyone when nothing is confirmed', () => {
    const table = seasonTable(['a', 'b'], { '2026-10': [card('a', 10, 'submitted')] });
    expect(table.map((r) => r.lastMonthDelta)).toEqual([0, 0]);
    expect(table.map((r) => r.place)).toEqual([1, 1]);
    expect(table.every((r) => r.isTie)).toBe(true);
  });

  test('season totals tie and share placements', () => {
    const table = seasonTable(['a', 'b', 'c'], {
      '2026-09': [card('a', 4), card('b', 10)],
      '2026-10': [card('b', 4), card('a', 10)],
    });
    expect(table.slice(0, 2).map((r) => [r.total, r.place, r.isTie])).toEqual([[800, 1, true], [800, 1, true]]);
    expect(table[2]).toMatchObject({ userId: 'c', total: 0, place: 3 });
  });

  test('a custom points table is honoured', () => {
    const table = seasonTable(['a', 'b'], { '2026-09': [card('a', 4), card('b', 10)] }, [10, 4]);
    expect(table.map((r) => r.total)).toEqual([10, 4]);
  });

  test('unrated cards score 0 for the month', () => {
    const table = seasonTable(['a', 'b'], { '2026-09': [card('a', null), card('b', 9.9)] });
    expect(table.map((r) => [r.userId, r.total])).toEqual([['b', 500], ['a', 0]]);
    expect(table[1].byMonth['2026-09']).toEqual({ place: null, isTie: false, seasonPoints: 0 });
  });

  test('no months: everyone at zero, tied first', () => {
    const table = seasonTable(['a', 'b'], {});
    expect(table.map((r) => [r.total, r.place])).toEqual([[0, 1], [0, 1]]);
  });
});
