import {
  cardHoleStats, monthHonours, monthSummary, statLeaders, seasonGrid, pointsBand, rivals, rivalMonths,
} from '../leagueStats';
import { t } from '../../i18n';

// Message descriptors (params may be descriptors too) -> English text.
const render = (m) => (m && typeof m === 'object'
  ? t(m.key, Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [k, render(v)])))
  : (m ?? ''));
const honours = (...args) => monthHonours(...args).map((h) => ({ ...h, title: render(h.title), text: render(h.text) }));

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
const cardOf = (userId, extra = {}) => {
  seq += 1;
  return {
    id: `c${seq}`, userId, status: 'confirmed', course: course(), playingHandicap: 0,
    holes: strokes({}, 1), points: 18, teeTime: null, playedOn: null, ...extra,
  };
};
const card = cardOf;
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
    expect(monthSummary(cards)).toMatchObject({ cards: 2, courses: 2 });
    expect(render(monthSummary(cards).msg)).toBe('2 cards · 2 courses');
    expect(render(monthSummary([card('a')]).msg)).toBe('1 card · 1 course');
  });
});

describe('monthHonours', () => {
  test('fewer than 3 confirmed cards: no honours (unconfirmed and void do not count)', () => {
    const cards = [card('a'), card('b'), card('c', { status: 'submitted' }), card('c', { status: 'void' })];
    expect(honours(cards, members)).toEqual([]);
  });

  test('card, hole, closer, birdies, snowman from the confirmed cards', () => {
    const cards = [
      // Ana: 2 on the par-3 7th (birdie, 3 pts), 8 on the par-4 2nd (+4), 1.5 better than handicap.
      card('a', { points: 36, netDifferential: -1.5, holes: strokes({ 7: 2, 2: 8 }) }),
      card('b', { points: 30, netDifferential: 2, holes: strokes({ 13: 3 }) }),
      card('c', { points: 25, netDifferential: 6.3 }),
      // An unconfirmed card never wins anything.
      card('c', { status: 'submitted', points: 44, netDifferential: -9, holes: strokes({ 1: 1 }) }),
    ];
    const byKey = Object.fromEntries(honours(cards, members).map((h) => [h.key, h]));
    expect(byKey.card).toMatchObject({ userId: 'a', text: 'Ana, 36 pts at Los Arqueros' });
    // Beto's 3 on the par-5 13th is 4 pts, ahead of Ana's 3 pts on the 7th.
    expect(byKey.hole).toMatchObject({ userId: 'b', text: 'Beto, a 3 on the par-5 13th at Los Arqueros · 4 pts' });
    expect(byKey.snowman).toMatchObject({ userId: 'a', text: 'Ana, an 8 on the par-4 2nd at Los Arqueros' });
    expect(byKey.birdies.text).toBe('2 as a group · Ana 1, Beto 1');
    expect(byKey.closer).toMatchObject({ userId: 'b', text: 'Beto, 18 out and 20 back' });
  });

  test('card of the month is the most points, whatever the net differential; an unscored card never wins it', () => {
    const cards = [
      card('a', { points: null, netDifferential: -6 }),
      card('b', { points: 30, netDifferential: -2.4 }),
      card('c', { points: 33, netDifferential: 1.1 }),
    ];
    expect(honours(cards, members).find((h) => h.key === 'card'))
      .toMatchObject({ userId: 'c', text: 'Cris, 33 pts at Los Arqueros' });
    const unscored = [card('a', { points: null }), card('b', { points: null }), card('c', { points: null })];
    expect(honours(unscored, members).map((h) => h.key)).not.toContain('card');
  });

  test('hole of the month mentions the stroke received', () => {
    const cards = [
      card('a', { playingHandicap: 2, holes: strokes({ 1: 2 }, 1) }),
      card('b'), card('c'),
    ];
    const hole = honours(cards, members).find((h) => h.key === 'hole');
    expect(honours(cards, members, hole.userId).find((h) => h.key === 'hole').text).toMatch(/^You, /);
    expect(hole.text).toBe('Ana, a 2 on the par-4 1st at Los Arqueros with a stroke · 5 pts');
  });

  test('hot streak is the longest run of holes at 2+ points', () => {
    const cards = [
      card('a', { holes: strokes({ 5: 7, 6: 7 }) }), // blobs on 5-6: runs 1-4 and 7-18
      card('b', { holes: strokes({ 9: 9 }) }), // blob on 9: runs 1-8 and 10-18
      card('c'),
    ];
    const streak = honours(cards, members).find((h) => h.key === 'streak');
    expect(streak).toMatchObject({ userId: 'a', text: 'Ana, 12 holes at 2+ pts, holes 7-18' });
  });

  test('no snowman when nobody is 3 over, and missing tee times or dates skip those honours', () => {
    const keys = honours([card('a'), card('b'), card('c')], members).map((h) => h.key);
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
    const byKey = Object.fromEntries(honours(cards, members).map((h) => [h.key, h]));
    expect(byKey.early.userId).toBe('b');
    expect(byKey.early.text).toMatch(/^Beto, out at .*7:42.* on Sun 20 Sep$/);
    expect(byKey.last).toMatchObject({ userId: 'c', text: 'Cris, played on Mon 28 Sep' });
  });

  test('9-hole and handicap-less cards still count for card/last but not hole honours', () => {
    const nine = { name: 'Short', holes: course().holes.slice(0, 9) };
    const cards = [card('a', { course: nine, points: 20, netDifferential: 0.5 }), card('b', { playingHandicap: null }), card('c')];
    const keys = honours(cards, members).map((h) => h.key);
    expect(keys).toContain('card');
    const hole = honours(cards, members).find((h) => h.key === 'hole');
    expect(honours(cards, members, hole.userId).find((h) => h.key === 'hole').text).toMatch(/^You, /);
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
    expect(rows[2]).toMatchObject({ value: null, cards: 1 });
    expect(render(rows[2].display)).toBe('needs 3 cards');
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
    '2026-08': [card('a', { points: 31, netDifferential: 3.1 }), card('b', { points: 37, netDifferential: -0.4 })],
    '2026-09': [
      card('a', { points: 38, netDifferential: -1.2 }), card('b', { points: 38, netDifferential: -0.9 }),
      card('c', { points: 44, netDifferential: -5, status: 'submitted' }),
    ],
  };

  test('cells per member in the order given; most points is best, ties all best, no card is null', () => {
    const grid = seasonGrid(cards, members, ['2026-08', '2026-09']);
    expect(grid.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
    expect(grid[0].cells.map((c) => [c.points, c.netDifferential, c.best])).toEqual([[31, 3.1, false], [38, -1.2, true]]);
    expect(grid[1].cells.map((c) => [c.points, c.netDifferential, c.best])).toEqual([[37, -0.4, true], [38, -0.9, true]]);
    expect(grid[2].cells.map((c) => [c.points, c.best, c.cardId])).toEqual([[null, false, null], [null, false, null]]);
  });

  test('a month with no confirmed card has no best', () => {
    const grid = seasonGrid({ '2026-10': [card('a', { status: 'announced' })] }, members, ['2026-10']);
    expect(grid[0].cells[0]).toMatchObject({ points: null, netDifferential: null, best: false, cardId: null, unrated: false });
  });

  test('uses the best card (most points) when a member has two in a month', () => {
    const grid = seasonGrid({
      '2026-09': [card('a', { points: 35, netDifferential: 0.2 }), card('a', { points: 38, netDifferential: 1.4 })],
    }, members, ['2026-09']);
    expect(grid[0].cells[0]).toMatchObject({ points: 38, netDifferential: 1.4 });
  });

  test('an unscored confirmed card shows as unrated, never best; a card with no net differential still ranks', () => {
    const grid = seasonGrid({ '2026-09': [card('a', { points: null }), card('b', { points: 30 })] }, members, ['2026-09']);
    expect(grid[0].cells[0]).toMatchObject({ unrated: true, points: null, best: false });
    expect(grid[0].cells[0].cardId).not.toBeNull();
    expect(grid[1].cells[0]).toMatchObject({ unrated: false, best: true, points: 30, netDifferential: null });
  });
});

describe('rivals', () => {
  // Net differential from the points (36 pts = level), so more points still wins.
  const card = (userId, extra) => cardOf(userId, { netDifferential: 36 - extra.points, ...extra });
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

  test('rivalMonths lists shared months newest first, with each side\'s points', () => {
    expect(rivalMonths(cards, 'a', 'b')).toEqual([
      { month: '2026-09', a: 30, b: 33 },
      { month: '2026-08', a: 30, b: 30 },
      { month: '2026-07', a: 30, b: 28 },
    ]);
  });

  test('points decide, not the net differential', () => {
    const rows = rivals({
      '2026-09': [card('a', { points: 34, netDifferential: 2 }), card('b', { points: 33, netDifferential: -4 })],
    }, all, 'a');
    expect(rows.find((r) => r.userId === 'b')).toMatchObject({ won: 1, lost: 0, months: 1 });
  });

  test('a month where either card has no points is not shared; no net differential still is', () => {
    const rows = rivals({
      '2026-09': [card('a', { points: 30 }), card('b', { points: null })],
      '2026-10': [card('a', { points: 30, netDifferential: null }), card('c', { points: 29, netDifferential: null })],
    }, all, 'a');
    expect(rows.find((r) => r.userId === 'b')).toMatchObject({ months: 0 });
    expect(rows.find((r) => r.userId === 'c')).toMatchObject({ months: 1, won: 1 });
  });
});

test('pointsBand shades the season grid by Stableford points', () => {
  expect([40, 36, 35, 33, 32, 0].map(pointsBand)).toEqual(['high', 'high', 'mid', 'mid', 'low', 'low']);
  expect(pointsBand(null)).toBeNull();
});

describe('medal leagues: season grid and rivals compare strokes to par, fewest first', () => {
  const med = (userId, toPar, extra = {}) => cardOf(userId, { toPar, points: 30, ...extra });

  test('seasonGrid takes the lowest to par as best, a null to par is unrated', () => {
    const grid = seasonGrid({
      '2026-09': [med('a', 3), med('b', -1), med('c', null)],
    }, members, ['2026-09'], 'medal_net');
    const cell = (u) => grid.find((r) => r.userId === u).cells[0];
    expect(cell('a')).toMatchObject({ score: 3, best: false, unrated: false });
    expect(cell('b')).toMatchObject({ score: -1, best: true });
    expect(cell('c')).toMatchObject({ score: null, unrated: true, best: false });
    // Same cards read as Stableford: points rule, so everyone ties at 30.
    expect(seasonGrid({ '2026-09': [med('a', 3), med('b', -1)] }, members, ['2026-09'])[0].cells[0])
      .toMatchObject({ score: 30, points: 30, best: true });
  });

  test('a member keeps their lowest to par of the month', () => {
    const grid = seasonGrid({ '2026-09': [med('a', 5), med('a', 1)] }, members, ['2026-09'], 'medal_gross');
    expect(grid[0].cells[0].score).toBe(1);
  });

  test('rivalMonths and rivals: the lower to par wins', () => {
    const cards = {
      '2026-08': [med('a', -2), med('b', 1)],
      '2026-09': [med('a', 4), med('b', 0)],
      '2026-10': [med('a', 2), med('b', 2)],
    };
    expect(rivalMonths(cards, 'a', 'b', 'medal_net').map((m) => [m.month, m.a, m.b]))
      .toEqual([['2026-10', 2, 2], ['2026-09', 4, 0], ['2026-08', -2, 1]]);
    const row = rivals(cards, members, 'a', 'medal_net').find((r) => r.userId === 'b');
    expect(row).toMatchObject({ won: 1, lost: 1, level: 1, months: 3 });
    // Stableford default is untouched: equal points everywhere is all level.
    expect(rivals(cards, members, 'a').find((r) => r.userId === 'b')).toMatchObject({ won: 0, lost: 0, level: 3 });
  });
});
