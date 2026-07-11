import {
  rowToTournament, reTeeRound,
  tournamentNoun, tournamentNounCapitalized, formatRoundLabel,
  isRoundInProgress, propagatePlayerToTournaments, propagateCourseToTournaments,
} from '../tournamentStore';

// jest.mock calls are hoisted above these imports by babel-jest, so the mock
// is in place before ../tournamentStore (and the supabase client it imports)
// loads. propagatePlayerToTournaments does real IO (loadAllTournaments +
// persistRemote), so — following the chainable-client pattern already used
// in officialAdmin.test.js — the supabase client here is a thenable query
// builder: every chain method (select/order/eq/or) returns the same builder,
// and awaiting it resolves the canned result for that table.
const mockState = { tournamentsRow: null, upserts: [] };

jest.mock('../../lib/supabase', () => {
  function makeBuilder(table) {
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      or: () => builder,
      upsert: (row) => {
        mockState.upserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
      then: (resolve) => {
        if (table === 'tournaments') {
          return resolve({ data: mockState.tournamentsRow ? [mockState.tournamentsRow] : [], error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  }
  return {
    supabase: {
      from: (table) => makeBuilder(table),
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

describe('rowToTournament', () => {
  test('official tournament: identity comes from columns, content defaults empty', () => {
    // Official tournaments keep their state in side tables; the `data` blob
    // is empty, so the Home-list entry must be built from the row columns.
    const row = {
      id: 'uuid-official-1',
      name: 'Weekend Golf',
      kind: 'official',
      created_at: '2026-05-18T09:00:00Z',
      data: {},
    };
    expect(rowToTournament(row, 'owner')).toEqual({
      id: 'uuid-official-1',
      name: 'Weekend Golf',
      kind: 'official',
      createdAt: '2026-05-18T09:00:00Z',
      rounds: [],
      players: [],
      _role: 'owner',
    });
  });

  test('casual tournament: the data blob wins over the columns', () => {
    const row = {
      id: '1700000000000',
      name: 'column name',
      kind: 'casual',
      created_at: '2026-05-18T09:00:00Z',
      data: {
        id: '1700000000000',
        name: 'Blob Name',
        kind: 'tournament',
        createdAt: '2026-05-18T08:00:00Z',
        players: [{ id: 'p1', name: 'Ann' }],
        rounds: [{ courseName: 'Pebble' }],
        currentRound: 0,
      },
    };
    const t = rowToTournament(row, 'viewer');
    expect(t.kind).toBe('tournament');
    expect(t.name).toBe('Blob Name');
    expect(t.players).toEqual([{ id: 'p1', name: 'Ann' }]);
    expect(t.rounds).toEqual([{ courseName: 'Pebble' }]);
    expect(t._role).toBe('viewer');
  });
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
    mockState.upserts = [];
  });

  test('stamps the provided gender onto the embedded player and its round.pairs snapshot', async () => {
    mockState.tournamentsRow = {
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-05-18T09:00:00Z',
      data: tournamentWith('female'),
    };

    await propagatePlayerToTournaments('p1', { name: 'Ann', handicap: 10, gender: 'male' });

    const saved = mockState.upserts.find((u) => u.table === 'tournaments').row.data;
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

    const saved = mockState.upserts.find((u) => u.table === 'tournaments').row.data;
    expect(saved.players.find((p) => p.id === 'p1').gender).toBe('female');
    expect(saved.rounds[0].pairs[0][0].gender).toBe('female');
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

    const saved = mockState.upserts.find((u) => u.table === 'tournaments').row.data;
    // Played round: playing handicaps frozen.
    expect(saved.rounds[0].playerHandicaps).toEqual({ p1: 99, p2: 99 });
    // Future round: re-derived from the new index.
    expect(saved.rounds[1].playerHandicaps.p1).toBe(20);
    // Cosmetic pair-name/index-snapshot refresh still applies to the played round.
    expect(saved.rounds[0].pairs[0][0].name).toBe('Ann');
    expect(saved.rounds[0].pairs[0][0].handicap).toBe(20);
  });
});

describe('propagateCourseToTournaments', () => {
  beforeEach(() => {
    mockState.upserts = [];
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

    const saved = mockState.upserts.find((u) => u.table === 'tournaments').row.data;
    // Played round: holes/tees/handicaps entirely untouched.
    expect(saved.rounds[0].holes).toEqual(oldHoles);
    expect(saved.rounds[0].tees).toEqual(oldTees);
    expect(saved.rounds[0].playerHandicaps).toEqual({ p1: 99 });
    // Future round: replaced with the new library holes/tees, handicaps re-derived.
    expect(saved.rounds[1].holes).toEqual(newHoles);
    expect(saved.rounds[1].tees).toEqual(newTees);
    expect(saved.rounds[1].playerHandicaps.p1).not.toBe(99);
  });
});
