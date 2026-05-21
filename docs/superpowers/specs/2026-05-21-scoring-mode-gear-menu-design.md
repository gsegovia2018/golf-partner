# Design Spec: Extract Scoring-Mode Change to the Tournament-View Gear Menu

**Date:** 2026-05-21
**Status:** Approved — ready for implementation planning

## Problem

Changing a tournament's scoring mode (Stableford, Match Play, Sindicato, Best
Ball, etc.) is currently buried inside the **Edit Tournament / Edit Round**
screen as a "Scoring Mode" section. To reach it a user must open the gear menu
on the Tournament (round-info) view, tap "Edit Tournament/Round", then scroll
to the section. This is an awkward path for a setting players commonly want to
adjust between rounds.

The goal is to **extract** the scoring-mode control so it is a first-class,
direct item in the gear settings menu of the Tournament view.

## Goals

- Add a "Scoring Mode" item directly to the gear settings bottom-sheet on the
  Tournament view.
- Tapping it opens a bottom-sheet to change the mode, including the Best Ball
  point-value inputs.
- Remove the "Scoring Mode" section from the Edit Tournament/Round screen —
  there is exactly one place to change it.
- No functional regression: Best Ball `bestBallValue` / `worstBallValue`
  editing is preserved.

## Non-Goals

- No change to the Scorecard screen. Its transient `ScoringModeChangeBanner`
  (shown when a player-count change forces a mode fallback) is untouched and
  continues to react to `settings.scoringMode` changing.
- No new navigation route or screen.
- No changes to `mutate.js`, the store, or scoring logic.
- The setup wizard (`SetupScreen`) keeps its mode picker for new games — out
  of scope.

## Current State

- **Gear menu:** `HomeScreen.js` Tournament view renders a gear icon
  (~line 1240) that opens a settings bottom-sheet `Modal` (`showSettings`,
  ~line 1664). Menu rows follow a consistent layout: `<Feather icon>` +
  `<Text label>` + `<Feather chevron-right>`. Editor-only rows are gated by
  `!isViewer`.
- **Scoring-mode control:** `ScoringModeField` — the default export of
  `src/components/ScoringModePicker.js`. It renders the mode list (via its own
  internal picker sheet) and, when Best Ball is selected, two `TextInput`s for
  `bestBallValue` / `worstBallValue`. It disables modes that are invalid for
  the current player count.
- **Today's host:** `EditTournamentScreen.js` lines 415–424 render
  `ScoringModeField` inline. Best Ball values are held in `settings` state as
  **strings** (line 63) and `parseInt`-ed on save (lines 153–154). The whole
  `settings` object is persisted via `saveTournament(...)` (whole-blob save).
- **Persistence pattern:** `EditTournamentScreen.handleSave` and several
  `HomeScreen` handlers (lines 447–491) use `await saveTournament(updated);
  await reload();`. The mode key alone also has a sync-safe mutation
  (`tournament.setScoringMode`), but Best Ball values have no mutation — only
  whole-blob `saveTournament` covers them.

## Design

### 1. New gear menu item

In `HomeScreen.js`, inside the `showSettings` `Modal`, add a **"Scoring Mode"**
`TouchableOpacity` row:

- Layout identical to existing rows: `sliders` Feather icon (size 18,
  `theme.accent.primary`) + `<Text style={s.menuItemText}>Scoring Mode</Text>`
  + `chevron-right`.
- Gated by `!isViewer` — only editors/owners change settings.
- Placed immediately **above** the "Edit Tournament / Edit Round" row, as a
  configuration sibling. Applies to both `kind: 'game'` and `kind:
  'tournament'`, single- and multi-round (scoring mode is tournament-wide).
- `onPress`: `setShowSettings(false)` then `setShowScoringModeSheet(true)`.

### 2. New "Scoring Mode" bottom-sheet

A new `Modal` in `HomeScreen.js` controlled by a new state
`showScoringModeSheet` (boolean). Styled with the existing sheet styles
(`modalBackdrop`, `modalSheet`, `modalHandle`, `modalTitle`). Contents:

