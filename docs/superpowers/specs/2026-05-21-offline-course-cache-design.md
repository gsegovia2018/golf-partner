# Offline Course Cache — Design

**Date:** 2026-05-21
**Status:** Approved — ready for implementation plan

## Problem

Casual games already save and play fully offline: scores, shots, and notes are
written to `AsyncStorage` and replayed against Supabase via the sync queue on
reconnect. But **creating** a casual game offline is broken at one point — course
selection.

`CoursePickerScreen` calls `fetchCourses()` (`libraryStore.js`), which always
hits Supabase. There is no local cache. When offline the fetch throws, the
picker shows an error box, and the user cannot pick a course from their library.
The only offline workaround today is typing a free-text course name in
`SetupScreen`, which produces a round with default par-4 holes and no real
stroke indexes.

This extends `2026-04-19-offline-mode-design.md`, which deliberately listed
"creating a new course offline" as out of scope in v1.

## Goal

Let a user set up a **casual game** fully offline by picking from a locally
cached copy of the course library that was loaded while previously online.

## Scope

**In scope**
- Cache the course library (courses, clubs, favorite course IDs) to
  `AsyncStorage` on every successful fetch.
- `CoursePickerScreen` falls back to the cache when a fetch fails, so the
  library is browsable and selectable offline.

**Out of scope** (explicitly excluded)
- Offline **creation** of brand-new courses. Creating a course offline is
  disabled; it requires a connection. (A future feature could add course
  mutations to the sync queue — not this one.)
- Official tournaments offline. Official tournament/round/roster creation
  writes straight to Supabase and is unaffected by this change.
- Any change to `SetupScreen` or `tournamentStore` — the existing offline
  game-save path already handles a picked course unchanged.

## Approach

Mirror the existing `friendStore` offline-cache pattern. `friendStore.listFriends`
already write-through-caches the accepted friends list to `@golf_friends_cache`
so the Feed degrades to a last-known set offline (`getCachedFriends`). Courses
get the same treatment inside `libraryStore.js`. No new module, no shared
generic helper, no refactor of working code.

## Design

### Store layer — `src/store/libraryStore.js`

New cache keys:
- `@golf_courses_cache`
- `@golf_clubs_cache`
- `@golf_fav_courses_cache`

**Write-through on success.** Each fetch, after a successful Supabase read,
writes its result to the cache fire-and-forget (`AsyncStorage.setItem(...)
.catch(() => {})`), exactly as `friendStore.js:108` does:

- `fetchCourses()` — caches the normalized course list. The normalized shape
  (id, name, slope, rating, `holes`, `tees`, city/province) is exactly what the
  picker's `confirm()` copies into a round, so a cached course is fully
  playable offline.
- `fetchClubs()` — caches the club list so the picker's grouped/club view
  renders identically offline.
- `fetchFavoriteCourseIds()` — caches favorite IDs. The function returns a
  `Set`; it is serialized to an array for storage and rehydrated on read.

**New readers** — each returns last-known data, or an empty value, and never
throws (matching `getCachedFriends`):
- `getCachedCourses()` → array of normalized courses (or `[]`)
- `getCachedClubs()` → array of clubs (or `[]`)
- `getCachedFavoriteCourseIds()` → `Set` of IDs (or empty `Set`)

### Picker layer — `src/screens/CoursePickerScreen.js`

In the `useFocusEffect` loader:

- On `fetchCourses()` failure, instead of going straight to `loadError`, fall
  back to `getCachedCourses()`. Clubs and favorites fall back to
  `getCachedClubs()` / `getCachedFavoriteCourseIds()`, replacing today's
  `.catch(() => [])` and `.catch(() => new Set())`.
- A `usingCachedData` flag is set `true` whenever the fallback path runs.
- `loadError` is shown **only when the fetch failed and the cache is empty**
  (genuine first-run-offline case). This keeps the existing error box and its
  Retry button for the one case where there is truly nothing to show.

**Disabling offline course creation.** When `usingCachedData === true`:
- the "New Course" Add button is disabled;
- the inline "Create …" CTA (shown when a search yields no matches) is hidden.

Per the chosen "minimal, silent" UX: **no offline banner and no explanatory
hint text.** The controls are simply inert. The free-text course-name field in
`SetupScreen` remains the existing fallback for a course not in the cache.

### Unchanged

`SetupScreen`, `tournamentStore`, `syncQueue`, and `merge` need no changes. Once
the picker hands a cached course back through `selectionBridge`, the existing
offline game-save path takes over exactly as it does for an online pick.

## Behavior matrix

| State | Picker library | Course creation |
|---|---|---|
| Online, fetch OK | Live list (also written to cache) | Enabled |
| Offline, cache populated | Cached list shown silently | Disabled |
| Offline, cache empty | Error box with Retry | Disabled (CTA hidden) |

## Known limitations (accepted)

- **Stale data.** A course edited online after caching shows pre-edit holes/SI
  when picked offline. Acceptable for an offline fallback.
- **No live reconnect refresh.** If the user sits on the picker offline and then
  reconnects, course creation stays disabled until they re-enter the screen or
  press Retry. The picker is a pushed screen normally entered fresh, so this is
  a minor edge case.

## Testing

- **`libraryStore`** — unit tests (mock `AsyncStorage`, following existing store
  test style):
  - a successful `fetchCourses` / `fetchClubs` / `fetchFavoriteCourseIds`
    writes the corresponding cache key;
  - `getCachedCourses` / `getCachedClubs` / `getCachedFavoriteCourseIds` return
    last-known data when present and an empty value when absent or corrupt;
  - favorites round-trip correctly through `Set` → array → `Set`.
- **`CoursePickerScreen`** — tests:
  - a failed `fetchCourses` with a populated cache renders the cached courses
    and disables course creation;
  - a failed `fetchCourses` with an empty cache still shows the error box.
