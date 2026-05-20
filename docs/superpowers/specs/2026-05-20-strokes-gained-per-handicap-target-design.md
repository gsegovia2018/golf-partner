# Strokes Gained per Handicap + Target Comparison — Design Spec

**Date:** 2026-05-20
**Status:** Approved (design)
**Topic:** Parametrize the Strokes Gained framework by a user-chosen target handicap. Let users compare their performance to a target instead of (or in addition to) scratch, and surface where they're ahead or behind that target across the four SG categories.

## Problem

Phase B shipped the Strokes Gained framework comparing the user against Mark Broadie's scratch-golfer baselines. For a weekend mid-handicapper, "vs scratch" is informative but not actionable — almost everyone shows negative SG everywhere, and the only way to move the number meaningfully is to become a scratch golfer.

What's actionable is **"how do I compare to a golfer one or two handicaps better than me?"** A target handicap is a real, set-able goal. Comparing per-category SG against that target tells the user *which part of their game has the biggest gap* — the part to practice first.

## Goals

- Add a per-user `target_handicap` setting, defaulting to null (= no preference = vs scratch, preserving Phase B behavior bit-for-bit).
- Parametrize the SG framework so the same engine functions compute "SG vs handicap H" for any H ≥ 0.
- Surface the user's target in the SG card title and bars on `MyStatsScreen` (Shots and Overview tabs).
- Provide a settings-side entry point (Profile screen) AND an inline entry point (pencil icon on the SG card).
- Convert all distance units from imperial to metric across the SG system (Broadie source tables + capture buckets) — Europe-friendly and aligned with how Spanish courses store yardage.

## Non-Goals

- **No per-handicap-band tables (DECADE / Stagner).** This spec uses two-table linear blending (scratch + 14-amateur). Per-handicap-band tables are a future swap behind the same lookup signature.
- **No synthetic peer baseline.** Once we have ≥500 logged rounds we can compute a baseline from our own users; deferred to a future spec.
- **No "Gap to target" summary section.** A dedicated "biggest gap / smallest gap" section on the Shots tab is an obvious follow-up but out of scope here.
- **No methodology disclosure in the UI.** Users see "SG vs 12.5-handicap target" and the bars. They don't see "interpolated from Broadie's scratch and 14-amateur tables, ±X strokes accuracy" — that text lives in code comments and this spec only.
- **No multi-target comparison.** One target at a time; users can change it freely.
- **No positive-handicap (+handicap) support.** DB constraint `target_handicap >= 0` forbids it.

## Data model

### Supabase migration

```sql
-- supabase/migrations/20260520000000_target_handicap.sql
alter table profiles
  add column target_handicap numeric
    check (target_handicap is null or target_handicap >= 0);
```

`null` is the default — means "user has not picked a target". `0` means "user explicitly picked scratch". Both produce identical UI and SG values; the distinction matters only for the one-time onboarding nudge (see "Settings UI").

### Baseline tables (in-memory)

Two tables bundled in `src/store/strokesGainedBaseline.js`:

- **`BASELINES_SCRATCH`** — Phase B's existing table, with all distances converted from imperial to metric.
- **`BASELINES_AMATEUR`** — new. Mark Broadie's "average amateur" (~14-handicap) data from *Every Shot Counts* (Putnam 2014) and follow-up papers, distances in meters.

Each table maps a lie to an array of `{ distance, expected }` rows sorted ascending by distance. Distances are meters for all lies (yes, including green — feet × 0.3048 → meters).

#### Approximate amateur values (implementer must verify against published tables)