- Title: "Scoring Mode".
- The existing `ScoringModeField` component (default export of
  `ScoringModePicker.js`), rendering the mode list and the conditional Best
  Ball point inputs.
- A **Cancel** and a **Save** button.

**Draft state.** A new state object `scoringDraft`, initialized from
`tournament.settings` when the sheet opens, holding:

- `scoringMode` — the mode key.
- `bestBallValue` / `worstBallValue` — held **as strings** (mirroring
  `EditTournamentScreen` line 63, because the inputs are `TextInput`s).

`ScoringModeField` is wired as:

- `value={scoringDraft.scoringMode}`
- `onChange={(mode) => setScoringDraft((d) => ({ ...d, scoringMode: mode }))}`
- `playerCount={tournament.players.length}`
- `settings={scoringDraft}`
- `onSettingsChange={(next) => setScoringDraft(next)}`

Initialize the draft in the menu item's `onPress`, immediately before
`setShowScoringModeSheet(true)`, from the current `tournament.settings` — so it
always reflects the latest saved settings when the sheet opens.

**Validation.** `ScoringModeField` already disables modes invalid for the
given `playerCount`, so no additional guard is required.

### 3. Persistence

On **Save**:

```js
const updated = {
  ...tournament,
  settings: {
    ...tournament.settings,
    ...scoringDraft,
    bestBallValue: parseInt(scoringDraft.bestBallValue, 10) || 1,
    worstBallValue: parseInt(scoringDraft.worstBallValue, 10) || 1,
  },
};
await saveTournament(updated);
await reload();
setShowScoringModeSheet(false);
```

This is the exact persistence path `EditTournamentScreen` uses for settings and
that `HomeScreen` already uses elsewhere (lines 447–491) — a faithful
relocation with no behavior change. `saveTournament` is the established
offline-safe settings path.

On **Cancel**: close the sheet, discard the draft (no persistence).

**Side effects.** The Scorecard's `ScoringModeChangeBanner` is driven by
`settings.scoringMode` changing across a reload — it continues to work
unchanged once the new settings round-trip.

### 4. Remove from Edit Tournament screen

In `EditTournamentScreen.js`:

- Delete the "Scoring Mode" `<View>` block (lines 415–424, the
  `<Text>Scoring Mode</Text>` + `<ScoringModePicker .../>`).
- Change the import on line 15 to drop the default `ScoringModePicker` import
  but **keep** the named helpers, which the validation effect still needs:
  `import { isScoringModeAllowed, fallbackScoringMode } from
  '../components/ScoringModePicker';`
- **Keep** the scoring-mode validation effect (lines 172–175): when players
  change in the Edit screen it still keeps `settings.scoringMode` valid, and
  Edit still saves `settings`.
- **Keep** the Best Ball string/`parseInt` handling (lines 63, 153–154): Edit
  no longer shows the inputs but still round-trips the values untouched
  through `settings`.

## Files Touched

| File | Change |
|------|--------|
| `src/screens/HomeScreen.js` | New "Scoring Mode" menu item; new `showScoringModeSheet` Modal; `scoringDraft` state; save handler |
| `src/screens/EditTournamentScreen.js` | Remove "Scoring Mode" section; narrow the `ScoringModePicker` import to named helpers only |

No new files, no new routes, no `mutate.js` / store / scoring-logic changes.

## Testing

- Scoring helpers (`scoringModes.js`, `isScoringModeAllowed`,
  `fallbackScoringMode`) already have lib tests — unaffected.
- Manual / UI verification:
  - Gear → "Scoring Mode" opens the sheet for editors; the item is **absent**
    for viewers.
  - Picking a mode and tapping Save persists it and reflects on the
    leaderboard and scorecard.
  - Selecting Best Ball reveals the `bestBallValue` / `worstBallValue` inputs;
    edited values persist.
  - Cancel discards changes.
  - The Edit Tournament/Round screen no longer shows a Scoring Mode section
    and still saves without error.
- Run `npm test` and `npm run lint` — both must stay green.
