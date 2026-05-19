# Clubs & Course Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group golf course layouts under their club, so the course picker becomes a two-step pick (club → layout), and import the Madrid courses with that grouping.

**Architecture:** A new `clubs` table plus two nullable columns on `courses` (`club_id`, `layout_name`). `courses.name` stays the full display name — non-breaking for every screen that renders it. The picker stays one screen; multi-layout clubs render as an inline accordion. Grouping/sorting/filtering logic lives in a new pure module `src/lib/courseLibrary.js` so it can be unit-tested. The Madrid import script is extended to create clubs and set `club_id`/`layout_name`.

**Tech Stack:** Supabase Postgres + RLS, React Native / Expo, Jest (`jest-expo`), CommonJS scripts, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-05-19-clubs-and-layouts-design.md`

---

## File Structure

- **Create** `supabase/migrations/20260519000000_clubs.sql` — `clubs` table + RLS, two `courses` columns.
- **Create** `src/lib/courseLibrary.js` — pure helpers: `normalizeText`, `buildCourseLibraryItems`, `filterCourseLibraryItems`. No I/O.
- **Create** `src/lib/__tests__/courseLibrary.test.js` — unit tests for those helpers.
- **Modify** `scripts/lib/madridCourses.js` — add `deriveLayoutName`.
- **Modify** `scripts/__tests__/madridCourses.test.js` — test `deriveLayoutName`.
- **Modify** `src/store/libraryStore.js` — `normalizeCourse` exposes `clubId`/`layoutName`; new `fetchClubs`; `upsertCourse` accepts club fields.
- **Modify** `src/screens/CoursePickerScreen.js` — accordion grouping built from `courseLibrary.js`.
- **Modify** `scripts/importMadridCourses.js` — create clubs, set `club_id`/`layout_name`.
- **Modify** `scripts/data/madrid-courses.json` — trim to 58 courses (operational task).

---

## Task 1: Database migration — `clubs` table + `courses` columns

**Files:**
- Create: `supabase/migrations/20260519000000_clubs.sql`

No automated test — SQL migration. It is created and committed here; it is applied to the database in Task 7.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260519000000_clubs.sql`:

```sql
-- A golf club groups several course layouts (e.g. La Moraleja → Campo 1-4
-- plus a Pitch & Putt). A course optionally belongs to a club; existing and
-- standalone courses keep club_id null and behave exactly as before.

CREATE TABLE IF NOT EXISTS public.clubs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  city        text,
  province    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

-- The course library is shared/collaborative — any signed-in user may read
-- and edit it. Mirrors the course_tees policies
-- (migration 20260518000003_course_tees.sql).
DROP POLICY IF EXISTS "clubs_select" ON public.clubs;
CREATE POLICY "clubs_select"
  ON public.clubs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "clubs_write" ON public.clubs;
CREATE POLICY "clubs_write"
  ON public.clubs FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- A course optionally belongs to a club. ON DELETE SET NULL: deleting a club
-- leaves its courses standalone rather than destroying them.
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL;

-- Short layout label shown inside a club's expanded list (e.g. "Campo 1").
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS layout_name text;

CREATE INDEX IF NOT EXISTS courses_club_id_idx ON public.courses (club_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260519000000_clubs.sql
git commit -m "feat: clubs table and courses club_id/layout_name columns"
```

---

## Task 2: Helper — `deriveLayoutName`

**Files:**
- Modify: `scripts/lib/madridCourses.js`
- Test: `scripts/__tests__/madridCourses.test.js`

`scripts/lib/madridCourses.js` already exports `CLUBS`, `decodeEntities`, `parseTrazadoOptions`, `deriveCourseName`, `buildHoles`, `validateStrokeIndex`, `numOrNull`, `buildTeeRows`. This adds one more helper.

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/madridCourses.test.js`:

```js
const { deriveLayoutName } = require('../lib/madridCourses');

