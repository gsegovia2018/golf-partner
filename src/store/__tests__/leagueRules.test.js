import {
  cardMonth, madridMonthManual, canAnnounce, isNotAnnounced, scoreCard, clampHandicap,
  POST_WINDOW_HOURS, REMINDER_LEAD_HOURS, postByFor, isMissed, needsApproval, deadlineInfo,
  takesMonth, earliestOffAppTeeTime, canReschedule, postOpensAt, canWithdraw, autoWithdrawAt, resubmitBy,
  monthClosesAt, isMonthClosed,
} from '../leagueRules';

describe('cardMonth (Europe/Madrid)', () => {
  test('month-end boundary in CET (winter, UTC+1)', () => {
    expect(cardMonth('2026-01-31T22:59:59Z')).toBe('2026-01');
    expect(cardMonth('2026-01-31T23:00:00Z')).toBe('2026-02');
  });

  test('month-end boundary in CEST (summer, UTC+2)', () => {
    expect(cardMonth('2026-07-31T21:59:59Z')).toBe('2026-07');
    expect(cardMonth('2026-07-31T22:00:00Z')).toBe('2026-08');
  });

  test('2026-10-31T23:30:00Z is already November in Madrid', () => {
    expect(cardMonth('2026-10-31T23:30:00Z')).toBe('2026-11');
  });

  test('year boundary', () => {
    expect(cardMonth('2026-12-31T23:30:00Z')).toBe('2027-01');
  });

  test('accepts a Date', () => {
    expect(cardMonth(new Date('2026-09-15T10:00:00Z'))).toBe('2026-09');
  });

  test('invalid input returns null', () => {
    expect(cardMonth('nope')).toBeNull();
  });

  test('around the DST switches (last Sunday of March and October)', () => {
    // 2026-03-29 01:00 UTC: CET -> CEST. 2026-10-25 01:00 UTC: CEST -> CET.
    expect(cardMonth('2026-03-31T21:59:59Z')).toBe('2026-03');
    expect(cardMonth('2026-03-31T22:00:00Z')).toBe('2026-04');
    expect(cardMonth('2026-10-31T22:59:59Z')).toBe('2026-10');
    expect(cardMonth('2026-10-31T23:00:00Z')).toBe('2026-11');
  });
});

