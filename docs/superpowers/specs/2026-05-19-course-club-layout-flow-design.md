# Course → Club → Layout Selection Flow

**Date:** 2026-05-19
**Status:** Approved — ready for implementation plan

## Goal

Make picking a course in the setup flow a two-step action split across two
screens: the course picker selects a **club** (or a standalone course); the
**layout** is then chosen on the round card in the "Where are you playing?"
wizard step, via a dropdown.

## Background

The Clubs & Layouts feature (`2026-05-19-clubs-and-layouts-design.md`) grouped
courses under clubs and built an *inline accordion* in `CoursePickerScreen` —
tap a club, its layouts expand in place. The user wants the layout choice moved
out of the picker and into the wizard step instead. This spec supersedes the
accordion portion of that feature; the `clubs` table, `courses.club_id` /
`layout_name`, `libraryStore.fetchClubs`, and `courseLibrary.js` all stay.

The course picker is opened from two screens, both of which need the new flow:
`SetupScreen` (new game / tournament) and `OfficialCreateScreen` (official
tournaments). Both navigate `CoursePicker` with `{ roundIndex }` and read the
result through `selectionBridge`.

## Flow

1. On a round card in "Where are you playing?", tap to open the course picker.
2. The picker shows clubs and standalone courses as a flat selectable list.
   Picking a **club** or a **standalone course** returns to the wizard.
3. Back on the round card:
   - **Standalone course picked** → the round is filled immediately
     (`courseName`, `holes`, `tees`); the existing hole/tee config UI shows.
   - **Club picked** → the round shows the club name and a "Choose a layout…"
     dropdown of that club's layouts. The round is *incomplete* until a layout
     is chosen.
4. Choosing a layout fills the round from that layout's course.

## Components

### `CoursePickerScreen.js` — club / course selector

The inline accordion is removed (`expandedClubs`, `toggleClub`, the club-row
expansion, layout sub-rows). The screen still builds its list with
`buildCourseLibraryItems` / `filterCourseLibraryItems` from `courseLibrary.js`,
but renders:

- **Club item** → a single selectable row (club name, layout count). Tapping it
  selects the *club* — order badge, multi-select, exactly like a course row.
- **Course item** (standalone or single-layout club) → a selectable course row,
  as today.

Multi-select across rounds, order badges, favorites, search, and add-new-course
are unchanged. On confirm, the picker writes its selections to `selectionBridge`
(see Data Flow).

### `RoundLayoutSelect.js` — new shared component (`src/components/`)

Renders, for a round whose pick is a club:

- The club name, with a "Change" affordance that reopens the picker.
- A dropdown labelled "Choose a layout…" that, when tapped, expands an inline
  list of the club's layouts (layout name + holes / par / slope). Selecting a
  layout calls `onChange(layoutCourse)` and collapses the list.

Props: `{ club, layouts, value, onChange, onChangeClub }` where `value` is the
chosen layout's course id (or null). Used by both `SetupScreen` and
`OfficialCreateScreen`.

### `roundCourse.js` — new pure helpers (`src/lib/`)

Pure, unit-tested functions shared by both wizard screens:

- `applyCoursePick(round, pick)` — returns the next round object for a pick.
  A `course` pick fills `courseName` / `courseId` / `holes` / `tees` and clears
  any club fields. A `club` pick sets `club` / `clubLayouts`, clears
  `layoutId`, and leaves `courseName` empty (round incomplete).
- `applyLayoutChoice(round, layoutCourse)` — fills `courseName` / `courseId` /
  `holes` / `tees` from the chosen layout and records `layoutId`, keeping
  `club` / `clubLayouts` so the layout can be changed.

## Data Model

### Setup-stage round — new fields

A round in `SetupScreen` / `OfficialCreateScreen` state gains:

- `club` — `{ id, name }` when a club was picked; `null` for a standalone
  course or an unset round.
- `clubLayouts` — array of layout course objects for the dropdown; present
  when `club` is set.
- `layoutId` — the chosen layout's course id; `null` when a club is picked but
  no layout chosen yet.

`courseName`, `courseId`, `holes`, `tees` keep their current meaning and are
populated only once the round is *resolved* (a standalone course picked, or a
layout chosen). `isStepValid('course' | 'rounds')` already gates the Next
button on every round having a non-empty `courseName`, so a club-picked round
with no layout blocks Next with **no validation change**.

### `selectionBridge` payload

`setPendingCourses(data)` / `consumePendingCourses()` are unchanged as
functions. The payload shape becomes:

```js
{
  startRoundIndex: number,
  picks: [
    { kind: 'course', course: { id, name, slope, holes, tees } },
    { kind: 'club', club: { id, name }, layouts: [ /* course objects */ ] },
  ],
}
```

Each layout course object carries `id`, `name` (full display name),
`layoutName`, `slope`, `holes`, `tees`.

## Data Flow

```
CoursePickerScreen ──picks──► selectionBridge ──► SetupScreen / OfficialCreateScreen
                                                   │  applyCoursePick(round, pick)
                                                   ▼
                                       round card renders:
                                         course pick  → filled round (hole/tee UI)
                                         club pick    → RoundLayoutSelect dropdown
                                                          │ onChange(layoutCourse)
                                                          ▼
                                                applyLayoutChoice(round, layoutCourse)
                                                          → filled round
```

`propagateCourseToTournaments` and `lastTeeForPlayerOnCourse` key on
`round.courseId`, which a resolved round still carries — unaffected.

## Edge Cases

- **Single-layout club** — `buildCourseLibraryItems` already collapses a club
  with one layout into a `course` item, so a "club" pick always has 2+ layouts;
  no auto-select needed.
- **Change the club** — the round card's "Change" reopens the picker for that
  round index; a new pick replaces the round via `applyCoursePick`.
- **Change the layout** — re-opening the dropdown and choosing another layout
  re-runs `applyLayoutChoice`; `club` / `clubLayouts` are retained.
- **Remove a round** — unchanged.
- **A club-picked round left without a layout** — Next stays disabled; the
  round card shows the dropdown in its unfilled state.

## Testing

- `roundCourse.js` (`applyCoursePick`, `applyLayoutChoice`) — Jest unit tests.
- `courseLibrary.js` tests are unaffected and continue to pass.
- `CoursePickerScreen`, `RoundLayoutSelect`, `SetupScreen`,
  `OfficialCreateScreen` — verified manually (the repo does not unit-test
  screens or components).

## Out of Scope

- Course picking outside the setup wizards (no other screens open the picker).
- Changing how a *played* round references its course.
- The Lomas-Bosque data fix — tracked separately.

## Sequencing

This supersedes the accordion in `CoursePickerScreen`. It builds on the merged
Clubs & Layouts data model (`clubs` table, `courses.club_id` / `layout_name`),
which is already live.
