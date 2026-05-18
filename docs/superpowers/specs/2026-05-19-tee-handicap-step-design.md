# Tees & Handicaps Step — Design

**Date:** 2026-05-19
**Status:** Approved design — ready for implementation plan

## Problem

Per-player tee selection and per-player playing-handicap editing currently
live *inside* `CourseEditorScreen` (the per-round "Configure holes" screen).
That conflates two unrelated concerns: defining a course (its holes and tee
sets) versus assigning, per round, which tee each player uses and what their
playing handicap is.

The per-player concerns should happen in the setup flow itself, after the
course and the players are known — not buried in the course editor.

## Goals

- Move per-player tee selection + playing-handicap editing out of
  `CourseEditorScreen` into the setup flow.
- New create-wizard step order: **Course → Players → Tees & Handicaps →
  Scoring → Review**.
- Apply the same restructure when editing an existing tournament.
- `CourseEditorScreen` becomes course-only: holes + the course's tee
  definitions.
- No data-model change — only *where* the per-player fields are edited moves.

## Non-Goals

- Changing the round/course data model. `Round` still stores `tees`,
  `playerTees`, `playerHandicaps`, `manualHandicaps`.
- Changing handicap math, the tee data model, or scoring.
- Official tournaments (`kind === 'official'`) — they use a fixed
  roster/rounds/format flow and are out of scope here.

## Approach

This is largely a **relocation**. The per-player tee-chip picker and the
playing-handicap editing (auto-derive, manual override, "reset to auto") that
exist inside `CourseEditorScreen` are lifted into one reusable component,
`RoundTeeAssignments`, hosted by both the create wizard and the edit screen.
`CourseEditorScreen` shrinks to course-only.

## Components

### `RoundTeeAssignments` (new, `src/components/RoundTeeAssignments.js`)

A controlled component owning the per-player tee + handicap UI for **one
round**.

- **Props:** `round` (carries `courseId`, `tees`, `holes`, and the current
  `playerTees`/`playerHandicaps`/`manualHandicaps`), `players`, `onChange`,
  `theme`.
- **Renders:** for each player — a tee-chip picker (one chip per tee in
  `round.tees`) and an editable playing-handicap input. A "Reset all to auto"
  control appears when any manual override is set. An empty-tees hint when the
  course has no tees.
- **Behavior (lifted verbatim from `CourseEditorScreen`):**
  - On mount, resolve each player's default tee:
    `lastTeeForPlayerOnCourse(round.courseId, playerId)` → else
    `middleTee(round.tees)`. Then align each non-manual playing handicap to
    that tee via `calcPlayingHandicap`.
  - Picking a tee re-derives that player's non-manual handicap.
  - Editing a handicap input marks that player `manual`.
  - "Reset all to auto" clears manual flags and recomputes from tees.
- **Emits:** `onChange({ playerTees, playerHandicaps, manualHandicaps })`.

### New wizard step — "Tees & Handicaps"

- Step key `'tees'`, inserted after the course step and the players step,
  before scoring: `wizardSteps()` returns
  `['course'|'rounds', 'players', 'tees', 'scoring'?, 'review']`.
- `isStepValid('tees', …)` returns `true` — every player always has a default
  tee and an auto handicap, so the step never blocks Next.
- The step renders one `RoundTeeAssignments` per round (a tournament shows up
  to 3 round sections; a game shows 1). Each round's `onChange` updates that
  round's `playerTees`/`playerHandicaps`/`manualHandicaps` in `SetupScreen`
  state.

### `CourseEditorScreen` — course-only

- Removes: the "Playing Handicaps" section, the per-player tee-chip picker,
  and the `playerTees`/`playerHandicaps`/`manualHandicaps` state and mount
  effect.
- Keeps: the holes table and the `TeesEditor` (course tee definitions).
- Route params drop `players`, `initialPlayerHandicaps`,
  `initialManualHandicaps`, `initialPlayerTees`.
- `onSave` patch shrinks from
  `{ holes, tees, playerHandicaps, manualHandicaps, playerTees }` to
  `{ holes, tees }`.

### `EditTournamentScreen`

- Each round card gets a `RoundTeeAssignments` section (same component),
  wired to that round's per-player fields.
- "Edit Holes & Tees" still opens `CourseEditorScreen` (now course-only).
- The existing base "Handicap Index" section (which edits each player's base
  *index*, a player attribute — distinct from the per-round *playing
  handicap*) is unchanged.

## Data Flow

1. **Course step** — user picks a course per round; the round snapshots the
   course's `holes` + `tees` (unchanged behavior).
2. **Players step** — roster is set (unchanged).
3. **Tees & Handicaps step** — `RoundTeeAssignments` per round resolves
   default tees and writes `playerTees`/`playerHandicaps`/`manualHandicaps`
   into each round.
4. **Scoring / Review** — unchanged; `handleStart` builds the tournament from
   round state.

`SetupScreen.handleStart` keeps its existing middle-tee fallback for any round
the user somehow left unresolved (defensive; the new step normally fills it).

## Step Ordering Detail

`wizardSteps(kind, playerCount)`:
- `game`: `['course', 'players', 'tees'] + (playerCount >= 2 ? ['scoring'] : []) + ['review']`
- `tournament`: `['rounds', 'players', 'tees'] + (playerCount >= 2 ? ['scoring'] : []) + ['review']`
- `official`: unchanged (`['roster', 'rounds', 'format', 'review']`).

The `'tees'` step always appears (a solo one-player game still picks a tee and
has a handicap).

## Testing

- `setupWizard.test.js`: `wizardSteps` includes `'tees'` in the right
  position for `game`/`tournament`, with and without the `scoring` step;
  `isStepValid('tees', …)` is `true`.
- Tee-resolution and handicap-derivation logic remains covered by the existing
  `scoring.js` and `tees.js` test suites (the logic moves location but is
  unchanged).
