// Task 4 (audit-tier4-perf): remote buildFeed pagination + build-pipeline
// cache. Covers:
//   1. offset/limit slicing produces a stable page + accurate `hasMore`.
//   2. a `useCache: true` call reuses the last non-'cache'-source build's
//      fetched ingredients (friends/tournaments/activity) instead of
//      re-running the RPCs — this is what makes onEndReached pagination and
//      a plain screen refocus cheap.
//   3. invalidateFeedCache() forces the next build to re-fetch, so a real
//      data change (tournament-change event) is never served stale.

const mockState = {
  friends: [],
  remoteTournaments: [],
  roundActivityRows: [],
};

jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => true) }));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'me-user' } } })),
    },
  },
}));

jest.mock('../tournamentRepo', () => ({
  fetchTournament: jest.fn(),
  fetchRoundActivity: jest.fn(() => Promise.resolve(mockState.roundActivityRows)),
}));

jest.mock('../tournamentStore', () => {
  const actual = jest.requireActual('../tournamentStore');
  return {
    ...actual,
    loadCachedTournamentsList: jest.fn(() => Promise.resolve([])),
    loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({
      list: mockState.remoteTournaments,
      stale: false,
      openableIds: null,
    })),
  };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(() => Promise.resolve(mockState.friends)),
  getCachedFriends: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../mediaStore', () => ({
  // Echoes back whichever configured media belong to the requested
  // tournament ids, so a test can assert the story rail spans tournaments
  // OUTSIDE the paginated feed-card window.
  loadMediaForTournaments: jest.fn((ids) => {
    const wanted = new Set(ids);
    return Promise.resolve((mockState.media ?? []).filter((m) => wanted.has(m.tournamentId)));
  }),
}));