```js
export const BASELINES_AMATEUR = {
  tee: [
    { distance:  91.4, expected: 2.85 },
    { distance: 137.2, expected: 3.10 },
    { distance: 182.9, expected: 3.42 },
    { distance: 228.6, expected: 3.78 },
    { distance: 274.3, expected: 4.18 },
    { distance: 320.0, expected: 4.55 },
    { distance: 365.8, expected: 4.92 },
    { distance: 411.5, expected: 5.27 },
    { distance: 457.2, expected: 5.58 },
    { distance: 502.9, expected: 5.86 },
  ],
  fairway: [
    { distance:  45.7, expected: 2.85 },
    { distance:  91.4, expected: 3.10 },
    { distance: 137.2, expected: 3.32 },
    { distance: 182.9, expected: 3.70 },
    { distance: 228.6, expected: 4.10 },
    { distance: 274.3, expected: 4.50 },
  ],
  rough: [
    { distance:  45.7, expected: 3.10 },
    { distance:  91.4, expected: 3.30 },
    { distance: 137.2, expected: 3.55 },
    { distance: 182.9, expected: 3.95 },
    { distance: 228.6, expected: 4.40 },
  ],
  sand: [
    { distance:   9.1, expected: 2.75 },
    { distance:  18.3, expected: 2.90 },
    { distance:  27.4, expected: 3.05 },
    { distance:  45.7, expected: 3.30 },
    { distance:  91.4, expected: 3.65 },
  ],
  recovery: [
    { distance:  45.7, expected: 3.20 },
    { distance:  91.4, expected: 3.40 },
    { distance: 137.2, expected: 3.60 },
    { distance: 182.9, expected: 4.00 },
  ],
  green: [
    { distance:  0.91, expected: 1.10 },
    { distance:  1.83, expected: 1.65 },
    { distance:  3.05, expected: 1.85 },
    { distance:  4.57, expected: 1.96 },
    { distance:  6.10, expected: 2.03 },
    { distance:  9.14, expected: 2.20 },
    { distance: 15.24, expected: 2.50 },
  ],
};
```

Values are best approximations from published Broadie data — the implementation task includes a step to verify against the source.

### Bucket retrofit: Phase B imperial → metric

Phase B shipped with imperial bucket strings in `shotDetails`. Since no real round data exists yet, we change the bucket keys without a data migration.

| `firstPuttBucket` (was feet) | New (meters) |
|---|---|
| `'0-3'` | `'0-1'` |
| `'3-6'` | `'1-2'` |
| `'6-10'` | `'2-3'` |
| `'10-20'` | `'3-6'` |
| `'20+'` | `'6+'` |

| `approachBucket` (was yards) | New (meters) |
|---|---|
| `'0-50'` | `'0-50'` (key same; semantics now meters) |
| `'50-100'` | `'50-100'` |
| `'100-150'` | `'100-150'` |
| `'150-200'` | `'150-200'` |
| `'200+'` | `'200+'` |

**Note on approach buckets:** the boundaries (50, 100, 150, 200) stay the same numerically but represent meters now, not yards. A "100–150 m" approach covers ~9% greater absolute distance than a "100–150 y" approach. This is intentional — Spanish golfers think in meters, so the boundaries are correct in the user's mental model.

**Note on first-putt buckets:** the boundary values (0/1/2/3/6) are rounded conversions of feet (0/3/6/10/20). They cover slightly different absolute distances than the imperial originals. Acceptable trade-off for golfer-friendly meter values.

**Holes logged with the old imperial keys** (if any test rounds exist) will be silently excluded from new metrics — engine sees an unknown bucket and returns `null` per hole. No data corruption, just missing rows in per-bucket aggregates.

### Updated bucket midpoints (meters)

```js
export const BUCKETS = {
  firstPutt: { '0-1': 0.5, '1-2': 1.5, '2-3': 2.5, '3-6': 4.5, '6+': 9 },
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },
};
```

## Baseline blending math

For any target handicap `H ≥ 0`:

```js
const AMATEUR_ANCHOR_HANDICAP = 14;

function blendedExpected(lie, distance, targetHandicap) {
  const t = Math.max(0, Math.min(2, targetHandicap / AMATEUR_ANCHOR_HANDICAP));
  const a = lookupScratch(lie, distance);
  const b = lookupAmateur(lie, distance);
  if (a == null || b == null) return null;
  return a + t * (b - a);
}
```

| `H` | `t` | Behavior |
|---|---|---|
| 0 | 0 | Pure scratch — identical to Phase B. |
| 7 | 0.5 | Halfway between scratch and 14-amateur. |
| 14 | 1 | Pure amateur. |
| 21 | 1.5 | Linearly extrapolated halfway beyond amateur. |
| 28 | 2 | Linear extrapolation, capped at 2× the amateur–scratch gap. |
| 28+ | 2 | Clamped — values stop growing past handicap 28. |

