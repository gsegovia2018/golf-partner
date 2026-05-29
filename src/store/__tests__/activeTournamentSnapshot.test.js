import AsyncStorage from '@react-native-async-storage/async-storage';

describe('active tournament snapshot', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  test('saveLocal exposes an immediate active tournament snapshot for new screens', () => {
    const { saveLocal, getActiveTournamentSnapshot } = require('../tournamentStore');
    const tournament = {
      id: 't-snapshot',
      name: 'Fast Paint',
      players: [{ id: 'p1', name: 'Marco', handicap: 12 }],
      rounds: [{ id: 'r1', holes: [], scores: {} }],
      currentRound: 0,
    };

    return saveLocal(tournament).then(() => {
      expect(getActiveTournamentSnapshot()).toMatchObject({
        id: 't-snapshot',
        name: 'Fast Paint',
      });
    });
  });

  test('snapshot callers cannot mutate the cached tournament object', async () => {
    const { saveLocal, getActiveTournamentSnapshot } = require('../tournamentStore');
    await saveLocal({
      id: 't-snapshot',
      name: 'Fast Paint',
      players: [{ id: 'p1', name: 'Marco', handicap: 12 }],
      rounds: [{ id: 'r1', holes: [], scores: {} }],
      currentRound: 0,
    });

    const first = getActiveTournamentSnapshot();
    first.players[0].name = 'Changed';

    expect(getActiveTournamentSnapshot().players[0].name).toBe('Marco');
  });

  test('can retrieve a cached tournament snapshot by id', async () => {
    const { saveLocal, getTournamentSnapshot } = require('../tournamentStore');
    await saveLocal({
      id: 't-by-id',
      name: 'Cached Detail',
      players: [],
      rounds: [],
      currentRound: 0,
    });

    expect(getTournamentSnapshot('t-by-id')).toMatchObject({ name: 'Cached Detail' });
  });
});
