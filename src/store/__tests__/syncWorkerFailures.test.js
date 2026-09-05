import AsyncStorage from '@react-native-async-storage/async-storage';

// Fix B (docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md §6.4):
// a setup write that syncWorker gives up on (permanent error / poison cap)
// used to just flip the sync dot and vanish. tournamentStore.recordSyncFailure
// now logs it (see syncWorker.test.js for the drop-site wiring) and
// listSyncFailures/discardSyncFailure/retrySyncFailure let a sync sheet act
// on it. These tests exercise the real store + real syncQueue against the
// AsyncStorage mock (see tournamentStoreSync.test.js for the same pattern) —
// no jest.mock('../tournamentStore') / jest.mock('../syncQueue') here.
function installMocks({ online = false } = {}) {
  jest.resetModules();
  AsyncStorage.clear();
  jest.doMock('../../lib/connectivity', () => ({
    isOnline: () => online,
    subscribeConnectivity: () => () => {},
  }));
  jest.doMock('../../lib/supabase', () => ({
    supabase: {
      rpc: jest.fn(() => Promise.resolve({ error: null })),
      channel: jest.fn(),
      removeChannel: jest.fn(),
    },
  }));
}

describe('sync failure log', () => {
  beforeEach(() => {
    installMocks({ online: false });
  });

  test('recordSyncFailure + listSyncFailures: a dropped write is listed with its mutation and error code', async () => {
    const store = require('../tournamentStore');
    const entry = {
      id: 'e1',
      tournamentId: 't1',
      mutation: { type: 'tournament.addPlayer', player: { id: 'p9' } },
      path: 'players',
    };
    await store.recordSyncFailure('t1', { entry, error: { code: '23505', message: 'dup' } });

    const list = await store.listSyncFailures('t1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'e1', mutation: entry.mutation, path: 'players', error: { code: '23505', message: 'dup' },
    });
  });

  test('discardSyncFailure clears the entry without re-enqueueing', async () => {
    const store = require('../tournamentStore');
    const { syncQueue } = require('../syncQueue');
    const entry = { id: 'e1', tournamentId: 't1', mutation: { type: 'tournament.addPlayer' }, path: null };
    await store.recordSyncFailure('t1', { entry, error: { code: '23505', message: 'dup' } });

    await store.discardSyncFailure('t1', 'e1');

    expect(await store.listSyncFailures('t1')).toEqual([]);
    expect(await syncQueue.all()).toEqual([]);
  });

  test('retrySyncFailure re-enqueues the original mutation (fresh attempts) and clears the failure', async () => {
    const store = require('../tournamentStore');
    const { syncQueue } = require('../syncQueue');
    const entry = {
      id: 'e1',
      tournamentId: 't1',
      mutation: { type: 'tournament.addPlayer', player: { id: 'p9' }, ts: 111 },
      path: 'players',
    };
    await store.recordSyncFailure('t1', { entry, error: { code: '23505', message: 'dup' } });

    await store.retrySyncFailure('t1', 'e1');

    expect(await store.listSyncFailures('t1')).toEqual([]);
    const queued = await syncQueue.all();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      tournamentId: 't1', mutation: entry.mutation, path: 'players', attempts: 0,
    });
  });

  test('library-type failures (no tournamentId) file under the library bucket', async () => {
    const store = require('../tournamentStore');
    const entry = { id: 'e1', mutation: { type: 'rpc.call', fn: 'do_thing', args: {} } };
    await store.recordSyncFailure(undefined, { entry, error: { message: 'boom' } });

    expect(await store.listSyncFailures(undefined)).toHaveLength(1);
    expect(await store.listSyncFailures('library')).toHaveLength(1);
    expect(await store.listSyncFailures('t1')).toEqual([]);
  });

  test('subscribeSyncFailures emits on record and on discard', async () => {
    const store = require('../tournamentStore');
    await store.listSyncFailures('t1'); // force hydration before subscribing
    const seen = [];
    const unsub = store.subscribeSyncFailures((snap) => seen.push(snap));

    await store.recordSyncFailure('t1', {
      entry: { id: 'e1', mutation: { type: 'x' } }, error: { message: 'boom' },
    });
    expect(seen[seen.length - 1].t1).toHaveLength(1);

    await store.discardSyncFailure('t1', 'e1');
    expect(seen[seen.length - 1].t1).toHaveLength(0);

    unsub();
  });
});
