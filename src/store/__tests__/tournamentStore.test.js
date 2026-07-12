import {
  reTeeRound,
  tournamentNoun, tournamentNounCapitalized, formatRoundLabel,
  isRoundInProgress, propagatePlayerToTournaments, propagateCourseToTournaments, readLocal,
} from '../tournamentStore';
import { mutate } from '../mutate';

// jest.mock calls are hoisted above these imports by babel-jest, so the mock
// is in place before ../tournamentStore (and the supabase client it imports)
// loads. propagatePlayerToTournaments does real IO (loadAllTournaments +
// saveLocal + mutate()). loadAllTournaments now resolves via the
// get_my_game_tournaments RPC (see tournamentRepo.js) rather than a raw
// `tournaments` table select, so the mocked client below answers that RPC
// with `tournamentsRow.data` (the same blob the old row-shaped mock carried)
// wrapped in the `{ tournament, role }` shape fetchMyTournaments expects.
//
// mutate() itself (the server-write side — tournament.updatePlayer/
// round.upsert queued through the real sync worker) is exercised end-to-end
// in mutationWrites.test.js; here it's mocked to a no-op so this suite can
// assert on the thing THIS function is responsible for: the locally
// persisted (saveLocal'd) player/round data, read back via readLocal.
const mockState = { tournamentsRow: null };

jest.mock('../mutate', () => ({
  mutate: jest.fn((t) => Promise.resolve(t)),
  applyPendingMutations: jest.fn((t) => t),
  preserveLocalScoreConflicts: jest.fn((target) => target),
}));

