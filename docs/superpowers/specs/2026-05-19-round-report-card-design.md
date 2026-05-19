# Round Report Card — Design Spec

**Date:** 2026-05-19
**Status:** Approved (design)
**Topic:** Per-round personal retrospective inside the personal stats screen

## Problem

The app computes ~50 statistics, but the per-round personal retrospective is
missing. Every deep personal stat (`rankStrengths`, `computeRecentVsHistory`,
the par/difficulty/nine splits) runs as a **cross-tournament aggregate** on
`MyStatsScreen`. `RoundSummaryScreen` only shows a leaderboard and a scorecard
grid. A player finishing a round cannot see "I crushed the par 3s today, I bled
points on the back nine."

The **Round Report Card** fills that gap: a single-round, personal
good/bad breakdown answering "what did I do well, what cost me points."

## Goals

- A per-round retrospective scoped to the signed-in user.
- Make "good" and "bad" obvious at a glance, with depth on demand.
- Reuse the existing pure stats engine — no new engine functions, no
  data-model changes.
- Reachable as the first tab of the personal stats screen, and as the
  redirect target after finishing a round.

## Non-Goals

- No new per-hole data capture (no approach data, putt distance, etc.).
- No changes to `RoundSummaryScreen` — it stays read-only and is also used
  for friends' rounds.
- No tournament-wide or multi-player report card; this is personal only.

## Placement & Navigation

The Report Card lives inside `MyStatsScreen` as a **new first tab**, and is the
default tab. Tab order becomes:

```
Report Card · Overview · Form · Breakdown · Shots
```

- The tab shows **one** round at a time, chosen via a **dropdown** at the top
  of the tab listing all of the user's rounds (course name + tournament +
  date), defaulting to the most recent.
- `MyStatsScreen` already loads every tournament and calls `collectMyRounds`,
  so the tab needs **no additional data loading** — it reuses the existing
  `myRounds` state.
- `MyStatsScreen` accepts route params `{ tab, roundKey }` so the screen can
  open directly on the Report Card for a specific round.

### Round-finish redirect

`ScorecardScreen.handleFinish` (`src/screens/ScorecardScreen.js:851`) currently
routes to `RoundSummary` via `goToSummary()` after the round-complete
celebration. For casual/`game` rounds where the finisher is a player, the
non-tournament-done path navigates instead to:

```
navigation.navigate('MyStats', { tab: 'reportCard', roundKey })
```

The tournament-complete / archive branch and official-round behavior are
unchanged. `RoundSummary` remains reachable from the activity feed.

## Data Architecture

### New pure module — `src/store/roundReportCard.js`

Pure, testable, no async. Mirrors the `personalStats.js` pattern (screens load,
modules transform).

```
buildRoundReportCard(myRounds, roundKey) → ReportCard | null
```

- `selected`  = the `MyRound` whose `key === roundKey` (null → return null)
- `history`   = all the user's **other completed** rounds (baseline universe)
- `thisStats` = `computeMyStats([selected])`
- `baseStats` = `computeMyStats(history)`  — `null` when `history` is empty
- Diffs `thisStats` against `baseStats` into cells, headline, and callouts.

This reuses `computeMyStats` from `personalStats.js`, which already bundles
`parTypeSplit`, `holeDifficultySplit`, `frontBackSplit`, `warmupVsClosing`,
`playerScoreDistribution` and `shotStats`.

### Baseline

Each metric is compared against **both**:
1. The player's **career average** — the same metric across all of the
   player's other completed rounds (`baseStats`).
2. The **2.0 Stableford benchmark** — the fixed "played to handicap" mark.

### `ReportCard` shape

```
{
  round:    { key, courseName, tournamentName, date, holesPlayed, complete },
  headline: {
    points,            // total Stableford points this round
    perHole,           // points / holesPlayed
    vsAvg,             // points/round delta vs career avg (null if no history)
    clearedBenchmark,  // perHole >= 2.0
    verdict,           // phrase — see table below
  },
  callouts: {
    bright: Cell[],    // top 2 by positive deltaVsAvg
    cost:   Cell[],    // bottom 2 by negative deltaVsAvg
  },
  groups: [            // full breakdown, one entry per dimension group
    { key, label, cells: Cell[] }
  ],
  hasHistory,          // false → first-ever round
  hasShotData,         // false → shot-stats group omitted
}
```

```
Cell {
  label,        // "Par 3s", "Back 9", "3-putts", ...
  group,        // 'course' | 'timing' | 'distribution' | 'shots'
  value,        // this round's figure
  baseline,     // career-average figure (null if no history)
  deltaVsAvg,   // value - baseline (null if no history)
  deltaVs2,     // for points-per-hole cells: value - 2.0
  holes,        // sample size this round — drives the callout guard
  polarity,     // 'higher' | 'lower' — which direction is good
}
```

