import {
  monthName, ordinal, formatPoints, formatEuros, potCents, lastScoredMonth, deltaLabel,
  positionText, cardStatus, monthRows, leagueSummary, viewableCards, monthBoard, collapseSeasonRows,
  formatNetDiff, formatNetDiffSigned, netDiffTone, yourCardState, cardBreakdown,
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
    expect(cardStatus({ status: 'confirmed', points: 38, netDifferential: -2.4 }, NOW))
      .toMatchObject({ text: '2.4 better · confirmed', tone: 'done', lead: '2.4 better', leadTone: 'better' });
    expect(cardStatus({ status: 'confirmed', points: 31, netDifferential: 4.3 }, NOW))
      .toMatchObject({ text: '4.3 worse · confirmed', leadTone: 'worse' });
    expect(cardStatus({ status: 'playing' }, NOW)).toMatchObject({ text: 'Playing now', tone: 'live' });
    expect(cardStatus({ status: 'submitted', points: 36, netDifferential: 0.04, source: 'offapp' }, NOW).text)
      .toBe('level · added after the round');
  });
  test('an unrated confirmed card is listed, not ranked; a submitted one without a value falls back to points', () => {
    expect(cardStatus({ status: 'confirmed', points: 30, netDifferential: null }, NOW))
      .toMatchObject({ text: 'unrated · not ranked', tone: 'muted', leadTone: null });
    expect(cardStatus({ status: 'submitted', points: 36, netDifferential: null, source: 'offapp' }, NOW).text)
      .toBe('36 pts · added after the round');
  });
  test('flags a card that was not announced', () => {
    expect(cardStatus({ status: 'submitted', points: 30, netDifferential: 1, notAnnounced: true }, NOW).flag).toBe('Not announced in the app');
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
      card('a', 'confirmed', 36, { confirmation: 'qr', netDifferential: 1.2 }),
      card('b', 'confirmed', 33, { confirmation: 'partner', netDifferential: -2.4 }),
      card('c', 'confirmed', 38, { confirmation: 'photo', netDifferential: 1.2 }),
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

  test('confirmed ranks by net differential; an unrated confirmed card is listed after, not ranked', () => {
    const board = monthBoard(members, {
      '2026-10': [
        card('a', 'confirmed', 40, { netDifferential: null }),
        card('b', 'confirmed', 30, { netDifferential: 3.1 }),
        card('c', 'confirmed', 33, { netDifferential: -0.5 }),
        card('c', 'confirmed', 36, { netDifferential: 0.8 }),
      ],
    }, '2026-10', table);
    expect(board.confirmed.map((r) => [r.member.userId, r.place, r.unrated, r.netDifferential, r.seasonPoints])).toEqual([
      ['c', 1, false, -0.5, 500],
      ['b', 2, false, 3.1, 300],
      ['a', null, true, null, 0],
    ]);
    expect(board.confirmed[0].card.netDifferential).toBe(-0.5);
    expect(board.noCard.map((x) => x.userId)).not.toContain('a');
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

describe('net differential words', () => {
  test('signed number and tone', () => {
    expect(formatNetDiffSigned(-2.4)).toBe('−2.4');
    expect(formatNetDiffSigned(3.1)).toBe('+3.1');
    expect(formatNetDiffSigned(0.02)).toBe('0.0');
    expect(netDiffTone(-0.1)).toBe('better');
    expect(netDiffTone(12.5)).toBe('worse');
    expect(netDiffTone(0)).toBeNull();
    expect(netDiffTone(null)).toBeNull();
  });
  test('your card state carries the spoken value, or flags an unrated confirmed card', () => {
    expect(yourCardState({ status: 'confirmed', points: 36, netDifferential: -0.6 }))
      .toMatchObject({ net: '0.6 better', netTone: 'better', unrated: false });
    expect(yourCardState({ status: 'confirmed', points: 30, netDifferential: null }))
      .toMatchObject({ net: null, unrated: true });
  });
});

describe('card breakdown', () => {
  // 18 par-4 holes (SI 1..18); playing handicap 0 so the cap is 6 everywhere.
  const course = {
    name: 'Amarillas', tee: 'Amarillas', slope: 130, rating: 71.4,
    holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })),
  };
  const strokes = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i + 1), i === 11 ? 9 : 5]));

  test('gross, adjusted gross with the capped hole named, and the stored values', () => {
    const b = cardBreakdown({
      course, holes: strokes, playingHandicap: 0, differential: 11.8, netDifferential: -2.4, leagueHandicap: 14.2,
    });
    expect(b.gross).toBe(94);
    expect(b.adjustedGross).toBe(91); // hole 12: 9 counts as 6
    expect(b.capped).toEqual([expect.objectContaining({ n: 12, strokes: 9, counted: 6, capped: true })]);
    expect(b).toMatchObject({ rated: true, slope: 130, rating: 71.4, differential: 11.8, leagueHandicap: 14.2 });
  });

  test('a card whose tee has no rating is not rated', () => {
    const b = cardBreakdown({
      course: { ...course, slope: null, rating: null }, holes: strokes, playingHandicap: 0, netDifferential: null,
    });
    expect(b.rated).toBe(false);
  });
});
