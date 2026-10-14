import {
  shareName, publicBoardUrl, publicBoardTokenFromPath, standingsMessage, seasonMessage, resultsMessage,
  cardMessage, announcementMessage, shareableCard, stillToPost, publicBoardSnapshot, publicBoardView,
  publicBoardScopes, shareCardAction, publicNameRule, publicDisplayName, wa,
} from '../leagueShare';
import { daysLeftInMonth } from '../leagueView';

const NOW = new Date(2026, 9, 13, 10, 0); // Tue 13 Oct 2026, 18 days left
const URL = 'https://golf-partner.vercel.app/league-board/tok_123456789012345678';

const member = (userId, displayName, extra = {}) => ({ userId, displayName, role: 'member', leftAt: null, ...extra });
const card = (userId, monthKey, points, { course = 'Golf Santander', ...extra } = {}) => ({
  id: `${userId}-${monthKey}`, userId, monthKey, month: `${monthKey}-01`, status: 'confirmed', source: 'offapp',
  points, course: { name: course }, ...extra,
});

const snapshot = {
  league: { name: 'Mulligan', pointsTable: [500, 300, 190, 135, 110], participationPoints: 10 },
  members: [
    member('u1', 'Íñigo Echeverría'),
    member('u2', 'Javier Ortega'),
    member('u3', 'Ana Pérez'),
    member('u4', 'Luis'),
    member('u5', 'Mar Gil'),
  ],
  cardsByMonth: {
    '2026-09': [card('u2', '2026-09', 40), card('u3', '2026-09', 36), card('u1', '2026-09', 30)],
    '2026-10': [
      card('u1', '2026-10', 41, { course: 'RCG Sotogrande', confirmedByName: 'Javier Ortega' }),
      card('u2', '2026-10', 38, { course: 'La Moraleja' }),
      card('u3', '2026-10', 38, { course: 'El Saler' }),
      { id: 'u5-oct', userId: 'u5', monthKey: '2026-10', month: '2026-10-01', status: 'announced', source: 'offapp', teeTime: '2026-10-17T07:20:00Z' },
    ],
  },
};

// The same cases as league_public_board_smoke.sql's league_public_name_rule
// checks: server and client must agree.
test.each([
  ['Íñigo Echeverría Ruiz', 'Íñigo E.'],
  ['Miguel Ángel Domínguez', 'Miguel Á.'],
  ['  Javier   ortega ', 'Javier O.'],
  ['ana \u00a0émile', 'ana É.'],
  ['Pepe 🏌️Golf', 'Pepe 🏌.'],
  ['Luna 😀', 'Luna 😀.'],
  ['😀 Smile', '😀 S.'],
  ['Luis', 'Luis'],
  ['', null],
  ['   ', null],
  [null, null],
])('publicNameRule(%p) -> %p (first name + initial of the first surname)', (input, want) => {
  expect(publicNameRule(input)).toBe(want);
});

test('shareName: no display name gives the neutral label in the sharer\'s language', () => {
  expect(shareName('Íñigo Echeverría', 'en')).toBe('Íñigo E.');
  expect(shareName('', 'en')).toBe('Golfer');
  expect(shareName(null, 'es')).toBe('Jugador');
});

test('publicDisplayName never falls back to the username', () => {
  expect(publicDisplayName({ displayName: 'Ana Pérez', username: 'ana.p' })).toBe('Ana Pérez');
  // The members RPC puts the username in display_name when there is none.
  expect(publicDisplayName({ displayName: 'ana.p', username: 'ana.p' })).toBeNull();
  expect(publicDisplayName({ displayName: '  ', username: 'ana.p' })).toBeNull();
  expect(publicDisplayName({ displayName: null, username: 'ana.p' })).toBeNull();
  expect(publicDisplayName({ displayName: 'Bea' })).toBe('Bea');
});

test('a member with only a username is shared as "Golfer", the username never appears', () => {
  const snap = {
    ...snapshot,
    members: [...snapshot.members, member('u6', 'leaky.local', { username: 'leaky.local' })],
    cardsByMonth: { '2026-10': [card('u6', '2026-10', 44, { course: 'Club C' })] },
  };
  const text = standingsMessage(snap, { now: NOW, lang: 'en' });
  expect(text).toContain('1. Golfer · 44 pts · Club C');
  expect(text).not.toMatch(/leaky/);
  expect(standingsMessage(snap, { now: NOW, lang: 'es' })).toContain('1. Jugador · 44 ptos · Club C');
});

