import AsyncStorage from '@react-native-async-storage/async-storage';

// sync-v2 read-path overlay tests that replace the old local-inclusive
// loadAllTournaments merge (Fix 3, superseded — see tournamentStore.js's
// loadAllTournaments and mutate.js's applyPendingMutations).
//
// These go through fetchRemoteTournament -> repo.fetchTournament (a
// supabase.rpc('get_game_tournament') call), so the mocked supabase client
// below implements `.rpc` for both get_game_tournament (single tournament)
// and get_my_game_tournaments (the Home list), mirroring tournamentRepo.js.
//
// Uses the per-test doMock + resetModules + require pattern (see
// loadTournamentCached.test.js) so each test controls isOnline, the remote
// blob, and captures every upserted row. syncQueue is NOT mocked — tests that
// need a queued-but-undrained mutation enqueue it for real, backed by the
// same AsyncStorage mock instance the store uses.

// Mutable state the doMock'd supabase client reads from. Reset per test.
let mockState;

function installMocks({ online = true } = {}) {
  jest.resetModules();
  AsyncStorage.clear();
  mockState = {
    online,
    userId: null,           // getCurrentUserId result
    remote: null,           // get_game_tournament RPC result (or null)
    fetchError: null,       // error surfaced by get_game_tournament
    myTournaments: [],      // [{ tournament, role }] returned by get_my_game_tournaments
    upserts: [],            // { table, row } captured from every upsert
  };

  jest.doMock('../../lib/connectivity', () => ({
    isOnline: () => mockState.online,
    subscribeConnectivity: () => () => {},
  }));

  jest.doMock('../../lib/supabase', () => {
    const makeBuilder = (table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        upsert: (row) => {
          mockState.upserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return builder;
    };
    return {
      supabase: {
        from: (table) => makeBuilder(table),
        rpc: (name) => {
          if (name === 'get_game_tournament') {
            if (mockState.fetchError) return Promise.resolve({ data: null, error: mockState.fetchError });
            return Promise.resolve({ data: mockState.remote ?? null, error: null });
          }
          if (name === 'get_my_game_tournaments') {
            return Promise.resolve({ data: mockState.myTournaments, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        auth: {
          getUser: () => Promise.resolve({
            data: { user: mockState.userId ? { id: mockState.userId } : null },
          }),
        },
      },
    };
  });
}

// One tournament, one round, one hole. `playerHandicaps` stands in for any
// per-round setup cell the overlay has to carry forward — scores themselves
// no longer travel through this queue (they are the cards engine's).
function blob({
  id = 't1', name = 'Cup', createdAt = '2026-07-11T09:00:00Z',
  playerHandicaps, currentRound = 0,
}) {
  return {
    id,
    name,
    kind: 'casual',
    createdAt,
    players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bea' }],
    rounds: [{
      id: 'r1', holes: [{ number: 1, par: 4, strokeIndex: 1 }], playerHandicaps,
    }],
    currentRound,
  };
}

describe('loadAllTournaments overlays undrained pending mutations (Fix 3, superseded)', () => {
  test('a queued setup mutation for one tournament is reflected in the returned entry', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Remote (server truth) has not seen p2's handicap edit yet.
    mockState.myTournaments = [{
      tournament: blob({ playerHandicaps: { p1: 4 }, currentRound: 0 }),
      role: 'owner',
    }];

    const { syncQueue } = require('../syncQueue');
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'handicap.set', roundId: 'r1', playerId: 'p2', handicap: 5, ts: Date.now(),
      },
      path: 'rounds.r1.playerHandicaps.p2',
    });

    const store = require('../tournamentStore');
    const list = await store.loadAllTournaments();
    const entry = list.find((t) => t.id === 't1');
    expect(entry).toBeTruthy();
    expect(entry.rounds[0].playerHandicaps.p2).toBe(5);
  });

  test('returns the list sorted newest-first by createdAt', async () => {
    installMocks({ online: true });
    mockState.userId = null;
    mockState.myTournaments = [
      { tournament: blob({ id: 'older', createdAt: '2026-07-01T09:00:00Z', playerHandicaps: {} }), role: 'owner' },
      { tournament: blob({ id: 'newer', createdAt: '2026-07-10T09:00:00Z', playerHandicaps: {} }), role: 'owner' },
    ];

    const store = require('../tournamentStore');
    const list = await store.loadAllTournaments();
    expect(list.map((t) => t.id)).toEqual(['newer', 'older']);
  });
});

describe('background refresh overlays undrained pending mutations onto fresh remote state', () => {
  test('refreshTournamentFromRemote: a queued setup mutation survives the refresh', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Server truth: p2 has no handicap override yet.
    mockState.remote = blob({ playerHandicaps: { p1: 4 }, currentRound: 0 });

    const store = require('../tournamentStore');
    await store.saveLocal(blob({ playerHandicaps: { p1: 4 }, currentRound: 0 }));

    const { syncQueue } = require('../syncQueue');
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'handicap.set', roundId: 'r1', playerId: 'p2', handicap: 5, ts: Date.now(),
      },
      path: 'rounds.r1.playerHandicaps.p2',
    });

    const result = await store.refreshTournamentFromRemote('t1');
    expect(result.rounds[0].playerHandicaps.p2).toBe(5);

    const persisted = await store.readLocal('t1');
    expect(persisted.rounds[0].playerHandicaps.p2).toBe(5);
  });

  test('only this tournament\'s queued entries are overlaid (two-tournament isolation)', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Server truth for t1: only p1 has a handicap override.
    mockState.remote = blob({ playerHandicaps: { p1: 4 }, currentRound: 0 });

    const { syncQueue } = require('../syncQueue');
    // t1's own pending handicap edit…
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'handicap.set', roundId: 'r1', playerId: 'p2', handicap: 5, ts: Date.now(),
      },
      path: 'rounds.r1.playerHandicaps.p2',
    });
    // …and a pending edit for a DIFFERENT tournament that happens to share
    // round/player ids — it must not leak into t1's overlay.
    await syncQueue.enqueue({
      tournamentId: 't2',
      mutation: {
        type: 'handicap.set', roundId: 'r1', playerId: 'p1', handicap: 9, ts: Date.now(),
      },
      path: 'rounds.r1.playerHandicaps.p1',
    });

    const store = require('../tournamentStore');
    const result = await store.refreshTournamentFromRemote('t1');

    expect(result.rounds[0].playerHandicaps.p2).toBe(5); // t1's entry applied
    expect(result.rounds[0].playerHandicaps.p1).toBe(4); // t2's entry did NOT leak in
    // Read paths never drain: both entries are still queued afterwards.
    const remaining = await syncQueue.all();
    expect(remaining.map((e) => e.tournamentId).sort()).toEqual(['t1', 't2']);
  });

  test('a mutation enqueued after the first queue snapshot still lands in the saved blob (save-then-enqueue race)', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Server truth: p2 has no handicap override yet.
    mockState.remote = blob({ playerHandicaps: { p1: 4 }, currentRound: 0 });

    // mutate() saves locally BEFORE it enqueues, so an overlay's queue
    // snapshot can miss an edit that is already in local state — and a
    // saveLocal computed from that snapshot would erase the just-entered
    // value. Simulate the race with a queue whose first read returns [] and
    // whose subsequent reads return the late entry: the refresh must settle
    // (re-snapshot after saving, same bounded loop as syncWorker's
    // post-drain reconcile) so the final saved blob includes the late edit.
    const lateEntry = {
      id: 'late-1',
      tournamentId: 't1',
      mutation: {
        type: 'handicap.set', roundId: 'r1', playerId: 'p2', handicap: 5, ts: Date.now(),
      },
      path: 'rounds.r1.playerHandicaps.p2',
      ts: Date.now(),
    };
    let queueReads = 0;
    jest.doMock('../syncQueue', () => ({
      syncQueue: {
        all: jest.fn(() => {
          queueReads += 1;
          return Promise.resolve(queueReads === 1 ? [] : [lateEntry]);
        }),
        enqueue: jest.fn(() => Promise.resolve(lateEntry)),
        drop: jest.fn(() => Promise.resolve()),
        clear: jest.fn(() => Promise.resolve()),
      },
    }));

    const store = require('../tournamentStore');
    const result = await store.refreshTournamentFromRemote('t1');
    expect(result.rounds[0].playerHandicaps.p2).toBe(5);

    const persisted = await store.readLocal('t1');
    expect(persisted.rounds[0].playerHandicaps.p2).toBe(5);
    // The settle loop re-read the queue after saving (>= 2 reads).
    expect(queueReads).toBeGreaterThanOrEqual(2);
  });
});

