# Feed First Paint Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Feed show cached/base round cards quickly, then hydrate fresh remote data, media, reactions, and comments without blocking first paint.

**Architecture:** Split feed loading into a fast base path and slower overlay paths. The base path reads cached tournaments/friends first and builds round cards without media; remote tournament refresh, media stories, reactions, and comments run after visible content is already on screen. Auth user id is passed from `AuthContext` so the feed does not repeatedly call Supabase Auth during one load.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, Supabase JS, AsyncStorage, Jest via `jest-expo`, React Native Testing Library.

---

## File Structure

- Modify `src/store/tournamentStore.js`: export a cache-only tournament list read for screens that need immediate local data.
- Modify `src/store/feedStore.js`: add feed load options, avoid repeated auth lookups when `userId` is supplied, add a base feed builder, limit feed items, and add separate media hydration.
- Modify `src/screens/FeedScreen.js`: use `useAuth()`, render cached/base feed first, then refresh remote data and hydrate overlays in the background.
- Add `src/store/__tests__/feedStore.performance.test.js`: cover cache/base feed behavior, media deferral, feed limiting, and auth lookup avoidance.
- Modify `src/screens/__tests__/FeedScreen.test.js`: cover two-stage loading so base items render before media hydration completes.

## Task 1: Add A Cache-Only Tournament List

**Files:**
- Modify: `src/store/tournamentStore.js`
- Test: `src/store/__tests__/loadTournamentCached.test.js`

- [ ] **Step 1: Write the failing test**

Add this test to `src/store/__tests__/loadTournamentCached.test.js`:

```js
test('loadCachedTournamentsList returns local blobs without calling Supabase', async () => {
  jest.resetModules();
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/store/__tests__/loadTournamentCached.test.js --runInBand`

Expected: FAIL because `loadCachedTournamentsList` is not exported.

- [ ] **Step 3: Export the cache-only loader**

In `src/store/tournamentStore.js`, directly after `_loadCachedFullList()`, add:

```js
export async function loadCachedTournamentsList() {
  return _loadCachedFullList();
}
```

This intentionally does not call `ensureMigrated()` or Supabase. It is a UI fast-path for data already present on the device.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/store/__tests__/loadTournamentCached.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/loadTournamentCached.test.js
git commit -m "feat(feed): expose cached tournament list"
```

## Task 2: Split Base Feed Build From Media Hydration

**Files:**
- Modify: `src/store/feedStore.js`
- Add: `src/store/__tests__/feedStore.performance.test.js`

- [ ] **Step 1: Write failing tests for base feed behavior**

Create `src/store/__tests__/feedStore.performance.test.js` with:

```js
const mockState = {
  userCalls: 0,
  mediaCalls: 0,
  cachedTournaments: [],
  remoteTournaments: [],
  friends: [],
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
  listFriends: jest.fn(() => Promise.resolve(mockState.friends)),
  getCachedFriends: jest.fn(() => Promise.resolve(mockState.friends)),
}));

