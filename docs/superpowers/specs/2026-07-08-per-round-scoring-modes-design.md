# Per-Round Scoring Modes — Design

**Date:** 2026-07-08
**Status:** Approved by user (design approved in conversation)

## Overview

Each round of a multi-round tournament can use a different scoring mode
(e.g. Round 1 Stableford, Round 2 Scramble — Pairs, Round 3 Pairs Match
Play). Today `scoringMode` is a single tournament-level setting.

## Data model

- `round.scoringMode` — optional per-round override. Absent → the round uses
  `tournament.settings.scoringMode` (which becomes the tournament's
  **default mode**). Legacy tournaments have no `round.scoringMode` and
  behave exactly as today.
- New helper — the single source of truth every consumer uses:

```js
// src/store/scoring.js
export function roundScoringMode(tournament, round) {
  return round?.scoringMode ?? tournament?.settings?.scoringMode ?? 'stableford';
}
```

- All current readers of `settings.scoringMode` for round-scoped behavior
  switch to the effective mode: scorecard facade (`scoreModel.js`),
  `HoleView`/`HolePage`/`GridView`, round summary, pairs building, per-round
  leaderboard values, personal stats, StatsScreen round-scoped sections.
- Mode validity stays roster-based (`isAllowed(playerCount)`) — the roster is
  shared by all rounds, so gating is unchanged per round.
- `bestBallValue` / `worstBallValue` / `fixedTeams` / `manualTeams` stay
  tournament-level (YAGNI on per-round config).
- Sync: `round.scoringMode` rides the existing round JSON; a new mutation
  `round.setScoringMode { roundId, scoringMode, pairs }` applies the mode and
  the rebuilt pairs for that round (mirrors `pairs.set` + settings patterns,
  with a `metaPathFor` entry covering both fields).

## Setting a round's mode

- **Setup wizard (scoring step):** the existing mode picker sets the default
  for all rounds. When the tournament has more than one round, a compact
  per-round list appears below it (Round N + course name + mode field, one
  per round) letting individual rounds override before creation.
- **After creation:** each round's options sheet (where Edit Teams lives)
  gains a "Round mode" item opening the mode sheet for that round only.
  Changing it rebuilds that round's teams via `buildTeamsForMode(newMode,
  roster)` and reinterprets existing scores under the new mode (user chose
  "always editable" — no lock on scored rounds).
- The tournament-level scoring settings sheet keeps its current meaning:
  change the default AND reset every round (existing
  `setScoringModeRoundPatches` behavior, which now also clears per-round
  overrides so the tournament is uniform again).

## Leaderboard

- **Uniform tournaments** (every round's effective mode identical — includes
  all legacy data): unchanged — native board + existing toggle.
- **Mixed tournaments:** overall standings = **individual Stableford summed
  across rounds**. Scramble rounds contribute each player's team Stableford
  points/strokes (reusing the per-player team aggregation from
  `tournamentScrambleLeaderboard`). The leaderboard toggle shows
  Stableford / Stroke Play. The per-round value column
  (`getSelectedRoundValue`) shows each round's native points (match-play
  holes, duel points, scramble team points…), so each round's own result
  stays visible in its own terms.
- A small helper decides which board to build:
  `tournamentHasMixedModes(tournament)`.

## Teams

- Pairs are already built per round; the shape now follows the round's
  effective mode.
- `fixedTeams` with mixed modes: a new round copies partnerships from the
  most recent earlier round whose mode has the **same team shape**
  (2×2 / 3+1 / 1×4); if none exists, it gets a fresh build. (Pure helper +
  tests.)
- `manualTeams`: unchanged — routes to the team editor for a round whose
  teams are not yet revealed; the editor already adapts per mode.

## Stats

- `personalStats.collectMyRounds`: the scramble exclusion moves from
  tournament level to per round — non-scramble rounds of a mixed tournament
  count toward personal stats; scramble rounds never do.
- StatsScreen: round-scoped sections use the effective mode of the round(s)
  in view; pair/H2H gating applies per round where team data exists. Mixed
  tournaments show pair stats only for rounds where they apply.

## Error handling / edge cases

- Round with `scoringMode` no longer valid for the roster (players
  added/removed): existing add/remove patch builders re-validate per round
  and fall back exactly as the tournament-level flow does today.
- Changing a scored round's mode: engines already return null/0 for shapes
  they can't score (e.g. scramble tally reads only captain scores); no data
  is deleted — switching back restores the previous interpretation.
- Scramble rounds in mixed tournaments have no individual scores; the
  Stableford overall uses team points for those rounds by design.

## Testing

- `roundScoringMode` fallback chain; `tournamentHasMixedModes`.
- Mixed-mode overall leaderboard (stableford + scramble team contribution),
  per-round native values.
- `round.setScoringMode` mutation (mode + pairs applied, meta paths).
- fixedTeams same-shape copy helper across mixed modes.
- Per-round stats exclusion.
- Wizard/per-round UI logic where a harness exists; otherwise documented
  manual traces (existing convention).

## Out of scope

- Per-round bestball values or team-option overrides.
- Official tournaments (separate format system).
- Cross-mode normalization schemes other than the Stableford total.
