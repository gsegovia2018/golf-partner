# Generalized Leaderboard Toggle — Design

**Date:** 2026-05-17
**Status:** Approved (pending spec review)
**Topic:** Make the HomeScreen LEADERBOARD card's view toggle mode-aware — per-mode labels, with a new "Stroke Play" alternate for Stableford modes.

## Problem

The LEADERBOARD card on `HomeScreen` has a two-way toggle hard-coded as
**"Stableford / Best Ball"**, and it only renders for Best Ball games
(`bestBallAvailable`). That is wrong for every other mode: a Sindicato or Match
Play game should not offer a "Best Ball" view, and a plain Stableford game has
no second view at all.

## Goals

- The toggle appears for **every** mode (whenever the leaderboard renders).
- Its two labels are **mode-dependent**: the mode's native view on the left,
  the alternate on the right.
- Stableford modes gain a new **Stroke Play** alternate view (rank by gross
  strokes, lowest first).
- Every non-Stableford mode's alternate is the **Stableford** view.

## Non-Goals

- No new scoring math — Stroke Play reuses `tournamentLeaderboard`'s existing
  per-player gross-stroke totals, only re-sorted.
- No change to the ROUND SCORES card, the scorecard, or any other screen.
- The leaderboard still only renders for 2+ players (solo games show none) —
  unchanged.

## The toggle

The LEADERBOARD card always shows the toggle. **Left = the mode's native view
(the default); right = the alternate.** A single boolean — `leaderboardAlt`
(replacing the current `leaderboardBestBall`) — is `false` for the native view,
`true` for the alternate. It defaults to `false` for every mode.

| Scoring mode | Left label / native view | Right label / alternate view |
|---|---|---|
| `individual`, `stableford` | **Stableford** — `tournamentLeaderboard`, sorted by points desc | **Stroke Play** — `tournamentLeaderboard` entries re-sorted by gross strokes asc |
| `matchplay` | **Match Play** — `tournamentMatchPlayStandings().board` | **Stableford** — `tournamentLeaderboard` |
| `sindicato` | **Sindicato** — `tournamentSindicatoLeaderboard` | **Stableford** — `tournamentLeaderboard` |
| `bestball` | **Best Ball** — `tournamentBestWorstLeaderboard` | **Stableford** — `tournamentLeaderboard` |

A small pure helper derives the label pair from the mode, e.g.
`leaderboardToggleLabels(scoringMode)` → `{ left, right }`. `individual` and
`stableford` both count as "Stableford scoring" and get the
`Stableford / Stroke Play` pair.

## Architecture

### Leaderboard board selection (`HomeScreen`)

- `leaderboardBestBall` state → renamed `leaderboardAlt` (a plain
  show-alternate boolean). It defaults to `false`; when the tournament or
  scoring mode changes it resets to `false`. The current Best-Ball-only
  "default the toggle on" effect is removed — every mode defaults to its
  native view.
- The displayed board is chosen by `(scoringMode, leaderboardAlt)`:
  - **Stableford modes** — native: `tournamentLeaderboard` sorted by points
    descending (today's behavior). Alternate (Stroke Play): the same
    `tournamentLeaderboard` entries sorted by **gross strokes ascending**. A
    player who has not teed off (0 strokes) sorts to the **bottom**, not the
    top.
  - **`matchplay` / `sindicato` / `bestball`** — native: the mode's existing
    board (`matchPlayStandings.board` / `tournamentSindicatoLeaderboard` /
    `tournamentBestWorstLeaderboard`). Alternate: `tournamentLeaderboard`
    (the Stableford board).
- All four board sources already exist; only the selection logic and the
  Stroke Play re-sort are new.

### Row rendering (the LEADERBOARD card)

Each leaderboard row shows a prominent value. It is driven by the **active
view**, not hard-coded:

- **Stroke Play** view → the prominent value is the player's **gross strokes**
  (e.g. `78`); the small sub-value shows points.
- **Match Play** native view → `N holes` (today's behavior).
- All other views → `N pts` (today's behavior).

The clinch award icon and the per-round sub-line keep their current behavior;
the per-round sub-line continues to show the round's points value.

### Other `leaderboardBestBall` consumers

`leaderboardBestBall` currently also gates `selectedRoundPlayerTotals` and
`selectedRoundBB` (the per-round sub-line data). After the rename to
`leaderboardAlt`:
- `selectedRoundBB` (per-round Best Ball data) must be computed only when the
  mode is `bestball` **and** `leaderboardAlt` is false (Best Ball is now the
  *native* view for `bestball`, i.e. toggle off) — the inverse of today's
  condition. The plan pins the exact predicate.
- `selectedRoundPlayerTotals` is used for the Stableford-style per-round
  sub-line; it is computed for every non-Best-Ball-native view.

## Error handling

No new async or data paths. The Stroke Play sort is a pure array re-sort of an
already-computed board. A 1-player game shows no leaderboard at all (existing
behavior), so the toggle is never shown without a real contest.

## Testing

- `leaderboardToggleLabels(scoringMode)` is pure — TDD it: `individual` and
  `stableford` → `{ left: 'Stableford', right: 'Stroke Play' }`; `matchplay` →
  `{ left: 'Match Play', right: 'Stableford' }`; `sindicato` →
  `{ left: 'Sindicato', right: 'Stableford' }`; `bestball` →
  `{ left: 'Best Ball', right: 'Stableford' }`.
- If the Stroke Play sort is extracted as a pure helper, TDD it too: ascending
  by gross strokes; 0-stroke players last.
- No other scoring math changes — the existing `scoring` / `scoringModes` /
  `merge` jest suites stay green.
- The LEADERBOARD card UI is verified manually and with Playwright: for each
  mode the toggle shows the correct two labels; flipping it swaps the board and
  the prominent row value; Stableford's Stroke Play view ranks by gross strokes
  (lowest first); verified in light and dark mode.
