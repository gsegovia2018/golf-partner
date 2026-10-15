import {
  monthName, ordinal, formatPoints, formatEuros, potCents, lastScoredMonth, deltaLabel,
  positionMessage, cardStatus, monthRows, leagueSummary, viewableCards, monthBoard, collapseSeasonRows,
  tiePlaces, rankNotes, monthStanding, standingCells, monthLine, payoutPreview, stepParticipation,
  yourCardState, myMonthCard, monthCardsView, cardActions, voidedNote, voidReasonText, autoWithdrawNote,
  formatNetDiff, formatNetDiffSigned, netDiffTone, myRoundScored, markerAskedLine, firstName, initials, cardBreakdown, leagueNameMatches,
  formatScore,
} from '../leagueView';
import { tr, setLanguagePref } from '../../i18n';

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
  test('position message, null before any card is confirmed', () => {
    expect(positionMessage(table, 'a', cardsByMonth)).toEqual({
      key: 'league.play.position', params: { place: 'T2nd', total: 2, points: '2,340' },
    });
    expect(positionMessage(table, 'a', { '2026-10': [] })).toBeNull();
    expect(positionMessage(table, 'zz', cardsByMonth)).toBeNull();
  });
});

// cardStatus returns descriptors; render them in English like the screen would.
const cs = (card, now) => {
  const r = cardStatus(card, now);
  return { ...r, text: tr(r.msg), flag: r.flag && tr(r.flag) };
};

