// Cold-start snapshot + fetch-concurrency behaviour.
//
// The feed's in-memory build cache dies with the JS context, so before this
// every app relaunch re-paid the full serial fan-out with nothing but raw
// tournament blobs (no photos) to paint meanwhile. These cover the disk
// snapshot that replaces that paint, and the two legs of the fan-out that now
// overlap instead of queueing.

const mockState = {
  remoteTournaments: [],
  friends: [],
  cachedFriends: [],
  stale: false,
  media: [],
  // Ordered log of when each remote leg started/finished, so a test can prove
  // two calls overlapped rather than ran back-to-back.
  timeline: [],
  friendsDelay: 0,
  tournamentsDelay: 0,
  listFriendsArgs: [],
};

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => true) }));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
    __store: store,
  };
});

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'me-user' } } })) },
    from: jest.fn(() => ({ select: jest.fn(() => ({ in: jest.fn(() => Promise.resolve({ data: [], error: null })) })) })),
  },
}));

jest.mock('../tournamentRepo', () => ({
  fetchTournament: jest.fn(() => Promise.resolve(null)),
  fetchRoundActivity: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../tournamentStore', () => {
  const actual = jest.requireActual('../tournamentStore');
  return {
    ...actual,
    loadCachedTournamentsList: jest.fn(() => Promise.resolve([])),
    loadAllTournamentsWithFallback: jest.fn(async () => {
      mockState.timeline.push('tournaments:start');
      await tick(mockState.tournamentsDelay);
      mockState.timeline.push('tournaments:end');
      return { list: mockState.remoteTournaments, stale: mockState.stale, openableIds: null };
    }),
  };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(async (userId) => {
    mockState.listFriendsArgs.push(userId);
    mockState.timeline.push('friends:start');
    await tick(mockState.friendsDelay);
    mockState.timeline.push('friends:end');
    return mockState.friends;
  }),
  getCachedFriends: jest.fn(() => Promise.resolve(mockState.cachedFriends)),
}));

jest.mock('../mediaStore', () => ({
  loadMediaForTournaments: jest.fn(() => Promise.resolve(mockState.media)),
}));

function tournament(id, ts = 1000) {
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
  };
}

// Re-required in each beforeEach: jest.resetModules() gives the mock factory a
// fresh backing Map, so a module-scope handle would point at a dead store.
let AsyncStorage;

describe('feed cold-start snapshot', () => {
  let feedStore;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    AsyncStorage = require('@react-native-async-storage/async-storage');
    mockState.remoteTournaments = [tournament('t1', 2000)];
    mockState.friends = [];
    mockState.cachedFriends = [];
    mockState.stale = false;
    mockState.media = [];
    mockState.timeline = [];
    mockState.friendsDelay = 0;
    mockState.tournamentsDelay = 0;
    mockState.listFriendsArgs = [];
    feedStore = require('../feedStore');
  });

  test('a completed first page is persisted and replays as a full result', async () => {
    const built = await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });
    expect(built.items).toHaveLength(1);
    expect(built.partial).toBe(false);

    const snap = await feedStore.loadFeedSnapshot('me-user');
    expect(snap).not.toBeNull();
    expect(snap.items.map((i) => i.tournamentId)).toEqual(['t1']);
    // Applied through the same screen path as a real build, so it must carry
    // the same non-degraded flags — this is what keeps the banner quiet.
    expect(snap.partial).toBe(false);
    expect(snap.error).toBe(false);
    expect(snap.nextOffset).toBe(built.nextOffset);
    expect(snap.hasMore).toBe(built.hasMore);
  });

  test('a partial build is not persisted — the snapshot only ever paints a complete page', async () => {
    mockState.stale = true; // tournament list fell back to cache
    const built = await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });
    expect(built.partial).toBe(true);
    expect(await feedStore.loadFeedSnapshot('me-user')).toBeNull();
  });

  test('pages past the first are not persisted', async () => {
    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30, offset: 30,
    });
    expect(await feedStore.loadFeedSnapshot('me-user')).toBeNull();
  });

  test('another user never sees the snapshot', async () => {
    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });
    expect(await feedStore.loadFeedSnapshot('someone-else')).toBeNull();
    expect(await feedStore.loadFeedSnapshot(null)).toBeNull();
  });

  test('an expired snapshot is ignored', async () => {
    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });
    const raw = JSON.parse(AsyncStorage.__store.get('@golf_feed_snapshot_v1'));
    raw.ts = Date.now() - (8 * 24 * 60 * 60 * 1000);
    AsyncStorage.__store.set('@golf_feed_snapshot_v1', JSON.stringify(raw));
    expect(await feedStore.loadFeedSnapshot('me-user')).toBeNull();
  });

  test('a corrupt snapshot degrades to null instead of throwing', async () => {
    AsyncStorage.__store.set('@golf_feed_snapshot_v1', '{not json');
    expect(await feedStore.loadFeedSnapshot('me-user')).toBeNull();
  });

  test('clearFeedSnapshot drops it', async () => {
    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });
    await feedStore.clearFeedSnapshot();
    expect(await feedStore.loadFeedSnapshot('me-user')).toBeNull();
  });
});

