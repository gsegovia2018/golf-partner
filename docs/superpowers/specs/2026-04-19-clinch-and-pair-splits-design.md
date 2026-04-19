# Math-clinch alerts, partner splits, and scorecard running score — Design

Date: 2026-04-19

## Goals

Four small additions to the tournament UX:

1. **Math-clinch indicator + popup** — when a winner is mathematically guaranteed (round-pair or tournament-player), surface it.
2. **Partner-by-partner average for each player** — answers "which partners do I score best with?".
3. **Same metric vs that player's own baseline** — answers "with whom do I overperform?".
4. **Toggle to show each player's running Stableford during a round** in the scorecard.

The chosen scoring mode of the tournament (`stableford` or `bestball`) drives the math-clinch logic; the partner splits always use the player's individual Stableford regardless of mode.

## Non-goals

- No persistence of "clinched at hole X" — it's recomputed on every render.
- No best-ball math-clinch when fewer than 4 players (no pairs).
- No backwards-compat for tournaments missing `settings`.

---

## Feature 1 — Math-clinch

### Definition

A competitor (player at tournament level, pair at round level) is **clinched** when no opponent can mathematically catch them, even assuming the opponent scores the maximum possible on every remaining hole and the leader scores zero on every remaining hole.

### Computing maximum remaining points

**Stableford mode.** For a player on a single hole that has not been scored yet, the maximum is achieved at one stroke (hole-in-one):

```
maxStablefordPts(hole, playerHandicap) =
  calcStablefordPoints(hole.par, 1, playerHandicap, hole.strokeIndex)
```

The function already clamps at zero, so this is the upper bound.

**Best-ball mode.** Per unscored hole, a pair can win at most `bestBallValue + worstBallValue` points (one player carries best-ball, the other worst-ball, both win). Per individual player it is the same — points credited to them under `playerRoundBestWorstPoints` are best+worst values when their pair wins both roles on a hole. Halved holes credit zero, so the upper bound assumption is the pair winning every remaining hole.

### New helpers in `src/store/tournamentStore.js`

All pure, easy to test:

```js
// Stableford: per player.
roundMaxRemainingStableford(round, player): number

// Best-ball: per pair (returns { pair1, pair2 } in points-equivalent).
roundMaxRemainingBestBall(round, settings): { pair1, pair2 }

// Tournament-wide max remaining across rounds the user has not yet finished
// scoring. Future rounds (index > tournament.currentRound) count as "all 18
// holes unscored" using that round's holes/handicaps.
tournamentMaxRemaining(tournament, playerId): number  // stableford
tournamentMaxRemainingBB(tournament, playerId): number // best-ball

// Convenience selectors used by the UI.
roundPairClinched(round, settings, mode): 0 | 1 | null
tournamentPlayerClinched(tournament, mode): playerId | null
```

A pair clinches a round when:
```
leader.combinedPoints >= other.combinedPoints + maxRemainingForOther
```

A player clinches the tournament when, for every other player:
```
leader.points >= other.points + maxRemainingForOther
```

When all rounds are fully scored, "clinched" is just "first place" (max remaining = 0). The badge still shows.

### UI — badge

In `HomeScreen.js` leaderboard row (line 463 area, `mastersName`), append a small crown icon (`Feather` `award`, gold tint) when `tournamentPlayerClinched(tournament, mode) === entry.player.id`.

In the round card pair rows (`StablefordRoundCard` and `BestBallRoundCard`), append the same icon next to the winner's `pairNames` when `roundPairClinched(round, settings, mode)` matches that pair index.

The icon is **only** shown when the leader/pair has actually clinched — not just leading.

### UI — popup on next-hole

In `ScorecardScreen.js`, the `goToNextHole` callback (line 293) is the natural hook. After advancing, compute round-clinch using the just-saved scores. If `roundPairClinched` returns a pair AND it did not return that same pair before the hole was scored, show an alert / snack:

> 🏆 Round clinched
> *<Pair name>* are mathematically uncatchable. Keep playing for the leaderboard.

