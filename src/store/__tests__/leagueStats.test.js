import {
  cardHoleStats, monthHonours, monthSummary, statLeaders, seasonGrid, rivals, rivalMonths,
} from '../leagueStats';

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const course = (name = 'Los Arqueros') => ({
  name,
  holes: PARS.map((par, i) => ({ n: i + 1, par, si: i + 1 })),
});
// Strokes for 18 holes from a par-per-hole base plus overrides { holeNumber: strokes }.
const strokes = (over = {}, delta = 0) => Object.fromEntries(
  PARS.map((par, i) => [i + 1, over[i + 1] ?? par + delta]),
);

let seq = 0;
const card = (userId, extra = {}) => {
  seq += 1;
  return {
    id: `c${seq}`, userId, status: 'confirmed', course: course(), playingHandicap: 0,
    holes: strokes({}, 1), points: 18, teeTime: null, playedOn: null, ...extra,
  };
};
const members = [
  { userId: 'a', displayName: 'Ana' },
  { userId: 'b', displayName: 'Beto' },
  { userId: 'c', displayName: 'Cris' },
];

describe('cardHoleStats', () => {
  test('per-hole points and nine totals (handicap 0: par = 2 pts)', () => {
    const s = cardHoleStats(card('a', { holes: strokes({ 1: 3, 10: 6 }) }));
    expect(s.holes).toHaveLength(18);
    expect(s.holes[0]).toMatchObject({ n: 1, par: 4, strokes: 3, points: 3, extra: 0 });
    expect(s.holes[9]).toMatchObject({ n: 10, points: 0 });
    expect(s.out).toBe(19);
    expect(s.in).toBe(16);
  });

  test('uses the playing handicap for extra shots', () => {
    const s = cardHoleStats(card('a', { playingHandicap: 18, holes: strokes({}, 1) }));
    expect(s.holes.every((h) => h.extra === 1 && h.points === 2)).toBe(true);
  });

  test('null for a 9-hole course, no handicap, or no strokes', () => {
    const nine = { name: 'Short', holes: course().holes.slice(0, 9) };
    expect(cardHoleStats(card('a', { course: nine }))).toBeNull();
    expect(cardHoleStats(card('a', { playingHandicap: null }))).toBeNull();
    expect(cardHoleStats(card('a', { holes: null }))).toBeNull();
    expect(cardHoleStats(card('a', { holes: {} }))).toBeNull();
  });

  test('holes without strokes are left out', () => {
    const s = cardHoleStats(card('a', { holes: { 1: 4, 2: 4 } }));
    expect(s.holes.map((h) => h.n)).toEqual([1, 2]);
  });
});

describe('monthSummary', () => {
  test('counts confirmed cards and distinct courses', () => {
    const cards = [
      card('a'), card('b', { course: course('El Saler') }), card('c', { status: 'submitted' }),
      card('a', { status: 'void' }),
    ];
    expect(monthSummary(cards)).toMatchObject({ cards: 2, courses: 2, text: '2 cards · 2 courses' });
    expect(monthSummary([card('a')]).text).toBe('1 card · 1 course');
  });
});

