# Unified Scorecard — Design Spec

**Date:** 2026-05-21
**Status:** Approved (brainstorming complete)
**Author:** Brainstorming session with visual companion

## 1. Problem

The scorecard is one 4,769-line file (`src/screens/ScorecardScreen.js`, ~88
hooks). It renders differently per game mode in ways that are unintended,
inconsistent, and buggy:

- **Best Ball forks the layout.** The per-hole view uses a different player
  card for Best Ball (`useHeroCards = mode !== 'bestball'` → compact `playerCard`
  vs the `soloHeroCard` every other mode gets). The grid view forks too
  (`useClassicGrid = mode === 'bestball' && players.length === 4` → a separate
  horizontally-scrolling classic table). Switching modes mid-round makes the
  whole screen jump.
- **Four inconsistent summary panels.** `MatchPanel`, `SindicatoPanel`,
  `SoloTotalsRibbon`, and `StablefordWinnerBanner` each have their own visual
  language, height, and label style.
- **Sindicato's panel only renders for exactly 3 players** — other counts fall
  back to the Stableford strip.
- **Per-mode scoring logic is duplicated** in three places (`HolePage`,
  `NineBlock`, `ScorecardTable`).
- **Team membership is weakly shown** — only a thin left border on the Best Ball
  card; the hero card (Match Play included) shows no team at all.
- **The +/- stepper is unreliable.** Tapping `+` quickly makes the displayed
  number jump up and down (see §6 for root cause).

## 2. Goal

One scorecard. All five scoring modes — solo, Stableford, Match Play, Best Ball,
Sindicato — render an **identical structure**. The **only** thing that changes
between modes is the bottom summary panel. Team membership is shown by a glow
**halo**. The scorecard must feel reactive, smooth, quick, modern, and complete,
and the score steppers must be rock-solid.

## 3. Architecture — extract `src/components/scorecard/`

`ScorecardScreen.js` splits. The screen keeps only what it alone can do — data
loading, `mutate` calls, official-mode RPC mapping, state/effects/handlers, the
header bar, the hole/grid view toggle, and the capture/media/sync/leaderboard
modals. Everything that draws the scorecard moves into focused, independently
testable files under `src/components/scorecard/`:

| File | Responsibility | Depends on |
|---|---|---|
| `scoreModel.js` | **Pure** scoring. The single place that computes per-mode hole points, round totals, pair results, and leader/clinch status. | `store/scoring.js` |
| `teamModel.js` | Resolves each player's team → `{ index, color, label }` or `null`. | theme |
| `PlayerCard.js` | The one unified player card. | `scoreModel`, `teamModel`, `ShotDetailSection` |
| `ShotDetailSection.js` | Collapsible "Shot detail" wrapper around the shot panel. | `ShotDetailPanel` |
| `ShotDetailPanel.js` | The shot-detail inputs (moved out, bucket rows decluttered). | `constants` |
| `HolePage.js` | One hole: hole header + stacked `PlayerCard`s. | `PlayerCard` |
| `HoleView.js` | Horizontal hole pager + pinned `RoundSummary` + bottom bar + notes/hole-picker modals + celebration overlay. | `HolePage`, `RoundSummary` |
| `GridView.js` | The all-holes table — one layout for every mode. | `scoreModel` |
| `RoundSummary.js` | The unified summary frame. | `scoreModel`, `teamModel` |
| `styles.js` | `makeScorecardStyles(theme)` — shared StyleSheet for the module. | theme |
| `constants.js` | `DEFAULT_SHOT`, drive/bucket constants, `CELEBRATION_TIERS`, `celebrationFor`. | — |

`ScorecardScreen.js` imports `HoleView` / `GridView` and passes resolved data +
handlers as props. Its data-loading hook soup is **not** restructured here
(that is a separate effort) — except the specific score-write + reload path,
which §6 fixes because the user explicitly requires it.

## 4. The unified components

### 4.1 PlayerCard — one card for every mode

Every mode uses the hero card (big centered score, `−`/`+` steppers). The Best
Ball fork and the compact `playerCard` style are **deleted**.

