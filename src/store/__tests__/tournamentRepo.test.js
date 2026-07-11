// tournamentRepo.js — client repository over the sync-v2 `game_*`
// tables/RPCs (supabase/migrations/20260712000000_sync_v2_normalized.sql).
//
// Uses the per-test doMock + resetModules + require pattern (see
// tournamentStoreSync.test.js): a chainable `.from()` mock records every
// call so tests can assert exact table/args, and `.rpc()` is recorded the
// same way. Round ids are only unique per-tournament (Task 5 finding), so
// every child-table call must carry tournament_id alongside round_id.

const fixtureSingleRound = require('./fixtures/syncV2/fixture-1783716675062.json');

let mockState;

function installMocks() {
  jest.resetModules();
  mockState = {
    userId: null,
    rpcCalls: [],
    rpcResult: { data: null, error: null },
    fromCalls: [], // [{ table, ops: [{ method, ...args }] }]
  };

  jest.doMock('../../lib/supabase', () => {
    function makeBuilder(table) {
      const record = { table, ops: [] };
      mockState.fromCalls.push(record);
      const builder = {
        upsert: (rows, opts) => {
          record.ops.push({ method: 'upsert', rows, opts });
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => {
          record.ops.push({ method: 'delete' });
          return builder;
        },
        match: (obj) => {
          record.ops.push({ method: 'match', obj });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    }

    return {
      supabase: {
        rpc: (name, args) => {
          mockState.rpcCalls.push({ name, args });
          return Promise.resolve(mockState.rpcResult);
        },
        from: (table) => makeBuilder(table),
        auth: {
          getUser: () => Promise.resolve({
            data: { user: mockState.userId ? { id: mockState.userId } : null },
          }),
        },
      },
    };
  });
}

beforeEach(() => installMocks());

function lastFromCall(table) {
  return [...mockState.fromCalls].reverse().find((c) => c.table === table);
}

describe('fetchTournament', () => {
  test('calls get_game_tournament with p_id and returns the row', async () => {
    mockState.rpcResult = { data: { id: 't1', name: 'Cup' }, error: null };
    const { fetchTournament } = require('../tournamentRepo');

    const result = await fetchTournament('t1');

    expect(mockState.rpcCalls).toEqual([{ name: 'get_game_tournament', args: { p_id: 't1' } }]);
    expect(result).toEqual({ id: 't1', name: 'Cup' });
  });

  test('returns null when the RPC returns null', async () => {
    mockState.rpcResult = { data: null, error: null };
    const { fetchTournament } = require('../tournamentRepo');

    expect(await fetchTournament('missing')).toBeNull();
  });

  test('throws on RPC error', async () => {
    mockState.rpcResult = { data: null, error: { message: 'boom' } };
    const { fetchTournament } = require('../tournamentRepo');

    await expect(fetchTournament('t1')).rejects.toEqual({ message: 'boom' });
  });
});

describe('fetchMyTournaments', () => {
  test('calls get_my_game_tournaments and maps {tournament, role} to {...t, _role}', async () => {
    mockState.rpcResult = {
      data: [
        { tournament: { id: 't1', name: 'Cup' }, role: 'owner' },
        { tournament: { id: 't2', name: 'Open' }, role: 'member' },
      ],
      error: null,
    };
    const { fetchMyTournaments } = require('../tournamentRepo');

    const result = await fetchMyTournaments();

    expect(mockState.rpcCalls).toEqual([{ name: 'get_my_game_tournaments', args: undefined }]);
    expect(result).toEqual([
      { id: 't1', name: 'Cup', _role: 'owner' },
      { id: 't2', name: 'Open', _role: 'member' },
    ]);
  });

  test('handles a null response as an empty list', async () => {
    mockState.rpcResult = { data: null, error: null };
    const { fetchMyTournaments } = require('../tournamentRepo');

    expect(await fetchMyTournaments()).toEqual([]);
  });

  test('handles an empty-array response', async () => {
    mockState.rpcResult = { data: [], error: null };
    const { fetchMyTournaments } = require('../tournamentRepo');

    expect(await fetchMyTournaments()).toEqual([]);
  });

  test('throws on RPC error', async () => {
    mockState.rpcResult = { data: null, error: { message: 'boom' } };
    const { fetchMyTournaments } = require('../tournamentRepo');

    await expect(fetchMyTournaments()).rejects.toEqual({ message: 'boom' });
  });
});

describe('setScore', () => {
  test('calls set_game_score with the confirmed param order and returns previous* fields', async () => {
    mockState.rpcResult = {
      data: { previousStrokes: 4, previousUpdatedAt: '2026-07-10T00:00:00Z' },
      error: null,
    };
    const { setScore } = require('../tournamentRepo');

    const result = await setScore({
      tournamentId: 't1', roundId: 'r0', playerId: 'p1', hole: 3, strokes: 5,
    });

    expect(mockState.rpcCalls).toEqual([{
      name: 'set_game_score',
      args: { p_round_id: 'r0', p_tournament_id: 't1', p_player_id: 'p1', p_hole: 3, p_strokes: 5 },
    }]);
    expect(result).toEqual({ previousStrokes: 4, previousUpdatedAt: '2026-07-10T00:00:00Z' });
  });

  test('a null strokes tombstone is passed through as-is (RPC handles it)', async () => {
    const { setScore } = require('../tournamentRepo');

    await setScore({ tournamentId: 't1', roundId: 'r0', playerId: 'p1', hole: 3, strokes: null });

    expect(mockState.rpcCalls[0].args.p_strokes).toBeNull();
  });

  test('throws on RPC error', async () => {
    mockState.rpcResult = { data: null, error: { message: 'boom' } };
    const { setScore } = require('../tournamentRepo');

    await expect(setScore({
      tournamentId: 't1', roundId: 'r0', playerId: 'p1', hole: 1, strokes: 4,
    })).rejects.toEqual({ message: 'boom' });
  });
});

describe('setShotDetail', () => {
  test('upserts game_shot_details keyed by tournament_id+round_id+player_id+hole', async () => {
    const { setShotDetail } = require('../tournamentRepo');

    await setShotDetail({
      tournamentId: 't1', roundId: 'r0', playerId: 'p1', hole: 5, detail: { club: 'driver' },
    });

    const call = lastFromCall('game_shot_details');
    expect(call.ops[0].method).toBe('upsert');
    expect(call.ops[0].rows).toMatchObject({
      tournament_id: 't1', round_id: 'r0', player_id: 'p1', hole: 5, detail: { club: 'driver' },
    });
  });

  test('a null detail still upserts the row (tombstone)', async () => {
    const { setShotDetail } = require('../tournamentRepo');

    await setShotDetail({ tournamentId: 't1', roundId: 'r0', playerId: 'p1', hole: 5, detail: null });

    const call = lastFromCall('game_shot_details');
    expect(call.ops[0].rows).toMatchObject({ detail: null });
  });

  test('throws on upsert error', async () => {
    jest.resetModules();
    mockState.userId = null;
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: null }),
        from: () => ({
          upsert: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
        auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      },
    }));
    const { setShotDetail } = require('../tournamentRepo');

    await expect(setShotDetail({
      tournamentId: 't1', roundId: 'r0', playerId: 'p1', hole: 1, detail: null,
    })).rejects.toEqual({ message: 'boom' });
  });
});

