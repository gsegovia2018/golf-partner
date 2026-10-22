import {
  eligibleLeagues, leagueStrokes, applyLeagueHandicap, leagueCourse, leagueCardOf, isLeagueLength, madridDate,
  isLeagueRated, leagueCardsOf, leagueCardKey, leagueCardsPatch, seasonPhase, preselectedLeagueMissing,
  leagueLocksForRound,
} from '../leagueSetup';
import { getPlayingHandicap } from '../scoring';

const NOW = new Date('2026-10-15T10:00:00Z');
const league = (over = {}) => ({
  id: 'L1', name: 'Tour', seasonStart: '2026-01-01', seasonEnd: '2026-12-31', archivedAt: null, leagueHandicap: 18, ...over,
});
const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const yellow = { label: 'Yellow', slope: 125, rating: 72 };

describe('eligibleLeagues', () => {
  test('an open league in season with no card this month is offered', () => {
    expect(eligibleLeagues({ leagues: [league()], cards: [], userId: 'u1', now: NOW }).map((l) => l.id)).toEqual(['L1']);
  });

  test('already has a card this month: not offered (void cards do not count)', () => {
    const live = { leagueId: 'L1', userId: 'u1', month: '2026-10-01', status: 'playing' };
    expect(eligibleLeagues({ leagues: [league()], cards: [live], userId: 'u1', now: NOW })).toEqual([]);
    const voided = { ...live, status: 'void' };
    expect(eligibleLeagues({ leagues: [league()], cards: [voided], userId: 'u1', now: NOW })).toHaveLength(1);
  });

  test("another league's card does not block this one", () => {
    const other = { leagueId: 'L2', userId: 'u1', month: '2026-10-01', status: 'confirmed' };
    expect(eligibleLeagues({ leagues: [league()], cards: [other], userId: 'u1', now: NOW })).toHaveLength(1);
  });

  test('archived or outside the season: not offered', () => {
    expect(eligibleLeagues({ leagues: [league({ archivedAt: '2026-09-01' })], cards: [], userId: 'u1', now: NOW })).toEqual([]);
    expect(eligibleLeagues({ leagues: [league({ seasonStart: '2026-11-01' })], cards: [], userId: 'u1', now: NOW })).toEqual([]);
    expect(eligibleLeagues({ leagues: [league({ seasonEnd: '2026-10-14' })], cards: [], userId: 'u1', now: NOW })).toEqual([]);
  });

  test('signed out: nothing', () => {
    expect(eligibleLeagues({ leagues: [league()], cards: [], userId: null, now: NOW })).toEqual([]);
  });
});

test('preselectedLeagueMissing: only once the list loaded without the board\'s league', () => {
  const leagues = [league(), league({ id: 'L2' })];
  expect(preselectedLeagueMissing({ leagues, pickId: 'L2' })).toBe(false);
  expect(preselectedLeagueMissing({ leagues, pickId: 'L9' })).toBe(true);
  expect(preselectedLeagueMissing({ leagues: [], pickId: 'L9', loading: true })).toBe(false);
  expect(preselectedLeagueMissing({ leagues: [], pickId: 'L9', error: true })).toBe(false);
  expect(preselectedLeagueMissing({ leagues, pickId: null })).toBe(false);
});

test('seasonPhase: before the first day, after the last, null inside (Madrid days)', () => {
  expect(seasonPhase(league(), NOW)).toBeNull();
  expect(seasonPhase(league({ seasonStart: '2026-11-01' }), NOW)).toBe('before');
  expect(seasonPhase(league({ seasonEnd: '2026-10-14' }), NOW)).toBe('after');
  expect(seasonPhase(league({ seasonEnd: '2026-10-15' }), NOW)).toBeNull();
  // 23:30 UTC on 31 Oct is already 1 Nov in Madrid.
  expect(seasonPhase(league({ seasonStart: '2026-11-01' }), new Date('2026-10-31T23:30:00Z'))).toBeNull();
});

