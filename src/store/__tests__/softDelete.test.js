// Deleting a game must never destroy its history. Every history table
// cascades off `tournaments`, so a hard DELETE took the scores, per-author
// entries, resolutions, shot details and notes with it -- irreversibly, from
// one tap in History. deleteTournament now writes a `deleted_at` tombstone
// (migration 20260728000004) and the list RPC hides the row.
//
// Its own supabase stub: the shared one in tournamentStore.test.js has no
// .update()/.not(), and 30 other tests depend on that stub's exact shape.
import AsyncStorage from '@react-native-async-storage/async-storage';

const calls = [];

jest.mock('../../lib/supabase', () => {
  function builder(table) {
    const b = {
      select: () => b,
      order: () => b,
      not: (col, op, val) => { calls.push({ table, op: 'not', col, val }); return b; },
      eq: (col, val) => {
        const last = calls[calls.length - 1];
        if (last) last.eq = { col, val };
        return Promise.resolve({ data: [], error: null });
      },
      update: (patch) => { calls.push({ table, op: 'update', patch }); return b; },
      delete: () => { calls.push({ table, op: 'delete' }); return b; },
      upsert: () => Promise.resolve({ error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return b;
  }
  return {
    supabase: {
      from: (table) => builder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

jest.mock('../../lib/connectivity', () => ({
  isOnline: () => true,
  subscribeConnectivity: () => () => {},
}));

jest.mock('../tournamentRepo', () => ({
  fetchTournament: jest.fn(() => Promise.resolve(null)),
  fetchMyTournaments: jest.fn(() => Promise.resolve([])),
}));

describe('deleting a game is reversible', () => {
  beforeEach(() => {
    calls.length = 0;
    AsyncStorage.clear();
  });

  test('deleteTournament tombstones the row instead of destroying it', async () => {
    const { deleteTournament } = require('../tournamentStore');
    await deleteTournament('t1');

    const onTournaments = calls.filter((c) => c.table === 'tournaments');
    expect(onTournaments.some((c) => c.op === 'delete')).toBe(false);

    const update = onTournaments.find((c) => c.op === 'update');
    expect(update).toBeTruthy();
    expect(update.eq).toEqual({ col: 'id', val: 't1' });
    // An ISO timestamp, not a boolean flag -- we want to know WHEN.
    expect(typeof update.patch.deleted_at).toBe('string');
    expect(Number.isNaN(Date.parse(update.patch.deleted_at))).toBe(false);
  });

  test('deleteTournament still clears the game from this device', async () => {
    const { saveLocal, deleteTournament, readLocal } = require('../tournamentStore');
    await saveLocal({
      id: 't1', name: 'Saturday', players: [], rounds: [], currentRound: 0,
    });
    expect(await readLocal('t1')).toMatchObject({ id: 't1' });

    await deleteTournament('t1');

    // Gone locally -- the user sees it disappear exactly as before.
    expect(await readLocal('t1')).toBeNull();
  });

  test('restoreTournament clears the tombstone', async () => {
    const { restoreTournament } = require('../tournamentStore');
    await restoreTournament('t1');

    const update = calls.find((c) => c.table === 'tournaments' && c.op === 'update');
    expect(update.patch).toEqual({ deleted_at: null });
    expect(update.eq).toEqual({ col: 'id', val: 't1' });
  });

  test('listDeletedTournaments asks only for tombstoned rows', async () => {
    const { listDeletedTournaments } = require('../tournamentStore');
    await listDeletedTournaments();

    const notCall = calls.find((c) => c.table === 'tournaments' && c.op === 'not');
    expect(notCall).toBeTruthy();
    expect(notCall.col).toBe('deleted_at');
  });
});

// A game deleted on ANOTHER device used to stay "live" here forever. Home's
// LIVE hero reads the active tournament (@golf_active_id -> cached blob), not
// the list, and deleteTournament only clears those on the device that ran the
// delete. get_game_tournament keeps serving a tombstoned game (restore and
// direct links need that), so migration 20260728000007 makes it emit
// `deletedAt` -- the only signal by which this device can find out.
describe('a tombstone from another device clears the active game here', () => {
  // Awaited, unlike the suite above: these tests write the active pointer and
  // then assert on it, so a clear() still in flight would wipe it mid-test.
  beforeEach(async () => {
    calls.length = 0;
    await AsyncStorage.clear();
    jest.resetModules();
  });

  test('a remote tombstone purges the cached blob and the active pointer', async () => {
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament: jest.fn(() => Promise.resolve({
        id: 't1', name: 'Saturday', players: [], rounds: [{ id: 'r0' }],
        currentRound: 0, deletedAt: '2026-07-28T21:02:49.909Z',
      })),
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    const store = require('../tournamentStore');

    // This device still believes the game is live and active.
    await store.saveLocal({
      id: 't1', name: 'Saturday', players: [], rounds: [{ id: 'r0' }], currentRound: 0,
    });
    await store.setActiveTournament('t1');
    expect(await store.readLocal('t1')).toMatchObject({ id: 't1' });

    await store.refreshTournamentFromRemote('t1');

    expect(await store.readLocal('t1')).toBeNull();
    expect(await AsyncStorage.getItem('@golf_active_id')).toBeNull();
    // Nothing is destroyed server-side -- restoreTournament still works.
    expect(calls.some((c) => c.table === 'tournaments' && c.op === 'delete')).toBe(false);
  });

  test('loadTournament refuses to serve a tombstoned game as the active one', async () => {
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament: jest.fn(() => Promise.resolve(null)),
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    const store = require('../tournamentStore');

    await store.saveLocal({
      id: 't1', name: 'Saturday', players: [], rounds: [{ id: 'r0' }],
      currentRound: 0, deletedAt: '2026-07-28T21:02:49.909Z',
    });
    await store.setActiveTournament('t1');

    await expect(store.loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toBeNull();
    expect(await AsyncStorage.getItem('@golf_active_id')).toBeNull();
  });

  test('a live tournament is still cached and served normally', async () => {
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament: jest.fn(() => Promise.resolve({
        id: 't1', name: 'Saturday', players: [], rounds: [{ id: 'r0' }], currentRound: 0,
      })),
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    const store = require('../tournamentStore');

    await store.saveLocal({
      id: 't1', name: 'Saturday', players: [], rounds: [{ id: 'r0' }], currentRound: 0,
    });
    await store.setActiveTournament('t1');

    const merged = await store.refreshTournamentFromRemote('t1');

    // Survives: no tombstone, so nothing is purged. (The active pointer is
    // asserted in the tombstone tests above; this file's shared AsyncStorage
    // mock makes a "still set" assertion order-dependent, so it is left to
    // those.)
    expect(merged).toMatchObject({ id: 't1' });
    expect(await store.readLocal('t1')).toMatchObject({ id: 't1' });
  });
});