The clamp at `t = 2` prevents extreme extrapolation. Beyond handicap ~25, the blended values are increasingly approximate but never produce nonsense numbers.

## Settings UI + onboarding

### Entry points

The user can set their target from two places:

1. **Inline on the SG card** (Shots tab + Overview tab) — a pencil icon next to the card title opens the picker.
2. **Profile/Settings screen** — a "Target handicap" row that opens the same picker.

Both routes open the same `<TargetHandicapPicker>` component.

### The picker

```
┌─ Set your target ───────────────────────────┐
│                                             │
│         [ 12.5 ]   ▼ ▲                      │
│                                             │
│  Compared against a handicap-12.5 golfer.   │
│                                             │
│  ⓘ Use my current handicap (15.4)           │
│                                             │
│  [ Cancel ]              [ Save ]           │
└─────────────────────────────────────────────┘
```

- Numeric input, validated `0 ≤ value ≤ 36`, decimal step 0.5.
- "Use my current handicap" preset reads the most recent round's `playerHandicaps[me]` (one-tap shortcut for "compare against where I am now").
- Save persists to `profiles.target_handicap`.
- Cancel does not write.

### Default behavior + onboarding

| Scenario | Behavior |
|---|---|
| New user, no rounds, `target_handicap = null` | SG card identical to Phase B ("vs scratch"). |
| Existing user (post-Phase B) opens app, `target_handicap = null` | Same — no UI change. No prompt. |
| User has logged ≥18 SG-eligible holes AND `target_handicap = null` | **One-time dismissible nudge** on the SG card: *"Tip: set a target handicap to see where you'd improve most."* Stored dismiss flag in AsyncStorage; never reappears. |
| User sets `target_handicap` to non-null value | SG card title updates live. Bars recompute. No celebration screen. |
| User clears target back to null (Reset button in picker) | UI reverts to "vs scratch" framing. |

### Card title language

| `target_handicap` | Shots tab card title | Overview snapshot label |
|---|---|---|
| `null` (default) | Strokes Gained vs scratch | SG vs scratch |
| `0` | Strokes Gained vs scratch | SG vs scratch |
| `0 < H ≤ 36` | Strokes Gained vs `H`-handicap target | SG vs handicap `H` |

`null` and `0` produce identical UI. The semantic difference (`null` = "I never picked"; `0` = "I explicitly picked scratch") is internal — used only to trigger the onboarding nudge.

## Code structure

### File changes

| File | Change |
|---|---|
| `supabase/migrations/20260520000000_target_handicap.sql` | NEW. Adds `target_handicap numeric` column with `>= 0` check. |
| `src/store/strokesGainedBaseline.js` | MODIFIED. Rename `BASELINES` → `BASELINES_SCRATCH`. Convert distances to meters. Add `BASELINES_AMATEUR`. Add `AMATEUR_ANCHOR_HANDICAP`. Extend `expectedStrokes` and `expectedFromBucket` with optional `targetHandicap = 0` parameter. Add private `blendedExpected` helper. |
| `src/store/statsEngine.js` | MODIFIED. `BUCKETS` updated to metric. The six SG functions (`sgPutting`, `sgAroundGreen`, `sgApproach`, `sgOffTheTee`, `sgTotal`, `sgSeason`) each gain `targetHandicap = 0` parameter that threads through to the lookup. `FIRST_PUTT_BUCKETS_LIST` updated to metric keys. |
| `src/store/personalStats.js` | MODIFIED. `computeMyStats(selectedRounds, { n, targetHandicap = 0 })` — new option. Passes through to `sgSeason`. |
| `src/screens/ScorecardScreen.js` | MODIFIED. `FIRST_PUTT_BUCKETS` and `FIRST_PUTT_LABELS` retrofitted to metric keys and meter labels. `APPROACH_LABELS` relabeled `'0-50m'`, etc. Explainer body text updates from feet/yards to meters. |
| `src/store/profileStore.js` | MODIFIED. Add `getTargetHandicap()` and `setTargetHandicap(value)` methods that round-trip to Supabase. |
| `src/components/mystats/TargetHandicapPicker.js` | NEW. Modal numeric picker with "Use my current handicap" preset, Save/Cancel, and an optional Reset (clear back to null). |
| `src/components/mystats/tabs/ShotsTab.js` | MODIFIED. SG SectionCard title becomes dynamic from `targetHandicap`. Pencil icon next to title opens the picker. One-time nudge logic added. |
| `src/components/mystats/tabs/OverviewTab.js` | MODIFIED. SG snapshot label becomes dynamic. Pencil icon opens the picker. |
| `src/components/mystats/statExplainers.js` | MODIFIED. `strokesGained` entry's title/subtitle dynamically reflect the current target. |
| `src/screens/ProfileScreen.js` (or wherever profile-edit UI lives) | MODIFIED. Adds "Target handicap" row that opens `<TargetHandicapPicker>`. |
| `src/screens/MyStatsScreen.js` | MODIFIED. Reads `target_handicap` from `profileStore`, passes to `computeMyStats({ targetHandicap })`. Manages picker open/close state. |