describe('monthHonours', () => {
  test('fewer than 3 confirmed cards: no honours (unconfirmed and void do not count)', () => {
    const cards = [card('a'), card('b'), card('c', { status: 'submitted' }), card('c', { status: 'void' })];
    expect(monthHonours(cards, members)).toEqual([]);
  });

  test('card, hole, closer, birdies, snowman from the confirmed cards', () => {
    const cards = [
      // Ana: 2 on the par-3 7th (birdie, 3 pts), 8 on the par-4 2nd (+4), 36 pts card.
      card('a', { points: 36, holes: strokes({ 7: 2, 2: 8 }) }),
      card('b', { points: 30, holes: strokes({ 13: 3 }) }),
      card('c', { points: 25 }),
      // An unconfirmed card never wins anything.
      card('c', { status: 'submitted', points: 44, holes: strokes({ 1: 1 }) }),
    ];
    const byKey = Object.fromEntries(monthHonours(cards, members).map((h) => [h.key, h]));
    expect(byKey.card).toMatchObject({ userId: 'a', text: 'Ana, 36 pts at Los Arqueros' });
    // Beto's 3 on the par-5 13th is 4 pts, ahead of Ana's 3 pts on the 7th.
    expect(byKey.hole).toMatchObject({ userId: 'b', text: 'Beto, a 3 on the par-5 13th at Los Arqueros · 4 pts' });
    expect(byKey.snowman).toMatchObject({ userId: 'a', text: 'Ana, an 8 on the par-4 2nd at Los Arqueros' });
    expect(byKey.birdies.text).toBe('2 as a group · Ana 1, Beto 1');
    expect(byKey.closer).toMatchObject({ userId: 'b', text: 'Beto, 18 out and 20 back' });
  });

  test('hole of the month mentions the stroke received', () => {
    const cards = [
      card('a', { playingHandicap: 2, holes: strokes({ 1: 2 }, 1) }),
      card('b'), card('c'),
    ];
    const hole = monthHonours(cards, members).find((h) => h.key === 'hole');
    expect(hole.text).toBe('Ana, a 2 on the par-4 1st at Los Arqueros with a stroke · 5 pts');
  });

  test('hot streak is the longest run of holes at 2+ points', () => {
    const cards = [
      card('a', { holes: strokes({ 5: 7, 6: 7 }) }), // blobs on 5-6: runs 1-4 and 7-18
      card('b', { holes: strokes({ 9: 9 }) }), // blob on 9: runs 1-8 and 10-18
      card('c'),
    ];
    const streak = monthHonours(cards, members).find((h) => h.key === 'streak');
    expect(streak).toMatchObject({ userId: 'a', text: 'Ana, 12 holes at 2+ pts, holes 7-18' });
  });

  test('no snowman when nobody is 3 over, and missing tee times or dates skip those honours', () => {
    const keys = monthHonours([card('a'), card('b'), card('c')], members).map((h) => h.key);
    expect(keys).not.toContain('snowman');
    expect(keys).not.toContain('early');
    expect(keys).not.toContain('last');
  });

  test('early bird and last call', () => {
    const at = (h, m, day) => new Date(2026, 8, day, h, m).toISOString();
    const cards = [
      card('a', { teeTime: at(11, 30, 12), playedOn: '2026-09-12' }),
      card('b', { teeTime: at(7, 42, 20), playedOn: '2026-09-20' }),
      card('c', { teeTime: at(9, 0, 28), playedOn: '2026-09-28' }),
    ];
    const byKey = Object.fromEntries(monthHonours(cards, members).map((h) => [h.key, h]));
    expect(byKey.early.userId).toBe('b');
    expect(byKey.early.text).toMatch(/^Beto, out at .*7:42.* on Sun 20 Sep$/);
    expect(byKey.last).toMatchObject({ userId: 'c', text: 'Cris, played on Mon 28 Sep' });
  });

  test('9-hole and handicap-less cards still count for card/last but not hole honours', () => {
    const nine = { name: 'Short', holes: course().holes.slice(0, 9) };
    const cards = [card('a', { course: nine, points: 20 }), card('b', { playingHandicap: null }), card('c')];
    const keys = monthHonours(cards, members).map((h) => h.key);
    expect(keys).toContain('card');
    const hole = monthHonours(cards, members).find((h) => h.key === 'hole');
    expect(hole.userId).toBe('c');
  });
});

