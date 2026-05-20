# Strokes Gained + Cheap New Stats — Design Spec

**Date:** 2026-05-20
**Status:** Approved (design)
**Topic:** Capture new per-hole shot details and surface lag putting, sand saves, up-and-down rates, and Strokes Gained across the four standard categories.

## Problem

The 2026-05-19 statistics audit catalogued ~50 metrics across `statsEngine.js`,
`personalStats.js`, and `scoring.js`. The Round Report Card shipped the only
gap that didn't need new data. The remaining gaps all share one root cause:
the only per-hole shot detail captured today is `{ putts, drive, teePenalties,
otherPenalties }`. That is enough for putts-per-round and tee-shot impact, but
not for the metrics weekend golfers care about most:

- **Lag putting quality** (avg putts by first-putt distance).
- **Sand-save rate**.
- **Up-and-down rate** by lie.
- **Bunker visits per round**.
- **Strokes Gained Putting / Approach / Around-the-Green / Off-the-Tee**.

This spec adds the smallest set of capture fields needed to unlock all five,
plus the Mark Broadie scratch-golfer baseline table that makes the four SG
metrics possible.

## Goals

- Add per-hole capture for sand shots, first-putt distance bucket, approach
  distance bucket, and an auto-suggested recovery outcome chip — all "me-only".
- Bundle the Broadie scratch-golfer baselines as static data; expose an
  `expectedStrokes(lie, distance)` lookup.
- Add ~8 new engine functions covering the five listed metrics.
- Surface results inside the existing **Shots** tab of `MyStatsScreen` plus
  one new headline card on the **Overview** tab.
- Explain Strokes Gained clearly in-app with a tap-to-reveal explainer.

## Non-Goals

- No tournament-scope (`StatsScreen`) extensions. Tournament-wide SG and
  sand-save tabs are obvious follow-ups but don't share data wiring with the
  personal/cross-tournament use case this spec opens with.
- No Postgres schema migration. All new fields live inside the existing
  tournament JSON blob (`round.shotDetails`).
- No exact-yardage entry. Bucket capture only.
- No fairway-vs-rough split for non-sand recoveries. Collapsed into a single
  "non-sand" bucket; rough adds ~0.1 SG of fidelity per shot and isn't worth
  the extra tap.
- No per-handicap-band baselines (DECADE / Lou Stagner). Scratch baselines
  only; per-handicap tables are a v2 swap with no consumer changes.
- No handicap-adjusted SG. SG is raw, descriptive, and clearly labelled as
  such.

## Data model

The "me-only" shot details live inside the tournament JSON blob at
`round.shotDetails[playerId][holeNumber]`. New fields slot into the existing
object; no Postgres migration is needed.

```js
// All new fields are optional. Old rounds keep working untouched.
{
  // Existing — unchanged:
  putts:           number | null,
  drive:           'left' | 'fairway' | 'right' | 'short' | 'super' | null,
  teePenalties:    number,
  otherPenalties:  number,

  // Phase A — cheap stats:
  sandShots:       number,                                 // 0 default, counter
  recoveryOutcome: 'up-and-down' | 'sand-save' | 'none'
                 | null,                                   // null = untouched; heuristic fills in
  firstPuttBucket: '0-3' | '3-6' | '6-10' | '10-20' | '20+' | null,  // feet

  // Phase B — Strokes Gained:
  approachBucket:  '0-50' | '50-100' | '100-150' | '150-200' | '200+' | null,
                                                          // yards; par-4/5 only, null on par-3
}
```

### Field semantics

- **`sandShots`** — total sand shots played on the hole. Captured even when the
  sand shot wasn't the recovery (fairway bunker on shot 2 of a par 5 still
  counts). Used directly for bunker visits and as input to the
  `recoveryOutcome` heuristic.
- **`recoveryOutcome`** — derived chip state. The heuristic fires while the
  field is `null`; the user's first tap takes ownership and the heuristic
  stops overriding. `'none'` means the user explicitly deselected both
  chips. See "Auto-selection rules" below.
