# Sindicato Scoring Mode — Design

**Date:** 2026-05-17
**Status:** Approved
**Topic:** Add "Sindicato", a 3-player per-hole points scoring mode, with full bespoke UI.

## Problem

The app supports four scoring modes (`individual`, `stableford`, `matchplay`,
`bestball`). Sindicato — a 3-player hole-by-hole points game popular in Spanish
golf clubs — is not available. This adds it as a first-class mode with the same
depth of UI integration as Match Play.

## The game

Source: <https://www.golfsitges.com/modalidades-de-juego>.

- Exactly **3 players**, each playing their own ball (solo — no teams).
- Each hole puts **6 points** in play, distributed by the hole result:
  - All three tie → **2 / 2 / 2**
  - Two tie for the win, one behind → **3 / 3 / 0**
  - One wins, the other two tie → **4 / 1 / 1**
  - Three distinct results → **4 / 2 / 0**
- The hole result ranks players by **net strokes** (gross strokes minus the
  player's handicap stroke allowance on that hole — same net-stroke basis the
  app's Match Play already uses).
- Most cumulative points after all holes wins.

## Goals

- `sindicato` is a selectable scoring mode, valid only for exactly 3 players.
- Correct, unit-tested per-hole and cumulative scoring.
- Bespoke UI on par with Match Play: per-hole points on the scorecard, a live
  standings/status surface, and a clinch indicator.

## Non-Goals

- No configurable point values — the 6-point distribution is fixed.
- No 2- or 4-player Sindicato variants.
- No new tournament-history or stats-screen breakdowns specific to Sindicato
  beyond what the shared tournament leaderboard already shows.

## Architecture

### 1. Engine — `src/store/scoring.js` (pure, unit-tested)

Two new pure functions, alongside the existing `matchPlay*` functions:

**`sindicatoHolePoints(hole, players, scores, playerHandicapsByPlayerId)`**
- Returns `null` if `players.length !== 3`, or if any of the 3 players has no
  score for `hole.number` (the hole is not yet decidable).
- Computes each player's net strokes:
  `gross − calcExtraShots(playerHandicap, hole.strokeIndex)`, where the
  handicap is `playerHandicapsByPlayerId[id] ?? player.handicap ?? 0`.
- Ranks the 3 by net strokes ascending (lower is better) and returns
  `{ [playerId]: points }` per the 6-point table:
  - all three net-equal → each `2`
  - two tied as lowest, one higher → the two get `3`, the third `0`
  - one lowest, two tied higher → the winner `4`, the other two `1`
  - all three distinct → `4`, `2`, `0`
- The four point values always sum to 6.

**`sindicatoRoundTally(round, players)`**
- Returns `null` if `players.length !== 3`.
- Iterates `round.holes`, calls `sindicatoHolePoints` for each, and accumulates
  per-player point totals. A hole returning `null` is counted as not played.
- Returns:
  ```
  {
    totals: [{ player, points }],   // sorted points descending
    played,                          // holes with a result
    holesLeft,                       // round.holes.length − played
    leaderIdx,                       // index into `totals` of sole leader, or null if tied
    lead,                            // totals[0].points − totals[1].points
    clinched,                        // boolean — see clinch rule
  }
  ```
- **Clinch rule:** a trailing player gains at most 4 points per remaining hole,
  so the leader has clinched when there is a sole leader and
  `lead > holesLeft × 4`.

### 2. Mode definition — `src/components/scoringModes.js`

A new entry in `SCORING_MODES`, inserted after `matchplay` (keeping the fixed
ordering: solo, then head-to-head, then teams):

```
{
  key: 'sindicato',
  label: 'Sindicato',
  subtitle: 'Three-way points, hole by hole',
  icon: 'pie-chart',
  category: 'Head-to-head',
  teams: false,
  isAllowed: (count) => count === 3,
  requirement: 'Requires exactly 3 players',
}
```

No change to `isScoringModeAllowed`, `fallbackScoringMode`,
`scoringModeUsesTeams`, `scoringModeCategories`, or `fallbackNoticeText` — they
all derive from `SCORING_MODES` and pick up the new entry automatically.

### 3. Pair building — `SetupScreen`, `EditTournamentScreen`, `NextRoundScreen`

Sindicato plays solo: `round.pairs` is `[[p1], [p2], [p3]]`.

Today each screen special-cases `individual` and `matchplay` for pair building.
Every non-teams mode in fact uses solo pairs (`players.map(p => [p])`), and
`matchplay`'s `[[p1], [p2]]` is exactly that. So each screen's `buildPairs`
logic is unified to:

```
scoringModeUsesTeams(mode) ? randomPairs(players) : players.map((p) => [p])
```

This is behavior-identical for all four existing modes and requires no further
change for Sindicato or any future solo mode. The Match-Play-specific settings
override in `SetupScreen` (`bestBallValue: 1, worstBallValue: 0`) is unrelated
and stays as-is.

### 4. Tournament standings — `src/store/tournamentStore.js`

Sindicato standings are kept off the shared `roundTotals` /
`roundPairLeaderboard` path to avoid any risk to Stableford/Match Play/Best Ball.

**`tournamentSindicatoLeaderboard(tournament)`** — new exported function.
Iterates played rounds (`isRoundPlayed`), sums `sindicatoRoundTally` point
totals per player, and returns `[{ player, points }]` sorted descending.

**`tournamentPlayerClinched(tournament, mode)`** — gains a `sindicato` branch.
The tournament is clinched for the sole overall leader when their lead over
second place exceeds the maximum still attainable: the count of holes not yet
played across all current/future rounds, multiplied by 4. Played-hole counting
mirrors the existing `bestball` branch's structure.

`roundPairClinched` is **not** modified: it already returns `null` early unless
`round.pairs.length >= 2` with team semantics; Sindicato's standings and clinch
come solely from `sindicatoRoundTally` / `tournamentPlayerClinched`, exactly as
Match Play's come from `matchPlayRoundTally`.

### 5. Bespoke UI

**`src/screens/ScorecardScreen.js`**
- `playerTotalsMap`: add an `isSindicato` branch that adds
  `sindicatoHolePoints(...)?.[player.id] ?? 0` per hole (mirrors the
  `isMatchPlay` branch).
- `HolePage` `mode` prop: extend the existing
  `matchplay | bestball | stableford` selector to also yield `'sindicato'`.
- `HolePage` per-hole points: add a `mode === 'sindicato'` branch using
  `sindicatoHolePoints`.
- `GridView`: extend its local `mode` variable, the `holePts` helper, the
  totals accumulation, and the totals-header label (shows `SINDICATO`).
- Add a live status banner for Sindicato showing each player's running points
  and the leader/clinch state, derived from `sindicatoRoundTally`.

**`src/screens/HomeScreen.js`**
- New `SindicatoRoundCard` component, mirroring `MatchPlayRoundCard`: three
  rows (one per player) showing each player's points, ordered leader-first,
  with a leader status line and a `WINNER` badge + award icon when clinched.
  It reuses the existing `pairBlock` / `winnerBlock` / `winnerBadge` /
  `pairHeader` / `pairNames` / `pairPoints` / `pairsPreviewHint` styles.
- Round-card branch: render `SindicatoRoundCard` when
  `settings?.scoringMode === 'sindicato'`.
- `GameOverviewCard` exclusion: exclude `sindicato` alongside `matchplay` and
  `bestball` (it is a per-hole game, not a single-figure overview).
- Tournament leaderboard branch: when the mode is `sindicato`, use
  `tournamentSindicatoLeaderboard`; clinch uses `tournamentPlayerClinched`.

## Per-hole point colors

Sindicato per-hole points range 0–4. The scorecard reuses the existing points
color treatment used for Stableford-style points (higher is better): the exact
mapping is an implementation detail left to the plan, with 4 as the strongest
positive and 0 as the weakest.

## Error handling

- `sindicatoHolePoints` / `sindicatoRoundTally` return `null` for the wrong
  player count or incomplete data; every UI caller already handles a `null`
  tally (the Match Play card shows a fallback message) and Sindicato callers
  follow the same pattern.
- The mode is gated to exactly 3 players at setup time by `isAllowed`, and the
  existing auto-fallback (`fallbackScoringMode`) switches away if the roster
  changes — no new failure path.

## Testing

- `scoring.js`: TDD `sindicatoHolePoints` (each of the four distribution cases,
  the wrong-count guard, the incomplete-hole guard, handicap effect on ranking)
  and `sindicatoRoundTally` (accumulation, `holesLeft`, `leaderIdx` tie → null,
  the clinch boundary at exactly `holesLeft × 4` and just past it).
- `tournamentStore.js`: test `tournamentSindicatoLeaderboard` accumulation
  across rounds and the `sindicato` branch of `tournamentPlayerClinched`.
- The unit tests run under jest + jest-expo, importing pure modules only
  (`scoring.js`, `tournamentStore.js` are AsyncStorage-free for these paths —
  matching the existing `scoring.test.js` / `merge.test.js` suites).
- UI changes (`ScorecardScreen`, `HomeScreen`) are verified manually — the
  project has no React Native Testing Library — with a structured checklist
  covering: mode selectable only at 3 players, per-hole points display,
  the live banner, the `SindicatoRoundCard`, and clinch behavior.