describe('setNote', () => {
  test('upserts game_round_notes keyed by tournament_id+round_id+hole_key', async () => {
    const { setNote } = require('../tournamentRepo');

    await setNote({ tournamentId: 't1', roundId: 'r0', holeKey: '5', note: 'wet fairway' });

    const call = lastFromCall('game_round_notes');
    expect(call.ops[0].rows).toMatchObject({
      tournament_id: 't1', round_id: 'r0', hole_key: '5', note: 'wet fairway',
    });
  });

  test.each([null, ''])('a %p note still upserts the row as null (tombstone)', async (note) => {
    const { setNote } = require('../tournamentRepo');

    await setNote({ tournamentId: 't1', roundId: 'r0', holeKey: 'round', note });

    const call = lastFromCall('game_round_notes');
    expect(call.ops[0].rows.note).toBeNull();
  });
});

describe('patchRound', () => {
  test('calls patch_game_round with tournament_id, round_id, patch', async () => {
    const { patchRound } = require('../tournamentRepo');

    await patchRound('t1', 'r0', { notes: 'wet' });

    expect(mockState.rpcCalls).toEqual([{
      name: 'patch_game_round',
      args: { p_tournament_id: 't1', p_round_id: 'r0', p_patch: { notes: 'wet' } },
    }]);
  });

  test('throws on RPC error', async () => {
    mockState.rpcResult = { data: null, error: { message: 'boom' } };
    const { patchRound } = require('../tournamentRepo');

    await expect(patchRound('t1', 'r0', {})).rejects.toEqual({ message: 'boom' });
  });
});

describe('patchTournament', () => {
  test('calls patch_game_tournament with id + patch', async () => {
    const { patchTournament } = require('../tournamentRepo');

    await patchTournament('t1', { name: 'New name' });

    expect(mockState.rpcCalls).toEqual([{
      name: 'patch_game_tournament',
      args: { p_id: 't1', p_patch: { name: 'New name' } },
    }]);
  });
});

