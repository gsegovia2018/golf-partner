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
  preserveLocalConflictState: jest.fn((target) => target),
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
  test('multi-round tournament appends the course when known, else "Round N"', () => {
    expect(formatRoundLabel({ kind: 'tournament', courseName: 'Santa Clara Golf Marbella', roundIndex: 2 }))
      .toBe('Round 3 · Santa Clara Golf Marbella');
    expect(formatRoundLabel({ kind: 'casual', courseName: '', roundIndex: 0 }))
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

  test('does not re-derive playing handicaps for an already-played round, but does for a future round', async () => {
    // No slope/tees on either round, so calcPlayingHandicap falls back to
    // Math.round(index) — a deliberately stale 99 could only still be 99 by
    // being left alone; a recomputed round would show the new index (20).
    const p1 = { id: 'p1', name: 'Ann', handicap: 10 };
    const p2 = { id: 'p2', name: 'Bea', handicap: 12 };
    const tournament = {
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      createdAt: '2026-05-18T09:00:00Z',
      currentRound: 1, // round 0 already played; round 1 is current/future
      players: [p1, p2],
      rounds: [
        {
          id: 'r1',
          holes: [],
          scores: {},
          pairs: [[{ ...p1 }], [{ ...p2 }]],
          playerHandicaps: { p1: 99, p2: 99 },
        },
        {
          id: 'r2',
          holes: [],
          scores: {},
          pairs: [[{ ...p1 }], [{ ...p2 }]],
          playerHandicaps: { p1: 99, p2: 99 },
        },
      ],
    };
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournament,
    };

    await propagatePlayerToTournaments('p1', { name: 'Ann', handicap: 20 });

    const saved = await readLocal('t1');
    // Played round: playing handicaps frozen.
    expect(saved.rounds[0].playerHandicaps).toEqual({ p1: 99, p2: 99 });
    // Future round: re-derived from the new index.
    expect(saved.rounds[1].playerHandicaps.p1).toBe(20);
    // Cosmetic pair-name/index-snapshot refresh still applies to the played round.
    expect(saved.rounds[0].pairs[0][0].name).toBe('Ann');
    expect(saved.rounds[0].pairs[0][0].handicap).toBe(20);
  });

  test('single-round game: currentRound stays 0 after the only round is scored, so it must still be protected', async () => {
    // Casual single-round games never advance currentRound past 0 — there's
    // no "next round" to move to. A naive idx < currentRound check therefore
    // gives zero protection to a played game. The round having scores is
    // what actually means "played" here.
    const p1 = { id: 'p1', name: 'Ann', handicap: 10 };
    const tournament = {
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      createdAt: '2026-05-18T09:00:00Z',
      currentRound: 0,
      players: [p1],
      rounds: [
        {
          id: 'r1',
          holes: [],
          scores: { p1: { 1: 4 } }, // the game has been played
          pairs: [[{ ...p1 }]],
          playerHandicaps: { p1: 99 },
        },
      ],
    };
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournament,
    };

    await propagatePlayerToTournaments('p1', { name: 'Ann', handicap: 20 });

    const saved = await readLocal('t1');
    // Played round: playing handicaps must stay frozen even though idx === currentRound.
    expect(saved.rounds[0].playerHandicaps).toEqual({ p1: 99 });
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

  test('leaves an already-played round\'s holes/tees/handicaps untouched, replaces a future round\'s', async () => {
    const p1 = { id: 'p1', name: 'Ann', handicap: 10 };
    const oldHoles = [{ number: 1, par: 4, strokeIndex: 1 }];
    const oldTees = [{ label: 'White', slope: 113, rating: 71 }];
    const tournament = {
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      createdAt: '2026-05-18T09:00:00Z',
      currentRound: 1, // round 0 already played; round 1 is current/future
      players: [p1],
      rounds: [
        {
          id: 'r1',
          courseId: 'c1',
          holes: oldHoles,
          tees: oldTees,
          scores: {},
          pairs: [[{ ...p1 }]],
          playerHandicaps: { p1: 99 },
        },
        {
          id: 'r2',
          courseId: 'c1',
          holes: oldHoles,
          tees: oldTees,
          scores: {},
          pairs: [[{ ...p1 }]],
          playerHandicaps: { p1: 99 },
        },
      ],
    };
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournament,
    };

    const newHoles = [{ number: 1, par: 5, strokeIndex: 2 }];
    const newTees = [{ label: 'White', slope: 130, rating: 72 }];
    await propagateCourseToTournaments('c1', { holes: newHoles, tees: newTees });

    const saved = await readLocal('t1');
    // Played round: holes/tees/handicaps entirely untouched.
    expect(saved.rounds[0].holes).toEqual(oldHoles);
    expect(saved.rounds[0].tees).toEqual(oldTees);
    expect(saved.rounds[0].playerHandicaps).toEqual({ p1: 99 });
    // Future round: replaced with the new library holes/tees, handicaps re-derived.
    expect(saved.rounds[1].holes).toEqual(newHoles);
    expect(saved.rounds[1].tees).toEqual(newTees);
    expect(saved.rounds[1].playerHandicaps.p1).not.toBe(99);
  });

  test('finished tournament: the last round is scored and idx === currentRound, so it must still be protected', async () => {
    // HomeScreen clamps currentRound so it never advances past the last
    // round; NextRoundScreen only bumps it when starting a NEXT round. So a
    // finished tournament's currentRound sits on the last (played) round's
    // index — idx < currentRound is false there. The round having scores is
    // what actually means "played".
    const p1 = { id: 'p1', name: 'Ann', handicap: 10 };
    const oldHoles = [{ number: 1, par: 4, strokeIndex: 1 }];
    const oldTees = [{ label: 'White', slope: 113, rating: 71 }];
    const tournament = {
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      createdAt: '2026-05-18T09:00:00Z',
      currentRound: 1, // clamped to the last round index once finished
      players: [p1],
      rounds: [
        {
          id: 'r1',
          courseId: 'c1',
          holes: oldHoles,
          tees: oldTees,
          scores: { p1: { 1: 4 } },
          pairs: [[{ ...p1 }]],
          playerHandicaps: { p1: 99 },
        },
        {
          id: 'r2',
          courseId: 'c1',
          holes: oldHoles,
          tees: oldTees,
          scores: { p1: { 1: 4 } }, // the final round has been played too
          pairs: [[{ ...p1 }]],
          playerHandicaps: { p1: 99 },
        },
      ],
    };
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournament,
    };

    const newHoles = [{ number: 1, par: 5, strokeIndex: 2 }];
    const newTees = [{ label: 'White', slope: 130, rating: 72 }];
    const updatedIds = await propagateCourseToTournaments('c1', { holes: newHoles, tees: newTees });

    // Both rounds reference courseId c1 and both are played (round 0 via
    // idx < currentRound, round 1 via having scores despite idx ===
    // currentRound), so nothing in this tournament changes — no local write
    // and no round.upsert mutation at all, distinct from the "leaves an
    // already-played round untouched, replaces a future round's" case above
    // where the future round drives a real persist.
    expect(updatedIds).toEqual([]);
    const roundUpsertCalls = mutate.mock.calls
      .map(([, m]) => m)
      .filter((m) => m.type === 'round.upsert');
    expect(roundUpsertCalls.length).toBe(0);
  });
});
