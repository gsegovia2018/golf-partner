import { graceMonth, pendingState, previousMonthKey, approvalReason, lastMinute } from '../leagueGrace';

const members = [
  { userId: 'me', role: 'member' },
  { userId: 'adm', role: 'admin' },
  { userId: 'pab', role: 'member' },
  { userId: 'gone', role: 'member', leftAt: '2026-09-20T00:00:00Z' },
];
const app = (o) => ({ source: 'app', status: 'submitted', points: 30, ...o });
const snap = (cards, extra = {}, month = '2026-09') => ({
  league: {}, members, cardsByMonth: { [month]: cards }, ...extra,
});
// Instants in Europe/Madrid summer time (UTC+2).
const OCT_1_0030 = new Date('2026-09-30T22:30:00Z');
const OCT_2_1420 = new Date('2026-10-02T12:20:00Z');
const OCT_3_2359 = new Date('2026-10-03T21:59:00Z');
const OCT_4_0000 = new Date('2026-10-03T22:00:00Z');

describe('previousMonthKey', () => {
  test('rolls January back to December', () => {
    expect(previousMonthKey('2026-10')).toBe('2026-09');
    expect(previousMonthKey('2027-01')).toBe('2026-12');
  });
});

describe('pendingState', () => {
  const now = OCT_2_1420;
  test('final cards are not pending', () => {
    expect(pendingState(app({ status: 'confirmed' }), now)).toBeNull();
    expect(pendingState(app({ status: 'void', voidKind: 'admin' }), now)).toBeNull();
    expect(pendingState(app({ status: 'missed' }), now)).toBeNull();
    expect(pendingState(app({ status: 'playing', postBy: '2026-09-30T10:00:00Z' }), now)).toBeNull();
    expect(pendingState(null, now)).toBeNull();
  });
  test('a confirmed card still needs an admin when it was not announced', () => {
    expect(pendingState(app({ status: 'confirmed', notAnnounced: true }), now)).toBe('approval');
    expect(pendingState(app({ status: 'confirmed', notAnnounced: true, approvedAt: 'x' }), now)).toBeNull();
    expect(pendingState(app({ status: 'confirmed', teeVerified: false }), now)).toBe('approval');
  });
  test('submitted app cards: returned, marker, nobody asked, approval', () => {
    expect(pendingState(app({ returnedAt: '2026-10-01T10:00:00Z' }), now)).toBe('returned');
    expect(pendingState(app({ markerName: 'Álvaro Beltrán' }), now)).toBe('marker');
    expect(pendingState(app({}), now)).toBe('noScan');
    expect(pendingState(app({ notAnnounced: true }), now)).toBe('approval');
    expect(pendingState(app({ markerName: 'A', notAnnounced: true }), now)).toBe('marker');
  });
  test('submitted off-app cards: no proof, check, approval', () => {
    expect(pendingState(app({ source: 'offapp' }), now)).toBe('noProof');
    expect(pendingState(app({ source: 'offapp', proofPath: 'p' }), now)).toBe('check');
    expect(pendingState(app({ source: 'offapp', proofPath: 'p', notAnnounced: true }), now)).toBe('approval');
  });
  test('live cards before their post deadline are pending', () => {
    expect(pendingState(app({ status: 'playing', postBy: '2026-10-05T10:00:00Z' }), now)).toBe('playing');
    expect(pendingState(app({ status: 'announced' }), now)).toBe('announced');
  });
  test('approval reason: hand tee wins over not announced', () => {
    expect(approvalReason({ notAnnounced: true, teeVerified: false })).toBe('handTee');
    expect(approvalReason({ notAnnounced: true })).toBe('notAnnounced');
  });
});

