# Offline Course Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache the course library to `AsyncStorage` so a casual game can be set up fully offline by picking from the last-known library.

**Architecture:** Mirror the existing `friendStore` offline-cache pattern. Three `libraryStore` fetches (`fetchCourses`, `fetchClubs`, `fetchFavoriteCourseIds`) write their results through to `AsyncStorage` on success; matching `getCached*` readers return the last-known data. A new `loadCourseLibrary()` orchestrator in `libraryStore` tries the network and falls back to the cache, reporting `usingCachedData`. `CoursePickerScreen` calls `loadCourseLibrary()` instead of fetching inline; when `usingCachedData` is true it disables course creation. Extracting the orchestration into the store (rather than the screen) keeps domain logic testable and out of the UI, per `CLAUDE.md`.

**Tech Stack:** React Native 0.81 / Expo SDK 54, Jest (`jest-expo`), `@react-native-async-storage/async-storage`, Supabase JS client.

**Spec:** `docs/superpowers/specs/2026-05-21-offline-course-cache-design.md`

---

## File Structure

No new files. Three files change:

- **Modify `src/store/libraryStore.js`** — add three cache-key constants, write-through caching inside `fetchCourses` / `fetchClubs` / `fetchFavoriteCourseIds`, three `getCached*` readers, and the `loadCourseLibrary()` orchestrator.
- **Modify `src/store/__tests__/libraryStore.test.js`** — two small additive enhancements to the existing Supabase mock, plus four new `describe` blocks.
- **Modify `src/screens/CoursePickerScreen.js`** — call `loadCourseLibrary()` in the load effect, track `usingCachedData`, and gate the two course-creation controls on it.

`src/store/scoring.js`, `src/store/merge.js`, `src/screens/SetupScreen.js`, `src/store/tournamentStore.js`, and the sync modules are intentionally **not** touched — the existing offline game-save path handles a picked course unchanged.

---

## Task 1: Course list offline cache

Adds write-through caching to `fetchCourses` and a `getCachedCourses` reader.

**Files:**
- Modify: `src/store/libraryStore.js` (imports; Courses section, currently lines 81-90)
- Test: `src/store/__tests__/libraryStore.test.js` (imports at line 1; new `describe` block appended)

- [ ] **Step 1: Write the failing test**

In `src/store/__tests__/libraryStore.test.js`, change the first import line (line 1) from:

```javascript
import { fetchMyPlayers, fetchMyGuestPlayers, normalizeCourse, saveCourseTees } from '../libraryStore';
```

to:

```javascript
import {
  fetchMyPlayers, fetchMyGuestPlayers, normalizeCourse, saveCourseTees,
  fetchCourses, getCachedCourses, COURSES_CACHE_KEY,
} from '../libraryStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
```

Then append this `describe` block to the end of the file:

```javascript
describe('courses offline cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.calls = {};
  });

  test('fetchCourses writes the normalized list to the cache', async () => {
    mockState.rows = [
      { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
    ];
    const result = await fetchCourses();
    const cached = await getCachedCourses();
    expect(cached).toEqual(result);
    expect(cached[0]).toMatchObject({ id: 'c1', name: 'Pine' });
  });

  test('getCachedCourses returns [] when nothing is cached', async () => {
    expect(await getCachedCourses()).toEqual([]);
  });

  test('getCachedCourses returns [] when the cached value is corrupt', async () => {
    await AsyncStorage.setItem(COURSES_CACHE_KEY, 'not-json{');
    expect(await getCachedCourses()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "courses offline cache"`
Expected: FAIL — `getCachedCourses is not a function` (the reader and key are not exported yet).

- [ ] **Step 3: Write minimal implementation**

In `src/store/libraryStore.js`, add the AsyncStorage import. Change the top of the file from:

```javascript
import { supabase } from '../lib/supabase';
import { listFriends, getCachedFriends } from './friendStore';
```

to:

```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { listFriends, getCachedFriends } from './friendStore';
```

Then replace the Courses section header and `fetchCourses` (currently lines 81-90):

```javascript
// ── Courses ───────────────────────────────────────────────────────────────────

export async function fetchCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*, course_holes(*), course_tees(*)')
    .order('name');
  if (error) throw error;
  return data.map(normalizeCourse);
}
```