describe('advanceRound', () => {
  test('calls advance_game_round with id + round index', async () => {
    const { advanceRound } = require('../tournamentRepo');

    await advanceRound('t1', 2);

    expect(mockState.rpcCalls).toEqual([{
      name: 'advance_game_round',
      args: { p_id: 't1', p_round: 2 },
    }]);
  });
});

describe('upsertPlayer', () => {
  test('upserts game_players with pos and body=player, user_id extracted', async () => {
    const { upsertPlayer } = require('../tournamentRepo');
    const player = { id: 'p1', name: 'Ann', user_id: 'u1' };

    await upsertPlayer('t1', player, 2);

    const call = lastFromCall('game_players');
    expect(call.ops[0].rows).toMatchObject({
      tournament_id: 't1', player_id: 'p1', user_id: 'u1', pos: 2, body: player,
    });
  });

  test('a player with no user_id upserts user_id as null', async () => {
    const { upsertPlayer } = require('../tournamentRepo');
    const player = { id: 'p1', name: 'Ann' };

    await upsertPlayer('t1', player, 0);

    const call = lastFromCall('game_players');
    expect(call.ops[0].rows.user_id).toBeNull();
  });
});

describe('deletePlayer', () => {
  test('deletes the game_players row matched by tournament_id+player_id', async () => {
    const { deletePlayer } = require('../tournamentRepo');

    await deletePlayer('t1', 'p1');

    const call = lastFromCall('game_players');
    expect(call.ops.map((o) => o.method)).toEqual(['delete', 'match']);
    expect(call.ops[1].obj).toEqual({ tournament_id: 't1', player_id: 'p1' });
  });
});

describe('clearPlayerRound', () => {
  test('deletes both game_scores and game_shot_details rows for the player, tournament-scoped', async () => {
    const { clearPlayerRound } = require('../tournamentRepo');

    await clearPlayerRound('t1', 'r0', 'p1');

    const scoresCall = lastFromCall('game_scores');
    expect(scoresCall.ops[1].obj).toEqual({ tournament_id: 't1', round_id: 'r0', player_id: 'p1' });

    const shotDetailsCall = lastFromCall('game_shot_details');
    expect(shotDetailsCall.ops[1].obj).toEqual({ tournament_id: 't1', round_id: 'r0', player_id: 'p1' });
  });
});

describe('deleteRound', () => {
  test('deletes the game_rounds row matched by tournament_id+id', async () => {
    const { deleteRound } = require('../tournamentRepo');

    await deleteRound('t1', 'r0');

    const call = lastFromCall('game_rounds');
    expect(call.ops.map((o) => o.method)).toEqual(['delete', 'match']);
    expect(call.ops[1].obj).toEqual({ tournament_id: 't1', id: 'r0' });
  });
});

describe('upsertRound', () => {
  test('upserts game_rounds with body = round minus scores/shotDetails/notes', async () => {
    const { upsertRound } = require('../tournamentRepo');
    const round = {
      id: 'r0',
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: { p1: { 1: 4 } },
      shotDetails: { p1: { 1: { club: 'driver' } } },
      notes: { round: 'sunny' },
    };

    await upsertRound('t1', 0, round);

    const call = lastFromCall('game_rounds');
    expect(call.ops[0].rows).toMatchObject({ id: 'r0', tournament_id: 't1', round_index: 0 });
    expect(call.ops[0].rows.body).toEqual({ id: 'r0', holes: [{ number: 1, par: 4, strokeIndex: 1 }] });
  });

  test('also strips scoreConflicts/scoreResolutions (matches the server round-body contract)', async () => {
    const { upsertRound } = require('../tournamentRepo');
    const round = {
      id: 'r0',
      scoreConflicts: { p1: {} },
      scoreResolutions: { p1: {} },
    };

    await upsertRound('t1', 0, round);

    const call = lastFromCall('game_rounds');
    expect(call.ops[0].rows.body).toEqual({ id: 'r0' });
  });
});

