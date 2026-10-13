import { describeCardEvent, splitVoidReason, visibleEvents } from '../leagueTimeline';

const ev = (kind, extra = {}) => ({
  id: kind, cardId: 'c1', kind, actorUserId: 'u-admin', actorName: 'Javier Ortega', how: null, note: null, data: {}, at: '2026-10-13T10:44:00Z', ...extra,
});
const fmt = (d) => `@${new Date(d).toISOString().slice(0, 16)}`;
const d = (e, opts = {}) => describeCardEvent(e, { meId: 'me', fmt, ...opts });

describe('splitVoidReason', () => {
  test('reason and note', () => {
    expect(splitVoidReason("Wrong tee: The club's tee sheet has him on the yellows.")).toEqual({
      reason: 'Wrong tee', note: "The club's tee sheet has him on the yellows.",
    });
  });
  test('a bare chip is the reason, a long text is the note, empty is nothing', () => {
    expect(splitVoidReason('Not 18 holes')).toEqual({ reason: 'Not 18 holes', note: null });
    const long = 'x'.repeat(60);
    expect(splitVoidReason(long)).toEqual({ reason: null, note: long });
    expect(splitVoidReason(null)).toEqual({ reason: null, note: null });
  });
});

describe('describeCardEvent', () => {
  test('a QR confirmation without an account says so, with the QR chip', () => {
    const r = d(ev('confirmed', { actorUserId: null, actorName: 'Borja Arrieta', how: 'qr', data: { marker_account: false } }));
    expect(r.title).toEqual({ key: 'league.timeline.confirmedQrNoAccount', params: { name: 'Borja Arrieta' } });
    expect(r.how).toEqual({ key: 'league.timeline.how.qr' });
    expect(r).toMatchObject({ icon: 'check', tone: 'good' });
  });

  test('a QR marker with an account is a plain confirmation; partner, photo and official carry their chip', () => {
    expect(d(ev('confirmed', { how: 'qr', actorName: 'Ana', data: { marker_account: true } })).title.key)
      .toBe('league.timeline.confirmedBy');
    const partner = d(ev('confirmed', { how: 'partner', actorName: 'Luis Navarro' }));
    expect(partner.title).toEqual({ key: 'league.timeline.confirmedPartner', params: { name: 'Luis Navarro' } });
    expect(partner.how.key).toBe('league.timeline.how.partner');
    const photo = d(ev('confirmed', { how: 'photo', actorName: 'Jorge' }));
    expect(photo).toMatchObject({ icon: 'camera', how: { key: 'league.timeline.how.photo' } });
    expect(photo.detail).toEqual({ key: 'league.timeline.signedBy', params: { name: 'Jorge' } });
    expect(d(ev('confirmed', { how: 'official', actorName: null })).how.key).toBe('league.timeline.how.official');
  });

  test('a backfilled confirmation with no how still reads', () => {
    const r = d(ev('confirmed', { how: null, actorName: null, actorUserId: null, data: { backfill: true } }));
    expect(r.title.key).toBe('league.timeline.confirmed');
    expect(r.how).toBeNull();
  });

  test('withdrawn by me reads "by you" and says the month is free', () => {
    const r = d(ev('withdrawn', { actorUserId: 'me', actorName: 'Marcos' }), { monthKey: '2026-10' });
    expect(r.title.key).toBe('league.timeline.withdrawnYou');
    expect(r.detail).toEqual({ key: 'league.timeline.withdrawnDetail', params: { monthKey: '2026-10' } });
    expect(r).toMatchObject({ icon: 'log-out', tone: 'bad' });
  });

  test('voided splits the reason from the note; mine reads "by you"', () => {
    const r = d(ev('voided', { note: "Wrong tee: The club's tee sheet has him on the yellows." }));
    expect(r.title).toEqual({ key: 'league.timeline.voidedReason', params: { name: 'Javier Ortega', reason: 'Wrong tee' } });
    expect(r.note).toBe("The club's tee sheet has him on the yellows.");
    expect(d(ev('voided', { actorUserId: 'me', note: 'Other' })).title.key).toBe('league.timeline.voidedReasonYou');
    expect(d(ev('voided', { note: null })).title.key).toBe('league.timeline.voided');
  });

  test('announced: app and off-app', () => {
    expect(d(ev('announced', { data: { source: 'app', course_name: 'RCG Sotogrande' } })))
      .toMatchObject({ icon: 'flag', title: { key: 'league.timeline.announcedApp' }, detail: { key: 'league.timeline.announcedAppDetail' } });
    const off = d(ev('announced', { data: { source: 'offapp', course_name: 'Golf Santander', tee_time: '2026-10-17T07:20:00Z' } }));
    expect(off.title.key).toBe('league.timeline.announcedOff');
    expect(off.detail.params).toEqual({ course: 'Golf Santander', tee: '@2026-10-17T07:20' });
  });

  test('rescheduled, first shot (post by +8 h), submitted and resubmitted', () => {
    expect(d(ev('rescheduled', { data: { from: '2026-10-17T07:20:00Z', to: '2026-10-18T08:00:00Z' } })))
      .toMatchObject({ icon: 'refresh-cw', title: { params: { to: '@2026-10-18T08:00' } }, detail: { params: { from: '@2026-10-17T07:20' } } });
    expect(d(ev('first_shot', { at: '2026-10-10T09:02:00Z' })).detail.params.at).toBe('@2026-10-10T17:02');
    expect(d(ev('submitted', { data: { points: 42 } })).title).toEqual({ key: 'league.timeline.submittedPts', params: { points: 42 } });
    const re = d(ev('submitted', { data: { points: 41, resubmit: true, after_return: true } }));
    expect(re.title.key).toBe('league.timeline.resubmittedPts');
    expect(re.detail.key).toBe('league.timeline.afterReturn');
    expect(d(ev('submitted')).title.key).toBe('league.timeline.submitted');
  });

  test('returned keeps the marker note and is amber', () => {
    expect(d(ev('returned', { actorName: 'Borja', note: 'Hole 13 was a 6.' })))
      .toMatchObject({ icon: 'corner-up-left', tone: 'warn', note: 'Hole 13 was a 6.', title: { params: { name: 'Borja' } } });
  });

  test('approved, reopened, auto-withdrawn, played after withdraw, unknown kind', () => {
    expect(d(ev('approved', { data: { not_announced: true } })).detail.key).toBe('league.timeline.approvedNotAnnounced');
    expect(d(ev('reopened', { data: { post_by: '2026-10-14T02:15:00Z' } })).detail.params.at).toBe('@2026-10-14T02:15');
    expect(d(ev('auto_withdrawn', { actorUserId: null, actorName: null }))).toMatchObject({ tone: 'bad', title: { key: 'league.timeline.autoWithdrawn' } });
    expect(d(ev('played_after_withdraw', { data: { month_taken: true } }), { monthKey: '2026-10' }).detail.key).toBe('league.timeline.playedAfterTaken');
    expect(d(ev('mystery')).title).toEqual({ key: 'league.timeline.unknown', params: { kind: 'mystery' } });
  });

  test('an actor without a name falls back to the given word', () => {
    expect(d(ev('returned', { actorName: null }), { someone: 'Alguien' }).title.params.name).toBe('Alguien');
  });
});

describe('visibleEvents', () => {
  const list = Array.from({ length: 8 }, (_, i) => ({ id: i }));
  test('shows the newest three and counts the rest', () => {
    expect(visibleEvents(list)).toEqual({ shown: list.slice(5), hidden: 5 });
  });
  test('shows everything when expanded or short', () => {
    expect(visibleEvents(list, true)).toEqual({ shown: list, hidden: 0 });
    expect(visibleEvents(list.slice(0, 3))).toEqual({ shown: list.slice(0, 3), hidden: 0 });
    expect(visibleEvents(null)).toEqual({ shown: [], hidden: 0 });
  });
});
