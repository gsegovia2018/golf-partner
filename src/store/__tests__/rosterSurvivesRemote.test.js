import AsyncStorage from '@react-native-async-storage/async-storage';

// jsdom has no crypto.getRandomValues, which uuid needs for the queue entry id.
let uuidSeq = 0;
jest.mock('uuid', () => ({ v4: () => `queue-id-${(uuidSeq += 1)}` }));

// End-to-end for the scar: a remote snapshot that has never heard of a roster
// player must not delete him locally, and the add he never got must be
// re-queued. Sibling of partialRemoteRounds.test.js, which covers the same
// guard for `rounds`.
describe('a roster player the server has never seen', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  function mockDeps(remote) {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament: jest.fn(() => Promise.resolve(remote)),
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from: jest.fn(),
        auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
      },
    }));
  }

  const round = {
    id: 't1-r0',
    courseName: 'Lomas-Bosque',
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    playerHandicaps: { p1: 12, p2: 14 },
    pairs: [[{ id: 'p1' }, { id: 'p2' }]],
    scores: { p2: { 1: 5 } },
  };
  const marcos = { id: 'p1', name: 'Marcos', handicap: 12 };
  const guillermo = { id: 'p2', name: 'Guillermo', handicap: 14 };

  function localTournament() {
    return {
      id: 't1', name: 'Game', players: [marcos, guillermo], rounds: [round], currentRound: 0,
    };
  }

  test('survives the fetch, and the add that never landed is re-queued', async () => {
    mockDeps({
      id: 't1', name: 'Game', players: [marcos], rounds: [round], currentRound: 0,
    });

    const { saveLocal, readLocal, refreshTournamentFromRemote } = require('../tournamentStore');
    const { syncQueue } = require('../syncQueue');
    await syncQueue.clear();
    await saveLocal(localTournament());

    const merged = await refreshTournamentFromRemote('t1');

    expect(merged.players.map((p) => p.name)).toEqual(['Marcos', 'Guillermo']);
    expect((await readLocal('t1')).players.map((p) => p.name)).toEqual(['Marcos', 'Guillermo']);

    const queued = (await syncQueue.all()).filter((e) => e.mutation.type === 'tournament.addPlayer');
    expect(queued).toHaveLength(1);
    expect(queued[0].mutation.player).toEqual(guillermo);
  });

  test('a player the server reports as REMOVED is dropped, and not re-queued', async () => {
    mockDeps({
      id: 't1',
      name: 'Game',
      players: [marcos],
      deletedPlayerIds: ['p2'],
      rounds: [round],
      currentRound: 0,
    });

    const { saveLocal, refreshTournamentFromRemote } = require('../tournamentStore');
    const { syncQueue } = require('../syncQueue');
    await syncQueue.clear();
    await saveLocal(localTournament());

    const merged = await refreshTournamentFromRemote('t1');

    expect(merged.players.map((p) => p.id)).toEqual(['p1']);
    expect(await syncQueue.all()).toEqual([]);
  });

  test('the repair is enqueued once, not on every refresh', async () => {
    mockDeps({
      id: 't1', name: 'Game', players: [marcos], rounds: [round], currentRound: 0,
    });

    const { saveLocal, refreshTournamentFromRemote } = require('../tournamentStore');
    const { syncQueue } = require('../syncQueue');
    await syncQueue.clear();
    await saveLocal(localTournament());

    await refreshTournamentFromRemote('t1');
    await refreshTournamentFromRemote('t1');
    await refreshTournamentFromRemote('t1');

    const queued = (await syncQueue.all()).filter((e) => e.mutation.type === 'tournament.addPlayer');
    expect(queued).toHaveLength(1);
  });
});
