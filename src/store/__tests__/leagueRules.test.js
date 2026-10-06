import {
  cardMonth, madridMonthManual, canAnnounce, isNotAnnounced, scoreCard, clampHandicap,
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

  test('tee without par falls back to the sum of hole pars (72 here)', () => {
    const withPar = scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2, par: 72 } });
    const noPar = scoreCard({ holes, course, leagueHandicap: 18, tee: { slope: 125, rating: 71.2 } });
    expect(noPar.playingHandicap).toBe(withPar.playingHandicap);
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