describe('card status', () => {
  test('each state', () => {
    expect(cs(null, NOW)).toMatchObject({ msg: { key: 'league.view.status.noCard' }, text: 'No card yet' });
    expect(cs({ status: 'confirmed', points: 38, netDifferential: -2.4 }, NOW))
      .toMatchObject({ text: '38 pts · confirmed', tone: 'done', lead: '38 pts', leadTone: null });
    expect(cs({ status: 'confirmed', points: 31, netDifferential: 4.3 }, NOW))
      .toMatchObject({ text: '31 pts · confirmed', leadTone: null });
    expect(cs({ status: 'playing' }, NOW)).toMatchObject({ text: 'Playing now', tone: 'live' });
    expect(cs({ status: 'submitted', points: 36, netDifferential: 0.04, source: 'offapp' }, NOW).text)
      .toBe('36 pts · added after the round');
  });
  test('the lead is the points, with or without a net differential; a card without points is not ranked', () => {
    expect(cs({ status: 'confirmed', points: 30, netDifferential: null }, NOW))
      .toMatchObject({ text: '30 pts · confirmed', tone: 'done', lead: '30 pts' });
    expect(cs({ status: 'confirmed', points: null, netDifferential: -1 }, NOW))
      .toMatchObject({ text: 'unrated · not ranked', tone: 'muted', leadTone: null });
    expect(cs({ status: 'submitted', points: null, source: 'app' }, NOW).text).toBe('submitted');
  });
  test('flags a card that was not announced', () => {
    expect(cs({ status: 'submitted', points: 30, netDifferential: 1, notAnnounced: true, approvedAt: '2026-10-05T00:00:00Z' }, NOW).flag).toBe('Not announced in the app');
  });
  test('announced shows the time', () => {
    const iso = new Date(2026, 9, 4, 10, 10).toISOString();
    expect(cs({ status: 'announced', announcedAt: iso }, NOW).text).toBe('Announced · today 10:10');
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
    expect(cs({ status: 'missed', postBy }, before))
      .toMatchObject({ msg: { key: 'league.view.status.notPosted' }, text: 'Not posted', tone: 'muted', flag: null, missed: true });
  });

  test('a live card past its deadline reads Not posted without the sweep', () => {
    expect(cs({ status: 'announced', postBy, announcedAt: '2026-10-10T09:00:00Z' }, after))
      .toMatchObject({ text: 'Not posted', missed: true });
    expect(cs({ status: 'playing', postBy }, after)).toMatchObject({ missed: true });
  });

  test('a live card carries its deadline, text unchanged', () => {
    const s = cs({ status: 'announced', postBy, announcedAt: '2026-10-10T09:00:00Z' }, before);
    expect(s.text).toMatch(/^Announced/);
    expect(s.deadline).toMatchObject({ msLeft: 3 * 3600000, urgent: false });
    expect(cs({ status: 'playing', postBy }, before).deadline.postBy).toEqual(new Date(postBy));
    expect(cs({ status: 'playing' }, before).deadline).toBeNull();
  });

  test('a tee entered by hand flags awaiting approval until an admin approves it', () => {
    const card = { status: 'confirmed', teeVerified: false, points: 30 };
    expect(cs(card, before).flag).toBe('Tee entered by hand · awaiting approval');
    expect(cs({ ...card, notAnnounced: true }, before).flag).toBe('Tee entered by hand · awaiting approval');
    expect(cs({ ...card, approvedAt: '2026-10-11T00:00:00Z' }, before).flag).toBeNull();
    expect(cs({ ...card, teeVerified: true }, before).flag).toBeNull();
  });

  test('an unapproved not-announced card flags awaiting approval', () => {
    const card = { status: 'submitted', notAnnounced: true, points: 30 };
    expect(cs(card, before).flag).toBe('Awaiting approval · not counted yet');
    expect(cs({ ...card, approvedAt: '2026-10-11T00:00:00Z' }, before).flag).toBe('Not announced in the app');
  });

describe('card status in Spanish', () => {
  afterEach(() => setLanguagePref('en'));
  test('renders the descriptors in Spanish', async () => {
    await setLanguagePref('es');
    expect(cs({ status: 'confirmed', points: 38 }, NOW).text).toBe('38 ptos · confirmada');
    expect(cs({ status: 'submitted', points: 30, notAnnounced: true }, NOW).flag).toBe('Pendiente de aprobación · aún no cuenta');
    expect(cs(null, NOW).text).toBe('Sin tarjeta todavía');
  });
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
  expect(leagueSummary(snapshot, 'a').position.params).toMatchObject({ place: '2nd', total: 2, points: '300' });
  expect(leagueSummary({ ...snapshot, cardsByMonth: {} }, 'a').position).toBeNull();
  // The league's participation points lift a place beyond the table.
  const three = {
    league: { pointsTable: [500], participationPoints: 10 },
    members: [{ userId: 'a' }, { userId: 'b' }],
    cardsByMonth: snapshot.cardsByMonth,
  };
  expect(leagueSummary(three, 'a').position.params).toMatchObject({ place: '2nd', total: 2, points: '10' });
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
    expect(board.confirmed.map((r) => [r.member.userId, r.place, r.isTie, r.seasonPoints, tr(r.howMsg)])).toEqual([
      ['b', 1, false, 500, 'app partner'],
      ['a', 2, true, 245, 'marker by QR'],
      ['c', 2, true, 245, 'signed card photo'],
    ]);
    expect(board.waiting.map((r) => [r.member.userId, tr(r.reasonMsg)])).toEqual([
      ['d', "marker hasn't scanned the QR yet"],
      ['e', 'needs the card photo'],
    ]);
    expect(board.waiting.map((r) => r.reasonMsg.key)).toEqual(['league.view.waiting.noScan', 'league.view.waiting.photo']);
    expect(board.onCourse.map((r) => r.member.userId)).toEqual(['f']);
    expect(board.noCard.map((x) => x.userId)).toEqual(['g']);
  });

  test('a member whose card an admin voided is listed as voided, not as "no card yet"', () => {
    const voidCards = [
      card('g', 'void', 20, { voidKind: 'admin', voidedReason: 'Wrong tee: sheet says yellow', monthKey: '2026-10' }),
      card('f', 'void', 10, { voidKind: 'withdrawn', monthKey: '2026-10' }),
    ];
    const board = monthBoard(members, cards, '2026-10', table, new Date('2026-10-14T10:00:00Z'), { voidCards });
    expect(board.voided.map((r) => [r.member.userId, r.card.voidedReason])).toEqual([['g', 'Wrong tee: sheet says yellow']]);
    expect(board.noCard).toEqual([]);
    // Without the void cards (or for another month) nothing changes.
    expect(monthBoard(members, cards, '2026-10', table).noCard.map((x) => x.userId)).toEqual(['g']);
    expect(monthBoard(members, cards, '2026-10', table, new Date(), { voidCards: [{ ...voidCards[0], monthKey: '2026-09' }] }).voided).toEqual([]);
  });

  test('a card the marker sent back says so instead of waiting for a QR scan', () => {
    const board = monthBoard(members, {
      '2026-10': [card('d', 'submitted', 30, { returnedAt: '2026-10-13T10:00:00Z' })],
    }, '2026-10', table);
    expect(board.waiting.map((r) => tr(r.reasonMsg))).toEqual(['sent back by the marker']);
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
    expect(tr(board.waiting[0].reasonMsg)).toBe('waiting for the check');
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
    const s36 = yourCardState({ status: 'confirmed', points: 36, netDifferential: -0.6 });
    expect(s36).toMatchObject({ net: '0.6 better', netTone: 'better', unrated: false });
    expect(tr(s36.pts)).toBe('36 pts');
    const s30 = yourCardState({ status: 'confirmed', points: 30, netDifferential: null });
    expect(s30).toMatchObject({ net: null, unrated: false });
    expect(tr(s30.pts)).toBe('30 pts');
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
    expect(tr(board.waiting[0].reasonMsg)).toBe('submitted · waiting for Javi Ortega');
  });

  test('confirmed by a marker in the app reads as such', () => {
    const members = [{ userId: 'a', displayName: 'Ana' }];
    const cards = { '2026-10': [{
      id: 'c', userId: 'a', status: 'confirmed', source: 'app', confirmation: 'marker', netDifferential: -1, points: 30,
    }] };
    expect(tr(monthBoard(members, cards, '2026-10', [500]).confirmed[0].howMsg)).toBe('marker in the app');
  });

  test('markerAskedLine: relative time and expiry date, no pronouns', () => {
    const now = new Date('2026-10-13T10:00:00');
    const asked = (...args) => markerAskedLine(...args).map(tr).join(' · ');
    expect(asked('2026-10-13T09:58:00', '2026-10-19T10:00:00', now)).toBe('Asked 2 min ago · until 19 Oct');
    expect(asked('2026-10-13T10:00:00', null, now)).toBe('Asked just now');
    expect(asked('2026-10-13T07:00:00', '2026-10-19T10:00:00', now)).toBe('Asked 3 h ago · until 19 Oct');
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

describe('ties, the floor and the member standing', () => {
  const league = { pointsTable: [500, 300, 190, 135], participationPoints: 10 };
  const members = ['a', 'b', 'c', 'd', 'e', 'f'].map((userId) => ({ userId }));
  const card = (userId, points) => ({ userId, status: 'confirmed', points, confirmation: 'qr', course: { name: 'X' } });
  const cardsByMonth = {
    '2026-10': [card('a', 41), card('b', 38), card('c', 38), card('d', 36), card('e', 20), card('f', 20)],
  };
  const snapshot = { league, members, cardsByMonth };

  test('tiePlaces names the places a tie occupies', () => {
    expect(tiePlaces(2, 2)).toBe('2nd + 3rd');
    expect(tiePlaces(4, 3)).toBe('4th–6th');
  });

  test('rankNotes says who a tie shares with and when the floor paid', () => {
    expect(rankNotes({ isTie: true, tieSize: 2, place: 2 })).toEqual([
      { key: 'league.board.shares', params: { places: '2nd + 3rd' } },
    ]);
    expect(rankNotes({ isTie: true, tieSize: 2, place: 5, floored: true }).map((n) => n.key))
      .toEqual(['league.board.shares', 'league.board.forPlaying']);
    expect(rankNotes({ isTie: false, place: 1 })).toEqual([]);
  });

  test('monthBoard rows carry tie size and the floor flag', () => {
    const { confirmed } = monthBoard(members, cardsByMonth, '2026-10', league.pointsTable, NOW, { participationPoints: 10 });
    expect(confirmed.map((r) => [r.member.userId, r.place, r.tieSize, r.floored]))
      .toEqual([['a', 1, 1, false], ['b', 2, 2, false], ['c', 2, 2, false], ['d', 4, 1, false], ['e', 5, 2, true], ['f', 5, 2, true]]);
  });

  test('monthStanding and standingCells', () => {
    const d = monthStanding(snapshot, '2026-10', 'd', NOW);
    expect(d).toMatchObject({ place: 4, of: 6, points: 36, seasonPoints: 135, floored: false });
    expect(standingCells(d, { month: '2026-10', current: true })).toEqual({
      place: '4th',
      placeNote: { key: 'league.card.soFarIn', params: { monthKey: '2026-10' } },
      lp: '+135',
      lpNote: { key: 'league.card.ifEndedToday' },
    });
    const e = monthStanding(snapshot, '2026-10', 'e', NOW);
    expect(standingCells(e, { month: '2026-10', current: false })).toEqual({
      place: 'T5th',
      placeNote: { key: 'league.card.ofCards', params: { count: 6 } },
      lp: '+10',
      lpNote: { key: 'league.card.forPlaying' },
    });
    expect(monthStanding(snapshot, '2026-10', 'zz', NOW)).toBeNull();
  });

  test('monthLine: rank, no card with days left, in progress, missed', () => {
    expect(monthLine(snapshot, 'd', NOW)).toEqual({
      key: 'league.play.monthRank', params: { monthKey: '2026-10', points: '36', place: '4th' },
    });
    expect(monthLine({ ...snapshot, cardsByMonth: {} }, 'd', NOW)).toEqual({
      key: 'league.play.monthNone', params: { monthKey: '2026-10', count: 27 },
    });
    expect(monthLine({ ...snapshot, cardsByMonth: {} }, 'd', new Date(2026, 9, 31, 10))).toEqual({
      key: 'league.play.monthNoneLast', params: { monthKey: '2026-10' },
    });
    const live = { ...snapshot, cardsByMonth: { '2026-10': [{ userId: 'd', status: 'announced', teeTime: new Date(2026, 9, 5).toISOString() }] } };
    expect(monthLine(live, 'd', NOW).key).toBe('league.play.monthLive');
    expect(monthLine({ ...snapshot, league: { ...league, archivedAt: 'x' } }, 'd', NOW)).toBeNull();
  });

  test('leagueSummary carries the month line only once the league has a position', () => {
    expect(leagueSummary(snapshot, 'd', NOW).month.key).toBe('league.play.monthRank');
    expect(leagueSummary({ ...snapshot, cardsByMonth: {} }, 'd', NOW)).toMatchObject({ position: null, month: null });
  });
});

describe('payoutPreview and the stepper', () => {
  const table = [500, 300, 190, 135, 110, 90, 75, 60, 45, 35, 25, 15];

  test('closed range for a known member count, with the floor', () => {
    expect(payoutPreview(table, 10, 18)).toEqual({
      items: [{ label: '1st', points: '500' }, { label: '2nd', points: '300' }, { gap: true }, { label: '12th', points: '15' }],
      rest: { from: '13th', to: '18th', single: false, points: '10' },
      zero: false,
    });
  });

  test('open range without a count, zero floor says playing past the table pays nothing', () => {
    const p = payoutPreview(table, 0);
    expect(p.rest).toEqual({ open: '13th', points: '0' });
    expect(p.zero).toBe(true);
  });

  test('no range when everyone fits the table; places under the floor are lifted', () => {
    expect(payoutPreview([500, 5], 10, 2)).toEqual({
      items: [{ label: '1st', points: '500' }, { label: '2nd', points: '10' }], rest: null, zero: false,
    });
    expect(payoutPreview(null, 10)).toBeNull();
  });

  test('stepParticipation moves by 5 and stops at 0', () => {
    expect(stepParticipation(10, 1)).toBe(15);
    expect(stepParticipation(10, -1)).toBe(5);
    expect(stepParticipation(0, -1)).toBe(0);
    expect(stepParticipation(3, -1)).toBe(0);
  });
});

describe('card actions menu', () => {
  const NOW_A = new Date('2026-10-13T08:00:00Z');
  const base = {
    id: 'c1', userId: 'me', status: 'announced', source: 'offapp', month: '2026-10-01', monthKey: '2026-10',
    teeTime: '2026-10-17T07:20:00Z', reschedules: 0,
  };
  const owner = { isOwner: true, isAdmin: false, otherAdmin: false };
  const admin = { isOwner: false, isAdmin: true, otherAdmin: true };
  const kinds = (items) => items.map((i) => i.kind);
  const by = (items, kind) => items.find((i) => i.kind === kind);
  const when = (d) => `@${d.toISOString().slice(0, 16)}`;

  test('owner of an announced off-app card: change tee time (with its deadline) and withdraw', () => {
    const items = cardActions(base, owner, {}, NOW_A, { when });
    expect(kinds(items)).toEqual(['reschedule', 'withdraw']);
    expect(by(items, 'reschedule')).toMatchObject({
      enabled: true,
      sub: { key: 'league.actions.reschedule.until', params: { until: '@2026-10-17T05:20', hours: 2, count: 2 } },
    });
    expect(by(items, 'withdraw')).toMatchObject({
      enabled: true, tone: 'danger', sub: { key: 'league.actions.withdraw.sub', params: { monthKey: '2026-10' } },
    });
  });

  test('one change left after a reschedule', () => {
    expect(by(cardActions({ ...base, reschedules: 1 }, owner, {}, NOW_A, { when }), 'reschedule').sub.params.count).toBe(1);
  });

  test('after the tee time both are disabled and say why', () => {
    const items = cardActions(base, owner, {}, new Date('2026-10-17T09:00:00Z'), { when });
    expect(by(items, 'reschedule')).toMatchObject({ enabled: false, sub: { key: 'league.actions.reschedule.passed' } });
    expect(by(items, 'withdraw')).toMatchObject({ enabled: false, sub: { key: 'league.actions.withdraw.teePassed' } });
  });

  test('inside the 2 h notice the reschedule is off but the card can still be withdrawn', () => {
    const items = cardActions(base, owner, {}, new Date('2026-10-17T06:00:00Z'), { when });
    expect(by(items, 'reschedule')).toMatchObject({ enabled: false, sub: { key: 'league.actions.reschedule.tooClose' } });
    expect(by(items, 'withdraw').enabled).toBe(true);
  });

  test('the reschedule limit disables it', () => {
    expect(by(cardActions({ ...base, reschedules: 2 }, owner, {}, NOW_A), 'reschedule'))
      .toMatchObject({ enabled: false, sub: { key: 'league.actions.reschedule.limit' } });
  });

  test('an app card can be withdrawn before its first shot, not after', () => {
    const app = { ...base, source: 'app', teeTime: null, status: 'playing' };
    expect(kinds(cardActions(app, owner, {}, NOW_A))).toEqual(['withdraw']);
    expect(by(cardActions(app, owner, {}, NOW_A), 'withdraw').enabled).toBe(true);
    const started = cardActions({ ...app, firstShotAt: '2026-10-13T07:00:00Z', postBy: '2026-10-13T15:00:00Z' }, owner, {}, NOW_A);
    expect(by(started, 'withdraw')).toMatchObject({ enabled: false, sub: { key: 'league.actions.withdraw.started' } });
  });

  test('a closed month disables every item with the month-closed reason', () => {
    const items = cardActions({ ...base, month: '2026-09-01', monthKey: '2026-09' }, { ...owner, isAdmin: true }, {}, NOW_A);
    expect(items.length).toBeGreaterThan(0);
    items.forEach((i) => {
      expect(i.enabled).toBe(false);
      expect(i.sub.key).toBe('league.actions.monthClosed');
    });
  });

  test('a submitted card gives its owner nothing; a member sees no menu at all', () => {
    expect(cardActions({ ...base, status: 'submitted' }, owner, {}, NOW_A)).toEqual([]);
    expect(cardActions(base, { isOwner: false, isAdmin: false }, {}, NOW_A)).toEqual([]);
  });

  test("admin on someone else's card: void, reopen (disabled unless missed), approve only when needed", () => {
    const confirmed = { ...base, userId: 'javi', status: 'confirmed', source: 'app' };
    const items = cardActions(confirmed, admin, {}, NOW_A);
    expect(kinds(items)).toEqual(['void', 'reopen']);
    expect(by(items, 'void')).toMatchObject({ enabled: true, tone: 'danger', sub: { key: 'league.actions.void.sub' } });
    expect(by(items, 'reopen')).toMatchObject({ enabled: false, sub: { key: 'league.actions.reopen.notMissed' } });
    const missed = cardActions({ ...confirmed, status: 'missed' }, admin, {}, NOW_A);
    expect(by(missed, 'reopen').enabled).toBe(true);
    const unannounced = cardActions({ ...confirmed, status: 'submitted', notAnnounced: true }, admin, {}, NOW_A);
    expect(kinds(unannounced)).toEqual(['void', 'reopen', 'approve']);
  });

  test("reopen is offered only in the card's own month (the server refuses past_month)", () => {
    const missed = { ...base, userId: 'javi', status: 'missed', source: 'app', month: '2026-10-01', monthKey: '2026-10' };
    // 2 November: October is still open (R12) but no longer the current month.
    const items = cardActions(missed, admin, {}, new Date('2026-11-02T10:00:00Z'));
    expect(by(items, 'reopen')).toMatchObject({
      enabled: false, sub: { key: 'league.actions.reopen.pastMonth', params: { monthKey: '2026-10' } },
    });
    expect(by(items, 'void').enabled).toBe(true);
    expect(by(cardActions(missed, admin, {}, NOW_A), 'reopen').enabled).toBe(true);
  });

  test('an admin on their own card: nothing with another admin, void/reopen/approve as the only admin', () => {
    const mine = { ...base, status: 'submitted', notAnnounced: true };
    expect(cardActions(mine, { isOwner: true, isAdmin: true, otherAdmin: true }, {}, NOW_A)).toEqual([]);
    expect(kinds(cardActions(mine, { isOwner: true, isAdmin: true, otherAdmin: false }, {}, NOW_A))).toEqual(['void', 'reopen', 'approve']);
  });

  test('a void card, an archived league and no card have no menu', () => {
    expect(cardActions({ ...base, status: 'void', voidKind: 'admin' }, { ...admin }, {}, NOW_A)).toEqual([]);
    expect(cardActions(base, owner, { archivedAt: '2026-10-01' }, NOW_A)).toEqual([]);
    expect(cardActions(null, owner, {}, NOW_A)).toEqual([]);
  });

  test('autoWithdrawNote only for an app card with no first shot', () => {
    const app = { source: 'app', status: 'playing', announcedAt: '2026-10-13T08:00:00Z', firstShotAt: null, postBy: null };
    expect(autoWithdrawNote(app, when)).toEqual({ key: 'league.actions.withdraw.auto', params: { at: '@2026-10-14T08:00' } });
    expect(autoWithdrawNote({ ...app, firstShotAt: '2026-10-13T09:00:00Z' })).toBeNull();
  });
});

describe('cards that take the month (R15b) on the board and card screen', () => {
  const voided = (extra) => ({
    id: 'v1', userId: 'me', status: 'void', month: '2026-10-01', monthKey: '2026-10', points: 41, course: { name: 'RCG Sotogrande' }, ...extra,
  });
  const live = { id: 'l1', userId: 'javi', status: 'confirmed', month: '2026-10-01', monthKey: '2026-10', points: 38 };
  const members = [{ userId: 'me', leftAt: null }, { userId: 'javi', leftAt: null }];

  test('yourCardState: an admin void or a played-after-withdraw card is "voided", a withdrawal frees the month', () => {
    const v = yourCardState(voided({ voidKind: 'admin', voidedReason: 'Wrong tee' }));
    expect(v).toMatchObject({ kind: 'voided', voidKind: 'admin', course: 'RCG Sotogrande' });
    expect(tr(v.pts)).toBe('41 pts');
    expect(yourCardState(voided({ voidKind: 'withdrawn_after_play' })).kind).toBe('voided');
    expect(yourCardState(voided({ voidKind: 'withdrawn' }))).toEqual({ kind: 'none' });
    expect(yourCardState(voided({ voidKind: 'auto_withdrawn' }))).toEqual({ kind: 'none' });
    expect(yourCardState(voided({ voidKind: null }))).toEqual({ kind: 'none' });
  });

  test('myMonthCard prefers the live card, then a month-taking void card', () => {
    const cardsByMonth = { '2026-10': [live] };
    const cards = [voided({ voidKind: 'admin' }), live];
    expect(myMonthCard(cardsByMonth, cards, '2026-10', 'me').id).toBe('v1');
    expect(myMonthCard(cardsByMonth, cards, '2026-10', 'javi').id).toBe('l1');
    expect(myMonthCard(cardsByMonth, [voided({ voidKind: 'withdrawn' })], '2026-10', 'me')).toBeNull();
    expect(myMonthCard(cardsByMonth, [voided({ voidKind: 'admin' })], '2026-09', 'me')).toBeNull();
  });

  test('monthCardsView adds admin-voided cards for everyone and withdrawn ones only for their owner', () => {
    const snap = { members, cardsByMonth: { '2026-10': [live] }, cards: [live, voided({ voidKind: 'admin' })] };
    expect(monthCardsView(snap, '2026-10', 'javi').map((c) => c.id)).toEqual(['l1', 'v1']);
    const withdrawn = { ...snap, cards: [live, voided({ voidKind: 'withdrawn' })] };
    expect(monthCardsView(withdrawn, '2026-10', 'me').map((c) => c.id)).toEqual(['l1', 'v1']);
    expect(monthCardsView(withdrawn, '2026-10', 'javi').map((c) => c.id)).toEqual(['l1']);
  });

  test('the pager list has one card per member, so its count is what you can flick to', () => {
    const m3 = [...members, { userId: 'nacho', leftAt: null }, { userId: 'ex', leftAt: '2026-09-01' }];
    const snap = {
      members: m3,
      cardsByMonth: { '2026-10': [live] },
      cards: [live, voided({ id: 'vx', userId: 'ex', voidKind: 'admin' }), voided({ id: 'vw', userId: 'nacho', voidKind: 'withdrawn' }),
        voided({ id: 'vo', userId: 'javi', voidKind: 'admin', monthKey: '2026-09' })],
    };
    // A left member's card, another member's withdrawal and another month's void are not flickable.
    expect(monthCardsView(snap, '2026-10', 'javi').map((c) => c.id)).toEqual(['l1']);
    expect(monthCardsView(snap, '2026-10', 'nacho').map((c) => c.id)).toEqual(['l1', 'vw']);
  });

  test('a member with a live card hides their void ones', () => {
    const snap = { members, cardsByMonth: { '2026-10': [{ ...live, userId: 'me', id: 'l2' }] }, cards: [voided({ voidKind: 'admin' })] };
    expect(monthCardsView(snap, '2026-10', 'me').map((c) => c.id)).toEqual(['l2']);
  });

  test('voidedNote says who and why', () => {
    expect(voidedNote(voided({ voidKind: 'withdrawn' }), { isOwner: true, who: 'You' }).key).toBe('league.void.withdrawnYou');
    expect(voidedNote(voided({ voidKind: 'withdrawn' }), { isOwner: false, who: 'Javi' }).key).toBe('league.void.withdrawnOther');
    expect(voidedNote(voided({ voidKind: 'admin', voidedReason: 'Wrong tee: sheet says yellow' }), { isOwner: false, who: 'Javi' }))
      .toMatchObject({ key: 'league.void.adminReason', params: { reason: 'Wrong tee', monthKey: '2026-10' } });
    expect(voidedNote(voided({ voidKind: 'admin' }), { isOwner: false, who: 'Javi' }).key).toBe('league.void.admin');
    expect(voidedNote(voided({ voidKind: 'withdrawn_after_play' }), { isOwner: true, who: 'You' }).key).toBe('league.void.afterPlay');
  });

  test('voidReasonText joins the reason and the note', () => {
    expect(voidReasonText('Wrong tee', '  yellows ')).toBe('Wrong tee: yellows');
    expect(voidReasonText('Other', '')).toBe('Other');
  });
});

// Medal play (plan 2026-10-15-league-medal-play.md).
describe('formatScore', () => {
  afterEach(() => setLanguagePref('en'));

  test('Stableford points, medal net and gross to par, true minus sign, level = E', () => {
    expect(formatScore(36)).toBe('36 pts');
    expect(formatScore(36, 'stableford')).toBe('36 pts');
    expect(formatScore(-2, 'medal_net')).toBe('net −2');
    expect(formatScore(0, 'medal_net')).toBe('net E');
    expect(formatScore(3, 'medal_net')).toBe('net +3');
    expect(formatScore(-2, 'medal_gross')).toBe('−2');
    expect(formatScore(0, 'medal_gross')).toBe('E');
    expect(formatScore('4', 'medal_gross')).toBe('+4');
    expect(formatScore(null, 'medal_net')).toBe('—');
    expect(formatScore(undefined)).toBe('—');
  });

  test('Spanish, and a translator passed in', async () => {
    await setLanguagePref('es');
    expect(formatScore(36)).toBe('36 ptos');
    expect(formatScore(-2, 'medal_net')).toBe('neto −2');
    expect(formatScore(0, 'medal_gross')).toBe('par');
    const t = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;
    expect(formatScore(-1, 'medal_net', t)).toBe('league.scoring.netToPar:{"score":"−1"}');
  });
});

describe('medal sorting', () => {
  const ms = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }];
  const mc = (userId, toPar, points, status = 'confirmed') => ({ userId, status, toPar, points, monthKey: '2026-10', holes: {} });
  const byMonth = { '2026-10': [mc('a', 4, 40), mc('b', -1, 30), mc('c', null, 45)] };

  test('monthRows: fewest to par first in a medal league, most points first otherwise', () => {
    expect(monthRows(ms, byMonth, '2026-10', NOW, 'medal_net').map((r) => r.member.userId)).toEqual(['b', 'a', 'c']);
    expect(monthRows(ms, byMonth, '2026-10', NOW).map((r) => r.member.userId)).toEqual(['c', 'a', 'b']);
    expect(viewableCards(ms, byMonth, '2026-10', 'medal_gross').map((c) => c.userId)).toEqual(['b', 'a', 'c']);
  });

  test('monthBoard ranks by to par and carries cardScore; a card without to par is unrated', () => {
    const board = monthBoard(ms, byMonth, '2026-10', [100, 50, 25], NOW, { format: 'medal_net' });
    expect(board.confirmed.map((r) => [r.member.userId, r.place, r.cardScore, r.cardPoints, r.unrated]))
      .toEqual([['b', 1, -1, 30, false], ['a', 2, 4, 40, false], ['c', null, null, null, true]]);
  });

  test('monthStanding uses the league format and returns the score', () => {
    const snapshot = { league: { pointsTable: [100, 50], participationPoints: 0, format: 'medal_gross' }, members: ms, cardsByMonth: byMonth };
    expect(monthStanding(snapshot, '2026-10', 'b', NOW)).toMatchObject({ place: 1, score: -1, points: 30, of: 2 });
    expect(monthStanding({ ...snapshot, league: { ...snapshot.league, format: 'stableford' } }, '2026-10', 'b', NOW))
      .toMatchObject({ place: 3, score: 30, points: 30, of: 3 });
  });

  test('leagueSummary ranks the season by the league format', () => {
    const snapshot = { league: { pointsTable: [100, 50], participationPoints: 0, format: 'medal_net' }, members: ms, cardsByMonth: byMonth };
    expect(leagueSummary(snapshot, 'b', NOW).table[0]).toMatchObject({ userId: 'b', total: 100 });
  });
});