- **`firstPuttBucket`** — distance bucket of the first putt of the hole.
  `null` when no putt was taken (chip-in or didn't reach the green).
- **`approachBucket`** — distance the approach shot was played from. Par-3
  drives are also approaches but are captured by `drive`, so this field is
  `null` on par-3s.

### Bucket midpoints (for SG interpolation)

```js
firstPutt: { '0-3': 1.5, '3-6': 4.5, '6-10': 8, '10-20': 15, '20+': 30 }  // feet
approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 }  // yards
```

Storing the bucket string (not the midpoint) lets us re-tune the
midpoint → expected-strokes mapping later without rewriting historical data.

## Capture UI

All capture stays inside the existing collapsible `ShotDetailPanel`
(`src/screens/ScorecardScreen.js:1712`), "me" only.

```
┌─ How many were ─────────────────────────────┐
│  Putts         [ − ] 2 [ + ]               │  existing
│  Sand shots    [ − ] 0 [ + ]               │  NEW, always shown
│  Tee penalties [ − ] 0 [ + ]               │  existing
│  Other penalt. [ − ] 0 [ + ]               │  existing
│  Driver        (left)(fwy)(rgt)(sh)(sup)   │  existing, par-3 hidden
│  Approach from (0-50)(50-100)(100-150)…    │  NEW, par-4/5 only
│  First putt    (0-3)(3-6)(6-10)(10-20)(20+)│  NEW, hidden if putts==0
│  ─────────────────────────────────────────  │
│  Outcome:  [ Up & Down ✓ ]  [ Sand Save ]  │  NEW, GIR-missed only
└─────────────────────────────────────────────┘
```

### Rendering rules

- **Approach bucket row:** shown when `hole.par !== 3`.
- **First-putt row:** shown when `putts ≥ 1`. Hidden for chip-ins (putts = 0).
- **Outcome chips:** shown when GIR was missed (`strokes − putts > par − 2`).
  Hidden on GIR-hit holes; the stored value is retained across temporary edits.
- **Sand shots counter:** always visible. Captures bunker visits independent
  of whether they were the recovery.
- **No required fields.** Every input is optional; skipping just excludes the
  hole from the corresponding metric.
- **One-time mini-explainer:** the first time each new row appears, a small
  (?) icon next to the label opens a sheet with one-paragraph context.
  One-shot dismiss per row, stored locally.

### Auto-selection rules for `recoveryOutcome`

Recomputed on every change to `strokes / putts / sandShots` while
`recoveryOutcome === null`:

| Condition | Auto-set value |
|---|---|
| GIR hit | `null` — chips not shown, no recovery happened |
| GIR missed AND `putts == 1` AND `sandShots == 0` | `'up-and-down'` |
| GIR missed AND `putts == 1` AND `sandShots ≥ 1` | `'sand-save'` |
| GIR missed AND `putts ≠ 1` | `null` — heuristic abstains; chips remain tappable |

Once the user taps any chip, the heuristic stops firing. `'up-and-down'`
and `'sand-save'` are mutually exclusive in the UI (sand save implies up-and-
down semantically; we display the more specific one).

## Strokes Gained, explained

### Plain-language definition

Strokes Gained measures how much better or worse you played a shot than a
benchmark golfer would have played from the same spot. Positive = strokes
gained vs benchmark; negative = strokes lost. Sum across a round → **SG
Total**.

### Benchmark

We use **Mark Broadie's scratch-golfer baselines** from *Every Shot Counts*
(Putnam, 2014). They're the published academic reference and the basis of
PGA Tour ShotLink SG numbers and most consumer SG implementations (Arccos,
Shot Scope, DECADE). Roughly 150 rows of `(lie × distance bin → expected
strokes to hole out)`.

Example rows:

| Lie | Distance | Expected strokes |
|---|---|---|
| Fairway | 150y | 2.92 |
| Rough | 150y | 3.10 |
| Sand | 20y | 2.42 |
| Green | 12ft | 1.78 |
| Green | 3ft | 1.05 |

### Math

```
SG(shot) = expected_strokes(start_lie, start_distance)
         − expected_strokes(end_lie, end_distance)
         − 1
```

The `−1` accounts for the stroke spent making the move. If the shot holes
out, `end_expected = 0`.

### The four categories surfaced

| Category | Measures | Inputs |
|---|---|---|
| **SG Off-the-Tee** | Tee-shot quality | `drive` + `teePenalties` + `hole.distance` (when available; else assume par-typical length) |
| **SG Approach** | Approach shots into the green | `approachBucket` + GIR outcome + `firstPuttBucket` (for end state) |
| **SG Around-the-Green** | Recovery shots (chip / pitch / bunker) | `sandShots` + `recoveryOutcome` + GIR-missed |
| **SG Putting** | Putting quality from first-putt distance | `firstPuttBucket` + `putts` |

**SG Total = sum of the four.**

### Fidelity disclaimer

Because we store buckets not exact yardage, every SG number is a bucket-
midpoint approximation. The UI labels SG numbers as estimates with an
expected accuracy of ±0.2 strokes per round vs full shot-tracking.

### What SG does not do

- Doesn't compare you to your own historical baseline — the Round Report
  Card already does that.
- Doesn't tell you which club to hit. SG is descriptive, not prescriptive.
- Doesn't handicap-adjust. We may add a per-handicap-band table in a v2
  swap-in.

## Strokes Gained baseline sourcing

### Chosen source

Mark Broadie's scratch baselines, hard-coded as a static JSON-ish module.

| Source | Why we picked / passed |
|---|---|
| **Broadie scratch** (chosen) | Free, published, industry standard. ~150 rows. Ships today. |
| Lou Stagner / DECADE amateur baselines | Better fit for our weekend-golfer audience; paid/licensed. Phase 2 swap behind the same lookup signature — no consumer changes. |
| Self-derived peer baseline | Free once we have ≥500 rounds of `shotDetails`. Build the lookup interface now, swap the table when data justifies it. |

### Module layout

`src/store/strokesGainedBaseline.js`:

```js
export const BASELINES = {
  tee:      [ {distance, expected}, … ],   // by hole length, par-3/4/5 templates
  fairway:  [ {distance, expected}, … ],   // yards
  rough:    [ {distance, expected}, … ],   // yards
  sand:     [ {distance, expected}, … ],   // greenside bunker, yards
  recovery: [ {distance, expected}, … ],   // blended fairway+rough for non-sand recoveries
  green:    [ {distance, expected}, … ],   // FEET, not yards
};

export const BUCKETS = { /* see Data model */ };

// Binary-search lookup with linear interpolation between rows.
// Clamps out-of-range queries to nearest endpoint.
export function expectedStrokes(lie, distance) { … }
export function expectedFromBucket(category, bucketKey) { … }
```

The lookup is the only public surface; SG functions never read the table
directly. That keeps the table swappable.

## Engine functions

All new functions are pure and follow the existing `statsEngine.js`
conventions (return `null` below sample threshold; expose `sampleHoles`
alongside aggregates).

### `src/store/scoring.js` — new pure helpers

| Function | Returns |
|---|---|
| `recoveryOutcomeFromState({strokes, putts, sandShots, par, gir})` | Auto-derived chip value matching the truth table above |
| `isGIR({strokes, putts, par})` | Boolean — already implicit in `shotStats`, now extracted |

### `src/store/statsEngine.js` — Phase A (cheap stats)

| Function | Returns |
|---|---|
| `lagPuttingQuality(rounds, playerId)` | `{ avgPuttsByBucket, threePuttRateByBucket, sample: { perBucket } }` |
| `sandSaveRate(rounds, playerId)` | `{ attempts, saves, rate, perRound }` |
| `upAndDownRate(rounds, playerId)` | `{ attempts, conversions, rate, byLie: { sand, nonSand } }` |
| `bunkerVisits(rounds, playerId)` | `{ totalShots, holesWithSand, avgPerRound }` |

Sample thresholds:

- Lag putting: ≥12 putts in a bucket before reporting that bucket.
- Sand save: ≥4 attempts before reporting a rate.
- Up-and-down: ≥6 missed-GIR holes before reporting.
- Bunker visits: no threshold (count is interpretable at any sample).

### `src/store/statsEngine.js` — Phase B (Strokes Gained)

| Function | Returns |
|---|---|
| `sgOffTheTee(round, playerId)` | `{ perHole: [], total, sampleHoles }` |
| `sgApproach(round, playerId)` | Same shape, par-4/5 only |
| `sgAroundGreen(round, playerId)` | Same shape, missed-GIR only |
| `sgPutting(round, playerId)` | Same shape, all holes with `firstPuttBucket` |
| `sgTotal(round, playerId)` | `{ total, byCategory: { …4 }, sampleHoles }` |
| `sgSeason(rounds, playerId)` | `{ total, perRound, byCategory, trend, sampleHoles }` |

Holes with missing inputs return `null` per hole and are excluded from the
aggregate. `sgTotal === sum(sgByCategory)` is an enforced invariant.

### `src/store/personalStats.js` — integration

`computeMyStats` returns a new `strokesGained` block alongside existing
`form`, `breakdown`, `shots`. Existing `shots` extends to include
`lagPutting`, `sandSaves`, `upAndDown`, `bunkerVisits`. No change to the
synthetic-tournament `rekey` helper — it already passes `shotDetails`
through and the new keys ride along.

## UI surfaces

### MyStatsScreen — Overview tab

One new card slots into the existing snapshot row:

- **"This season vs scratch"** — single SG/round number with up/down arrow,
  same explainer-on-tap as the Shots-tab card.

### MyStatsScreen — Shots tab

Three new sections, in order, above the existing tee-shot impact section:

1. **Strokes Gained card** (top)
   - Headline: `SG Total / round: ±X.X` with `sampleHoles` badge.
   - Four sub-bars (SG Off-the-Tee / Approach / Around-Green / Putting),
     each labelled with the value and a horizontal bar centered on 0
     (green right, red left). Reuses the `react-native-svg` patterns from
     `src/screens/scoringModes.js` and `src/components/ShareableCard.js`.
   - Tap → `StatDetailSheet`:
     - Plain-language explainer (the Strokes Gained section above).
     - Per-round SG trend (last 10 rounds, line chart).
     - Fidelity disclaimer line.

2. **Putting** (existing → extended)
   - Existing `puttsPerRound`, `threePuttsPerRound` rows kept.
   - New **"Putts by first-putt distance"** sub-section: one row per bucket
     with `avgPutts` and a "vs scratch: 1.4 from 6–10ft" annotation read
     from `BASELINES.green`.

3. **Around the Green** (new section, between Putting and Tee impact)
   - **Sand-save rate** — `x of y, X%`. Sub-line: "Scratch avg: 51%".
   - **Up-and-down rate** — `x of y, X%`. Sub-line: "Scratch avg: 60%".
   - **Bunker visits** — `X.X per round`.
   - Each row taps to `StatDetailSheet` with the underlying per-round list.

### StatsScreen (tournament view)

Deferred. Tournament-scope SG and sand-save tabs are obvious follow-ups
but don't share data dependencies with the personal use case this spec
opens with.

## Backward compatibility

- **Reads:** every new field defaults to `null` / `0` via the
  `{ ...DEFAULT_SHOT, ...detail }` pattern already in
  `ScorecardScreen.js:1713`. Extending `DEFAULT_SHOT` covers reads from old
  rounds for free.
- **Engine functions:** a hole that lacks the inputs for a metric returns
  `null` for that metric and is excluded from the aggregate denominator.
  Every aggregate exposes `sampleHoles` so the UI can show "from 24 of 180
  holes logged" instead of pretending small samples are meaningful.
- **UI gating:** every new card has a `sampleHoles < N` empty state ("Start
  logging first-putt distance to see this") matching `MyStatsScreen`'s
  existing empty-state pattern.
- **Seasonal SG:** starts showing once `sampleHoles ≥ 18`. Below that, the
  SG card shows the empty state.
- **No data migration.** Existing tournament JSON blobs are left alone.
  Fields appear in a hole only after the user logs it post-deploy.

## Testing

Mirrors the existing test layout under `src/store/__tests__/` and
`src/screens/__tests__/`.

### Unit tests

- **`strokesGainedBaseline.test.js`** — snapshot the published rows; verify
  `expectedStrokes` interpolates correctly between rows; verify out-of-range
  queries clamp to the nearest endpoint without throwing.
- **`scoring.test.js`** — `recoveryOutcomeFromState` truth table including
  chip-in (`putts == 0`), 2+ putts on a missed GIR, and GIR-hit cases.
- **`statsEngine.test.js`** — golden-case fixtures:
  - One full-coverage round (all 18 holes have new fields, mix of GIR/
    missed/sand/chip-in) — verify each new function returns the expected
    value.
  - One legacy-shape round (no new fields) — verify each new function
    returns `null`.
  - Invariant: `sgTotal === sum(sgByCategory)` on the full-coverage round.
- **`personalStats.test.js`** — `computeMyStats` returns the new
  `strokesGained` block; `rekey` preserves the new keys through synthetic
  tournament construction.
- **`ScorecardScreen.test.js`** (React Testing Library) — capture panel:
  visibility rules (par-3 hides approach, putts=0 hides first-putt row,
  GIR-hit hides outcome chips); `recoveryOutcome` auto-selection; tapping
  an auto-selected chip takes user ownership and the heuristic stops
  overriding.

### Coverage target

≥85% line coverage on the new files, matching existing store-module
coverage.

### Manual test plan

1. Log a fresh round with every new field populated. Verify SG numbers
   appear on the Shots tab and the SG card on Overview.
2. Re-open an old finished tournament. Verify Shots tab shows empty states
   for new sections, existing stats unchanged.
3. Edit a hole post-round so GIR flips from missed → hit. Verify outcome
   chips disappear, stored `recoveryOutcome` retained.
4. Cross-platform: confirm capture works on Web (mouse) and Android (touch).
5. Tap the (?) explainer on each new row. Verify one-shot dismissal sticks
   across app restart.

## Open questions

None at design time. Implementation may surface bucket-edge cases in
Broadie's table (e.g., very long approach buckets beyond the 200y row) —
the lookup helper clamps to the nearest endpoint, which is the standard
amateur SG convention.

## Phasing

Spec covers both phases in one design but the implementation plan should
land them as separate PRs:

1. **Phase A PR** — data model fields, capture UI, `recoveryOutcome`
   heuristic, lag putting + sand saves + up-and-down + bunker visits
   functions, UI sections for Putting + Around-the-Green.
2. **Phase B PR** — `strokesGainedBaseline.js`, the four SG round functions,
   `sgSeason`, the SG card on Shots tab, the SG card on Overview, the
   explainer copy.

Phase C (conditions, pacing, peer comparison) is out of scope for this
spec and gets its own design when prioritised.
