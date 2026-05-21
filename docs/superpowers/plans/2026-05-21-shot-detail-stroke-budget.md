# Shot Detail Stroke Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-hole shot detail add up — putts + penalties + sand shots can never exceed the hole's stroke total.

**Architecture:** Two pure helpers in `store/scoring.js` carry the rule. `ShotDetailPanel` uses one to cap counter "+" buttons at the remaining budget; `ScorecardScreen` uses the other to auto-trim a hole's shot detail whenever the me-player's strokes change. Fixing the data at the store layer keeps every downstream stats consumer consistent.

**Tech Stack:** React Native (Expo SDK 54), Jest + jest-expo, `@testing-library/react-native`.

---

## Background

- **Strokes** live in `scores[playerId][holeNumber]`, written by `setScore` / `stepScore` in `src/screens/ScorecardScreen.js`.
- **Shot detail** lives in `shotDetails[playerId][holeNumber]` — a `{ putts, drive, teePenalties, otherPenalties, sandShots, recoveryOutcome, firstPuttBucket, approachBucket }` object (`DEFAULT_SHOT` in `src/components/scorecard/constants.js`). Written by `setShot`, tracked only for the "me" player.
- The four counter fields (`putts`, `teePenalties`, `otherPenalties`, `sandShots`) each clamp `0–15` independently today, with no awareness of `strokes`.

**Invariant to enforce:** `putts + teePenalties + otherPenalties + sandShots <= strokes`.

**Trim order when strokes drops below the logged total:** `putts → sandShots → otherPenalties → teePenalties`. If `putts` is trimmed to `0`, also clear `firstPuttBucket`.

Full design: `docs/superpowers/specs/2026-05-21-shot-detail-stroke-budget-design.md`.

## File Structure

- `src/store/scoring.js` — Modify: add `shotDetailStrokeCount` and `reconcileShotDetail` pure helpers (after `recoveryOutcomeFromState`, ~line 327).
- `src/store/__tests__/scoring.test.js` — Modify: add `describe` blocks for the two helpers.
- `src/components/scorecard/ShotDetailPanel.js` — Modify: budget-aware "+" buttons + caption.
- `src/components/scorecard/styles.js` — Modify: add `shotBudgetCaption` style.
- `src/screens/__tests__/ScorecardScreen.test.js` — Modify: add `describe` block for the panel cap.
- `src/screens/ScorecardScreen.js` — Modify: import `reconcileShotDetail`, add `reconcileMeShot` callback, call it from `setScore` / `stepScore`.

---

## Task 1: `shotDetailStrokeCount` helper

Sums the four counter fields of a shot-detail object, treating `null`/missing as `0`.

**Files:**
- Modify: `src/store/scoring.js` (add helper after `recoveryOutcomeFromState`, ~line 327)
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing test**

In `src/store/__tests__/scoring.test.js`, add `shotDetailStrokeCount` to the existing import block from `'../scoring'`, then append this `describe` block at the end of the file:

```js
describe('shotDetailStrokeCount', () => {
  test('sums the four counter fields', () => {
    expect(shotDetailStrokeCount({
      putts: 2, teePenalties: 1, otherPenalties: 1, sandShots: 1,
    })).toBe(5);
  });

  test('treats null and missing fields as zero', () => {
    expect(shotDetailStrokeCount({ putts: null })).toBe(0);
    expect(shotDetailStrokeCount({})).toBe(0);
  });

  test('returns 0 for a missing detail', () => {
    expect(shotDetailStrokeCount(null)).toBe(0);
    expect(shotDetailStrokeCount(undefined)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoring.test.js -t shotDetailStrokeCount`
Expected: FAIL — `shotDetailStrokeCount is not defined` / `not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/store/scoring.js`, immediately after the `recoveryOutcomeFromState` function (before the `// ── Match Play tournament ──` divider, ~line 328), add:

