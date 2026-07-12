import AsyncStorage from '@react-native-async-storage/async-storage';

// saveTournament merge-before-push tests (Fix 2) + the sync-v2 read-path
// overlay tests that replace the old local-inclusive loadAllTournaments
// merge (Fix 3, superseded — see tournamentStore.js's loadAllTournaments and
// mutate.js's applyPendingMutations).
//
// saveTournament still goes through fetchRemoteTournament -> repo.fetchTournament
// (a supabase.rpc('get_game_tournament') call) before merging + pushing, so
// the mocked supabase client below implements `.rpc` for both
// get_game_tournament (single tournament) and get_my_game_tournaments (the
// Home list), mirroring tournamentRepo.js. The `.from` chain is still used
// for persistRemote's raw blob upsert.
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

// One tournament, one round, one hole. `scores`/`meta` let each test stamp the
// score cells so mergeTournaments' always-mine pass can act on them.
function blob({ id = 't1', name = 'Cup', createdAt = '2026-07-11T09:00:00Z', scores, currentRound = 0, meta = {} }) {
  return {
    id,
    name,
    kind: 'casual',
    createdAt,
    players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bea' }],
    rounds: [{ id: 'r1', holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores }],
    currentRound,
    _meta: meta,
  };
}

describe('saveTournament merges before pushing (Fix 2)', () => {
  test('keeps a peer score cell present only on the remote (no clobber)', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Remote already holds a cell the local copy has never written.
    mockState.remote = blob({
      scores: { p1: { 1: 4 }, p2: { 1: 5 } },
      currentRound: 0,
      meta: { 'rounds.r1.scores.p1.h1': 1000, 'rounds.r1.scores.p2.h1': 1500 },
    });
    const local = blob({
      scores: { p1: { 1: 4 } },
      currentRound: 1,
      meta: { 'rounds.r1.scores.p1.h1': 2000 },
    });

    const { saveTournament } = require('../tournamentStore');
    await saveTournament(local);

    const pushed = mockState.upserts.filter((u) => u.table === 'tournaments').pop();
    expect(pushed).toBeTruthy();
    // The peer's cell survives the save instead of being overwritten by local.
    expect(pushed.row.data.rounds[0].scores.p2[1]).toBe(5);
    expect(pushed.row.data.rounds[0].scores.p1[1]).toBe(4);
  });

  test('pushes the higher local currentRound (monotonic through merge)', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    mockState.remote = blob({ scores: { p1: { 1: 4 } }, currentRound: 0 });
    const local = blob({ scores: { p1: { 1: 4 } }, currentRound: 2 });

    const { saveTournament } = require('../tournamentStore');
    await saveTournament(local);

    const pushed = mockState.upserts.filter((u) => u.table === 'tournaments').pop();
    expect(pushed.row.data.currentRound).toBe(2);
  });

  test('falls back to pushing local when the remote fetch throws', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    mockState.fetchError = { message: 'boom' }; // fetchRemoteTournament throws
    const local = blob({ scores: { p1: { 1: 4 } }, currentRound: 1 });

    const { saveTournament } = require('../tournamentStore');
    await expect(saveTournament(local)).resolves.toBeUndefined(); // never throws

    const pushed = mockState.upserts.filter((u) => u.table === 'tournaments').pop();
    expect(pushed).toBeTruthy();
    expect(pushed.row.data.currentRound).toBe(1);
    expect(pushed.row.data.rounds[0].scores.p1[1]).toBe(4);
  });
});

describe('loadAllTournaments overlays undrained pending mutations (Fix 3, superseded)', () => {
  test('a queued score.set for one tournament is reflected in the returned entry', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Remote (server truth) has not seen p2's score yet.
    mockState.myTournaments = [{
      tournament: blob({ scores: { p1: { 1: 4 } }, currentRound: 0 }),
      role: 'owner',
    }];

    const { syncQueue } = require('../syncQueue');
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'score.set', roundId: 'r1', playerId: 'p2', hole: 1, value: 5, ts: Date.now(),
      },
      path: 'rounds.r1.scores.p2.h1',
    });

    const store = require('../tournamentStore');
    const list = await store.loadAllTournaments();
    const entry = list.find((t) => t.id === 't1');
    expect(entry).toBeTruthy();
    expect(entry.rounds[0].scores.p2[1]).toBe(5);
  });

  test('returns the list sorted newest-first by createdAt', async () => {
    installMocks({ online: true });
    mockState.userId = null;
    mockState.myTournaments = [
      { tournament: blob({ id: 'older', createdAt: '2026-07-01T09:00:00Z', scores: {} }), role: 'owner' },
      { tournament: blob({ id: 'newer', createdAt: '2026-07-10T09:00:00Z', scores: {} }), role: 'owner' },
    ];

    const store = require('../tournamentStore');
    const list = await store.loadAllTournaments();
    expect(list.map((t) => t.id)).toEqual(['newer', 'older']);
  });
});