Card anatomy (top to bottom):
- **Header row:** avatar (initial, team-colored), name + tee badge, handicap
  line (`HCP 12 · +1 on this hole`), team chip (`PAIR A`/`PAIR B`, team-colored)
  when in a team mode, pickup toggle button.
- **Score row:** `−` 40px stepper · big strokes number (`HOLD TO CLEAR` label) ·
  `+` 40px stepper.
- **Points badge:** e.g. `3 points`, colored by score quality.
- **Running stats** (when the eye toggle is on): Strokes / Points / vs Par.
- **Shot detail** (only on the "me" card): the collapsible `ShotDetailSection`.

**Halo (team indicator).** When the round has two multi-member pairs, each card
gets a 1.5px border + soft outer glow in its team color
(`theme.pairA` / `theme.pairB`) — the "glow halo". Stacked teammates form
glowing color groups. No halo for solo, individual Stableford, or Sindicato
(neutral card). The halo is applied via static style only — no animation cost.

**Official mode.** `PlayerCard` keeps the official props it has today —
read-only state (no steppers, no pickup), and the agreed / waiting / discrepancy
badges. A discrepancy card the viewer owns stays tappable to open the resolve
sheet. No official-specific UI is redesigned.

### 4.2 ShotDetailSection — collapsible, decluttered

The shot-detail block (Putts, Tee penalties, Other penalties, Sand shots,
Driver, Approach from, First putt, Outcome) is wrapped in a collapsible section
with a tappable `Shot detail ▾` / `▸` header. Collapse state lives in `HoleView`
(one toggle for the whole round, shared across hole swipes) and is persisted via
`lib/prefs.js` so it is remembered. Default: expanded.

The cluttered bucket rows — **Approach from** and **First putt** — change from
"label + five cramped pills on one line" to a **label on its own line, then a
full-width segmented control** (five equal-width cells) below it. Counter rows
(Putts, penalties, Sand) and the Driver icon row stay as compact inline rows.

### 4.3 GridView — one grid for every mode

The classic Best Ball-4 horizontally-scrolling table (`useClassicGrid`) is
**deleted**. Every mode uses the front-nine / back-nine `NineBlock` layout. When
the round has two pairs, a pair-combined column shows each pair's combined
points (Best Ball pair points come from `scoreModel`, not an inline branch).

### 4.4 RoundSummary — one frame, mode-specific content

`MatchPanel`, `SindicatoPanel`, `SoloTotalsRibbon`, and `StablefordWinnerBanner`
collapse into a single `RoundSummary`. One frame everywhere: an eyebrow label,
the card body, an optional status line. Pinned just above the bottom bar.

Three inner layouts, chosen by mode:

- **Pair rows** (Match Play, Best Ball): two rows, Pair A vs Pair B, names in
  their halo colors, with `HOLE n` and `ROUND` columns.
- **Player chips** (Stableford, Sindicato): a row of point chips, you first,
  the leader highlighted. For random-partner Stableford the status line names
  the leading pair.
- **Solo ribbon** (one player): Strokes / Points / vs Par.

**Status line.** Live: leader + margin + holes left (e.g. `Guille leads by 3 ·
11 to play`), or `All level`. The summary always renders, including the
no-scores-yet state.

**Winner state.** When `scoreModel` reports the result decided, the winning
pair/player **row gets a soft gold tint and a small trophy**, and the status
line states the result in gold (e.g. `Marcos & Ana have won the round`). No
badge box, no card glow — the winner treatment stays integrated into the card.
Match Play / Best Ball decide on clinch (lead exceeds the maximum remaining
catch-up); Stableford decides only when every hole is scored; Sindicato uses
`sindicatoRoundTally.clinched`.

## 5. scoreModel.js — centralized scoring

A pure module that removes the triplicated "if matchplay / if sindicato / else
stableford" branching. It wraps the existing `store/scoring.js` functions
(`calcStablefordPoints`, `matchPlayHolePts`, `sindicatoHolePoints`,
`calcBestWorstBall`, `roundPairLeaderboard`, `sindicatoRoundTally`,
`roundPairClinched`) behind one interface:

