# Handicap Tab v2 — Evolution Chart, Round Exclusions, Eligibility Transparency

**Date:** 2026-07-16
**Status:** Approved (pending spec review)
**Builds on:** `2026-07-15-handicap-calculator-design.md` (shipped @ 0a51976)

Three additions to the Handicap tab:

1. An **index evolution chart** — how the calculated Handicap Index developed
   over the user's full round history.
2. **Include/exclude toggles** — remove individual rounds from the calculation
   (and add them back), persisted per user.
3. **Eligibility transparency** — ineligible rounds appear in the list with
   the reason they don't count, so "Best 3 of last 10" with 18 rounds played
   is self-explanatory. (Motivated by a real user question: 18 rounds played,
   only 10 qualified, and the UI gave no clue why.)

---

## 1. Store changes (`src/store/handicapIndex.js`, stays pure)

### Shared helper (refactor)

Extract the windowing + WHS-table math from `computeHandicapIndex` into an
internal `indexFromDifferentials(diffs)` → `{ index, usedCount, windowCount,
countingKeys }` operating on an already-filtered chronological differential
list. Both public functions below use it; the WHS table exists once.

### `roundDifferential(myRound)` — add ineligibility reasons

New companion export `roundEligibility(myRound)` → `{ eligible: true } |
{ eligible: false, reason: 'partial' | 'nine-holes' | 'no-rating' }`:
- `'partial'` — not every hole scored (`!isComplete`); UI shows
  "partial · N holes" (holesPlayed is already on MyRound).
- `'nine-holes'` — complete but the round has ≠18 holes.
- `'no-rating'` — no numeric slope > 0 or no numeric course rating from
  `resolveRoundTee`.
(Scramble rounds never reach here — `collectMyRounds` drops them, so they
are not listed; the explainer keeps covering that case.)
`roundDifferential` itself is unchanged in behavior; it may reuse
`roundEligibility` internally.

### `computeHandicapIndex(myRounds, { excludedKeys } = {})`

- `excludedKeys`: a `Set` of MyRound keys (or undefined). Excluded rounds are
  removed from the eligible list **before** the last-20 windowing — excluding
  a recent round pulls the next older eligible round into the window, as if
  the excluded round were never played.
- Result object gains:
  - `excluded`: differentials of excluded eligible rounds (chronological,
    each `{ key, differential, ags, courseName, date }`) — the UI renders
    these for re-inclusion. Rounds that are both excluded and ineligible are
    NOT in this list (they're in `ineligible`).
  - `ineligible`: `[{ key, courseName, date, reason, holesPlayed }]` for
    every non-qualifying round (chronological) — feeds the transparency rows.
  - `excludedCount` (= `excluded.length`).
- Everything else (shape, table, caps, <3 → null) unchanged. Backward
  compatible: calling with one argument behaves exactly as today except for
  the added result fields.

### `handicapIndexSeries(myRounds, { excludedKeys } = {})`

Evolution series over the **full history**: walk the eligible, included
differentials chronologically; after each one compute
`indexFromDifferentials(prefix)` (which internally windows to the last 20 of
that prefix). Points exist only from the 3rd qualifying round onward (WHS
minimum), so the series contains no leading nulls.

Returns `[{ key, label, value, courseName, date }]` where `label` is a short
date ("12 May") and `value` is the index to 1 decimal — directly consumable
by `TrendLineChart` (`series: [{ label, value }]`).

Cost: O(n × 20 log 20) for n eligible rounds — trivial.

---

## 2. Persistence (exclusions)

- AsyncStorage key `@handicap_round_exclusions:<userId>`, storing a JSON
  array of round keys. Same signed-out scheme as the selection fix:
  `:local` fallback key, migrated into the user key on first signed-in load
  when the user key is empty (copy, then remove local).
- No pruning of stale keys (same rationale as the selection-override fix:
  stale keys are inert and bounded; pruning risks data loss on partial
  loads).
- **Owner:** `MyStatsScreen` — mirrors how it owns the round-selection
  overrides. It loads the array into a `Set`, passes `excludedKeys` and an
  `onToggleExcluded(key)` callback to `HandicapTab`, and persists on every
  toggle (write-through, same as `persistOverrides`).

---

## 3. UI (`HandicapTab`)

Card order: **Hero → Index evolution → Score differentials**.

### Index evolution card

- `SectionCard` titled "Index evolution", `infoKey="handicapIndex"`.
- `TrendLineChart` (default `full` variant) with the series from
  `handicapIndexSeries`, `formatValue` = 1 decimal, caption
  "After each qualifying round · oldest → newest".
- Rendered only when the series has ≥ 2 points (a 1-point line is
  meaningless; below that the hero/empty state already communicates status).
- Reflects exclusions: the chart is the history of the *current* calculation.

### Differentials list — three row states

1. **Included** (current styling, counting rounds highlighted): gains a
   small icon button (Feather `minus-circle`) on the right,
   `accessibilityLabel` "Exclude round from handicap". Tapping calls
   `onToggleExcluded(key)`.
2. **Excluded**: greyed (muted text), tag "Excluded", icon button (Feather
   `plus-circle`), `accessibilityLabel` "Include round in handicap".
   Rendered even when the index is null (below 3 remaining) so recovery is
   always possible.
3. **Ineligible** (new transparency rows): greyed, no toggle, tag with the
   reason — "partial · N holes", "9-hole round" (any non-18 count), or
   "no slope/rating". These rounds can never be toggled in; the row exists
   to explain the counts.

List content: the last-20 included window + all excluded rounds + all
ineligible rounds, merged and sorted chronologically (newest first, as
today). Caption updated to "Newest first · lowest N count · grey rounds
don't qualify".

### Hero subtitle

"Best X of last Y differentials" gains "· Z excluded" when Z > 0.

### Explainer (`statExplainers.handicapIndex`)

Append two short paragraphs: (a) rounds you exclude are treated as never
played — the official WHS index always counts every qualifying round, so an
edited calculation is a personal estimate; (b) why rounds don't qualify
(partial / non-18-hole / missing slope-rating / scramble) and that grey rows
show the reason.

---

## 4. Testing

Unit (`handicapIndex.test.js`):
- Exclusion before windowing: 21 eligible rounds, exclude one inside the
  window → the 21st (oldest) re-enters; index matches hand-computed value.
- `excluded` and `ineligible` result lists populated correctly; excluded
  ineligible round appears only in `ineligible`.
- `roundEligibility` reasons: partial, nine-holes, no-rating.
- Series: 5 eligible rounds → 3 points (from 3rd round), values match
  hand-computed prefix indexes (including the −2/−1 small-sample
  adjustments); exclusions shift the series; < 3 eligible → empty array.

Component (`HandicapTab.test.js`):
- Exclude toggle calls `onToggleExcluded` with the round key; excluded row
  renders with tag + include button.
- Ineligible round renders reason text, no toggle.
- Evolution card renders with ≥2 points and is absent below that.
- Empty state with exclusions still lists the excluded rows.

Screen (`MyStatsScreen.test.js`):
- Toggling exclusion persists to `@handicap_round_exclusions:<uid>`;
  reload restores it (mirrors the selection-persistence tests).

---

## Non-goals

- Exclusions do not affect any other stats tab or the "rounds counted"
  selector.
- No syncing of exclusions across devices (AsyncStorage only, like the
  round selection).
- No soft/hard caps, PCC, or 9-hole differentials (unchanged from v1).
