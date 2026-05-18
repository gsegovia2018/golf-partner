# My Stats — Personal Statistics View

**Date:** 2026-05-17
**Status:** Approved design

## Problem

The "Statistics" entry point in the Home "play" section currently opens the
per-tournament `StatsScreen` — Overview / Players / Pairs / H2H tabs covering
*everyone* in one event. There is no view that answers a player's personal
questions:

- How good am I playing **recently vs. my history**?
- What are my **strengths** and my **pain points**?

This spec defines a new personal statistics view that aggregates one player's
rounds across all their tournaments, with a round selector to control which
rounds count.

## Goals

- A personal "My Stats" screen scoped to the logged-in user.
- Aggregate **all completed rounds across all tournaments** by default.
- Let the user **add/remove individual rounds** (including incomplete ones)
  from the calculation.
- Surface **recent form** (last N rounds) vs. **history**.
- Surface **strengths and pain points**, measured against the user's own
  baseline.

## Non-goals

- No course-grouping or tournament-comparison presets (round selector only).
- No changes to the per-tournament `StatsScreen` analytics.
- No new data capture — uses only data the app already records.

## Approach

**Approach C — Hybrid.** A thin aggregation layer collects the user's rounds
across tournaments, builds a *synthetic single-player tournament*, and reuses
the existing per-player functions in `statsEngine.js`. New code is written only
where no equivalent exists: cross-tournament collection, the recent-vs-history
comparison, the strengths ranking, and the tee-shot-impact metric.

Rationale: maximum reuse of the battle-tested, tested engine; "recent vs.
history" is trivially consistent because it runs the *same* metric definitions
on two round subsets.

## Architecture & data flow

### Navigation

| Entry point | Today | After |
|---|---|---|
| Home list-view overflow menu "Statistics" (`HomeScreen.js:893`) | `navigate('Stats')` | `navigate('MyStats')` |
| In-tournament settings menu "Statistics" (`HomeScreen.js:1503`) | `navigate('Stats')` | unchanged — `navigate('Stats')` |

A new `MyStats` route is registered in `App.js` alongside the existing `Stats`
route. The per-tournament `StatsScreen` stays reachable from inside a
tournament's settings menu.

### New files

- `src/screens/MyStatsScreen.js` — the personal view UI.
- `src/store/personalStats.js` — aggregation, comparison, ranking layer.

### Data flow (`personalStats.js`)

1. `loadAllTournamentsWithFallback()` → all tournaments the user has played.
2. `collectMyRounds(tournaments, userId)` → flat list of `MyRound` records:
   `{ key, round, tournamentId, tournamentName, courseName, date, playerId, completed }`.
   - `playerId` is the player whose `user_id === userId` in that tournament.
   - `key` is stable: `` `${tournamentId}:${roundIndex}` `` — used by the
     selector and persistence.
   - `completed` = every hole of the round has a score for `playerId`.
   - Rounds with no score for the user are excluded entirely.
3. Selector state is a `Set` of selected `key`s. Default: all `completed`
   rounds selected; incomplete rounds deselected but selectable.
4. `buildSyntheticTournament(selectedRounds)` → `{ id, players: [me], rounds }`
   where each round's `scores`, `holes`, and `shotDetails` are re-keyed to one
   canonical `playerId`. This object is the input to existing engine functions.
5. `computeMyStats(selected)` runs engine functions on the synthetic tournament.
   `computeRecentVsHistory(selected, N)` runs them twice — last N rounds vs. the
   earlier rounds.

### Correctness notes

- A player may have a **different `id` and handicap per tournament**.
  `collectMyRounds` resolves "me" per-tournament; `buildSyntheticTournament`
  normalizes IDs to one canonical value.
- Per-round handicap is preserved — engine functions read it via the existing
  `getPlayingHandicap(round, player)`, which is round-scoped.
- Functions that assume pairs / multiple players (e.g. `headToHead`,
  `pairPerformance`, `tournamentMomentum`) are **not** used.

## Screen layout — `MyStatsScreen`

A single scrolling screen (no tabs — one player).

**Header bar**
- Title "My Stats".
- Round-selector button showing `"24 of 31 rounds"` → opens the selector sheet.
- Metric toggle: **Points** (net Stableford — default) / **Strokes** (gross),
  mirroring the existing `metric` state pattern.

**1. Snapshot card** — rounds counted · avg points/round · avg strokes vs par ·
best round · a recent-form arrow (▲/▼/—) summarizing the trend.

**2. Form — "Recent vs History"**
- N-selector chips: **3 / 5 / 10** (default 5).
- Each core metric shown last-N vs. history side by side with a signed delta
  and ▲/▼ colored by metric polarity.
- A chronological points-per-round **sparkline** below.

**3. Strengths & Pain Points** — two ranked lists:
- **"What's working"** — top 3, green.
- **"Where you're losing points"** — top 3, red.
- Each row: a one-line insight + number.

**4. Breakdown sections** — one card each:
- Par type (3 / 4 / 5)
- Hole difficulty (hard SI 1–6 / mid 7–12 / easy 13–18)
- Front 9 vs Back 9, plus warmup (holes 1–3) vs closing (holes 16–18)
- Score distribution (eagle / birdie / par / bogey / double+ / pickup)
- **Tee Shot Impact** (shot-tracked)
- Putting · Driving · GIR · Penalties · Scrambling & bounce-back (shot-tracked)

