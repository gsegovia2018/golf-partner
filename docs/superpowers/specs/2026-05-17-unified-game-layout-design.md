# Unified Game Layout: Leaderboard + Round Scores — Design

**Date:** 2026-05-17
**Status:** Approved (pending spec review)
**Topic:** Every game and tournament, in every scoring mode, shows the same two cards — a green LEADERBOARD (mode-specific standings) and a white ROUND SCORES card (universal per-player Stableford performance).

## Problem

The HomeScreen tournament/game view is inconsistent:

- **Tournaments** show a green LEADERBOARD card + a ROUND SCORES card.
- **Single-round games** show only one card — and *which* card depends on
  the mode: individual/stableford games get the rich `GameOverviewCard`
  (progress bar, vs-par, holes-through); matchplay/bestball/sindicato games
  get the per-mode round card.
- The ROUND SCORES card itself is mode-specific — it shows Sindicato points
  for Sindicato, holes-won for Match Play, pair points for Best Ball, etc.

So a player cannot, for a single game, see *both* "how everyone actually
played" and "who is winning per the game's rules" — and no two modes look
alike.

## The model

Separate the two distinct questions a player has, into two fixed cards shown
**always, identically, for every game and tournament in every mode**:

1. **ROUND SCORES (white card)** — "How did everyone play golf?" The selected
   round's players ranked by **Stableford points**, with strokes. This is
   *universal* — it is computed and displayed the same way in every mode.

2. **LEADERBOARD (green card)** — "Who is winning?" The competitive standings
   *per the game's rules* — mode-specific. Cumulative across rounds for a
   tournament; the single round for a one-round game.

Uniformity is the governing principle: the GameOverviewCard divergence and the
four mode-specific round cards are removed so every game looks the same.

## Goals

- Both cards render for every game and every tournament, in every mode.
- ROUND SCORES is mode-independent (one component, no mode branching).
- LEADERBOARD shows the correct mode-specific standing, and renders for
  single-round games (today it is gated to tournaments).
- The layout is identical across modes ("every game the same").

## Non-Goals

- No change to scoring math (`roundTotals`, `tournamentLeaderboard`,
  `tournamentSindicatoLeaderboard`, `tournamentBestWorstLeaderboard`,
  `calcBestWorstBall`, `matchPlayRoundTally`) beyond one new aggregation
  function for Match Play standings.
- No change to the Scorecard screen, Setup, History, Feed, or Stats.
- No change to the round tabs / swipe pager mechanics.

## Architecture

### 1. ROUND SCORES card — one universal component

A single `RoundScoreboard` component replaces `StablefordRoundCard`,
`MatchPlayRoundCard`, `BestBallRoundCard`, and `SindicatoRoundCard` (all four
are deleted).

- Input: a `round` and the tournament `players`.
- Computes `roundTotals(round, players)` — already returns per-player
  `{ totalPoints (Stableford), totalStrokes }`.
- Renders, ranked by Stableford points descending, one `RankedRow` per player:
  `rank`, `name`, `primary = "{totalPoints} pts"`, `sub = "{totalStrokes} str"`.
- `isWinner` (award icon) on the top row once the round is decided — i.e. when
  the round is complete (all players scored every hole) and there is a sole
  top scorer. (No mode-specific clinch logic — Stableford has no early clinch.)
- `showRunning` off → values render `—`, exactly as the cards do today.
- White card — `RankedRow` stays theme-aware (it now only ever appears on the
  white ROUND SCORES card).
- The no-scores-yet state keeps `PairsPreviewCard` (teams revealed, no scores)
  and the `emptyRoundHint` fallback as today.
- The R1/R2/R3 round tabs and swipe pager are unchanged; the card still shows
  the selected round.

### 2. LEADERBOARD card — shown for games, with a Match Play branch

The existing green LEADERBOARD card (`mastersCard`) is unchanged in look. Two
changes:

- **Render it for games too:** remove the `!isGame` gate so single-round games
  get the leaderboard. For a one-round game the existing leaderboard functions
  iterate that single round, so they already produce the right result.
- **Mode routing** (the leaderboard data per mode):
  - `individual` / `stableford` → `tournamentLeaderboard` (cumulative per-player
    Stableford) — unchanged.
  - `bestball` → `tournamentBestWorstLeaderboard` via the existing
    Stableford/Best Ball toggle — unchanged.
  - `sindicato` → `tournamentSindicatoLeaderboard` — unchanged.
  - `matchplay` → **new.** Match Play has no points total; its standing is the
    match state. Add a pure `tournamentMatchPlayStandings(tournament)` in
    `scoring.js` that, across played rounds, sums each of the two players'
    holes won (via `matchPlayRoundTally`) and reports the overall leader, the
    aggregate lead, and a status string ("Alex 2 up", "All square"). The
    LEADERBOARD card renders the two players ranked by holes won, with the
    status as the card's summary line.

### 3. Retire `GameOverviewCard`

`GameOverviewCard` is removed from the render tree. Single-round
individual/stableford games now show the same LEADERBOARD + ROUND SCORES pair
as every other game. The component definition is deleted.

**Consequence (flag for review):** `GameOverviewCard` showed a holes-played
progress bar and per-player "through" and "vs par" figures. The unified ROUND
SCORES card shows Stableford points + strokes only. If the progress / through /
vs-par information must be preserved, that is an additional decision — this
spec drops it for uniformity.

### 4. Card order

LEADERBOARD on top, ROUND SCORES below — the current tournament order, now
applied uniformly to games as well.

## Known consequences (review checkpoints)

1. **`GameOverviewCard` retired** — loses the progress bar / through / vs-par
   stats (see §3).
2. **Stableford with Partners:** the per-round *pair-vs-pair* result no longer
   has a dedicated card. ROUND SCORES shows individual Stableford; LEADERBOARD
   shows cumulative individual Stableford (`tournamentLeaderboard`). Partners
   are still visible via the teams view. There is no cumulative pair standing
   because partners are randomised every round — this is a pre-existing
   constraint, not introduced here.
3. The four mode-specific round-card components are deleted; `RankedRow` is
   kept and reused by `RoundScoreboard`.

## Error handling

No new async or data paths. `roundTotals` and the leaderboard functions already
handle empty/partial rounds. `RoundScoreboard` shows the existing no-scores
states. `tournamentMatchPlayStandings` returns `null` when the roster is not
exactly 2 players or no round has scores, and the card falls back to a
"No results yet" message — mirroring the existing card guards.

## Testing

- `scoring.js`: TDD the new `tournamentMatchPlayStandings` — holes-won
  aggregation across rounds, the leader/lead/status output, the 2-player guard,
  and the no-scores guard.
- No other scoring math changes, so the existing `scoring` / `scoringModes` /
  `merge` jest suites stay green.
- The project has no React Native Testing Library; the UI (`RoundScoreboard`,
  the leaderboard rendering for games, the removal of `GameOverviewCard`) is
  verified manually and with Playwright against the running web build, for each
  mode: both cards appear, ROUND SCORES shows per-player Stableford + strokes
  identically across modes, LEADERBOARD shows the correct mode standing, and a
  single-round game shows the same two-card layout as a tournament.