describe('madridMonthManual fallback agrees with Intl', () => {
  const instants = [
    '2026-01-31T22:59:59Z', '2026-01-31T23:00:00Z',
    '2026-03-28T23:30:00Z', '2026-03-29T00:59:59Z', '2026-03-29T01:00:00Z',
    '2026-03-31T21:59:59Z', '2026-03-31T22:00:00Z',
    '2026-07-31T21:59:59Z', '2026-07-31T22:00:00Z',
    '2026-10-24T23:30:00Z', '2026-10-25T00:59:59Z', '2026-10-25T01:00:00Z',
    '2026-10-31T22:59:59Z', '2026-10-31T23:00:00Z', '2026-10-31T23:30:00Z',
    '2026-12-31T22:59:59Z', '2026-12-31T23:00:00Z',
    '2027-03-31T21:59:59Z', '2027-03-31T22:00:00Z', '2027-10-31T22:59:59Z', '2027-10-31T23:00:00Z',
  ];
  test.each(instants)('%s', (iso) => {
    expect(madridMonthManual(new Date(iso))).toBe(cardMonth(iso));
  });

  test('explicit expectations, independent of Intl', () => {
    expect(madridMonthManual(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
    expect(madridMonthManual(new Date('2026-07-31T22:00:00Z'))).toBe('2026-08');
    expect(madridMonthManual(new Date('2026-07-31T21:59:59Z'))).toBe('2026-07');
    expect(madridMonthManual(new Date('2026-01-31T23:00:00Z'))).toBe('2026-02');
    expect(madridMonthManual(new Date('2026-01-31T22:59:59Z'))).toBe('2026-01');
  });
});

describe('canAnnounce', () => {
  const cards = [
    { userId: 'a', month: '2026-10-01', status: 'confirmed' },
    { userId: 'b', month: '2026-10-01', status: 'void' },
    { userId: 'c', month: '2026-09-01', status: 'announced' },
  ];

  test('refuses a second live card in the month', () => {
    expect(canAnnounce(cards, 'a', '2026-10')).toEqual({ ok: false, reason: 'already_has_card' });
  });

  test('void cards do not count', () => {
    expect(canAnnounce(cards, 'b', '2026-10')).toEqual({ ok: true });
  });

  test('a card in another month does not count', () => {
    expect(canAnnounce(cards, 'c', '2026-10')).toEqual({ ok: true });
    expect(canAnnounce(cards, 'c', '2026-09').ok).toBe(false);
  });

  test('other users do not count; accepts YYYY-MM months on cards', () => {
    expect(canAnnounce(cards, 'z', '2026-10').ok).toBe(true);
    expect(canAnnounce([{ userId: 'z', month: '2026-10', status: 'playing' }], 'z', '2026-10').ok).toBe(false);
    expect(canAnnounce([], 'a', '2026-10').ok).toBe(true);
  });
});

describe('isNotAnnounced', () => {
  test('no announcement -> not announced', () => {
    expect(isNotAnnounced({})).toBe(true);
    expect(isNotAnnounced({ firstShotAt: '2026-10-04T10:00:00Z' })).toBe(true);
    expect(isNotAnnounced(null)).toBe(true);
  });

  test('first shot before the announcement -> not announced', () => {
    expect(isNotAnnounced({ announcedAt: '2026-10-04T10:00:00Z', firstShotAt: '2026-10-04T09:00:00Z' })).toBe(true);
  });

  test('announced before the first shot (or no shot yet) -> announced', () => {
    expect(isNotAnnounced({ announcedAt: '2026-10-04T09:00:00Z', firstShotAt: '2026-10-04T10:00:00Z' })).toBe(false);
    expect(isNotAnnounced({ announcedAt: '2026-10-04T09:00:00Z' })).toBe(false);
    expect(isNotAnnounced({ announcedAt: '2026-10-04T09:00:00Z', firstShotAt: null })).toBe(false);
  });

  test('accepts epoch ms for firstShotAt (round startedAt)', () => {
    const announcedAt = '2026-10-04T09:00:00Z';
    expect(isNotAnnounced({ announcedAt, firstShotAt: Date.parse('2026-10-04T10:00:00Z') })).toBe(false);
    expect(isNotAnnounced({ announcedAt, firstShotAt: Date.parse('2026-10-04T08:00:00Z') })).toBe(true);
  });
});

describe('clampHandicap', () => {
  test('caps at 30 by default and at a custom cap', () => {
    expect(clampHandicap(36)).toBe(30);
    expect(clampHandicap(27.5)).toBe(27.5);
    expect(clampHandicap(40, 36)).toBe(36);
    expect(clampHandicap('18.4')).toBe(18.4);
  });
  test('non-numbers become 0; plus handicaps pass through', () => {
    expect(clampHandicap('x')).toBe(0);
    expect(clampHandicap(undefined)).toBe(0);
    expect(clampHandicap(-2.1)).toBe(-2.1);
  });
});

describe('scoreCard', () => {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
  const strokes = [5, 5, 4, 6, 5, 6, 4, 5, 6, 5, 4, 6, 5, 5, 5, 4, 6, 6];
  // SI1 = hole 4, SI2 = hole 12, the rest a valid permutation of 3..18.
  const sis = [3, 5, 7, 1, 9, 11, 13, 15, 17, 4, 6, 2, 8, 10, 12, 14, 16, 18];
  const course = { holes: pars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i] })) };
  const holes = Object.fromEntries(strokes.map((s, i) => [i + 1, s]));

  test('reference card: playing handicap 20 -> gross 92, 36 points', () => {
    // No tee: playing handicap = round(league handicap).
    const r = scoreCard({ holes, course, leagueHandicap: 20 });
    expect(r.playingHandicap).toBe(20);
    expect(r.gross).toBe(92);
    expect(r.points).toBe(36);
    expect(r.perHole).toHaveLength(18);
    expect(r.perHole[3]).toEqual({
      n: 4, strokes: 6, extra: 2, points: 3, counted: 6, capped: false,
    });
    expect(r.perHole[11].extra).toBe(2);
    expect(r.perHole[0].extra).toBe(1);
    expect(r.perHole.reduce((s, h) => s + h.points, 0)).toBe(36);
  });

  test('reference card holds for any SI permutation of 3..18 (all holes get exactly 1 extra)', () => {
    const reversed = { holes: course.holes.map((h) => ({ ...h, strokeIndex: h.strokeIndex <= 2 ? h.strokeIndex : 21 - h.strokeIndex })) };
    expect(scoreCard({ holes, course: reversed, leagueHandicap: 20 }).points).toBe(36);
  });

  test('tee slope and rating change the playing handicap (WHS)', () => {
    // 18.0 * 125/113 + (71.2 - 72) = 19.9 - 0.8 = 19.1 -> 19
    const tee = { slope: 125, rating: 71.2, par: 72 };
    const r = scoreCard({ holes, course, leagueHandicap: 18, tee });
    expect(r.playingHandicap).toBe(19);
  });

  test('par is always the sum of the hole pars, as on the server (a tee par is ignored)', () => {
    const sum = scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2 } });
    const forged = scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2, par: 60 } });
    expect(forged.playingHandicap).toBe(sum.playingHandicap);
  });

  test('tee without par falls back to the sum of hole pars (72 here)', () => {
    const withPar = scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2, par: 72 } });
    const noPar = scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2 } });
    expect(noPar.playingHandicap).toBe(withPar.playingHandicap);
  });

  // The server scores every card with the same maths (league_card_score in
  // 20261015000000_league_server_scoring.sql); supabase/tests/
  // league_server_scoring_smoke.sql asserts these exact values on the SQL side.
  test('server parity: the values the scoring smoke test expects from SQL', () => {
    const cngPars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
    const cng = { holes: cngPars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i] })) };
    const hcng = { 1: 5, 2: 5, 3: 3, 4: 9, 5: 5, 6: 5, 7: 3, 8: 5, 9: 6, 10: 5, 11: 3, 12: 6, 13: 5, 14: 4, 15: 5, 16: 3, 17: 5, 18: 4 };
    const at = (slope, rating) => {
      const r = scoreCard({ holes: hcng, course: cng, leagueHandicap: 18, tee: { slope, rating } });
      return [r.playingHandicap, r.points, r.gross, r.differential];
    };
    expect(at(135, 73.9)).toEqual([23, 45, 86, 10.1]); // women's Amarillas
    expect(at(130, 71.4)).toEqual([20, 42, 86, 12.7]); // men's Amarillas
    expect(at(120, 70.0)).toEqual([17, 40, 86, 14.1]); // custom Blancas
  });

  test('tee with no slope falls back to round(leagueHandicap)', () => {
    expect(scoreCard({ holes, course, leagueHandicap: 18.6, tee: { rating: 71 } }).playingHandicap).toBe(19);
  });

  test('missing strokes score 0 points and add nothing to gross', () => {
    const partial = { ...holes };
    delete partial[18];
    const r = scoreCard({ holes: partial, course, leagueHandicap: 20 });
    expect(r.gross).toBe(86);
    expect(r.perHole[17]).toMatchObject({ strokes: 0, points: 0 });
    expect(r.points).toBe(36 - 1);
  });

  test('no tee: not rated, no differential (but adjusted gross is still summed)', () => {
    const r = scoreCard({ holes, course, leagueHandicap: 20 });
    expect(r.rated).toBe(false);
    expect(r.differential).toBeNull();
    expect(r.netDifferential).toBeNull();
    expect(r.adjustedGross).toBe(92);
  });

  test('a tee with slope but no rating (or rating but no slope) is not rated', () => {
    expect(scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125 } }).rated).toBe(false);
    expect(scoreCard({ holes, course, leagueHandicap: 18, tee: { rating: 71 } }).rated).toBe(false);
    expect(scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 0, rating: 71 } }).rated).toBe(false);
  });

  test('an incomplete card has no differential even off a rated tee', () => {
    const partial = { ...holes };
    delete partial[18];
    const r = scoreCard({ holes: partial, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2 } });
    expect(r.rated).toBe(true);
    expect(r.differential).toBeNull();
    expect(r.netDifferential).toBeNull();
  });

  describe('worked example: CNG Amarillas, slope 130 / CR 71.4 / par 72, league handicap 14.2', () => {
    // Playing handicap: 14.2 x 130/113 + (71.4 - 72) = 16.34 - 0.6 = 15.7 -> 16,
    // so SI 1-16 get one stroke. Hole 4 (par 5, SI 1) is a 9: cap 5+2+1 = 8.
    // Ten holes at bogey, seven at par, the 9: gross 86, adjusted 85.
    const tee = { label: 'Amarillas', slope: 130, rating: 71.4 };
    const over = [1, 1, 0, 4, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0];
    const card = Object.fromEntries(pars.map((par, i) => [i + 1, par + over[i]]));
    const r = scoreCard({ holes: card, course, leagueHandicap: 14.2, tee });

    test('gross 86, adjusted 85, differential 11.8, net -2.4', () => {
      expect(r.playingHandicap).toBe(16);
      expect(r.rated).toBe(true);
      expect(r.gross).toBe(86);
      expect(r.adjustedGross).toBe(85);
      expect(r.differential).toBe(11.8);
      expect(r.netDifferential).toBe(-2.4);
    });

    test('per hole: the 9 counts as 8 and is flagged capped, nothing else is', () => {
      expect(r.perHole[3]).toEqual({
        n: 4, strokes: 9, extra: 1, points: 0, counted: 8, capped: true,
      });
      expect(r.perHole.filter((h) => h.capped).map((h) => h.n)).toEqual([4]);
      expect(r.perHole.reduce((sum, h) => sum + h.counted, 0)).toBe(85);
    });

    test('Stableford points are still computed', () => {
      expect(r.points).toBe(r.perHole.reduce((sum, h) => sum + h.points, 0));
      expect(r.points).toBeGreaterThan(0);
    });

    test('a string slope/rating (as jsonb text) gives the same answer', () => {
      const s = scoreCard({ holes: card, course, leagueHandicap: '14.2', tee: { slope: '130', rating: '71.4' } });
      expect(s.netDifferential).toBe(-2.4);
    });

    test('a plus handicap caps below par + 2 on the easiest holes', () => {
      // Index -3 off this tee: -3.47 - 0.6 = -4.07 -> playing -4: SI 15-18 give one back.
      const plus = scoreCard({ holes: card, course, leagueHandicap: -3, tee });
      expect(plus.playingHandicap).toBe(-4);
      const si18 = plus.perHole.find((h) => course.holes[h.n - 1].strokeIndex === 18);
      expect(si18.extra).toBe(-1);
      expect(si18.counted).toBeLessThanOrEqual(course.holes[si18.n - 1].par + 1);
    });
  });

  test('a nine-hole card halves the index', () => {
    const nine = { holes: course.holes.slice(0, 9).map((h, i) => ({ ...h, strokeIndex: [3, 5, 7, 1, 9, 6, 4, 2, 8][i] })) };
    const r = scoreCard({ holes, course: nine, leagueHandicap: 18 });
    expect(r.playingHandicap).toBe(9);
    expect(r.perHole).toHaveLength(9);
    expect(r.perHole.every((h) => h.extra === 1)).toBe(true);
  });
});