jest.mock('../../lib/supabase', () => {
  function makeBuilder() {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      or: () => builder,
      upsert: () => Promise.resolve({ error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return builder;
  }
  return {
    supabase: {
      from: () => makeBuilder(),
      rpc: (name) => {
        if (name === 'get_my_game_tournaments') {
          const rows = mockState.tournamentsRow
            ? [{ tournament: mockState.tournamentsRow.data, role: 'owner' }]
            : [];
          return Promise.resolve({ data: rows, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

describe('reTeeRound', () => {
  const newTees = [
    { label: 'Black',  slope: 140, rating: 73.5 },
    { label: 'White',  slope: 130, rating: 71.0 }, // White edited: was 132/71.8
  ];

  test('refreshes a player tee snapshot from the matching new tee by label', () => {
    const round = {
      playerTees: { p1: { label: 'White', slope: 132, rating: 71.8 } },
    };
    const out = reTeeRound(round, newTees);
    expect(out.playerTees.p1).toEqual({ label: 'White', slope: 130, rating: 71.0 });
  });

  test('retains the existing snapshot when no new tee matches the label', () => {
    const round = {
      playerTees: { p1: { label: 'Yellow', slope: 118, rating: 68.0 } },
    };
    const out = reTeeRound(round, newTees);
    expect(out.playerTees.p1).toEqual({ label: 'Yellow', slope: 118, rating: 68.0 });
  });

  test('is a no-op when the round has no playerTees', () => {
    const round = { scores: {} };
    expect(reTeeRound(round, newTees)).toEqual({ scores: {} });
  });

  test('reTeeRound refreshes snapshots with the player\'s gender pair', () => {
    const round = { playerTees: { p1: { label: 'Amarillas', slope: 1, rating: 1 },
                                  p2: { label: 'Amarillas', slope: 1, rating: 1 } } };
    const tees = [{ label: 'Amarillas', rating: 72.7, slope: 141, ratingWomen: 79.3, slopeWomen: 151 }];
    const next = reTeeRound(round, tees, { p1: 'male', p2: 'female' });
    expect(next.playerTees.p1).toEqual({ label: 'Amarillas', slope: 141, rating: 72.7 });
    expect(next.playerTees.p2).toEqual({ label: 'Amarillas', slope: 151, rating: 79.3 });
  });
});

describe('tournamentNoun', () => {
  test('casual game kind returns "game"', () => {
    expect(tournamentNoun({ kind: 'game' })).toBe('game');
  });
  test('non-game kinds return "tournament"', () => {
    expect(tournamentNoun({ kind: 'casual' })).toBe('tournament');
    expect(tournamentNoun({ kind: 'official' })).toBe('tournament');
  });
  test('missing tournament returns "tournament"', () => {
    expect(tournamentNoun(null)).toBe('tournament');
    expect(tournamentNoun(undefined)).toBe('tournament');
  });
});

describe('tournamentNounCapitalized', () => {
  test('casual game kind returns "Game"', () => {
    expect(tournamentNounCapitalized({ kind: 'game' })).toBe('Game');
  });
  test('non-game kinds return "Tournament"', () => {
    expect(tournamentNounCapitalized({ kind: 'casual' })).toBe('Tournament');
  });
  test('missing tournament returns "Tournament"', () => {
    expect(tournamentNounCapitalized(null)).toBe('Tournament');
    expect(tournamentNounCapitalized(undefined)).toBe('Tournament');
  });
});

describe('formatRoundLabel', () => {
  test('game with a course name shows the course name', () => {
    expect(formatRoundLabel({ kind: 'game', courseName: 'Pebble Beach', roundIndex: 0 }))
      .toBe('Pebble Beach');
  });
  test('game without a course name falls back to "Round"', () => {
    expect(formatRoundLabel({ kind: 'game', courseName: '', roundIndex: 0 }))
      .toBe('Round');
    expect(formatRoundLabel({ kind: 'game', roundIndex: 0 }))
      .toBe('Round');
  });
  test('non-game shows "Round N" with a 1-based index', () => {
    expect(formatRoundLabel({ kind: 'casual', courseName: 'Ignored', roundIndex: 0 }))
      .toBe('Round 1');
    expect(formatRoundLabel({ kind: 'official', roundIndex: 2 }))
      .toBe('Round 3');
  });
});

describe('isRoundInProgress', () => {
  const players = [{ id: 'p1' }, { id: 'p2' }];
  const holes = [{ number: 1 }, { number: 2 }];
  const partialRound = {
    holes,
    scores: {
      p1: { 1: 4 },
      p2: { 1: 5 },
    },
  };

  test('treats a partial active round as in progress', () => {
    expect(isRoundInProgress({
      players,
      rounds: [partialRound],
      currentRound: 0,
    })).toBe(true);
  });

  test('treats an unscored active round as in progress', () => {
    expect(isRoundInProgress({
      players,
      rounds: [{ holes, scores: {} }],
      currentRound: 0,
    })).toBe(true);
  });

  test('does not treat an explicitly finished partial round as live scoring', () => {
    expect(isRoundInProgress({
      players,
      rounds: [partialRound],
      currentRound: 0,
      finishedAt: '2026-05-24T10:13:52.224Z',
    })).toBe(false);
  });
});

describe('propagatePlayerToTournaments', () => {
  function tournamentWith(p1Gender) {
    const p1 = { id: 'p1', name: 'Ann', handicap: 10, gender: p1Gender };
    const p2 = { id: 'p2', name: 'Bea', handicap: 12, gender: 'male' };
    return {
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      createdAt: '2026-05-18T09:00:00Z',
      players: [p1, p2],
      rounds: [{
        id: 'r1',
        holes: [],
        scores: {},
        pairs: [[{ ...p1 }], [{ ...p2 }]],
      }],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('stamps the provided gender onto the embedded player and its round.pairs snapshot', async () => {
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournamentWith('female'),
    };

    await propagatePlayerToTournaments('p1', { name: 'Ann', handicap: 10, gender: 'male' });

    const saved = await readLocal('t1');
    expect(saved.players.find((p) => p.id === 'p1').gender).toBe('male');
    expect(saved.rounds[0].pairs[0][0].gender).toBe('male');
    // The other player (not the one being patched) is untouched.
    expect(saved.players.find((p) => p.id === 'p2').gender).toBe('male');
  });

  test('leaves the embedded gender untouched when the patch omits it', async () => {
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournamentWith('female'),
    };

    await propagatePlayerToTournaments('p1', { name: 'Ann', handicap: 10 });

    const saved = await readLocal('t1');
    expect(saved.players.find((p) => p.id === 'p1').gender).toBe('female');
    expect(saved.rounds[0].pairs[0][0].gender).toBe('female');
  });

  // Regression fix follow-up: this sweep's round.upsert loop iterates
  // already-persisted rounds (never a brand-new one), so it must stamp
  // isNew: false — mutationWrites.js's round.upsert branch uses that to
  // route to repo.patchRound (owned fields only) instead of a full-body
  // repo.upsertRound that could clobber a concurrent device's pairs.set /
  // handicap.set / etc. write.
  test('stamps every round.upsert mutation with isNew: false', async () => {
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournamentWith('female'),
    };

    await propagatePlayerToTournaments('p1', { name: 'Ann', handicap: 10, gender: 'male' });

    const roundUpsertCalls = mutate.mock.calls
      .map(([, m]) => m)
      .filter((m) => m.type === 'round.upsert');
    expect(roundUpsertCalls.length).toBeGreaterThan(0);
    for (const m of roundUpsertCalls) {
      expect(m.isNew).toBe(false);
    }
  });
});

describe('propagateCourseToTournaments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Same regression-fix follow-up as propagatePlayerToTournaments above: a
  // course-library edit only ever touches rounds that already exist, so
  // every round.upsert it fires must be stamped isNew: false.
  test('stamps round.upsert mutations with isNew: false for changed rounds sharing the courseId', async () => {
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: {
        id: 't1',
        name: 'Cup',
        kind: 'casual',
        createdAt: '2026-05-18T09:00:00Z',
        players: [{ id: 'p1', name: 'Ann', handicap: 10, gender: 'male' }],
        rounds: [{
          id: 'r1', courseId: 'course-1', holes: [{ number: 1, par: 4, strokeIndex: 1 }], tees: [], scores: {},
        }],
      },
    };

    await propagateCourseToTournaments('course-1', {
      holes: [{ number: 1, par: 5, strokeIndex: 1 }],
      tees: [{ label: 'Blue', slope: 130, rating: 71 }],
    });

    const roundUpsertCalls = mutate.mock.calls
      .map(([, m]) => m)
      .filter((m) => m.type === 'round.upsert');
    expect(roundUpsertCalls.length).toBe(1);
    expect(roundUpsertCalls[0].isNew).toBe(false);
    expect(roundUpsertCalls[0].round.holes).toEqual([{ number: 1, par: 5, strokeIndex: 1 }]);
  });
});
