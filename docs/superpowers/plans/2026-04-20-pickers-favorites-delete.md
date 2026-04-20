# Pickers, Favorites & Owner-Only Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add name search, course favorites, recent-use ordering, create-from-search, and restrict tournament delete to owners only.

**Architecture:** Additive. One new Supabase table (`favorite_courses`), one helper module (`src/lib/recentUse.js`), updates to two picker screens, the courses library screen, and `HomeScreen`. No new screens, no new navigation routes.

**Tech Stack:** React Native (Expo), Supabase (PostgREST), AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-04-20-pickers-favorites-delete-design.md`

---

## File Structure

**New:**
- `supabase/migrations/20260420_favorite_courses.sql` — table + RLS policies
- `src/lib/recentUse.js` — pure helpers to derive `{ [id]: timestamp }` from tournament list

**Modified:**
- `src/store/libraryStore.js` — add `fetchFavoriteCourseIds`, `toggleFavoriteCourse`
- `src/screens/PlayerPickerScreen.js` — search, recent-sort, create-from-search CTA
- `src/screens/CoursePickerScreen.js` — search (+city/province), favorites + recent-sort, create-from-search CTA, star toggle
- `src/screens/CoursesLibraryScreen.js` — star toggle next to delete/edit
- `src/screens/HomeScreen.js` — owner-only delete (card + settings menu)

---

## Task 1: Supabase migration — `favorite_courses` table

**Files:**
- Create: `supabase/migrations/20260420_favorite_courses.sql`

- [ ] **Step 1: Write the migration**

```sql
create table favorite_courses (
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references courses(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

alter table favorite_courses enable row level security;

create policy "favorite_courses_select_own"
  on favorite_courses for select
  using (user_id = auth.uid());

create policy "favorite_courses_insert_own"
  on favorite_courses for insert
  with check (user_id = auth.uid());

create policy "favorite_courses_delete_own"
  on favorite_courses for delete
  using (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration locally**

Run (from repo root):

```bash
npx supabase db push
```

Expected: migration listed as applied, no errors.

If the user runs a remote Supabase instead, they will apply this later; that is fine.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420_favorite_courses.sql
git commit -m "supabase: add favorite_courses table with RLS"
```

---

## Task 2: `libraryStore` — favorites helpers

**Files:**
- Modify: `src/store/libraryStore.js` (append after existing course functions, before `normalizeCourse`)

- [ ] **Step 1: Add helpers**

Append to `src/store/libraryStore.js` (right after `updateCourseFromEditor`, before `normalizeCourse`):

```js
// ── Favorite courses ─────────────────────────────────────────────────────────
//
// Per-user toggle. Unauthenticated sessions get an empty favorites set and a
// no-op toggle — the caller remains responsible for rendering a disabled star
// or hiding the control.

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

export async function toggleFavoriteCourse(courseId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { favorite: false };
  const { data: existing, error: selErr } = await supabase
    .from('favorite_courses')
    .select('course_id')
    .eq('user_id', user.id)
    .eq('course_id', courseId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    const { error } = await supabase
      .from('favorite_courses')
      .delete()
      .eq('user_id', user.id)
      .eq('course_id', courseId);
    if (error) throw error;
    return { favorite: false };
  }
  const { error } = await supabase
    .from('favorite_courses')
    .insert({ user_id: user.id, course_id: courseId });
  if (error) throw error;
  return { favorite: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/store/libraryStore.js
git commit -m "libraryStore: add favorite course helpers"
```

---

## Task 3: `recentUse` helper

**Files:**
- Create: `src/lib/recentUse.js`

- [ ] **Step 1: Write the helper**

```js
// Pure helpers that derive a per-id "last used" timestamp from the list of
// tournaments the current user can see. Consumed by the player and course
// pickers to float recently-used entries to the top without persisting any
// extra state server-side.

function parseTime(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function buildPlayerLastUsed(tournaments) {
  const out = {};
  for (const t of tournaments ?? []) {
    const ts = parseTime(t.createdAt);
    for (const p of t.players ?? []) {
      if (!p?.id) continue;
      if ((out[p.id] ?? 0) < ts) out[p.id] = ts;
    }
  }
  return out;
}

export function buildCourseLastUsed(tournaments) {
  const out = {};
  for (const t of tournaments ?? []) {
    const ts = parseTime(t.createdAt);
    for (const r of t.rounds ?? []) {
      if (!r?.courseId) continue;
      if ((out[r.courseId] ?? 0) < ts) out[r.courseId] = ts;
    }
  }
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/recentUse.js
git commit -m "lib: recent-use helpers for pickers"
```

---

## Task 4: `PlayerPickerScreen` — search, recent sort, create-from-search

**Files:**
- Modify: `src/screens/PlayerPickerScreen.js`

- [ ] **Step 1: Update imports**

Replace the current import block (top of file, lines 1–15) with:

```js
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Alert, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { v4 as uuidv4 } from 'uuid';

import { useTheme } from '../theme/ThemeContext';
import { fetchPlayers } from '../store/libraryStore';
import { loadAllTournaments } from '../store/tournamentStore';
import { setPendingPlayers } from '../lib/selectionBridge';
import { buildPlayerLastUsed } from '../lib/recentUse';
import { mutate } from '../store/mutate';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
```

- [ ] **Step 2: Add state and data loading**

Replace the current `useState`/`useFocusEffect` block (roughly lines 24–35) with:

```js
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickedIds, setPickedIds] = useState([]);
  const [newName, setNewName] = useState('');
  const [newHcp, setNewHcp] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [lastUsed, setLastUsed] = useState({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([fetchPlayers(), loadAllTournaments().catch(() => [])])
        .then(([list, tournaments]) => {
          if (cancelled) return;
          setPlayers(list);
          setLastUsed(buildPlayerLastUsed(tournaments));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, []),
  );

  const filteredPlayers = useMemo(() => {
    const q = normalize(query);
    const list = q
      ? players.filter((p) => normalize(p.name).includes(q))
      : players.slice();
    list.sort((a, b) => {
      const ta = lastUsed[a.id] ?? 0;
      const tb = lastUsed[b.id] ?? 0;
      if (ta !== tb) return tb - ta;
      return normalize(a.name).localeCompare(normalize(b.name));
    });
    return list;
  }, [players, query, lastUsed]);
```

- [ ] **Step 3: Add create-from-search handler**

Replace the existing `addAndSelect` function with a version that accepts an optional name/hcp (used both by the form and the CTA):

```js
  async function addAndSelect({ name, handicap } = { name: newName, handicap: newHcp }) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const playerId = uuidv4();
      const hcp = parseInt(handicap, 10) || 0;
      const player = { id: playerId, name: trimmed, handicap: hcp };
      await mutate(null, {
        type: 'player.upsertLibrary',
        playerId,
        name: player.name,
        handicap: hcp,
      });
      setPlayers((prev) => [...prev, player]);
      setNewName('');
      setNewHcp('');
      setQuery('');
      setPickedIds((prev) => {
        if (prev.length >= maxSelectable) return prev;
        return [...prev, player.id];
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Add search bar + create CTA in the render**

Inside the `ScrollView`, before `<Text style={s.sectionTitle}>New Player</Text>`, insert:

```jsx
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search players"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} style={s.searchClear} activeOpacity={0.7}>
              <Feather name="x" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
```

Replace the current "Library" rendering block (from `<Text style={s.sectionTitle}>Library</Text>` down to the closing `)}` of the map) with:

```jsx
        <Text style={s.sectionTitle}>Library</Text>
        {loading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
        ) : players.length === 0 ? (
          <Text style={s.empty}>No players in library yet.</Text>
        ) : filteredPlayers.length === 0 ? (
          <>
            <Text style={s.empty}>No players match "{query}"</Text>
            {query.trim() ? (
              <TouchableOpacity
                style={s.createCta}
                onPress={() => addAndSelect({ name: query, handicap: 0 })}
                disabled={saving || pickedIds.length >= maxSelectable}
                activeOpacity={0.7}
              >
                <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.createCtaText}>Create "{query.trim()}"</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          filteredPlayers.map((p) => {
            const alreadyAdded = alreadySelectedIds.includes(p.id);
            const picked = pickedIds.includes(p.id);
            const disabled = alreadyAdded || (!picked && pickedIds.length >= maxSelectable);
            return (
              <View key={p.id}>
                <TouchableOpacity
                  style={[s.row, alreadyAdded && s.rowAdded, picked && s.rowPicked]}
                  onPress={() => !alreadyAdded && togglePlayer(p)}
                  disabled={alreadyAdded}
                  activeOpacity={disabled ? 1 : 0.7}
                >
                  <View style={s.pickerAvatar}>
                    {p.avatar_url
                      ? <Image source={{ uri: p.avatar_url }} style={s.pickerAvatarImg} />
                      : <Text style={s.pickerAvatarText}>{(p.name ?? '?').slice(0, 2).toUpperCase()}</Text>}
                  </View>
                  <View style={s.rowLeft}>
                    <Text style={[s.playerName, alreadyAdded && s.textMuted]}>{p.name}</Text>
                    <Text style={s.hcpLabel}>HCP {p.handicap}</Text>
                  </View>
                  {alreadyAdded
                    ? <Text style={s.addedBadge}>Added</Text>
                    : picked
                      ? (
                        <View style={s.checkCircle}>
                          <Feather name="check" size={14} color={theme.text.inverse} />
                        </View>
                      )
                      : <View style={s.emptyCircle} />}
                </TouchableOpacity>
              </View>
            );
          })
        )}
```

Note: the existing "New Player" form (the `<Text style={s.sectionTitle}>New Player</Text>` block) stays exactly where it is, unchanged.

- [ ] **Step 5: Add styles**

In the `makeStyles` at the bottom of the file, add these keys (before the closing `});`):

```js
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 12, marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 4,
    color: theme.text.primary, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  createCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.accent.primary + '40', borderStyle: 'dashed',
    backgroundColor: theme.accent.light,
    padding: 14, marginTop: 8,
  },
  createCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.accent.primary, fontSize: 14,
  },
```

- [ ] **Step 6: Manual smoke test**

Start the dev server and open the Player Picker:

```bash
npx expo start --web
```

Verify:
- Empty query shows every player, recent ones on top.
- Typing filters the list live.
- × clears the query.
- Typing a name that doesn't exist shows "Create '<name>'" — tap creates + auto-selects.

- [ ] **Step 7: Commit**

```bash
git add src/screens/PlayerPickerScreen.js
git commit -m "PlayerPicker: search, recent-use sort, create-from-search"
```

---

## Task 5: `CoursePickerScreen` — search, favorites, recent sort, create-from-search

**Files:**
- Modify: `src/screens/CoursePickerScreen.js`

- [ ] **Step 1: Update imports**

Replace the top import block (lines 1–12) with:

```js
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  fetchCourses, upsertCourse, defaultHoles, saveCourseHoles,
  fetchFavoriteCourseIds, toggleFavoriteCourse,
} from '../store/libraryStore';
import { loadAllTournaments } from '../store/tournamentStore';
import { setPendingCourses } from '../lib/selectionBridge';
import { buildCourseLastUsed } from '../lib/recentUse';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
```

- [ ] **Step 2: Add state and loading logic**

Replace the state block and `useFocusEffect` (lines ~18–31) with:

```js
  const { roundIndex } = route.params;

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => new Set());
  const [lastUsed, setLastUsed] = useState({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([
        fetchCourses(),
        fetchFavoriteCourseIds().catch(() => new Set()),
        loadAllTournaments().catch(() => []),
      ])
        .then(([list, favs, tournaments]) => {
          if (cancelled) return;
          setCourses(list);
          setFavorites(favs);
          setLastUsed(buildCourseLastUsed(tournaments));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, []),
  );

  const filteredCourses = useMemo(() => {
    const q = normalize(query);
    const base = q
      ? courses.filter((c) =>
          normalize(c.name).includes(q) ||
          normalize(c.city).includes(q) ||
          normalize(c.province).includes(q))
      : courses.slice();
    base.sort((a, b) => {
      const fa = favorites.has(a.id) ? 1 : 0;
      const fb = favorites.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const ta = lastUsed[a.id] ?? 0;
      const tb = lastUsed[b.id] ?? 0;
      if (ta !== tb) return tb - ta;
      return normalize(a.name).localeCompare(normalize(b.name));
    });
    return base;
  }, [courses, query, favorites, lastUsed]);
```

- [ ] **Step 3: Add favorite toggle and update add-and-select**

Replace the existing `addAndSelect` and add `handleToggleFavorite` after `toggleCourse`:

```js
  async function handleToggleFavorite(courseId) {
    const prev = favorites;
    const next = new Set(prev);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    setFavorites(next);
    try {
      await toggleFavoriteCourse(courseId);
    } catch (err) {
      setFavorites(prev);
      Alert.alert('Error', err.message ?? 'Could not update favorite');
    }
  }

  async function addAndSelect(rawName = newName) {
    const trimmed = (rawName ?? '').trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const holes = defaultHoles();
      const course = await upsertCourse({ name: trimmed, slope: null });
      await saveCourseHoles(course.id, holes);
      const full = { ...course, holes };
      setCourses((prev) => [...prev, full]);
      setNewName('');
      setQuery('');
      setSelectedCourses((prev) => [...prev, full]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Add search bar + create CTA + star in render**

Inside the `ScrollView`, insert this block before `<Text style={s.sectionTitle}>New Course</Text>`:

```jsx
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search name, city or region"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} style={s.searchClear} activeOpacity={0.7}>
              <Feather name="x" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
```

Replace the Library rendering block (from `<Text style={s.sectionTitle}>Library</Text>` down through the closing `)}` of the map) with:

```jsx
        <Text style={s.sectionTitle}>Library</Text>
        {loading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
        ) : courses.length === 0 ? (
          <Text style={s.empty}>No courses in library yet.</Text>
        ) : filteredCourses.length === 0 ? (
          <>
            <Text style={s.empty}>No courses match "{query}"</Text>
            {query.trim() ? (
              <TouchableOpacity
                style={s.createCta}
                onPress={() => addAndSelect(query)}
                disabled={saving}
                activeOpacity={0.7}
              >
                <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.createCtaText}>Create "{query.trim()}"</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          filteredCourses.map((c) => {
            const selIdx = selectedCourses.findIndex((sc) => sc.id === c.id);
            const isPicked = selIdx !== -1;
            const isFavorite = favorites.has(c.id);
            return (
              <View key={c.id} style={[s.row, isPicked && s.rowPicked]}>
                <TouchableOpacity
                  style={s.rowLeft}
                  onPress={() => toggleCourse({ id: c.id, name: c.name, slope: c.slope, holes: c.holes.length === 18 ? c.holes : defaultHoles() })}
                  activeOpacity={0.7}
                >
                  <Text style={s.courseName}>{c.name}</Text>
                  <Text style={s.courseMeta}>
                    Par {c.holes.reduce((sum, h) => sum + h.par, 0)}
                    {c.slope ? `  ·  Slope ${c.slope}` : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.favBtn}
                  onPress={() => handleToggleFavorite(c.id)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather
                    name="star"
                    size={18}
                    color={isFavorite ? theme.accent.primary : theme.text.muted}
                  />
                </TouchableOpacity>
                {isPicked
                  ? (
                    <View style={s.orderBadge}>
                      <Text style={s.orderBadgeText}>{selIdx + 1}</Text>
                    </View>
                  )
                  : <View style={s.emptyCircle} />}
              </View>
            );
          })
        )}
```

Note: the row is no longer the `TouchableOpacity`; the inner `rowLeft` handles selection so the star tap stays isolated.

- [ ] **Step 5: Add/update styles**

In `makeStyles`, add these keys:

```js
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 12, marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 4,
    color: theme.text.primary, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  favBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  createCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.accent.primary + '40', borderStyle: 'dashed',
    backgroundColor: theme.accent.light,
    padding: 14, marginTop: 8,
  },
  createCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.accent.primary, fontSize: 14,
  },
```

- [ ] **Step 6: Manual smoke test**

With the dev server running, open the Course Picker:

- Search by partial city name — courses filter.
- Tap star on a course — icon turns accent color; reload (pull-to-refresh not required, just navigate away and back) — favorite persists.
- Favorites appear at the top.
- Typing an unknown name → "Create '<name>'" CTA → creates + auto-selects.

- [ ] **Step 7: Commit**

```bash
git add src/screens/CoursePickerScreen.js
git commit -m "CoursePicker: search, favorites, recent-use sort, create-from-search"
```

---

## Task 6: `CoursesLibraryScreen` — star toggle

**Files:**
- Modify: `src/screens/CoursesLibraryScreen.js`

- [ ] **Step 1: Load favorites and add toggle**

In the imports, add `fetchFavoriteCourseIds, toggleFavoriteCourse`:

```js
import {
  deleteCourse, fetchCourses, upsertCourse,
  fetchFavoriteCourseIds, toggleFavoriteCourse,
} from '../store/libraryStore';
```

Add a `favorites` state just under the existing state (after `const [query, setQuery] = useState('');`):

```js
  const [favorites, setFavorites] = useState(() => new Set());
```

Replace the `load()` function with:

```js
  async function load() {
    setLoading(true);
    try {
      const [list, favs] = await Promise.all([
        fetchCourses(),
        fetchFavoriteCourseIds().catch(() => new Set()),
      ]);
      setCourses(list);
      setFavorites(favs);
    } finally {
      setLoading(false);
    }
  }
```

Add `handleToggleFavorite` alongside `remove`:

```js
  async function handleToggleFavorite(courseId) {
    const prev = favorites;
    const next = new Set(prev);
    if (next.has(courseId)) next.delete(courseId); else next.add(courseId);
    setFavorites(next);
    try {
      await toggleFavoriteCourse(courseId);
    } catch (err) {
      setFavorites(prev);
      if (Platform.OS === 'web') window.alert(err.message ?? 'Could not update favorite');
      else Alert.alert('Error', err.message ?? 'Could not update favorite');
    }
  }
```

- [ ] **Step 2: Add the star button in each row**

Inside the row render (before the `editBtn` `TouchableOpacity`), insert:

```jsx
                  <TouchableOpacity
                    style={s.favBtn}
                    onPress={() => handleToggleFavorite(c.id)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather
                      name="star"
                      size={16}
                      color={favorites.has(c.id) ? theme.accent.primary : theme.text.muted}
                    />
                  </TouchableOpacity>
```

Add the style in `makeStyles`:

```js
  favBtn: { paddingHorizontal: 10, paddingVertical: 6 },
```

- [ ] **Step 3: Manual smoke test**

Open Courses in the app, tap a star. Navigate away and back. Star state persists.

- [ ] **Step 4: Commit**

```bash
git add src/screens/CoursesLibraryScreen.js
git commit -m "CoursesLibrary: add favorite star toggle"
```

---

## Task 7: `HomeScreen` — owner-only delete

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Gate the card delete button**

Around line 497, change:

```jsx
                {t._role !== 'viewer' && (
                  <TouchableOpacity style={s.deleteCardBtn} onPress={() => confirmDelete(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Feather name="trash-2" size={14} color={theme.destructive} />
                  </TouchableOpacity>
                )}
```

to:

```jsx
                {t._role === 'owner' && (
                  <TouchableOpacity style={s.deleteCardBtn} onPress={() => confirmDelete(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Feather name="trash-2" size={14} color={theme.destructive} />
                  </TouchableOpacity>
                )}
```

- [ ] **Step 2: Gate the settings-menu delete item**

Near line 380 (where `const isViewer = tournament?._role === 'viewer';` already exists), add:

```js
  const isOwner = tournament?._role === 'owner';
```

Around line 1139, change:

```jsx
          {!isViewer && (
            <TouchableOpacity
              style={[s.menuItem, s.menuItemDestructive]}
              onPress={() => { setShowSettings(false); confirmDelete(tournament); }}
              activeOpacity={0.7}
            >
              <Feather name="trash-2" size={18} color={theme.destructive} />
              <Text style={[s.menuItemText, { color: theme.destructive }]}>Delete Tournament</Text>
            </TouchableOpacity>
          )}
```

to:

```jsx
          {isOwner && (
            <TouchableOpacity
              style={[s.menuItem, s.menuItemDestructive]}
              onPress={() => { setShowSettings(false); confirmDelete(tournament); }}
              activeOpacity={0.7}
            >
              <Feather name="trash-2" size={18} color={theme.destructive} />
              <Text style={[s.menuItemText, { color: theme.destructive }]}>Delete Tournament</Text>
            </TouchableOpacity>
          )}
```

- [ ] **Step 3: Manual smoke test**

Sign in as an editor user (join via editor invite), and verify:
- No trash icon on tournament/game cards for tournaments you only edit.
- Settings sheet does not show "Delete Tournament".
- Edit Tournament still works.

Sign in as owner and verify delete still works from both entry points.

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "HomeScreen: restrict tournament/game delete to owners"
```

---

## Task 8: Final end-to-end smoke test

- [ ] **Step 1: Full flow on web**

```bash
npx expo start --web
```

Exercise:
1. Create a tournament, pick 4 players with search, pick 3 courses (star 1), complete setup.
2. Return to Home → list shows the new tournament with delete icon (you are owner).
3. Open the Course Picker again → starred course is at the top; the players you just used are at the top of the Player Picker.
4. Type a random name in a picker — "Create '<name>'" CTA appears → creates + selects → CTA disappears.
5. Generate an editor invite, join via second account/browser, verify no delete buttons on that account.

- [ ] **Step 2: Type-check / lint (optional — repo has no formal script)**

None configured in this repo; skip.

- [ ] **Step 3: Final commit if any follow-up fixes were needed**

If smoke-test issues surfaced and you had to patch something, commit separately:

```bash
git status
git add -p
git commit -m "fix: <specific issue>"
```

---

## Self-review

- [x] Spec coverage — every spec section maps to at least one task (table → T1, helpers → T2, recentUse → T3, player search/create → T4, course search/favorites/create → T5, library star → T6, delete gate → T7).
- [x] No placeholders — every step has concrete code or an exact command.
- [x] Type consistency — `fetchFavoriteCourseIds`, `toggleFavoriteCourse`, `buildPlayerLastUsed`, `buildCourseLastUsed` names are consistent across tasks.
- [x] Scope matches one implementation session.
