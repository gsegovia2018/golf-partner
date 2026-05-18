# Setup Wizard — Players & Course Step Redesign

**Date:** 2026-05-18
**Status:** Approved (design)
**Scope:** Visual redesign of the middle content of two New Game / Tournament wizard steps.

## Problem

In the New Game / Tournament setup wizard (`src/screens/SetupScreen.js`), the
**Players** step and **Course** step look unpolished. The flow, step order, step
titles (overline / prompt / subtitle), and the bottom `WizardNav` Back / Next bar
are all fine and must not change. Only the content *between* the title block and
the nav bar is being redesigned.

Current pain points:

- **Players step:** a flat stack of player rows plus a dashed "Add Player from
  Library" button and a separate empty-hint box. No avatars; the 1–4 capacity is
  not visible.
- **Course step:** a dashed "Pick Course from Library" button, then once a course
  is chosen, a loose `TextInput` for the name and a separate "Configure Holes"
  button — three disconnected elements.

## Non-Goals

- No change to wizard steps, step order, or step gating logic (`setupWizard.js`).
- No change to step titles: the `stepOverline` / `stepPrompt` / `stepSubtitle`
  text and styles stay as-is.
- No change to the bottom `WizardNav` (Back / Next) bar or its behaviour.
- No change to the destination screens (`PlayerPicker`, `CoursePicker`,
  `CourseEditor`) or to navigation params passed to them.
- No change to the Scoring or Review steps.
- No change to the `official` roster flow.

## Design

### Players step — Slot grid (2×2)

Replaces `renderPlayersStep`'s stacked cards + dashed button + `emptyHint` box.

- A 2-column grid of up to **4 slots**, filled slots first, then empty slots.
- **Filled slot:** a white card tile containing
  - an avatar — the player's `avatar_url` image if present, otherwise initials
    (`name.slice(0, 2).toUpperCase()`) on the accent background, matching the
    existing `PlayerPickerScreen` avatar pattern;
  - the player's name (first name is enough at slot width; full name acceptable
    if it fits);
  - "HCP n";
  - a small **✕ remove** control in the top-right corner. Tapping it runs the
    existing `removePlayer` → `confirmDialog` flow unchanged.
- **Empty slot:** a dashed-bordered tile, same radius as the filled tile, with a
  dashed "+" circle and an "ADD PLAYER" label. Tapping it navigates to
  `PlayerPicker` with `alreadySelectedIds` exactly as the current button does.
- When 4 players are present, only filled slots show (no empty slot).
- With 0 players all four slots render as empty dashed tiles — this is
  self-explanatory, so the separate `emptyHint` box is removed.
- The Next-button gating is unchanged: `isStepValid('players', …)` still requires
  `players.length >= 1`.

### Course step — Course card

Replaces, per round, `renderCourseStep`'s dashed pick button + `TextInput` +
`editHolesBtn` with a single **course card**.

- **Empty state (no course picked):** a dashed-bordered tile with the same shape
  and corner radius as the filled card — a pin icon, "Pick a course from
  library", and a "Tap to choose where you're playing" hint. Tapping anywhere on
  the tile navigates to `CoursePicker` with `{ roundIndex: i }`, exactly as the
  current dashed button does.
- **Filled state (course picked):** a white card with
  - **Top row:** a pin icon tile, the course name, and a pencil icon. Tapping the
    pencil reveals an inline `TextInput` bound to `updateCourseName(i, value)`
    (same handler as today) so the name stays editable; tapping again / blur
    collapses it back to text.
  - **Stat row:** three compact stat chips — **Par** (sum of `r.holes[].par`),
    **Holes** (`r.holes.length`), **Slope** (`r.slope`, or "—" when null).
  - **Bottom row:** a divided "Configure holes" row with a chevron. Tapping it
    navigates to `CourseEditor` with the exact same params passed today
    (`roundIndex`, `courseName`, `initialHoles`, `onSave`, `players`,
    `initialSlope`, `initialCourseRating`, `initialPlayerHandicaps`,
    `initialManualHandicaps`, `courseId`).
- **Tournament (multi-round):** each round renders one course card. The existing
  "Round N" label and per-round Remove control stay above each card; the dashed
  "Add Round" button stays below the list. Only the inner per-round content
  changes.
- The Next-button gating is unchanged: `isStepValid` for `course` / `rounds`
  still requires every round to have a non-empty `courseName`.

## Components / Files

- **`src/screens/SetupScreen.js`** — rewrite the `renderPlayersStep` and
  `renderCourseStep` function bodies and their associated entries in
  `makeStyles`. Remove now-unused styles (`playerCard`, `playerInfo`, old
  `pickBtn` usages, `emptyHint`, `editHolesBtn`, etc.) where no longer
  referenced. No other function in the file changes.
- No new files; no store, navigation, or schema changes.

## Data Flow

Unchanged. The redesign is presentational only:

- Players still come from `players` state, populated via the `PlayerPicker`
  selection bridge (`consumePendingPlayers`).
- Course data still comes from `rounds` state, populated via the `CoursePicker`
  selection bridge (`consumePendingCourses`) and edited via `CourseEditor`'s
  `onSave` → `handleHolesSaved`.
- `updateCourseName`, `removePlayer`, `removeRound`, `addRound` handlers are
  reused as-is.

## Error / Edge Cases

- **Long course / player names:** truncate with ellipsis within the card; never
  let text break the card layout.
- **Missing slope:** show "—" in the Slope chip rather than blank or "null".
- **Player with no `avatar_url`:** fall back to initials; "?" if name is empty.
- **Course name validation:** the existing "A course is required" / "Round N
  needs a course" error text still renders for empty-name rounds.

## Testing

- `setupWizard.test.js` pure-helper tests are unaffected and must still pass.
- Manual / visual check: 0–4 players renders the correct mix of filled and empty
  slots; remove confirm still fires; empty and filled course cards both navigate
  correctly; tournament multi-round still adds/removes rounds; rename pencil
  edits the course name; Next stays gated correctly in both steps.
- Run the existing store test suite to confirm no regressions.