test('madridDate uses the Madrid calendar day', () => {
  expect(madridDate(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
});

describe('league handicap on the round', () => {
  const round = { courseName: ' Centro ', holes: holes18, tees: [yellow], playerTees: null };

  test('strokes come from the league handicap on my tee (18.0 on Yellow 125/72 = 20)', () => {
    expect(leagueStrokes(round, 'p1', 18)).toBe(20);
    expect(leagueStrokes({ ...round, tees: [] }, 'p1', 18)).toBe(18);
  });

  test('applyLeagueHandicap sets the index override and the playing handicap the scorecard reads', () => {
    const built = {
      ...round, playerTees: { p1: yellow, p2: yellow },
      playerHandicaps: { p1: 5, p2: 12 }, manualHandicaps: { p1: true },
    };
    const out = applyLeagueHandicap(built, 'p1', 18);
    expect(out.playerIndexes).toEqual({ p1: 18 });
    expect(out.playerHandicaps).toEqual({ p1: 20, p2: 12 });
    expect(out.manualHandicaps.p1).toBe(false);
    expect(getPlayingHandicap(out, { id: 'p1', handicap: 4 })).toBe(20);
  });

  test('leagueCourse is the announce snapshot', () => {
    const out = leagueCourse({ ...round, playerTees: { p1: yellow } }, 'p1');
    expect(out).toMatchObject({ name: 'Centro', tee: 'Yellow', slope: 125, rating: 72, par: 72 });
    expect(out.holes[0]).toEqual({ n: 1, par: 4, si: 1 });
    expect(out.holes).toHaveLength(18);
  });

  test('leagueCourse carries the library course id so the server can verify the tee', () => {
    expect(leagueCourse({ ...round, courseId: 'b1c00000-0000-4000-8000-000000000001' }, 'p1'))
      .toMatchObject({ course_id: 'b1c00000-0000-4000-8000-000000000001' });
    expect(leagueCourse({ ...round, courseId: undefined }, 'p1')).toMatchObject({ course_id: null });
  });

  test('leagueCourse snapshots the default tee, else the legacy round slope/rating, else nulls', () => {
    expect(leagueCourse(round, 'p1')).toMatchObject({ tee: 'Yellow', slope: 125, rating: 72 });
    expect(leagueCourse({ ...round, tees: [], slope: 130, courseRating: 71.4 }, 'p1'))
      .toMatchObject({ tee: null, slope: 130, rating: 71.4 });
    expect(leagueCourse({ ...round, tees: [] }, 'p1')).toMatchObject({ tee: null, slope: null, rating: null });
  });

  test('isLeagueRated: my tee needs both a slope and a course rating', () => {
    expect(isLeagueRated(round, 'p1')).toBe(true);
    expect(isLeagueRated({ ...round, playerTees: { p1: { label: 'Red', slope: 120, rating: null } } }, 'p1')).toBe(false);
    expect(isLeagueRated({ ...round, playerTees: { p1: { label: 'Red', slope: null, rating: 70 } } }, 'p1')).toBe(false);
    expect(isLeagueRated({ ...round, tees: [] }, 'p1')).toBe(false);
    expect(isLeagueRated({ ...round, tees: [], slope: 130, courseRating: 71.4 }, 'p1')).toBe(true);
    expect(isLeagueRated(null, 'p1')).toBe(false);
  });

  test('isLeagueLength: only 18 holes', () => {
    expect(isLeagueLength(round)).toBe(true);
    expect(isLeagueLength({ holes: holes18.slice(0, 9) })).toBe(false);
  });
});

test("leagueCardOf: only the card owner's player, from the top level or props", () => {
  const lg = { leagueId: 'L1', cardId: 'c1', playerId: 'p1' };
  expect(leagueCardOf({ league: lg }, 'p1')).toBe(lg);
  expect(leagueCardOf({ props: { league: lg } }, 'p1')).toBe(lg);
  expect(leagueCardOf({ league: lg }, 'p2')).toBeNull();
  expect(leagueCardOf({}, 'p1')).toBeNull();
});

describe('several league cards per game (R16, R17)', () => {
  const legacy = { leagueId: 'L1', cardId: 'c1', playerId: 'p1' };
  const t = {
    rounds: [{ id: 'r0' }, { id: 'r1' }],
    league: legacy,
    props: {},
    leagueCards: {
      'r0:p2': { leagueId: 'L1', cardId: 'c2', playerId: 'p2', roundId: 'r0' },
      'r1:p1': { leagueId: 'L2', cardId: 'c3', playerId: 'p1', roundId: 'r1' },
    },
  };

  test('leagueCardsOf lists the legacy link (as round 0) and every entry once', () => {
    expect(leagueCardsOf(t).map((e) => [e.cardId, e.roundId])).toEqual([['c1', 'r0'], ['c2', 'r0'], ['c3', 'r1']]);
    expect(leagueCardsOf({ ...t, leagueCards: { x: { ...legacy, roundId: 'r0' } } })).toHaveLength(1);
    expect(leagueCardsOf({})).toEqual([]);
  });

  test('leagueCardOf finds my card, per round when asked', () => {
    expect(leagueCardOf(t, 'p2')?.cardId).toBe('c2');
    expect(leagueCardOf(t, 'p1', 'r0')?.cardId).toBe('c1');
    expect(leagueCardOf(t, 'p1', 'r1')?.cardId).toBe('c3');
    expect(leagueCardOf(t, 'p2', 'r1')).toBeNull();
    expect(leagueCardOf(t, 'p9')).toBeNull();
    // Entries can live under props too (get_game_tournament spreads them back).
    expect(leagueCardOf({ props: { leagueCards: t.leagueCards } }, 'p2')?.cardId).toBe('c2');
  });

  test('leagueCardOf with only the legacy link behaves as before', () => {
    expect(leagueCardOf({ league: legacy, rounds: [{ id: 'r0' }] }, 'p1', 'r0')).toBe(legacy);
    expect(leagueCardOf({ league: legacy, rounds: [{ id: 'r0' }] }, 'p1', 'r1')).toBeNull();
  });

  test('leagueLocksForRound locks every carded player of that round to the frozen handicap and tee', () => {
    const r0 = { id: 'r0', playerIndexes: { p1: 14.5, p2: '8.2', p3: 20 } };
    expect(leagueLocksForRound(t, r0)).toEqual({
      p1: { leagueHandicap: 14.5, teeLocked: true },
      p2: { leagueHandicap: 8.2, teeLocked: true },
    });
    // A card whose round has no index override yet still locks, with no handicap.
    expect(leagueLocksForRound(t, { id: 'r1' })).toEqual({ p1: { leagueHandicap: null, teeLocked: true } });
    expect(leagueLocksForRound(t, { id: 'r9' })).toEqual({});
    expect(leagueLocksForRound({}, r0)).toEqual({});
    expect(leagueLocksForRound(t, null)).toEqual({});
  });

  test('leagueCardsPatch keys my entry by round and player (merged one level deep)', () => {
    expect(leagueCardKey('r1', 'p1')).toBe('r1:p1');
    expect(leagueCardsPatch({ leagueId: 'L1', cardId: 'c9', playerId: 'p1', roundId: 'r1' })).toEqual({
      leagueCards: { 'r1:p1': { leagueId: 'L1', cardId: 'c9', playerId: 'p1', roundId: 'r1' } },
    });
  });

  test('eligibleLeagues: an admin-voided card this month keeps the league off the switch (R15b)', () => {
    const lg = { id: 'L1', name: 'Tour', seasonStart: '2026-01-01', seasonEnd: '2026-12-31', archivedAt: null };
    const now = new Date('2026-10-15T10:00:00Z');
    const card = { leagueId: 'L1', userId: 'me', month: '2026-10-01', status: 'void', voidKind: 'admin' };
    expect(eligibleLeagues({ leagues: [lg], cards: [card], userId: 'me', now })).toEqual([]);
    expect(eligibleLeagues({ leagues: [lg], cards: [{ ...card, voidKind: 'withdrawn' }], userId: 'me', now }))
      .toEqual([lg]);
  });
});
