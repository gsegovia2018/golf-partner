import AsyncStorage from '@react-native-async-storage/async-storage';

// saveTournament / loadAllTournaments sync-safety tests (Fix 2 + Fix 3).
//
// Both paths must fold the local blob together with the remote one through
// mergeTournaments before they are trusted — saveTournament so a raw upsert
// can't clobber a peer's score cell already on the server, loadAllTournaments
// so the Home list reflects the freshest (local-inclusive) state instead of a
// lagging remote-only snapshot.
//
// Uses the per-test doMock + resetModules + require pattern (see
// loadTournamentCached.test.js) so each test controls isOnline, the remote
// blob, and captures every upserted row.

// Mutable state the doMock'd supabase client reads from. Reset per test.
let mockState;

function installMocks({ online = true } = {}) {
  jest.resetModules();
  AsyncStorage.clear();
  mockState = {
    online,
    userId: null,        // getCurrentUserId result
    remote: null,        // fetchRemoteTournament blob (or null)
    fetchError: null,    // error surfaced by maybeSingle
    listRows: [],        // rows returned by the loadAllTournaments query
    upserts: [],         // { table, row } captured from every upsert
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
        maybeSingle: () => Promise.resolve({
          data: mockState.remote == null ? null : { data: mockState.remote },
          error: mockState.fetchError,
        }),
        upsert: (row) => {
          mockState.upserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        // Awaiting the builder (loadAllTournaments' list query) resolves here.
        then: (resolve) => {
          if (table === 'tournaments') {
            return resolve({ data: mockState.listRows, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    };
    return {
      supabase: {
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

describe('loadAllTournaments is local-inclusive + consistently sorted (Fix 3)', () => {
  test('merges the local blob so a locally-completed round reads complete', async () => {
    installMocks({ online: true });
    mockState.userId = null; // exercise the no-userId branch

    // Remote row: round r1 is INCOMPLETE (p2 has not scored the only hole).
    mockState.listRows = [{
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      created_at: '2026-07-11T09:00:00Z',
      data: blob({
        scores: { p1: { 1: 4 } },
        currentRound: 0,
        meta: { 'rounds.r1.scores.p1.h1': 1000 },
      }),
    }];

    const store = require('../tournamentStore');
    // Local blob: round r1 is COMPLETE (both players scored the hole), stamped.
    await store.saveLocal(blob({
      scores: { p1: { 1: 4 }, p2: { 1: 5 } },
      currentRound: 0,
      meta: { 'rounds.r1.scores.p1.h1': 2000, 'rounds.r1.scores.p2.h1': 2000 },
    }));

    const list = await store.loadAllTournaments();
    const entry = list.find((t) => t.id === 't1');
    expect(entry).toBeTruthy();
    expect(store.isRoundComplete(entry.rounds[0], entry.players)).toBe(true);
  });

  test('returns the list sorted newest-first by createdAt', async () => {
    installMocks({ online: true });
    mockState.userId = null;
    mockState.listRows = [
      { id: 'older', name: 'Old', kind: 'casual', created_at: '2026-07-01T09:00:00Z',
        data: blob({ id: 'older', createdAt: '2026-07-01T09:00:00Z', scores: {} }) },
      { id: 'newer', name: 'New', kind: 'casual', created_at: '2026-07-10T09:00:00Z',
        data: blob({ id: 'newer', createdAt: '2026-07-10T09:00:00Z', scores: {} }) },
    ];

    const store = require('../tournamentStore');
    const list = await store.loadAllTournaments();
    expect(list.map((t) => t.id)).toEqual(['newer', 'older']);
  });
});
