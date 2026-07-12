import AsyncStorage from '@react-native-async-storage/async-storage';

describe('loadTournament cached reads', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  test('can read the active cached tournament without starting a remote refresh', async () => {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));

    const fetchTournament = jest.fn(() => Promise.resolve(null));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament,
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from: jest.fn(),
        auth: {
          getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
        },
      },
    }));

    const { saveLocal, loadTournament } = require('../tournamentStore');
    const cached = {
      id: 't1',
      name: 'Saturday',
      players: [],
      rounds: [],
      currentRound: 0,
    };
    await saveLocal(cached);
    fetchTournament.mockClear();

    await expect(loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toMatchObject({ id: 't1', name: 'Saturday' });
    expect(fetchTournament).not.toHaveBeenCalled();
  });

  test('loadCachedTournamentsList returns local blobs without calling Supabase', async () => {
    jest.resetModules();
    const from = jest.fn();
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from,
        auth: {
          getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
        },
      },
    }));

    const store = require('../tournamentStore');
    const { supabase } = require('../../lib/supabase');

    await store.saveLocal({
      id: 'cached-feed-1',
      name: 'Cached Feed Game',
      createdAt: '2026-06-01T10:00:00.000Z',
      players: [],
      rounds: [],
    });

    const list = await store.loadCachedTournamentsList();

    expect(list.map((t) => t.id)).toContain('cached-feed-1');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('does not restore a cached finished tournament as active', async () => {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));

    jest.doMock('../tournamentRepo', () => ({
      fetchTournament: jest.fn(() => Promise.resolve(null)),
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from: jest.fn(),
        auth: {
          getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
        },
      },
    }));

    const { loadTournament } = require('../tournamentStore');
    const finished = {
      id: 'done-1',
      name: 'Finished Game',
      kind: 'game',
      finishedAt: '2026-05-31T18:00:00.000Z',
      players: [{ id: 'p1' }],
      rounds: [{ id: 'r1', holes: [{ number: 1 }], scores: { p1: { 1: 4 } } }],
      currentRound: 0,
    };
    await AsyncStorage.setItem('@golf_active_id', 'done-1');
    await AsyncStorage.setItem('@golf_tournament_done-1', JSON.stringify(finished));

    await expect(loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toBeNull();
    await expect(loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toBeNull();
  });

  test('clears the active id when the active tournament is saved as finished', async () => {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from: jest.fn(),
        auth: {
          getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
        },
      },
    }));

    const { saveLocal, loadTournament } = require('../tournamentStore');
    const active = {
      id: 'game-1',
      name: 'Active Game',
      kind: 'game',
      players: [{ id: 'p1' }],
      rounds: [{ id: 'r1', holes: [{ number: 1 }], scores: {} }],
      currentRound: 0,
    };
    await saveLocal(active);
    await expect(loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toMatchObject({ id: 'game-1' });

    await saveLocal({ ...active, finishedAt: '2026-05-31T18:00:00.000Z' });

    await expect(loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toBeNull();
  });

  test('background refresh (refreshRemote: true) overlays a queued mutation onto the fresh remote tournament', async () => {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));

    const remote = {
      id: 't1',
      name: 'Saturday',
      players: [{ id: 'p1' }, { id: 'p2' }],
      rounds: [{ id: 'r1', holes: [{ number: 1 }], scores: { p1: { 1: 4 } } }],
      currentRound: 0,
    };
    const fetchTournament = jest.fn(() => Promise.resolve(remote));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament,
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from: jest.fn(),
        auth: {
          getUser: jest.fn(() => Promise.resolve({ data: { user: null } })),
        },
      },
    }));

    const { saveLocal, loadTournament, readLocal } = require('../tournamentStore');
    const { syncQueue } = require('../syncQueue');

    const cached = {
      id: 't1',
      name: 'Saturday',
      players: [{ id: 'p1' }, { id: 'p2' }],
      rounds: [{ id: 'r1', holes: [{ number: 1 }], scores: { p1: { 1: 4 } } }],
      currentRound: 0,
    };
    await saveLocal(cached);

    // A score for p2 was entered locally but has not drained to the server
    // yet — the background refresh must not clobber it with server truth.
    await syncQueue.enqueue({
      tournamentId: 't1',
      mutation: {
        type: 'score.set', roundId: 'r1', playerId: 'p2', hole: 1, value: 5, ts: Date.now(),
      },
      path: 'rounds.r1.scores.p2.h1',
    });

    await loadTournament({ refreshRemote: true, resolveIdentity: false });
    // The background refresh is fire-and-forget; flush the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchTournament).toHaveBeenCalledWith('t1');
    const persisted = await readLocal('t1');
    expect(persisted.rounds[0].scores.p2[1]).toBe(5);
  });
});