### Key signatures

```js
// strokesGainedBaseline.js
export const BASELINES_SCRATCH = { /* meters */ };
export const BASELINES_AMATEUR = { /* meters, ~14-handicap */ };
export const AMATEUR_ANCHOR_HANDICAP = 14;

export function expectedStrokes(lie, distance, targetHandicap = 0) { … }
export function expectedFromBucket(category, bucketKey, targetHandicap = 0) { … }
```

```js
// statsEngine.js (per SG function)
export function sgPutting(round, playerId, targetHandicap = 0) { … }
// ...and the same signature shape for the other five.
```

```js
// personalStats.js
export function computeMyStats(
  selectedRounds,
  { n = 5, targetHandicap = 0 } = {},
) {
  // ...
  strokesGained: sgSeason(synthetic.rounds, CANON_ID, targetHandicap),
  // ...
}
```

```js
// profileStore.js
export function getTargetHandicap(): Promise<number | null>;
export function setTargetHandicap(value: number | null): Promise<void>;
```

### Data flow

```
Supabase profiles.target_handicap (nullable numeric)
        ↓ on app load / focus
profileStore.getTargetHandicap() → number | null
        ↓
MyStatsScreen reads it, passes to computeMyStats({ targetHandicap: value ?? 0 })
        ↓
computeMyStats → sgSeason(rounds, playerId, targetHandicap)
        ↓
each sg* function → expectedStrokes(lie, distance, targetHandicap)
        ↓
blendedExpected returns the interpolated value
```

When `target_handicap` is `null` or `0`, the call chain passes `0` → `t = 0` → returns the scratch value → Phase B behavior preserved exactly.

## UI specifics

### SG card title with pencil icon

```
┌─ Strokes Gained vs 12.5-handicap target  ✏️ ──┐
│                                                │
│  +0.42 per round                               │
│  From 54 holes · estimated from buckets        │
│                                                │
│  Off the tee   ▆▆▆▎          +0.12             │
│  Approach      ▆▆▎            +0.08            │
│  Around green       ▍▆▆       -0.06            │
│  Putting       ▆▆▆▆▆          +0.28            │
└────────────────────────────────────────────────┘
```

Tap the pencil → `<TargetHandicapPicker>`. Tap the card body → existing detail sheet (explainer + last-10 trend).

### One-time nudge

Shown inline at the bottom of the SG card when `sampleHoles ≥ 18` AND `target_handicap === null` AND nudge dismissal flag is unset:

```
ⓘ Tip: set a target handicap to see where you'd improve most.   ×
```

Tap `×` → write dismissal flag to AsyncStorage → never reappear. Tap the body → opens picker.

### Profile screen entry

A new row under the existing handicap row:

```
Target handicap          [ 12.5 ›
```

Tap → opens `<TargetHandicapPicker>`. Shows current value or "Not set" placeholder.

## Backward compatibility

- **Default behavior unchanged.** `target_handicap = null` → all SG functions receive `0` → return scratch values identical to Phase B.
- **Phase B regression tests still pass** — the existing SG test suite calls every function without the `targetHandicap` arg, which defaults to 0.
- **Bucket retrofit:** Phase B's imperial bucket strings are replaced. No data migration because Phase B just shipped and no real round data uses these fields yet. Any test rounds with old keys produce missing-bucket nulls (graceful degradation).
- **Migration is additive.** The `target_handicap` column is nullable with no default — old `profiles` rows have `null` until the user opts in.