### Headline verdict

Derived from `headline.vsAvg` (points/round delta vs career average). When
there is no history, derived from `perHole` vs 2.0 instead.

| Δ vs your average | Verdict       |
|-------------------|---------------|
| ≥ +6              | Standout round |
| +2 to +6          | Strong round  |
| −2 to +2          | Solid round   |
| −6 to −2          | Off day       |
| ≤ −6              | Tough day     |

(No-history fallback: `perHole ≥ 2.4` → Strong round; `2.0–2.4` → Solid round;
`1.6–2.0` → Off day; `< 1.6` → Tough day.)

## Callout selection

- "Bright spots" = the 2 cells with the largest positive `deltaVsAvg`;
  "Cost you points" = the 2 with the most negative `deltaVsAvg`.
- A cell is **callout-eligible only if `holes >= 3`** this round — guards
  against a fake insight like "Par 3s +0.9" computed off one hole. Front-9 and
  back-9 cells (9 holes each) always qualify.
- With no history, callouts rank on `deltaVs2` instead of `deltaVsAvg`.

## Dimension Groups

All four groups are analyzed; the breakdown grid shows every cell, the callouts
auto-pick across all of them.

| Group           | Cells |
|-----------------|-------|
| Where on course | Par 3s, Par 4s, Par 5s; Hard (SI 1-6), Mid (SI 7-12), Easy (SI 13-18) |
| When in round   | Front 9, Back 9; Opening 3, Closing 3 |
| Scoring distribution | Birdies, Pars, Bogeys, Blow-ups (double+) — counts vs usual mix |
| Shot stats      | Putts, Fairways hit, GIR, Penalties — only when shot details logged |

## UI

New presentational component — `src/components/RoundReportCard.js`. Pure props
in, no data loading. Receives the `ReportCard` object and theme.

Layout (matches the approved mockup, `Layout C`):

1. **Round dropdown** — course + tournament + date; opens a list of all rounds.
2. **Verdict block** — verdict phrase (Playfair serif, accent color), then
   `points · per-hole · ±vs average · benchmark` line.
3. **Bright spots** — up to 2 green callouts (label + figure + Δ vs avg).
4. **Cost you points** — up to 2 red callouts.
5. **Full breakdown** — collapsed by default; expands to the grid of every
   cell grouped by dimension, each row with value, a center-anchored delta
   bar, and the ± figure.

Styling follows `MyStatsScreen` / `RoundSummaryScreen` conventions (theme
tokens, `PlayfairDisplay` for figures, `PlusJakartaSans` for labels, card
radius 12-14, section labels uppercase letter-spaced).

## Edge Cases

| Case | Behavior |
|------|----------|
| First-ever round (no history) | `hasHistory = false`. Headline + callouts use the 2.0 benchmark; a one-line note says the vs-average comparison appears once more rounds exist. |
| 9-hole round | Front/back-9 cells omitted; all other cells compute normally. |
| No shot data for the round | `hasShotData = false`; the shot-stats group is hidden entirely. |
| Incomplete round | Computes over holes played; a "through N holes" note shown. |
| User has no rounds | Tab shows the existing `MyStatsScreen` empty state. |
| `roundKey` not found | `buildRoundReportCard` returns `null`; tab falls back to the most recent round. |

## Testing

`roundReportCard.js` is pure → unit-tested with synthetic rounds, following the
style of `src/store/__tests__/personalStats.test.js`. Coverage:

- Verdict thresholds (each band, and the no-history fallback band).
- Callout selection — correct top/bottom cells, and the 3-hole eligibility
  guard excludes tiny samples.
- First-round fallback — no baseline, benchmark-only headline and callouts.
- 9-hole round — front/back-9 cells absent.
- Missing shot data — shot group absent, `hasShotData = false`.
- Incomplete round — metrics over holes played.
- `roundKey` not found → `null`.

`RoundReportCard.js` (presentational) and the round-finish redirect are
verified manually.

## Files

| File | Change |
|------|--------|
| `src/store/roundReportCard.js` | New — pure `buildRoundReportCard`. |
| `src/store/__tests__/roundReportCard.test.js` | New — unit tests. |
| `src/components/RoundReportCard.js` | New — presentational component. |
| `src/screens/MyStatsScreen.js` | Add `Report Card` as first/default tab; accept `{ tab, roundKey }` route params; single-round dropdown state. |
| `src/screens/ScorecardScreen.js` | `handleFinish` redirect to `MyStats` Report Card tab for casual/game rounds. |