describe('post deadline', () => {
  const H = 3600000;
  const postBy = '2026-10-10T18:00:00Z';
  const at = (offsetMs) => new Date(Date.parse(postBy) + offsetMs);

  test('constants and postByFor', () => {
    expect(POST_WINDOW_HOURS).toBe(8);
    expect(REMINDER_LEAD_HOURS).toBe(2);
    expect(postByFor('2026-10-10T10:00:00Z').toISOString()).toBe(postBy.replace('18:00:00Z', '18:00:00.000Z'));
    expect(postByFor(null)).toBeNull();
    expect(postByFor('nope')).toBeNull();
  });

  test('isMissed: swept, or live and at/after postBy', () => {
    expect(isMissed({ status: 'missed' }, at(-99 * H))).toBe(true);
    expect(isMissed({ status: 'announced', postBy }, at(-1))).toBe(false);
    expect(isMissed({ status: 'announced', postBy }, at(0))).toBe(true);
    expect(isMissed({ status: 'playing', postBy }, at(H))).toBe(true);
  });

  test('isMissed: no deadline, or not live, is never missed', () => {
    expect(isMissed({ status: 'announced', postBy: null }, at(H))).toBe(false);
    expect(isMissed({ status: 'submitted', postBy }, at(H))).toBe(false);
    expect(isMissed({ status: 'confirmed', postBy }, at(H))).toBe(false);
    expect(isMissed(null, at(H))).toBe(false);
  });

  test('needsApproval: unapproved not-announced scored card only', () => {
    expect(needsApproval({ status: 'submitted', notAnnounced: true })).toBe(true);
    expect(needsApproval({ status: 'confirmed', notAnnounced: true })).toBe(true);
    expect(needsApproval({ status: 'confirmed', notAnnounced: true, approvedAt: '2026-10-11T00:00:00Z' })).toBe(false);
    expect(needsApproval({ status: 'confirmed', notAnnounced: false })).toBe(false);
    expect(needsApproval({ status: 'playing', notAnnounced: true })).toBe(false);
    expect(needsApproval({ status: 'void', notAnnounced: true })).toBe(false);
    expect(needsApproval(null)).toBe(false);
  });

  test('needsApproval: a tee entered by hand waits for an admin too; a library tee or an older card does not', () => {
    expect(needsApproval({ status: 'confirmed', teeVerified: false })).toBe(true);
    expect(needsApproval({ status: 'submitted', teeVerified: false })).toBe(true);
    expect(needsApproval({ status: 'confirmed', teeVerified: false, approvedAt: '2026-10-11T00:00:00Z' })).toBe(false);
    expect(needsApproval({ status: 'confirmed', teeVerified: true })).toBe(false);
    expect(needsApproval({ status: 'confirmed', teeVerified: null })).toBe(false);
    expect(needsApproval({ status: 'playing', teeVerified: false })).toBe(false);
  });

  test('deadlineInfo: countdown, urgent under 2 hours', () => {
    const card = { status: 'announced', postBy };
    const info = deadlineInfo(card, at(-5 * H));
    expect(info.postBy.toISOString()).toBe('2026-10-10T18:00:00.000Z');
    expect(info).toMatchObject({ msLeft: 5 * H, urgent: false });
    expect(deadlineInfo(card, at(-2 * H)).urgent).toBe(false);
    expect(deadlineInfo(card, at(-2 * H + 1)).urgent).toBe(true);
    expect(deadlineInfo(card, at(H)).msLeft).toBe(-H);
  });

  test('deadlineInfo is null without a deadline or when not live', () => {
    expect(deadlineInfo({ status: 'announced', postBy: null }, at(0))).toBeNull();
    expect(deadlineInfo({ status: 'submitted', postBy }, at(0))).toBeNull();
    expect(deadlineInfo({ status: 'missed', postBy }, at(0))).toBeNull();
    expect(deadlineInfo(null, at(0))).toBeNull();
  });
});