describe('statLeaders', () => {
  const season = {
    '2026-07': [card('a', { points: 30 }), card('b', { points: 20 })],
    '2026-08': [card('a', { points: 34 }), card('b', { points: 22 })],
    '2026-09': [card('a', { points: 38 }), card('b', { points: 24 }), card('c', { points: 40 })],
  };

  test('avg: best first, players under 3 cards last with a needs-3-cards label', () => {
    const rows = statLeaders(season, members, 'avg');
    expect(rows.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
    expect(rows[0]).toMatchObject({ value: 34, display: '34.0', cards: 3 });
    expect(rows[2]).toMatchObject({ value: null, display: 'needs 3 cards', cards: 1 });
  });

  test('ignores unconfirmed and void cards', () => {
    const rows = statLeaders({
      '2026-07': [card('a', { points: 10, status: 'void' }), card('a', { points: 10, status: 'submitted' })],
    }, members, 'avg');
    expect(rows.every((r) => r.cards === 0 && r.display === '–')).toBe(true);
  });

  test('birdies and blobs are totals, most first, with no minimum', () => {
    const cards = {
      '2026-09': [
        card('a', { holes: strokes({ 1: 3, 2: 3 }) }), // 2 birdies
        card('b', { holes: strokes({ 1: 3, 2: 9, 3: 9 }) }), // 1 birdie, 2 blobs
      ],
    };
    expect(statLeaders(cards, members, 'birdies').map((r) => [r.userId, r.value, r.display]))
      .toEqual([['a', 2, '2'], ['b', 1, '1'], ['c', null, '–']]);
    expect(statLeaders(cards, members, 'blobs')[0]).toMatchObject({ userId: 'b', value: 2 });
  });

  test('par3: average points on par 3s (holes 3, 7, 12, 16)', () => {
    const cards = ['2026-07', '2026-08', '2026-09'].reduce((acc, m) => ({
      ...acc, [m]: [card('a', { holes: strokes({ 3: 2, 7: 3, 12: 3, 16: 3 }) })],
    }), {});
    const [row] = statLeaders(cards, members, 'par3');
    expect(row).toMatchObject({ userId: 'a', display: '2.25' }); // (3+2+2+2)/4
  });

  test('backNine: average back minus front; skips 9-hole cards', () => {
    const nine = { name: 'Short', holes: course().holes.slice(0, 9) };
    const good = card('a', { holes: strokes({ 10: 3, 11: 3, 12: 2 }) }); // +1, +1, +1 on the back nine
    const cards = { '2026-07': [good], '2026-08': [good], '2026-09': [good, card('b', { course: nine })] };
    const rows = statLeaders(cards, members, 'backNine');
    expect(rows[0]).toMatchObject({ userId: 'a', display: '+3.0' });
    expect(rows.find((r) => r.userId === 'b')).toMatchObject({ value: null, cards: 0 });
  });
});

describe('seasonGrid', () => {
  const cards = {
    '2026-08': [card('a', { points: 33 }), card('b', { points: 36 })],
    '2026-09': [card('a', { points: 37 }), card('b', { points: 37 }), card('c', { points: 30, status: 'submitted' })],
  };

  test('cells per member in the order given; best card marked, ties all best, no card is null', () => {
    const grid = seasonGrid(cards, members, ['2026-08', '2026-09']);
    expect(grid.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
    expect(grid[0].cells.map((c) => [c.points, c.best])).toEqual([[33, false], [37, true]]);
    expect(grid[1].cells.map((c) => [c.points, c.best])).toEqual([[36, true], [37, true]]);
    expect(grid[2].cells.map((c) => [c.points, c.best, c.cardId])).toEqual([[null, false, null], [null, false, null]]);
  });

  test('a month with no confirmed card has no best', () => {
    const grid = seasonGrid({ '2026-10': [card('a', { status: 'announced' })] }, members, ['2026-10']);
    expect(grid[0].cells[0]).toMatchObject({ points: null, best: false });
  });

  test('uses the best card when a member has two in a month', () => {
    const grid = seasonGrid({ '2026-09': [card('a', { points: 30 }), card('a', { points: 35 })] }, members, ['2026-09']);
    expect(grid[0].cells[0].points).toBe(35);
  });
});

describe('rivals', () => {
  const cards = {
    '2026-07': [card('a', { points: 30 }), card('b', { points: 28 }), card('c', { points: 40 })],
    '2026-08': [card('a', { points: 30 }), card('b', { points: 30 })],
    '2026-09': [card('a', { points: 30 }), card('b', { points: 33 }), card('c', { points: 34 })],
    '2026-10': [card('a', { points: 31 }), card('b', { points: 32, status: 'submitted' }), card('d', { points: 20, status: 'announced' })],
  };
  const all = [...members, { userId: 'd', displayName: 'Dani' }, { userId: 'e', displayName: 'Eva' }];

  test('record over shared confirmed months, closest first, no shared months last', () => {
    const rows = rivals(cards, all, 'a');
    expect(rows.map((r) => r.userId)).toEqual(['b', 'c', 'd', 'e']);
    expect(rows[0]).toEqual({ userId: 'b', won: 1, lost: 1, level: 1, months: 3 });
    expect(rows[1]).toEqual({ userId: 'c', won: 0, lost: 2, level: 0, months: 2 });
    expect(rows[2]).toMatchObject({ userId: 'd', months: 0 }); // d's only card is not confirmed
  });

  test('rivalMonths lists shared months newest first', () => {
    expect(rivalMonths(cards, 'a', 'b')).toEqual([
      { month: '2026-09', a: 30, b: 33 },
      { month: '2026-08', a: 30, b: 30 },
      { month: '2026-07', a: 30, b: 28 },
    ]);
  });
});
