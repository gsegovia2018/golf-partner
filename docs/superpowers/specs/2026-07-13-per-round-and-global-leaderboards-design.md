# Per-Round & Global Leaderboards (Workstream B)

**Date:** 2026-07-13
**Status:** Design — approved for planning
**Scope:** Workstream B of the two-part leaderboard effort (workstream A —
score-conflict sync — shipped separately). Covers the per-round / global
leaderboard UX and scoring-mode coherence (strokes tiebreak, round-summary
mode-awareness).

---

## 1. Problem

Today a tournament shows a **single whole-tournament** "LEADERBOARD" card
(`HomeScreen.js:1637-1698`) annotated with a per-round sub-value
(`getSelectedRoundValue`, `:1545-1580`). There is no true **per-round board in
that round's game mode**, and no way to switch between a round and the whole
tournament. Two coherence gaps compound it:

- **No strokes tiebreak anywhere.** Every board sorts by points descending only
  (`tournamentLeaderboard` `tournamentStore.js:1482`,
  `tournamentStablefordLeaderboard` `scoring.js:793`, and the per-mode
  standings), so equal-point players land in arbitrary order.
- **`RoundSummaryScreen` always ranks by plain Stableford**
  (`RoundSummaryScreen.js:97-100` → `roundTotals`), even for a
  matchplay/scramble/sindicato round, so the finished-round summary disagrees
  with the mode-specific board Home shows.

The user wants: selecting round N shows round N's board **in that round's mode**;
a way to see the **Global** whole-tournament board; and mixed-mode tournaments
ranked by Stableford points **then strokes**.

## 2. Decisions (from brainstorming)

1. **Scope UI = round tabs drive the board + a `Round | Global` toggle.** The
   existing round tab bar (`selectedRound`) now also drives the leaderboard
   board. A segmented toggle on the LEADERBOARD card header switches the board
   between the **selected round** (its own mode) and **Global** (whole
   tournament). The scores pager below is unaffected by the toggle. The toggle
   is shown only for multi-round tournaments.
2. **Per-round board = that round's effective mode's board.**
3. **Global ranking = native aggregate when all rounds share one mode, else
   Stableford points → total strokes tiebreak.**
4. **Strokes tiebreak** added as the secondary sort key wherever a Stableford
   ranking is produced (per-round and global).
5. **`RoundSummaryScreen`** becomes mode-aware, using the same per-round board
   builder.
6. **Domain logic lives in `store/scoring.js`** (pure selectors); screens only
   consume them. Reuse the existing `RoundLeaderboard` component and the
   segmented-control / chip patterns already in the app.

## 3. Scope resolution & UI

### `HomeScreen` LEADERBOARD card

- New local state `leaderboardScope: 'round' | 'global'` (default `'round'`),
  surfaced as a segmented toggle in the card header, rendered only when
  `!isGame` (multi-round). Single games always show their one round's board and
  no toggle.
- **Board selection:**
  - `scope === 'round'` → `roundLeaderboard(round, players, tournament)` for the
    `selectedRound` round (see §4). Header shows `R{n} · {mode label}`.
  - `scope === 'global'` → `tournamentLeaderboardResolved(tournament)` (see §5).
    Header shows `Overall`.
- The existing points↔stroke-play alt-view Switch (`leaderboardAlt`) remains,
  and applies to Stableford-ranked boards (per-round Stableford and the mixed
  global board); it is hidden for native non-Stableford boards (holes-won /
  duel points / etc.) where a gross-strokes re-sort is not meaningful.
- The per-round sub-value annotation (`getSelectedRoundValue`) on rows is
  **removed** — the board now *is* the selected round, so the annotation is
  redundant.

### Rows

Reuse the existing row rendering. Each board entry keeps the shape the current
cards expect: `{ player, points, strokes, ... }` (or the pair/team shape for
team modes), so the `RoundLeaderboard` component and the Home "Masters" row can
render both per-round and global boards unchanged.

## 4. Per-round board builder (`store/scoring.js`)

New pure selector:

```
roundLeaderboard(round, players, tournament) -> { mode, unit, entries }
```

Dispatch on the round's **effective** mode (`roundScoringMode(round, tournament)`,
`scoring.js:343`), delegating to the existing per-round tallies:

