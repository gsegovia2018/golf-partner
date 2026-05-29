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

    const maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      maybeSingle,
    };
    const from = jest.fn(() => chain);
    jest.doMock('../../lib/supabase', () => ({
      supabase: {
        from,
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
    from.mockClear();

    await expect(loadTournament({ refreshRemote: false, resolveIdentity: false }))
      .resolves.toMatchObject({ id: 't1', name: 'Saturday' });
    expect(from).not.toHaveBeenCalled();
  });
});