test('WhatsApp markers are stripped from league, course and player names', () => {
  expect(wa('*Bold* _it_ ~st~ `code`')).toBe('Bold it st code');
  const snap = {
    league: { ...snapshot.league, name: '*Mulli_gan*' },
    members: [member('u1', 'Íñigo ~Echeverría'), member('u2', '`Javier` Ortega')],
    cardsByMonth: {
      '2026-10': [
        card('u1', '2026-10', 41, { course: 'RCG *Soto*grande', confirmedByName: '_Javi_ Ortega' }),
        card('u2', '2026-10', 30, { course: 'La_Moraleja' }),
      ],
    },
  };
  const text = standingsMessage(snap, { now: NOW, lang: 'en' });
  expect(text.split('\n').slice(0, 5)).toEqual([
    '*Mulligan*', 'October so far · 18 days left', '', '1. Íñigo E. · 41 pts · RCG Sotogrande', '2. Javier O. · 30 pts · LaMoraleja',
  ]);
  expect(seasonMessage(snap, { lang: 'en' }).split('\n')[0]).toBe('*Mulligan*');
  expect(cardMessage(snap, snap.cardsByMonth['2026-10'][0], { now: NOW, lang: 'en' }))
    .toBe('My October card for Mulligan: 41 pts at RCG Sotogrande, confirmed by Javi. 1st so far.');
  expect(announcementMessage({
    leagueName: 'Mulli*gan', month: '2026-10-01', teeTime: new Date(2026, 9, 17, 9, 20).toISOString(), postBy: null, course: 'Golf_Santander',
  }, { lang: 'en' })).toBe("I'm playing my October card for Mulligan: Sat 17 Oct 9:20 am at GolfSantander, without the app.");
});

test('daysLeftInMonth counts the Madrid calendar day', () => {
  // 31 Oct 23:30 UTC is already 1 Nov in Madrid (UTC+1): 29 days left in November.
  expect(daysLeftInMonth(new Date('2026-10-31T23:30:00Z'))).toBe(29);
  // 30 Sep 22:30 UTC is 1 Oct 00:30 in Madrid (UTC+2): 30 days left.
  expect(daysLeftInMonth(new Date('2026-09-30T22:30:00Z'))).toBe(30);
  expect(daysLeftInMonth(new Date('2026-10-13T10:00:00Z'))).toBe(18);
});

test('public board link and path', () => {
  expect(publicBoardUrl('https://golf-partner.vercel.app/', 'abc')).toBe('https://golf-partner.vercel.app/league-board/abc');
  expect(publicBoardUrl('https://x', null)).toBeNull();
  expect(publicBoardTokenFromPath('/league-board/abc_DEF-1')).toBe('abc_DEF-1');
  expect(publicBoardTokenFromPath('/league/ABCD')).toBeNull();
  expect(publicBoardTokenFromPath('/board/abc')).toBeNull();
});

describe('standings message', () => {
  test('month so far, ties marked T, who is still to post, the link last', () => {
    const text = standingsMessage(snapshot, { now: NOW, url: URL, lang: 'en' });
    const lines = text.split('\n');
    expect(lines.slice(0, 4)).toEqual(['*Mulligan*', 'October so far · 18 days left', '', '1. Íñigo E. · 41 pts · RCG Sotogrande']);
    expect(lines).toContain('T2. Javier O. · 38 pts · La Moraleja');
    expect(lines).toContain('T2. Ana P. · 38 pts · El Saler');
    expect(lines).toContain('2 still to post.');
    expect(lines.slice(-2)).toEqual(['', `Live board: ${URL}`]);
  });

  test('no link when the switch is off; no handicaps or ids', () => {
    const text = standingsMessage(snapshot, { now: NOW, url: null, lang: 'en' });
    expect(text).not.toMatch(/Live board/);
    expect(text).not.toMatch(/u1|u2|handicap/i);
  });

  test('Spanish, by the sharer\'s language', () => {
    const text = standingsMessage(snapshot, { now: NOW, url: URL, lang: 'es' });
    expect(text.split('\n').slice(0, 4)).toEqual(['*Mulligan*', 'Octubre hasta hoy · quedan 18 días', '', '1. Íñigo E. · 41 ptos · RCG Sotogrande']);
    expect(text).toContain('Faltan 2 por entregar.');
    expect(text).toContain(`Clasificación en directo: ${URL}`);
  });

  test('last day and an empty month', () => {
    const empty = { ...snapshot, cardsByMonth: {} };
    const text = standingsMessage(empty, { now: new Date(2026, 9, 31, 9), lang: 'en' });
    expect(text).toBe('*Mulligan*\nOctober so far · last day\n\nNo confirmed cards yet.\n5 still to post.');
  });

  test('stillToPost leaves out the ranked', () => {
    expect(stillToPost(snapshot, '2026-10', NOW)).toBe(2);
  });
});