```js
// Total strokes already accounted for by a hole's shot detail: every putt,
// penalty, and sand shot is itself one of the hole's strokes. Missing or
// null fields count as 0.
export function shotDetailStrokeCount(detail) {
  if (!detail) return 0;
  return (detail.putts ?? 0)
    + (detail.teePenalties ?? 0)
    + (detail.otherPenalties ?? 0)
    + (detail.sandShots ?? 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scoring.test.js -t shotDetailStrokeCount`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: add shotDetailStrokeCount helper"
```

---

## Task 2: `reconcileShotDetail` helper

Trims a shot-detail object so its counters fit within a stroke total, in the order putts → sand → other penalties → tee penalties. Idempotent; returns the input unchanged when it already fits or when `strokes` is `null`.

**Files:**
- Modify: `src/store/scoring.js` (add helper after `shotDetailStrokeCount`)
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing test**

In `src/store/__tests__/scoring.test.js`, add `reconcileShotDetail` to the existing import block from `'../scoring'`, then append this `describe` block at the end of the file:

```js
describe('reconcileShotDetail', () => {
  test('returns the input unchanged when the detail already fits', () => {
    const d = { putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 };
    expect(reconcileShotDetail(d, 4)).toBe(d);
  });

  test('returns the input unchanged when strokes is null', () => {
    const d = { putts: 9, teePenalties: 0, otherPenalties: 0, sandShots: 0 };
    expect(reconcileShotDetail(d, null)).toBe(d);
  });

  test('trims putts first', () => {
    const r = reconcileShotDetail(
      { putts: 5, teePenalties: 0, otherPenalties: 0, sandShots: 0 }, 3);
    expect(r.putts).toBe(3);
  });

  test('trims sand shots after putts are exhausted', () => {
    // count 5, strokes 2, over by 3: putts 1->0, sandShots 4->2
    const r = reconcileShotDetail(
      { putts: 1, teePenalties: 0, otherPenalties: 0, sandShots: 4 }, 2);
    expect(r.putts).toBe(0);
    expect(r.sandShots).toBe(2);
  });

  test('trims other penalties before tee penalties, both last', () => {
    // count 6, strokes 4, over by 2: otherPenalties 3->1, teePenalties untouched
    const r = reconcileShotDetail(
      { putts: 0, teePenalties: 3, otherPenalties: 3, sandShots: 0 }, 4);
    expect(r.otherPenalties).toBe(1);
    expect(r.teePenalties).toBe(3);
  });

  test('clears firstPuttBucket when putts is trimmed to 0', () => {
    const r = reconcileShotDetail(
      { putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0, firstPuttBucket: '1-2' }, 0);
    expect(r.putts).toBe(0);
    expect(r.firstPuttBucket).toBeNull();
  });

  test('leaves a null putts field as null', () => {
    const r = reconcileShotDetail(
      { putts: null, teePenalties: 5, otherPenalties: 0, sandShots: 0 }, 3);
    expect(r.putts).toBeNull();
    expect(r.teePenalties).toBe(3);
  });

  test('is idempotent', () => {
    const once = reconcileShotDetail(
      { putts: 5, teePenalties: 2, otherPenalties: 0, sandShots: 0 }, 4);
    const twice = reconcileShotDetail(once, 4);
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoring.test.js -t reconcileShotDetail`
Expected: FAIL — `reconcileShotDetail is not defined` / `not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/store/scoring.js`, immediately after the `shotDetailStrokeCount` function added in Task 1, add:

```js
// Trims a hole's shot detail so its counters never exceed `strokes`. Strokes
// is the master value. Trims in order putts -> sandShots -> otherPenalties ->
// teePenalties until the detail fits. Clears firstPuttBucket when putts is
// driven to 0 (its picker is hidden at 0 putts). Idempotent: returns the
// input object unchanged when it already fits or when strokes is null.
export function reconcileShotDetail(detail, strokes) {
  if (detail == null || strokes == null) return detail;
  if (shotDetailStrokeCount(detail) <= strokes) return detail;

  let over = shotDetailStrokeCount(detail) - strokes;
  const out = { ...detail };
  for (const field of ['putts', 'sandShots', 'otherPenalties', 'teePenalties']) {
    if (over <= 0) break;
    const cur = out[field] ?? 0;
    if (cur <= 0) continue;            // nothing to trim here — leave field as-is
    const cut = Math.min(cur, over);
    out[field] = cur - cut;
    over -= cut;
  }
  if (out.putts === 0) out.firstPuttBucket = null;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scoring.test.js -t reconcileShotDetail`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: add reconcileShotDetail helper"
```

---

## Task 3: Cap shot-detail counters in the panel

Disable each counter's "+" button once the four counters sum to `strokes`, and show a remaining-budget caption. No cap when `strokes` is `null`.

**Files:**
- Modify: `src/components/scorecard/ShotDetailPanel.js`
- Modify: `src/components/scorecard/styles.js`
- Test: `src/screens/__tests__/ScorecardScreen.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/screens/__tests__/ScorecardScreen.test.js`, append this `describe` block at the end of the file (the file already imports `React`, `render`, `fireEvent`, `ThemeProvider`, and `ShotDetailPanel`):

```js
describe('ShotDetailPanel — stroke budget', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par4 = { number: 1, par: 4, strokeIndex: 1 };

  test('under budget → "+" works and caption shows strokes left', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={onChange}
      />
    ));
    expect(getByText('2 strokes left to assign')).toBeTruthy();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).toHaveBeenCalledWith({ putts: 3 });
  });

  test('at budget → "+" blocked and caption shows all assigned', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, teePenalties: 1, otherPenalties: 0, sandShots: 1 }}
        onChange={onChange}
      />
    ));
    expect(getByText('All 4 strokes assigned')).toBeTruthy();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('strokes not entered → no caption and "+" works', () => {
    const onChange = jest.fn();
    const { queryByText, getByLabelText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={null}
        detail={{ putts: 2, teePenalties: 0, otherPenalties: 0, sandShots: 0 }}
        onChange={onChange}
      />
    ));
    expect(queryByText(/to assign/)).toBeNull();
    expect(queryByText(/assigned/)).toBeNull();
    fireEvent.press(getByLabelText('Increase Putts'));
    expect(onChange).toHaveBeenCalledWith({ putts: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ScorecardScreen.test.js -t "stroke budget"`
Expected: FAIL — the caption text is not found (`Unable to find an element with text: 2 strokes left to assign`), and the "at budget" test fails because `onChange` is still called.

- [ ] **Step 3: Add the caption style**

In `src/components/scorecard/styles.js`, immediately after the `shotPanelLabel` style block (it ends at the line `marginBottom: 4,` followed by `},`, ~line 684), add:

```js
    shotBudgetCaption: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 11,
      marginBottom: 8,
    },
```

- [ ] **Step 4: Make the "+" button budget-aware in `ShotCounterRow`**

In `src/components/scorecard/ShotDetailPanel.js`, replace the entire `ShotCounterRow` function (currently lines ~15-45) with:

```js
// One "label … − value +" counter row used for putts, penalties, sand shots.
// `canInc` is false once the hole's stroke budget is fully assigned.
function ShotCounterRow({ label, value, onStep, canInc = true, theme, s, explainer }) {
  const canDec = value != null && value > 0;
  return (
    <View style={s.shotRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.shotRowLabel}>{label}</Text>
        {explainer}
      </View>
      <View style={s.shotCounter}>
        <TouchableOpacity
          style={[s.shotCounterBtn, !canDec && s.shotCounterBtnDim]}
          onPress={() => onStep(-1)}
          disabled={!canDec}
          activeOpacity={0.7}
          accessibilityLabel={`Decrease ${label}`}
        >
          <Feather name="minus" size={18} color={canDec ? theme.text.primary : theme.text.muted} />
        </TouchableOpacity>
        <Text style={s.shotCounterValue}>{value == null ? '–' : value}</Text>
        <TouchableOpacity
          style={[s.shotCounterBtn, !canInc && s.shotCounterBtnDim]}
          onPress={() => onStep(1)}
          disabled={!canInc}
          activeOpacity={0.7}
          accessibilityLabel={`Increase ${label}`}
          accessibilityState={{ disabled: !canInc }}
        >
          <Feather name="plus" size={18} color={canInc ? theme.text.primary : theme.text.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Compute the budget and wire it into the panel**

In `src/components/scorecard/ShotDetailPanel.js`, update the import on line 7 from:

```js
import { isGIR, recoveryOutcomeFromState } from '../../store/scoring';
```

to:

```js
import { isGIR, recoveryOutcomeFromState, shotDetailStrokeCount } from '../../store/scoring';
```

Then, inside `ShotDetailPanel`, find the `step` function (currently lines ~101-104):

```js
  const step = (field, delta) => {
    const cur = d[field] ?? 0;
    onChange({ [field]: Math.max(0, Math.min(15, cur + delta)) });
  };
```

Replace it with the budget computation plus a guarded `step`:

```js
  // Stroke budget: every counter is one of the hole's strokes, so the four
  // counters together can never exceed `strokes`. No cap until strokes is set.
  const assigned = shotDetailStrokeCount(d);
  const budgetLeft = strokes == null ? Infinity : strokes - assigned;
  const atBudget = budgetLeft <= 0;
  const budgetCaption = strokes == null
    ? null
    : budgetLeft > 0
      ? `${budgetLeft} stroke${budgetLeft === 1 ? '' : 's'} left to assign`
      : `All ${strokes} stroke${strokes === 1 ? '' : 's'} assigned`;

  const step = (field, delta) => {
    if (delta > 0 && atBudget) return;
    const cur = d[field] ?? 0;
    onChange({ [field]: Math.max(0, Math.min(15, cur + delta)) });
  };
```

- [ ] **Step 6: Render the caption and pass `canInc` to the counter rows**

In `src/components/scorecard/ShotDetailPanel.js`, find the panel header line (~line 108):

```jsx
      <Text style={s.shotPanelLabel}>How many were:</Text>
```

Add the caption directly below it:

```jsx
      <Text style={s.shotPanelLabel}>How many were:</Text>
      {budgetCaption && <Text style={s.shotBudgetCaption}>{budgetCaption}</Text>}
```

Then add `canInc={!atBudget}` to all four `ShotCounterRow` elements (Putts, Tee penalties, Other penalties, Sand shots). For example, the Putts row becomes:

```jsx
      <ShotCounterRow
        label="Putts"
        value={d.putts}
        onStep={(delta) => step('putts', delta)}
        canInc={!atBudget}
        theme={theme}
        s={s}
      />
```

Apply the same `canInc={!atBudget}` prop to the `Tee penalties`, `Other penalties`, and `Sand shots` `ShotCounterRow` elements.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- ScorecardScreen.test.js -t "stroke budget"`
Expected: PASS — 3 tests.

- [ ] **Step 8: Run the existing panel tests to check for regressions**

Run: `npm test -- ScorecardScreen.test.js`
Expected: PASS — all tests (the 3 existing "outcome chips" tests plus the 3 new ones).

- [ ] **Step 9: Commit**

```bash
git add src/components/scorecard/ShotDetailPanel.js src/components/scorecard/styles.js src/screens/__tests__/ScorecardScreen.test.js
git commit -m "feat: cap shot-detail counters at the hole stroke total"
```

---

## Task 4: Auto-trim shot detail when the me-player's strokes change

When the me-player's strokes change, reconcile that hole's shot detail against the new total and persist any trim.

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

**Note on testing:** the trim logic is fully unit-covered by `reconcileShotDetail` (Task 2). This task is screen-level wiring; `ScorecardScreen` has no mount-test harness (the existing test file only renders `ShotDetailPanel` in isolation), so verification here is the full test suite (no regressions), lint, and a manual smoke test.

- [ ] **Step 1: Import `reconcileShotDetail`**

In `src/screens/ScorecardScreen.js`, immediately after the constants import block (currently ends at line 43 with `} from '../components/scorecard/constants';`), add:

```js
import { reconcileShotDetail } from '../store/scoring';
```

- [ ] **Step 2: Add the `reconcileMeShot` callback**

In `src/screens/ScorecardScreen.js`, immediately after the `setShot` `useCallback` (it ends at `}, [saveShot]);`, ~line 468), add:

```js
  // When the me-player's strokes change, trim that hole's shot detail so the
  // logged putts/penalties/sand shots never exceed the new stroke total.
  // No-op for other players, holes with no detail, or already-valid detail.
  const reconcileMeShot = useCallback((playerId, holeNumber, newStrokes) => {
    if (playerId !== (tournamentRef.current?.meId ?? null)) return;
    setShotDetails((prev) => {
      const current = prev[playerId]?.[holeNumber];
      if (!current) return prev;
      const reconciled = reconcileShotDetail(current, newStrokes);
      if (reconciled === current) return prev;
      const next = {
        ...prev,
        [playerId]: { ...prev[playerId], [holeNumber]: reconciled },
      };
      saveShot(playerId, holeNumber, reconciled);
      return next;
    });
  }, [saveShot]);
```

- [ ] **Step 3: Call `reconcileMeShot` from `setScore`**

In `src/screens/ScorecardScreen.js`, in the `setScore` `useCallback`, find the line `setScores(next);` followed by its `// pre-computed value` comment (~line 741). Immediately after that line, add:

```js
    reconcileMeShot(playerId, holeNumber, parsed);
```

Then add `reconcileMeShot` to the `setScore` dependency array. Change:

```js
  }, [round, autoSave, triggerCelebration, official, officialWrite]);
```

to:

```js
  }, [round, autoSave, triggerCelebration, official, officialWrite, reconcileMeShot]);
```

- [ ] **Step 4: Call `reconcileMeShot` from `stepScore`**

In `src/screens/ScorecardScreen.js`, in the `stepScore` `useCallback`, find the `setScores(next);` line followed by its `// pre-computed value` comment (~line 773). Immediately after that line, add:

```js
    reconcileMeShot(playerId, holeNumber, newStrokes);
```

Then add `reconcileMeShot` to the `stepScore` dependency array. Change:

```js
  }, [round, autoSave, triggerCelebration, getScoreAnim, official, officialWrite]);
```

to:

```js
  }, [round, autoSave, triggerCelebration, getScoreAnim, official, officialWrite, reconcileMeShot]);
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests, no regressions.

- [ ] **Step 6: Run the linter**

Run: `npm run lint`
Expected: no new errors or warnings in `ScorecardScreen.js` (in particular, no `react-hooks/exhaustive-deps` warning for `setScore` / `stepScore`).

- [ ] **Step 7: Manual smoke test**

Run: `npm run web`. Then:
1. Open a game, go to a round scorecard, and pick yourself as the "me" player if prompted.
2. On one hole, set strokes to `5` with the +/- stepper.
3. Expand **Shot detail** and log `3` putts and `1` sand shot — the caption should read *"1 stroke left to assign"* and every "+" should still work.
4. Add one more putt — caption becomes *"All 5 strokes assigned"* and all "+" buttons dim/disable.
5. Step strokes down to `3`.
6. Confirm Shot detail auto-trimmed: putts dropped to `2` (sand shot stays `1`), totalling `3`; caption now reads *"All 3 strokes assigned"*.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: auto-trim shot detail when strokes drops"
```

---

## Self-Review Notes

- **Spec coverage:** invariant (Tasks 1-2), entry-time cap + caption + `strokes == null` no-cap (Task 3), auto-trim with order + `firstPuttBucket` clear (Tasks 2 & 4), data-layer approach (helpers in `store/scoring.js`), tests (Tasks 1-3 unit/component; Task 4 suite + manual). All spec sections map to a task.
- **Out of scope (per spec):** no `putts <= strokes - 1` rule; `recoveryOutcome` left untouched.
- **Official mode:** `reconcileMeShot` is a safe no-op when a hole has no shot detail (`if (!current) return prev`), so it does not need official-mode-specific handling.
- **Type consistency:** `shotDetailStrokeCount(detail)` and `reconcileShotDetail(detail, strokes)` signatures are used identically in `ShotDetailPanel.js` and `ScorecardScreen.js`. `reconcileShotDetail` returns the same object reference when no trim is needed, which `reconcileMeShot` relies on via `reconciled === current`.