describe('deriveLayoutName', () => {
  test('returns the text after the last " - "', () => {
    expect(deriveLayoutName('LA MORALEJA - Campo 1')).toBe('Campo 1');
  });

  test('decodes HTML entities', () => {
    expect(deriveLayoutName('CC VILLA DE MADRID - P&amp;P')).toBe('P&P');
  });

  test('no " - " separator → whole trimmed text', () => {
    expect(deriveLayoutName('  BARBERAN Y COLLAR  ')).toBe('BARBERAN Y COLLAR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest scripts/__tests__/madridCourses.test.js -t deriveLayoutName`
Expected: FAIL — `deriveLayoutName is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `scripts/lib/madridCourses.js`, add this function above `module.exports`:

```js
// The short layout label for a trazado: the text after the last " - " in the
// option text ("LA MORALEJA - Campo 1" → "Campo 1"), or the whole trimmed
// text when there is no " - ". HTML-entity decoded.
function deriveLayoutName(trazadoText) {
  const decoded = decodeEntities(trazadoText).trim();
  const idx = decoded.lastIndexOf(' - ');
  return idx >= 0 ? decoded.slice(idx + 3).trim() : decoded;
}
```

Update `module.exports` to add `deriveLayoutName`:

```js
module.exports = {
  CLUBS, decodeEntities, parseTrazadoOptions, deriveCourseName,
  buildHoles, validateStrokeIndex, numOrNull, buildTeeRows, deriveLayoutName,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest scripts/__tests__/madridCourses.test.js`
Expected: PASS — all tests pass (the prior 19 plus 3 new = 22).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/madridCourses.js scripts/__tests__/madridCourses.test.js
git commit -m "feat: deriveLayoutName helper for Madrid courses"
```

---

## Task 3: Pure module — `courseLibrary.js` (grouping, sorting, filtering)

**Files:**
- Create: `src/lib/courseLibrary.js`
- Test: `src/lib/__tests__/courseLibrary.test.js`

This is the pure logic the picker uses to turn flat `courses` + `clubs` lists into a grouped, sorted, searchable item list. ESM (matches `src/`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/courseLibrary.test.js`:

```js
import {
  normalizeText, buildCourseLibraryItems, filterCourseLibraryItems,
} from '../courseLibrary';

const course = (id, name, extra = {}) => ({
  id, name, slope: null, holes: [], city: null, province: null,
  clubId: null, layoutName: null, ...extra,
});

describe('normalizeText', () => {
  test('lowercases and strips diacritics', () => {
    expect(normalizeText('Herrería')).toBe('herreria');
  });
  test('nullish → empty string', () => {
    expect(normalizeText(null)).toBe('');
  });
});

describe('buildCourseLibraryItems', () => {
  test('standalone course → course item', () => {
    const items = buildCourseLibraryItems([course('c1', 'Pine Valley')], []);
    expect(items).toEqual([{ kind: 'course', course: expect.objectContaining({ id: 'c1' }) }]);
  });

  test('club with 2+ layouts → club item; single-layout club → course item', () => {
    const courses = [
      course('a', 'Moraleja — Campo 1', { clubId: 'm', layoutName: 'Campo 1' }),
      course('b', 'Moraleja — Campo 2', { clubId: 'm', layoutName: 'Campo 2' }),
      course('c', 'Herreria', { clubId: 'h', layoutName: 'Herreria' }),
    ];
    const clubs = [
      { id: 'm', name: 'La Moraleja' },
      { id: 'h', name: 'La Herreria' },
    ];
    const items = buildCourseLibraryItems(courses, clubs);
    const club = items.find((i) => i.kind === 'club');
    const single = items.find((i) => i.kind === 'course');
    expect(club.club.id).toBe('m');
    expect(club.layouts.map((l) => l.id)).toEqual(['a', 'b']);
    expect(single.course.id).toBe('c');
  });

  test('course whose clubId has no matching club falls back to a course item', () => {
    const items = buildCourseLibraryItems(
      [course('x', 'Orphan', { clubId: 'gone' })], []);
    expect(items).toEqual([{ kind: 'course', course: expect.objectContaining({ id: 'x' }) }]);
  });

  test('favorited standalone courses sort before others', () => {
    const items = buildCourseLibraryItems(
      [course('z', 'Zeta'), course('a', 'Alpha')], [], new Set(['z']));
    expect(items.map((i) => i.course.id)).toEqual(['z', 'a']);
  });
});

describe('filterCourseLibraryItems', () => {
  const items = [
    { kind: 'course', course: course('c1', 'Pine Valley', { city: 'Madrid' }) },
    {
      kind: 'club',
      club: { id: 'm', name: 'La Moraleja', city: null, province: null },
      layouts: [
        course('a', 'Moraleja — Campo 1', { clubId: 'm', layoutName: 'Campo 1' }),
        course('b', 'Moraleja — Campo 2', { clubId: 'm', layoutName: 'Campo 2' }),
      ],
    },
  ];

  test('empty query → unchanged', () => {
    expect(filterCourseLibraryItems(items, '')).toBe(items);
  });

  test('club-name match keeps the club with all layouts', () => {
    const out = filterCourseLibraryItems(items, 'moraleja');
    expect(out).toHaveLength(1);
    expect(out[0].layouts).toHaveLength(2);
  });

  test('layout-name match keeps only matching layouts', () => {
    const out = filterCourseLibraryItems(items, 'campo 1');
    expect(out).toHaveLength(1);
    expect(out[0].layouts.map((l) => l.id)).toEqual(['a']);
  });

  test('standalone course matched by city', () => {
    const out = filterCourseLibraryItems(items, 'madrid');
    expect(out.map((i) => i.kind)).toEqual(['course']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/__tests__/courseLibrary.test.js`
Expected: FAIL — `Cannot find module '../courseLibrary'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/courseLibrary.js`:

```js
// Pure helpers that turn the flat `courses` + `clubs` lists into the grouped,
// sorted, searchable item list the course picker renders. No I/O, no React —
// unit-tested in isolation.
//
// An "item" is one of:
//   { kind: 'course', course }                 — standalone or single-layout
//   { kind: 'club', club, layouts: course[] }   — a club with 2+ layouts

// Lowercase + strip diacritics, for accent-insensitive search/sort.
export function normalizeText(value) {
  return (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Sort key for a course: favorites first, then most-recently-used, then name.
function courseSortKey(course, favorites, lastUsed) {
  return {
    fav: favorites.has(course.id) ? 0 : 1,
    used: lastUsed[course.id] ?? 0,
    name: normalizeText(course.name),
  };
}

function compareKeys(a, b) {
  if (a.fav !== b.fav) return a.fav - b.fav;
  if (a.used !== b.used) return b.used - a.used;
  return a.name.localeCompare(b.name);
}

// Group courses under their clubs. A club with one layout, an orphan course
// (clubId with no matching club), and any standalone course all become plain
// course items. `favorites` is a Set of favorited course ids; `lastUsed` maps
// course id → timestamp.
export function buildCourseLibraryItems(courses, clubs, favorites = new Set(), lastUsed = {}) {
  const byClub = new Map();
  const standalone = [];
  for (const course of courses) {
    if (course.clubId) {
      if (!byClub.has(course.clubId)) byClub.set(course.clubId, []);
      byClub.get(course.clubId).push(course);
    } else {
      standalone.push(course);
    }
  }

  const items = standalone.map((course) => ({ kind: 'course', course }));

  const knownClubIds = new Set();
  for (const club of clubs) {
    knownClubIds.add(club.id);
    const layouts = byClub.get(club.id) ?? [];
    if (layouts.length === 0) continue;            // empty club — nothing to show
    if (layouts.length === 1) {
      items.push({ kind: 'course', course: layouts[0] });
      continue;
    }
    layouts.sort((a, b) =>
      compareKeys(courseSortKey(a, favorites, lastUsed),
                  courseSortKey(b, favorites, lastUsed)));
    items.push({ kind: 'club', club, layouts });
  }

  // Orphan courses (clubId set, club not in `clubs`) — keep them visible.
  for (const [clubId, layouts] of byClub) {
    if (knownClubIds.has(clubId)) continue;
    for (const course of layouts) items.push({ kind: 'course', course });
  }

  // Top-level sort. A club is never favorite-first; it uses the most recent
  // of its layouts so a recently-played club still floats up.
  const itemKey = (item) => {
    if (item.kind === 'course') return courseSortKey(item.course, favorites, lastUsed);
    const used = item.layouts.reduce((m, c) => Math.max(m, lastUsed[c.id] ?? 0), 0);
    return { fav: 1, used, name: normalizeText(item.club.name) };
  };
  items.sort((a, b) => compareKeys(itemKey(a), itemKey(b)));
  return items;
}

// Filter built items by a search query. Matches club name, layout/course name,
// city and province. A club whose name matches keeps all layouts; otherwise
// only its matching layouts are kept. Empty query returns the input unchanged.
export function filterCourseLibraryItems(items, query) {
  const q = normalizeText(query);
  if (!q) return items;
  const courseMatches = (c) =>
    normalizeText(c.name).includes(q) ||
    normalizeText(c.layoutName).includes(q) ||
    normalizeText(c.city).includes(q) ||
    normalizeText(c.province).includes(q);
  const out = [];
  for (const item of items) {
    if (item.kind === 'course') {
      if (courseMatches(item.course)) out.push(item);
      continue;
    }
    const clubHit =
      normalizeText(item.club.name).includes(q) ||
      normalizeText(item.club.city).includes(q) ||
      normalizeText(item.club.province).includes(q);
    if (clubHit) { out.push(item); continue; }
    const layouts = item.layouts.filter(courseMatches);
    if (layouts.length) out.push({ ...item, layouts });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/__tests__/courseLibrary.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/courseLibrary.js src/lib/__tests__/courseLibrary.test.js
git commit -m "feat: courseLibrary — group/sort/filter courses by club"
```

---

## Task 4: `libraryStore.js` — expose club fields, add `fetchClubs`

**Files:**
- Modify: `src/store/libraryStore.js`

`libraryStore.js` does Supabase I/O and is not unit-tested in this repo. Verified by running the full test suite (no regressions) and by Task 7's app check.

- [ ] **Step 1: Add `clubId` / `layoutName` to `normalizeCourse`**

In `src/store/libraryStore.js`, the `normalizeCourse` function returns an object starting with `id`, `name`, `slope`, `rating`, `city`, `province`. Add the two club fields. Find:

```js
  return {
    id: c.id,
    name: c.name,
    slope: c.slope,    // legacy course-level fields, kept for back-compat reads
    rating: c.rating,
    city: c.city,
    province: c.province,
```

Replace with:

```js
  return {
    id: c.id,
    name: c.name,
    slope: c.slope,    // legacy course-level fields, kept for back-compat reads
    rating: c.rating,
    city: c.city,
    province: c.province,
    clubId: c.club_id ?? null,
    layoutName: c.layout_name ?? null,
```

(`fetchCourses` selects `'*, course_holes(*), course_tees(*)'`; `*` already covers the two new columns, so the query needs no change.)

- [ ] **Step 2: Add `fetchClubs`**

In `src/store/libraryStore.js`, immediately after the `fetchCourses` function, add:

```js
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

- [ ] **Step 3: Let `upsertCourse` carry club fields**

In `src/store/libraryStore.js`, find `upsertCourse`:

```js
export async function upsertCourse({ id, name, city, province }) {
  const row = {
    name,
    city: city?.trim() || null,
    province: province?.trim() || null,
  };
  if (id) row.id = id;
```

Replace with:

```js
export async function upsertCourse({ id, name, city, province, clubId, layoutName }) {
  const row = {
    name,
    city: city?.trim() || null,
    province: province?.trim() || null,
  };
  if (clubId !== undefined) row.club_id = clubId;
  if (layoutName !== undefined) row.layout_name = layoutName;
  if (id) row.id = id;
```

- [ ] **Step 4: Verify no regressions**

Run: `npx jest`
Expected: PASS — the whole suite stays green (no test covers `libraryStore.js`; this confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add src/store/libraryStore.js
git commit -m "feat: libraryStore exposes club fields and fetchClubs"
```

---

## Task 5: `CoursePickerScreen.js` — accordion grouping

**Files:**
- Modify: `src/screens/CoursePickerScreen.js`

A UI screen — not unit-tested (consistent with the repo). Verified by running the suite (no regressions) and by Task 7's manual app check. Apply the eight edits below.

- [ ] **Step 1: Update imports**

Find:

```js
import { useTheme } from '../theme/ThemeContext';
import {
  fetchCourses, upsertCourse, defaultHoles, saveCourseHoles,
  fetchFavoriteCourseIds, toggleFavoriteCourse, deleteCourse,
} from '../store/libraryStore';
import { loadAllTournaments } from '../store/tournamentStore';
import { setPendingCourses } from '../lib/selectionBridge';
import { buildCourseLastUsed } from '../lib/recentUse';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
```

Replace with:

```js
import { useTheme } from '../theme/ThemeContext';
import {
  fetchCourses, fetchClubs, upsertCourse, defaultHoles, saveCourseHoles,
  fetchFavoriteCourseIds, toggleFavoriteCourse, deleteCourse,
} from '../store/libraryStore';
import { loadAllTournaments } from '../store/tournamentStore';
import { setPendingCourses } from '../lib/selectionBridge';
import { buildCourseLastUsed } from '../lib/recentUse';
import {
  buildCourseLibraryItems, filterCourseLibraryItems, normalizeText as normalize,
} from '../lib/courseLibrary';
```

- [ ] **Step 2: Add `clubs` and `expandedClubs` state**

Find:

```js
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
```

Replace with:

```js
  const [courses, setCourses] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [expandedClubs, setExpandedClubs] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
```

- [ ] **Step 3: Load clubs in the focus effect**

Find:

```js
      fetchCourses()
        .then(async (list) => {
          const [favs, tournaments] = await Promise.all([
            fetchFavoriteCourseIds().catch(() => new Set()),
            loadAllTournaments().catch(() => []),
          ]);
          if (cancelled) return;
          setCourses(list);
          setFavorites(favs);
          setLastUsed(buildCourseLastUsed(tournaments));
        })
```

Replace with:

```js
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
```

- [ ] **Step 4: Replace the `filteredCourses` memo with the grouped `items` memo plus the render helpers**

Find the whole `filteredCourses` memo:

```js
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

Replace with:

```js
  const items = useMemo(() => {
    const all = buildCourseLibraryItems(courses, clubs, favorites, lastUsed);
    return filterCourseLibraryItems(all, query);
  }, [courses, clubs, query, favorites, lastUsed]);

  // While searching, every shown club is expanded so matches stay visible.
  const searching = normalize(query).length > 0;
  const isClubExpanded = (clubId) => searching || expandedClubs.has(clubId);
  function toggleClub(clubId) {
    setExpandedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(clubId)) next.delete(clubId); else next.add(clubId);
      return next;
    });
  }

  // One library row for a course — used for standalone courses and, with
  // isLayout=true, for the layout rows inside an expanded club.
  function renderCourseRow(c, isLayout) {
    const selIdx = selectedCourses.findIndex((sc) => sc.id === c.id);
    const isPicked = selIdx !== -1;
    const isFavorite = favorites.has(c.id);
    return (
      <View key={c.id} style={[s.row, isLayout && s.layoutRow, isPicked && s.rowPicked]}>
        <TouchableOpacity
          style={s.rowLeft}
          onPress={() => toggleCourse({ id: c.id, name: c.name, slope: c.slope, holes: c.holes.length === 18 ? c.holes : defaultHoles() })}
          onLongPress={() => handleCourseLongPress(c)}
          delayLongPress={350}
          activeOpacity={0.7}
        >
          <Text style={s.courseName}>{isLayout ? (c.layoutName || c.name) : c.name}</Text>
          <Text style={s.courseMeta}>
            {[c.city, c.province].filter(Boolean).join(', ')}
            {(c.city || c.province) ? '  ·  ' : ''}
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
          {isFavorite ? (
            <FontAwesome name="star" size={18} color={theme.accent.primary} />
          ) : (
            <Feather name="star" size={18} color={theme.text.muted} />
          )}
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
  }

  // A collapsible club header; expands to its layout rows.
  function renderClubRow(club, layouts) {
    const expanded = isClubExpanded(club.id);
    const pickedCount = layouts.filter(
      (l) => selectedCourses.some((sc) => sc.id === l.id)).length;
    return (
      <View key={`club-${club.id}`}>
        <TouchableOpacity style={s.clubRow} onPress={() => toggleClub(club.id)} activeOpacity={0.7}>
          <Feather
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={18}
            color={theme.text.muted}
          />
          <View style={s.rowLeft}>
            <Text style={s.courseName}>{club.name}</Text>
            <Text style={s.courseMeta}>
              {[club.city, club.province].filter(Boolean).join(', ')}
              {(club.city || club.province) ? '  ·  ' : ''}
              {layouts.length} layouts
            </Text>
          </View>
          {pickedCount > 0 && (
            <View style={s.orderBadge}>
              <Text style={s.orderBadgeText}>{pickedCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        {expanded && layouts.map((l) => renderCourseRow(l, true))}
      </View>
    );
  }
```

- [ ] **Step 5: Replace the library render block**

Find:

```js
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
                  onLongPress={() => handleCourseLongPress(c)}
                  delayLongPress={350}
                  activeOpacity={0.7}
                >
                  <Text style={s.courseName}>{c.name}</Text>
                  <Text style={s.courseMeta}>
                    {[c.city, c.province].filter(Boolean).join(', ')}
                    {(c.city || c.province) ? '  ·  ' : ''}
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
                  {isFavorite ? (
                    <FontAwesome name="star" size={18} color={theme.accent.primary} />
                  ) : (
                    <Feather name="star" size={18} color={theme.text.muted} />
                  )}
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

Replace with:

```js
        ) : courses.length === 0 ? (
          <Text style={s.empty}>No courses in library yet.</Text>
        ) : items.length === 0 ? (
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
          items.map((item) =>
            item.kind === 'club'
              ? renderClubRow(item.club, item.layouts)
              : renderCourseRow(item.course, false))
        )}
```

- [ ] **Step 6: Add the two new styles**

In the `makeStyles` `StyleSheet.create({ ... })`, find:

```js
  rowLeft: { flex: 1 },
```

Replace with:

```js
  rowLeft: { flex: 1 },
  clubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  layoutRow: { marginLeft: 16 },
```

- [ ] **Step 7: Verify no regressions**

Run: `npx jest`
Expected: PASS — the whole suite stays green.

- [ ] **Step 8: Commit**

```bash
git add src/screens/CoursePickerScreen.js
git commit -m "feat: club accordion grouping in the course picker"
```

---

## Task 6: `importMadridCourses.js` — create clubs, set `club_id` / `layout_name`

**Files:**
- Modify: `scripts/importMadridCourses.js`

Not unit-tested; verified via `--dry-run` here and the real run in Task 7. Replace the whole file.

- [ ] **Step 1: Rewrite the import script**

Replace the entire contents of `scripts/importMadridCourses.js` with:

```js
// One-shot: import scripts/data/madrid-courses.json into Supabase.
// Usage:  node scripts/importMadridCourses.js [--dry-run]
// Reads EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY from .env.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  deriveCourseName, deriveLayoutName, validateStrokeIndex, buildTeeRows,
} = require('./lib/madridCourses');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(url, key);
const DRY_RUN = process.argv.includes('--dry-run');
const IN = path.join(__dirname, 'data', 'madrid-courses.json');

async function main() {
  const records = JSON.parse(fs.readFileSync(IN, 'utf8'));
  console.log(`Importing ${records.length} courses${DRY_RUN ? ' (dry run)' : ''}\n`);

  // How many trazados each club has — drives single-vs-multi course naming.
  const trazadoCount = {};
  for (const r of records) {
    trazadoCount[r.clubCode] = (trazadoCount[r.clubCode] || 0) + 1;
  }

  const courseByName = new Map();
  const clubByName = new Map();
  if (!DRY_RUN) {
    const { data: courses, error: cErr } = await supabase.from('courses').select('id, name');
    if (cErr) throw cErr;
    for (const c of courses) courseByName.set(c.name, c.id);
    const { data: clubs, error: clErr } = await supabase.from('clubs').select('id, name');
    if (clErr) throw clErr;
    for (const c of clubs) clubByName.set(c.name, c.id);
  }

  // Resolve a club row by name, creating it on first sight.
  async function ensureClub(clubName) {
    if (clubByName.has(clubName)) return clubByName.get(clubName);
    const { data, error } = await supabase
      .from('clubs').insert({ name: clubName, province: 'Madrid' }).select().single();
    if (error) throw error;
    clubByName.set(clubName, data.id);
    return data.id;
  }

  const flagged = [];
  let inserted = 0;
  let enriched = 0;
  let teesWritten = 0;
  let clubsCreated = 0;

  for (const r of records) {
    const name = deriveCourseName(r.clubName, r.trazadoName, trazadoCount[r.clubCode]);
    const layoutName = deriveLayoutName(r.trazadoName);

    const check = validateStrokeIndex(r.holes);
    if (!check.valid) flagged.push(`${name}: ${check.reason}`);

    // Flatten tees → course_tees rows. JSON tees are already longest-first,
    // so the running index is a meaningful sort_order.
    const teeRows = [];
    for (const t of r.tees) {
      for (const row of buildTeeRows(
        { id: t.barra, nombre: t.name }, t.distances, t.men, t.women)) {
        teeRows.push(row);
      }
    }

    const totalPar = r.holes.reduce((a, h) => a + h.par, 0);
    const mark = courseByName.has(name) ? '↻' : '+';
    console.log(
      `${mark} ${name.padEnd(46)} layout="${layoutName}" holes=${r.holeCount} ` +
      `par=${totalPar} tees=${teeRows.length}${check.valid ? '' : '  ⚠ SI INVALID'}`);

    if (DRY_RUN) continue;

    const hadClub = clubByName.has(r.clubName);
    const clubId = await ensureClub(r.clubName);
    if (!hadClub) clubsCreated++;

    const courseRow = { name, province: 'Madrid', club_id: clubId, layout_name: layoutName };
    let id = courseByName.get(name);
    if (id) {
      const { error } = await supabase.from('courses').update(courseRow).eq('id', id);
      if (error) throw error;
      enriched++;
    } else {
      const { data, error } = await supabase
        .from('courses').insert(courseRow).select().single();
      if (error) throw error;
      id = data.id;
      courseByName.set(name, id);
      inserted++;
    }

    await supabase.from('course_holes').delete().eq('course_id', id);
    const { error: hErr } = await supabase.from('course_holes').insert(
      r.holes.map((h) => ({
        course_id: id, number: h.number, par: h.par, stroke_index: h.strokeIndex,
      })));
    if (hErr) throw hErr;

    await supabase.from('course_tees').delete().eq('course_id', id);
    if (teeRows.length) {
      const { error: tErr } = await supabase.from('course_tees').insert(
        teeRows.map((row, i) => ({
          course_id: id, label: row.label, rating: row.rating, slope: row.slope,
          sort_order: i, yardages: row.yardages,
        })));
      if (tErr) throw tErr;
      teesWritten += teeRows.length;
    }
  }

  console.log(
    `\n${DRY_RUN
      ? 'Dry run — no writes performed.'
      : `Done. ${clubsCreated} clubs created, ${inserted} courses inserted, ` +
        `${enriched} enriched, ${teesWritten} tee rows.`}`);
  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} course(s) need manual stroke-index fixing:`);
    for (const f of flagged) console.log(`  - ${f}`);
  }
}

main().catch((e) => { console.error('\nFailed:', e.message ?? e); process.exit(1); });
```

- [ ] **Step 2: Verify with a dry run**

Run: `node scripts/importMadridCourses.js --dry-run`
Expected: one `+ <course name> layout="..." holes=.. par=.. tees=..` line per course, ending `Dry run — no writes performed.` No thrown errors. (Dry run does no DB I/O.)

- [ ] **Step 3: Commit**

```bash
git add scripts/importMadridCourses.js
git commit -m "feat: import Madrid courses grouped under clubs"
```

---

## Task 7: Run the populate (operational — requires user confirmation)

Writes to the production Supabase database. Do not run Steps 2–4 without explicit user confirmation.

- [ ] **Step 1: Trim the data file to 58 courses**

Remove the 5 Villa de Madrid routing combos and the 2 tournament layouts (trazado ids `486`, `487`, `488`, `489`, `1174`, `1406`, `1347`):

Run:
```bash
node -e "const fs=require('fs');const p='./scripts/data/madrid-courses.json';const drop=new Set(['486','487','488','489','1174','1406','1347']);const d=JSON.parse(fs.readFileSync(p,'utf8'));const kept=d.filter(c=>!drop.has(String(c.trazadoId)));fs.writeFileSync(p,JSON.stringify(kept,null,2));console.log('kept',kept.length,'of',d.length);"
```
Expected: `kept 58 of 65`.

- [ ] **Step 2: Apply the migration (after user confirmation)**

Apply `supabase/migrations/20260519000000_clubs.sql` to the database. If the Supabase CLI is linked to the project: `supabase db push`. Otherwise, run the migration's SQL in the Supabase dashboard SQL editor.
Expected: `clubs` table created; `courses.club_id` and `courses.layout_name` columns added.

- [ ] **Step 3: Dry-run, then run the real import (after user confirmation)**

Run: `node scripts/importMadridCourses.js --dry-run` — confirm 58 course lines, no errors.
Then run: `node scripts/importMadridCourses.js`
Expected: `Done. N clubs created, M courses inserted, K enriched, T tee rows.` plus any `⚠` stroke-index warnings.

- [ ] **Step 4: Verify in the app**

Open the course picker (`CoursePickerScreen`). Confirm multi-layout clubs (e.g. La Moraleja, Puerta de Hierro) appear as expandable club rows that open to their layouts, single-layout clubs and existing courses appear as direct rows, search finds clubs and layouts, and selecting a layout adds it to a round. Manually fix any course listed in the `⚠` stroke-index summary via `CourseEditorScreen`.

- [ ] **Step 5: Commit the trimmed data file**

```bash
git add scripts/data/madrid-courses.json
git commit -m "chore: trim Madrid courses to 58 after review"
```

---

## Self-Review

**Spec coverage:**
- `clubs` table + RLS, `courses.club_id` / `layout_name` → Task 1.
- `normalizeCourse` exposes `clubId`/`layoutName`; `fetchClubs`; `upsertCourse` passthrough → Task 4.
- Accordion picker — direct rows for standalone/single-layout, expandable club rows, search matches club/layout/city/province with auto-expand → Tasks 3 (logic) + 5 (UI).
- `deriveLayoutName` → Task 2. Import creates clubs, sets `club_id`/`layout_name`, keeps `name` from `deriveCourseName`, trims to 58 → Tasks 6 + 7.
- Testing: `deriveLayoutName` and `courseLibrary` helpers unit-tested (Tasks 2, 3); migration/picker/import verified manually (Tasks 5, 7) — matches the spec's testing section.
- Out-of-scope items (CoursesLibraryScreen/CourseEditorScreen/CourseLibraryDetailScreen, club favorites, in-app club editing) — no task touches them.

**Placeholder scan:** none — every step has concrete code or an exact command.

**Type consistency:** `normalizeCourse` emits `clubId`/`layoutName` (camelCase); `courseLibrary.js` reads `course.clubId`/`course.layoutName`; the picker passes normalized `courses` into `buildCourseLibraryItems`. `clubs` rows use `id`/`name`/`city`/`province` consistently in `fetchClubs`, `buildCourseLibraryItems`, and the picker. The DB columns `club_id`/`layout_name` (snake_case) appear only in SQL (Task 1), `libraryStore` (Task 4), and the import script (Task 6). `buildCourseLibraryItems(courses, clubs, favorites, lastUsed)` and `filterCourseLibraryItems(items, query)` signatures match between Task 3's definition/tests and Task 5's use.