with:

```javascript
// ── Courses ───────────────────────────────────────────────────────────────────
// Offline cache: the picker falls back to these last-known lists when a fetch
// fails, so a casual game can still be set up without a connection.

export const COURSES_CACHE_KEY = '@golf_courses_cache';

export async function fetchCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*, course_holes(*), course_tees(*)')
    .order('name');
  if (error) throw error;
  const courses = data.map(normalizeCourse);
  // Write-through cache, fire-and-forget (mirrors friendStore.listFriends).
  AsyncStorage.setItem(COURSES_CACHE_KEY, JSON.stringify(courses)).catch(() => {});
  return courses;
}

// Last-known course library — used when fetchCourses fails (offline). Never
// throws; returns [] when nothing is cached or the cache is unreadable.
export async function getCachedCourses() {
  try {
    const raw = await AsyncStorage.getItem(COURSES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "courses offline cache"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "$(cat <<'EOF'
feat: cache course list for offline picker

Write-through caches the normalized course list to AsyncStorage on
every successful fetchCourses, with a getCachedCourses reader for the
offline fallback. Mirrors the friendStore cache pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Clubs list offline cache

Adds write-through caching to `fetchClubs` and a `getCachedClubs` reader. The picker groups courses under clubs, so the cached club list keeps the grouped view intact offline.

**Files:**
- Modify: `src/store/libraryStore.js` (`fetchClubs`, currently lines 92-101)
- Test: `src/store/__tests__/libraryStore.test.js` (imports; new `describe` block appended)

- [ ] **Step 1: Write the failing test**

In `src/store/__tests__/libraryStore.test.js`, extend the `../libraryStore` import to also import `fetchClubs`, `getCachedClubs`, and `CLUBS_CACHE_KEY`. The import block becomes:

```javascript
import {
  fetchMyPlayers, fetchMyGuestPlayers, normalizeCourse, saveCourseTees,
  fetchCourses, getCachedCourses, COURSES_CACHE_KEY,
  fetchClubs, getCachedClubs, CLUBS_CACHE_KEY,
} from '../libraryStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
```

Append this `describe` block to the end of the file:

```javascript
describe('clubs offline cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.calls = {};
  });

  test('fetchClubs writes the club list to the cache', async () => {
    mockState.rows = [{ id: 'club1', name: 'Augusta', city: 'Augusta', province: 'GA' }];
    const result = await fetchClubs();
    expect(await getCachedClubs()).toEqual(result);
  });

  test('getCachedClubs returns [] when nothing is cached', async () => {
    expect(await getCachedClubs()).toEqual([]);
  });

  test('getCachedClubs returns [] when the cached value is corrupt', async () => {
    await AsyncStorage.setItem(CLUBS_CACHE_KEY, '{bad');
    expect(await getCachedClubs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "clubs offline cache"`
Expected: FAIL — `getCachedClubs is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/store/libraryStore.js`, replace `fetchClubs` (currently lines 92-101):

```javascript
// All clubs, ordered by name. A club groups several course layouts; the
// picker uses this together with fetchCourses to build its grouped list.
export async function fetchClubs() {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, city, province')
    .order('name');
  if (error) throw error;
  return data;
}
```

with:

```javascript
// All clubs, ordered by name. A club groups several course layouts; the
// picker uses this together with fetchCourses to build its grouped list.
export const CLUBS_CACHE_KEY = '@golf_clubs_cache';

export async function fetchClubs() {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, city, province')
    .order('name');
  if (error) throw error;
  AsyncStorage.setItem(CLUBS_CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return data;
}

// Last-known club list — used when fetchClubs fails (offline). Never throws.
export async function getCachedClubs() {
  try {
    const raw = await AsyncStorage.getItem(CLUBS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "clubs offline cache"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "$(cat <<'EOF'
feat: cache club list for offline picker

Write-through caches the club list and adds a getCachedClubs reader so
the picker's grouped course view survives offline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Favorite courses offline cache

Adds write-through caching to `fetchFavoriteCourseIds` and a `getCachedFavoriteCourseIds` reader. Favorites are a `Set`, serialized to an array for storage. This task also enhances the test's Supabase mock so a filter chain that ends at `.eq()` (which `fetchFavoriteCourseIds` uses) is awaitable.

**Files:**
- Modify: `src/store/libraryStore.js` (`fetchFavoriteCourseIds`, currently lines 166-175)
- Test: `src/store/__tests__/libraryStore.test.js` (Supabase mock; imports; new `describe` block)

- [ ] **Step 1: Enhance the Supabase mock and write the failing test**

In `src/store/__tests__/libraryStore.test.js`, the mock client's chain methods all return `client`, and only `.order()` resolves to a value. `fetchFavoriteCourseIds` ends its chain at `.eq()`, so `await <chain>` must resolve. Make the client a thenable. Change this part of the `jest.mock('../../lib/supabase', ...)` factory, from:

```javascript
    // insert() records the rows and resolves to { error: null }.
    insert(rows) {
      mockState.calls.insertedRows = rows;
      return Promise.resolve({ error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockState.user } }),
    },
```

to:

```javascript
    // insert() records the rows and resolves to { error: null }.
    insert(rows) {
      mockState.calls.insertedRows = rows;
      return Promise.resolve({ error: null });
    },
    // Makes a filter chain that ends without .order() (e.g. fetchFavoriteCourseIds,
    // which ends at .eq()) awaitable — `await <chain>` resolves to the rows.
    then(resolve) { resolve({ data: mockState.rows, error: null }); },
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockState.user } }),
    },
```

Extend the `../libraryStore` import to also import `fetchFavoriteCourseIds`, `getCachedFavoriteCourseIds`, and `FAVORITE_COURSES_CACHE_KEY`. The import block becomes:

```javascript
import {
  fetchMyPlayers, fetchMyGuestPlayers, normalizeCourse, saveCourseTees,
  fetchCourses, getCachedCourses, COURSES_CACHE_KEY,
  fetchClubs, getCachedClubs, CLUBS_CACHE_KEY,
  fetchFavoriteCourseIds, getCachedFavoriteCourseIds, FAVORITE_COURSES_CACHE_KEY,
} from '../libraryStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
```

Append this `describe` block to the end of the file:

```javascript
describe('favorite courses offline cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.calls = {};
  });

  test('fetchFavoriteCourseIds caches the ids and round-trips through a Set', async () => {
    mockState.rows = [{ course_id: 'c1' }, { course_id: 'c2' }];
    const result = await fetchFavoriteCourseIds();
    expect(result).toEqual(new Set(['c1', 'c2']));
    expect(await getCachedFavoriteCourseIds()).toEqual(new Set(['c1', 'c2']));
  });

  test('getCachedFavoriteCourseIds returns an empty Set when nothing is cached', async () => {
    expect(await getCachedFavoriteCourseIds()).toEqual(new Set());
  });

  test('getCachedFavoriteCourseIds returns an empty Set when the cached value is corrupt', async () => {
    await AsyncStorage.setItem(FAVORITE_COURSES_CACHE_KEY, 'nope');
    expect(await getCachedFavoriteCourseIds()).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "favorite courses offline cache"`
Expected: FAIL — `getCachedFavoriteCourseIds is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/store/libraryStore.js`, replace `fetchFavoriteCourseIds` (currently lines 166-175):

```javascript
export async function fetchFavoriteCourseIds() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('favorite_courses')
    .select('course_id')
    .eq('user_id', user.id);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.course_id));
}
```

with:

```javascript
export const FAVORITE_COURSES_CACHE_KEY = '@golf_fav_courses_cache';

export async function fetchFavoriteCourseIds() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('favorite_courses')
    .select('course_id')
    .eq('user_id', user.id);
  if (error) throw error;
  const ids = new Set((data ?? []).map((r) => r.course_id));
  // Cache as an array — a Set does not survive JSON serialization.
  AsyncStorage.setItem(FAVORITE_COURSES_CACHE_KEY, JSON.stringify([...ids])).catch(() => {});
  return ids;
}

// Last-known favorite course ids as a Set. Never throws; returns an empty Set
// when nothing is cached or the cache is unreadable.
export async function getCachedFavoriteCourseIds() {
  try {
    const raw = await AsyncStorage.getItem(FAVORITE_COURSES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "favorite courses offline cache"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the whole file to confirm no regressions**

Run: `npx jest src/store/__tests__/libraryStore.test.js`
Expected: PASS — all blocks, including the pre-existing `fetchMyPlayers`, `fetchMyGuestPlayers`, `normalizeCourse`, and `saveCourseTees` tests (the `then` mock addition does not affect chains that end at `.order()`).

- [ ] **Step 6: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "$(cat <<'EOF'
feat: cache favorite course ids for offline picker

Write-through caches favorite course ids (Set serialized to an array)
with a getCachedFavoriteCourseIds reader. Adds a thenable to the test
Supabase mock so an .eq()-terminated chain is awaitable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `loadCourseLibrary` orchestrator

Adds the function the picker will call: tries the network, falls back to the cache, and reports `usingCachedData`. This task also enhances the test's Supabase mock so `.order()` can be made to return an error (to simulate offline).

**Files:**
- Modify: `src/store/libraryStore.js` (new `loadCourseLibrary`, placed after `getCachedFavoriteCourseIds`)
- Test: `src/store/__tests__/libraryStore.test.js` (Supabase mock `order()`; imports; new `describe` block)

- [ ] **Step 1: Enhance the Supabase mock and write the failing test**

In `src/store/__tests__/libraryStore.test.js`, make `.order()` honor an optional error. Change this line inside the `jest.mock('../../lib/supabase', ...)` factory, from:

```javascript
    order() { return Promise.resolve({ data: mockState.rows, error: null }); },
```

to:

```javascript
    order() { return Promise.resolve({ data: mockState.rows, error: mockState.orderError ?? null }); },
```

Extend the `../libraryStore` import to also import `loadCourseLibrary`. The import block becomes:

```javascript
import {
  fetchMyPlayers, fetchMyGuestPlayers, normalizeCourse, saveCourseTees,
  fetchCourses, getCachedCourses, COURSES_CACHE_KEY,
  fetchClubs, getCachedClubs, CLUBS_CACHE_KEY,
  fetchFavoriteCourseIds, getCachedFavoriteCourseIds, FAVORITE_COURSES_CACHE_KEY,
  loadCourseLibrary,
} from '../libraryStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
```

Append this `describe` block to the end of the file:

```javascript
describe('loadCourseLibrary', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.calls = {};
    mockState.orderError = null;
  });

  test('online: returns fetched courses with usingCachedData false', async () => {
    mockState.rows = [
      { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
    ];
    const result = await loadCourseLibrary();
    expect(result.usingCachedData).toBe(false);
    expect(result.courses.map((c) => c.name)).toEqual(['Pine']);
  });

  test('offline: falls back to the cached library with usingCachedData true', async () => {
    mockState.rows = [
      { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
    ];
    await fetchCourses();                          // online — seeds the cache
    mockState.orderError = { message: 'offline' }; // now fetchCourses rejects
    const result = await loadCourseLibrary();
    expect(result.usingCachedData).toBe(true);
    expect(result.courses.map((c) => c.name)).toEqual(['Pine']);
  });

  test('offline with an empty cache: returns no courses, usingCachedData true', async () => {
    mockState.orderError = { message: 'offline' };
    const result = await loadCourseLibrary();
    expect(result.usingCachedData).toBe(true);
    expect(result.courses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "loadCourseLibrary"`
Expected: FAIL — `loadCourseLibrary is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/store/libraryStore.js`, add `loadCourseLibrary` immediately after the `getCachedFavoriteCourseIds` function added in Task 3 (and before the `// Convert Supabase course row → app-friendly shape` comment that precedes `normalizeCourse`):

```javascript
// Loads the course library for the picker. Online, each underlying fetch also
// refreshes its cache. If the course fetch fails (offline), the whole library
// is served from the last-known cache and usingCachedData is true so the
// caller can disable course creation. Never throws.
export async function loadCourseLibrary() {
  try {
    const courses = await fetchCourses();
    const [clubs, favorites] = await Promise.all([
      fetchClubs().catch(() => getCachedClubs()),
      fetchFavoriteCourseIds().catch(() => getCachedFavoriteCourseIds()),
    ]);
    return { courses, clubs, favorites, usingCachedData: false };
  } catch {
    const [courses, clubs, favorites] = await Promise.all([
      getCachedCourses(),
      getCachedClubs(),
      getCachedFavoriteCourseIds(),
    ]);
    return { courses, clubs, favorites, usingCachedData: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/libraryStore.test.js -t "loadCourseLibrary"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the whole file to confirm no regressions**

Run: `npx jest src/store/__tests__/libraryStore.test.js`
Expected: PASS — all blocks. The `orderError ?? null` change is inert for the pre-existing tests, which never set `mockState.orderError`.

- [ ] **Step 6: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "$(cat <<'EOF'
feat: add loadCourseLibrary offline-fallback orchestrator

loadCourseLibrary tries the network and falls back to the cached
library, reporting usingCachedData so callers can disable course
creation offline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `CoursePickerScreen` to the offline fallback

Replaces the inline fetch in the picker's load effect with `loadCourseLibrary()`, tracks `usingCachedData`, and disables the two course-creation controls when the cache is being shown. This task is screen wiring; the offline-fallback logic itself is fully covered by the Task 4 unit tests. Verification is lint plus the full test suite plus a manual smoke check.

**Files:**
- Modify: `src/screens/CoursePickerScreen.js`

- [ ] **Step 1: Swap the libraryStore imports**

Change the import block (currently lines 11-14) from:

```javascript
import {
  fetchCourses, fetchClubs, upsertCourse, defaultHoles, saveCourseHoles,
  fetchFavoriteCourseIds, toggleFavoriteCourse, deleteCourse,
} from '../store/libraryStore';
```

to:

```javascript
import {
  loadCourseLibrary, upsertCourse, defaultHoles, saveCourseHoles,
  toggleFavoriteCourse, deleteCourse,
} from '../store/libraryStore';
```

(`fetchCourses`, `fetchClubs`, and `fetchFavoriteCourseIds` are no longer referenced directly by the screen; leaving them imported would fail the `no-unused-vars` lint rule.)

- [ ] **Step 2: Add the `usingCachedData` state**

Change the `reloadKey` state line (currently line 40) from:

```javascript
  const [reloadKey, setReloadKey] = useState(0);
```

to:

```javascript
  const [reloadKey, setReloadKey] = useState(0);
  // True when the library shown is the offline cache (a course fetch failed).
  // Course creation is disabled in this state — it needs a connection.
  const [usingCachedData, setUsingCachedData] = useState(false);
```

- [ ] **Step 3: Replace the load effect**

Replace the entire `useFocusEffect` block (currently lines 42-68) from:

```javascript
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setLoadError(null);
      // fetchCourses failure is fatal for this screen (no library to show);
      // favorites / tournaments are best-effort and fall back silently.
      fetchCourses()
        .then(async (list) => {
          const [clubList, favs, tournaments] = await Promise.all([
            fetchClubs().catch(() => []),
            fetchFavoriteCourseIds().catch(() => new Set()),
            loadAllTournaments().catch(() => []),
          ]);
          if (cancelled) return;
          setCourses(list);
          setClubs(clubList);
          setFavorites(favs);
          setLastUsed(buildCourseLastUsed(tournaments));
        })
        .catch((err) => {
          if (!cancelled) setLoadError(err?.message ?? 'Could not load courses');
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [reloadKey]),
  );
```

to:

```javascript
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setLoadError(null);
      // loadCourseLibrary never throws: online it fetches fresh (and refreshes
      // the cache); offline it serves the last-known cache and reports
      // usingCachedData. lastUsed comes from local tournaments — best-effort.
      Promise.all([
        loadCourseLibrary(),
        loadAllTournaments().catch(() => []),
      ])
        .then(([library, tournaments]) => {
          if (cancelled) return;
          setCourses(library.courses);
          setClubs(library.clubs);
          setFavorites(library.favorites);
          setLastUsed(buildCourseLastUsed(tournaments));
          setUsingCachedData(library.usingCachedData);
          // The only true error state: offline with nothing cached to show.
          if (library.usingCachedData && library.courses.length === 0) {
            setLoadError('Could not load courses');
          }
        })
        .catch((err) => {
          if (!cancelled) setLoadError(err?.message ?? 'Could not load courses');
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [reloadKey]),
  );
```

- [ ] **Step 4: Disable the "New Course" Add button offline**

Change the Add button (currently line 330) from:

```javascript
          <TouchableOpacity style={s.addBtn} onPress={() => addAndSelect()} disabled={saving || !newName.trim()}>
```

to:

```javascript
          <TouchableOpacity style={s.addBtn} onPress={() => addAndSelect()} disabled={saving || !newName.trim() || usingCachedData}>
```

- [ ] **Step 5: Hide the inline "Create …" CTA offline**

Change the CTA condition inside the no-search-matches branch (currently line 358) from:

```javascript
            {query.trim() ? (
```

to:

```javascript
            {query.trim() && !usingCachedData ? (
```

(`addAndSelect` and `handleCourseLongPress` are intentionally left unchanged. Long-press rename/delete failing offline is pre-existing behavior outside this feature's scope; both controls that *create* a course are now gated.)

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS — no errors. In particular, no `no-unused-vars` for the removed imports.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — the full suite (~500 tests), including the four new `libraryStore` blocks from Tasks 1-4 and the pre-existing screen tests.

- [ ] **Step 8: Manual smoke check**

Run the web build (`npm run web`), open the course picker (Setup → pick a course). With the network connected, confirm the library loads and "Add" is enabled. Then, using browser devtools, set the network to Offline, navigate away from and back into the picker, and confirm: the previously-loaded courses still appear (no error box), the "New Course" Add button is disabled, and the "Create …" CTA does not appear when a search has no matches. Restore the network.

- [ ] **Step 9: Commit**

```bash
git add src/screens/CoursePickerScreen.js
git commit -m "$(cat <<'EOF'
feat: course picker uses cached library when offline

CoursePickerScreen now loads via loadCourseLibrary, which falls back to
the cached library when offline. Course creation (Add button and inline
Create CTA) is disabled while showing cached data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** — every spec requirement maps to a task:

| Spec item | Task |
|---|---|
| `@golf_courses_cache` key + write-through in `fetchCourses` + `getCachedCourses` | Task 1 |
| `@golf_clubs_cache` key + write-through in `fetchClubs` + `getCachedClubs` | Task 2 |
| `@golf_fav_courses_cache` key + write-through in `fetchFavoriteCourseIds` + `getCachedFavoriteCourseIds` (Set serialization) | Task 3 |
| Picker falls back to cache on fetch failure; `usingCachedData` flag | Task 4 (`loadCourseLibrary`) + Task 5 (wiring) |
| `loadError` shown only when fetch failed *and* cache empty | Task 5, Step 3 |
| Course creation disabled offline (Add button + Create CTA) | Task 5, Steps 4-5 |
| `SetupScreen` / `tournamentStore` unchanged | No task touches them — confirmed |
| `libraryStore` tests (write-through, readers present/absent/corrupt, Set round-trip) | Tasks 1-4 |
| Picker offline-fallback behavior (cache populated vs empty) | Covered by `loadCourseLibrary` unit tests (Task 4); screen rendering verified by lint + full suite + manual smoke (Task 5, Steps 6-8) |

**Intentional refinement vs the spec:** the spec described the picker orchestrating the fetch/fallback inline and listed separate `CoursePickerScreen` render tests. This plan extracts that orchestration into `libraryStore.loadCourseLibrary()` so it is unit-testable without a brittle screen-render harness — consistent with `CLAUDE.md` ("keep domain logic in stores, not screens"). The spec's two picker scenarios ("offline with populated cache", "offline with empty cache") are realized as the `loadCourseLibrary` tests in Task 4. The observable behavior in the spec's matrix is unchanged.

**Placeholder scan:** no TBD / TODO / vague steps — every code step shows complete code and every command shows expected output.

**Type consistency:** `loadCourseLibrary` returns `{ courses, clubs, favorites, usingCachedData }` in Task 4; Task 5 destructures exactly those four properties. Cache-key constants (`COURSES_CACHE_KEY`, `CLUBS_CACHE_KEY`, `FAVORITE_COURSES_CACHE_KEY`) and reader names (`getCachedCourses`, `getCachedClubs`, `getCachedFavoriteCourseIds`) are spelled identically across the tasks that define and import them.
