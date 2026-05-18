# Per-Player Tees — Design

**Date:** 2026-05-18
**Status:** Approved design — ready for implementation plan

## Problem

Courses currently carry a single `slope` and `rating` for the whole course.
In real golf, course rating and slope are determined **per set of tees** —
each tee colour/number/name has its own rating and slope (longer tees rate
higher). Players in the same round routinely play different tees (one on
yellow, another on white), so a single course-level slope/rating cannot
produce correct playing handicaps.

This design makes rating + slope a property of a **tee**, lets a course own
an ordered list of tees, and lets each player select their tee **per round**.

## Goals

- A course owns an ordered list of tees; each tee has a free-form label,
  course rating, slope, and optional per-hole yardage.
- Par and stroke index stay shared at the course level (same for all tees).
- Each player selects a tee per round; playing handicap is derived from that
  player's tee.
- Existing courses and existing rounds keep working with no data migration of
  round records.

## Non-Goals

- Per-tee par or per-tee stroke index (mixed men's/ladies' tees with
  different pars). Out of scope — par/SI remain shared.
- A profile-level "preferred tee" field. Pre-fill is derived from history
  instead (see "Tee Pre-fill" below).
- Official tournaments (`officialScoring` / `officialAdmin`) tee UI. They
  inherit this only if they reuse the same round shape; official-specific
  tee UI is a follow-up.

## Approach

**Approach A — snapshot the tee into the round.** When a round is set up,
each player's chosen tee (label + slope + rating) is copied into the round
next to their playing handicap. This mirrors how `holes` are already
deep-copied into rounds and rides the existing `propagateCourseToTournaments`
mechanism. The round stays self-contained and offline-safe; historical rounds
keep the slope/rating they were played on even if a tee is later edited or
deleted.

Rejected: referencing `teeId` live from the course library (breaks the
snapshot pattern, mutates historical rounds on tee edits); folding tee into
`playerHandicaps` (conflates tee with handicap and tangles manual-override
logic).

## Data Model

### Course (app shape)

```
Course = {
  id, name, city, province,
  holes: [{ number, par, strokeIndex }],   // shared across tees — unchanged
  tees:  [Tee],                            // ordered longest → shortest
}

Tee = {
  id, label, rating, slope, sortOrder,
  yardages?: { [holeNumber]: number },     // optional, cosmetic
}
```

- `label` is free-form: a colour ("White"), a number ("3"), or a word
  ("Championship", "Members").
- `tees` is ordered by `sortOrder`; `tees[0]` is the back (longest) tee.
- Course-level `slope`/`rating` are removed from the app shape.

### Round

```
Round = {
  ...existing fields (courseId, courseName, holes, scores,
                      playerHandicaps, manualHandicaps),
  playerTees: { [playerId]: { teeId, label, slope, rating } },
}
```

- `playerTees` is the per-player tee snapshot.
- Legacy `round.slope` / `round.courseRating` are **retained read-only** as a
  fallback for rounds created before this feature. No migration of existing
  round records is performed — the feature is purely additive plus a fallback
  path.

## Scoring (`src/store/scoring.js`)

- `calcPlayingHandicap(index, slope, rating, par)` — **unchanged** (pure).
- `deriveRoundPlayingHandicap(handicap, round, playerId)` — gains a `playerId`
  argument. Resolves slope/rating from `round.playerTees?.[playerId]`, falling
  back to `round.slope` / `round.courseRating` when there is no tee entry
  (legacy rounds, or a course with no tees defined).
- `normalizeRoundHandicaps`, `recomputeRoundPlayingHandicaps`,
  `getPlayingHandicap` — thread `playerId` through to
  `deriveRoundPlayingHandicap`. They already iterate players, so `p.id` is in
  scope.
- **Stableford, Match Play, and Sindicato math are untouched.** They read
  `par`/`strokeIndex` (shared) and `playerHandicaps` (already per-player). Two
  players on different tees simply get different playing handicaps.

## Database

### New table `course_tees`

```
id          uuid    primary key
course_id   uuid    references courses(id) on delete cascade
label       text    not null
rating      numeric
slope       integer
sort_order  integer not null
yardages    jsonb                 -- optional { holeNumber: yards }; cosmetic
created_at  timestamptz default now()
```

Yardages live in the `jsonb` column because they are optional and cosmetic —
not worth a dedicated `tee_hole_yardages` table. RLS mirrors the existing
`courses` / `course_holes` policies.

### Migration

For each existing row in `courses`, insert one `course_tees` row:
`label = 'Default'`, copying the course's current `slope` and `rating`,
`sort_order = 0`.

`courses.slope` and `courses.rating` columns are left in place (deprecated,
untouched) to avoid breaking any unmigrated reads.

### `libraryStore.js`

- `normalizeCourse` — includes `tees` from the joined `course_tees`, sorted by
  `sort_order`. If a course has no tee rows but carries legacy `slope`/`rating`,
  synthesize a single `{ label: 'Default', rating, slope }` tee so the app
  shape is always consistent.
- New `saveCourseTees(courseId, tees)` — delete-then-insert, mirroring
  `saveCourseHoles`.
- `upsertCourse` — drops `slope`/`rating` params; tees are saved separately.
- `updateCourseFromEditor` and `propagateCourseToTournaments` — updated to
  carry `tees` instead of a single slope/rating (see "Propagation" below).

## UI

- **CourseEditorScreen** — the "Course Slope / Course Rating" card becomes a
  **Tees** editor: a list of tee rows (label + rating + slope, with an
  optional per-hole yardage expander) and add/remove controls.
- **Playing Handicaps section** (CourseEditorScreen) — each player row gains a
  **tee picker**. Selecting a tee re-derives that player's auto playing
  handicap from the tee's slope/rating. The existing manual-override behaviour
  (`manualHandicaps`, "Reset all to auto") is preserved.
- **Scorecard / Round Summary** — a small tee-label chip beside each player's
  name.
- **No tees defined** — players play with "no tee"; playing handicap falls
  back to the raw index (the existing no-slope path). UI nudges the user to
  add tees in the course editor.

## Tee Pre-fill ("last-used per course")

No new persistence. When a round is set up, each player's tee is resolved by:

1. The most recent prior round on the same `courseId` that has a `playerTees`
   entry for that player — matched **by label** to the current course's tee
   list (the live `teeId` may differ across courses/edits).
2. Otherwise, the **middle tee** (`tees[Math.floor(tees.length / 2)]`).

A helper `lastTeeForPlayerOnCourse(courseId, playerId)` scans the loaded
tournaments for the most recent matching round.

## Propagation

`propagateCourseToTournaments(courseId, { holes, tees })` — pushes `holes` and
`tees` into every round referencing the course. Each affected round
re-resolves each player's tee snapshot by `teeId`: if the tee still exists,
its slope/rating/label are refreshed; if it was deleted, the existing snapshot
is retained. Non-manual playing handicaps are re-derived afterwards.

## Testing

- `scoring.test.js`:
  - `deriveRoundPlayingHandicap` resolves per-player tee slope/rating.
  - Two players on different tees in one round get different handicaps.
  - Legacy round with no `playerTees` falls back to `round.slope` /
    `round.courseRating`.
- `libraryStore`:
  - `normalizeCourse` synthesizes a `Default` tee from legacy slope/rating.
  - Tee CRUD via `saveCourseTees`.
- Pre-fill resolver: `lastTeeForPlayerOnCourse` picks the most recent
  label-matched tee; falls back to the middle tee.