- `holePoints(mode, hole, players, scores, handicaps)` → `{ [playerId]: number }`
- `roundTotals(mode, round, players, scores, handicaps)` → per-player
  `{ pts, str, parPlayed }`
- `pairStandings(mode, round, players, scores, settings)` → per-pair hole/round
  points (Match Play, Best Ball)
- `summaryState(mode, round, players, scores, settings)` → everything
  `RoundSummary` needs: ordered rows/chips, leader, margin, holes left,
  `decided`, `winner`.

`HolePage`, `GridView`, and `RoundSummary` all consume `scoreModel` — no inline
mode branching anywhere else.

## 6. Input reliability — the stepper must be rock-solid

**Observed bug:** tapping `+` quickly makes the number jump up and down.

**Root cause.** The scorecard holds two sources of truth: the optimistic
`scores` React state and the persisted tournament blob. `subscribeTournamentChanges`
reloads the blob and calls `setScores(...)`. The "don't clobber local edits"
guard is a single boolean (`pendingSaveRef`) sampled in
`reload({ preserveLocalEdits: pendingSaveRef.current })` — **before** the async
`loadTournament()` resolves. A reload that begins around a tap finishes later
and calls `setScores` with a blob captured before the newer taps, so the value
regresses (jumps down); the next save then lands and it jumps back up.
Secondary cause: `stepScore` / `setScore` run side effects (`autoSave`,
`triggerCelebration`) **inside** the `setScores` updater, which React may invoke
more than once — double-enqueuing saves and double-firing celebrations.

**Required fixes** (in scope — this specific path only):

1. **Pure state updaters.** Score handlers compute the next value, call
   `setScores` with a pure updater, and run side effects (save, celebration,
   haptic) *outside* the updater. A `scoresRef` is kept synchronously in step
   with state so handlers read a reliable current value.
2. **Reloads merge, never blind-replace.** A reconciliation step protects
   locally-edited cells: a reload adopts blob values only for cells that are not
   locally dirty / not awaiting a confirmed save. Track dirty cells (or an
   edit epoch re-checked *after* `loadTournament()` resolves) so a late reload
   cannot overwrite a newer edit.
3. **Deterministic stepping.** N rapid taps produce exactly N steps — no lost
   steps, no duplicated steps, no transient regression of the displayed number.
4. **Verification.** A rapid-tap check is part of acceptance: tapping `+` ten
   times fast must land on exactly the expected value and never visibly bounce,
   on web and Android, casual and official mode.

## 7. Behavior & polish

- **Stable mode switching.** Because no layout fork remains, the mid-round mode
  switch only swaps the `RoundSummary` content and recolors halos — the header,
  player cards, and grid do not move.
- **Smoothness.** `PlayerCard` and `HolePage` stay `React.memo`'d with stable
  props; `scoreModel` results are memoized; the existing hole-pager scroll
  handling is preserved. The score-bump spring animation and celebration
  overlay are kept.
- **Reactivity.** Points, totals, summary, and halo update immediately on each
  score change (subject to §6 making that update reliable).

## 8. Testing

- `scoreModel.js` and `teamModel.js` are pure → unit tests for each mode: hole
  points, round totals, pair standings, leader/clinch detection, decided/winner.
- A rapid-tap reliability test for the score-write path (§6.4).
- The existing `src/screens/__tests__/ScorecardScreen.test.js` and the full
  suite (~422 tests) must stay green.

## 9. Out of scope

- `RoundSummaryScreen` (the post-round screen).
- The official-mode RPC data layer (`useOfficialRound`, `officialStore`).
- The broader restructuring of `ScorecardScreen.js`'s ~88 data-loading hooks —
  except the score-write + reload-reconciliation path fixed in §6.

## 10. Visual reference

The approved look (validated via the brainstorming visual companion):

- **Halo:** glow — 1.5px team-colored border + soft outer shadow in the team
  color.
- **Unified card:** hero card with collapsible shot detail.
- **Shot detail buckets:** full-width five-cell segmented controls.
- **Summary:** one frame (eyebrow + card + status line) with pair-rows /
  player-chips / solo-ribbon variants.
- **Winner:** gold-tinted winning row + trophy + gold status line.
