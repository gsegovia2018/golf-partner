# Scoped Player Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the add-player picker to friends + guest players the current user created, and scope the Players Library screen to only the user's own guest players.

**Architecture:** Add a `created_by` ownership column to the `players` table (auto-stamped on INSERT via a `DEFAULT auth.uid()`, backfilled from tournament history). Add two scoped read functions to `libraryStore.js` — `fetchMyPlayers()` for the picker and `fetchMyGuestPlayers()` for the library screen. The existing `fetchPlayers()` stays unchanged so historical scorecards keep resolving any player by id. Scoping is application-level; `players` RLS is not changed.

**Tech Stack:** Supabase (Postgres + JS client), React Native, Jest.

**Spec:** `docs/superpowers/specs/2026-05-18-scoped-player-library-design.md`

---

## File Structure

- **Create:** `supabase/migrations/20260518000000_players_created_by.sql` — adds `players.created_by`, backfills it.
- **Modify:** `src/store/libraryStore.js` — add `fetchMyPlayers()` and `fetchMyGuestPlayers()`.
- **Create:** `src/store/__tests__/libraryStore.test.js` — unit tests for the two new functions.
- **Modify:** `src/screens/PlayerPickerScreen.js:13,47` — use `fetchMyPlayers()`.
- **Modify:** `src/screens/PlayersLibraryScreen.js:13,38` — use `fetchMyGuestPlayers()`.

---

## Task 1: Database migration — `players.created_by`

**Files:**
- Create: `supabase/migrations/20260518000000_players_created_by.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260518000000_players_created_by.sql` with exactly this content:

```sql
-- ============================================================================
-- Player ownership: who created each player row.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   players.created_by  → the auth user who created the player row.
--                         DEFAULT auth.uid() auto-stamps every new INSERT.
--                         Upserts of an existing player send only name/handicap,
--                         so created_by is never overwritten on update.
--
-- Backfill attributes each player to the owner of the EARLIEST tournament they
-- appear in, then attributes app-user player rows to themselves. Orphaned rows
-- (no owned tournament, no user_id) keep created_by = NULL and stop appearing
-- in any picker.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run, or `supabase db push`.
--   Idempotent — safe to re-run.
-- ============================================================================

-- 1) Ownership column --------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS created_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL
    DEFAULT auth.uid();

-- 2) Backfill from tournament history ----------------------------------------
-- Each player is attributed to the owner of the earliest tournament that lists
-- them in its data->'players' JSON array.
UPDATE public.players p
   SET created_by = sub.owner
  FROM (
    SELECT DISTINCT ON ((pl->>'id'))
           (pl->>'id') AS player_id,
           t.created_by AS owner
      FROM public.tournaments t,
           LATERAL jsonb_array_elements(
             COALESCE(t.data->'players', '[]'::jsonb)) pl
     WHERE t.created_by IS NOT NULL
     ORDER BY (pl->>'id'), t.created_at
  ) sub
 WHERE p.id::text = sub.player_id
   AND p.created_by IS NULL;

-- 3) App users own their own player row --------------------------------------
UPDATE public.players
   SET created_by = user_id
 WHERE created_by IS NULL
   AND user_id IS NOT NULL;

/* =========================================================================
   VERIFY
   -------
   -- Column exists:
   SELECT column_name, data_type, column_default
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'players'
      AND column_name = 'created_by';

   -- How many rows got an owner vs stayed orphaned:
   SELECT
     count(*) FILTER (WHERE created_by IS NOT NULL) AS owned,
     count(*) FILTER (WHERE created_by IS NULL)     AS orphaned
   FROM public.players;
   ========================================================================= */
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: the new migration `20260518000000_players_created_by` is reported as applied with no errors.

If `supabase db push` cannot run in this environment (no linked project / no DB access), instead paste the file contents into the Supabase SQL editor for project `cxqugzmgbcknlxfipfse` and Run. The migration is idempotent.

- [ ] **Step 3: Verify the column and backfill**

Run the two `VERIFY` queries from the file's trailing comment in the Supabase SQL editor.
Expected: the first returns one row showing `created_by` / `uuid` / default `auth.uid()`; the second returns an `owned` count greater than 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260518000000_players_created_by.sql
git commit -m "feat: add players.created_by ownership column with history backfill

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Scoped read functions in `libraryStore.js`

**Files:**
- Test: `src/store/__tests__/libraryStore.test.js`
- Modify: `src/store/libraryStore.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/libraryStore.test.js` with exactly this content:

```js
import { fetchMyPlayers, fetchMyGuestPlayers } from '../libraryStore';
import { listFriends, getCachedFriends } from '../friendStore';

