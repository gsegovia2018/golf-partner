# Scoring Mode Selector — Design

**Date:** 2026-05-17
**Status:** Approved
**Topic:** Replace the inline scoring-mode list with a scalable bottom-sheet selector.

## Problem

`ScoringModePicker` renders all scoring modes as a flat vertical list of
cards on `SetupScreen` and `EditTournamentScreen`. This works for the
current four modes but does not scale — adding more modes makes the setup
screen grow unbounded. Two related issues compound it:

1. The list takes a large, fixed amount of vertical space regardless of
   how many modes are relevant.
2. When the player count changes and the chosen mode becomes invalid, a
   `useEffect` silently rewrites the user's selection with no feedback.

## Goals

- Keep the setup screen compact: one row for scoring mode, not N cards.
- Scale gracefully to an arbitrary number of modes.
- Preserve the rich per-mode presentation (icon, subtitle, the
  "needs N players" requirement) that a plain dropdown would lose.
- Make the automatic mode fallback visible instead of silent.

## Non-Goals

- Search inside the sheet (only four modes today — deferred, see below).
- Changing scoring logic, `SCORING_MODES` definitions, or the
  `isScoringModeAllowed` / `fallbackScoringMode` contracts.
- Changing when the Scoring section appears (still `players.length >= 2`).

## Architecture

`src/components/ScoringModePicker.js` keeps its role as the public entry
point and continues to export `SCORING_MODES`, `isScoringModeAllowed`,
and `fallbackScoringMode` unchanged. It is restructured into two units:

### `ScoringModeField` (new default export)

The compact row shown on `SetupScreen` / `EditTournamentScreen`.

- Props: identical to today's `ScoringModePicker`
  (`value`, `onChange`, `playerCount`, `settings`, `onSettingsChange`).
- Renders the **current** mode's icon + label + subtitle + a
  `chevron-down`. Tapping opens `ScoringModeSheet`.
- Below the row, the Best Ball / Worst Ball value inputs remain inline,
  shown only when `value === 'bestball'` — unchanged from today.
- When the parent's auto-fallback effect changes `value` because the
  player count made it invalid, the field shows a dismissable note
  (see "Visible fallback" below).

### `ScoringModeSheet` (new internal component)

A bottom-sheet modal listing every mode, following the existing
`CaptureMenuSheet` pattern:

- `Modal` with `transparent`, `animationType="slide"`,
  `onRequestClose`, a dark backdrop `TouchableOpacity` that closes on
  press, and a rounded-top sheet pinned to the bottom.
- Content is wrapped in a `ScrollView` with `maxHeight` ~75% of screen
  height so any number of modes fits without overflow.
- Modes are grouped under category headers: `SOLO`, `HEAD-TO-HEAD`,
  `TEAMS`.
- Each row: icon, label, subtitle, and a `check` icon on the selected
  mode.
- Disabled modes (`isAllowed(playerCount)` false): dimmed, the subtitle
  replaced by a small pill showing `requirement` text (e.g.
  "Requires exactly 4 players"), and not tappable.
- Tapping an allowed mode calls `onChange(key)` and closes the sheet.

### Data change

Each entry in `SCORING_MODES` gains a `category` field:

| key          | category       |
|--------------|----------------|
| `individual` | `Solo`         |
| `stableford` | `Solo`         |
| `matchplay`  | `Head-to-head` |
| `bestball`   | `Teams`        |

The sheet derives its section list from the distinct `category` values
in declaration order. No other field changes.

## Visible fallback

The silent swap stays functionally (it prevents an invalid game) but
becomes visible. `ScoringModeField` tracks the previous `value`; when it
detects `value` changed without a user tap in the sheet, it shows a
dismissable note below the row:

> Match Play needs exactly 2 players — switched to Stableford.

The note text is built from the previously selected mode's `label` and
`requirement` plus the new mode's `label`. It clears when the user opens
the sheet or taps its dismiss control.

## Error handling

- No new async or I/O paths are introduced; the selector is pure UI
  state. There are no new failure modes.
- Existing input validation for Best Ball / Worst Ball values
  (`parseInt(...) || 1` at tournament creation) is unchanged.
- If `value` is somehow not a known mode key, `ScoringModeField` falls
  back to rendering the first allowed mode's presentation rather than
  crashing (defensive `find` with a default).

## Testing

- The pure helpers `isScoringModeAllowed` and `fallbackScoringMode` are
  unchanged; their existing behavior is covered by the scoring test
  suite and stays green.
- Manual verification on `SetupScreen` and `EditTournamentScreen`:
  - Field shows the current mode; sheet opens and closes.
  - Selecting each mode updates the field and persists on save.
  - Disabled modes are visible, explained, and non-tappable.
  - Changing player count so the current mode becomes invalid shows the
    fallback note.
  - Best Ball value inputs still appear inline when `bestball` is
    selected.

## Deferred (YAGNI)

- **Search field** inside the sheet: not built while there are only a
  few modes. The sheet is structured so a search `TextInput` can be
  added above the grouped list later without restructuring.
