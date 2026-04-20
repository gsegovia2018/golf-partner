# Pickers, Course Favorites & Owner-Only Delete — Design

Date: 2026-04-20
Branch: `worktree-fix-ui`

## Purpose

Speed up tournament/game creation and protect against accidental deletion:

1. Searchable player and course pickers
2. Per-user course favorites (synced via Supabase)
3. Recent-use sorting in pickers
4. "Create '<query>'" CTA when search has no match
5. Delete restricted to tournament owners (not editors)

## Scope

In scope:
- `src/screens/PlayerPickerScreen.js`
- `src/screens/CoursePickerScreen.js`
- `src/screens/CoursesLibraryScreen.js` (star toggle)
- `src/screens/HomeScreen.js` (delete gate)
- `src/store/libraryStore.js` (favorites helpers)
- New migration `supabase/migrations/20260420_favorite_courses.sql`

Out of scope (deferred):
- Saved player groups
- Tournament archiving
- Undo-delete snackbar
- Explicit city/province filter UI

## Architecture

No new screens. No new global state. Changes are additive:

- A single `favorite_courses` row per (user, course).
- Recent-use is **derived on the client** at picker-open from tournaments the user already fetches; no new persistence.
- Search state is local to each picker screen.

### Data model — new table

```sql
create table favorite_courses (
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references courses(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);
alter table favorite_courses enable row level security;
create policy "own favorites select" on favorite_courses
  for select using (user_id = auth.uid());
create policy "own favorites insert" on favorite_courses
  for insert with check (user_id = auth.uid());
create policy "own favorites delete" on favorite_courses
  for delete using (user_id = auth.uid());
```

### libraryStore additions

```js
export async function fetchFavoriteCourseIds() { /* returns Set<string> */ }
export async function toggleFavoriteCourse(courseId) { /* inserts or deletes */ }
```

`toggleFavoriteCourse` reads the current state first (single-row select) and then inserts or deletes — acceptable for this scale (dozens of rows).

### Recent-use derivation

Helper in a new `src/lib/recentUse.js`:

```js
// Builds { [id]: timestamp } from tournament list.
export function buildPlayerLastUsed(tournaments) { /* ... */ }
export function buildCourseLastUsed(tournaments) { /* ... */ }
```

Pickers call `listTournaments()` (already used in `HomeScreen`) alongside their existing `fetchPlayers`/`fetchCourses` via `Promise.all`. Sort order:

**Players:**
1. `lastUsedAt` desc
2. Never-used, alphabetical

**Courses:**
1. Favorites (alphabetical within)
2. Non-favorites with `lastUsedAt`, desc
3. Non-favorites never-used, alphabetical

Favorites stay on top regardless of recency — the two signals coexist.

### Search

Top of each picker's `ScrollView`, above the "New" form:

```jsx
<View style={s.searchBar}>
  <Feather name="search" ... />
  <TextInput value={query} onChangeText={setQuery} placeholder="Search..." />
  {query ? <TouchableOpacity onPress={() => setQuery('')}><Feather name="x" /></TouchableOpacity> : null}
</View>
```

Normalization:

```js
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
```

Filter predicates:
- Player: `norm(name).includes(norm(query))`
- Course: `norm(name).includes(q) || norm(city).includes(q) || norm(province).includes(q)`

### Create-from-search CTA

Only rendered when `query.trim().length > 0 && filtered.length === 0`.

```jsx
<TouchableOpacity style={s.createCta} onPress={createFromQuery}>
  <Feather name="plus-circle" />
  <Text>Create "{query.trim()}"</Text>
</TouchableOpacity>
```

Behavior:
- **Player picker:** call existing `addAndSelect`-like path with `name=query, handicap=0`, clear `query`.
- **Course picker:** call existing `addAndSelect` path with `name=query`, clear `query`.

Both reuse the current `mutate`/`upsertCourse` flow — no new writers.

### Favorite star (Course picker & Library)

A small ⭐ button on the right side of each course row. Tap does NOT toggle selection — `onPress` is isolated via `stopPropagation` equivalent (own `TouchableOpacity`, not a child of the row's touchable).

State is a local `Set` of IDs; `toggleFavoriteCourse` is fire-and-forget with optimistic update + revert on error.

### Delete gate

`src/screens/HomeScreen.js`:

- Line 497 (card delete button): `t._role !== 'viewer'` → `t._role === 'owner'`
- Line 1139 (settings menu item): `!isViewer` → `tournament?._role === 'owner'`

A new local `const isOwner = tournament?._role === 'owner'` next to the existing `isViewer` for readability.

Editors keep `Edit Tournament`.

## User Flows

### New Tournament — fast path

1. Tap "New Tournament" → SetupScreen
2. Tap "Add Player from Library" → PlayerPicker loads with 4 regulars at top (recent-use)
3. Type "lu" → Luis filters in, tap → select
4. Confirm → back to SetupScreen
5. Tap "Pick Course from Library" → CoursePicker shows ⭐ favorites on top
6. Type name of a course not in library → "Create '...'" CTA → tap → auto-selected
7. Confirm → back to SetupScreen → Start

### Non-owner attempts delete

Delete button/menu item is not rendered. No error state to handle.

## Testing

Manual (no automated test infra for UI in this repo):

1. Pickers with empty query behave like today (regression check).
2. Search filters, clears with × button, create-from-search only appears when no matches.
3. Favorites persist across app reloads and across devices (two auth sessions, same user).
4. Ordering: after creating a tournament with player X, X is at the top of the next picker open.
5. Editor account: delete icon absent on card and in settings menu; edit still works.
6. Owner account: delete still works.

## Migration & Rollback

- Migration is additive (new table). Rollback: `drop table favorite_courses;`.
- No existing data touched.

## Self-review notes

- All requirements concrete (no TBD).
- Recent-use derivation is deliberately client-side to avoid a new table; acceptable at current scale (≤4 players, small course library).
- Favorites and recent-use are combined as documented; no contradiction.
- Scope matches one implementation session.
