# Shot Detail Stroke Budget — Design

**Date:** 2026-05-21
**Status:** Approved

## Problem

The per-hole **Shot detail** panel (`ShotDetailPanel.js`, shown on the "me"
player card) lets you log counters — **Putts**, **Tee penalties**, **Other
penalties**, **Sand shots** — each clamped only to `0–15`. Nothing ties them to
the hole's **strokes** total. You can currently log 6 putts on a 4-stroke hole.
Every one of those counters *is* one of the hole's strokes, so the detail must
add up: the stroke total is the master value and the detail must fit inside it.

## Invariant

For every hole:

```
putts + teePenalties + otherPenalties + sandShots <= strokes
```

`strokes` is the master. The shot detail is reconciled against it, never the
other way around.

## Behavior

### Entry-time cap

In the Shot detail panel:

- When the four counters already sum to `strokes`, every "+" button is
  disabled and dimmed — the same visual treatment as an already-disabled "−".
- "−" buttons always stay enabled.
- A caption shows the remaining budget, e.g. *"1 stroke left to assign"* or
  *"All 4 strokes assigned"*.
- When `strokes` is `null` (not yet entered), no cap applies — counters behave
  as they do today. The auto-trim corrects any overflow once a total is set.

### Auto-trim on strokes decrease

When the me-player's strokes changes and the logged detail now exceeds the new
total, trim counters until the detail fits, in this order:

1. `putts`
2. `sandShots`
3. `otherPenalties`
4. `teePenalties`

Additional cleanup:

- If `putts` is trimmed to `0`, also clear `firstPuttBucket`. The first-putt
  picker is hidden when putts is 0, so a leftover bucket value would be
  invisible-but-wrong.
- `recoveryOutcome` is left untouched. It is display-gated (only shown on a
  missed GIR) and mostly derived via `recoveryOutcomeFromState`, so it needs no
  trimming.

Increasing strokes only widens the budget and never triggers a trim. The trim
is idempotent — running it on an already-valid detail returns it unchanged.

## Approach

**Data-layer reconciliation.** The fix lives in the store so that *stored* data
is always consistent — downstream consumers (`statsEngine`, `roundReportCard`,
`personalStats`) never read an over-budget hole. A render-time clamp was
rejected because it would hide the bad data instead of fixing it.

## Implementation

### Pure helpers — `src/store/scoring.js`

- `shotDetailStrokeCount(detail)` → sum of `putts + teePenalties +
  otherPenalties + sandShots`, treating missing/`null` fields as `0`.
- `reconcileShotDetail(detail, strokes)` → returns a detail object trimmed to
  satisfy the invariant. Idempotent. Returns the input unchanged when the
  detail already fits or when `strokes == null`. Clears `firstPuttBucket` when
  the trim drives `putts` to `0`.

### Panel — `src/components/scorecard/ShotDetailPanel.js`

- Compute `budgetLeft` from `strokes` and `shotDetailStrokeCount`. When
  `strokes == null`, treat the budget as unbounded.
- Disable each counter's "+" button and guard the `step()` increment when
  `budgetLeft <= 0`.
- Render the remaining-budget caption.

### Screen — `src/screens/ScorecardScreen.js`

- In `setScore` and `stepScore`, after computing the new strokes value: when
  `playerId` is the me-player, run `reconcileShotDetail` against the new total
  and, if it produced a change, persist the trimmed detail through the existing
  `setShot` / `saveShot` path.

## Testing

- Unit tests in `src/store/__tests__/scoring.test.js`:
  - `shotDetailStrokeCount` — sums, null/missing fields.
  - `reconcileShotDetail` — already-valid pass-through, `strokes == null`
    pass-through, trim order (putts → sand → other → tee), `firstPuttBucket`
    cleared on putts→0, idempotence.
- `src/screens/__tests__/ScorecardScreen.test.js` — panel "+" disabled at the
  budget; lowering strokes trims the detail.

## Out of Scope

- No stricter rule reserving a stroke for the tee/approach shot
  (`putts <= strokes - 1`); the invariant allows `putts == strokes`.
- No change to categorical fields (`drive`, `approachBucket`,
  `recoveryOutcome`) beyond the `firstPuttBucket` cleanup above.