Implementation: keep a ref `lastClinchedPair` initialized to whatever the round computed at mount; on each `goToNextHole`, recompute, and if it transitioned `null → pairIdx` show the popup and update the ref. Also do the same for the tournament leader (only when the round is the tournament's last round and a player just clinched the *whole* tournament).

Alert uses the existing pattern (`Alert.alert` on native, `window.alert` on web — see `confirmDelete` in HomeScreen for the idiom).

---

## Feature 2 — Partner splits per player

### Metric

For player P partnered with Q across N rounds:
```
playerAvgWithPartner(P, Q) = mean(P.individualStablefordPoints in those N rounds)
```

Individual Stableford is what `roundTotals(round, players)` already returns as `totalPoints` — handicap-adjusted.

### Helper

```js
// In tournamentStore.js
playerPartnerSplits(tournament, playerId):
  Array<{
    partner: Player,
    rounds: number,           // count of rounds together with both having scored ≥ 1 hole
    avgPlayerPoints: number,  // mean of P.totalPoints across those rounds (1 decimal)
    delta: number,            // avgPlayerPoints − playerOverallAvg (1 decimal, signed)
  }>
```

`playerOverallAvg` is the mean of P's individual Stableford points across **all** rounds where P has any score, not just rounds with a partner. This becomes the baseline used by Feature 3.

A round counts toward a partner only if (a) the round has `pairs` set, (b) P and Q are in the same pair, (c) P has at least one scored hole in that round.

### UI placement — `StatsScreen.js → Pairs tab`

A new section between the existing "Pair performance" block and "Synergy" block:

```
PARTNER SPLITS · NOE
[chip row of players to switch the focused player]

Partner          Rounds     Avg pts     vs baseline
─────────────────────────────────────────────────
Fiz                3         32.3       +4.1
Pepe               2         27.0       −1.2
Juan               1         24.0       −4.2
```

The "vs baseline" column doubles as Feature 3 — same data, just two columns of the same table. Tap a row → opens the existing drill-down sheet with the per-round breakdown.

Reuses `selectedPlayer` state already present in `PairsTab` (line 1093) so the chip selector is shared with the existing head-to-head section.

---

## Feature 3 — Same metric vs player baseline

Already covered by the `delta` column in Feature 2's table. Tone the cell:

- `delta >= +2` → green ("lifts you")
- `delta <= -2` → red ("drags you")
- otherwise → muted

Threshold ±2 keeps small variance neutral. Bake into the existing `tone` system (`excellent` / `poor` / `neutral`).

---

## Feature 4 — Toggle running Stableford in scorecard

### Behavior

A small icon button in the scorecard header (where `setHolePickerOpen` is opened, around line 749) toggles a per-device boolean. When ON, each player's current cumulative Stableford for the round is shown in small text under their name in the player card.

State is persisted in `AsyncStorage` under `@scorecard_show_running_score` (boolean string). Each user's choice carries across sessions but does not affect the tournament data.

The total comes from `roundTotals(round, players)` filtered to the current player — already computed elsewhere in the screen, so no new helper needed. Recomputes on every score change naturally because `playerTotals` is already passed to `HoleView` (line 584).

### UI

- Toggle: small `eye` / `eye-off` icon in the header row of the scorecard. ~28×28, same `iconBtn` style.
- When OFF: nothing appears (current behavior).
- When ON: under each player's name in the per-hole panel, a small `12px PlusJakartaSans-Medium` line: `28 pts`. Color: `theme.text.muted`.

---

## Test plan

Manual:
- Create a 3-round tournament. Score round 1 fully, round 2 partially. Verify:
  - Crown appears on leader only when the gap exceeds remaining max.
  - Round 1 pair card shows crown next to winner pair (round fully scored → max remaining = 0 → automatic).
  - Switch tournament setting to best-ball → leader logic uses bestBallValue/worstBallValue caps.
- In scorecard, advance to next hole on the score that creates the clinch → popup fires once. Going back and forward again → no second popup.
- In Stats → Pairs, switch focused player → table updates. Tap row → drill-down sheet shows per-round details.
- Toggle running score in scorecard, change a stroke entry → number updates immediately.

No automated tests — codebase has none.

---

## File touch list

- `src/store/tournamentStore.js` — new helpers (≈ 80 LOC).
- `src/screens/HomeScreen.js` — crown badge in `mastersRow` and pair cards (≈ 30 LOC).
- `src/screens/ScorecardScreen.js` — toggle, persistence, running score render, clinch popup hook (≈ 60 LOC).
- `src/screens/StatsScreen.js` — `PartnerSplitsSection` inside `PairsTab` + reused drill-down (≈ 80 LOC).

Estimated: ~250 LOC across 4 files. Single PR.
