import {
  monthName, ordinal, formatPoints, formatEuros, potCents, lastScoredMonth, deltaLabel,
  positionText, cardStatus, monthRows, leagueSummary, viewableCards, monthBoard, collapseSeasonRows,
  formatNetDiff,
} from '../leagueView';

const NOW = new Date(2026, 9, 4, 12, 0);

test('monthName and ordinal', () => {
  expect(monthName('2026-10')).toBe('October');
  expect(monthName('2026-09-01', true)).toBe('Sep');
  expect([1, 2, 3, 4, 11, 12, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '21st', '22nd']);
});

test('formatPoints and formatEuros', () => {
  expect(formatPoints(2340)).toBe('2,340');
  expect(formatPoints(233.333)).toBe('233.3');
  expect(formatEuros(3000)).toBe('30 €');
  expect(formatEuros(3050)).toBe('30,50 €');
});

test('pot counts paid, active members only', () => {
  const members = [{ feePaid: true }, { feePaid: true, leftAt: 'x' }, { feePaid: false }];
  expect(potCents(members, 3000)).toBe(3000);
});

describe('standings text', () => {
  const cardsByMonth = { '2026-09': [{ userId: 'a', status: 'confirmed' }], '2026-10': [{ userId: 'a', status: 'announced' }] };
  const table = [{ userId: 'b', place: 1, isTie: false, total: 2615 }, { userId: 'a', place: 2, isTie: true, total: 2340 }];

  test('last scored month ignores months with no confirmed card', () => {
    expect(lastScoredMonth(cardsByMonth)).toBe('2026-09');
    expect(lastScoredMonth({})).toBeNull();
  });
  test('delta label', () => {
    expect(deltaLabel(245, '2026-09')).toBe('+245 Sep');
    expect(deltaLabel(0, '2026-09')).toBe('');
  });
  test('position text, null before any card is confirmed', () => {
    expect(positionText(table, 'a', cardsByMonth)).toBe('T2nd of 2 · 2,340 pts');
    expect(positionText(table, 'a', { '2026-10': [] })).toBeNull();
    expect(positionText(table, 'zz', cardsByMonth)).toBeNull();
  });
});

describe('card status', () => {
  test('each state', () => {
    expect(cardStatus(null, NOW).text).toBe('No card yet');
    expect(cardStatus({ status: 'confirmed', points: 38 }, NOW)).toMatchObject({ text: '38 pts · confirmed', tone: 'done' });
    expect(cardStatus({ status: 'playing' }, NOW)).toMatchObject({ text: 'Playing now', tone: 'live' });
    expect(cardStatus({ status: 'submitted', points: 36, source: 'offapp' }, NOW).text).toBe('36 pts · added after the round');
  });
  test('flags a card that was not announced', () => {
    expect(cardStatus({ status: 'submitted', points: 30, notAnnounced: true }, NOW).flag).toBe('Not announced in the app');
  });
  test('announced shows the time', () => {
    const iso = new Date(2026, 9, 4, 10, 10).toISOString();
    expect(cardStatus({ status: 'announced', announcedAt: iso }, NOW).text).toBe('Declared · today 10:10');
  });
});

test('monthRows sorts confirmed by net differential (unrated last), then in-progress, then nobody; skips void and left', () => {
  const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }, { userId: 'e', leftAt: 'x' },
    { userId: 'f' }];
  const cardsByMonth = {
    '2026-10': [
      { userId: 'a', status: 'confirmed', points: 38, netDifferential: 3.2 },
      { userId: 'f', status: 'confirmed', points: 44, netDifferential: null },
      { userId: 'b', status: 'confirmed', points: 30, netDifferential: -1.4 },
      { userId: 'c', status: 'playing' },
    ],
  };
  expect(monthRows(members, cardsByMonth, '2026-10', NOW).map((r) => r.member.userId))
    .toEqual(['b', 'a', 'f', 'c', 'd']);
});

describe('formatNetDiff', () => {
  test('below the handicap reads "better", above reads "worse"', () => {
    expect(formatNetDiff(-2.4)).toBe('2.4 better');
    expect(formatNetDiff(3.1)).toBe('3.1 worse');
    expect(formatNetDiff(5)).toBe('5.0 worse');
  });
  test('zero (and anything that rounds to it) is level', () => {
    expect(formatNetDiff(0)).toBe('level');
    expect(formatNetDiff(-0.04)).toBe('level');
  });
  test('null / missing / garbage is a dash', () => {
    expect(formatNetDiff(null)).toBe('—');
    expect(formatNetDiff(undefined)).toBe('—');
    expect(formatNetDiff('')).toBe('—');
    expect(formatNetDiff('x')).toBe('—');
  });
  test('rounds to one decimal and accepts numeric strings', () => {
    expect(formatNetDiff(11.8 - 14.2)).toBe('2.4 better');
    expect(formatNetDiff('-2.4')).toBe('2.4 better');
  });
});

test('leagueSummary ranks members from the cached snapshot', () => {
  const snapshot = {
    league: { pointsTable: [500, 300] },
    members: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c', leftAt: 'x' }],
    cardsByMonth: { '2026-09': [
      { userId: 'a', status: 'confirmed', points: 30, netDifferential: 4.1 },
      { userId: 'b', status: 'confirmed', points: 36, netDifferential: -0.5 },
    ] },
  };
  expect(leagueSummary(snapshot, 'a').position).toBe('2nd of 2 · 300 pts');
  expect(leagueSummary({ ...snapshot, cardsByMonth: {} }, 'a').position).toBeNull();
});