describe('feed fetch concurrency', () => {
  let feedStore;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    AsyncStorage = require('@react-native-async-storage/async-storage');
    mockState.remoteTournaments = [tournament('t1', 2000)];
    mockState.friends = [];
    mockState.cachedFriends = [];
    mockState.stale = false;
    mockState.media = [];
    mockState.timeline = [];
    mockState.friendsDelay = 0;
    mockState.tournamentsDelay = 0;
    mockState.listFriendsArgs = [];
    feedStore = require('../feedStore');
  });

  test('the friends chain and the tournament list overlap instead of queueing', async () => {
    mockState.friendsDelay = 20;
    mockState.tournamentsDelay = 20;

    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });

    // Both start before either finishes — the definition of overlap. A serial
    // chain would read friends:start, friends:end, tournaments:start, ...
    const startsBeforeAnyEnd = mockState.timeline
      .slice(0, 2)
      .every((entry) => entry.endsWith(':start'));
    expect(startsBeforeAnyEnd).toBe(true);
  });

  test('a known user id is threaded into listFriends so it skips its auth round trip', async () => {
    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });
    expect(mockState.listFriendsArgs).toEqual(['me-user']);
  });

  test('a failed friends leg still leaves the tournament leg intact', async () => {
    const { listFriends } = require('../friendStore');
    listFriends.mockRejectedValueOnce(new Error('friendships unavailable'));
    mockState.cachedFriends = [];

    const built = await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });

    expect(built.error).toBe(false);
    expect(built.items).toHaveLength(1);
    expect(built.partial).toBe(true);
  });

  test('a failed tournament leg is still the hard-fail path', async () => {
    const { loadAllTournamentsWithFallback } = require('../tournamentStore');
    loadAllTournamentsWithFallback.mockRejectedValueOnce(new Error('list unavailable'));

    const built = await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });

    expect(built.error).toBe(true);
    expect(built.items).toEqual([]);
  });

  function instrumentMediaAndActivity() {
    const { loadMediaForTournaments } = require('../mediaStore');
    const { fetchRoundActivity } = require('../tournamentRepo');
    const order = [];
    fetchRoundActivity.mockImplementation(async () => {
      order.push('activity:start');
      await tick(20);
      order.push('activity:end');
      return [];
    });
    loadMediaForTournaments.mockImplementation(async () => {
      order.push('media:start');
      return [];
    });
    return order;
  }

  test('first-page media is issued before the activity RPC resolves', async () => {
    const order = instrumentMediaAndActivity();

    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30,
    });

    // Overlap, not a queue: the media read is in flight while activity is
    // still awaiting. Serially it would land after 'activity:end'.
    expect(order).toContain('media:start');
    expect(order.indexOf('media:start')).toBeLessThan(order.indexOf('activity:end'));
  });

  test('paginated pages keep the narrow, late media read', async () => {
    const order = instrumentMediaAndActivity();
    const { loadMediaForTournaments } = require('../mediaStore');

    await feedStore.buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30, offset: 30,
    });

    // A page past the first must not pre-fetch media for the whole history —
    // that read stays scoped to the page's own cards, after activity.
    if (loadMediaForTournaments.mock.calls.length > 0) {
      expect(order.indexOf('media:start')).toBeGreaterThan(order.indexOf('activity:end'));
    }
  });
});