describe('background refresh overlays undrained pending mutations onto fresh remote state', () => {
  test('refreshTournamentFromRemote: a queued score.set survives the refresh', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Server truth: p2 has not scored yet.
    mockState.remote = blob({ scores: { p1: { 1: 4 } }, currentRound: 0 });

    const store = require('../tournamentStore');
    await store.saveLocal(blob({ scores: { p1: { 1: 4 } }, currentRound: 0 }));

    const { syncQueue } = require('../syncQueue');
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'score.set', roundId: 'r1', playerId: 'p2', hole: 1, value: 5, ts: Date.now(),
      },
      path: 'rounds.r1.scores.p2.h1',
    });

    const result = await store.refreshTournamentFromRemote('t1');
    expect(result.rounds[0].scores.p2[1]).toBe(5);

    const persisted = await store.readLocal('t1');
    expect(persisted.rounds[0].scores.p2[1]).toBe(5);
  });

  test('only this tournament\'s queued entries are overlaid (two-tournament isolation)', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Server truth for t1: only p1 has scored.
    mockState.remote = blob({ scores: { p1: { 1: 4 } }, currentRound: 0 });

    const { syncQueue } = require('../syncQueue');
    // t1's own pending score…
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'score.set', roundId: 'r1', playerId: 'p2', hole: 1, value: 5, ts: Date.now(),
      },
      path: 'rounds.r1.scores.p2.h1',
    });
    // …and a pending score for a DIFFERENT tournament that happens to share
    // round/player ids — it must not leak into t1's overlay.
    await syncQueue.enqueue({
      tournamentId: 't2',
      mutation: {
        type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 9, ts: Date.now(),
      },
      path: 'rounds.r1.scores.p1.h1',
    });

    const store = require('../tournamentStore');
    const result = await store.refreshTournamentFromRemote('t1');

    expect(result.rounds[0].scores.p2[1]).toBe(5);   // t1's entry applied
    expect(result.rounds[0].scores.p1[1]).toBe(4);   // t2's entry did NOT leak in
    // Read paths never drain: both entries are still queued afterwards.
    const remaining = await syncQueue.all();
    expect(remaining.map((e) => e.tournamentId).sort()).toEqual(['t1', 't2']);
  });

  test('a score enqueued after the first queue snapshot still lands in the saved blob (save-then-enqueue race)', async () => {
    installMocks({ online: true });
    mockState.userId = 'u1';
    // Server truth: p2 has not scored yet.
    mockState.remote = blob({ scores: { p1: { 1: 4 } }, currentRound: 0 });

    // mutate() saves locally BEFORE it enqueues, so an overlay's queue
    // snapshot can miss a score that is already in local state — and a
    // saveLocal computed from that snapshot would erase the just-entered
    // value. Simulate the race with a queue whose first read returns [] and
    // whose subsequent reads return the late entry: the refresh must settle
    // (re-snapshot after saving, same bounded loop as syncWorker's
    // post-drain reconcile) so the final saved blob includes the late score.
    const lateEntry = {
      id: 'late-1',
      tournamentId: 't1',
      mutation: {
        type: 'score.set', roundId: 'r1', playerId: 'p2', hole: 1, value: 5, ts: Date.now(),
      },
      path: 'rounds.r1.scores.p2.h1',
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
    expect(result.rounds[0].scores.p2[1]).toBe(5);

    const persisted = await store.readLocal('t1');
    expect(persisted.rounds[0].scores.p2[1]).toBe(5);
    // The settle loop re-read the queue after saving (>= 2 reads).
    expect(queueReads).toBeGreaterThanOrEqual(2);
  });
});