test('viewableCards: scored cards only, in monthRows order, no void or left members', () => {
  const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }, { userId: 'e', leftAt: 'x' }];
  const holes = { 1: 4 };
  const cardsByMonth = {
    '2026-10': [
      { userId: 'a', status: 'submitted', points: 40, holes },
      { userId: 'b', status: 'confirmed', points: 30, holes },
      { userId: 'c', status: 'playing' },
      { userId: 'd', status: 'void', points: 50, holes },
      { userId: 'e', status: 'confirmed', points: 50, holes },
    ],
  };
  expect(viewableCards(members, cardsByMonth, '2026-10').map((c) => c.userId)).toEqual(['b', 'a']);
  expect(viewableCards(members, cardsByMonth, '2026-09')).toEqual([]);
});

describe('monthBoard', () => {
  const m = (userId, extra = {}) => ({ userId, leftAt: null, ...extra });
  const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => m(id));
  const table = [500, 300, 190];
  const card = (userId, status, points, extra = {}) => ({ userId, status, points, source: 'app', ...extra });
  const cards = {
    '2026-10': [
      card('a', 'confirmed', 36, { confirmation: 'qr' }),
      card('b', 'confirmed', 38, { confirmation: 'partner' }),
      card('c', 'confirmed', 36, { confirmation: 'photo' }),
      card('d', 'submitted', 40),
      card('e', 'submitted', 30, { source: 'offapp' }),
      card('f', 'announced', null),
      card('g', 'void', 20),
    ],
  };

  test('groups the month and ranks only the confirmed, ties sharing table points', () => {
    const board = monthBoard(members, cards, '2026-10', table);
    expect(board.confirmed.map((r) => [r.member.userId, r.place, r.isTie, r.seasonPoints, r.how])).toEqual([
      ['b', 1, false, 500, 'app partner'],
      ['a', 2, true, 245, 'marker by QR'],
      ['c', 2, true, 245, 'signed card photo'],
    ]);
    expect(board.waiting.map((r) => [r.member.userId, r.reason])).toEqual([
      ['d', "marker hasn't scanned the QR yet"],
      ['e', 'needs the card photo'],
    ]);
    expect(board.onCourse.map((r) => r.member.userId)).toEqual(['f']);
    expect(board.noCard.map((x) => x.userId)).toEqual(['g']);
  });

  test('playing sorts before announced; an off-app card with proof is waiting for the check', () => {
    const board = monthBoard(members, {
      '2026-10': [card('a', 'announced', null), card('b', 'playing', null),
        card('c', 'submitted', 31, { source: 'offapp', proofPath: 'p.jpg' })],
    }, '2026-10', table);
    expect(board.onCourse.map((r) => r.member.userId)).toEqual(['b', 'a']);
    expect(board.waiting[0].reason).toBe('waiting for the check');
    expect(board.confirmed).toEqual([]);
  });

  test('a member who left only appears with a confirmed card; an empty month is all noCard', () => {
    const withLeft = [m('a'), m('x', { leftAt: '2026-09-01' })];
    expect(monthBoard(withLeft, { '2026-10': [card('x', 'confirmed', 33)] }, '2026-10', table).confirmed.map((r) => r.member.userId))
      .toEqual(['x']);
    expect(monthBoard(withLeft, {}, '2026-10', table).noCard.map((x) => x.userId)).toEqual(['a']);
  });
});

describe('collapseSeasonRows', () => {
  const rows = (n, me) => Array.from({ length: n }, (_, i) => ({ key: `p${i + 1}`, place: i + 1, isMe: i + 1 === me }));
  const keys = (r) => r.rows.map((x) => (x.gap ? '…' : x.key));

  test('short tables come back whole', () => {
    expect(collapseSeasonRows(rows(11, 3)).hidden).toBe(0);
    expect(collapseSeasonRows(rows(11, 3)).rows).toHaveLength(11);
  });

  test('top 8 only when I am in it', () => {
    const r = collapseSeasonRows(rows(18, 3));
    expect(keys(r)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(r.hidden).toBe(10);
  });

  test('a gap, then my row with its neighbours, compact', () => {
    const r = collapseSeasonRows(rows(18, 14));
    expect(keys(r)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', '…', 'p13', 'p14', 'p15']);
    expect(r.rows.find((x) => x.key === 'p14').compact).toBe(true);
    expect(r.rows.find((x) => x.key === 'p8').compact).toBeUndefined();
  });

  test('last place: gap only before my rows; 9th joins the top without a gap', () => {
    expect(keys(collapseSeasonRows(rows(18, 18))).slice(-4)).toEqual(['p8', '…', 'p17', 'p18']);
    expect(keys(collapseSeasonRows(rows(18, 9)))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']);
  });

  test('expanded shows everyone, compact past 8th', () => {
    const r = collapseSeasonRows(rows(18, 14), { expanded: true });
    expect(r.rows).toHaveLength(18);
    expect(r.hidden).toBe(0);
    expect(r.rows[8].compact).toBe(true);
  });
});