// mockState is read inside the hoisted jest.mock factory; the `mock` prefix
// is what lets jest reference it from the factory.
const mockState = {
  user: { id: 'u1' },
  rows: [],
  calls: {},
};

jest.mock('../../lib/supabase', () => {
  const client = {
    from(table) { mockState.calls.table = table; return client; },
    select(cols) { mockState.calls.select = cols; return client; },
    or(expr) { mockState.calls.or = expr; return client; },
    eq(col, val) {
      if (!mockState.calls.eq) mockState.calls.eq = [];
      mockState.calls.eq.push([col, val]);
      return client;
    },
    is(col, val) {
      if (!mockState.calls.is) mockState.calls.is = [];
      mockState.calls.is.push([col, val]);
      return client;
    },
    order() { return Promise.resolve({ data: mockState.rows, error: null }); },
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockState.user } }),
    },
  };
  return { supabase: client };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(),
  getCachedFriends: jest.fn(),
}));

describe('fetchMyPlayers', () => {
  beforeEach(() => {
    mockState.user = { id: 'u1' };
    mockState.rows = [{ id: 'p1', name: 'Ann' }];
    mockState.calls = {};
    listFriends.mockReset();
    getCachedFriends.mockReset();
  });

  test('scopes to created_by = me OR user_id in (me + friends)', async () => {
    listFriends.mockResolvedValue([{ userId: 'f1' }, { userId: 'f2' }]);
    const result = await fetchMyPlayers();
    expect(mockState.calls.table).toBe('players');
    expect(mockState.calls.or).toBe(
      'created_by.eq.u1,user_id.in.(u1,f1,f2)',
    );
    expect(result).toEqual([{ id: 'p1', name: 'Ann' }]);
  });

  test('falls back to cached friends when the friends read fails', async () => {
    listFriends.mockRejectedValue(new Error('offline'));
    getCachedFriends.mockResolvedValue([{ userId: 'f3' }]);
    await fetchMyPlayers();
    expect(mockState.calls.or).toBe('created_by.eq.u1,user_id.in.(u1,f3)');
  });

  test('returns [] without querying when signed out', async () => {
    mockState.user = null;
    const result = await fetchMyPlayers();
    expect(result).toEqual([]);
    expect(mockState.calls.table).toBeUndefined();
  });
});

