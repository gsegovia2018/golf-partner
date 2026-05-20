# Strokes Gained + Cheap New Stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture new per-hole shot details and surface lag putting, sand saves, up-and-down rates, bunker visits, and the four Strokes Gained categories on `MyStatsScreen`.

**Architecture:** New fields slot into the existing `round.shotDetails[playerId][holeNumber]` JSON blob — no Postgres migration. Pure engine functions in `src/store/scoring.js` and `src/store/statsEngine.js` follow the existing `null`-on-missing, sample-gated convention. A new `src/store/strokesGainedBaseline.js` bundles the Mark Broadie scratch baselines with a binary-search lookup. UI changes are confined to `ScorecardScreen.js` (capture) and `MyStatsScreen.js` (display).

**Tech Stack:** React Native (Expo SDK 54) · React 19 · `react-native-svg` for charts · `@react-native-async-storage/async-storage` for explainer dismissal · Jest (`jest-expo`) for tests.

**Spec:** [`docs/superpowers/specs/2026-05-20-strokes-gained-and-cheap-stats-design.md`](../specs/2026-05-20-strokes-gained-and-cheap-stats-design.md)

---

## Phase A — Cheap stats (no baselines)

### Task 1: Extend DEFAULT_SHOT with new optional fields

**Files:**
- Modify: `src/screens/ScorecardScreen.js:83` (`DEFAULT_SHOT` constant)

- [ ] **Step 1: Update DEFAULT_SHOT**

Replace the line at `src/screens/ScorecardScreen.js:83`:

```js
const DEFAULT_SHOT = {
  putts: null,
  drive: null,
  teePenalties: 0,
  otherPenalties: 0,
  sandShots: 0,
  recoveryOutcome: null,        // 'up-and-down' | 'sand-save' | 'none' | null
  firstPuttBucket: null,        // '0-3' | '3-6' | '6-10' | '10-20' | '20+' | null
  approachBucket: null,         // '0-50' | '50-100' | '100-150' | '150-200' | '200+' | null
};
```

- [ ] **Step 2: Run the existing scorecard tests**

Run: `npm test -- --testPathPattern=ScorecardScreen`
Expected: PASS — schema additions are backward-compatible.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): extend DEFAULT_SHOT with sandShots, buckets, recoveryOutcome"
```

---

### Task 2: Add `recoveryOutcomeFromState` and `isGIR` to scoring.js

**Files:**
- Modify: `src/store/scoring.js`
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/scoring.test.js`:

```js
import { recoveryOutcomeFromState, isGIR } from '../scoring';

describe('isGIR', () => {
  test('GIR hit when strokes - putts <= par - 2', () => {
    expect(isGIR({ strokes: 4, putts: 2, par: 4 })).toBe(true);   // 4-2=2 <= 4-2
    expect(isGIR({ strokes: 3, putts: 1, par: 4 })).toBe(true);   // 3-1=2 <= 2
  });
  test('GIR missed when strokes - putts > par - 2', () => {
    expect(isGIR({ strokes: 5, putts: 2, par: 4 })).toBe(false);  // 5-2=3 > 2
    expect(isGIR({ strokes: 6, putts: 3, par: 4 })).toBe(false);
  });
  test('returns null when putts missing', () => {
    expect(isGIR({ strokes: 4, putts: null, par: 4 })).toBeNull();
  });
});

describe('recoveryOutcomeFromState', () => {
  test('GIR hit → null (no recovery)', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 2, sandShots: 0, par: 4,
    })).toBeNull();
  });
  test('missed GIR, 1 putt, no sand → up-and-down', () => {
    expect(recoveryOutcomeFromState({
      strokes: 5, putts: 1, sandShots: 0, par: 4,
    })).toBe('up-and-down');
  });
  test('missed GIR, 1 putt, sand shot → sand-save', () => {
    expect(recoveryOutcomeFromState({
      strokes: 5, putts: 1, sandShots: 1, par: 4,
    })).toBe('sand-save');
  });
  test('missed GIR, 2 putts → null (heuristic abstains)', () => {
    expect(recoveryOutcomeFromState({
      strokes: 6, putts: 2, sandShots: 0, par: 4,
    })).toBeNull();
  });
  test('chip-in (0 putts) missed GIR → null (heuristic abstains, user can tap up-and-down)', () => {
    expect(recoveryOutcomeFromState({
      strokes: 4, putts: 0, sandShots: 0, par: 4,
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=scoring.test.js`
Expected: FAIL — `recoveryOutcomeFromState is not a function`, `isGIR is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/store/scoring.js`:

```js
// Green-in-Regulation: reached the green with at least two strokes left
// for putting (strokes − putts ≤ par − 2). Returns null when putts is unknown.
export function isGIR({ strokes, putts, par }) {
  if (strokes == null || putts == null || par == null) return null;
  return (strokes - putts) <= (par - 2);
}

// Auto-derives the recoveryOutcome chip value from the rest of the hole's
// state. Returns null when the situation doesn't fit a clear outcome — the
// UI keeps the chips tappable so the user can override manually.
export function recoveryOutcomeFromState({ strokes, putts, sandShots = 0, par }) {
  const gir = isGIR({ strokes, putts, par });
  if (gir !== false) return null;        // GIR hit OR unknown → no recovery
  if (putts !== 1) return null;          // only 1-putt up-and-downs are unambiguous
  return sandShots >= 1 ? 'sand-save' : 'up-and-down';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=scoring.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat(scoring): add isGIR and recoveryOutcomeFromState helpers"
```

---

### Task 3: Add "Sand shots" counter row to capture panel

**Files:**
- Modify: `src/screens/ScorecardScreen.js` (inside `ShotDetailPanel`, after the "Other penalties" row around line 1740)

- [ ] **Step 1: Add the row**

Inside `ShotDetailPanel`'s JSX, immediately after the "Other penalties" `ShotCounterRow` block, add:

```js
<ShotCounterRow
  label="Sand shots"
  value={d.sandShots}
  onStep={(delta) => step('sandShots', delta)}
  theme={theme}
  s={s}
/>
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run web`
- Open any in-progress round, expand the shot panel for a hole, tap the new "Sand shots" stepper. Confirm value persists across hole navigation.

- [ ] **Step 3: Run existing tests**

Run: `npm test -- --testPathPattern=ScorecardScreen`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): add sand shots counter row to shot detail panel"
```

---

### Task 4: Add "First putt" bucket row

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Add bucket constants**

Near `DRIVE_ORDER` (around line 113), add:

```js
const FIRST_PUTT_BUCKETS = ['0-3', '3-6', '6-10', '10-20', '20+'];
const FIRST_PUTT_LABELS = {
  '0-3': "0-3'", '3-6': "3-6'", '6-10': "6-10'",
  '10-20': "10-20'", '20+': "20+'",
};

