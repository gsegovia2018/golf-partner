import {
  monthName, ordinal, formatPoints, formatEuros, potCents, lastScoredMonth, deltaLabel,
  positionText, cardStatus, monthRows, leagueSummary, viewableCards, monthBoard, collapseSeasonRows,
  formatNetDiff, formatNetDiffSigned, netDiffTone, yourCardState, myRoundScored, markerAskedLine, firstName, initials, cardBreakdown, leagueNameMatches,
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

test('leagueNameMatches ignores case and extra spaces, never matches an empty name', () => {
  expect(leagueNameMatches('el club  del Mulligan ', 'El Club del Mulligan')).toBe(true);
  expect(leagueNameMatches('El Club del', 'El Club del Mulligan')).toBe(false);
  expect(leagueNameMatches('', '')).toBe(false);
  expect(leagueNameMatches('x', null)).toBe(false);
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
      .toMatchObject({ text: '38 pts · confirmed', tone: 'done', lead: '38 pts', leadTone: null });
    expect(cardStatus({ status: 'confirmed', points: 31, netDifferential: 4.3 }, NOW))
      .toMatchObject({ text: '31 pts · confirmed', leadTone: null });
    expect(cardStatus({ status: 'playing' }, NOW)).toMatchObject({ text: 'Playing now', tone: 'live' });
    expect(cardStatus({ status: 'submitted', points: 36, netDifferential: 0.04, source: 'offapp' }, NOW).text)
      .toBe('36 pts · added after the round');
  });
  test('the lead is the points, with or without a net differential; a card without points is not ranked', () => {
    expect(cardStatus({ status: 'confirmed', points: 30, netDifferential: null }, NOW))
      .toMatchObject({ text: '30 pts · confirmed', tone: 'done', lead: '30 pts' });
    expect(cardStatus({ status: 'confirmed', points: null, netDifferential: -1 }, NOW))
      .toMatchObject({ text: 'unrated · not ranked', tone: 'muted', leadTone: null });
    expect(cardStatus({ status: 'submitted', points: null, source: 'app' }, NOW).text).toBe('submitted');
  });
  test('flags a card that was not announced', () => {
    expect(cardStatus({ status: 'submitted', points: 30, netDifferential: 1, notAnnounced: true, approvedAt: '2026-10-05T00:00:00Z' }, NOW).flag).toBe('Not announced in the app');
  });
  test('announced shows the time', () => {
    const iso = new Date(2026, 9, 4, 10, 10).toISOString();
    expect(cardStatus({ status: 'announced', announcedAt: iso }, NOW).text).toBe('Announced · today 10:10');
  });
});

test('monthRows sorts confirmed by points (most first, unscored last), then in-progress, then nobody; skips void and left', () => {
  const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }, { userId: 'e', leftAt: 'x' },
    { userId: 'f' }];
  const cardsByMonth = {
    '2026-10': [
      { userId: 'a', status: 'confirmed', points: 38, netDifferential: 3.2 },
      { userId: 'f', status: 'confirmed', points: null, netDifferential: null },
      { userId: 'b', status: 'confirmed', points: 44, netDifferential: -1.4 },
      { userId: 'c', status: 'playing' },
    ],
  };
  expect(monthRows(members, cardsByMonth, '2026-10', NOW).map((r) => r.member.userId))
    .toEqual(['b', 'a', 'f', 'c', 'd']);
});