describe('fetchMyGuestPlayers', () => {
  beforeEach(() => {
    mockState.user = { id: 'u1' };
    mockState.rows = [{ id: 'g1', name: 'Guest', user_id: null }];
    mockState.calls = {};
  });

  test('scopes to created_by = me AND user_id IS NULL', async () => {
    const result = await fetchMyGuestPlayers();
    expect(mockState.calls.table).toBe('players');
    expect(mockState.calls.eq).toEqual([['created_by', 'u1']]);
    expect(mockState.calls.is).toEqual([['user_id', null]]);
    expect(result).toEqual([{ id: 'g1', name: 'Guest', user_id: null }]);
  });

  test('returns [] without querying when signed out', async () => {
    mockState.user = null;
    const result = await fetchMyGuestPlayers();
    expect(result).toEqual([]);
    expect(mockState.calls.table).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/libraryStore.test.js`
Expected: FAIL — `fetchMyPlayers` / `fetchMyGuestPlayers` are not exported by `../libraryStore`.

- [ ] **Step 3: Implement the two functions**

In `src/store/libraryStore.js`, replace the existing import line at the top of the file:

```js
import { supabase } from '../lib/supabase';
```

with:

```js
import { supabase } from '../lib/supabase';
import { listFriends, getCachedFriends } from './friendStore';
```

Then, immediately after the existing `fetchPlayers()` function (before `upsertPlayer`), add:

```js
// Columns every player consumer relies on. Shared by the scoped readers below.
const PLAYER_COLUMNS = 'id, name, handicap, user_id, avatar_url, created_at, created_by';

// Accepted-friend auth user ids. Falls back to the offline cache when the
// network read fails, so the picker still scopes sensibly offline.
async function myFriendIds() {
  try {
    const friends = await listFriends();
    return friends.map((f) => f.userId).filter(Boolean);
  } catch {
    const cached = await getCachedFriends();
    return cached.map((f) => f.userId).filter(Boolean);
  }
}

// Players the current user may ADD to a game: their own guest players
// (created_by = me) plus every friend's app-user row. Signed-out → [].
export async function fetchMyPlayers() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const friendIds = await myFriendIds();
  const userIds = [user.id, ...friendIds].filter(Boolean);
  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_COLUMNS)
    .or(`created_by.eq.${user.id},user_id.in.(${userIds.join(',')})`)
    .order('name');
  if (error) throw error;
  return data;
}

// Players the current user MANAGES in their library: only their own guest
// players (created_by = me, no app account). Signed-out → [].
export async function fetchMyGuestPlayers() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_COLUMNS)
    .eq('created_by', user.id)
    .is('user_id', null)
    .order('name');
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/store/__tests__/libraryStore.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "feat: scoped player readers fetchMyPlayers and fetchMyGuestPlayers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire the add-player picker to `fetchMyPlayers()`

**Files:**
- Modify: `src/screens/PlayerPickerScreen.js:13,47`

- [ ] **Step 1: Swap the import**

In `src/screens/PlayerPickerScreen.js`, change line 13 from:

```js
import { fetchPlayers } from '../store/libraryStore';
```

to:

```js
import { fetchMyPlayers } from '../store/libraryStore';
```

- [ ] **Step 2: Swap the call**

In the same file, inside the `useFocusEffect` callback, change:

```js
      fetchPlayers()
        .then(async (list) => {
```

to:

```js
      fetchMyPlayers()
        .then(async (list) => {
```

- [ ] **Step 3: Verify nothing else references `fetchPlayers` in this file**

Run: `grep -n "fetchPlayers" src/screens/PlayerPickerScreen.js`
Expected: no output (zero matches).

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayerPickerScreen.js
git commit -m "feat: add-player picker shows only friends and own guest players

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire the Players Library screen to `fetchMyGuestPlayers()`

**Files:**
- Modify: `src/screens/PlayersLibraryScreen.js:13,38`

- [ ] **Step 1: Swap the import**

In `src/screens/PlayersLibraryScreen.js`, change line 13 from:

```js
import { deletePlayer, fetchPlayers, upsertPlayer } from '../store/libraryStore';
```

to:

```js
import { deletePlayer, fetchMyGuestPlayers, upsertPlayer } from '../store/libraryStore';
```

- [ ] **Step 2: Swap the call**

In the same file, inside the `load()` function, change:

```js
      setPlayers(await fetchPlayers());
```

to:

```js
      setPlayers(await fetchMyGuestPlayers());
```

- [ ] **Step 3: Verify nothing else references `fetchPlayers` in this file**

Run: `grep -n "fetchPlayers" src/screens/PlayersLibraryScreen.js`
Expected: no output (zero matches).

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/screens/PlayersLibraryScreen.js
git commit -m "feat: Players Library shows only the user's own guest players

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Verification

After all tasks:

- `npx jest` passes with the 5 new `libraryStore` tests and no regressions.
- `grep -rn "fetchPlayers" src/screens` shows only `ScorecardScreen.js` and `SetupScreen.js` still using it (lookup-by-id callers — intentionally unchanged).
- Manual smoke test (if a dev build is available): the add-player picker lists only friends + your guest players; the Players Library lists only guest players you created; opening an existing scorecard still renders every player's name and handicap.