test('season message: totals after the last scored month, grouped numbers', () => {
  const text = seasonMessage(snapshot, { url: URL, lang: 'en' });
  const lines = text.split('\n');
  // Sep: u2 500, u3 300, u1 190. Oct: u1 500, u2 + u3 share (300 + 190) / 2 = 245.
  expect(lines.slice(0, 6)).toEqual([
    '*Mulligan*', 'Season after October', '', '1. Javier O. · 745', '2. Íñigo E. · 690', '3. Ana P. · 545',
  ]);
  expect(lines.slice(-1)).toEqual([`Live board: ${URL}`]);
  const big = { ...snapshot, league: { ...snapshot.league, pointsTable: [1545, 300] } };
  expect(seasonMessage(big, { lang: 'en' })).toContain('1. Javier O. · 1,695');
  expect(seasonMessage(big, { lang: 'es' })).toContain('1. Javier O. · 1.695');
  expect(seasonMessage(big, { lang: 'es' }).split('\n')[1]).toBe('Temporada tras octubre');
});

test('results message: places, league points and the season top 3 after that month', () => {
  const text = resultsMessage(snapshot, { month: '2026-09', now: NOW, url: URL, lang: 'en' });
  expect(text).toBe([
    '*Mulligan*', 'September results', '',
    '1. Javier O. · 40 pts · +500',
    '2. Ana P. · 36 pts · +300',
    '3. Íñigo E. · 30 pts · +190',
    '', 'Season: 1. Javier O. 500 · 2. Ana P. 300 · 3. Íñigo E. 190',
    '', `Live board: ${URL}`,
  ].join('\n'));
  expect(resultsMessage(snapshot, { month: '2026-09', now: NOW, lang: 'es' }).split('\n')[1]).toBe('Resultados de septiembre');
});

describe('card message', () => {
  test('my confirmed card: points, course, who confirmed it, my place so far', () => {
    const mine = shareableCard(snapshot, '2026-10', 'u1');
    expect(cardMessage(snapshot, mine, { now: NOW, url: URL, lang: 'en' }))
      .toBe(`My October card for Mulligan: 41 pts at RCG Sotogrande, confirmed by Javier. 1st so far.\n${URL}`);
    expect(cardMessage(snapshot, mine, { now: NOW, lang: 'es' }))
      .toBe('Mi tarjeta de octubre en Mulligan: 41 ptos en RCG Sotogrande, confirmada por Javier. Voy 1.º por ahora.');
  });

  test('a tie and a closed month', () => {
    const javi = shareableCard(snapshot, '2026-10', 'u2');
    expect(cardMessage(snapshot, javi, { now: NOW, lang: 'en' })).toBe('My October card for Mulligan: 38 pts at La Moraleja. T2nd so far.');
    const sep = shareableCard(snapshot, '2026-09', 'u3');
    expect(cardMessage(snapshot, sep, { now: NOW, lang: 'en' })).toBe('My September card for Mulligan: 36 pts at Golf Santander. Finished 2nd.');
  });

  test('a submitted card has no place; no scored card, nothing to share', () => {
    const submitted = { ...snapshot.cardsByMonth['2026-10'][0], status: 'submitted' };
    const snap = { ...snapshot, cardsByMonth: { '2026-10': [submitted] } };
    expect(cardMessage(snap, submitted, { now: NOW, lang: 'en' })).toBe('My October card for Mulligan: 41 pts at RCG Sotogrande.');
    expect(shareableCard(snapshot, '2026-10', 'u5')).toBeNull();
    expect(shareableCard(snapshot, '2026-10', 'u4')).toBeNull();
  });
});

test('shareCardAction: my own scored card only', () => {
  const mine = shareableCard(snapshot, '2026-10', 'u1');
  expect(shareCardAction(mine, true)).toMatchObject({ kind: 'share', enabled: true, title: { key: 'league.share.cardAction.title' } });
  expect(shareCardAction(mine, false)).toBeNull();
  expect(shareCardAction({ ...mine, status: 'announced' }, true)).toBeNull();
  expect(shareCardAction({ ...mine, points: null }, true)).toBeNull();
  expect(shareCardAction({ ...mine, status: 'void' }, true)).toBeNull();
});

