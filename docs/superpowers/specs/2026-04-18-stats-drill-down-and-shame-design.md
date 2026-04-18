# Stats Enhancements — Drill-down, Hall of Shame, Pair Hole Wins

Date: 2026-04-18

## Goal

Enhance `StatsScreen` so users can:

1. Tap any numeric stat card to see **where it came from** (round, course, hole, strokes, points).
2. Browse a new **Hall of Shame** tab with humorous "bad streak" statistics.
3. In the **Pairs** tab, see per-player "holes won on points" split into best-ball / worst-ball / total with wins / ties / losses.

## Scope

- File surface: `src/store/statsEngine.js`, `src/screens/StatsScreen.js`, one new component for the bottom-sheet drill-down.
- No new screen in the navigator — all changes live inside the existing `StatsScreen`.
- No persistence changes. All stats are recomputed from `tournament` state on the fly.

## Design

### 1. Drill-down on stat cards

**Data shape change.** Every aggregation in `statsEngine.js` that returns a scalar and is surfaced as a card also returns a `breakdown` array with the concrete holes or rounds that produced the number.

Examples:

- `playerStreaks(t, pid, { useNet })` becomes:
  ```js
  {
    bestParStreak: { count, holes: [{ roundIndex, courseName, holeNumber, par, strokes, points, vsPar }] },
    bestBirdieStreak: { count, holes: [...] },
    worstBogeyStreak: { count, holes: [...] },
  }
  ```
  `holes` contains exactly the holes that make up the longest streak (not the full run).

- `playerScoreDistribution` adds per-bucket `holes: { eagles: [...], birdies: [...], pars: [...], bogeys: [...], doubles: [...], worse: [...] }`.

- `tournamentHighlights` returns the existing summaries, each augmented with a `breakdown`:
  - `bestRound` → full hole list of that round with per-hole points/strokes.
  - `mostBirdies` → one row per birdie/eagle scored.
  - `longestParStreak` → the streak holes.
  - `bestHole` / `worstHole` → per-player scores on that hole.

- `bestWorstHoles` → each hole entry adds `playerScores: [{ playerId, playerName, strokes, points }]`.

- `pairPerformance` → each pair adds `rounds: [{ roundIndex, courseName, combinedPoints, memberPoints: [{ playerId, points }] }]`.

- `headToHead` already returns `holes[]`; no change needed beyond already-present fields.

**UI — bottom-sheet.** A single `StatDetailSheet` component renders any drill-down. Props:

```
{
  visible, onClose,
  title,          // e.g. "Best par streak — 5 holes"
  subtitle,       // e.g. "Luis · net"
  rows: [{ label, sub, rightPrimary, rightSecondary, tone }],
}
```

Each card that has a breakdown becomes a `TouchableOpacity` that opens the sheet with the right rows. The sheet uses React Native's `Modal` with `animationType="slide"` anchored to the bottom, a drag handle, and a backdrop tap-to-close. No new dependency.

Row examples:
- "R2 · Montecastillo · Hoyo 7" / "Par 4 · SI 3" / "3 golpes" / "3 pts"
- "R1 · Valderrama · Hoyo 12" / "Par 5 · SI 1" / "4 golpes" / "5 pts"

### 2. Hall of Shame tab

New 5th tab `Shame`. Respects the existing Gross/Net toggle.

Cards (each tappable, each has a breakdown):

- **🏌️ El Triple Bogey Club** — worst single hole of the tournament by (strokes − par − netExtra). Drill-down: that one hole, all four players' scores.
- **💀 Racha de la Vergüenza** — longest consecutive-bogey-or-worse streak across all players. Drill-down: each hole of the streak for the owner.
- **🕳️ Cero Patatero** — longest consecutive 0-point-stableford streak across all players. Drill-down: each hole.
- **🎁 El Regalo** — hole where a player scored the fewest stableford points vs the other three in the same round by the largest margin. Drill-down: the hole with all four scores.
- **📉 El Desmoronamiento** — round where a player's front-9 total − back-9 total is the largest positive gap (big drop). Drill-down: hole-by-hole of that round.
- **🪣 El Bucketazo** — hole with the single highest stroke count in the tournament. Drill-down: that hole.

All six expose the player name, course, and specific hole(s). If no eligible data exists, the card hides rather than showing zero.

New engine function: `hallOfShame(tournament, { useNet })` returning `{ tripleBogey, shameStreak, ceroPatatero, regalo, desmoronamiento, bucketazo }` each `{ player, ...metric, breakdown }`.

### 3. Pair hole wins (Pairs tab)

New section `HOLE WINS ON POINTS` under `PAIR CHEMISTRY`.

New engine function: `pairHoleWins(tournament)` → array of `{ player, best: {W, T, L}, worst: {W, T, L}, total: {W, T, L}, breakdown: [...] }`.

**Attribution rules (per hole, per round with two pairs):**

1. Compute each player's stableford on the hole.
2. Within the player's pair, identify the best-ball contributor(s) = highest score (tie → both).
3. Within the player's pair, identify the worst-ball contributor(s) = lowest score (tie → both).
4. Best-ball hole outcome = compare max(pair1) vs max(pair2) → W / T / L for the pair.
5. Worst-ball hole outcome = compare min(pair1) vs min(pair2) → W / T / L for the pair.
6. A player receives the best-ball W/T/L credit **only if they were a best-ball contributor** for their pair on that hole. Same rule for worst-ball.
7. `total = best + worst` component-wise.

Holes skipped: if any of the four scores is missing, the hole contributes nothing.

**UI.** One row per player:

```
Juan             MB  3·2·4    PB  2·1·6    Tot  5·3·10
```

Color tone on W (green) / T (muted) / L (red). Tapping a row opens the drill-down listing every hole the player received credit for, with columns: course · hole · pair role (MB/PB) · outcome (G/E/P) · points vs opponent pair.

### 4. Component boundaries

- `statsEngine.js` stays pure. Every new/changed function still returns plain data. All changes additive for shape-compatibility (existing fields preserved; new `breakdown` fields added alongside).
- `StatDetailSheet` is a new file in `src/components/StatDetailSheet.js`. Takes generic `rows`, no knowledge of stats domain.
- `StatsScreen.js` keeps its tab structure. Each tab component owns the state for "which sheet is open with what data".
- `HallOfShame` tab is a new sub-component inside `StatsScreen.js`.

### 5. Testing strategy

Manual smoke on:
- Empty tournament (no rounds scored) → all tabs render empty states, no crashes.
- Single-round tournament → stats show, breakdowns contain one round.
- Full 3-round tournament with handicaps → gross/net toggle changes distributions, streaks, and Hall of Shame.
- Pair hole wins row math: W+T+L per row must equal holes played where that player contributed as MB (resp. PB).

No automated test harness added in this pass; existing code has none.

### 6. Out of scope

- Persisting stats.
- Sharing/exporting drill-downs.
- Changing the Gross/Net toggle behavior on the Holes and Pairs tabs (currently hidden on those tabs; left as-is).
- Charts or visualizations beyond the existing distribution bars.

## Risks

- `statsEngine.js` grows. If any function exceeds ~80 lines after changes, split into a helper file (`statsEngineShame.js` / `statsEnginePairs.js`). Decide during implementation, not up front.
- Bottom-sheet on Android vs iOS via `Modal` — confirm backdrop and keyboard behavior on a physical device during manual smoke; if jank appears, swap to `@gorhom/bottom-sheet` (already a common React Native pick). Dependency add would be a separate PR.
- Drill-down data volume: for a completed 3-round tournament the largest breakdown is ~54 rows. Trivial for a scroll view; no virtualization needed.
