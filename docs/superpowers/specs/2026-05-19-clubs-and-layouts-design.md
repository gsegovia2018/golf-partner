# Clubs & Course Layouts

**Date:** 2026-05-19
**Status:** Approved — ready for implementation plan

## Goal

Model the real-world relationship where one golf **club** owns several **course
layouts** (e.g. Real Club La Moraleja has Campo 1–4 plus a Pitch & Putt). Group
those layouts under their club in the course picker, so picking a course is a
two-step action: choose the club, then choose the layout.

This unblocks the Madrid course import (see
`2026-05-19-madrid-courses-populate-design.md`): many Madrid clubs expose
multiple layouts, and importing them as flat, separately-named rows would
clutter the picker.

## Background

Today `courses` is a flat table. The course picker (`CoursePickerScreen.js`) is
a flat searchable list; selecting a course attaches it to a round. A course's
`name` is snapshotted into rounds and rendered across many screens (scorecard,
history, feed, stats, round headers). Therefore `courses.name` must keep being
the full, human-readable course name — anything else would break those screens.

## Data Model

### New `clubs` table

| column      | type        | notes                          |
|-------------|-------------|--------------------------------|
| id          | uuid        | PK, `gen_random_uuid()`        |
| name        | text        | not null                       |
| city        | text        | nullable                       |
| province    | text        | nullable                       |
| created_at  | timestamptz | not null, `now()`              |

RLS mirrors `course_tees` (migration `20260518000003_course_tees.sql`): the
course library is shared, so any authenticated user may SELECT and may
INSERT/UPDATE/DELETE.

### `courses` — two new nullable columns

- `club_id uuid REFERENCES clubs(id) ON DELETE SET NULL` — the club this layout
  belongs to. `ON DELETE SET NULL` so deleting a club does not silently destroy
  its course rows; they become standalone instead.
- `layout_name text` — the short layout label (`Campo 1`, `Amarillo`,
  `Pitch & Putt`). Used only as the row label inside a club's expanded list in
  the picker.

`courses.name` is unchanged in meaning: the full display name
(`Real Club La Moraleja — Campo 1`). Rounds snapshot it; scorecard, history,
feed, and stats render it. None of those change.

### Migration

One migration file creates the `clubs` table (with RLS policies) and adds the
two columns to `courses`. No existing row is modified; no backfill. Existing
courses keep `club_id` and `layout_name` `null` and remain standalone.

## Components

### `libraryStore.js`

- `normalizeCourse` gains `clubId` and `layoutName` on its returned shape.
  Additive — existing consumers are unaffected.
- `fetchCourses` selects the two new columns.
- New `fetchClubs()` returns the `clubs` rows (`id`, `name`, `city`,
  `province`), ordered by `name`.
- `upsertCourse` accepts optional `clubId` and `layoutName` and writes them
  through when present (omitted → column left untouched / null on insert).

### `CoursePickerScreen.js` — accordion grouping

The picker stays a **single screen**. Multi-select across rounds (order badges,
`maxSelectable`, the "Add N Rounds" footer) depends on selection state living
on one screen, so a separate club-detail screen is rejected. Instead the club
opens as an inline accordion.

The library list is built from `fetchCourses()` + `fetchClubs()` and contains
two row kinds:

- **Direct row** — a standalone course (`clubId` null) *or* a club with exactly
  one layout. Tapping it selects that course immediately, exactly like today
  (toggles selection, shows the order badge).
- **Expandable club row** — a club with 2+ layouts. Tapping it expands inline
  to list its layout rows, labelled by `layoutName`. Layout rows select like
  direct rows. Tapping the club row again collapses it.

Selection state, order badges, favorites, and the confirm footer are unchanged
— a selected course is still a course row, whether reached directly or inside
an expanded club.

Search matches club name, layout name, city, and province. A club with a
matching layout is auto-expanded so the match is visible. A matching standalone
course shows as before.

Existing behaviour kept: favorites (per course), last-used ordering, add-new
course, long-press rename/delete of a course.

### Import — `importMadridCourses.js` + `madridCourses.js`

- New pure helper `deriveLayoutName(trazadoText)` in `madridCourses.js`: returns
  the text after the last `" - "` in the trazado option text, or the whole
  trimmed text if there is no `" - "`. HTML-entity decoded. Unit-tested.
- `importMadridCourses.js`:
  - Before import, the data file is trimmed (Stage 2 review) to 58 courses —
    the 5 Villa de Madrid routing combos and the 2 tournament layouts
    (`Copa SM El Rey`, `Buenavista R.C.I.`) are removed.
  - For each federation club, upsert a `clubs` row matched by `clubName`
    (`province = 'Madrid'`), obtaining its `club_id`.
  - Each course row sets `club_id` and `layout_name` (from `deriveLayoutName`).
    `courses.name` is still produced by `deriveCourseName` (the full name).
  - Course matching for enrich-vs-insert stays by `name`.

## Data Flow

```
fetchClubs() ─┐
              ├─► CoursePickerScreen builds grouped list ─► user expands club
fetchCourses()┘                                          ─► selects layout(s)
                                                         ─► setPendingCourses
                                                            ({ id, name, slope, holes })
```

The selection payload (`{ id, name, slope, holes }`) is unchanged, so the
round-setup flow downstream of the picker needs no changes.

## Edge Cases

- **Single-layout club** — rendered as a direct row (no pointless expand step).
- **Standalone course** (existing courses, `clubId` null) — rendered as a
  direct row, behaves exactly as today.
- **Club deleted** — `ON DELETE SET NULL` leaves its courses standalone rather
  than deleting them.
- **Search inside a collapsed club** — a layout match auto-expands its club.
- **`upsertCourse` called without club fields** (the existing "add new course"
  path) — creates a standalone course, `club_id`/`layout_name` null.

## Testing

- `deriveLayoutName` — Jest unit test (pure function), in
  `scripts/__tests__/madridCourses.test.js`.
- Migration — applied and verified against the database.
- `CoursePickerScreen` and `libraryStore` changes — verified manually
  (the repo does not unit-test screens or `libraryStore`).
- `importMadridCourses.js` — verified via `--dry-run`, then the real run.

## Out of Scope

- `CoursesLibraryScreen`, `CourseEditorScreen`, `CourseLibraryDetailScreen`
  stay flat — they render the full `course.name`, which remains correct.
- Club-level favorites.
- Editing clubs from inside the app (clubs are created by the import; the app
  reads them). A club with no courses is harmless.
- Grouping the existing Marbella courses under clubs.

## Sequencing

This feature ships before the Madrid course import runs. The import
(`importMadridCourses.js`, the operational Task 7 of the Madrid populate plan)
is folded into this feature's implementation plan as its final step, since it
now depends on the `clubs` table.