describe('card status: post deadline', () => {
  const postBy = '2026-10-10T18:00:00Z';
  const before = new Date('2026-10-10T15:00:00Z');
  const after = new Date('2026-10-10T18:00:00Z');

  test('a missed card reads Not posted', () => {
    expect(cardStatus({ status: 'missed', postBy }, before))
      .toEqual({ text: 'Not posted', tone: 'muted', flag: null, missed: true });
  });

  test('a live card past its deadline reads Not posted without the sweep', () => {
    expect(cardStatus({ status: 'announced', postBy, announcedAt: '2026-10-10T09:00:00Z' }, after))
      .toMatchObject({ text: 'Not posted', missed: true });
    expect(cardStatus({ status: 'playing', postBy }, after)).toMatchObject({ missed: true });
  });

  test('a live card carries its deadline, text unchanged', () => {
    const s = cardStatus({ status: 'announced', postBy, announcedAt: '2026-10-10T09:00:00Z' }, before);
    expect(s.text).toMatch(/^Announced/);
    expect(s.deadline).toMatchObject({ msLeft: 3 * 3600000, urgent: false });
    expect(cardStatus({ status: 'playing', postBy }, before).deadline.postBy).toEqual(new Date(postBy));
    expect(cardStatus({ status: 'playing' }, before).deadline).toBeNull();
  });

  test('a tee entered by hand flags awaiting approval until an admin approves it', () => {
    const card = { status: 'confirmed', teeVerified: false, points: 30 };
    expect(cardStatus(card, before).flag).toBe('Tee entered by hand · awaiting approval');
    expect(cardStatus({ ...card, notAnnounced: true }, before).flag).toBe('Tee entered by hand · awaiting approval');
    expect(cardStatus({ ...card, approvedAt: '2026-10-11T00:00:00Z' }, before).flag).toBeNull();
    expect(cardStatus({ ...card, teeVerified: true }, before).flag).toBeNull();
  });

  test('an unapproved not-announced card flags awaiting approval', () => {
    const card = { status: 'submitted', notAnnounced: true, points: 30 };
    expect(cardStatus(card, before).flag).toBe('Awaiting approval · not counted yet');
    expect(cardStatus({ ...card, approvedAt: '2026-10-11T00:00:00Z' }, before).flag).toBe('Not announced in the app');
  });

  test('monthRows puts not posted after announced', () => {
    const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }];
    const cardsByMonth = { '2026-10': [
      { userId: 'a', status: 'missed', postBy },
      { userId: 'b', status: 'announced', postBy: '2026-10-11T18:00:00Z' },
    ] };
    expect(monthRows(members, cardsByMonth, '2026-10', before).map((r) => r.member.userId)).toEqual(['b', 'a', 'c']);
  });

  test('monthBoard: awaiting and missed groups, unapproved card never ranks', () => {
    const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }];
    const cardsByMonth = { '2026-10': [
      { userId: 'a', status: 'confirmed', notAnnounced: true, netDifferential: -4, points: 40 },
      { userId: 'b', status: 'announced', postBy },
    ] };
    const board = monthBoard(members, cardsByMonth, '2026-10', undefined, after);
    expect(board.confirmed).toEqual([]);
    expect(board.awaiting.map((r) => r.member.userId)).toEqual(['a']);
    expect(board.missed.map((r) => r.member.userId)).toEqual(['b']);
    expect(board.onCourse).toEqual([]);
    expect(board.noCard.map((m) => m.userId)).toEqual(['c']);
  });
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
  // The league's participation points lift a place beyond the table.
  const three = {
    league: { pointsTable: [500], participationPoints: 10 },
    members: [{ userId: 'a' }, { userId: 'b' }],
    cardsByMonth: snapshot.cardsByMonth,
  };
  expect(leagueSummary(three, 'a').position).toBe('2nd of 2 · 10 pts');
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
      card('b', 'confirmed', 40, { confirmation: 'partner', netDifferential: 2.4 }),
      card('c', 'confirmed', 36, { confirmation: 'photo', netDifferential: -1.2 }),
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

  test('a card the marker sent back says so instead of waiting for a QR scan', () => {
    const board = monthBoard(members, {
      '2026-10': [card('d', 'submitted', 30, { returnedAt: '2026-10-13T10:00:00Z' })],
    }, '2026-10', table);
    expect(board.waiting.map((r) => r.reason)).toEqual(['sent back by the marker']);
  });

  test('confirmed ranks by points (best card each); an unscored confirmed card is listed after, not ranked', () => {
    const board = monthBoard(members, {
      '2026-10': [
        card('a', 'confirmed', null, { netDifferential: null }),
        card('b', 'confirmed', 30, { netDifferential: 3.1 }),
        card('c', 'confirmed', 33, { netDifferential: -0.5 }),
        card('c', 'confirmed', 36, { netDifferential: 0.8 }),
      ],
    }, '2026-10', table);
    expect(board.confirmed.map((r) => [r.member.userId, r.place, r.unrated, r.cardPoints, r.netDifferential, r.seasonPoints])).toEqual([
      ['c', 1, false, 36, 0.8, 500],
      ['b', 2, false, 30, 3.1, 300],
      ['a', null, true, null, null, 0],
    ]);
    expect(board.confirmed[0].card.points).toBe(36);
    expect(board.noCard.map((x) => x.userId)).not.toContain('a');
  });

  test('participation points lift places past the table', () => {
    const board = monthBoard(members, {
      '2026-10': [card('a', 'confirmed', 36), card('b', 'confirmed', 30), card('c', 'confirmed', 20),
        card('d', 'confirmed', 10)],
    }, '2026-10', table, NOW, { participationPoints: 25 });
    expect(board.confirmed.map((r) => r.seasonPoints)).toEqual([500, 300, 190, 25]);
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
  test('your card state carries the points and the spoken net, or flags an unscored confirmed card', () => {
    expect(yourCardState({ status: 'confirmed', points: 36, netDifferential: -0.6 }))
      .toMatchObject({ pts: '36 pts', net: '0.6 better', netTone: 'better', unrated: false });
    expect(yourCardState({ status: 'confirmed', points: 30, netDifferential: null }))
      .toMatchObject({ pts: '30 pts', net: null, unrated: false });
    expect(yourCardState({ status: 'confirmed', points: null, netDifferential: null }))
      .toMatchObject({ pts: null, unrated: true });
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

describe('pick your marker', () => {
  test('a submitted app card with a marker is waiting for them', () => {
    const card = { status: 'submitted', source: 'app', markerName: 'Javi Ortega', points: 36 };
    expect(yourCardState(card).waitingFor).toBe('Javi');
    expect(yourCardState({ ...card, markerName: null }).waitingFor).toBeNull();
    expect(yourCardState({ ...card, status: 'confirmed' }).waitingFor).toBeNull();
  });

  test('the month board says who a submitted card waits for', () => {
    const members = [{ userId: 'a', displayName: 'Ana' }];
    const cards = { '2026-10': [{ id: 'c', userId: 'a', status: 'submitted', source: 'app', markerName: 'Javi Ortega', points: 30 }] };
    const board = monthBoard(members, cards, '2026-10', [500]);
    expect(board.waiting[0].reason).toBe('submitted · waiting for Javi Ortega');
  });

  test('confirmed by a marker in the app reads as such', () => {
    const members = [{ userId: 'a', displayName: 'Ana' }];
    const cards = { '2026-10': [{
      id: 'c', userId: 'a', status: 'confirmed', source: 'app', confirmation: 'marker', netDifferential: -1, points: 30,
    }] };
    expect(monthBoard(members, cards, '2026-10', [500]).confirmed[0].how).toBe('marker in the app');
  });

  test('markerAskedLine: relative time and expiry date, no pronouns', () => {
    const now = new Date('2026-10-13T10:00:00');
    expect(markerAskedLine('2026-10-13T09:58:00', '2026-10-19T10:00:00', now)).toBe('Asked 2 min ago · until 19 Oct');
    expect(markerAskedLine('2026-10-13T10:00:00', null, now)).toBe('Asked just now');
    expect(markerAskedLine('2026-10-13T07:00:00', '2026-10-19T10:00:00', now)).toBe('Asked 3 h ago · until 19 Oct');
    expect(firstName('Javi Ortega')).toBe('Javi');
  });
});

test('initials', () => {
  expect(initials('Nacho Pérez')).toBe('NP');
  expect(initials('María Fernanda de la Torre-Villalobos')).toBe('MT');
  expect(initials('  javi ')).toBe('J');
  expect(initials('')).toBe('?');
});

describe('myRoundScored', () => {
  const holes = [{ number: 1 }, { number: 2 }];
  const game = (scores) => ({
    players: [{ id: 'p1', user_id: 'me' }],
    rounds: [{ id: 'r0', holes, scores }],
  });
  test('false while a hole is unscored, true once all are', () => {
    expect(myRoundScored(game({ p1: { 1: 4 } }), 'r0', 'me')).toBe(false);
    expect(myRoundScored(game({ p1: { 1: 4, 2: 5 } }), 'r0', 'me')).toBe(true);
  });
  test('null when the game, round or my player is unknown', () => {
    expect(myRoundScored(null, 'r0', 'me')).toBeNull();
    expect(myRoundScored(game({}), 'nope', 'me')).toBeNull();
    expect(myRoundScored(game({}), 'r0', 'someone')).toBeNull();
  });
});