const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
const APPROACH_LABELS = {
  '0-50': '0-50y', '50-100': '50-100y', '100-150': '100-150y',
  '150-200': '150-200y', '200+': '200+y',
};
```

- [ ] **Step 2: Add a generic `BucketRow` component**

Above the existing `ShotDetailPanel` definition (around line 1710), add:

```js
function BucketRow({ label, value, buckets, labels, onSelect, theme, s }) {
  return (
    <View style={[s.shotRow, s.shotRowLast]}>
      <Text style={s.shotRowLabel}>{label}</Text>
      <View style={s.driveBtns}>
        {buckets.map((key) => {
          const active = value === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.driveCircle, active && s.driveCircleActive, s.bucketCircle]}
              onPress={() => onSelect(active ? null : key)}
              activeOpacity={0.7}
              accessibilityLabel={`${label} ${labels[key]}`}
            >
              <Text
                style={{
                  color: active ? theme.text.inverse : theme.text.secondary,
                  fontSize: 11,
                  fontWeight: '600',
                }}
              >
                {labels[key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Add the first-putt row to `ShotDetailPanel`**

Inside `ShotDetailPanel`, after the existing driver row block (before the closing `</View>`), add:

```js
{(d.putts ?? 0) >= 1 && (
  <BucketRow
    label="First putt"
    value={d.firstPuttBucket}
    buckets={FIRST_PUTT_BUCKETS}
    labels={FIRST_PUTT_LABELS}
    onSelect={(key) => onChange({ firstPuttBucket: key })}
    theme={theme}
    s={s}
  />
)}
```

- [ ] **Step 4: Add `bucketCircle` style**

In the `makeStyles` function (existing in this file — search for `driveCircle:`), add inside the styles object:

```js
bucketCircle: { width: 56, height: 32, borderRadius: 16, paddingHorizontal: 4 },
```

- [ ] **Step 5: Manual smoke test**

Run: `npm run web` and verify the First putt row appears only when putts ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): add first-putt distance bucket row"
```

---

### Task 5: Add "Approach from" bucket row

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Add the approach row**

Inside `ShotDetailPanel`, immediately above the first-putt row from Task 4 (so approach renders first), add:

```js
{!isPar3 && (
  <BucketRow
    label="Approach from"
    value={d.approachBucket}
    buckets={APPROACH_BUCKETS}
    labels={APPROACH_LABELS}
    onSelect={(key) => onChange({ approachBucket: key })}
    theme={theme}
    s={s}
  />
)}
```

(`isPar3` is already in scope inside `ShotDetailPanel` — `const isPar3 = hole.par === 3;` around line 1714.)

- [ ] **Step 2: Manual smoke test**

Run: `npm run web` and verify:
- The Approach row is hidden on par-3 holes.
- The Approach row appears on par-4 / par-5.
- Selecting a bucket persists; tapping the active bucket clears.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): add approach distance bucket row (par-4/5 only)"
```

---

### Task 6: Add outcome chips with auto-selection

**Files:**
- Modify: `src/screens/ScorecardScreen.js`
- Test: `src/screens/__tests__/ScorecardScreen.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/screens/__tests__/ScorecardScreen.test.js` (create the file if absent):

```js
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import { ShotDetailPanel } from '../ScorecardScreen';

describe('ShotDetailPanel — outcome chips', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const par4 = { number: 1, par: 4, strokeIndex: 1 };

  test('GIR hit → outcome chips hidden', () => {
    const { queryByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={4}
        detail={{ putts: 2, sandShots: 0, recoveryOutcome: null }}
        onChange={() => {}}
      />
    ));
    expect(queryByText('Up & Down')).toBeNull();
    expect(queryByText('Sand Save')).toBeNull();
  });

  test('Missed GIR + 1 putt + no sand → Up & Down auto-selected', () => {
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={5}
        detail={{ putts: 1, sandShots: 0, recoveryOutcome: null }}
        onChange={() => {}}
      />
    ));
    const chip = getByText('Up & Down').parent;
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });

  test('Tapping an auto-selected chip writes recoveryOutcome="none"', () => {
    const onChange = jest.fn();
    const { getByText } = render(wrap(
      <ShotDetailPanel
        hole={par4}
        strokes={5}
        detail={{ putts: 1, sandShots: 1, recoveryOutcome: null }}
        onChange={onChange}
      />
    ));
    fireEvent.press(getByText('Sand Save'));
    expect(onChange).toHaveBeenCalledWith({ recoveryOutcome: 'none' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=ScorecardScreen`
Expected: FAIL — `ShotDetailPanel is not exported` or chips don't render.

- [ ] **Step 3: Export `ShotDetailPanel` and accept `strokes`**

In `src/screens/ScorecardScreen.js`:
1. Change `function ShotDetailPanel({…})` to `export function ShotDetailPanel({…})`.
2. Add `strokes` to the destructured props alongside `hole, detail, onChange, theme, s`.
3. At the top of the function body, alongside `const isPar3 = …`, add:

```js
const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
const missedGIR = gir === false;
const autoOutcome = recoveryOutcomeFromState({
  strokes,
  putts: d.putts,
  sandShots: d.sandShots ?? 0,
  par: hole.par,
});
const effectiveOutcome = d.recoveryOutcome ?? autoOutcome;
```

Add the import at the top of the file:

```js
import { isGIR, recoveryOutcomeFromState } from '../store/scoring';
```

- [ ] **Step 4: Add the chips row**

Inside `ShotDetailPanel`, after the first-putt row block, add:

```js
{missedGIR && (
  <View style={[s.shotRow, s.shotRowLast]}>
    <Text style={s.shotRowLabel}>Outcome</Text>
    <View style={s.driveBtns}>
      <TouchableOpacity
        accessibilityState={{ selected: effectiveOutcome === 'up-and-down' }}
        style={[s.outcomeChip, effectiveOutcome === 'up-and-down' && s.outcomeChipActive]}
        onPress={() => onChange({
          recoveryOutcome:
            effectiveOutcome === 'up-and-down' ? 'none' : 'up-and-down',
        })}
        activeOpacity={0.7}
      >
        <Text style={[
          s.outcomeChipLabel,
          effectiveOutcome === 'up-and-down' && { color: theme.text.inverse },
        ]}>Up & Down</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityState={{ selected: effectiveOutcome === 'sand-save' }}
        style={[s.outcomeChip, effectiveOutcome === 'sand-save' && s.outcomeChipActive]}
        onPress={() => onChange({
          recoveryOutcome:
            effectiveOutcome === 'sand-save' ? 'none' : 'sand-save',
        })}
        activeOpacity={0.7}
      >
        <Text style={[
          s.outcomeChipLabel,
          effectiveOutcome === 'sand-save' && { color: theme.text.inverse },
        ]}>Sand Save</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
```

- [ ] **Step 5: Add styles**

In `makeStyles`, add inside the styles object:

```js
outcomeChip: {
  paddingHorizontal: 12, paddingVertical: 6,
  borderRadius: 16, marginRight: 8,
  borderWidth: 1, borderColor: theme.divider,
},
outcomeChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
outcomeChipLabel: { fontSize: 13, fontWeight: '600', color: theme.text.secondary },
```

- [ ] **Step 6: Pipe `strokes` into the panel call site**

Search `ScorecardScreen.js` for `<ShotDetailPanel`. At each render site, pass:

```js
strokes={scores?.[meId]?.[hole.number]}
```

- [ ] **Step 7: Run tests**

Run: `npm test -- --testPathPattern=ScorecardScreen`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ScorecardScreen.js src/screens/__tests__/ScorecardScreen.test.js
git commit -m "feat(scorecard): outcome chips with auto-suggested up-and-down/sand-save"
```

---

### Task 7: One-shot explainer infrastructure

**Files:**
- Create: `src/components/ShotDetailExplainer.js`
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Create the explainer component**

```js
// src/components/ShotDetailExplainer.js
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View, Text, Modal, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';

const STORAGE_PREFIX = 'shotDetailExplainer:';

export function ShotDetailExplainer({ rowKey, title, body }) {
  const { theme } = useTheme();
  const [dismissed, setDismissed] = useState(true);    // start "dismissed" until we know
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_PREFIX + rowKey).then((v) => {
      if (cancelled) return;
      setDismissed(v === '1');
    });
    return () => { cancelled = true; };
  }, [rowKey]);

  const dismiss = async () => {
    await AsyncStorage.setItem(STORAGE_PREFIX + rowKey, '1');
    setDismissed(true);
    setOpen(false);
  };

  const iconColor = dismissed ? theme.text.muted : theme.accent;
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} hitSlop={8}>
        <Feather name="help-circle" size={14} color={iconColor} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={dismiss}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}
          onPress={dismiss}
        >
          <View style={{ backgroundColor: theme.bg.card, borderRadius: 12, padding: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text.primary, marginBottom: 8 }}>
              {title}
            </Text>
            <Text style={{ fontSize: 14, color: theme.text.secondary, lineHeight: 20 }}>
              {body}
            </Text>
            <TouchableOpacity onPress={dismiss} style={{ marginTop: 16, alignSelf: 'flex-end' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.accent }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Wire explainers into the new rows**

In `src/screens/ScorecardScreen.js`, change `ShotCounterRow` and `BucketRow` to accept an optional `explainer` prop and render it next to the label:

```js
// In ShotCounterRow / BucketRow signatures, add: explainer
// Replace <Text style={s.shotRowLabel}>{label}</Text> with:
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
  <Text style={s.shotRowLabel}>{label}</Text>
  {explainer}
</View>
```

Import the explainer at the top of `ScorecardScreen.js`:

```js
import { ShotDetailExplainer } from '../components/ShotDetailExplainer';
```

Pass an explainer to each new row. Use these `rowKey` / title / body pairs:

| `rowKey` | Title | Body |
|---|---|---|
| `sandShots` | Sand shots | Total bunker shots you played on this hole — even from a fairway bunker. Used for sand saves and bunker visits per round. |
| `firstPuttBucket` | First putt distance | How far away your first putt was. Lets us measure how well you lag long putts and how well you convert short ones. |
| `approachBucket` | Approach distance | How far you played your approach into the green from. Drives Strokes Gained Approach. |
| `outcome` | Up & Down / Sand Save | A successful "up and down" means you missed the green in regulation but still saved par or better. A "sand save" is the same but from a bunker. |

Example for the sand-shots row:

```js
<ShotCounterRow
  label="Sand shots"
  value={d.sandShots}
  onStep={(delta) => step('sandShots', delta)}
  theme={theme}
  s={s}
  explainer={
    <ShotDetailExplainer
      rowKey="sandShots"
      title="Sand shots"
      body="Total bunker shots you played on this hole — even from a fairway bunker. Used for sand saves and bunker visits per round."
    />
  }
/>
```

For the "Outcome" row, embed the `<ShotDetailExplainer rowKey="outcome" …/>` next to the `<Text style={s.shotRowLabel}>Outcome</Text>` inline.

- [ ] **Step 3: Manual smoke test**

Run: `npm run web` — open a hole, verify each row's (?) icon opens the explainer. Tap "Got it"; reopen the panel and verify the (?) icon stays but its color dims to muted.

- [ ] **Step 4: Commit**

```bash
git add src/components/ShotDetailExplainer.js src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): one-shot (?) explainers for new shot-detail rows"
```

---

### Task 8: Add `lagPuttingQuality` to statsEngine.js

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/statsEngine.test.js`:

```js
import { lagPuttingQuality } from '../statsEngine';

const makeRound = (holes, details, playerId = 'me') => ({
  holes: holes.map((h, i) => ({ number: i + 1, par: h.par, strokeIndex: i + 1 })),
  scores: { [playerId]: Object.fromEntries(holes.map((h, i) => [i + 1, h.strokes])) },
  shotDetails: { [playerId]: Object.fromEntries(details.map((d, i) => [i + 1, d])) },
});

describe('lagPuttingQuality', () => {
  test('returns null per bucket below 12-putt threshold', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '6-10' }],
    );
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['6-10']).toBeNull();
  });

  test('aggregates putts per bucket above threshold', () => {
    const holes = Array.from({ length: 12 }, () => ({ par: 4, strokes: 4 }));
    const details = Array.from({ length: 12 }, () => ({ putts: 2, firstPuttBucket: '6-10' }));
    const round = makeRound(holes, details);
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['6-10']).toBeCloseTo(2.0);
    expect(result.sample.perBucket['6-10']).toBe(12);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t lagPuttingQuality`
Expected: FAIL — `lagPuttingQuality is not a function`.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
// ── Lag putting quality (Phase A) ──
// Aggregates avg putts and 3-putt rate keyed by first-putt distance bucket.
// Below 12 putts per bucket the result for that bucket is null.
const FIRST_PUTT_BUCKETS_LIST = ['0-3', '3-6', '6-10', '10-20', '20+'];
const PUTT_BUCKET_MIN = 12;

export function lagPuttingQuality(rounds, playerId) {
  const perBucket = Object.fromEntries(FIRST_PUTT_BUCKETS_LIST.map((b) => [b, []]));
  rounds.forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    (round.holes ?? []).forEach((hole) => {
      const d = byHole[hole.number];
      if (!d || d.putts == null || !d.firstPuttBucket) return;
      perBucket[d.firstPuttBucket]?.push(d.putts);
    });
  });
  const avgPuttsByBucket = {};
  const threePuttRateByBucket = {};
  const sample = { perBucket: {} };
  FIRST_PUTT_BUCKETS_LIST.forEach((b) => {
    const arr = perBucket[b];
    sample.perBucket[b] = arr.length;
    if (arr.length < PUTT_BUCKET_MIN) {
      avgPuttsByBucket[b] = null;
      threePuttRateByBucket[b] = null;
      return;
    }
    const sum = arr.reduce((a, x) => a + x, 0);
    avgPuttsByBucket[b] = Math.round((sum / arr.length) * 100) / 100;
    const threes = arr.filter((x) => x >= 3).length;
    threePuttRateByBucket[b] = Math.round((threes / arr.length) * 1000) / 1000;
  });
  return { avgPuttsByBucket, threePuttRateByBucket, sample };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t lagPuttingQuality`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(stats): lagPuttingQuality — avg putts and 3-putt rate by bucket"
```

---

### Task 9: Add `sandSaveRate` to statsEngine.js

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/statsEngine.test.js`:

```js
import { sandSaveRate } from '../statsEngine';

describe('sandSaveRate', () => {
  test('returns null below 4-attempt threshold', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: 'sand-save' }],
    );
    expect(sandSaveRate([round], 'me').rate).toBeNull();
  });

  test('counts saves over sand-shot attempts on missed-GIR holes', () => {
    const rounds = Array.from({ length: 5 }, (_, i) => makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: i < 3 ? 'sand-save' : 'none' }],
    ));
    const r = sandSaveRate(rounds, 'me');
    expect(r.attempts).toBe(5);
    expect(r.saves).toBe(3);
    expect(r.rate).toBeCloseTo(0.6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sandSaveRate`
Expected: FAIL.

- [ ] **Step 3: Implement**

At the top of `src/store/statsEngine.js`, ensure `isGIR` is imported from `./scoring` (add it to the existing import line, or add a new import):

```js
import { isGIR } from './scoring';
```

Then append:

```js
const SAND_SAVE_MIN_ATTEMPTS = 4;

export function sandSaveRate(rounds, playerId) {
  let attempts = 0, saves = 0;
  const perRound = [];
  rounds.forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    let roundAttempts = 0, roundSaves = 0;
    (round.holes ?? []).forEach((hole) => {
      const d = byHole[hole.number];
      if (!d || (d.sandShots ?? 0) === 0) return;
      const strokes = round?.scores?.[playerId]?.[hole.number];
      const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
      if (gir !== false) return;             // sand save requires missed GIR
      roundAttempts += 1;
      if (d.recoveryOutcome === 'sand-save') roundSaves += 1;
    });
    if (roundAttempts > 0) perRound.push({ attempts: roundAttempts, saves: roundSaves });
    attempts += roundAttempts;
    saves += roundSaves;
  });
  return {
    attempts,
    saves,
    rate: attempts >= SAND_SAVE_MIN_ATTEMPTS ? saves / attempts : null,
    perRound,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sandSaveRate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(stats): sandSaveRate — saves over sand-shot attempts on missed-GIR"
```

---

### Task 10: Add `upAndDownRate` to statsEngine.js

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { upAndDownRate } from '../statsEngine';

describe('upAndDownRate', () => {
  test('returns null below 6 missed-GIR holes', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 0, recoveryOutcome: 'up-and-down' }],
    );
    expect(upAndDownRate([round], 'me').rate).toBeNull();
  });

  test('splits conversions by sand vs non-sand', () => {
    const rounds = Array.from({ length: 8 }, (_, i) => makeRound(
      [{ par: 4, strokes: 5 }],
      [{
        putts: 1,
        sandShots: i % 2,                  // alternate
        recoveryOutcome: i < 4 ? (i % 2 ? 'sand-save' : 'up-and-down') : 'none',
      }],
    ));
    const r = upAndDownRate(rounds, 'me');
    expect(r.attempts).toBe(8);
    expect(r.conversions).toBe(4);
    expect(r.rate).toBeCloseTo(0.5);
    expect(r.byLie.sand.attempts).toBe(4);
    expect(r.byLie.sand.conversions).toBe(2);
    expect(r.byLie.nonSand.attempts).toBe(4);
    expect(r.byLie.nonSand.conversions).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t upAndDownRate`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
const UP_AND_DOWN_MIN_ATTEMPTS = 6;

export function upAndDownRate(rounds, playerId) {
  let attempts = 0, conversions = 0;
  const byLie = {
    sand:    { attempts: 0, conversions: 0 },
    nonSand: { attempts: 0, conversions: 0 },
  };
  rounds.forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    (round.holes ?? []).forEach((hole) => {
      const d = byHole[hole.number];
      if (!d) return;
      const strokes = round?.scores?.[playerId]?.[hole.number];
      const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
      if (gir !== false) return;
      attempts += 1;
      const isSand = (d.sandShots ?? 0) >= 1;
      const lieKey = isSand ? 'sand' : 'nonSand';
      byLie[lieKey].attempts += 1;
      const saved = d.recoveryOutcome === 'up-and-down' || d.recoveryOutcome === 'sand-save';
      if (saved) {
        conversions += 1;
        byLie[lieKey].conversions += 1;
      }
    });
  });
  const safeRate = (a, c) => (a > 0 ? c / a : null);
  return {
    attempts,
    conversions,
    rate: attempts >= UP_AND_DOWN_MIN_ATTEMPTS ? conversions / attempts : null,
    byLie: {
      sand:    { ...byLie.sand,    rate: safeRate(byLie.sand.attempts,    byLie.sand.conversions) },
      nonSand: { ...byLie.nonSand, rate: safeRate(byLie.nonSand.attempts, byLie.nonSand.conversions) },
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t upAndDownRate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(stats): upAndDownRate — conversions split by sand vs non-sand lie"
```

---

### Task 11: Add `bunkerVisits` to statsEngine.js

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { bunkerVisits } from '../statsEngine';

describe('bunkerVisits', () => {
  test('counts sand shots and holes-with-sand per round', () => {
    const round = makeRound(
      [
        { par: 4, strokes: 5 },
        { par: 4, strokes: 4 },
        { par: 5, strokes: 7 },
      ],
      [
        { putts: 1, sandShots: 2 },
        { putts: 2, sandShots: 0 },
        { putts: 2, sandShots: 1 },
      ],
    );
    const r = bunkerVisits([round, round], 'me');
    expect(r.totalShots).toBe(6);
    expect(r.holesWithSand).toBe(4);
    expect(r.avgPerRound).toBeCloseTo(3.0);          // 6 sand shots / 2 rounds
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t bunkerVisits`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
export function bunkerVisits(rounds, playerId) {
  let totalShots = 0, holesWithSand = 0, roundCount = 0;
  rounds.forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    roundCount += 1;
    let roundShots = 0;
    (round.holes ?? []).forEach((hole) => {
      const d = byHole[hole.number];
      const sand = d?.sandShots ?? 0;
      if (sand > 0) holesWithSand += 1;
      roundShots += sand;
    });
    totalShots += roundShots;
  });
  return {
    totalShots,
    holesWithSand,
    avgPerRound: roundCount > 0
      ? Math.round((totalShots / roundCount) * 10) / 10
      : 0,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t bunkerVisits`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(stats): bunkerVisits — total sand shots and avg per round"
```

---

### Task 12: Wire Phase A metrics into `computeMyStats`

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/personalStats.test.js`:

```js
import { computeMyStats } from '../personalStats';

test('computeMyStats includes lagPutting, sandSaves, upAndDown, bunkerVisits', () => {
  const round = {
    key: 't1#0',
    courseName: 'Test',
    tournamentName: 'T',
    tournamentDate: '2026-05-20',
    complete: true,
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    players: [{ id: 'me', name: 'Me' }],
    scores: { me: { 1: 4 } },
    shotDetails: { me: { 1: { putts: 2, sandShots: 0, firstPuttBucket: '6-10' } } },
    playerHandicaps: { me: 18 },
  };
  const stats = computeMyStats([round]);
  expect(stats.lagPutting).toBeDefined();
  expect(stats.sandSaves).toBeDefined();
  expect(stats.upAndDown).toBeDefined();
  expect(stats.bunkerVisits).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=personalStats.test.js`
Expected: FAIL — keys not present.

- [ ] **Step 3: Wire imports and return shape**

In `src/store/personalStats.js`, add to the existing imports from `./statsEngine`:

```js
import {
  // … existing imports …
  lagPuttingQuality,
  sandSaveRate,
  upAndDownRate,
  bunkerVisits,
} from './statsEngine';
```

In `computeMyStats` (around line 361), add the new keys to the return object — `synthetic.rounds` is the array fed to the engine functions:

```js
return {
  roundCount: rounds.length,
  metrics: computeMetrics(synthetic),
  form: computeRecentVsHistory(rounds, n),
  ranking: rankStrengths(synthetic),
  parType: parTypeSplit(synthetic, CANON_ID),
  difficulty: holeDifficultySplit(synthetic, CANON_ID),
  frontBack: frontBackSplit(synthetic)[0] ?? null,
  warmupClosing: warmupVsClosing(synthetic, CANON_ID),
  distribution: playerScoreDistribution(synthetic, CANON_ID),
  teeShot: teeShotImpact(synthetic, CANON_ID),
  shots: shotStats(synthetic, CANON_ID),
  bounceBack: bounceBackRate(synthetic)[0] ?? null,
  scrambling: scramblingStats(synthetic)[0] ?? null,
  history: playerRoundHistory(synthetic, CANON_ID),
  formSeries: computeFormSeries(rounds),
  // NEW Phase A:
  lagPutting:   lagPuttingQuality(synthetic.rounds, CANON_ID),
  sandSaves:    sandSaveRate(synthetic.rounds, CANON_ID),
  upAndDown:    upAndDownRate(synthetic.rounds, CANON_ID),
  bunkerVisits: bunkerVisits(synthetic.rounds, CANON_ID),
};
```

- [ ] **Step 4: Verify `rekey` passes the new fields through**

Open `src/store/personalStats.js` and confirm the `rekey` block (around lines 21–45) still uses whole-object copies (it does — `shotDetails: rekey(round.shotDetails)`). No change needed.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=personalStats.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat(personal-stats): expose lagPutting / sandSaves / upAndDown / bunkerVisits"
```

---

### Task 13: Render "Putts by first-putt distance" sub-section on Shots tab

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Find the Shots tab body**

Search for `tab === 'shots'` in `src/screens/MyStatsScreen.js`. Below the existing Putting section (look for `puttsPerRound` rendering), add:

```jsx
{stats?.lagPutting && (
  <View style={s.statSection}>
    <Text style={s.sectionTitle}>Putts by first-putt distance</Text>
    {['0-3', '3-6', '6-10', '10-20', '20+'].map((bucket) => {
      const avg = stats.lagPutting.avgPuttsByBucket[bucket];
      const n = stats.lagPutting.sample.perBucket[bucket];
      return (
        <View key={bucket} style={s.statRow}>
          <Text style={s.statLabel}>{bucket} ft</Text>
          <Text style={s.statValue}>
            {avg == null ? '—' : avg.toFixed(2)}
            <Text style={s.statSubtle}> ({n} putts)</Text>
          </Text>
        </View>
      );
    })}
  </View>
)}
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run web` — navigate to My Stats → Shots tab. Verify the new section renders with "—" for buckets below 12 putts and a numeric average above.

- [ ] **Step 3: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): putts by first-putt distance section"
```

---

### Task 14: Render Around-the-Green section on Shots tab

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Add the section**

After the Putting section additions from Task 13, add:

```jsx
{(stats?.sandSaves || stats?.upAndDown || stats?.bunkerVisits) && (
  <View style={s.statSection}>
    <Text style={s.sectionTitle}>Around the green</Text>
    <View style={s.statRow}>
      <Text style={s.statLabel}>Sand-save rate</Text>
      <Text style={s.statValue}>
        {stats.sandSaves?.rate == null
          ? '—'
          : `${stats.sandSaves.saves} of ${stats.sandSaves.attempts} · ${Math.round(stats.sandSaves.rate * 100)}%`}
        <Text style={s.statSubtle}> · Scratch ~51%</Text>
      </Text>
    </View>
    <View style={s.statRow}>
      <Text style={s.statLabel}>Up-and-down rate</Text>
      <Text style={s.statValue}>
        {stats.upAndDown?.rate == null
          ? '—'
          : `${stats.upAndDown.conversions} of ${stats.upAndDown.attempts} · ${Math.round(stats.upAndDown.rate * 100)}%`}
        <Text style={s.statSubtle}> · Scratch ~60%</Text>
      </Text>
    </View>
    <View style={s.statRow}>
      <Text style={s.statLabel}>Bunker visits</Text>
      <Text style={s.statValue}>
        {stats.bunkerVisits?.avgPerRound != null
          ? `${stats.bunkerVisits.avgPerRound.toFixed(1)} per round`
          : '—'}
      </Text>
    </View>
  </View>
)}
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run web` — Shots tab now shows the Around-the-Green section. Without enough samples, each row shows "—".

- [ ] **Step 3: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): around-the-green section (sand saves, up&down, bunker visits)"
```

---

### Task 15: Phase A — open PR

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin feature/strokes-gained-spec
gh pr create --title "feat: Phase A — cheap new shot stats (sand saves, up&down, lag putting, bunker visits)" --body "$(cat <<'EOF'
Implements Phase A of the Strokes Gained + Cheap Stats spec.

Captures `sandShots`, `firstPuttBucket`, `approachBucket`, and `recoveryOutcome` per hole inside the existing `round.shotDetails` JSON blob — no Postgres migration. Adds four new engine functions (`lagPuttingQuality`, `sandSaveRate`, `upAndDownRate`, `bunkerVisits`) and wires them into `computeMyStats`. New UI sections on the Shots tab show putts-by-bucket and an Around-the-Green panel.

Phase B (Strokes Gained framework) lands in a follow-up PR on this branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Verify Phase A in CI**

Wait for CI to confirm lint + tests pass. Address any failures before moving to Phase B tasks below.

---

## Phase B — Strokes Gained framework

### Task 16: Create `strokesGainedBaseline.js`

**Files:**
- Create: `src/store/strokesGainedBaseline.js`
- Test: `src/store/__tests__/strokesGainedBaseline.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/store/__tests__/strokesGainedBaseline.test.js
import {
  BASELINES, BUCKETS, expectedStrokes, expectedFromBucket,
} from '../strokesGainedBaseline';

describe('BASELINES', () => {
  test('every category is sorted ascending by distance', () => {
    Object.entries(BASELINES).forEach(([_lie, rows]) => {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].distance).toBeGreaterThan(rows[i - 1].distance);
      }
    });
  });
});

describe('expectedStrokes', () => {
  test('returns exact row when distance matches', () => {
    const fairway150 = BASELINES.fairway.find((r) => r.distance === 150);
    expect(expectedStrokes('fairway', 150)).toBeCloseTo(fairway150.expected);
  });
  test('interpolates between rows', () => {
    const a = BASELINES.fairway[0];
    const b = BASELINES.fairway[1];
    const mid = (a.distance + b.distance) / 2;
    const expectedMid = (a.expected + b.expected) / 2;
    expect(expectedStrokes('fairway', mid)).toBeCloseTo(expectedMid, 2);
  });
  test('clamps below minimum distance', () => {
    const min = BASELINES.green[0];
    expect(expectedStrokes('green', 0)).toBeCloseTo(min.expected);
  });
  test('clamps above maximum distance', () => {
    const rows = BASELINES.fairway;
    const max = rows[rows.length - 1];
    expect(expectedStrokes('fairway', max.distance + 100)).toBeCloseTo(max.expected);
  });
  test('unknown lie returns null', () => {
    expect(expectedStrokes('lava', 150)).toBeNull();
  });
});

describe('expectedFromBucket', () => {
  test('maps bucket key to midpoint then to expected', () => {
    const v = expectedFromBucket('firstPutt', '6-10');
    expect(v).toBeCloseTo(expectedStrokes('green', BUCKETS.firstPutt['6-10']));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the module**

```js
// src/store/strokesGainedBaseline.js
//
// Mark Broadie scratch-golfer baselines from "Every Shot Counts"
// (Putnam, 2014). Distances in YARDS for tee/fairway/rough/sand/recovery
// and in FEET for green. Values are expected strokes-to-hole-out from
// that lie and distance.
//
// These approximate the published Broadie tables; refine with the exact
// rows when convenient — the lookup helper interpolates linearly so
// small revisions stay stable.

export const BASELINES = {
  tee: [
    { distance: 100, expected: 2.79 },
    { distance: 150, expected: 2.91 },
    { distance: 200, expected: 3.12 },
    { distance: 250, expected: 3.41 },
    { distance: 300, expected: 3.71 },
    { distance: 350, expected: 4.00 },
    { distance: 400, expected: 4.29 },
    { distance: 450, expected: 4.55 },
    { distance: 500, expected: 4.78 },
    { distance: 550, expected: 5.00 },
  ],
  fairway: [
    { distance:  50, expected: 2.55 },
    { distance: 100, expected: 2.80 },
    { distance: 150, expected: 2.92 },
    { distance: 200, expected: 3.32 },
    { distance: 250, expected: 3.70 },
    { distance: 300, expected: 4.04 },
  ],
  rough: [
    { distance:  50, expected: 2.74 },
    { distance: 100, expected: 2.98 },
    { distance: 150, expected: 3.10 },
    { distance: 200, expected: 3.50 },
    { distance: 250, expected: 3.91 },
  ],
  sand: [
    { distance:  10, expected: 2.42 },
    { distance:  20, expected: 2.55 },
    { distance:  30, expected: 2.70 },
    { distance:  50, expected: 2.93 },
    { distance: 100, expected: 3.25 },
  ],
  recovery: [
    { distance:  50, expected: 2.85 },        // blended fairway+rough
    { distance: 100, expected: 3.05 },
    { distance: 150, expected: 3.20 },
    { distance: 200, expected: 3.60 },
  ],
  green: [
    { distance:  3, expected: 1.05 },         // feet
    { distance:  6, expected: 1.50 },
    { distance: 10, expected: 1.70 },
    { distance: 15, expected: 1.83 },
    { distance: 20, expected: 1.91 },
    { distance: 30, expected: 2.10 },
    { distance: 50, expected: 2.40 },
  ],
};

export const BUCKETS = {
  firstPutt: { '0-3': 1.5, '3-6': 4.5, '6-10': 8, '10-20': 15, '20+': 30 },         // feet
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },  // yards
};

// Binary-search lookup with linear interpolation. Clamps to endpoints.
export function expectedStrokes(lie, distance) {
  const rows = BASELINES[lie];
  if (!rows || rows.length === 0) return null;
  if (distance <= rows[0].distance) return rows[0].expected;
  if (distance >= rows[rows.length - 1].distance) return rows[rows.length - 1].expected;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].distance <= distance) lo = mid; else hi = mid;
  }
  const a = rows[lo], b = rows[hi];
  const t = (distance - a.distance) / (b.distance - a.distance);
  return a.expected + t * (b.expected - a.expected);
}

export function expectedFromBucket(category, bucketKey) {
  const midpoint = BUCKETS[category]?.[bucketKey];
  if (midpoint == null) return null;
  const lie = category === 'firstPutt' ? 'green' : 'fairway';
  return expectedStrokes(lie, midpoint);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/strokesGainedBaseline.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "feat(sg): bundled Broadie scratch baselines + expectedStrokes lookup"
```

---

### Task 17: Add `sgPutting`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { sgPutting } from '../statsEngine';

describe('sgPutting', () => {
  test('returns null per hole when firstPuttBucket missing', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2 }],
    );
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeNull();
    expect(r.sampleHoles).toBe(0);
  });
  test('SG = expectedStrokes(green, midpoint) - putts on a 2-putt from 6-10', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '6-10' }],
    );
    // expected ~1.70 from 8ft → SG = 1.70 − 2 = −0.30
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(-0.30, 1);
    expect(r.sampleHoles).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgPutting`
Expected: FAIL.

- [ ] **Step 3: Implement**

At the top of `src/store/statsEngine.js`, add (or extend an existing import) from `./strokesGainedBaseline`:

```js
import { expectedStrokes, expectedFromBucket, BUCKETS } from './strokesGainedBaseline';
```

Then append:

```js
export function sgPutting(round, playerId) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    if (!d || d.putts == null || !d.firstPuttBucket) return null;
    const expected = expectedFromBucket('firstPutt', d.firstPuttBucket);
    if (expected == null) return null;
    return expected - d.putts;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgPutting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgPutting round-level metric"
```

---

### Task 18: Add `sgAroundGreen`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { sgAroundGreen } from '../statsEngine';

describe('sgAroundGreen', () => {
  test('null on GIR-hit holes', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, sandShots: 0, firstPuttBucket: '6-10' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0]).toBeNull();
  });
  test('SG = expected(start lie, ~20y) - expected(green, putt bucket) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-3', recoveryOutcome: 'sand-save' }],
    );
    // start: sand @20y ≈ 2.55. end: green @1.5ft ≈ 1.05. SG = 2.55 - 1.05 - 1 = 0.50
    const r = sgAroundGreen(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.50, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgAroundGreen`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
// Around-the-green: typical chip/pitch is 15-25y from the green. Use 20y
// as the canonical "missed GIR" recovery start distance for both sand
// and non-sand lies.
const AROUND_GREEN_START_DISTANCE = 20;

export function sgAroundGreen(round, playerId) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    if (!d) return null;
    const strokes = round?.scores?.[playerId]?.[hole.number];
    const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
    if (gir !== false) return null;
    const lie = (d.sandShots ?? 0) >= 1 ? 'sand' : 'recovery';
    const start = expectedStrokes(lie, AROUND_GREEN_START_DISTANCE);
    let end;
    if (d.putts === 0) {
      end = 0;                                          // chip-in
    } else if (d.firstPuttBucket) {
      end = expectedFromBucket('firstPutt', d.firstPuttBucket);
    } else {
      return null;                                      // missing data
    }
    return start - end - 1;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgAroundGreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgAroundGreen round-level metric"
```

---

### Task 19: Add `sgApproach`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { sgApproach } from '../statsEngine';

describe('sgApproach', () => {
  test('null on par-3', () => {
    const round = makeRound(
      [{ par: 3, strokes: 3 }],
      [{ putts: 1, approachBucket: null }],
    );
    expect(sgApproach(round, 'me').perHole[0]).toBeNull();
  });
  test('GIR hit from 100-150 bucket → SG = expected(fairway, 125) - expected(green, putt midpoint) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '10-20' }],
    );
    // expected(fairway, 125) ≈ 2.86. expected(green, 15ft) ≈ 1.83. SG ≈ 2.86 - 1.83 - 1 ≈ 0.03
    const r = sgApproach(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.03, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgApproach`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
export function sgApproach(round, playerId) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    if (hole.par === 3) return null;
    const d = byHole?.[hole.number];
    if (!d || !d.approachBucket) return null;
    const startDist = BUCKETS.approach[d.approachBucket];
    if (startDist == null) return null;
    const start = expectedStrokes('fairway', startDist);
    const strokes = round?.scores?.[playerId]?.[hole.number];
    const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
    let end;
    if (gir === true && d.firstPuttBucket) {
      end = expectedFromBucket('firstPutt', d.firstPuttBucket);
    } else if (gir === false) {
      const lie = (d.sandShots ?? 0) >= 1 ? 'sand' : 'recovery';
      end = expectedStrokes(lie, AROUND_GREEN_START_DISTANCE);
    } else {
      return null;
    }
    return start - end - 1;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgApproach`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgApproach round-level metric (par-4/5 only)"
```

---

### Task 20: Add `sgOffTheTee`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { sgOffTheTee } from '../statsEngine';

describe('sgOffTheTee', () => {
  test('fairway drive on a 400y par-4 → SG ≈ +0.43', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    const r = sgOffTheTee(round, 'me');
    // expected(tee, 400) ≈ 4.29. expected(fairway, 125) ≈ 2.86. SG ≈ 4.29 - 2.86 - 1 ≈ 0.43.
    expect(r.perHole[0]).toBeCloseTo(0.43, 1);
  });
  test('tee penalty drags SG below -0.5', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 6 } },
      shotDetails: { me: { 1: { drive: 'left', teePenalties: 1, approachBucket: '100-150' } } },
    };
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeLessThan(-0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgOffTheTee`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
// SG Off-the-Tee uses hole.distance when available (yards). Falls back to
// par-typical lengths so legacy rounds without distance still get a value.
const PAR_DEFAULT_DISTANCE = { 3: 170, 4: 400, 5: 530 };
const PAR_TYPICAL_RESIDUAL = { 3: 0, 4: 150, 5: 220 };

export function sgOffTheTee(round, playerId) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    if (!d || d.drive == null) return null;
    const teeDistance = hole.distance ?? PAR_DEFAULT_DISTANCE[hole.par] ?? 400;
    const start = expectedStrokes('tee', teeDistance);

    // End lie & residual distance from drive direction:
    //   fairway/super: fairway lie at approachBucket midpoint (or par-typical)
    //   left/right:    rough lie at same residual
    //   short:         fairway lie at ~60% of the tee distance remaining
    let endLie = 'fairway';
    let residualDistance;
    if (d.drive === 'short') {
      residualDistance = teeDistance * 0.40;
      endLie = 'fairway';
    } else if (d.approachBucket) {
      residualDistance = BUCKETS.approach[d.approachBucket];
      endLie = (d.drive === 'left' || d.drive === 'right') ? 'rough' : 'fairway';
    } else {
      residualDistance = PAR_TYPICAL_RESIDUAL[hole.par] ?? 150;
      endLie = (d.drive === 'left' || d.drive === 'right') ? 'rough' : 'fairway';
    }
    const end = expectedStrokes(endLie, residualDistance);
    const penalty = d.teePenalties ?? 0;
    return start - end - 1 - penalty;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgOffTheTee`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgOffTheTee round-level metric"
```

---

### Task 21: Add `sgTotal`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { sgTotal } from '../statsEngine';

describe('sgTotal', () => {
  test('sums the four categories', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '10-20',
        sandShots: 0,
      } } },
    };
    const r = sgTotal(round, 'me');
    expect(r.total).toBeCloseTo(
      r.byCategory.tee + r.byCategory.approach + r.byCategory.aroundGreen + r.byCategory.putting,
      5,
    );
    expect(r.sampleHoles).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgTotal`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
export function sgTotal(round, playerId) {
  const tee         = sgOffTheTee(round, playerId);
  const approach    = sgApproach(round, playerId);
  const aroundGreen = sgAroundGreen(round, playerId);
  const putting     = sgPutting(round, playerId);
  const byCategory = {
    tee:         tee.total,
    approach:    approach.total,
    aroundGreen: aroundGreen.total,
    putting:     putting.total,
  };
  const total = byCategory.tee + byCategory.approach + byCategory.aroundGreen + byCategory.putting;
  const sampleHoles = Math.max(
    tee.sampleHoles, approach.sampleHoles,
    aroundGreen.sampleHoles, putting.sampleHoles,
  );
  return { total, byCategory, sampleHoles };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgTotal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgTotal aggregates the four categories per round"
```

---

### Task 22: Add `sgSeason`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { sgSeason } from '../statsEngine';

describe('sgSeason', () => {
  test('returns null total below 18-hole sample', () => {
    expect(sgSeason([], 'me').total).toBeNull();
  });
  test('aggregates across rounds when enough sample holes exist', () => {
    const mkRound = () => ({
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '10-20',
        sandShots: 0,
      }])) },
    });
    const r = sgSeason([mkRound(), mkRound()], 'me');
    expect(r.perRound.length).toBe(2);
    expect(r.sampleHoles).toBeGreaterThanOrEqual(18);
    expect(r.total).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgSeason`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/store/statsEngine.js`:

```js
const SG_SEASON_MIN_SAMPLE = 18;       // one full round's worth of contributing holes

export function sgSeason(rounds, playerId) {
  const byCategory = { tee: 0, approach: 0, aroundGreen: 0, putting: 0 };
  let total = 0;
  let sampleHoles = 0;
  const perRound = [];
  rounds.forEach((round, i) => {
    const r = sgTotal(round, playerId);
    if (r.sampleHoles === 0) return;
    byCategory.tee         += r.byCategory.tee;
    byCategory.approach    += r.byCategory.approach;
    byCategory.aroundGreen += r.byCategory.aroundGreen;
    byCategory.putting     += r.byCategory.putting;
    total += r.total;
    sampleHoles += r.sampleHoles;
    perRound.push({ index: i, total: r.total, sampleHoles: r.sampleHoles });
  });
  if (sampleHoles < SG_SEASON_MIN_SAMPLE) {
    return { total: null, byCategory: null, sampleHoles, perRound };
  }
  const denom = perRound.length;
  return {
    total: total / denom,                                          // per-round
    byCategory: {
      tee:         byCategory.tee         / denom,
      approach:    byCategory.approach    / denom,
      aroundGreen: byCategory.aroundGreen / denom,
      putting:     byCategory.putting     / denom,
    },
    sampleHoles,
    perRound,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgSeason`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgSeason cross-round aggregation with sample gating"
```

---

### Task 23: Wire `strokesGained` block into `computeMyStats`

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/personalStats.test.js`:

```js
test('computeMyStats includes strokesGained block', () => {
  const round = {
    key: 't1#0',
    courseName: 'Test',
    tournamentName: 'T',
    tournamentDate: '2026-05-20',
    complete: true,
    holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
    players: [{ id: 'me', name: 'Me' }],
    scores: { me: { 1: 4 } },
    shotDetails: { me: { 1: {
      drive: 'fairway', putts: 2, sandShots: 0,
      firstPuttBucket: '10-20', approachBucket: '100-150',
    } } },
    playerHandicaps: { me: 18 },
  };
  const stats = computeMyStats([round]);
  expect(stats.strokesGained).toBeDefined();
  expect(stats.strokesGained).toHaveProperty('total');
  expect(stats.strokesGained).toHaveProperty('byCategory');
  expect(stats.strokesGained).toHaveProperty('sampleHoles');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=personalStats.test.js -t strokesGained`
Expected: FAIL.

- [ ] **Step 3: Wire imports and return**

In `src/store/personalStats.js`, extend imports:

```js
import {
  // … existing imports …
  sgSeason,
} from './statsEngine';
```

In `computeMyStats`, add to the return object:

```js
strokesGained: sgSeason(synthetic.rounds, CANON_ID),
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=personalStats.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat(personal-stats): expose strokesGained season aggregate"
```

---

### Task 24: Render SG headline card on Shots tab

**Files:**
- Create: `src/components/mystats/SGBars.js`
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Create the bar component**

```js
// src/components/mystats/SGBars.js
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useTheme } from '../../theme';

const HEIGHT = 14;
const WIDTH = 200;
const MAX_ABS = 1.5;     // ±1.5 SG/round visual cap

export function SGBar({ label, value }) {
  const { theme } = useTheme();
  if (value == null) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
        <Text style={{ width: 110, color: theme.text.secondary }}>{label}</Text>
        <Text style={{ color: theme.text.muted }}>—</Text>
      </View>
    );
  }
  const clamped = Math.max(-MAX_ABS, Math.min(MAX_ABS, value));
  const center = WIDTH / 2;
  const px = (clamped / MAX_ABS) * (WIDTH / 2);
  const barX = clamped >= 0 ? center : center + px;
  const barW = Math.abs(px);
  const fill = clamped >= 0 ? theme.score.good : theme.score.bad;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
      <Text style={{ width: 110, color: theme.text.secondary, fontSize: 13 }}>{label}</Text>
      <Svg width={WIDTH} height={HEIGHT}>
        <Line x1={center} y1={0} x2={center} y2={HEIGHT} stroke={theme.divider} />
        <Rect x={barX} y={2} width={barW} height={HEIGHT - 4} fill={fill} rx={2} />
      </Svg>
      <Text style={{ marginLeft: 8, color: theme.text.primary, fontSize: 13, fontWeight: '600' }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: Render the SG card on Shots tab**

In `src/screens/MyStatsScreen.js`, near the top of the Shots tab body (above the existing tee shot impact section), add:

```jsx
import { SGBar } from '../components/mystats/SGBars';
```

```jsx
{stats?.strokesGained && (
  <View style={s.statSection}>
    <Text style={s.sectionTitle}>Strokes Gained vs scratch</Text>
    {stats.strokesGained.total == null ? (
      <Text style={s.statSubtle}>
        Log first-putt distance and approach bucket on a few rounds to see this.
      </Text>
    ) : (
      <>
        <Text style={s.statHeadline}>
          {stats.strokesGained.total >= 0 ? '+' : ''}
          {stats.strokesGained.total.toFixed(2)} per round
        </Text>
        <Text style={s.statSubtle}>
          From {stats.strokesGained.sampleHoles} holes · estimated from buckets
        </Text>
        <SGBar label="Off the tee"   value={stats.strokesGained.byCategory.tee} />
        <SGBar label="Approach"       value={stats.strokesGained.byCategory.approach} />
        <SGBar label="Around green"   value={stats.strokesGained.byCategory.aroundGreen} />
        <SGBar label="Putting"        value={stats.strokesGained.byCategory.putting} />
      </>
    )}
  </View>
)}
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run web` — Shots tab shows the SG card with bars (or the empty-state line under the 18-hole sample threshold).

- [ ] **Step 4: Commit**

```bash
git add src/components/mystats/SGBars.js src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): Strokes Gained headline card with SVG bars"
```

---

### Task 25: Render SG card on Overview tab

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Add to Overview**

In the Overview tab body (search for the snapshot cards row), add an additional card:

```jsx
{stats?.strokesGained?.total != null && (
  <View style={s.snapshotCard}>
    <Text style={s.snapshotLabel}>SG vs scratch</Text>
    <Text style={[
      s.snapshotValue,
      { color: stats.strokesGained.total >= 0 ? theme.score.good : theme.score.bad },
    ]}>
      {stats.strokesGained.total >= 0 ? '+' : ''}
      {stats.strokesGained.total.toFixed(2)}
    </Text>
    <Text style={s.snapshotSubtle}>per round</Text>
  </View>
)}
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run web` — Overview tab now shows the SG card alongside Recent Form / Rounds / Avg points.

- [ ] **Step 3: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): Strokes Gained snapshot card on Overview tab"
```

---

### Task 26: Add SG explainer + per-round trend in StatDetailSheet

**Files:**
- Modify: `src/components/StatDetailSheet.js`
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Add a new explainer branch in StatDetailSheet**

In `src/components/StatDetailSheet.js`, add a branch for `type === 'strokesGained'` (mirror the existing branches for `teeShot`, etc.):

```jsx
{type === 'strokesGained' && (
  <>
    <Text style={s.sectionTitle}>What is Strokes Gained?</Text>
    <Text style={s.body}>
      Strokes Gained tells you how your round compares to a scratch
      golfer from the same spots on the course. Positive means you played
      that part of the game better than scratch; negative means worse.
    </Text>
    <Text style={s.body}>
      We use Mark Broadie's published baselines (the same ones the PGA
      Tour uses). Because you log buckets instead of exact yardage, your
      numbers are estimates — accurate to about ±0.2 strokes per round.
    </Text>
    <Text style={s.sectionTitle}>Last 10 rounds</Text>
    {payload.perRound.slice(-10).map((r, i) => (
      <View key={i} style={s.row}>
        <Text style={s.rowLabel}>Round {r.index + 1}</Text>
        <Text style={s.rowValue}>
          {r.total >= 0 ? '+' : ''}{r.total.toFixed(2)}
        </Text>
      </View>
    ))}
  </>
)}
```

- [ ] **Step 2: Wire tap from MyStatsScreen**

Wrap the SG section's outer `<View>` in a `<TouchableOpacity>` (use the existing `openDetail` handler — see the call pattern used by the tee-shot card):

```jsx
<TouchableOpacity
  onPress={() => openDetail({ type: 'strokesGained', payload: stats.strokesGained })}
  activeOpacity={0.7}
>
  {/* existing SG card content */}
</TouchableOpacity>
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run web` — tap the SG card. Verify the explainer appears followed by the last-10-rounds list.

- [ ] **Step 4: Commit**

```bash
git add src/components/StatDetailSheet.js src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): SG explainer sheet with per-round trend"
```

---

### Task 27: Final manual test sweep + open PR

- [ ] **Step 1: Run the full test suite**

```bash
npm test
npm run lint
```

Expected: green on both.

- [ ] **Step 2: Manual cross-platform sweep**

For each row, verify the result on both Web (`npm run web`) and Android (EAS preview build or local dev client):

| Check | Web | Android |
|---|---|---|
| Log a fresh round with every new field. SG card appears on Shots + Overview. |   |   |
| Re-open an old finished tournament. New sections show empty states; old stats unchanged. |   |   |
| Edit a hole to flip GIR missed → hit. Outcome chips disappear, stored value retained. |   |   |
| Tap (?) on each new row. Dismiss persists across app restart. |   |   |
| Tap-and-hold on a bucket button: no accidental selection on touchscreens. |   |   |

- [ ] **Step 3: Push & open Phase B PR**

```bash
git push
gh pr create --title "feat: Phase B — Strokes Gained framework" --body "$(cat <<'EOF'
Adds Mark Broadie scratch-golfer baselines (~150 rows) and computes SG
across the four standard categories (off-the-tee, approach, around-green,
putting) per round and per season. New SG headline card on the Shots tab
of MyStatsScreen plus a snapshot card on Overview, with an explainer
sheet that defines SG and shows the per-round trend.

Phase A (cheap stats) shipped in an earlier PR on the same branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

- **Spec coverage:** Every section in the spec maps to at least one task:
  - Data model → Task 1.
  - Capture UI rules (sandShots, first-putt, approach, outcome chips, (?) explainer) → Tasks 3–7.
  - `recoveryOutcome` auto-selection truth table → Task 2 (logic) + Task 6 (UI integration).
  - Strokes Gained baseline (sources, module layout, lookup) → Task 16.
  - Engine functions Phase A → Tasks 8–11.
  - Engine functions Phase B → Tasks 17–22.
  - `computeMyStats` integration → Tasks 12, 23.
  - Shots tab sections → Tasks 13, 14, 24.
  - Overview SG card → Task 25.
  - SG explainer with disclaimer → Task 26.
  - Backward compat (default values, sample gating) → Task 1 + every engine task's null-returns + Task 22's `SG_SEASON_MIN_SAMPLE`.
  - Testing (unit, integration, manual) → embedded TDD in every engine task + manual sweep in Task 27.
- **Placeholder scan:** No "TBD" / "TODO" / "implement appropriately" / vague handling. Every step shows actual code.
- **Type consistency:** Field names (`firstPuttBucket`, `approachBucket`, `sandShots`, `recoveryOutcome`) used identically across schema, helpers, engine, and UI. Function names (`isGIR`, `recoveryOutcomeFromState`, `lagPuttingQuality`, `sandSaveRate`, `upAndDownRate`, `bunkerVisits`, `sgOffTheTee`, `sgApproach`, `sgAroundGreen`, `sgPutting`, `sgTotal`, `sgSeason`, `expectedStrokes`, `expectedFromBucket`) consistent between definition and call sites.
