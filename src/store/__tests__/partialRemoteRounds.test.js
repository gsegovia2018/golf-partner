import AsyncStorage from '@react-native-async-storage/async-storage';

// createTournament (tournamentRepo) writes the `tournaments` row, then
// game_players, then game_rounds — three separate statements, no transaction.
// A fetch landing between the first and last sees a tournament with NO rounds.
// _overlayAndSave replaces players/rounds with the remote snapshot wholesale,
// so that partial snapshot used to erase a just-created game's rounds locally.
// The render then read `rounds[selectedRound]` as undefined and threw
// "Cannot read properties of null (reading 'playerHandicaps')".
//
// A tournament can never legitimately have zero rounds: createTournament always
// writes at least one and canDeleteRound (editTournamentRoundDeletion.js:5)
// refuses to remove the last one. So an empty remote `rounds` is always a
// partial write, and local rounds must survive it.
describe('partial remote snapshot during creation', () => {
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
    playerHandicaps: { p1: 12, p2: 14, p3: 10, p4: 28 },
    scores: {},
  };
  const players = [
    { id: 'p1', name: 'Marcos', handicap: 12 },
    { id: 'p2', name: 'Alex', handicap: 14 },
    { id: 'p3', name: 'Noel', handicap: 10 },
    { id: 'p4', name: 'Raul', handicap: 28 },
  ];

  test('a rounds-less remote snapshot does not erase local rounds', async () => {
    // Same tournament, mid-write on the server: row exists, rounds do not.
    mockDeps({ id: 't1', name: 'Game', players, rounds: [], currentRound: 0 });

    const { saveLocal, readLocal, refreshTournamentFromRemote } = require('../tournamentStore');
    await saveLocal({ id: 't1', name: 'Game', players, rounds: [round], currentRound: 0 });

    const merged = await refreshTournamentFromRemote('t1');

    expect(merged.rounds).toHaveLength(1);
    expect(merged.rounds[0].id).toBe('t1-r0');
    expect((await readLocal('t1')).rounds).toHaveLength(1);
  });

  test('a remote snapshot WITH rounds still replaces local rounds', async () => {
    const remoteRound = { ...round, courseName: 'Torrequebrada' };
    mockDeps({ id: 't1', name: 'Game', players, rounds: [remoteRound], currentRound: 0 });

    const { saveLocal, refreshTournamentFromRemote } = require('../tournamentStore');
    await saveLocal({ id: 't1', name: 'Game', players, rounds: [round], currentRound: 0 });

    const merged = await refreshTournamentFromRemote('t1');

    expect(merged.rounds).toHaveLength(1);
    expect(merged.rounds[0].courseName).toBe('Torrequebrada');
  });
});