describe('announcement message', () => {
  const teeTime = new Date(2026, 9, 17, 9, 20).toISOString();
  const postBy = new Date(2026, 9, 17, 17, 20).toISOString();
  const input = { leagueName: 'Mulligan', month: '2026-10-01', teeTime, postBy, course: 'Golf Santander' };

  test('Spanish, 24 h', () => {
    expect(announcementMessage(input, { url: URL, lang: 'es' })).toBe(
      `Juego mi tarjeta de octubre en Mulligan: sáb 17 oct 09:20 en Golf Santander, sin la app. Resultado como tarde: 17:20.\n${URL}`,
    );
  });

  test('English; a deadline on another day says the day', () => {
    expect(announcementMessage(input, { lang: 'en' })).toBe(
      "I'm playing my October card for Mulligan: Sat 17 Oct 9:20 am at Golf Santander, without the app. Score in by 5:20 pm.",
    );
    const late = { ...input, teeTime: new Date(2026, 9, 17, 19, 0).toISOString(), postBy: new Date(2026, 9, 18, 3, 0).toISOString() };
    expect(announcementMessage(late, { lang: 'en' })).toMatch(/Score in by Sun 18 Oct 3:00 am\.$/);
  });
});

describe('public board', () => {
  const payload = {
    league: { name: 'Mulligan', season_start: '2026-01-01', season_end: '2026-12-31', points_table: [500, 300, 190], participation_points: 10 },
    members: [
      { key: 'k1', name: 'Íñigo E.', active: true },
      { key: 'k2', name: 'Javier O.', active: true },
      { key: 'k3', name: 'Ana P.', active: true },
      { key: 'k9', name: 'Old M.', active: false },
    ],
    cards: [
      { month: '2026-09-01', member: 'k2', status: 'confirmed', points: 40, course: 'Golf Santander' },
      { month: '2026-09-01', member: 'k9', status: 'confirmed', points: 35, course: 'El Saler' },
      { month: '2026-10-01', member: 'k1', status: 'confirmed', points: 41, course: 'RCG Sotogrande' },
      { month: '2026-10-01', member: 'k3', status: 'confirmed', points: 41, course: 'La Moraleja' },
    ],
  };

  test('payload to snapshot; null for no board', () => {
    expect(publicBoardSnapshot(null)).toBeNull();
    expect(publicBoardSnapshot({})).toBeNull();
    const snap = publicBoardSnapshot(payload);
    expect(snap.league).toEqual({
      name: 'Mulligan', seasonStart: '2026-01-01', seasonEnd: '2026-12-31', pointsTable: [500, 300, 190], participationPoints: 10,
    });
    expect(snap.members.find((m) => m.userId === 'k9').leftAt).toBe('left');
    expect(Object.keys(snap.cardsByMonth).sort()).toEqual(['2026-09', '2026-10']);
  });

  test('month view: ties share, course and league points; X of Y in counts active members', () => {
    const snap = publicBoardSnapshot(payload);
    const v = publicBoardView(snap, '2026-10', NOW);
    // Every member the board shows, the one who left (k9) included.
    expect(v.total).toBe(4);
    expect(v.ranked).toBe(2);
    expect(v.daysLeft).toBe(18);
    expect(v.rows).toEqual(expect.arrayContaining([
      { key: 'k1', place: 1, isTie: true, name: 'Íñigo E.', course: 'RCG Sotogrande', points: 41, league: 400 },
      { key: 'k3', place: 1, isTie: true, name: 'Ana P.', course: 'La Moraleja', points: 41, league: 400 },
    ]));
  });

  test('a member the server sends without a name shows the neutral label', () => {
    const snap = publicBoardSnapshot({
      ...payload,
      members: [...payload.members, { key: 'k5', name: null, active: true }],
      cards: [{ month: '2026-10-01', member: 'k5', status: 'confirmed', points: 45, course: 'Club C' }],
    });
    expect(publicBoardView(snap, '2026-10', NOW, 'en').rows[0].name).toBe('Golfer');
    expect(publicBoardView(snap, '2026-10', NOW, 'es').rows[0].name).toBe('Jugador');
  });

  test('a member who left still ranks in their month', () => {
    const v = publicBoardView(publicBoardSnapshot(payload), '2026-09', NOW);
    expect(v.rows.map((r) => [r.name, r.place, r.league])).toEqual([['Javier O.', 1, 500], ['Old M.', 2, 300]]);
    expect(v.daysLeft).toBeNull();
  });

  test('season view and the chips', () => {
    const snap = publicBoardSnapshot(payload);
    const v = publicBoardView(snap, 'season', NOW);
    expect(v.last).toBe('2026-10');
    expect(v.rows[0]).toEqual({ key: 'k2', place: 1, isTie: false, name: 'Javier O.', course: null, points: null, league: 500, lastMonth: 0 });
    expect(publicBoardScopes(snap, NOW)).toEqual(['2026-10', 'season', '2026-09']);
    expect(publicBoardScopes({ ...snap, cardsByMonth: {} }, NOW)).toEqual(['2026-10', 'season']);
    expect(publicBoardScopes(snap, new Date(2027, 1, 3))).toEqual(['season']);
  });
});
