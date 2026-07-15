# Course Analysis Drill-Down — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming session)

## Goal

Give the user a per-course statistics analysis, down to hole level: from the
Course Mastery card in MyStats, open a detail view for one course showing
their performance there — round summary stats, shot-level stats (putts,
penalties, drive distribution), and a hole-by-hole breakdown including best
score per hole.

Personal stats only (the signed-in user's rounds), consistent with the rest
of MyStats.

## Entry Point & Navigation

- Rows in the existing `CourseMasteryCard` (MyStats → Breakdown tab) become
  tappable and navigate to a new `CourseStats` screen.
- `CourseStats` is registered in the root stack in `App.js` (same tier as
  `Stats`, `RoundSummary`).
- Navigation params: `{ courseKey, courseName }` only — no heavy objects.
  `courseKey` is the app's established physical-course identity
  (`courseId ?? courseName`, the courseDNA / strokeIndexAccuracy convention).
- `courseDNA` (statsEngine) adds `courseKey` to each course row it returns,
  and `courseMastery` (personalStats) passes it through, so the card has the
  key to navigate with. Rounds with neither courseId nor courseName keep
  their per-round `R{n}` identity as today.

## Data Flow

`CourseStatsScreen` loads its own data, following the `MyStatsScreen`
pattern:

1. `loadAllTournamentsWithFallback()` + `loadProfile()` (for displayName).
2. `collectMyRounds(list, user.id, profile.displayName)` — reuses the
   existing scramble-exclusion, completeness, and handicap rules.
3. Filter to rounds where `round.courseId ?? (courseName || 'Round {n}')`
   matches `courseKey` — the same derivation courseDNA uses, so the
   drill-down never shows a different set of rounds than the card row that
   opened it.
4. `buildCourseBreakdown(courseRounds)` computes the view model.

## Store Layer — `src/store/courseBreakdown.js`

New module (domain logic stays out of screens; `personalStats.js` is already
~725 lines). Exports `buildCourseBreakdown(courseRounds)` where
`courseRounds` are `collectMyRounds` entries already filtered to one course.

Internally it builds a synthetic single-course tournament via the existing
`buildSyntheticTournament(courseRounds)` and reuses statsEngine wherever a
function already exists, so numbers here always agree with the rest of the
app.

Returned shape (all sections independently nullable/empty for graceful
degradation):

### summary
- `rounds`, `avgPoints`, `bestPoints`, `trend` — computed from **complete
  rounds only** (`isComplete`), matching `courseMastery` exactly.
- `avgStrokes` per complete round.
- Score mix (eagle-or-better / birdie / par / bogey / double+ counts) across
  all played holes.
- Front-vs-back average points split (skipped for courses without two
  nines, i.e. fewer than 12 holes — reuse the existing shape-agnostic
  conventions from the T5.8 label work).

### shots (course-scoped shot detail)
- `shotStats(synthetic, CANON_ID)` output, unchanged: putts per round /
  per hole, one-putts, 3-putts+, fairway %, drive-direction distribution
  (fairway/left/right/short/super), tee + other penalties, GIR.
- `hasData` flag drives whether the UI section renders at all.

### holes (the new computation)
One row per physical hole, pooled across every round at the course that has
a score for it (partial rounds contribute their played holes — same rule as
courseDNA):
- `holeNumber`, `par`, `strokeIndex` — from the **most recent** round played
  there ("latest label wins", the established convention), rows in that
  round's hole order.
- `timesPlayed`, `avgStrokes`, `avgVsPar`, `avgPoints`, `bestStrokes`
  (lowest score recorded on the hole).
- Where shot detail exists for the hole: `avgPutts` (over holes that logged
  putts), `penalties` (total tee+other). Null when never logged.
- Holes that appear in older rounds but not the most recent one (course
  edited/renumbered) are pooled by hole number; holes never scored are
  omitted.

### highlights
- `nemesis` (worst pooled avgVsPar) and `best` (lowest pooled avgVsPar)
  hole, only when the hole has been played in at least 2 rounds — a
  single-round course shows the table but makes no nemesis/best claim.

## UI — `CourseStatsScreen` + `HoleBreakdownTable`

- New screen `src/screens/CourseStatsScreen.js`, visually consistent with
  MyStats: header (course name, back button), then `SectionCard` sections.
- Composed from existing mystats components: `SectionCard`, `StatTile`,
  `DistributionBars` (drive distribution), `metricTone` for good/bad
  coloring. One new component
  `src/components/mystats/HoleBreakdownTable.js`: compact rows —
  hole number, par/SI, avg vs par (tone-colored), avg points, best score;
  putts/penalty annotations only when logged.
- Sections render only when they have data (`hasData`, empty arrays →
  section hidden), with a short empty-state line when the course has scores
  but no shot detail.
- No hardcoded 18 — 9-hole courses work throughout.
- Loading/error states follow the MyStatsScreen pattern.

## Error Handling

- Unknown/stale `courseKey` (rounds deleted since navigation): screen shows
  the standard empty state ("No rounds at this course yet"), no crash.
- Corrupt/missing shot detail fields are ignored per hole (statsEngine
  already tolerates this).

## Testing

- `src/store/__tests__/courseBreakdown.test.js`: hole pooling across
  rounds, best-score selection, partial rounds contributing holes but not
  round averages, sparse/absent shot detail, course-rename keying
  (courseId stable across rename), 9-hole course, single-round course
  (no highlights), empty input.
- Component smoke test for `HoleBreakdownTable` following the existing
  mystats `__tests__` style.
- Existing `courseDNA` / `courseMastery` tests extended for the new
  `courseKey` field.

## Out of Scope (deliberate)

- Other players' stats on a course (MyStats is personal).
- Per-hole score-history drill-down (tapping a hole row).
- Entry points from the Course Library or tournament StatsScreen.

All three are addable later without reworking this design.
