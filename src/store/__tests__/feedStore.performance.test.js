const mockState = {
  userCalls: 0,
  mediaCalls: 0,
  mediaTournamentIds: [],
  cachedTournaments: [],
  remoteTournaments: [],
  friends: [],
  cachedFriends: [],
  rejectListFriends: false,
};

jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => true) }));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => {
        mockState.userCalls += 1;
        return Promise.resolve({ data: { user: { id: 'me-user' } } });
      }),
    },
  },
}));

jest.mock('../tournamentStore', () => {
  const actual = jest.requireActual('../tournamentStore');
  return {
    ...actual,
    loadCachedTournamentsList: jest.fn(() => Promise.resolve(mockState.cachedTournaments)),
    loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({
      list: mockState.remoteTournaments,
      stale: false,
      openableIds: null,
    })),
  };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(() => {
    if (mockState.rejectListFriends) return Promise.reject(new Error('friends unavailable'));
    return Promise.resolve(mockState.friends);
  }),
  getCachedFriends: jest.fn(() => Promise.resolve(mockState.cachedFriends)),
}));

jest.mock('../mediaStore', () => ({
  loadMediaForTournaments: jest.fn((ids) => {
    mockState.mediaCalls += 1;
    mockState.mediaTournamentIds.push(ids);
    return Promise.resolve([]);
  }),
}));

function tournament(id, ts = 1) {
  return {
    id,
    name: `Game ${id}`,
    createdAt: new Date(ts).toISOString(),
    players: [{ id: 'p1', name: 'Marcos', user_id: 'me-user' }],
    rounds: [{
      id: `r-${id}`,
      courseName: 'La Moraleja',
      holes: [
        { number: 1, par: 4, strokeIndex: 1 },
        { number: 2, par: 4, strokeIndex: 2 },
      ],
      scores: { p1: { 1: 4, 2: 5 } },
    }],
    _meta: { [`rounds.r-${id}.scores.p1.1`]: ts },
  };
}

describe('feed performance paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.userCalls = 0;
    mockState.mediaCalls = 0;
    mockState.mediaTournamentIds = [];
    mockState.cachedTournaments = [tournament('cached', 1000)];
    mockState.remoteTournaments = [tournament('remote', 2000)];
    mockState.friends = [];
    mockState.cachedFriends = [];
    mockState.rejectListFriends = false;
  });

  test('buildFeed can build from cached tournaments without media', async () => {
    const { buildFeed } = require('../feedStore');

    const result = await buildFeed({
      userId: 'me-user',
      source: 'cache',
      includeMedia: false,
      limit: 20,
    });

    expect(result.items.map((item) => item.tournamentId)).toEqual(['cached']);
    expect(result.roundStories).toEqual([]);
    expect(mockState.mediaCalls).toBe(0);
    expect(mockState.userCalls).toBe(0);
  });

  test('buildFeed limits base round items before media hydration', async () => {
    const { buildFeed } = require('../feedStore');
    mockState.cachedTournaments = [tournament('old', 1000), tournament('new', 2000)];

    const result = await buildFeed({
      userId: 'me-user',
      source: 'cache',
      includeMedia: true,
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].tournamentId).toBe('new');
    expect(mockState.mediaCalls).toBe(1);
    expect(mockState.mediaTournamentIds).toEqual([['new']]);
  });

  test('buildFeed defaults to all remote feed items when no limit is passed', async () => {
    const { buildFeed } = require('../feedStore');
    mockState.remoteTournaments = Array.from({ length: 35 }, (_, i) => (
      tournament(`remote-${i}`, 1000 + i)
    ));

    const result = await buildFeed({
      userId: 'me-user',
      source: 'remote',
      includeMedia: false,
    });

    expect(result.items).toHaveLength(35);
  });

  test('buildFeed marks remote friend fallback as partial', async () => {
    const { buildFeed } = require('../feedStore');
    mockState.rejectListFriends = true;
    mockState.cachedFriends = [{
      userId: 'friend-user',
      displayName: 'Pablo',
      avatarUrl: null,
      avatarColor: '#abcdef',
    }];

    const result = await buildFeed({
      userId: 'me-user',
      source: 'remote',
      includeMedia: false,
    });

    expect(result.friends).toEqual(mockState.cachedFriends);
    expect(result.partial).toBe(true);
  });
});