Scoring-based sections always render. Shot-tracked sections (Tee Shot Impact,
Putting, Driving, GIR, Penalties) render only when shot data exists for the
selected rounds; otherwise they collapse into one muted notice ("Log putts and
drives during a round to unlock these").

Tapping a breakdown row or insight may open the existing `StatDetailSheet` for
hole-level detail (component reuse).

## Round selector

A bottom-sheet modal opened from the header button.

- **Layout:** rounds grouped by tournament, newest first. Each tournament is a
  collapsible group with a header checkbox (select/deselect all its rounds).
  Each round row: `Round 2 · Pine Valley · 12 May · 38 pts` + checkbox.
- **Default:** every completed round checked. Incomplete rounds show an
  `In progress` tag, unchecked, but selectable.
- **Controls:** "Select all" / "Clear all"; live count footer
  (`24 of 31 rounds`).
- **Persistence:** the *deselected* round keys persist via `AsyncStorage` under
  `@mystats_round_selection:<userId>`, so newly-played rounds are auto-included
  by default. Stored keys that no longer exist are ignored.
- **Empty selection:** if the user deselects everything, the screen shows an
  empty state instead of blank cards.

## Recent vs History logic

- **Disjoint split.** "Recent" = the user's last **N** completed rounds
  chronologically. "History" = every selected round *before* that. Disjoint, so
  the delta is a true improving/declining signal.
- If total rounds ≤ N, there is no history — the Form section shows recent
  values with a "not enough history yet" note.
- Each compared metric carries a **polarity** so arrow color is correct:
  - Green ▲ for *more*: points, fairways, GIR.
  - Green ▲ for *fewer*: strokes vs par, putts, 3-putts, penalties.

## Strength ranking logic

- Every breakdown cell is converted to one comparable number: **points per hole
  vs. the user's own overall average** (cell pts/hole − all-holes pts/hole).
- Cells far above baseline → strengths; far below → pain points.
- **Candidate cells:** par 3 / 4 / 5 · hard / mid / easy holes · front / back
  nine · warmup / closing · bounce-back rate · (shot data) fairway-found vs.
  missed, miss direction, tee-penalty recovery.
- **Noise guard:** a cell needs a minimum sample to be eligible — ≥ 12 holes
  played in that cell for hole-level cells, or ≥ 6 rounds for round-level
  cells. Below threshold, the cell is excluded (not shown as a fake insight).
- Rank eligible cells by deviation magnitude; top 3 positive → "What's
  working", top 3 negative → "Where you're losing points". If fewer than 3
  qualify, show what qualifies.

## Metrics catalog

All computable from existing data (strokes, points, putts, drive direction,
penalties + hole par/SI).

### Scoring (always available)
- Avg points/round, avg strokes vs par, best/worst round.
- Score distribution: eagle / birdie / par / bogey / double+ / pickup rates.
- Par-type splits (3/4/5); hole-difficulty splits (hard/mid/easy SI bands).
- Front 9 vs back 9; warmup (holes 1–3) vs closing (holes 16–18).
- Longest par-or-better streak; bounce-back rate.
- Consistency: std-dev of points/round.

### Shot-tracked (render only when data exists)
- **Tee Shot Impact** (par 4/5 holes only):
  - Fairway found (`fairway`/`super`) vs missed (`left`/`right`/`short`) —
    avg points/hole each.
  - By miss direction — avg points/hole for `left` / `right` / `short`.
  - Tee penalty cost — avg points/hole on holes with a tee penalty vs without,
    plus "points lost per tee penalty".
- Putting: putts/round, 1-putt %, 3-putt+ rate.
- Driving: fairway %, miss bias (left / right / short tendency).
- GIR %.
- Penalties: tee vs other, penalties/round.

### Engine reuse map (Approach C)

| Need | Source |
|---|---|
| Par type | `parTypeSplit` |
| Front/back, warmup/closing | `frontBackSplit`, `warmupVsClosing` |
| Hole difficulty | `strokeIndexAccuracy` |
| Distribution, streaks | `playerScoreDistribution`, `playerStreaks` |
| Bounce-back, scrambling | `bounceBackRate`, `scramblingStats` |
| Putting/driving/GIR/penalties | `shotStats` |
| Best/worst round, history | `playerRoundHistory`, `tournamentHighlights` |
| Consistency | `playerConsistency` |

All run against the synthetic single-player tournament.

### New code

- `collectMyRounds(tournaments, userId)` — cross-tournament round collection.
- `buildSyntheticTournament(rounds)` — single-player normalization.
- `computeRecentVsHistory(selected, N)` — disjoint split + polarity diff.
- `rankStrengths(stats)` — baseline-relative ranking with sample guard.
- `teeShotImpact(tournament, playerId)` — drive outcome × hole score.

## Empty states & errors

- **No tournaments / no completed rounds:** empty state ("Play and score a
  round to see your stats").
- **All rounds deselected:** empty state prompting to open the selector.
- **≤ N rounds:** Form section shows recent values + "not enough history yet".
- **No shot data:** the shot-tracked cards collapse into one muted notice.
- **Load failure:** error state with retry, matching the existing
  `StatsScreen` catch pattern.

## Testing

Unit tests for `personalStats.js`, reusing the existing
`src/components/__tests__` / `statsEngine` fixture style:

- `collectMyRounds` — per-tournament id resolution, `completed` flag, rounds
  with no user score excluded.
- `buildSyntheticTournament` — id normalization, per-round handicap preserved.
- `computeRecentVsHistory` — disjoint split, polarity, ≤ N case.
- `rankStrengths` — sample-size guard, ranking order, fewer-than-3 case.
- `teeShotImpact` — drive-outcome bucketing, tee-penalty holes, par-3
  exclusion, no-data handling.