function tournament(id, ts) {
  return {
    id,
    name: `Game ${id}`,
    kind: 'game',
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

describe('feedStore remote pagination + build cache (Task 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the module-level build cache so tests don't leak into each other
    // (module state persists across tests within this file since Jest does
    // not reset the require cache between individual `test()`s).
    const { invalidateFeedCache } = require('../feedStore');
    invalidateFeedCache();
    mockState.friends = [];
    mockState.roundActivityRows = [];
    mockState.media = [];
    mockState.remoteTournaments = Array.from({ length: 35 }, (_, i) => (
      tournament(`t${i}`, 1000 + i)
    ));
  });

  test('a page (limit + offset) returns a contiguous slice of the full newest-first order, with hasMore accurate at the boundary', async () => {
    const { buildFeed } = require('../feedStore');

    const full = await buildFeed({ userId: 'me-user', source: 'remote', includeMedia: false });
    expect(full.items).toHaveLength(35);

    const page1 = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0,
    });
    expect(page1.items).toHaveLength(30);
    expect(page1.items.map((i) => i.tournamentId)).toEqual(full.items.slice(0, 30).map((i) => i.tournamentId));
    expect(page1.hasMore).toBe(true);
    expect(page1.nextOffset).toBe(30);

    const page2 = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 30,
    });
    expect(page2.items).toHaveLength(5);
    expect(page2.items.map((i) => i.tournamentId)).toEqual(full.items.slice(30, 60).map((i) => i.tournamentId));
    expect(page2.hasMore).toBe(false);

    // No overlap, no gap, no duplicates across the two pages.
    const seen = new Set([...page1.items, ...page2.items].map((i) => i.key));
    expect(seen.size).toBe(35);
  });

  test('the story rail includes a round whose media activity is OUTSIDE the first 30 feed-card items', async () => {
    const { buildFeed } = require('../feedStore');

    // t0 is the OLDEST tournament (createdAt 1000), so it sorts at position
    // 35 — well outside the 30-item first page. It's the only tournament
    // with photos.
    mockState.media = [{
      id: 'photo-1',
      tournamentId: 't0',
      roundId: 'r-t0',
      kind: 'photo',
      createdAt: '2026-07-14T10:00:00.000Z',
      uploaderLabel: 'Marcos',
      url: 'https://example.com/photo-1.jpg',
      thumbUrl: 'https://example.com/photo-1-thumb.jpg',
    }];

    const page1 = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: true, limit: 30, offset: 0,
    });

    // t0's round is NOT among the 30 visible feed cards…
    expect(page1.items).toHaveLength(30);
    expect(page1.items.some((i) => i.tournamentId === 't0')).toBe(false);
    // …yet its photos still surface in the story rail, because the rail is
    // built from the full history, not the paginated card window. (This is
    // the content-regression guard: it would fail if the rail were scoped
    // to page 1.)
    expect(page1.roundStories.map((story) => story.key)).toContain('story:t0:r-t0');
  });

  test('useCache: true reuses the previous build\'s friends/tournaments/activity instead of re-fetching', async () => {
    const { buildFeed } = require('../feedStore');
    const { listFriends } = require('../friendStore');
    const { loadAllTournamentsWithFallback } = require('../tournamentStore');
    const { fetchRoundActivity } = require('../tournamentRepo');

    await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0,
    });
    expect(listFriends).toHaveBeenCalledTimes(1);
    expect(loadAllTournamentsWithFallback).toHaveBeenCalledTimes(1);
    expect(fetchRoundActivity).toHaveBeenCalledTimes(1);

    // A pagination page fetch (offset > 0) opts into the cache.
    const page2 = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 30, useCache: true,
    });
    expect(page2.items).toHaveLength(5);
    expect(listFriends).toHaveBeenCalledTimes(1); // not called again
    expect(loadAllTournamentsWithFallback).toHaveBeenCalledTimes(1);
    expect(fetchRoundActivity).toHaveBeenCalledTimes(1);

    // A plain refocus (same page, opts into the cache too) also skips RPCs.
    const refocus = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0, useCache: true,
    });
    expect(refocus.items).toHaveLength(30);
    expect(listFriends).toHaveBeenCalledTimes(1);
    expect(loadAllTournamentsWithFallback).toHaveBeenCalledTimes(1);
    expect(fetchRoundActivity).toHaveBeenCalledTimes(1);
  });

  test('a call without useCache always fetches fresh, even immediately after a cached build', async () => {
    const { buildFeed } = require('../feedStore');
    const { listFriends } = require('../friendStore');

    await buildFeed({ userId: 'me-user', source: 'remote', includeMedia: false, limit: 30 });
    expect(listFriends).toHaveBeenCalledTimes(1);

    await buildFeed({ userId: 'me-user', source: 'remote', includeMedia: false, limit: 30 });
    expect(listFriends).toHaveBeenCalledTimes(2);
  });

  test('invalidateFeedCache() forces the next useCache:true build to re-fetch fresh data', async () => {
    const { buildFeed, invalidateFeedCache } = require('../feedStore');
    const { listFriends } = require('../friendStore');

    await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0,
    });
    expect(listFriends).toHaveBeenCalledTimes(1);

    // Simulate real new activity landing between builds.
    mockState.remoteTournaments = [
      ...mockState.remoteTournaments,
      tournament('t-new', 999999),
    ];
    invalidateFeedCache();

    const result = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0, useCache: true,
    });
    expect(listFriends).toHaveBeenCalledTimes(2); // re-fetched, cache was invalidated
    expect(result.items.some((i) => i.tournamentId === 't-new')).toBe(true);
  });

  test('a stale cache (past the TTL) is not reused even when useCache: true is requested', async () => {
    const { buildFeed } = require('../feedStore');
    const { listFriends } = require('../friendStore');
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(1_000_000);
      await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0,
      });
      expect(listFriends).toHaveBeenCalledTimes(1);

      // Still fresh — reused.
      nowSpy.mockReturnValue(1_000_000 + 60 * 1000);
      await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0, useCache: true,
      });
      expect(listFriends).toHaveBeenCalledTimes(1);

      // Past the 3-minute TTL — must refetch even though useCache is true, so
      // a refocus left idle for a while never shows indefinitely stale
      // friend activity just because no local edit fired to invalidate it.
      nowSpy.mockReturnValue(1_000_000 + 4 * 60 * 1000);
      await buildFeed({
        userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, offset: 0, useCache: true,
      });
      expect(listFriends).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('a cache-source build never reads or writes the remote build cache', async () => {
    const { buildFeed } = require('../feedStore');
    const { listFriends } = require('../friendStore');
    const { loadCachedTournamentsList } = require('../tournamentStore');
    loadCachedTournamentsList.mockResolvedValueOnce([tournament('cached-only', 1)]);

    const cacheResult = await buildFeed({
      userId: 'me-user', source: 'cache', includeMedia: false, limit: 30, useCache: true,
    });
    expect(cacheResult.items).toHaveLength(1);
    expect(listFriends).not.toHaveBeenCalled();

    // A subsequent remote build with useCache must still do its own fresh
    // fetch — the cache-source build must not have poisoned the remote cache
    // slot with an empty/partial ingredient set.
    const remoteResult = await buildFeed({
      userId: 'me-user', source: 'remote', includeMedia: false, limit: 30, useCache: true,
    });
    expect(listFriends).toHaveBeenCalledTimes(1);
    expect(remoteResult.items.length).toBeGreaterThan(0);
  });
});