describe('graceMonth', () => {
  const cards = [
    app({ id: 'c1', userId: 'me', markerName: 'Álvaro Beltrán', points: 29 }),
    app({ id: 'c2', userId: 'pab', status: 'confirmed', notAnnounced: true, points: 31 }),
    app({ id: 'c3', userId: 'adm', status: 'confirmed', points: 35 }),
  ];

  test('null when nothing is pending, the month is closed or the league archived', () => {
    expect(graceMonth(snap([cards[2]]), OCT_2_1420, 'me')).toBeNull();
    expect(graceMonth(snap([]), OCT_2_1420, 'me')).toBeNull();
    expect(graceMonth(snap(cards), OCT_4_0000, 'me')).toBeNull();
    expect(graceMonth(snap(cards, { league: { archivedAt: 'x' } }), OCT_2_1420, 'me')).toBeNull();
    expect(graceMonth(null, OCT_2_1420, 'me')).toBeNull();
    // Only the previous month counts: October's own cards never make a grace.
    expect(graceMonth(snap(cards, {}, '2026-10'), OCT_2_1420, 'me')).toBeNull();
  });

  test('month boundary in Madrid: open from 1 Oct 00:30 to 3 Oct 23:59, closed at 4 Oct 00:00', () => {
    for (const at of [OCT_1_0030, OCT_3_2359]) {
      const g = graceMonth(snap(cards), at, 'me');
      expect(g.monthKey).toBe('2026-09');
      expect(g.closesAt.toISOString()).toBe('2026-10-03T22:00:00.000Z');
    }
    expect(graceMonth(snap(cards), OCT_4_0000, 'me')).toBeNull();
    // 30 Sep 23:30 Madrid is still September: no grace for the previous month yet.
    expect(graceMonth(snap(cards, {}, '2026-08'), new Date('2026-09-30T21:30:00Z'), 'me')).toBeNull();
  });

  test('January looks at December of the year before', () => {
    const s = snap([app({ userId: 'me', markerName: 'A' })], {}, '2026-12');
    const g = graceMonth(s, new Date('2027-01-02T11:00:00Z'), 'me');
    expect(g.monthKey).toBe('2026-12');
    expect(g.closesAt.toISOString()).toBe('2027-01-03T23:00:00.000Z');   // winter time, UTC+1
    expect(graceMonth(s, new Date('2027-01-03T23:00:00Z'), 'me')).toBeNull();
  });

  test('a member sees their own card first and no approval list', () => {
    const g = graceMonth(snap(cards), OCT_2_1420, 'me');
    expect(g.pending.map((p) => p.userId)).toEqual(['me', 'pab']);
    expect(g.mine).toMatchObject({ userId: 'me', state: 'marker', isMe: true });
    expect(g.toApprove).toEqual([]);
    expect(g.pendingOthersCount).toBe(1);
  });

  test('an admin gets the cards that need approval, which do not count as "others"', () => {
    const more = [...cards, app({ id: 'c4', userId: 'gone', notAnnounced: true })];
    const g = graceMonth(snap(more), OCT_2_1420, 'adm');
    expect(g.mine).toBeNull();
    expect(g.toApprove.map((p) => p.userId)).toEqual(['pab']);
    // me is waiting for a marker; the left member's card is ignored.
    expect(g.pendingOthersCount).toBe(1);
    expect(g.pending).toHaveLength(2);
  });

  test('R10: with another admin around, an admin does not approve their own card', () => {
    const two = { members: [...members, { userId: 'adm2', role: 'admin' }] };
    const own = [app({ userId: 'adm', notAnnounced: true, markerName: undefined }), app({ userId: 'pab', notAnnounced: true })];
    const g = graceMonth(snap(own, two), OCT_2_1420, 'adm');
    expect(g.toApprove.map((p) => p.userId)).toEqual(['pab']);
    expect(g.mine.state).toBe('approval');
  });

  test('a sent-back card carries its resubmit deadline (returnedAt + 24 h)', () => {
    const c = app({ userId: 'me', returnedAt: '2026-10-02T12:20:00Z', markerNote: 'hole 7?' });
    const g = graceMonth(snap([c]), OCT_2_1420, 'me');
    expect(g.mine.state).toBe('returned');
    expect(g.mine.resubmitBy.toISOString()).toBe('2026-10-03T12:20:00.000Z');
    const used = graceMonth(snap([{ ...c, returnedResubmits: 1 }]), OCT_2_1420, 'me');
    expect(used.mine.resubmitBy).toBeNull();
  });

  test('void and approved-confirmed cards are final', () => {
    const g = graceMonth(snap([
      app({ userId: 'me', status: 'void', voidKind: 'admin' }),
      app({ userId: 'pab', status: 'confirmed', notAnnounced: true, approvedAt: 'x' }),
      app({ userId: 'adm', markerName: 'x' }),
    ]), OCT_2_1420, 'me');
    expect(g.pending.map((p) => p.userId)).toEqual(['adm']);
    expect(g.mine).toBeNull();
  });
});

test('lastMinute is one minute before the close', () => {
  expect(lastMinute(OCT_4_0000).toISOString()).toBe(OCT_3_2359.toISOString());
  expect(lastMinute(null)).toBeNull();
});

describe('graceMonth order by format', () => {
  test('others are listed best first: most points, or fewest to par in a medal league', () => {
    const cards = [
      app({ userId: 'adm', points: 40, toPar: 5, markerName: 'X' }),
      app({ userId: 'pab', points: 30, toPar: -2, markerName: 'Y' }),
    ];
    expect(graceMonth(snap(cards), OCT_2_1420, 'me').pending.map((p) => p.userId)).toEqual(['adm', 'pab']);
    expect(graceMonth(snap(cards, { league: { format: 'medal_net' } }), OCT_2_1420, 'me').pending.map((p) => p.userId))
      .toEqual(['pab', 'adm']);
  });
});
