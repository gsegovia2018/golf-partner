# Round Scores Format + "Me-First" Ordering — Design

**Date:** 2026-05-17
**Status:** Approved (pending spec review)
**Topic:** Revert the ROUND SCORES rows to a labeled stat-cell layout (no winner highlight), and order players "me-first" in both the ROUND SCORES card and the scorecard.

## Problem

Two issues with the current ROUND SCORES card (`RoundScoreboard`):

1. It renders each player as a `RankedRow` — a rank badge, a gold winner highlight, and an award icon. The round-scores card is the "how everyone played" view; it does not need to show who is winning (that is the LEADERBOARD card's job). The earlier `GameOverviewCard` stat-cell layout was preferred.
2. Players are ordered by points. The user wants to see themselves first, then everyone else in the order they joined — and the same "me-first" ordering on the scorecard.

## Goals

- ROUND SCORES rows: name + three labeled stat cells — **POINTS | STROKES | VS PAR** — no rank badge, no winner highlight, no award icon.
- Players in the ROUND SCORES card are ordered **"me" first, then the rest in the order they were added**.
- The scorecard (`ScorecardScreen`) lists players **"me" first** too — in the per-hole hero cards and the grid.

## Non-Goals

- No change to scoring math or to the green LEADERBOARD card (it keeps its points-ranked order — it *is* the standings).
- No change to the progress bar (it stays at the top of the ROUND SCORES card).
- No change to how `tournament.meId` is determined (the existing pick-me / auto-link flow is unchanged).

## Architecture

### 1. Shared ordering helper — `src/lib/playerOrder.js` (new, pure, unit-tested)

```
playersMeFirst(players, meId)
```
Returns a new array: the player whose `id === meId` moved to the front, every other player keeping its existing relative order. If `meId` is null/absent or matches no player, returns the players in their original order (a copy).

This is a display-ordering helper only. It is **never** applied to the `players` array passed into scoring functions (`matchPlayRoundTally`, `sindicatoHolePoints`, etc., which label results by array index) — only to the arrays used for rendering rows.

### 2. ROUND SCORES card — `RoundScoreboard` (`src/screens/HomeScreen.js`)

- **Row layout:** drop `RankedRow`. Each player renders as a `GameOverviewCard`-style block — the player name, then a `gameStatsRow` of three `gameStatCell`s: **POINTS**, **STROKES**, **VS PAR**, separated by `gameStatDivider`s. These `gameStat*` / `gamePlayerCard` styles already exist in the file (left in place when `GameOverviewCard` was retired) and are reused. vs-par keeps its color treatment (`gameStatValueGood` under par, `gameStatValueWarn` over par).
- **No** rank badge, gold border, winner highlight, or award icon. The `decided` / `isWinner` logic is removed.
- **Order:** `playersMeFirst(players, meId)` — me first, then added order. (Not sorted by points.)
- The progress bar at the top is unchanged.
- `RoundScoreboard` gains a `meId` prop, threaded `HomeScreen → RoundPage → RoundScoreboard` from `tournament.meId`.

### 3. Delete `RankedRow`

After §2, `RankedRow` is used by nothing (the LEADERBOARD card has its own `mastersRow` markup). Delete the `RankedRow` component and its `ranked*` styles (`rankedRow`, `rankedRowFirst`, `rankBadge`, `rankText`, `rankedNameCol`, `rankedName`, `rankedPrimary`, `rankedSub`, `rankedSub2`).

### 4. Scorecard "me-first" ordering — `src/screens/ScorecardScreen.js`

`ScorecardScreen` already computes an `orderedPlayers` display array in two places — `HolePage` and `GridView` — currently:
```
orderedPlayers = (pair-grouped layout?) ? [...pairs[0], ...pairs[1]] mapped to players : players
```
Apply "me-first" to the display ordering:
- **Non-pair (hero-card) layouts** — `individual`, `stableford`, `matchplay`, `sindicato`: `orderedPlayers = playersMeFirst(players, meId)`.
- **Best Ball pair-grouped layouts**: keep pairs visually grouped, but order so the pair containing "me" comes first and "me" is first within that pair — i.e. reorder the two pairs so the me-pair leads, then `playersMeFirst` within each pair. (If `meId` is null, ordering is unchanged.)

`meId` is already available in `ScorecardScreen` as `tournament?.meId`. Only the `orderedPlayers` *display* arrays change; every `players` argument passed to a scoring function stays in its original order.

## Error handling

`playersMeFirst` is a pure array transform with no failure modes — a missing/unknown `meId` simply yields the original order. No new async or data paths. The scorecard's existing `MePicker` ("who are you?" prompt when `meId` is null) is unchanged.

## Testing

- `src/lib/playerOrder.js`: TDD `playersMeFirst` — me moved to front, others keep relative order; `meId` null → unchanged; `meId` matches nobody → unchanged; me already first → unchanged; does not mutate the input array.
- No scoring math changes — the existing `scoring` / `scoringModes` / `merge` jest suites stay green.
- The UI (`RoundScoreboard` stat-cell rows, deletion of `RankedRow`, scorecard ordering) is verified manually and with Playwright against the running web build: the ROUND SCORES card shows name + POINTS/STROKES/VS PAR cells with no rank badge or highlight; "me" is the first row in the ROUND SCORES card and the first player on the scorecard; Best Ball keeps pairs grouped with the me-pair first; verified in light and dark mode.
