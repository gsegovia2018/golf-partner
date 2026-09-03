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
        update: (rows) => {
          record.ops.push({ method: 'update', rows });
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

describe('fetchRoundActivity', () => {
  test('calls get_round_activity with p_tournament_ids and returns the rows', async () => {
    mockState.rpcResult = {
      data: [
        { tournament_id: 't1', round_id: 'r0', activity_ts: '2026-07-10T00:00:00Z' },
        { tournament_id: 't2', round_id: 'r1', activity_ts: '2026-07-11T00:00:00Z' },
      ],
      error: null,
    };
    const { fetchRoundActivity } = require('../tournamentRepo');

    const result = await fetchRoundActivity(['t1', 't2']);

    expect(mockState.rpcCalls).toEqual([
      { name: 'get_round_activity', args: { p_tournament_ids: ['t1', 't2'] } },
    ]);
    expect(result).toEqual([
      { tournament_id: 't1', round_id: 'r0', activity_ts: '2026-07-10T00:00:00Z' },
      { tournament_id: 't2', round_id: 'r1', activity_ts: '2026-07-11T00:00:00Z' },
    ]);
  });

  test('returns [] when the RPC returns null', async () => {
    mockState.rpcResult = { data: null, error: null };
    const { fetchRoundActivity } = require('../tournamentRepo');

    expect(await fetchRoundActivity(['t1'])).toEqual([]);
  });

  test('throws on RPC error', async () => {
    mockState.rpcResult = { data: null, error: { message: 'boom' } };
    const { fetchRoundActivity } = require('../tournamentRepo');

    await expect(fetchRoundActivity(['t1'])).rejects.toEqual({ message: 'boom' });
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
    // onConflict must name the exact composite PK: supabase-js sends the
    // string to PostgREST verbatim, so a typo/transposition here only fails
    // at runtime — assert it exactly.
    expect(call.ops[0].opts).toEqual({ onConflict: 'tournament_id,round_id,player_id,hole' });
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
    expect(call.ops[0].opts).toEqual({ onConflict: 'tournament_id,round_id,hole_key' });
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
    expect(call.ops[0].opts).toEqual({ onConflict: 'tournament_id,player_id' });
  });

  test('a player with no user_id OMITS the column so a stale blob cannot erase a server claim', async () => {
    const { upsertPlayer } = require('../tournamentRepo');
    const player = { id: 'p1', name: 'Ann' };

    await upsertPlayer('t1', player, 0);

    // PostgREST builds the conflict-update SET list from the payload keys:
    // an absent key leaves game_players.user_id untouched, while an explicit
    // null would erase a claim written by claim_tournament_player after this
    // device last fetched. Un-claiming is only release_tournament_player's job.
    const call = lastFromCall('game_players');
    expect('user_id' in call.ops[0].rows).toBe(false);
  });
});

describe('deletePlayer', () => {
  // SOFT delete (20260903000000). A hard delete made "removed on another
  // device" indistinguishable from "this device's add never landed", which is
  // what forced the read path to erase the second case — see unionLocalRoster.
  test('stamps deleted_at on the game_players row matched by tournament_id+player_id', async () => {
    const { deletePlayer } = require('../tournamentRepo');

    await deletePlayer('t1', 'p1');

    const call = lastFromCall('game_players');
    expect(call.ops.map((o) => o.method)).toEqual(['update', 'match']);
    expect(typeof call.ops[0].rows.deleted_at).toBe('string');
    expect(call.ops[1].obj).toEqual({ tournament_id: 't1', player_id: 'p1' });
  });
});

describe('clearPlayerRound', () => {
  test('deletes game_scores, game_shot_details, and game_score_entries rows for the player, tournament-scoped', async () => {
    const { clearPlayerRound } = require('../tournamentRepo');

    await clearPlayerRound('t1', 'r0', 'p1');

    const scoresCall = lastFromCall('game_scores');
    expect(scoresCall.ops[1].obj).toEqual({ tournament_id: 't1', round_id: 'r0', player_id: 'p1' });

    const shotDetailsCall = lastFromCall('game_shot_details');
    expect(shotDetailsCall.ops[1].obj).toEqual({ tournament_id: 't1', round_id: 'r0', player_id: 'p1' });

    // Task 8: game_score_entries has no FK cascade off game_players, so a
    // removed player's per-author entries would otherwise survive on the
    // server forever and resurrect the phantom-conflict bug via a later
    // realtime INSERT/reconcile fetch.
    const scoreEntriesCall = lastFromCall('game_score_entries');
    expect(scoreEntriesCall.ops.map((o) => o.method)).toEqual(['delete', 'match']);
    expect(scoreEntriesCall.ops[1].obj).toEqual({ tournament_id: 't1', round_id: 'r0', player_id: 'p1' });
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
    expect(call.ops[0].opts).toEqual({ onConflict: 'tournament_id,id' });
  });

  test('also strips scoreEntries/scoreResolutions (matches the server round-body contract)', async () => {
    const { upsertRound } = require('../tournamentRepo');
    const round = {
      id: 'r0',
      scoreEntries: { p1: {} },
      scoreResolutions: { p1: {} },
    };

    await upsertRound('t1', 0, round);

    const call = lastFromCall('game_rounds');
    expect(call.ops[0].rows.body).toEqual({ id: 'r0' });
  });
});

describe('createTournament', () => {
  // createTournament now issues ONE transactional RPC (migration
  // 20260728000006) instead of six sequential upserts, so these assert the
  // payload it hands that function. The row SHAPES are unchanged -- the client
  // still owns props/kind mapping and stripRoundHotKeys -- so every assertion
  // below is the same one that used to run against the per-table upserts.
  // The onConflict targets moved into the SQL and are pinned there.
  function createPayload() {
    const call = [...mockState.rpcCalls].reverse().find((c) => c.name === 'create_game_tournament');
    return call?.args?.p_payload;
  }

  test('writes the whole game in a single RPC, never table by table', async () => {
    // The point of the change: six statements left a window where the
    // tournaments row existed without its rounds, and a fetch landing there
    // returned a round-less game.
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'game', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0,
      players: [{ id: 'p1', name: 'Ann' }],
      rounds: [{ id: 'r0', scores: { p1: { 1: 4 } } }],
    });

    const creates = mockState.rpcCalls.filter((c) => c.name === 'create_game_tournament');
    expect(creates).toHaveLength(1);
    expect(mockState.fromCalls).toHaveLength(0);
  });

  test('maps domain kind onto the casual/official column and keeps it in props', async () => {
    // The tournaments.kind COLUMN has a CHECK constraint (casual/official
    // only), so a domain kind of 'game'/'tournament' must land as 'casual'
    // on the column, while the real domain kind is preserved in props.kind
    // (which get_game_tournament re-emits via COALESCE(props->>'kind',
    // column)).
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    const t = {
      id: 't1', name: 'Cup', kind: 'tournament', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 1, players: [], rounds: [], meId: 'p1', _meta: { foo: 1 },
      settings: { fixedTeams: true },
    };

    await createTournament(t);

    expect(createPayload().tournament).toEqual({
      id: 't1', name: 'Cup', kind: 'casual', created_at: '2026-07-10T00:00:00Z',
      created_by: 'u1',
      props: { settings: { fixedTeams: true }, kind: 'tournament' },
      current_round: 1,
    });
  });

  // The legacy tournaments.data blob is gone (migration 20260728000002).
  // Nothing read it as a source of truth after sync-v2 -- the roster and
  // rounds live in game_players/game_rounds and get_game_tournament assembles
  // from those. It survived only because the column was NOT NULL, forcing
  // createTournament to write a placeholder purely to avoid a 23502.
  test('does not write the legacy data blob', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    await createTournament({
      id: 't1', name: 'Cup', kind: 'game', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0,
      players: [{ id: 'p1', user_id: 'u1' }, { id: 'p2', user_id: null }],
      rounds: [], meId: 'p1', _meta: { foo: 1 }, settings: { a: 1 },
    });

    const row = createPayload().tournament;
    expect(row).not.toHaveProperty('data');
    // Device-local / retired keys never reach the server at all.
    expect(row).not.toHaveProperty('meId');
    expect(row).not.toHaveProperty('_meta');
    // The domain kind still rides in props (the column is casual/official).
    expect(row.props.kind).toBe('game');
    expect(row.kind).toBe('casual');
  });

  test("maps a 'game' domain kind to a casual column with props.kind='game'", async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'game', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [], rounds: [],
    });

    const row = createPayload().tournament;
    expect(row.kind).toBe('casual');
    expect(row.props.kind).toBe('game');
  });

  test("passes an 'official' domain kind straight through on the column", async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'official', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [], rounds: [],
    });

    const row = createPayload().tournament;
    expect(row.kind).toBe('official');
    expect(row.props.kind).toBe('official');
  });

  test('omits created_by when there is no signed-in user (matches persistRemote)', async () => {
    // The RPC defaults it to auth.uid() server-side; the client still omits it
    // rather than sending null, so it can never mis-own a row.
    mockState.userId = null;
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: null, players: [], rounds: [],
    });

    expect(createPayload().tournament.created_by).toBeUndefined();
    expect(createPayload().tournament.current_round).toBeNull();
  });

  test('inserts game_players rows with pos = array index and body = player', async () => {
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');
    const players = [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bea', user_id: 'u2' }];

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players, rounds: [],
    });

    expect(createPayload().players).toEqual([
      { tournament_id: 't1', player_id: 'p1', user_id: null, pos: 0, body: players[0], updated_at: expect.any(String) },
      { tournament_id: 't1', player_id: 'p2', user_id: 'u2', pos: 1, body: players[1], updated_at: expect.any(String) },
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

    expect(createPayload().rounds).toEqual([{
      id: 'r0', tournament_id: 't1', round_index: 0,
      body: { id: 'r0', holes: [{ number: 1, par: 4, strokeIndex: 1 }] },
      updated_at: expect.any(String),
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

    const payload = createPayload();
    expect(payload.scores).toEqual(expect.arrayContaining([
      { round_id: 'r0', tournament_id: 't1', player_id: 'p1', hole: 1, strokes: 4, updated_at: expect.any(String) },
      { round_id: 'r0', tournament_id: 't1', player_id: 'p1', hole: 2, strokes: 5, updated_at: expect.any(String) },
    ]));
    expect(payload.scores).toHaveLength(2);
    // The drain may retry createTournament; the UPDATE arm of an upsert does
    // not fire the column default, so every retried row needs an explicit
    // updated_at stamp -- asserted above per row and pinned to ISO here.
    expect(payload.scores.every(
      (r) => !Number.isNaN(Date.parse(r.updated_at)),
    )).toBe(true);

    expect(payload.shot_details).toEqual([
      { round_id: 'r0', tournament_id: 't1', player_id: 'p1', hole: 1, detail: { club: 'driver' }, updated_at: expect.any(String) },
    ]);

    expect(payload.notes).toEqual(expect.arrayContaining([
      { round_id: 'r0', tournament_id: 't1', hole_key: 'round', note: 'sunny', updated_at: expect.any(String) },
      { round_id: 'r0', tournament_id: 't1', hole_key: '3', note: 'wet', updated_at: expect.any(String) },
    ]));
    expect(payload.notes).toHaveLength(2);
  });

  test('sends empty row sets when a round has no scores/shotDetails/notes', async () => {
    // The SQL COALESCEs each list to '[]', so an empty array is a no-op insert
    // rather than a skipped statement.
    mockState.userId = 'u1';
    const { createTournament } = require('../tournamentRepo');

    await createTournament({
      id: 't1', name: 'Cup', kind: 'casual', createdAt: '2026-07-10T00:00:00Z',
      currentRound: 0, players: [], rounds: [{ id: 'r0' }],
    });

    const payload = createPayload();
    expect(payload.scores).toEqual([]);
    expect(payload.shot_details).toEqual([]);
    expect(payload.notes).toEqual([]);
  });

  test('handles a realistic single-round fixture end to end without throwing', async () => {
    mockState.userId = null;
    const { createTournament } = require('../tournamentRepo');

    await expect(createTournament(fixtureSingleRound)).resolves.toBeUndefined();

    const payload = createPayload();
    expect(payload.tournament.id).toBe('1783716675062');
    expect(payload.tournament.props.meId).toBeUndefined();
    expect(payload.tournament.props._meta).toBeUndefined();
    expect(payload.tournament.props.players).toBeUndefined();
    expect(payload.tournament.props.rounds).toBeUndefined();

    expect(payload.players).toHaveLength(4);
    // 17 holes for p1 + 16 for p2/p3 + 17 for p4 = 66 cells (see fixture).
    expect(payload.scores.length).toBeGreaterThan(0);
  });

  test('throws when the create RPC errors', async () => {
    jest.resetModules();
    mockState.userId = null;
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        from: () => { throw new Error('createTournament must not write tables directly'); },
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
