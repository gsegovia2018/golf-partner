# Scorecard Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when two devices record a different score for the same player+hole in a casual round, flag the hole, let anyone resolve it by picking a value, and block finishing a round while any conflict is unresolved.

**Architecture:** The sync merge writes a conflict marker into the synced tournament blob (`round.scoreConflicts`). The scorecard reads that marker to flag the hero card amber (reusing official mode's discrepancy-card pattern) and opens a pick-a-value bottom sheet. A new `conflict.resolve` mutation writes the chosen value and clears the marker. `handleFinish` refuses to finish a round with unresolved markers.

**Tech Stack:** React Native 0.81 / Expo SDK 54, plain JS store modules, Jest (jest-expo). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-21-scorecard-conflict-resolution-design.md`

**Testing note:** This codebase unit-tests pure logic, not component rendering (e.g. `DiscrepancySheet` has no test; `HolePage.test.js` tests only the pure `holePagePropsEqual`). Tasks for pure modules (1–3, 6) are full TDD. Tasks for components/screens (4, 5, 7, 8) verify with `npm run lint` plus the full suite staying green — matching the established pattern.

**Conventions:**
- Run a single test file: `npx jest <path>`
- Run the whole suite: `npm test`
- Lint: `npm run lint`
- The conflict marker shape, used everywhere:
  ```js
  round.scoreConflicts[playerId][holeNumber] = {
    candidates: [ { value: <int>, ts: <ms> }, ... ],  // distinct competing values, newest ts first
    detectedAt: <ms>,
  }
  ```
  An absent key = no conflict. A merge that clears a marker leaves the key set to `undefined`.

---

### Task 1: `roundHasConflicts` / `listRoundConflicts` helpers

**Files:**
- Modify: `src/store/scoring.js` (append new exports at end of file)
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the top `import { ... } from '../scoring';` block in `src/store/__tests__/scoring.test.js` two new names: `listRoundConflicts` and `roundHasConflicts`. Then append this describe block to the end of the file:

```js
describe('listRoundConflicts / roundHasConflicts', () => {
  it('returns [] and false when the round has no scoreConflicts', () => {
    const round = { id: 'r1', scores: {} };
    expect(listRoundConflicts(round)).toEqual([]);
    expect(roundHasConflicts(round)).toBe(false);
  });

  it('lists each unresolved conflict as { playerId, hole }, sorted by hole', () => {
    const round = {
      id: 'r1',
      scoreConflicts: {
        p1: { 7: { candidates: [], detectedAt: 1 } },
        p2: { 3: { candidates: [], detectedAt: 1 } },
      },
    };
    expect(listRoundConflicts(round)).toEqual([
      { playerId: 'p2', hole: 3 },
      { playerId: 'p1', hole: 7 },
    ]);
    expect(roundHasConflicts(round)).toBe(true);
  });

  it('ignores cells whose marker was cleared to undefined by a merge', () => {
    const round = { id: 'r1', scoreConflicts: { p1: { 7: undefined } } };
    expect(listRoundConflicts(round)).toEqual([]);
    expect(roundHasConflicts(round)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/store/__tests__/scoring.test.js -t "listRoundConflicts"`
Expected: FAIL — `listRoundConflicts is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to the end of `src/store/scoring.js`:

```js
// ── Score conflict helpers ───────────────────────────────────────────────────
// A round carries `scoreConflicts` (parallel to `scores`): a marker object at
// scoreConflicts[playerId][hole] when that cell has two competing values. See
// store/merge.js for how markers are written. A merge that clears a marker
// leaves the key set to `undefined`, so test the value, not key presence.

// Every unresolved conflict in a round as { playerId, hole } pairs, hole ascending.
export function listRoundConflicts(round) {
  const byPlayer = round?.scoreConflicts;
  if (!byPlayer || typeof byPlayer !== 'object') return [];
  const out = [];
  for (const [playerId, byHole] of Object.entries(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const [holeKey, marker] of Object.entries(byHole)) {
      if (marker) out.push({ playerId, hole: Number(holeKey) });
    }
  }
  return out.sort((a, b) => a.hole - b.hole);
}

// True when the round has at least one unresolved score conflict.
export function roundHasConflicts(round) {
  return listRoundConflicts(round).length > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/store/__tests__/scoring.test.js`
Expected: PASS — all scoring tests green, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: add roundHasConflicts/listRoundConflicts helpers"
```

---

### Task 2: Conflict detection in the sync merge

**Files:**
- Modify: `src/store/merge.js` (inside `mergeTournaments`)
- Test: `src/store/__tests__/merge.test.js`

- [ ] **Step 1: Write the failing tests**

Append this describe block to `src/store/__tests__/merge.test.js`:

```js
describe('mergeTournaments — score conflict markers', () => {
  it('writes a marker when two devices wrote different values for one cell', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    const remote = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(6); // remote wins LWW
    const marker = merged.rounds[0].scoreConflicts.p1['5'];
    expect(marker.candidates).toEqual([
      { value: 6, ts: 200 },
      { value: 4, ts: 100 },
    ]);
    expect(typeof marker.detectedAt).toBe('number');
    expect(merged._meta['rounds.r1.scoreConflicts.p1.h5']).toBe(marker.detectedAt);
  });

  it('writes no marker when both devices wrote the same value', () => {
    const local = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    expect(mergeTournaments(local, remote).merged.rounds[0].scoreConflicts).toBeUndefined();
  });

  it('writes no marker when only one device ever wrote the cell', () => {
    const local = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    expect(mergeTournaments(local, remote).merged.rounds[0].scoreConflicts).toBeUndefined();
  });

  it('does not resurrect a conflict that was already resolved', () => {
    // Stale device still holds the old losing value 4 @ 100.
    const local = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    // Remote was resolved to 6: marker cleared, both paths stamped at 500.
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: {
        'rounds.r1.scores.p1.h5': 500,
        'rounds.r1.scoreConflicts.p1.h5': 500,
      },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(6);
    expect(merged.rounds[0].scoreConflicts).toBeUndefined();
  });

  it('clears a marker when the local resolve is newer than a stale remote marker', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: {
        'rounds.r1.scores.p1.h5': 500,
        'rounds.r1.scoreConflicts.p1.h5': 500,
      },
    };
    const remote = {
      id: 't1',
      rounds: [{
        id: 'r1',
        scores: { p1: { 5: 4 } },
        scoreConflicts: {
          p1: { 5: { candidates: [{ value: 6, ts: 200 }, { value: 4, ts: 100 }], detectedAt: 300 } },
        },
      }],
      _meta: {
        'rounds.r1.scores.p1.h5': 100,
        'rounds.r1.scoreConflicts.p1.h5': 300,
      },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(6);
    expect(merged.rounds[0].scoreConflicts.p1['5']).toBeUndefined();
  });

  it('excludes scoreConflicts paths from the conflicts log', () => {
    const marker = (ts) => ({
      candidates: [{ value: 6, ts: 200 }, { value: 4, ts: 100 }], detectedAt: ts,
    });
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } }, scoreConflicts: { p1: { 5: marker(300) } } }],
      _meta: { 'rounds.r1.scoreConflicts.p1.h5': 300 },
    };
    const remote = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } }, scoreConflicts: { p1: { 5: marker(400) } } }],
      _meta: { 'rounds.r1.scoreConflicts.p1.h5': 400 },
    };
    expect(mergeTournaments(local, remote).conflicts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/store/__tests__/merge.test.js -t "score conflict markers"`
Expected: FAIL — markers are not written / `scoreConflicts` is undefined.

- [ ] **Step 3: Exclude scoreConflicts paths from the conflicts log**

In `src/store/merge.js`, in `mergeTournaments`, find the conflict-recording branch:

```js
    } else if (bothHadTs) {
      // Remote wins AND local had also written this path → same-cell conflict.
      conflicts.push({
```

Replace the first line with:

```js
    } else if (bothHadTs && !path.includes('.scoreConflicts.')) {
      // Remote wins AND local had also written this path → same-cell conflict.
      conflicts.push({
```

- [ ] **Step 4: Add the detection pass**

In `src/store/merge.js`, in `mergeTournaments`, find this line (just after the main `for (const path of paths)` loop closes):

```js
  merged._meta = mergedMeta;
```

Insert this block immediately **before** that line:

```js
  // ── Score conflict markers ─────────────────────────────────────────────────
  // When two devices wrote the same score cell with genuinely different values,
  // the LWW above silently kept one. Record the other in a conflict marker
  // stored in the blob (round.scoreConflicts[pid][hole]) so every device can
  // see and resolve it. This runs as a pass after LWW so it reads the settled
  // `merged` / `mergedMeta`, free of loop-order effects. `remote._meta` is the
  // remote's original (pre-merge) meta.
  const remoteMeta = remote._meta ?? {};
  const SCORE_PATH = /^rounds\.([^.]+)\.scores\.([^.]+)\.h(\d+)$/;
  for (const path of paths) {
    const sm = path.match(SCORE_PATH);
    if (!sm) continue;
    const [, rid, pid, holeStr] = sm;
    const lTs = localMeta[path] ?? 0;
    const rTs = remoteMeta[path] ?? 0;
    // Only a remote-wins, both-sides-wrote case can be a same-cell conflict.
    if (!(rTs > lTs)) continue;
    if (localMeta[path] == null || remoteMeta[path] == null) continue;
    const winnerValue = getAtPath(remote, path);
    const loserValue = getAtPath(local, path);
    // A cleared cell (null) or two equal values is not a conflict.
    if (winnerValue == null || loserValue == null) continue;
    if (winnerValue === loserValue) continue;

    const cPath = `rounds.${rid}.scoreConflicts.${pid}.h${holeStr}`;
    // Already flagged → leave the existing marker untouched.
    if (getAtPath(merged, cPath)) continue;
    // Resolved after the losing value was written → do not resurrect it.
    const cMeta = mergedMeta[cPath];
    if (cMeta != null && cMeta >= lTs) continue;

    const detectedAt = Date.now();
    setAtPath(merged, cPath, {
      candidates: [
        { value: winnerValue, ts: rTs },
        { value: loserValue, ts: lTs },
      ],
      detectedAt,
    });
    mergedMeta[cPath] = detectedAt;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/store/__tests__/merge.test.js`
Expected: PASS — all merge tests green, including the 6 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/store/merge.js src/store/__tests__/merge.test.js
git commit -m "feat: detect same-cell score conflicts during merge"
```

---

### Task 3: `conflict.resolve` mutation + removePlayer cleanup

**Files:**
- Modify: `src/store/mutate.js` (`metaPathFor` + `applyToTournament`)
- Test: `src/store/__tests__/conflictResolveMutation.test.js` (create)
- Test: `src/store/__tests__/addPlayerMutation.test.js` (add one test)

- [ ] **Step 1: Write the failing tests — `conflict.resolve`**

Create `src/store/__tests__/conflictResolveMutation.test.js`:

```js
import { applyToTournament } from '../mutate';

function roundWithConflict() {
  return {
    id: 't1',
    rounds: [{
      id: 'r1',
      scores: { p1: { 5: 6 } },
      scoreConflicts: {
        p1: { 5: { candidates: [{ value: 6, ts: 200 }, { value: 4, ts: 100 }], detectedAt: 300 } },
      },
    }],
  };
}

describe('conflict.resolve mutation', () => {
  test('sets the chosen score and clears the conflict marker', () => {
    const t = roundWithConflict();
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 5, value: 4,
    });
    expect(t.rounds[0].scores.p1[5]).toBe(4);
    expect(t.rounds[0].scoreConflicts.p1[5]).toBeUndefined();
  });

  test('is a no-op for an unknown round', () => {
    const t = roundWithConflict();
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'rX', playerId: 'p1', hole: 5, value: 4,
    });
    expect(t.rounds[0].scores.p1[5]).toBe(6);
  });

  test('sets the score even when the cell has no marker', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    applyToTournament(t, {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 7, value: 3,
    });
    expect(t.rounds[0].scores.p1[7]).toBe(3);
  });
});
```

- [ ] **Step 2: Write the failing test — removePlayer cleanup**

In `src/store/__tests__/addPlayerMutation.test.js`, inside the existing `describe('tournament.removePlayer mutation', ...)` block, add this test:

```js
  test('drops the removed player from scoreConflicts', () => {
    const t = fourPlayerTournament();
    t.rounds[0].scoreConflicts = {
      d: { 1: { candidates: [], detectedAt: 1 } },
      a: { 2: { candidates: [], detectedAt: 1 } },
    };
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [] }],
    });
    expect(t.rounds[0].scoreConflicts.d).toBeUndefined();
    expect(t.rounds[0].scoreConflicts.a).toBeDefined();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/store/__tests__/conflictResolveMutation.test.js src/store/__tests__/addPlayerMutation.test.js`
Expected: FAIL — `conflict.resolve` is an unknown mutation type / `scoreConflicts.d` still defined.

- [ ] **Step 4: Add the `metaPathFor` case**

In `src/store/mutate.js`, in `metaPathFor`, find:

```js
    case 'player.upsertLibrary': return null;
```

Insert immediately **before** it:

```js
    // Resolving a score conflict writes the chosen value AND clears the
    // marker; both LWW-merge, so both paths are stamped.
    case 'conflict.resolve': return [
      `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`,
      `rounds.${m.roundId}.scoreConflicts.${m.playerId}.h${m.hole}`,
    ];
```

- [ ] **Step 5: Add the `applyToTournament` case**

In `src/store/mutate.js`, in `applyToTournament`, find the end of the `case 'score.set':` block (its closing `}`) followed by `case 'shot.set': {`. Insert this new case immediately **after** the `score.set` block's closing `}` and **before** `case 'shot.set': {`:

```js
    case 'conflict.resolve': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      round.scores[m.playerId][m.hole] = m.value;
      if (round.scoreConflicts?.[m.playerId]) {
        round.scoreConflicts = { ...round.scoreConflicts };
        round.scoreConflicts[m.playerId] = { ...round.scoreConflicts[m.playerId] };
        delete round.scoreConflicts[m.playerId][m.hole];
      }
      break;
    }
```

- [ ] **Step 6: Clear scoreConflicts in removePlayer**

In `src/store/mutate.js`, in `applyToTournament`, inside `case 'tournament.removePlayer':`, find:

```js
        const shotDetails = { ...(round.shotDetails ?? {}) };
        delete shotDetails[m.playerId];
        round.shotDetails = shotDetails;
```

Insert immediately **after** it:

```js
        if (round.scoreConflicts) {
          const scoreConflicts = { ...round.scoreConflicts };
          delete scoreConflicts[m.playerId];
          round.scoreConflicts = scoreConflicts;
        }
```

Then in `metaPathFor`, inside `case 'tournament.removePlayer':`, find:

```js
        paths.push(`rounds.${patch.roundId}.shotDetails.${m.playerId}`);
```

Insert immediately **after** it:

```js
        paths.push(`rounds.${patch.roundId}.scoreConflicts.${m.playerId}`);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/store/__tests__/conflictResolveMutation.test.js src/store/__tests__/addPlayerMutation.test.js`
Expected: PASS — all tests green.

- [ ] **Step 8: Commit**

```bash
git add src/store/mutate.js src/store/__tests__/conflictResolveMutation.test.js src/store/__tests__/addPlayerMutation.test.js
git commit -m "feat: add conflict.resolve mutation and removePlayer cleanup"
```

---

### Task 4: `ScoreConflictSheet` component

**Files:**
- Create: `src/components/ScoreConflictSheet.js`

(No unit test — presentational component, matching `DiscrepancySheet` which has none.)

- [ ] **Step 1: Create the component**

Create `src/components/ScoreConflictSheet.js` with this exact content:

```jsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const CONFLICT = '#c77a0a';

// Compact relative time for a candidate's edit timestamp.
function relTime(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

/**
 * Bottom sheet for resolving a casual-round score conflict. One player's hole
 * score was recorded with two (or more) different values by two devices; the
 * merge kept one provisionally. This sheet shows every competing value and lets
 * anyone pick the correct one (or enter a different number).
 *
 * Props:
 *   visible       — bool
 *   onClose       — () => void
 *   hole          — hole number being resolved
 *   subjectName   — display name of the player whose score this is
 *   candidates    — [{ value, ts }] competing values, newest first
 *   currentValue  — the value currently kept in scores (the LWW winner)
 *   onResolve     — (value) => void — picks the final value
 */
export default function ScoreConflictSheet({
  visible, onClose, hole, subjectName, candidates, currentValue, onResolve,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [picked, setPicked] = useState(null);
  const [manual, setManual] = useState(currentValue ?? 4);

  // Reset whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) { setPicked(null); setManual(currentValue ?? 4); }
  }, [visible, currentValue]);

  const list = Array.isArray(candidates) ? candidates : [];

  const stepManual = (delta) => {
    const next = Math.max(1, Math.min(15, manual + delta));
    setManual(next);
    setPicked(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <View style={s.titleRow}>
            <Feather name="alert-circle" size={16} color={CONFLICT} />
            <Text style={s.title}>Resolve hole {hole}</Text>
          </View>
          <Text style={s.subtitle}>
            Two phones recorded a different score for {subjectName || 'this player'}. Pick the correct one.
          </Text>

          <View style={s.cardsRow}>
            {list.map((c) => {
              const isPicked = picked === c.value;
              return (
                <TouchableOpacity
                  key={c.value}
                  style={[s.card, isPicked && s.cardPicked]}
                  onPress={() => { setPicked(c.value); setManual(c.value); }}
                  activeOpacity={0.8}
                  accessibilityLabel={`Use ${c.value} strokes`}
                >
                  {isPicked && (
                    <View style={s.tick}>
                      <Feather name="check" size={12} color={theme.text.inverse} />
                    </View>
                  )}
                  <Text style={s.cardLabel}>
                    {c.value === currentValue ? 'Current score' : 'Other entry'}
                  </Text>
                  <Text style={s.cardValue}>{c.value}</Text>
                  <Text style={s.cardHint}>{relTime(c.ts)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.manualRow}>
            <Text style={s.manualLabel}>Or enter a different score</Text>
            <View style={s.stepper}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => stepManual(-1)}
                accessibilityLabel="Decrease score"
              >
                <Feather name="minus" size={18} color={theme.text.primary} />
              </TouchableOpacity>
              <Text style={s.manualValue}>{manual}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => stepManual(1)}
                accessibilityLabel="Increase score"
              >
                <Feather name="plus" size={18} color={theme.text.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[s.confirm, picked == null && s.confirmDisabled]}
            disabled={picked == null}
            onPress={() => { if (picked != null) onResolve?.(picked); }}
            activeOpacity={0.8}
          >
            <Text style={[s.confirmText, picked == null && s.confirmTextDisabled]}>
              {picked == null
                ? 'Pick a score'
                : `Confirm ${picked} ${picked === 1 ? 'stroke' : 'strokes'}`}
            </Text>
          </TouchableOpacity>
          <Text style={s.foot}>Anyone in the group can resolve this · syncs to every phone</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.bg.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24,
    width: '100%', maxWidth: 560, alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.border.default, marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.muted,
    marginTop: 4, marginBottom: 16,
  },
  cardsRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  card: {
    flexGrow: 1, flexBasis: 0, minWidth: 120,
    backgroundColor: theme.bg.card,
    borderRadius: 14, borderWidth: 1.5, borderColor: theme.border.default,
    paddingVertical: 16, paddingHorizontal: 12,
    alignItems: 'center', gap: 6, position: 'relative',
  },
  cardPicked: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  tick: {
    position: 'absolute', top: 8, right: 8,
    width: 20, height: 20, borderRadius: 10, backgroundColor: theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  cardLabel: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 11, color: theme.text.muted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  cardValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 30, color: theme.text.primary,
  },
  cardHint: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted },
  manualRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: theme.border.default,
  },
  manualLabel: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.text.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: theme.bg.secondary,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  manualValue: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 20, color: theme.text.primary,
    minWidth: 24, textAlign: 'center',
  },
  confirm: {
    marginTop: 18, backgroundColor: theme.accent.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  confirmDisabled: { backgroundColor: theme.bg.secondary },
  confirmText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme.text.inverse },
  confirmTextDisabled: { color: theme.text.muted },
  foot: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted,
    textAlign: 'center', marginTop: 10,
  },
});
```

- [ ] **Step 2: Lint and verify the suite**

Run: `npm run lint`
Expected: no new errors.

Run: `npm test`
Expected: PASS — full suite green (no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/components/ScoreConflictSheet.js
git commit -m "feat: add ScoreConflictSheet resolution sheet"
```

---

### Task 5: Conflict flagging on `PlayerCard`

**Files:**
- Modify: `src/components/scorecard/styles.js` (add 3 styles)
- Modify: `src/components/scorecard/PlayerCard.js`

(No unit test — presentational component.)

- [ ] **Step 1: Add conflict styles**

In `src/components/scorecard/styles.js`, find the `soloHeroCard: {` style block and its closing `},`. Insert immediately **after** that closing `},`:

```js
    // Amber treatment for a hero card whose score is in conflict.
    soloHeroCardConflict: {
      borderColor: '#c77a0a',
      borderWidth: 1.5,
      backgroundColor: 'rgba(199,122,10,0.10)',
    },
    soloConflictHint: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#c77a0a',
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 999,
    },
    soloConflictHintText: {
      color: '#ffffff',
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
    },
```

- [ ] **Step 2: Add the `conflict` props to PlayerCard**

In `src/components/scorecard/PlayerCard.js`, find the prop destructuring line:

```js
  officialState, canResolveHere, onOpenDiscrepancy,
}) {
```

Replace with:

```js
  officialState, canResolveHere, onOpenDiscrepancy,
  conflict, onOpenConflict,
}) {
```

- [ ] **Step 3: Make the card conflict-aware**

In `src/components/scorecard/PlayerCard.js`, find this block:

```js
  // A discrepancy card the viewer can act on opens the resolve sheet on tap.
  // Other states (or read-only viewers) keep the card non-interactive — the
  // badge alone communicates state.
  const heroTappable = officialState === 'discrepancy' && canResolveHere;
  const HeroCard = heroTappable ? Pressable : View;
  const heroCardProps = heroTappable
    ? {
      onPress: () => onOpenDiscrepancy?.(player.id, hole.number),
      accessibilityLabel: `Resolve ${player.name}'s score on hole ${hole.number}`,
    }
    : {};
```

Replace it with:

```js
  // A conflicted card, or an official discrepancy card the viewer can act on,
  // opens its resolve sheet on tap. Conflict takes priority over official
  // state (the two never co-occur — official rounds have no casual conflicts).
  const conflicted = !!conflict;
  const officialTappable = officialState === 'discrepancy' && canResolveHere;
  const heroTappable = conflicted || officialTappable;
  const HeroCard = heroTappable ? Pressable : View;
  const heroCardProps = conflicted
    ? {
      onPress: () => onOpenConflict?.(player.id, hole.number),
      accessibilityLabel: `Resolve ${player.name}'s conflicting score on hole ${hole.number}`,
    }
    : officialTappable
      ? {
        onPress: () => onOpenDiscrepancy?.(player.id, hole.number),
        accessibilityLabel: `Resolve ${player.name}'s score on hole ${hole.number}`,
      }
      : {};
```

- [ ] **Step 4: Apply the conflict card style**

In `src/components/scorecard/PlayerCard.js`, find:

```js
    <HeroCard style={[s.soloHeroCard, haloStyle]} {...heroCardProps}>
```

Replace with:

```js
    <HeroCard style={[s.soloHeroCard, haloStyle, conflicted && s.soloHeroCardConflict]} {...heroCardProps}>
```

- [ ] **Step 5: Add the conflict alert icon to the name row**

In `src/components/scorecard/PlayerCard.js`, find:

```js
            {officialState === 'discrepancy' && (
              <Feather name="alert-circle" size={14} color={theme.destructive} />
            )}
```

Insert immediately **after** it:

```js
            {conflicted && (
              <Feather name="alert-circle" size={14} color="#c77a0a" />
            )}
```

- [ ] **Step 6: Suppress the pickup toggle when conflicted**

In `src/components/scorecard/PlayerCard.js`, find:

```js
        {/* Pickup toggle is a write action — hide on read-only cards. */}
        {canEdit && (
          <TouchableOpacity
            style={[s.pickupBtn, isPickup && s.pickupBtnActive]}
```

Replace the `{canEdit && (` line with:

```js
        {canEdit && !conflicted && (
```

- [ ] **Step 7: Suppress the steppers and gate long-press when conflicted**

In `src/components/scorecard/PlayerCard.js`, inside the `<View style={s.soloScoreRow}>` block there are two `{canEdit && (` lines wrapping the minus and plus `TouchableOpacity` step buttons. Replace **both** occurrences of:

```js
        {canEdit && (
          <TouchableOpacity
            style={s.soloStepBtn}
```

with:

```js
        {canEdit && !conflicted && (
          <TouchableOpacity
            style={s.soloStepBtn}
```

Then find the long-press handler:

```js
          onLongPress={() => {
            if (canEdit && strokes != null) {
```

Replace the inner line with:

```js
          onLongPress={() => {
            if (canEdit && !conflicted && strokes != null) {
```

- [ ] **Step 8: Amber score numeral + "TAP TO RESOLVE" label**

In `src/components/scorecard/PlayerCard.js`, find:

```js
            <Text style={[s.soloScoreNum, strokes == null && s.scoreDisplayNumEmpty]}>
              {strokes ?? '—'}
            </Text>
            <Text style={s.soloScoreLabel}>
              {strokes == null ? 'STROKES' : canEdit ? 'HOLD TO CLEAR' : 'STROKES'}
            </Text>
```

Replace with:

```js
            <Text style={[
              s.soloScoreNum,
              strokes == null && s.scoreDisplayNumEmpty,
              conflicted && { color: '#c77a0a' },
            ]}>
              {strokes ?? '—'}
            </Text>
            <Text style={[s.soloScoreLabel, conflicted && { color: '#c77a0a' }]}>
              {conflicted
                ? 'TAP TO RESOLVE'
                : strokes == null ? 'STROKES' : canEdit ? 'HOLD TO CLEAR' : 'STROKES'}
            </Text>
```

- [ ] **Step 9: Hide the points badge and shot detail when conflicted; add the hint pill**

In `src/components/scorecard/PlayerCard.js`, find:

```js
      {points != null && (
        <View style={[s.soloPtsBadge, { borderColor: ptsColor }]}>
          <Text style={[s.soloPtsText, { color: ptsColor }]}>
            {points} {points === 1 ? 'point' : 'points'}
          </Text>
        </View>
      )}
```

Replace with:

```js
      {points != null && !conflicted && (
        <View style={[s.soloPtsBadge, { borderColor: ptsColor }]}>
          <Text style={[s.soloPtsText, { color: ptsColor }]}>
            {points} {points === 1 ? 'point' : 'points'}
          </Text>
        </View>
      )}

      {conflicted && (
        <View style={s.soloConflictHint}>
          <Feather name="alert-circle" size={14} color="#ffffff" />
          <Text style={s.soloConflictHintText}>Tap to resolve</Text>
        </View>
      )}
```

Then find:

```js
      {isMe && (
        <ShotDetailSection
```

Replace the `{isMe && (` line with:

```js
      {isMe && !conflicted && (
```

- [ ] **Step 10: Lint and verify the suite**

Run: `npm run lint`
Expected: no new errors.

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 11: Commit**

```bash
git add src/components/scorecard/PlayerCard.js src/components/scorecard/styles.js
git commit -m "feat: flag conflicted score on the PlayerCard"
```

---

### Task 6: Pass conflict data through `HolePage`

**Files:**
- Modify: `src/components/scorecard/HolePage.js`
- Test: `src/components/scorecard/__tests__/HolePage.test.js`

- [ ] **Step 1: Write the failing test**

In `src/components/scorecard/__tests__/HolePage.test.js`, in `baseProps()`, find:

```js
    onOpenDiscrepancy: () => {},
```

Insert immediately **after** it:

```js
    onOpenConflict: () => {},
```

Then add this test inside the `describe('holePagePropsEqual', ...)` block:

```js
  test('structural prop changed (onOpenConflict) → re-render', () => {
    const prev = baseProps();
    const next = { ...prev, onOpenConflict: () => {} };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/HolePage.test.js -t "onOpenConflict"`
Expected: FAIL — `holePagePropsEqual` returns `true` (the new prop is not compared yet).

- [ ] **Step 3: Compare `onOpenConflict` in `holePagePropsEqual`**

In `src/components/scorecard/HolePage.js`, in `holePagePropsEqual`, find:

```js
    || prev.onOpenDiscrepancy !== next.onOpenDiscrepancy
```

Insert immediately **after** it:

```js
    || prev.onOpenConflict !== next.onOpenConflict
```

- [ ] **Step 4: Accept and forward the prop**

In `src/components/scorecard/HolePage.js`, in the `HolePage` function's destructured params, find:

```js
  official, officialDiscrepancy, onOpenDiscrepancy,
```

Replace with:

```js
  official, officialDiscrepancy, onOpenDiscrepancy,
  onOpenConflict,
```

Then find the per-player render where `PlayerCard` is returned:

```js
          return (
            <PlayerCard
              key={player.id}
              player={player}
              hole={pageHole}
              strokes={strokes}
              points={points}
```

Insert a `conflict` lookup immediately **before** the `return (`:

```js
          const conflict = round.scoreConflicts?.[player.id]?.[pageHole.number] ?? null;

          return (
            <PlayerCard
              key={player.id}
              player={player}
              hole={pageHole}
              strokes={strokes}
              points={points}
```

Then find the `PlayerCard` prop list end:

```js
              officialState={officialState}
              canResolveHere={canResolveHere}
              onOpenDiscrepancy={onOpenDiscrepancy}
            />
```

Replace with:

```js
              officialState={officialState}
              canResolveHere={canResolveHere}
              onOpenDiscrepancy={onOpenDiscrepancy}
              conflict={conflict}
              onOpenConflict={onOpenConflict}
            />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/components/scorecard/__tests__/HolePage.test.js`
Expected: PASS — all `holePagePropsEqual` tests green, including the new one.

- [ ] **Step 6: Commit**

```bash
git add src/components/scorecard/HolePage.js src/components/scorecard/__tests__/HolePage.test.js
git commit -m "feat: pass conflict markers through HolePage"
```

---

### Task 7: Host the resolve sheet + go-to-hole dot in `HoleView`

**Files:**
- Modify: `src/components/scorecard/HoleView.js`

(No unit test — component wiring.)

- [ ] **Step 1: Add imports**

In `src/components/scorecard/HoleView.js`, find:

```js
import DiscrepancySheet from '../DiscrepancySheet';
```

Insert immediately **after** it:

```js
import ScoreConflictSheet from '../ScoreConflictSheet';
import { listRoundConflicts } from '../../store/scoring';
```

- [ ] **Step 2: Add the new props to the function signature**

In `src/components/scorecard/HoleView.js`, the `HoleView` function destructures a long prop list ending with `onAttest })`. Find `onAttest }` at the end of that destructuring and replace with:

```js
onAttest, onResolveConflict, focusConflict, onFocusConflictHandled })
```

- [ ] **Step 3: Add conflict state, the open callback, and the focus effect**

In `src/components/scorecard/HoleView.js`, find:

```js
  const openDiscrepancy = useCallback((subjectRosterId, holeNumber) => {
    setDiscrepancyTarget({ hole: holeNumber, subjectRosterId });
  }, []);
```

Insert immediately **after** it:

```js
  // Casual-mode score conflict: which hole/player is open in the resolve sheet.
  const [conflictTarget, setConflictTarget] = useState(null);
  const openConflict = useCallback((playerId, holeNumber) => {
    setConflictTarget({ hole: holeNumber, playerId });
  }, []);

  // The finish gate (ScorecardScreen) sets `focusConflict` after deciding to
  // review a conflict: jump to its hole, open the sheet, then hand the signal
  // back so it fires once.
  useEffect(() => {
    if (focusConflict) {
      onGoToHole(focusConflict.hole);
      setConflictTarget(focusConflict);
      onFocusConflictHandled?.();
    }
  }, [focusConflict, onGoToHole, onFocusConflictHandled]);

  // Holes with at least one unresolved conflict — drives the go-to-hole dot.
  const conflictHoles = useMemo(
    () => new Set(listRoundConflicts(round).map((c) => c.hole)),
    [round],
  );
```

- [ ] **Step 4: Forward `onOpenConflict` to `HolePage`**

In `src/components/scorecard/HoleView.js`, find the `<HolePage` element's props and the line:

```js
                onOpenDiscrepancy={openDiscrepancy}
```

Insert immediately **after** it:

```js
                onOpenConflict={openConflict}
```

- [ ] **Step 5: Add the amber dot to the go-to-hole grid**

In `src/components/scorecard/HoleView.js`, find:

```js
                const hasDiscrepancy = official && officialDiscrepancy
                  ? officialDiscrepancy.myHoles.includes(n)
                  : false;
```

Insert immediately **after** it:

```js
                const hasConflict = conflictHoles.has(n);
```

Then find:

```js
                    {hasDiscrepancy ? (
                      // Discrepancy takes visual priority over a note dot.
                      <View
                        style={[s.holePickerNoteDot, { backgroundColor: theme.destructive }]}
                      />
                    ) : hasNote ? (
```

Replace with:

```js
                    {hasDiscrepancy ? (
                      // Discrepancy takes visual priority over a note dot.
                      <View
                        style={[s.holePickerNoteDot, { backgroundColor: theme.destructive }]}
                      />
                    ) : hasConflict ? (
                      <View
                        style={[s.holePickerNoteDot, { backgroundColor: '#c77a0a' }]}
                      />
                    ) : hasNote ? (
```

- [ ] **Step 6: Render the `ScoreConflictSheet`**

In `src/components/scorecard/HoleView.js`, find the end of the `DiscrepancySheet` render block — the line `})()}` that closes the `{official && officialDiscrepancy && discrepancyTarget && (() => { ... })()}` block, immediately before `<CelebrationOverlay ... />`. Insert this block immediately **after** that `})()}` and **before** `<CelebrationOverlay`:

```jsx
      {/* Casual-mode score conflict resolve sheet. Opened by tapping a hero
          card flagged with a conflict marker. */}
      {conflictTarget && (() => {
        const { hole: cHole, playerId } = conflictTarget;
        const marker = round.scoreConflicts?.[playerId]?.[cHole];
        if (!marker) return null;
        const subject = players.find((p) => p.id === playerId);
        const currentValue = scores?.[playerId]?.[cHole] ?? null;
        return (
          <ScoreConflictSheet
            visible
            onClose={() => setConflictTarget(null)}
            hole={cHole}
            subjectName={subject?.name ?? 'Player'}
            candidates={marker.candidates ?? []}
            currentValue={currentValue}
            onResolve={(value) => {
              onResolveConflict?.(playerId, cHole, value);
              setConflictTarget(null);
            }}
          />
        );
      })()}
```

- [ ] **Step 7: Lint and verify the suite**

Run: `npm run lint`
Expected: no new errors.

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/components/scorecard/HoleView.js
git commit -m "feat: host the score conflict sheet in HoleView"
```

---

### Task 8: Wire resolution + the finish gate in `ScorecardScreen`

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

(No unit test — screen wiring.)

- [ ] **Step 1: Add the import**

In `src/screens/ScorecardScreen.js`, find:

```js
import { mutate } from '../store/mutate';
```

Insert immediately **after** it:

```js
import { listRoundConflicts } from '../store/scoring';
```

- [ ] **Step 2: Add the `conflictFocus` state**

In `src/screens/ScorecardScreen.js`, the component declares several `useState` hooks near the top. Find the line declaring `roundCompleteVisible` state (`const [roundCompleteVisible, setRoundCompleteVisible] = useState(false);`). Insert immediately **after** it:

```js
  // The finish gate sets this to { hole, playerId } to send the user to a
  // conflicted hole; HoleView consumes it to open the resolve sheet.
  const [conflictFocus, setConflictFocus] = useState(null);
  const clearConflictFocus = useCallback(() => setConflictFocus(null), []);
```

- [ ] **Step 3: Add the `resolveConflict` handler**

In `src/screens/ScorecardScreen.js`, find the `saveShot` handler (it begins `const saveShot = useCallback((playerId, holeNumber, detail) => {`). Insert this new handler immediately **before** `const saveShot`:

```js
  // Resolve a casual score conflict: write the chosen value and clear the
  // marker. Updates `scores` state optimistically, then dispatches a
  // conflict.resolve mutation through the serial save chain.
  const resolveConflict = useCallback((playerId, holeNumber, value) => {
    setScores((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] ?? {}), [holeNumber]: value },
    }));
    pendingSaveRef.current = true;
    enqueueSave(async () => {
      if (!tournamentRef.current) return;
      const r = tournamentRef.current.rounds[roundIndex];
      if (!r) return;
      const t = await mutate(tournamentRef.current, {
        type: 'conflict.resolve',
        roundId: r.id,
        playerId,
        hole: holeNumber,
        value,
      });
      tournamentRef.current = t;
      setTournament(t);
    });
  }, [roundIndex, enqueueSave]);
```

- [ ] **Step 4: Add the finish gate**

In `src/screens/ScorecardScreen.js`, in `handleFinish`, find:

```js
    const t = tournamentRef.current;
    const r = t?.rounds?.[roundIndex];
    if (!t || !r) { goBack(); return; }
```

Insert immediately **after** it:

```js
    // A round cannot finish while a hole still has an unresolved score
    // conflict — every hole must end on one agreed value.
    const openConflicts = listRoundConflicts(r);
    if (openConflicts.length > 0) {
      const first = openConflicts[0];
      const name = (t.players ?? []).find((p) => p.id === first.playerId)?.name ?? 'a player';
      const title = 'Resolve conflict to finish';
      const message = openConflicts.length === 1
        ? `Hole ${first.hole} still has a conflicting score for ${name}. Every hole needs one agreed score before this round can finish.`
        : `${openConflicts.length} holes still have conflicting scores. Resolve them before this round can finish.`;
      const review = () => setConflictFocus({ hole: first.hole, playerId: first.playerId });
      if (Platform.OS === 'web') {
        if (window.confirm(`${title}\n\n${message}\n\nReview the conflict now?`)) review();
      } else {
        Alert.alert(title, message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Review conflict', onPress: review },
        ]);
      }
      return;
    }
```

- [ ] **Step 5: Pass the new props to `HoleView`**

In `src/screens/ScorecardScreen.js`, find the `<HoleView` element's last prop:

```js
          onAttest={handleAttest}
        />
```

Replace with:

```js
          onAttest={handleAttest}
          onResolveConflict={resolveConflict}
          focusConflict={conflictFocus}
          onFocusConflictHandled={clearConflictFocus}
        />
```

- [ ] **Step 6: Lint and verify the suite**

Run: `npm run lint`
Expected: no new errors. (If `react-hooks/exhaustive-deps` flags `resolveConflict`, confirm its dep array is `[roundIndex, enqueueSave]` — matching the sibling `saveShot` handler, whose `setScores`/`setTournament`/`pendingSaveRef`/`tournamentRef` are intentionally omitted as stable.)

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: wire conflict resolution and finish-round gate"
```

---

## Manual verification

After all tasks, smoke-test the flow (web is quickest: `npm run web`):

1. **Conflict shows:** Edit a score on two browser profiles/devices for the same player+hole, let both sync. The hole's hero card turns amber with an alert icon and "TAP TO RESOLVE".
2. **Resolve:** Tap the amber card → `ScoreConflictSheet` opens with both values. Pick one (or use the stepper) → confirm. The card returns to normal with the chosen value; the amber dot in "Go to hole" clears.
3. **Finish gate:** On the last hole with a conflict still open, tap **Finish** → the alert appears with **Not now** / **Review conflict** only. "Review conflict" jumps to the hole and opens the sheet. Resolve it, tap **Finish** again → the round finishes normally.
4. Confirm `npm test` and `npm run lint` are both green.

## Self-review notes

- **Spec coverage:** detection (Task 2), in-blob marker (Task 2), `conflict.resolve` mutation (Task 3), removePlayer cleanup (Task 3), `ScoreConflictSheet` (Task 4), flagged card (Task 5), `holePagePropsEqual` (Task 6), sheet host + go-to-hole dot (Task 7), finish gate + helpers (Tasks 1, 8) — all covered.
- **Out of scope (per spec):** GridView flagging, editor identity, the existing `SyncStatusSheet` log, re-gating an already-finished round.
- **Known v1 limitation (per spec):** if a cell already has a marker, a third differing value arriving later does not union into `candidates` — the hole stays flagged and the manual stepper still lets the resolver enter any value.
