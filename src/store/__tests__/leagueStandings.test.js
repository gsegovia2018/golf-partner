import { monthResults, seasonTable, DEFAULT_POINTS_TABLE } from '../leagueStandings';

// Ranked by net Stableford points, higher is better. The net differential is
// secondary and carried through as netDifferential.
const card = (userId, points, status = 'confirmed', netDifferential = 1.5) => ({
  userId, status, points, netDifferential,
});
const byUser = (rows) => Object.fromEntries(rows.map((r) => [r.userId, r]));

describe('DEFAULT_POINTS_TABLE', () => {
  test('is the 12-place league table', () => {
    expect(DEFAULT_POINTS_TABLE).toEqual([500, 300, 190, 135, 110, 90, 75, 60, 45, 35, 25, 15]);
  });
});

describe('monthResults', () => {
  test('ranks by Stableford points (highest first) with the table, no ties', () => {
    const rows = monthResults([card('a', 30), card('b', 38, 'confirmed', -2.4), card('c', 34)], ['a', 'b', 'c']);
    expect(rows.map((r) => [r.userId, r.place, r.seasonPoints, r.isTie])).toEqual([
      ['b', 1, 500, false],
      ['c', 2, 300, false],
      ['a', 3, 190, false],
    ]);
    expect(rows[0].cardPoints).toBe(38);
    expect(rows[0].netDifferential).toBe(-2.4);
  });

  test('a tie for 2nd shares (300+190)/2 and the next player is 4th', () => {
    const rows = byUser(monthResults(
      [card('a', 40), card('b', 36), card('c', 36), card('d', 30)],
      ['a', 'b', 'c', 'd'],
    ));
    expect(rows.b).toMatchObject({ place: 2, isTie: true, seasonPoints: 245 });
    expect(rows.c).toMatchObject({ place: 2, isTie: true, seasonPoints: 245 });
    expect(rows.d).toMatchObject({ place: 4, isTie: false, seasonPoints: 135 });
  });

  test('equal points tie even when the net differentials differ (no tie-break)', () => {
    const rows = byUser(monthResults([card('a', 36, 'confirmed', -1.2), card('b', 36, 'confirmed', 0.8)], ['a', 'b']));
    expect(rows.a).toMatchObject({ place: 1, isTie: true, seasonPoints: 400 });
    expect(rows.b).toMatchObject({ place: 1, isTie: true, seasonPoints: 400 });
  });

  test('a three-way tie for 1st shares (500+300+190)/3', () => {
    const rows = monthResults([card('a', 36), card('b', 36), card('c', 36), card('d', 30)], ['a', 'b', 'c', 'd']);
    rows.slice(0, 3).forEach((r) => {
      expect(r.place).toBe(1);
      expect(r.isTie).toBe(true);
      expect(r.seasonPoints).toBeCloseTo(990 / 3, 10);
    });
    expect(rows[3]).toMatchObject({ userId: 'd', place: 4, seasonPoints: 135 });
  });

  test('positions beyond the table score 0, and a tie straddling the end shares the remainder', () => {
    const table = [10, 5];
    const rows = byUser(monthResults(
      [card('a', 40), card('b', 30), card('c', 30), card('d', 20)],
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
    const cards = members.map((m, i) => card(m, 50 - i));
    const rows = monthResults(cards, members);
    expect(rows[11].seasonPoints).toBe(15);
    expect(rows[12]).toMatchObject({ place: 13, seasonPoints: 0 });
  });

  test('participation points: every ranked card earns at least the floor; no card earns 0', () => {
    const members = Array.from({ length: 14 }, (_, i) => `m${i}`);
    const cards = members.slice(0, 13).map((m, i) => card(m, 50 - i));
    const rows = byUser(monthResults(cards, members, DEFAULT_POINTS_TABLE, { participationPoints: 20 }));
    expect(rows.m0.seasonPoints).toBe(500);
    expect(rows.m10.seasonPoints).toBe(25); // table above the floor
    expect(rows.m11.seasonPoints).toBe(20); // 15 lifted to 20
    expect(rows.m12).toMatchObject({ place: 13, seasonPoints: 20 });
    expect(rows.m13).toMatchObject({ place: null, seasonPoints: 0 });
  });

  test('participation points apply to a tie share below the floor, and 0 / missing means none', () => {
    const table = [10, 5];
    const cards = [card('a', 40), card('b', 30), card('c', 30)];
    const rows = byUser(monthResults(cards, ['a', 'b', 'c'], table, { participationPoints: 3 }));
    expect(rows.b.seasonPoints).toBe(3);
    expect(rows.c.seasonPoints).toBe(3);
    expect(byUser(monthResults(cards, ['a', 'b', 'c'], table, { participationPoints: 0 })).b.seasonPoints).toBe(2.5);
    expect(byUser(monthResults(cards, ['a', 'b', 'c'], table)).b.seasonPoints).toBe(2.5);
    expect(byUser(monthResults(cards, ['a', 'b', 'c'], table, { participationPoints: null })).b.seasonPoints).toBe(2.5);
  });

  test('members without a confirmed card get null place and 0 points, listed last', () => {
    const rows = monthResults([card('a', 30)], ['z', 'a', 'y']);
    expect(rows.map((r) => r.userId)).toEqual(['a', 'z', 'y']);
    expect(rows[1]).toEqual({
      userId: 'z', place: null, isTie: false, netDifferential: null, cardPoints: 0, seasonPoints: 0,
    });
    expect(rows[2].place).toBeNull();
  });

  test('cards that are not confirmed are ignored', () => {
    const rows = byUser(monthResults(
      [card('a', 45, 'submitted'), card('b', 44, 'announced'), card('c', 43, 'playing'),
        card('d', 42, 'void'), card('e', 20)],
      ['a', 'b', 'c', 'd', 'e'],
    ));
    expect(rows.e).toMatchObject({ place: 1, seasonPoints: 500 });
    ['a', 'b', 'c', 'd'].forEach((u) => expect(rows[u]).toMatchObject({ place: null, seasonPoints: 0 }));
  });

  test('accepts member objects, and ranks a confirmed card from someone who left', () => {
    const rows = monthResults([card('gone', 40), card('a', 30)], [{ userId: 'a' }, { userId: 'b' }]);
    expect(rows.map((r) => [r.userId, r.place])).toEqual([['gone', 1], ['a', 2], ['b', null]]);
  });

  test('points given as strings rank and tie like numbers', () => {
    const rows = byUser(monthResults([card('a', '36'), card('b', 36), card('c', '30')], ['a', 'b', 'c']));
    expect(rows.a).toMatchObject({ place: 1, isTie: true, cardPoints: 36 });
    expect(rows.b).toMatchObject({ place: 1, isTie: true });
    expect(rows.c).toMatchObject({ place: 3 });
  });

  test("a member's best card is the most points, not the lowest net differential", () => {
    const rows = monthResults(
      [card('a', 30, 'confirmed', -3.0), card('a', 40, 'confirmed', 1.5), card('b', 35)],
      ['a', 'b'],
    );
    expect(rows[0]).toMatchObject({ userId: 'a', place: 1, cardPoints: 40, netDifferential: 1.5 });
  });

  test('a card ranks without a net differential (an unrated tee from before the rule)', () => {
    const rows = byUser(monthResults([card('a', 33, 'confirmed', null), card('b', 30)], ['a', 'b']));
    expect(rows.a).toMatchObject({ place: 1, netDifferential: null, cardPoints: 33 });
    expect(rows.a.unrated).toBeUndefined();
  });

  test('a confirmed card without points is not ranked (unrated)', () => {
    const rows = monthResults(
      [card('a', null), card('b', 30), card('c', undefined)],
      ['a', 'b', 'c', 'd'],
    );
    expect(rows.map((r) => [r.userId, r.place])).toEqual([['b', 1], ['a', null], ['c', null], ['d', null]]);
    expect(rows[1]).toEqual({
      userId: 'a', place: null, isTie: false, unrated: true, netDifferential: null, cardPoints: null, seasonPoints: 0,
    });
    expect(rows[3].unrated).toBeUndefined();
  });

  test('a scored card beats an unscored one from the same member', () => {
    const rows = monthResults([card('a', null), card('a', 31)], ['a']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ place: 1, cardPoints: 31 });
    expect(rows[0].unrated).toBeUndefined();
  });

  test('empty month: everyone unplaced', () => {
    const rows = monthResults([], ['a', 'b']);
    expect(rows.every((r) => r.place === null && r.seasonPoints === 0)).toBe(true);
    expect(monthResults(undefined, undefined)).toEqual([]);
  });
});

describe('monthResults and approval', () => {
  test('an unapproved not-announced card scores nothing, not even participation; approved it counts', () => {
    const pending = { ...card('a', 44), notAnnounced: true };
    const approved = { ...pending, approvedAt: '2026-10-11T00:00:00Z' };
    const rows = monthResults([pending, card('b', 30)], ['a', 'b'], DEFAULT_POINTS_TABLE, { participationPoints: 10 });
    expect(byUser(rows).a).toMatchObject({ place: null, seasonPoints: 0 });
    expect(byUser(rows).b.place).toBe(1);
    const after = byUser(monthResults([approved, card('b', 30)], ['a', 'b']));
    expect(after.a).toMatchObject({ place: 1, seasonPoints: 500 });
  });

  test('an unapproved unscored card is not listed as unrated either', () => {
    const rows = monthResults([{ ...card('a', null), notAnnounced: true }], ['a']);
    expect(byUser(rows).a.unrated).toBeUndefined();
  });
});

describe('seasonTable', () => {
  const members = ['nacho', 'javi', 'you', 'dani', 'pablo', 'alvaro', 'ruben'];

  test('September example: Nacho 500, Javi & You T2 245, Dani 135, Pablo 110, Alvaro 90, Ruben 0', () => {
    const table = seasonTable(members, {
      '2026-09': [
        card('nacho', 40), card('javi', 38), card('you', 38),
        card('dani', 36), card('pablo', 35), card('alvaro', 30),
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
      '2026-09': [card('a', 40), card('b', 32), card('c', 30)],
      '2026-10': [card('b', 41), card('c', 35), card('a', 20)],
    });
    expect(table.map((r) => [r.userId, r.total])).toEqual([
      ['b', 300 + 500], ['a', 500 + 190], ['c', 190 + 300],
    ].sort((x, y) => y[1] - x[1]));
    const b = table.find((r) => r.userId === 'b');
    expect(Object.keys(b.byMonth)).toEqual(['2026-09', '2026-10']);
  });

  test('participation points flow into the season totals', () => {
    const table = seasonTable(['a', 'b', 'c'], {
      '2026-09': [card('a', 40), card('b', 32)],
      '2026-10': [card('a', 41), card('b', 30), card('c', 20)],
    }, [100], { participationPoints: 10 });
    expect(table.map((r) => [r.userId, r.total])).toEqual([['a', 200], ['b', 20], ['c', 10]]);
  });

  test('lastMonthDelta is the most recent month with a confirmed card', () => {
    const table = seasonTable(['a', 'b'], {
      '2026-10': [card('a', 30, 'submitted')], // nothing confirmed yet
      '2026-09': [card('b', 40), card('a', 30)],
      '2026-08': [card('a', 40)],
    });
    const a = table.find((r) => r.userId === 'a');
    const b = table.find((r) => r.userId === 'b');
    expect(a.lastMonthDelta).toBe(300);
    expect(b.lastMonthDelta).toBe(500);
  });

  test('lastMonthDelta is 0 for everyone when nothing is confirmed', () => {
    const table = seasonTable(['a', 'b'], { '2026-10': [card('a', 30, 'submitted')] });
    expect(table.map((r) => r.lastMonthDelta)).toEqual([0, 0]);
    expect(table.map((r) => r.place)).toEqual([1, 1]);
    expect(table.every((r) => r.isTie)).toBe(true);
  });

  test('season totals tie and share placements', () => {
    const table = seasonTable(['a', 'b', 'c'], {
      '2026-09': [card('a', 40), card('b', 30)],
      '2026-10': [card('b', 40), card('a', 30)],
    });
    expect(table.slice(0, 2).map((r) => [r.total, r.place, r.isTie])).toEqual([[800, 1, true], [800, 1, true]]);
    expect(table[2]).toMatchObject({ userId: 'c', total: 0, place: 3 });
  });

  test('a custom points table is honoured', () => {
    const table = seasonTable(['a', 'b'], { '2026-09': [card('a', 40), card('b', 30)] }, [10, 4]);
    expect(table.map((r) => r.total)).toEqual([10, 4]);
  });

  test('unscored cards score 0 for the month', () => {
    const table = seasonTable(['a', 'b'], { '2026-09': [card('a', null), card('b', 30)] }, DEFAULT_POINTS_TABLE,
      { participationPoints: 10 });
    expect(table.map((r) => [r.userId, r.total])).toEqual([['b', 500], ['a', 0]]);
    expect(table[1].byMonth['2026-09']).toEqual({ place: null, isTie: false, seasonPoints: 0 });
  });

  test('no months: everyone at zero, tied first', () => {
    const table = seasonTable(['a', 'b'], {});
    expect(table.map((r) => [r.total, r.place])).toEqual([[0, 1], [0, 1]]);
  });
});

describe('monthResults tie size and floor flag', () => {
  const c = (userId, points) => ({ userId, status: 'confirmed', points });
  test('ranked rows say how many share their place and whether the floor lifted them', () => {
    const rows = monthResults([c('a', 40), c('b', 30), c('c', 30), c('d', 10)], ['a', 'b', 'c', 'd'], [500, 300, 190], { participationPoints: 10 });
    expect(rows.map((r) => [r.userId, r.tieSize, r.floored, r.seasonPoints]))
      .toEqual([['a', 1, false, 500], ['b', 2, false, 245], ['c', 2, false, 245], ['d', 1, true, 10]]);
  });
  test('no floor, no flag', () => {
    const rows = monthResults([c('a', 40), c('b', 30)], ['a', 'b'], [500]);
    expect(rows.map((r) => r.floored)).toEqual([false, false]);
  });
});