| Effective mode         | Builder (existing round tally)                    | Unit        |
|------------------------|---------------------------------------------------|-------------|
| individual / stableford| `roundTotals` → sort points **desc, strokes asc** | points      |
| matchplay              | `matchPlayRoundTally`                              | holes won   |
| sindicato              | `sindicatoRoundTally`                             | points      |
| scramble\*             | `scrambleRoundTally` (team, under captain)         | team points |
| pairsmatchplay         | `pairsMatchRoundTally`                             | duel points |
| bestball               | best/worst round calc                             | points      |

`unit` labels the board (e.g. "pts", "holes", "team pts") so the header/UI can
show `R{n} · {mode label}`. Ranking within each mode preserves that mode's
native ordering; the Stableford path (individual/stableford) gains the strokes
tiebreak.

## 5. Global board resolver (`store/scoring.js`)

New pure selector that centralizes the existing routing (currently inline in
`HomeScreen.js:921-933`):

```
tournamentLeaderboardResolved(tournament) -> { mode, unit, entries }
```

- If `tournamentHasMixedModes(tournament)` (`scoring.js:386`) →
  `tournamentStablefordLeaderboard` (`scoring.js:766`), **with the strokes
  tiebreak added**.
- Else, all rounds share one effective mode → the existing aggregate for that
  mode: `tournamentMatchPlayStandings` / `tournamentSindicatoLeaderboard` /
  `tournamentScrambleLeaderboard` / `tournamentPairsMatchStandings` /
  `tournamentBestWorstLeaderboard`, or `tournamentLeaderboard` for plain
  Stableford (with the strokes tiebreak).

Moving this routing out of `HomeScreen` into a pure selector makes it testable
and lets `RoundSummaryScreen` and any future consumer reuse it.

## 6. Strokes tiebreak

Add a shared comparator so every Stableford-ranked board sorts by **points
descending, then total strokes ascending, then a stable fallback** (existing
name order). Apply it in: `roundTotals`-based ranking (per-round Stableford),
`tournamentLeaderboard`, and `tournamentStablefordLeaderboard`. Native
non-Stableford boards (matchplay/sindicato/scramble/pairsmatchplay/bestball)
keep their own ordering; where a natural strokes tiebreak exists it may be added,
but the spec only *requires* it for the Stableford rankings the user named.

## 7. `RoundSummaryScreen` mode-awareness

Replace the always-Stableford ranking (`RoundSummaryScreen.js:97-100`) with
`roundLeaderboard(round, players, tournament)` (§4), so the summary board matches
the mode-specific board Home shows for that round. `RoundLeaderboard`
(`components/roundSummary/RoundLeaderboard.js`) renders the entries; extend it
only as needed to show the mode's unit label. Live "HOLE N" badge behavior is
unchanged.

## 8. Components & boundaries

- **`store/scoring.js`** (pure): add `roundLeaderboard`,
  `tournamentLeaderboardResolved`, and a `stablefordComparator`; reuse existing
  tallies. No I/O.
- **`HomeScreen.js`**: add `leaderboardScope` state + the `Round | Global`
  toggle; swap the inline board routing for `roundLeaderboard` /
  `tournamentLeaderboardResolved`; drop the `getSelectedRoundValue` annotation.
- **`RoundSummaryScreen.js`**: consume `roundLeaderboard`.
- **`RoundLeaderboard`**: minor — show the mode unit label; render team vs
  individual entries.
- Reuse the existing round tab bar / segmented-control styling; no new
  navigation.

## 9. Testing

**Unit (`store/scoring.js`):**
- `roundLeaderboard` dispatches to the correct builder per effective mode
  (one case per mode) and returns that mode's ordering.
- Stableford strokes tiebreak: two players equal on points → fewer strokes ranks
  first; applied in per-round Stableford, `tournamentLeaderboard`, and
  `tournamentStablefordLeaderboard`.
- `tournamentLeaderboardResolved`: uniform-mode tournament → native aggregate;
  mixed-mode → Stableford + strokes.

**Screen/integration:**
- Home: `Round` scope shows the selected round's mode board; switching the tab
  changes the board; `Global` shows the resolved whole-tournament board; toggle
  hidden for single games.
- `RoundSummaryScreen`: a matchplay/scramble round summary shows that mode's
  board, not plain Stableford.

**Runtime (verify skill):** two-round mixed-mode tournament — round tabs switch
the board, Global shows Stableford+strokes, single-game shows no toggle.

## 10. Out of scope

- Official-tournament leaderboard (separate gross-strokes system) — unchanged.
- Clinch indicators for mixed tournaments (currently skipped) — unchanged.
- Any change to score entry, sync, or the workstream-A conflict system.
- New navigation screens — the board stays on the existing tournament screen.