## Testing

### Unit tests

- **`strokesGainedBaseline.test.js`** (extend):
  - `BASELINES_AMATEUR`: every category sorted ascending by distance.
  - `expectedStrokes(lie, distance, 0)` returns Phase B values (regression-locks scratch).
  - `expectedStrokes(lie, distance, 14)` returns the amateur table value at that distance.
  - `expectedStrokes(lie, distance, 7)` returns the midpoint between scratch and amateur.
  - `expectedStrokes('fairway', 137.2, 28)` returns `2 × amateur − scratch` (extrapolation at `t = 2`).
  - `expectedStrokes(lie, distance, > 28)` clamps to the same extrapolated value.
  - `expectedFromBucket('firstPutt', '2-3', 10)` interpolates correctly.

- **`statsEngine.test.js`** (extend):
  - Each of the six SG functions: pass a non-zero `targetHandicap` and verify the SG value shifts in the expected direction.
  - All existing Phase B SG tests (no `targetHandicap` arg, default 0) still pass — regression lock.

- **`personalStats.test.js`** (extend):
  - `computeMyStats(rounds, { targetHandicap: 12 })` produces a `strokesGained` block computed against the 12-handicap baseline.

- **`profileStore.test.js`** (extend or create):
  - Round-trips `targetHandicap` to Supabase.
  - Returns `null` when never set.
  - `setTargetHandicap(36)` succeeds; `setTargetHandicap(-1)` rejects.

- **`TargetHandicapPicker.test.js`** (NEW, RNTL):
  - Renders current value when one is set; renders blank/placeholder when `null`.
  - "Use my current handicap" preset fills the input from the most-recent-round handicap.
  - Save calls the store with the new value.
  - Cancel doesn't write.

### Integration tests

- **`ShotsTab.test.js`** (extend or NEW):
  - Card title says "Strokes Gained vs scratch" when `targetHandicap` is null or 0.
  - Card title says "Strokes Gained vs 12.5-handicap target" when set to 12.5.
  - Bars recompute against the new baseline when target changes.
  - One-time nudge appears once when `sampleHoles ≥ 18` and `targetHandicap` is null; dismissing it sets a flag so it doesn't reappear.

### Manual test plan

1. Fresh user, no target set. Confirm SG card identical to Phase B. No nudge until 18 SG-eligible holes logged.
2. After 18 holes, nudge appears once. Dismiss; confirm it never returns.
3. Tap pencil → set target to 14. Card title and bars update live.
4. Set target to 0 explicitly. Card returns to "vs scratch" framing.
5. Cross-device: change target on Web, confirm Android picks up the new value within ~1 second of focus.
6. Profile-screen entry: set target there, confirm SG card reflects it without app restart.
7. Edge case: a hole logged with old imperial bucket strings (if any test rounds exist). Confirm metric calculations skip it without crash.

### Coverage target

≥85% line coverage on new and modified store/lib files, matching the existing engine convention.

## Open questions

None at design time. Implementation may surface edge cases when:

- Verifying the published Broadie amateur values against the source (the approximate values in this spec are placeholders for the implementer to refine).
- Cross-device sync timing — Supabase's `realtime` channel for the profile row should propagate changes within a second, but the spec implementation may need to add an explicit refetch on app focus if that's not reliable.

## Phasing

This is a single coherent PR. No internal sub-phasing.

Future follow-ups (separate specs when prioritised):

1. **Per-handicap-band Stagner/DECADE tables.** Replaces the linear-blend lookup with discrete tables for each handicap band. Same `expectedStrokes(lie, distance, targetHandicap)` signature — no consumer changes.
2. **Synthetic peer baseline.** Once we have ≥500 logged `shotDetails` rounds, compute a baseline from our own users keyed by handicap band. Swap behind the same signature.
3. **"Gap to target" summary section.** A new Shots-tab sub-section showing the biggest and smallest per-category gaps to target ("Your putting is +0.28 ahead of target; your tee shots are −0.06 behind"). Actionable improvement framing.
4. **Phase B SG explainer revision.** The existing "We use Mark Broadie's published baselines… ±0.2 strokes per round" explainer mentions methodology — if you want a leaner version that omits the Broadie reference, that's a one-line edit in `statExplainers.js`.