describe('integrity rules (20261016000000)', () => {
  const NOW = new Date('2026-10-13T10:00:00Z');
  const h = (n) => new Date(NOW.getTime() + n * 3600000).toISOString();

  test('takesMonth: every card but a withdrawn or legacy void; an admin void still does (R15b)', () => {
    expect(takesMonth({ status: 'announced' })).toBe(true);
    expect(takesMonth({ status: 'missed' })).toBe(true);
    expect(takesMonth({ status: 'void', voidKind: 'admin' })).toBe(true);
    expect(takesMonth({ status: 'void', voidKind: 'withdrawn' })).toBe(false);
    expect(takesMonth({ status: 'void', voidKind: 'auto_withdrawn' })).toBe(false);
    expect(takesMonth({ status: 'void', voidKind: null })).toBe(false);
    expect(takesMonth(null)).toBe(false);
  });

  test('canAnnounce: an admin-voided card keeps the month taken', () => {
    const cards = [{ userId: 'u1', status: 'void', voidKind: 'admin', month: '2026-10-01' }];
    expect(canAnnounce(cards, 'u1', '2026-10')).toEqual({ ok: false, reason: 'already_has_card' });
    expect(canAnnounce([{ ...cards[0], voidKind: 'withdrawn' }], 'u1', '2026-10')).toEqual({ ok: true });
  });

  test('earliestOffAppTeeTime is 2 hours ahead (R7)', () => {
    expect(earliestOffAppTeeTime(NOW).toISOString()).toBe(h(2));
  });

  test('canReschedule: an announced off-app card whose tee time is at least 2 h away (R7)', () => {
    const card = { source: 'offapp', status: 'announced', teeTime: h(2) };
    expect(canReschedule(card, NOW)).toBe(true);
    expect(canReschedule({ ...card, teeTime: h(1.9) }, NOW)).toBe(false);
    expect(canReschedule({ ...card, source: 'app' }, NOW)).toBe(false);
    expect(canReschedule({ ...card, status: 'submitted' }, NOW)).toBe(false);
  });

  test('postOpensAt: tee time + 3 h for an announced off-app card (R8)', () => {
    expect(postOpensAt({ source: 'offapp', status: 'announced', teeTime: h(0) }).toISOString()).toBe(h(3));
    expect(postOpensAt({ source: 'app', status: 'playing', teeTime: h(0) })).toBeNull();
  });

  test('canWithdraw: before the tee time (off-app) or the first shot (app) (R9)', () => {
    expect(canWithdraw({ source: 'offapp', status: 'announced', teeTime: h(0.1) }, NOW)).toBe(true);
    expect(canWithdraw({ source: 'offapp', status: 'announced', teeTime: h(0) }, NOW)).toBe(false);
    expect(canWithdraw({ source: 'app', status: 'playing', firstShotAt: null }, NOW)).toBe(true);
    expect(canWithdraw({ source: 'app', status: 'playing', firstShotAt: h(-1) }, NOW)).toBe(false);
    expect(canWithdraw({ source: 'app', status: 'submitted', firstShotAt: null }, NOW)).toBe(false);
  });

  test('autoWithdrawAt: 24 h after Start for an app card with no first shot (R6)', () => {
    const card = { source: 'app', status: 'playing', announcedAt: h(0), firstShotAt: null, postBy: null };
    expect(autoWithdrawAt(card).toISOString()).toBe(h(24));
    expect(autoWithdrawAt({ ...card, firstShotAt: h(1) })).toBeNull();
    // A card announced before the rule keeps its post_by and is never withdrawn.
    expect(autoWithdrawAt({ ...card, postBy: h(8) })).toBeNull();
    expect(autoWithdrawAt({ ...card, source: 'offapp' })).toBeNull();
  });

  test('resubmitBy: 24 h after a marker sent the card back (R11)', () => {
    expect(resubmitBy({ status: 'submitted', returnedAt: h(0) }).toISOString()).toBe(h(24));
    expect(resubmitBy({ status: 'submitted', returnedAt: null })).toBeNull();
    expect(resubmitBy({ status: 'confirmed', returnedAt: h(0) })).toBeNull();
  });

  test('monthClosesAt: midnight Madrid starting day 4 of the next month (R12), both offsets', () => {
    expect(monthClosesAt('2026-09').toISOString()).toBe('2026-10-03T22:00:00.000Z');   // CEST
    expect(monthClosesAt('2026-10-01').toISOString()).toBe('2026-11-03T23:00:00.000Z'); // CET
    expect(monthClosesAt('2026-12').toISOString()).toBe('2027-01-03T23:00:00.000Z');    // year end
    expect(monthClosesAt('nope')).toBeNull();
  });

  test('isMonthClosed', () => {
    expect(isMonthClosed('2026-09', new Date('2026-10-03T21:59:59Z'))).toBe(false);
    expect(isMonthClosed('2026-09', new Date('2026-10-03T22:00:00Z'))).toBe(true);
    expect(isMonthClosed('2026-10', NOW)).toBe(false);
  });
});
