# Round Scores — Leaderboard-Style UI — Design

**Date:** 2026-05-17
**Status:** Approved
**Topic:** Make the HomeScreen "ROUND SCORES" card render its results as ranked rows, matching the LEADERBOARD card's row UI.

## Problem

On `HomeScreen`, the **LEADERBOARD** card shows standings as ranked rows — a
numbered gold/silver/bronze rank badge, a name column, a primary value, and a
sub-value. The **ROUND SCORES** card directly below it shows per-round results
through four mode-specific cards (`StablefordRoundCard`, `MatchPlayRoundCard`,
`BestBallRoundCard`, `SindicatoRoundCard`), all built from a different
"pair block" style with a `WINNER` badge block and a preview-hint footer. The
two surfaces look inconsistent. This change gives the round-scores results the
same ranked-row layout as the leaderboard.

## Goals

- The four round cards render their results as ranked rows visually consistent
  with the LEADERBOARD card: numbered rank badge, name, primary value, optional
  sub-value, and a winner indicator.
- One shared row component, so the four cards stay in lockstep.
- Legible in both light and dark mode (the ROUND SCORES card keeps its normal
  theme background — it is not the leaderboard's green card).

## Non-Goals

- No change to the LEADERBOARD card itself.
- No change to the round tabs (R1/R2/R3) or the swipe pager.
- No change to `GameOverviewCard` (the richer single-round Game hero with the
  progress bar and stat cells) or `PairsPreviewCard` (the no-scores-yet
  fallback).
- No change to any scoring math — `roundPairLeaderboard`, `matchPlayRoundTally`,
  `calcBestWorstBall`, `sindicatoRoundTally` are untouched; only the cards'
  markup changes.

## Architecture

### Shared component — `RankedRow`

A new presentational component in `src/screens/HomeScreen.js`, modeled on the
LEADERBOARD card's row but theme-aware (the leaderboard's row uses hard-coded
white text suited to its green card; `RankedRow` uses `theme` colors so it is
legible on the normal card background).

Props: `{ rank, name, primary, sub, isWinner, theme, s }`.

- **Rank badge:** a circular numbered badge. Ranks 1/2/3 use gold / silver /
  bronze accents (the same `#ffd700` / `#c0c8d4` / `#daa06d` palette the
  leaderboard uses for `rankColor`); rank 4+ uses a neutral theme color. The
  badge background is a tint of the rank color.
- **Name column:** the entry name in `theme.text.primary`; rank 1 is bold. A
  gold `award` icon (`Feather name="award"`, `#ffd700`) renders to the right of
  the name when `isWinner` is true.
- **Primary value:** right-aligned, bold, in `theme.accent.primary`; rank 1
  renders one size larger (mirroring the leaderboard's `i === 0` size bump).
- **Sub value:** a small muted (`theme.text.muted`) value beneath/right of the
  primary, or omitted when `sub` is null.
- **Row 1 accent:** the leaderboard gives rank 1 a left gold border; `RankedRow`
  does the same for the winner row.

New theme-aware styles are added in `HomeScreen`'s `makeStyles`:
`rankedRow`, `rankedRowFirst`, `rankBadge`, `rankText`, `rankedNameCol`,
`rankedName`, `rankedPrimary`, `rankedSub`. The existing `masters*` styles are
left as-is (still used by the LEADERBOARD card).

### The four round cards

Each card keeps its existing ranking computation and only swaps its markup to
map its ranked entries onto `RankedRow`. The `WINNER` badge block and the
`pairBlock`/`pairHeader`/`pairNames`/`pairPoints` markup are removed from these
four cards; the winner is now shown by the rank-1 styling plus the award icon.

| Card | Rows (already ranked) | `name` | `primary` | `sub` | `isWinner` |
|---|---|---|---|---|---|
| `StablefordRoundCard` (Stableford + individual) | `roundPairLeaderboard` results | members joined by `" & "` | `{combinedPoints} pts` | `{combinedStrokes} str` | top row when the pair is clinched |
| `SindicatoRoundCard` | `sindicatoRoundTally().totals` | player name | `{points} pts` | `{strokes} str` | leader row when `clinched` |
| `BestBallRoundCard` | its 2 pairs ranked by total points | pair members joined by `" & "` | `{points} pts` | — | top row when the pair is clinched |
| `MatchPlayRoundCard` | 2 players, leader first | player name | `{n} holes` | — | leader row when `clinched` |

Notes:
- **Winner gating** keeps each card's current rule: a winner indicator shows
  only when scores make a result meaningful (e.g. `StablefordRoundCard` only
  when `competitive` and the pair is `clinched`; `MatchPlayRoundCard`/
  `SindicatoRoundCard` only when `clinched`) and `showRunning` is true.
- **`showRunning` off:** primary/sub values render as `—` and no winner
  indicator shows, exactly as the cards do today.
- **Match Play status footer:** `MatchPlayRoundCard` keeps its status line
  ("Alex 2 UP · 3 to play", "All square", "Alex wins 3&2", with halved count)
  as a footer below the rows — it conveys match state the ranked rows cannot.
  The other three cards drop their footer hint.
- **Strokes for `SindicatoRoundCard`:** the round's per-player gross strokes are
  summed from `round.scores` for the `sub` value (the same gross-strokes sum
  used elsewhere); `combinedStrokes` for Stableford already comes from
  `roundPairLeaderboard`.
- **Guard/empty states** (`MatchPlayRoundCard` "needs 2 players" / "No results
  yet", `SindicatoRoundCard` "needs 3 players" / "No results yet") are kept
  unchanged.

## Error handling

No new async or data paths. The cards already handle a null tally / wrong
player count with a fallback message; those paths are unchanged. `RankedRow` is
pure presentation.

## Testing

- No scoring logic changes, so the existing jest suites (`scoring`,
  `scoringModes`, `merge`) stay green and need no additions.
- The project has no React Native Testing Library, so the four round cards are
  verified manually with a structured checklist: for each mode, the round card
  shows ranked rows with rank badges; the winner row has the gold accent and
  award icon when the result is decided; values show `—` when the running-score
  eye toggle is off; Match Play still shows its status footer; the round tabs
  and swipe pager are unaffected; verified in both light and dark mode.
