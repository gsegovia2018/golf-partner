# New Game / Tournament Setup Wizard — Design

**Date:** 2026-05-17
**Status:** Approved — ready for implementation planning
**Affected screen:** `src/screens/SetupScreen.js` (New Game / New Tournament)

## Problem

The current New Game / New Tournament screen (`SetupScreen.js`) is a single long
scroll with a plain header, stacked sections, and a Start button at the bottom.
It looks dated and unappealing. The redesign turns it into a modern **stepped
wizard** with one decision per screen, a progress bar, and a polished review
step.

## Goals

- Replace the single-scroll layout with a guided, stepped flow.
- One focused decision per step, with a serif prompt and clear progress.
- A visually rewarding final Review step before the game/tournament is created.
- Preserve all existing setup logic — state shape, auto-naming, library
  navigation round-trips, and `handleStart()` — unchanged.

## Non-Goals

- No change to how tournaments/games are persisted (`createTournament`,
  `saveTournament`).
- No change to `PlayerPicker`, `CoursePicker`, `CourseEditor`, or
  `ScoringModePicker` internals — they are reused as-is.
- No change to pair-building or handicap-derivation logic.

## Architecture

`SetupScreen.js` remains a **single screen component** with an internal `step`
index — it does NOT become separate React Navigation routes.

This is required because picking players/courses navigates *out* to
`PlayerPicker`, `CoursePicker`, and `CourseEditor`, then returns. SetupScreen
consumes the results via `consumePendingPlayers()` / `consumePendingCourses()`
inside `useFocusEffect`. Because those pickers are pushed *on top* of
SetupScreen, SetupScreen stays mounted and its internal `step` state survives
the round-trip — the user returns to the step they left.

All existing state stays as-is: `tournamentName`, `nameTouched`, `players`,
`rounds`, `settings`. `handleStart()`, `buildGameName()`, the `useFocusEffect`
consume logic, and the `scoringMode` fallback effect are unchanged.

## Steps

The step list is computed from `kind` and player count:

- **Game:** `Players → Course → [Scoring] → Review`
- **Tournament:** `Players → Rounds → [Scoring] → Review`

The **Scoring step exists only when `players.length >= 2`**. A solo game/
tournament has no scoring choice (it is always solo Stableford), so it shows 3
steps; a 2+ player setup shows 4.

## Components

### `setupWizard.js` (new — pure helpers)

Location: `src/screens/setupWizard.js` (co-located with `SetupScreen.js`).

- `wizardSteps(kind, playerCount)` → ordered array of step keys, e.g.
  `['players', 'course', 'scoring', 'review']` or, for a tournament,
  `['players', 'rounds', 'scoring', 'review']`. Omits `'scoring'` when
  `playerCount < 2`.
- `isStepValid(stepKey, { players, rounds })` → boolean:
  - `players`: `players.length >= 1`
  - `course` / `rounds`: every round has a non-empty trimmed `courseName`
  - `scoring`: always `true`
  - `review`: always `true`

These are pure and unit-tested.

### `WizardProgress.js` (new — presentational)

Location: `src/components/setup/WizardProgress.js`.

Props: `step` (0-based index), `totalSteps`, `onBack`.
Renders: back chevron (calls `onBack`), a `STEP X OF N` label, and a segmented
progress bar (one segment per step; segments up to and including the current
step are filled in `accent.primary`).

### `WizardNav.js` (new — presentational)

Location: `src/components/setup/WizardNav.js`.

Props: `isFirstStep`, `isLastStep`, `nextEnabled`, `nextLabel`, `onBack`,
`onNext`.
Renders a sticky bottom bar:
- `Back` button — hidden when `isFirstStep` (full-width Next instead).
- `Next` button — primary green; greyed/disabled when `!nextEnabled`; label is
  `nextLabel` ("Next", or "Start Game" / "Start Tournament" on the last step).

### `SetupScreen.js` (refactored — orchestrator)

- Adds `step` state and `steps = wizardSteps(kind, players.length)` (memoised).
- Renders `WizardProgress` (top), the current step body, and `WizardNav`
  (bottom sticky).
- Step bodies are render functions reusing today's JSX:
  - **Players** — serif prompt "Who's playing?"; existing player cards, remove
    button, "Add player from library" button, spots-left hint.
  - **Course / Rounds** — serif prompt "Where are you playing?"; existing course
    pick button, course name input, "Configure Holes" button. Tournament keeps
    the multi-round list and "Add Round".
  - **Scoring** — serif prompt "How do you keep score?"; existing
    `ScoringModePicker`.
  - **Review** — new, see below.

### Review step (Green Hero Recap)

- A deep-green gradient hero band: an overline ("REVIEW & CONFIRM"), the game/
  tournament name as an **editable field** (white text on green; editing it
  sets `nameTouched`), and summary chips (player count, and scoring mode when
  applicable).
- Below the hero: a "TAP TO EDIT" label and a single grouped card with rows:
  - **Players** — avatar + summary ("Marcos · HCP 12", or "3 golfers"); taps to
    the Players step.
  - **Course / Rounds** — course name + par (Game), or round count (Tournament);
    taps to the Course/Rounds step.
  - **Scoring** — mode name; taps to the Scoring step. When solo (no scoring
    step), this row still shows the effective mode ("Stableford · Solo") but is
    non-tappable.

## Behaviour & Edge Cases

- **Next gating:** `Next` is disabled until `isStepValid(currentStepKey, state)`
  is true. The Review step's button is "Start Game/Tournament" and calls the
  existing `handleStart()`.
- **Step clamping:** when a player is removed and the count drops below 2 while
  the user is on or past the Scoring step, `steps` shrinks. After recomputation,
  clamp `step` to `steps.length - 1` so the index never points past the array.
  This complements the existing effect that falls the `scoringMode` back to a
  valid value.
- **Back on step 0:** `WizardNav` hides `Back`; the `WizardProgress` chevron
  calls `navigation.goBack()` to leave the screen.
- **Auto-naming:** `buildGameName()` still auto-fills `tournamentName` from the
  first course while `!nameTouched`. The name is surfaced on the Review step;
  editing it there sets `nameTouched`, stopping further auto-updates.
- **Navigation round-trips:** unchanged. `useFocusEffect` still consumes pending
  players/courses; `step` is preserved because SetupScreen stays mounted.

## Testing (TDD)

Unit tests for `setupWizard.js`:
- `wizardSteps('game', 1)` → `['players','course','review']`
- `wizardSteps('game', 2)` → `['players','course','scoring','review']`
- `wizardSteps('tournament', 1)` → `['players','rounds','review']`
- `wizardSteps('tournament', 3)` → `['players','rounds','scoring','review']`
- `isStepValid('players', …)` — false for 0 players, true for ≥1.
- `isStepValid('course', …)` / `('rounds', …)` — false when any round lacks a
  course name, true when all are set.
- `isStepValid('scoring' | 'review', …)` — always true.

`handleStart()` behaviour is unchanged, so its output (the created tournament
object) is covered by existing tests; no new tests required there.

## Risks

- **File size:** `SetupScreen.js` already large. Extracting `WizardProgress`,
  `WizardNav`, and `setupWizard.js` keeps the orchestrator focused; step bodies
  stay inline as render functions to minimise churn.
- **Step index drift** after roster changes — mitigated by the clamping rule
  above.