jest.mock('../mediaStore', () => ({
  loadMediaForTournaments: jest.fn(() => {
    mockState.mediaCalls += 1;
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
    mockState.cachedTournaments = [tournament('cached', 1000)];
    mockState.remoteTournaments = [tournament('remote', 2000)];
    mockState.friends = [];
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
      includeMedia: false,
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].tournamentId).toBe('new');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/store/__tests__/feedStore.performance.test.js --runInBand`

Expected: FAIL because `buildFeed` does not accept `source`, `includeMedia`, `limit`, or `userId` options, and `loadCachedTournamentsList` is not imported.

- [ ] **Step 3: Update feed store imports**

In `src/store/feedStore.js`, change the tournament import to include the cache loader:

```js
import {
  loadAllTournamentsWithFallback,
  loadCachedTournamentsList,
  roundTotals,
  isTournamentFinished,
  formatRoundLabel,
} from './tournamentStore';
```

- [ ] **Step 4: Add option helpers**

In `src/store/feedStore.js`, above `export async function buildFeed`, add:

```js
const DEFAULT_FEED_LIMIT = 30;

async function resolveFeedUserId(userId) {
  if (userId !== undefined) return userId ?? null;
  return currentUserId();
}

async function loadFeedFriends(source) {
  if (source === 'cache') return getCachedFriends();
  try {
    return await listFriends();
  } catch {
    return getCachedFriends();
  }
}

async function loadFeedTournaments(source) {
  if (source === 'cache') {
    return { list: await loadCachedTournamentsList(), stale: true };
  }
  return loadAllTournamentsWithFallback();
}
```

- [ ] **Step 5: Replace the buildFeed signature and loading section**

Change:

```js
export async function buildFeed() {
  let partial = false;

  let me = null;
  try { me = await currentUserId(); } catch { partial = true; }

  let friends = [];
  try {
    friends = await listFriends();
  } catch {
    partial = true;
    friends = await getCachedFriends();
  }
```

to:

```js
export async function buildFeed(options = {}) {
  const {
    userId,
    source = 'remote',
    includeMedia = true,
    limit = DEFAULT_FEED_LIMIT,
  } = options;
  let partial = false;

  let me = null;
  try { me = await resolveFeedUserId(userId); } catch { partial = true; }

  let friends = [];
  try {
    friends = await loadFeedFriends(source);
  } catch {
    partial = true;
    friends = [];
  }
```

Then replace the `myTournaments` load block with:

```js
  let myTournaments = [];
  try {
    ({ list: myTournaments } = await loadFeedTournaments(source));
  } catch {
    return { me, friends, items: [], roundStories: [], partial: false, error: true };
  }
```

- [ ] **Step 6: Apply item limit before media hydration**

After `items.sort((a, b) => b.ts - a.ts);`, add:

```js
  const limitedItems = items.slice(0, Math.max(0, limit));
```

Change the media block to use the limited tournament ids:

```js
  let media = [];
  if (includeMedia) {
    try {
      const visibleTournamentIds = limitedItems.map((item) => item.tournamentId);
      media = await loadMediaForTournaments(visibleTournamentIds);
    } catch { partial = true; }
  }
```

Build stories and attach media to `limitedItems`, then return `limitedItems`:

```js
  const roundStories = includeMedia ? buildRoundStories(all, media) : [];
  const storyByRoundKey = new Map(roundStories.map((story) => [
    `${story.tournamentId}:${story.roundId ?? 'none'}`,
    story,
  ]));
  for (const item of limitedItems) {
    if (item.type !== 'round') continue;
    const story = storyByRoundKey.get(`${item.tournamentId}:${item.roundId ?? 'none'}`);
    if (!story) continue;
    const newestMedia = story.mediaList[story.mediaList.length - 1] ?? null;
    item.mediaCount = story.count;
    item.mediaCountLabel = story.countLabel;
    item.mediaId = newestMedia?.id ?? null;
    item.mediaCoverUrl = newestMedia?.thumbUrl || newestMedia?.url || null;
    item.mediaUrl = newestMedia?.url || newestMedia?.thumbUrl || null;
    item.mediaList = story.mediaList.slice();
    item.mediaHasVideo = story.hasVideo;
  }

  return { me, friends, items: limitedItems, roundStories, partial, error: false };
```

Delete the old unconditional media block and old final `items.sort` / return.

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- src/store/__tests__/feedStore.performance.test.js src/store/__tests__/feedStore.roundStories.test.js src/store/__tests__/feedStore.comments.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/store/feedStore.js src/store/__tests__/feedStore.performance.test.js
git commit -m "feat(feed): split base feed from media hydration"
```

## Task 3: Render Cached/Base Feed Before Remote And Media

**Files:**
- Modify: `src/screens/FeedScreen.js`
- Modify: `src/screens/__tests__/FeedScreen.test.js`

- [ ] **Step 1: Write failing screen test for two-stage load**

In `src/screens/__tests__/FeedScreen.test.js`, add `useAuth` to the mocks:

```js
jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ user: { id: 'u1' } })),
}));
```

Add this test:

```js
test('renders cached base feed before remote media hydration completes', async () => {
  let resolveRemote;
  const cachedResult = {
    ...result,
    roundStories: [],
    items: [{
      ...result.items[0],
      tournamentId: 'cached-t1',
      tournamentName: 'Cached Match',
      mediaCount: undefined,
      mediaCountLabel: undefined,
      mediaCoverUrl: null,
      mediaList: undefined,
    }],
  };
  const remoteResult = {
    ...result,
    items: [{
      ...result.items[0],
      tournamentId: 'remote-t1',
      tournamentName: 'Remote Match',
    }],
  };

  buildFeed
    .mockResolvedValueOnce(cachedResult)
    .mockReturnValueOnce(new Promise((resolve) => { resolveRemote = () => resolve(remoteResult); }));

  const { findByText, queryByText } = render(wrap(
    <FeedScreen navigation={navigation} />
  ));

  expect(await findByText('Cached Match')).toBeTruthy();
  expect(queryByText('Remote Match')).toBeNull();

  resolveRemote();
  expect(await findByText('Remote Match')).toBeTruthy();
  expect(buildFeed).toHaveBeenNthCalledWith(1, expect.objectContaining({
    userId: 'u1',
    source: 'cache',
    includeMedia: false,
  }));
  expect(buildFeed).toHaveBeenNthCalledWith(2, expect.objectContaining({
    userId: 'u1',
    source: 'remote',
    includeMedia: true,
  }));
});
```

- [ ] **Step 2: Run the screen test and verify it fails**

Run: `npm test -- src/screens/__tests__/FeedScreen.test.js --runInBand`

Expected: FAIL because `FeedScreen` still calls `buildFeed()` once and waits for it before rendering.

- [ ] **Step 3: Use AuthContext in FeedScreen**

In `src/screens/FeedScreen.js`, add:

```js
import { useAuth } from '../context/AuthContext';
```

Inside `FeedScreen`, after `const now = useNow();`, add:

```js
  const { user } = useAuth() ?? {};
  const userId = user?.id ?? null;
```

- [ ] **Step 4: Replace the load function with two-stage loading**

Replace the current `load` callback with:

```js
  const applyFeedResult = useCallback((result) => {
    const feedItems = result.items ?? [];
    setItems(feedItems);
    setRoundStories(result.roundStories ?? []);
    setStatus(result.error ? 'error' : (result.partial ? 'partial' : 'ok'));
    loadedOnceRef.current = true;

    const keys = feedItems.map((it) => it.key);
    loadReactions(keys).then(setReactions).catch(() => {});
    loadCommentCounts(keys).then(setCommentCounts).catch(() => {});
  }, []);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    try {
      if (!isRefresh && !loadedOnceRef.current) {
        const cached = await buildFeed({
          userId,
          source: 'cache',
          includeMedia: false,
          limit: 30,
        });
        if ((cached.items ?? []).length > 0 || (cached.roundStories ?? []).length > 0) {
          applyFeedResult(cached);
          setLoading(false);
        }
      }

      const fresh = await buildFeed({
        userId,
        source: 'remote',
        includeMedia: true,
        limit: 30,
      });
      applyFeedResult(fresh);
    } catch {
      if (!loadedOnceRef.current) setItems([]);
      if (!loadedOnceRef.current) setRoundStories([]);
      setStatus('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyFeedResult, userId]);
```

- [ ] **Step 5: Guard focus reload against duplicate remote loads**

Keep the existing `useFocusEffect`, but make sure the dependency list remains `[load]`. Do not add a second effect for auth changes; the changed `userId` dependency already rebuilds `load`.

- [ ] **Step 6: Run the screen tests**

Run:

```bash
npm test -- src/screens/__tests__/FeedScreen.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/screens/FeedScreen.js src/screens/__tests__/FeedScreen.test.js
git commit -m "feat(feed): render cached feed before remote hydration"
```

## Task 4: Add Lightweight Dev Timing Around Feed Loads

**Files:**
- Modify: `src/screens/FeedScreen.js`
- Test: no snapshot/unit test required; this is dev-only observability.

- [ ] **Step 1: Add timing helper**

In `src/screens/FeedScreen.js`, above `export default function FeedScreen`, add:

```js
function feedMark(label, startedAt) {
  if (!__DEV__ || !startedAt) return;
  const elapsed = Math.round(Date.now() - startedAt);
  // eslint-disable-next-line no-console
  console.log(`[feed] ${label}: ${elapsed}ms`);
}
```

- [ ] **Step 2: Mark cached and remote stages**

Inside `load`, before the cached call, add:

```js
        const cachedStart = Date.now();
```

Immediately after `const cached = await buildFeed(...)`, add:

```js
        feedMark('cache base', cachedStart);
```

Before the remote call, add:

```js
      const remoteStart = Date.now();
```

Immediately after `const fresh = await buildFeed(...)`, add:

```js
      feedMark('remote full', remoteStart);
```

- [ ] **Step 3: Run lint**

Run: `npm run lint -- src/screens/FeedScreen.js`

Expected: PASS. If the repo lint script does not accept file args, run `npm run lint`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/FeedScreen.js
git commit -m "chore(feed): add dev load timing"
```

## Task 5: Full Verification

**Files:**
- No additional edits expected.

- [ ] **Step 1: Run focused feed tests**

Run:

```bash
npm test -- src/store/__tests__/feedStore.performance.test.js src/store/__tests__/feedStore.roundStories.test.js src/store/__tests__/feedStore.comments.test.js src/screens/__tests__/FeedScreen.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Run web app**

Run: `npm run web`

Expected: Expo starts a local web server.

- [ ] **Step 5: Manual browser verification**

Open the local Expo URL in the in-app browser or Playwright and verify:

- First Feed visit shows cached/base round cards before remote media completes when cached tournaments exist.
- Pull-to-refresh still updates feed content.
- Stories rail appears after remote/media hydration.
- Reaction and comment badges still appear after the base feed is visible.
- Empty feed still shows “Your feed is quiet” only after both cached and remote paths produce no items.

- [ ] **Step 6: Check dev timing**

In the browser or Metro logs, confirm entries similar to:

```text
[feed] cache base: 50ms
[feed] remote full: 1200ms
```

The exact numbers depend on device and network. The important result is that `cache base` logs and content appears before `remote full`.

- [ ] **Step 7: Commit any verification-only fixes**

If verification required small fixes, commit them:

```bash
git add src/store/feedStore.js src/screens/FeedScreen.js src/store/__tests__/feedStore.performance.test.js src/screens/__tests__/FeedScreen.test.js
git commit -m "fix(feed): stabilize fast feed loading"
```

## Follow-Up If Remote Full Still Feels Slow

If `[feed] remote full` remains consistently above 2 seconds on good network, create a second plan for a server-side paginated feed RPC. That plan should add a Supabase migration with an RPC that returns only `{ item_key, tournament_id, round_id, round_index, course_name, points, strokes, holes, player summaries, activity_ts }` instead of downloading full `tournaments.data` blobs for every accessible tournament.

Do not start that RPC work until the client-side first-paint fix is verified; the client split gives immediate user-visible improvement and provides timing data to justify the server work.
