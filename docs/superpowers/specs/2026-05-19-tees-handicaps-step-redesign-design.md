# Tees & Handicaps Step — Mobile Redesign

**Date:** 2026-05-19
**Status:** Approved
**Component:** `src/components/RoundTeeAssignments.js`

## Goal

Make the "Tees & Handicaps" step of the New Game / Tournament setup wizard
more user-friendly on mobile: modern, simple, and easy to operate one-handed.
The redesign is purely presentational — scoring and handicap math are unchanged.

## Problem

The current step packs everything onto one horizontal row per player: name +
wrapping tee-color chips on the left, then "Index X", an arrow icon, and a
50px-wide numeric input crammed on the right. On a narrow phone this is dense,
the index → handicap relationship is unclear, and the input is a small touch
target.

## Chosen Design — Compact List (option B)

One slim card per player. Collapsed by default; tap to expand an inline editor.

### Collapsed row

A single-tap-target card showing, left to right:

- **Initials avatar** — a circular badge with the player's initials.
- **Name.**
- **Tee summary** — a colored dot + tee label beneath the name
  (e.g. "● White tee"). If the player has no tee yet, show "Pick a tee".
- **Playing handicap** — shown in an accent-colored pill on the right.
- **Chevron** — pointing right when collapsed, down when expanded.

For a 4-player game the whole step fits on screen without scrolling.

### Expanded editor

Tapping a row expands it inline (the chevron rotates). **Only one player is
expanded at a time** — expanding one collapses any other.

The editor reveals:

- **Tee picker** — color pills (swatch + label), one per tee on the course.
  The selected pill is highlighted in the accent color. Selecting a tee
  re-runs the auto handicap calculation for that player (unless overridden).
- **Playing handicap control** — a stepper: `−` and `+` buttons (±1) on
  either side of the value. The **value itself is tappable**: tapping it
  turns it into an inline numeric input for typing a value directly; the
  input commits on blur. Stepping or typing marks the handicap as a manual
  override (`manualHandicaps[playerId] = true`). The stepper clamps the value
  to the range −9…54.

### Edge cases

- **Course with no tees** — the tee summary shows "No tees on this course";
  the expanded editor shows the same message in place of the pills. The
  handicap stepper still works (raw-index fallback, as today).
- **No players** — unchanged: "Add players first."

### Override indicator

Behavior carries over from today: when any handicap is a manual override, a
"Reset all to auto" button appears at the top of the list. Additionally, an
overridden player's collapsed row shows a small "Edited" marker so it is
visible without expanding. "Reset all to auto" clears all overrides and
recomputes every handicap from each player's tee.

### Tournaments

Unchanged. The host (`SetupScreen.renderTeesStep`) still renders one
`RoundTeeAssignments` per round under "Round 1 / 2 / 3" labels.

## Preserved Behavior (must not regress)

- **On-mount resolution** — the existing effect that assigns each player a
  default tee (last-used on the course, else the middle tee) and aligns
  non-manual handicaps is kept as-is.
- **`onChange` contract** — the component still emits exactly
  `{ playerTees, playerHandicaps, manualHandicaps }` with the same shapes
  and value types (`playerHandicaps` values are numbers). `SetupScreen`'s
  `handleRoundTeesChange` and all downstream logic are untouched.
- **Remount contract** — hosts still pass `key={round.id}`; no change.
- **First-render onChange suppression** — the component still skips emitting
  on the initial render.

## Component Structure

`RoundTeeAssignments.js` is rewritten internally:

- New local state: `expandedPlayerId` (string | null) — which row is open.
- New local state: `editingHandicapId` (string | null) — which row's value
  is currently in type-to-edit mode.
- Existing state (`playerTees`, `playerHandicaps`, `manualHandicaps`) and the
  two effects are kept.
- Two small **pure helpers are extracted and exported** for unit testing,
  matching the project's pure-function test convention:
  - `playerInitials(name)` → up to two uppercase initials.
  - `clampPlayingHandicap(n)` → integer clamped to −9…54.
- A collapsed-row sub-render and an expanded-editor sub-render, kept as
  local functions within the component.

## Out of Scope

- `TeesEditor.js` and `CourseEditorScreen` (course-level tee definitions).
- `src/store/tees.js`, `tournamentStore` handicap math.
- Wizard step ordering / `setupWizard.js`.
- Visual change to any other wizard step.

## Testing

Following the project convention (component tests exercise exported pure
functions, not rendered output), add `src/components/__tests__/roundTeeAssignments.test.js`:

- `playerInitials` — single name, two-word name, extra whitespace, empty.
- `clampPlayingHandicap` — within range, below −9, above 54, non-integer input.

The auto handicap math (`calcPlayingHandicap`) is already covered by
`tournamentStore` / `tees` tests and is not re-tested here. The full existing
suite must still pass.