describe('createTournament', () => {
  test('splits t into tournament columns + props (props = t minus hot keys)', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    const t = {
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 1, players: [], rounds: [], meId: 'p1', _meta: { foo: 1 },
      settings: { fixedTeams: true },
    };

    await createTournament(t);

    const call = lastFromCall('tournaments');
    expect(call.ops[0].method).toBe('upsert');
    expect(call.ops[0].rows).toEqual({
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-07-10T00:00:00Z',
      created_by: 'u1', props: { settings: { fixedTeams: true } }, current_round: 1,
    });
  });

  test('omits created_by when there is no signed-in user (matches persistRemote)', async () => {
    mockState.userId = null;
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: null, players: [], rounds: [],
    });

    const call = lastFromCall('tournaments');
    expect(call.ops[0].rows.created_by).toBeUndefined();
    expect(call.ops[0].rows.current_round).toBeNull();
  });

  test('inserts game_players rows with pos = array index and body = player', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    const players = [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bea', user_id: 'u2' }];

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players, rounds: [],
    });

    const call = lastFromCall('game_players');
    expect(call.ops[0].rows).toEqual([
      { tournament_id: 't1', player_id: 'p1', user_id: null, pos: 0, body: players[0] },
      { tournament_id: 't1', player_id: 'p2', user_id: 'u2', pos: 1, body: players[1] },
    ]);
  });

  test('inserts game_rounds rows with body = round minus scores/shotDetails/notes', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    const rounds = [{
      id: 'r0', holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: { p1: { 1: 4 } }, shotDetails: {}, notes: {},
    }];

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [], rounds,
    });

    const call = lastFromCall('game_rounds');
    expect(call.ops[0].rows).toEqual([{
      id: 'r0', tournament_id: 't1', round_index: 0,
      body: { id: 'r0', holes: [{ number: 1, par: 4, strokeIndex: 1 }] },
    }]);
  });

  test('fans scores/shotDetails/notes out into their own row sets when present (offline-created tournament)', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    const rounds = [{
      id: 'r0',
      scores: { p1: { 1: 4, 2: 5 } },
      shotDetails: { p1: { 1: { club: 'driver' } } },
      notes: { round: 'sunny', hole: { 3: 'wet' } },
    }];

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [], rounds,
    });

    const scoresCall = lastFromCall('game_scores');
    expect(scoresCall.ops[0].rows).toEqual(expect.arrayContaining([
      { round_id: 'r0', tournament_id: 't1', player_id: 'p1', hole: 1, strokes: 4 },
      { round_id: 'r0', tournament_id: 't1', player_id: 'p1', hole: 2, strokes: 5 },
    ]));
    expect(scoresCall.ops[0].rows).toHaveLength(2);

    const shotDetailsCall = lastFromCall('game_shot_details');
    expect(shotDetailsCall.ops[0].rows).toEqual([
      { round_id: 'r0', tournament_id: 't1', player_id: 'p1', hole: 1, detail: { club: 'driver' } },
    ]);

    const notesCall = lastFromCall('game_round_notes');
    expect(notesCall.ops[0].rows).toEqual(expect.arrayContaining([
      { round_id: 'r0', tournament_id: 't1', hole_key: 'round', note: 'sunny' },
      { round_id: 'r0', tournament_id: 't1', hole_key: '3', note: 'wet' },
    ]));
    expect(notesCall.ops[0].rows).toHaveLength(2);
  });

  test('skips game_scores/game_shot_details/game_round_notes upserts when a round has none', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [], rounds: [{ id: 'r0' }],
    });

    expect(mockState.fromCalls.some((c) => c.table === 'game_scores')).toBe(false);
    expect(mockState.fromCalls.some((c) => c.table === 'game_shot_details')).toBe(false);
    expect(mockState.fromCalls.some((c) => c.table === 'game_round_notes')).toBe(false);
  });

  test('handles a realistic single-round fixture end to end without throwing', async () => {
    mockState.userId = null;
    const { createTournament } = require('../tournamentRepo');

    await expect(createTournament(fixtureSingleRound)).resolves.toBeUndefined();

    const tournamentsCall = lastFromCall('tournaments');
    expect(tournamentsCall.ops[0].rows.id).toBe('1783716675062');
    expect(tournamentsCall.ops[0].rows.props.meId).toBeUndefined();
    expect(tournamentsCall.ops[0].rows.props._meta).toBeUndefined();
    expect(tournamentsCall.ops[0].rows.props.players).toBeUndefined();
    expect(tournamentsCall.ops[0].rows.props.rounds).toBeUndefined();

    const playersCall = lastFromCall('game_players');
    expect(playersCall.ops[0].rows).toHaveLength(4);

    const scoresCall = lastFromCall('game_scores');
    // 17 holes for p1 + 16 for p2/p3 + 17 for p4 = 66 cells (see fixture).
    expect(scoresCall.ops[0].rows.length).toBeGreaterThan(0);
  });

  test('throws when the tournaments upsert errors, without inserting players/rounds', async () => {
    mockState.rpcResult = { data: null, error: null };
    jest.resetModules();
    mockState.userId = null;
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: null }),
        from: (table) => ({
          upsert: () => Promise.resolve(
            table === 'tournaments' ? { data: null, error: { message: 'boom' } } : { data: null, error: null },
          ),
        }),
        auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      },
    }));
    const { createTournament } = require('../tournamentRepo');

    await expect(createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [{ id: 'p1', name: 'Ann' }], rounds: [],
    })).rejects.toEqual({ message: 'boom' });
  });
});
