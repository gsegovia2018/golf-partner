# Tees & Handicaps Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-player tee selection + playing-handicap editing out of `CourseEditorScreen` into a dedicated "Tees & Handicaps" wizard step (and an equivalent section when editing a tournament), leaving `CourseEditorScreen` course-only.

**Architecture:** Extract the existing per-player tee-chip picker + handicap-editing logic from `CourseEditorScreen` into one reusable component, `RoundTeeAssignments`. Host it in a new wizard step and in `EditTournamentScreen`'s round cards. `CourseEditorScreen` keeps only holes + the `TeesEditor`. No data-model change.

**Tech Stack:** React Native (Expo), Jest. JavaScript, no TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-19-tee-handicap-step-design.md`

**Working directory:** All work happens in the worktree `/Users/marcospecker/Documents/golf-partner-tees` on branch `feature/tee-handicap-step`. Do not switch branches; do not touch `/Users/marcospecker/Documents/golf-partner`.

**Note on tooling:** `npm run lint` is broken repo-wide (ESLint 9, no `eslint.config.js`) — do NOT use it. Use `node --check <file>` for syntax and `npm test` for regression.

---

## Data shapes

```js
// A round object carries (among other fields):
Round = { courseId, courseName, holes, tees,
          playerTees:      { [playerId]: { label, slope, rating } },
          playerHandicaps: { [playerId]: number },
          manualHandicaps: { [playerId]: true } }

// RoundTeeAssignments emits, via onChange:
{ playerTees, playerHandicaps, manualHandicaps }   // playerHandicaps values are numbers

// CourseEditorScreen onSave patch (after this plan):
onSave(roundIndex, { holes, tees })
```

---

## Task 1: `RoundTeeAssignments` component

**Files:**
- Create: `src/components/RoundTeeAssignments.js`

A controlled-ish component owning the per-player tee + playing-handicap UI for **one round**. Internal state is seeded from the `round` prop on mount, resolved (default tees), and emitted via `onChange`. Hosts must give it `key={round.id}` so it remounts per round.

- [ ] **Step 1: Create the component**

Create `src/components/RoundTeeAssignments.js`:

```js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { calcPlayingHandicap, lastTeeForPlayerOnCourse } from '../store/tournamentStore';
import { middleTee } from '../store/tees';

// Per-round, per-player tee picker + playing-handicap editor.
//
// Props:
//   round    - { courseId, tees, holes, playerTees, playerHandicaps, manualHandicaps }
//   players  - [{ id, name, handicap }]   (handicap = base index)
//   onChange - (patch) => void, patch = { playerTees, playerHandicaps, manualHandicaps }
//              playerHandicaps values are numbers.
//   theme    - theme object
//
// Hosts MUST pass key={round.id} (and, where base indexes can change, fold a
// base-index signature into the key) so the component remounts and re-resolves.
export default function RoundTeeAssignments({ round, players = [], onChange, theme }) {
  const s = makeStyles(theme);
  const tees = round?.tees ?? [];
  const holes = round?.holes ?? [];
  const courseId = round?.courseId ?? null;
  const totalPar = holes.reduce((sum, h) => sum + (h.par || 0), 0);

  // playerTees: { [playerId]: { label, slope, rating } }
  const [playerTees, setPlayerTees] = useState(() => ({ ...(round?.playerTees ?? {}) }));
  // playerHandicaps: { [playerId]: string } — editable
  const [playerHandicaps, setPlayerHandicaps] = useState(() => {
    const init = {};
    players.forEach((p) => {
      const existing = round?.playerHandicaps?.[p.id];
      init[p.id] = existing != null ? String(existing) : String(p.handicap);
    });
    return init;
  });
  const [manualHandicaps, setManualHandicaps] = useState(
    () => ({ ...(round?.manualHandicaps ?? {}) }),
  );

  const isFirstRender = useRef(true);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // On mount: ensure every player has a tee (last-used on this course, else
  // the middle tee), then align non-manual playing handicaps to each tee.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = { ...playerTees };
      for (const p of players) {
        if (resolved[p.id]) continue;
        let tee = null;
        if (courseId) {
          try { tee = await lastTeeForPlayerOnCourse(courseId, p.id); } catch (_) {}
        }
        if (!tee) {
          const mid = middleTee(tees);
          if (mid) tee = { label: mid.label, slope: mid.slope, rating: mid.rating };
        }
        if (tee) resolved[p.id] = tee;
      }
      if (cancelled) return;
      setPlayerTees(resolved);
      setPlayerHandicaps((prev) => {
        const next = { ...prev };
        let changed = false;
        players.forEach((p) => {
          if (manualHandicaps[p.id]) return;
          const tee = resolved[p.id];
          const auto = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
          if (next[p.id] !== auto) { next[p.id] = auto; changed = true; }
        });
        return changed ? next : prev;
      });
    })();
    return () => { cancelled = true; };
    // Run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit changes to the host (skip the initial render).
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const parsedHandicaps = {};
    players.forEach((p) => { parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0; });
    onChangeRef.current({
      playerTees,
      playerHandicaps: parsedHandicaps,
      manualHandicaps,
    });
  }, [playerTees, playerHandicaps, manualHandicaps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute non-manual handicaps from each player's current tee.
  function recomputeAuto(nextPlayerTees, manual) {
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        if (manual[p.id]) return;
        const tee = nextPlayerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  // Assign a tee to one player and refresh their auto handicap.
  function setPlayerTee(playerId, tee) {
    const snapshot = { label: tee.label, slope: tee.slope, rating: tee.rating };
    const next = { ...playerTees, [playerId]: snapshot };
    setPlayerTees(next);
    recomputeAuto(next, manualHandicaps);
  }

  // Explicit "Reset all to auto": clear manual overrides, recompute from tees.
  function resetAllToAuto() {
    setManualHandicaps({});
    setPlayerHandicaps(() => {
      const next = {};
      players.forEach((p) => {
        const tee = playerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  if (players.length === 0) {
    return <Text style={s.emptyText}>Add players first.</Text>;
  }

  return (
    <View>
      {tees.length > 0 && (
        <Text style={s.hint}>Auto-calculated from each player's tee — tap a handicap to override.</Text>
      )}
      {Object.values(manualHandicaps).some(Boolean) && (
        <TouchableOpacity style={s.resetBtn} onPress={resetAllToAuto} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel="Reset all handicaps to auto">
          <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.resetBtnText}>Reset all to auto</Text>
        </TouchableOpacity>
      )}
      {players.map((p) => {
        const pTee = playerTees[p.id];
        const auto = pTee
          ? calcPlayingHandicap(p.handicap, pTee.slope, pTee.rating, totalPar)
          : null;
        const current = parseInt(playerHandicaps[p.id], 10);
        const isDifferent = auto !== null && current !== auto;
        return (
          <View key={p.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{p.name}</Text>
              <View style={s.teeChips}>
                {tees.length === 0 && (
                  <Text style={s.noTeeText}>No tees on this course</Text>
                )}
                {tees.map((tee) => {
                  const selected = playerTees[p.id]?.label === tee.label;
                  return (
                    <TouchableOpacity
                      key={tee.id ?? tee.label}
                      style={[s.teeChip, selected && s.teeChipActive]}
                      onPress={() => setPlayerTee(p.id, tee)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name} tee ${tee.label || 'unnamed'}`}
                    >
                      <Text style={[s.teeChipText, selected && s.teeChipTextActive]}>
                        {tee.label || '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <Text style={s.index}>Index {p.handicap}</Text>
            {auto !== null && (
              <Feather name="arrow-right" size={14} color={theme.text.muted} style={{ marginRight: 8 }} />
            )}
            <TextInput
              style={[s.hcpInput, isDifferent && s.hcpInputOverride]}
              keyboardType="numeric"
              maxLength={2}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={playerHandicaps[p.id] ?? ''}
              onChangeText={(v) => {
                setPlayerHandicaps((prev) => ({ ...prev, [p.id]: v }));
                setManualHandicaps((prev) => ({ ...prev, [p.id]: true }));
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  emptyText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13 },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 12, marginBottom: 10 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 8,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10,
  },
  resetBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  name: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  index: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 13, marginRight: 8 },
  teeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  teeChip: {
    backgroundColor: theme.bg.secondary, borderRadius: 7, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 9, paddingVertical: 4,
  },
  teeChipActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  teeChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
  teeChipTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 12 },
  noTeeText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    width: 50, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 6,
  },
  hcpInputOverride: { backgroundColor: theme.accent.light, borderColor: theme.accent.primary },
});
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/marcospecker/Documents/golf-partner-tees && node --check src/components/RoundTeeAssignments.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Run the test suite (no regression)**

Run: `npm test`
Expected: all suites pass (the component has no unit test — its logic is glue over the already-tested `calcPlayingHandicap`/`middleTee`/`lastTeeForPlayerOnCourse`; it is verified via integration + manual smoke).

- [ ] **Step 4: Commit**

```bash
cd /Users/marcospecker/Documents/golf-partner-tees
git add src/components/RoundTeeAssignments.js
git commit -m "feat: RoundTeeAssignments component (per-round tee + handicap)"
```

---

## Task 2: `setupWizard.js` — add the `'tees'` step

**Files:**
- Modify: `src/screens/setupWizard.js`
- Test: `src/screens/__tests__/setupWizard.test.js`

New step order: course → players → tees → (scoring) → review.

- [ ] **Step 1: Update the `wizardSteps` tests**

READ `src/screens/__tests__/setupWizard.test.js` first. It has existing `wizardSteps` assertions for the OLD order (`['players', 'course', ...]`). Update every existing `wizardSteps` assertion to the new order, and add the new cases. The complete set of expected results:

```js
// game
expect(wizardSteps('game', 1)).toEqual(['course', 'players', 'tees', 'review']);
expect(wizardSteps('game', 2)).toEqual(['course', 'players', 'tees', 'scoring', 'review']);
// tournament
expect(wizardSteps('tournament', 1)).toEqual(['rounds', 'players', 'tees', 'review']);
expect(wizardSteps('tournament', 4)).toEqual(['rounds', 'players', 'tees', 'scoring', 'review']);
// official — unchanged
expect(wizardSteps('official', 4)).toEqual(['roster', 'rounds', 'format', 'review']);
```

Add an `isStepValid` assertion for the new step:
```js
expect(isStepValid('tees', { players: [], rounds: [] })).toBe(true);
```

Adjust any existing assertion whose expected array used the old order so it matches the new order above. Do not delete unrelated tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- setupWizard.test.js`
Expected: FAIL — the updated `wizardSteps` assertions don't match the current (old-order) implementation.

- [ ] **Step 3: Update `wizardSteps`**

In `src/screens/setupWizard.js`, replace the `wizardSteps` function body. The current body builds `['players', courseStep]`; change it to course-first, then players, then `'tees'`:

```js
export function wizardSteps(kind, playerCount) {
  if (kind === 'official') {
    return ['roster', 'rounds', 'format', 'review'];
  }
  const courseStep = kind === 'tournament' ? 'rounds' : 'course';
  const steps = [courseStep, 'players', 'tees'];
  if (playerCount >= 2) steps.push('scoring');
  steps.push('review');
  return steps;
}
```

- [ ] **Step 4: Update `isStepValid`**

In the same file, add `'tees'` to the always-valid case in `isStepValid`. Change:
```js
    case 'scoring':
    case 'review':
      return true;
```
to:
```js
    case 'tees':
    case 'scoring':
    case 'review':
      return true;
```

Also update the doc comment at the top of the file if it describes the step sequence, so it stays accurate (mention the `tees` step depends on course + players).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- setupWizard.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/marcospecker/Documents/golf-partner-tees
git add src/screens/setupWizard.js src/screens/__tests__/setupWizard.test.js
git commit -m "feat: add 'tees' wizard step, course-first ordering"
```

---

## Task 3: `CourseEditorScreen` becomes course-only

**Files:**
- Modify: `src/screens/CourseEditorScreen.js`

Strip everything per-player; keep holes + `TeesEditor`. READ the current file first.

- [ ] **Step 1: Trim imports and route params**

Change the imports — remove `calcPlayingHandicap`, `lastTeeForPlayerOnCourse`, and `middleTee` (no longer used). Keep `updateCourseFromEditor` and `TeesEditor`. The store/component import lines become:
```js
import { useTheme } from '../theme/ThemeContext';
import { updateCourseFromEditor } from '../store/libraryStore';
import TeesEditor from '../components/TeesEditor';
```
(Keep the React / react-native / ScreenContainer / Feather imports as they are.)

Change the `route.params` destructure to drop the per-player params:
```js
  const {
    roundIndex, courseName,
    initialHoles, initialTees,
    courseId,
    onSave,
  } = route.params;
```

- [ ] **Step 2: Remove per-player state, effects, and functions**

Delete these entirely:
- The `playerTees` `useState` (and its comment).
- The `playerHandicaps` `useState` (and its comment).
- The `manualHandicaps` `useState`.
- The mount `useEffect` that resolves tees / aligns handicaps (the one commented "On mount: ensure every player has a tee…").
- The functions `recomputeAuto`, `setPlayerTee`, `resetAllToAuto`.

Keep: the `holes` and `tees` `useState`, and the `isFirstRender` / `onSaveRef` refs.

- [ ] **Step 3: Slim the `onSave` effect**

Replace the `onSave` `useEffect` with:
```js
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    onSaveRef.current(roundIndex, { holes, tees });
  }, [holes, tees]);
```

- [ ] **Step 4: Remove the "Playing Handicaps" JSX block**

Delete the entire `{players.length > 0 && ( <View style={s.hcpSection}> … </View> )}` block (the per-player playing-handicaps section). Leave `<TeesEditor … />` and the Holes section in place.

- [ ] **Step 5: Remove now-unused styles**

From `makeStyles`, delete the style entries only used by the removed block: `hcpSection`, `hcpHint`, `hcpRow`, `hcpName`, `hcpIndex`, `hcpInput`, `hcpInputOverride`, `resetBtn`, `resetBtnText`, `teeChips`, `teeChip`, `teeChipActive`, `teeChipText`, `teeChipTextActive`, `noTeeText`. Keep `sectionTitle` (still used by the Holes section — verify with grep before deleting anything: only delete a style with zero remaining references).

- [ ] **Step 6: Verify**

Run: `cd /Users/marcospecker/Documents/golf-partner-tees && node --check src/screens/CourseEditorScreen.js`
Run: `grep -nE 'players|playerTees|playerHandicaps|manualHandicaps|calcPlayingHandicap|lastTeeForPlayerOnCourse|middleTee' src/screens/CourseEditorScreen.js`
Expected: syntax OK; grep returns NOTHING (all per-player references gone).
Run: `npm test` — expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/marcospecker/Documents/golf-partner-tees
git add src/screens/CourseEditorScreen.js
git commit -m "refactor: CourseEditorScreen is course-only (holes + tees)"
```

---

## Task 4: `SetupScreen` — render the `'tees'` step

**Files:**
- Modify: `src/screens/SetupScreen.js`

READ the current file first. The wizard step *sequence* already comes from `wizardSteps` (Task 2) — this task adds the `'tees'` step's rendering and trims the CourseEditor wiring.

- [ ] **Step 1: Import `RoundTeeAssignments`**

Add near the other component imports:
```js
import RoundTeeAssignments from '../components/RoundTeeAssignments';
```

- [ ] **Step 2: Add a round-patch handler for the new step**

Add this `useCallback` next to `handleHolesSaved`:
```js
  const handleRoundTeesChange = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerTees: patch.playerTees,
        playerHandicaps: patch.playerHandicaps,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);
```

- [ ] **Step 3: Slim `handleHolesSaved` to holes + tees only**

`CourseEditorScreen.onSave` now sends only `{ holes, tees }`. Replace `handleHolesSaved` with:
```js
  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes: patch.holes, tees: patch.tees };
      return next;
    });
  }, []);
```

- [ ] **Step 4: Trim the CourseEditor navigation params**

In `renderCourseStep`, the `navigation.navigate('CourseEditor', { … })` call passes per-player params that CourseEditor no longer accepts. Replace its params object with:
```jsx
                    navigation.navigate('CourseEditor', {
                      roundIndex: i,
                      courseName: r.courseName || `Round ${i + 1}`,
                      initialHoles: r.holes,
                      initialTees: r.tees ?? [],
                      onSave: handleHolesSaved,
                      courseId: r.courseId ?? null,
                    })
```
(Removes `initialPlayerHandicaps`, `initialManualHandicaps`, `initialPlayerTees`, `players`.)

- [ ] **Step 5: Add `renderTeesStep`**

Add a `renderTeesStep` function next to `renderScoringStep`. It renders one `RoundTeeAssignments` per round:
```jsx
  const renderTeesStep = () => (
    <>
      <Text style={s.stepOverline}>TEES & HANDICAPS</Text>
      <Text style={s.stepPrompt}>Who plays from where?</Text>
      <Text style={s.stepSubtitle}>
        Pick each player's tee. Playing handicaps auto-calculate — tap one to override.
      </Text>
      {rounds.map((r, i) => (
        <View key={r.id ?? `round-${i}`} style={s.teesRoundBlock}>
          {!isGame && <Text style={s.roundLabel}>Round {i + 1}</Text>}
          <View style={s.teesRoundCard}>
            <RoundTeeAssignments
              round={r}
              players={players}
              theme={theme}
              onChange={(patch) => handleRoundTeesChange(i, patch)}
            />
          </View>
        </View>
      ))}
    </>
  );
```
Note: no `key`-remount fiddling is needed here — the whole step unmounts/remounts as the user navigates between wizard steps, so each `RoundTeeAssignments` re-resolves on entry. `roundLabel` is an existing style (used in `renderCourseStep`); reuse it.

- [ ] **Step 6: Wire the step into the render switch**

In the `ScrollView`, add a line next to the other `stepKey ===` lines:
```jsx
        {stepKey === 'tees' && renderTeesStep()}
```

- [ ] **Step 7: Add the two new styles**

In `makeStyles`, add:
```js
    teesRoundBlock: { marginBottom: 16 },
    teesRoundCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
```

- [ ] **Step 8: Verify**

Run: `cd /Users/marcospecker/Documents/golf-partner-tees && node --check src/screens/SetupScreen.js`
Run: `npm test -- setupWizard.test.js` — expected: pass.
Run: `npm test` — expected: all pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/marcospecker/Documents/golf-partner-tees
git add src/screens/SetupScreen.js
git commit -m "feat: Tees & Handicaps wizard step in SetupScreen"
```

---

## Task 5: `EditTournamentScreen` — use `RoundTeeAssignments`

**Files:**
- Modify: `src/screens/EditTournamentScreen.js`

READ the current file first. Each round card currently renders a plain per-player handicap row list (`players.map` → `s.hcpRow`) and opens `CourseEditor` with per-player params. Replace the row list with `RoundTeeAssignments`, and trim CourseEditor wiring.

- [ ] **Step 1: Import `RoundTeeAssignments`**

Add near the other component imports:
```js
import RoundTeeAssignments from '../components/RoundTeeAssignments';
```

- [ ] **Step 2: Add a round-patch handler**

Add next to `handleHolesSaved`:
```js
  const handleRoundTeesChange = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        playerTees: patch.playerTees,
        playerHandicaps: patch.playerHandicaps,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);
```

- [ ] **Step 3: Slim `handleHolesSaved` to holes + tees only**

Replace `handleHolesSaved` with:
```js
  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes: patch.holes, tees: patch.tees };
      return next;
    });
  }, []);
```

- [ ] **Step 4: Replace the per-player handicap rows with `RoundTeeAssignments`**

In the `rounds.map((r, ri) => …)` round card, find the `{players.map((p) => ( <View key={p.id} style={s.hcpRow}> … </View> ))}` block (the per-player playing-handicap inputs). Replace that entire `players.map(...)` block with:
```jsx
              <RoundTeeAssignments
                key={`${r.id}:${players.map((p) => p.handicap).join(',')}`}
                round={r}
                players={players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 }))}
                theme={theme}
                onChange={(patch) => handleRoundTeesChange(ri, patch)}
              />
```
The `key` folds in a base-index signature: editing a player's base index (in the "Handicap Index" section) remounts every `RoundTeeAssignments`, which re-resolves non-manual playing handicaps from the new index.

- [ ] **Step 5: Simplify `updateBaseHandicap`**

`updateBaseHandicap` currently also patches every round's `playerHandicaps`. That re-derivation is now handled by the keyed remount in Step 4. Replace `updateBaseHandicap` with a version that only updates the `players` state:
```js
  function updateBaseHandicap(playerIndex, value) {
    setPlayers((prev) => {
      const next = [...prev];
      next[playerIndex] = { ...next[playerIndex], handicap: value };
      return next;
    });
  }
```

- [ ] **Step 6: Remove `updatePlayingHandicap` and unused imports**

Delete the `updatePlayingHandicap` function (the per-round handicap setter — `RoundTeeAssignments` now owns that). Then check `deriveRoundPlayingHandicap`: run `grep -n 'deriveRoundPlayingHandicap' src/screens/EditTournamentScreen.js` — if it is no longer referenced anywhere, remove it from the `'../store/tournamentStore'` import. If it is still used, leave the import.

- [ ] **Step 7: Trim the CourseEditor navigation params**

Replace the `navigation.navigate('CourseEditor', { … })` params object with:
```jsx
                  navigation.navigate('CourseEditor', {
                    roundIndex: ri,
                    courseName: r.courseName,
                    initialHoles: r.holes,
                    initialTees: r.tees ?? [],
                    onSave: handleHolesSaved,
                    courseId: r.courseId ?? null,
                  })
```
(Removes `initialPlayerHandicaps`, `initialManualHandicaps`, `initialPlayerTees`, `players`.)

- [ ] **Step 8: Check `builtRounds` / save handles numeric handicaps**

`RoundTeeAssignments` emits `playerHandicaps` as numbers. Find `builtRounds` (the `rounds.map` in the save path) and the save logic; confirm they pass `playerHandicaps` through without assuming strings. If any code does string-specific handling of `r.playerHandicaps` values (e.g. a `.trim()` or `parseInt` that would now be redundant — redundant `parseInt` on a number is harmless and may stay), adjust only what would actually break on a number. Report what you found. Then remove any now-unused styles (`hcpRow`, `hcpRowName`, `hcpInput`, `hcpLabel`) — only after `grep` confirms each has zero remaining references.

- [ ] **Step 9: Verify**

Run: `cd /Users/marcospecker/Documents/golf-partner-tees && node --check src/screens/EditTournamentScreen.js`
Run: `grep -nE 'updatePlayingHandicap|initialPlayerHandicaps|initialPlayerTees' src/screens/EditTournamentScreen.js` — expected: NOTHING.
Run: `npm test` — expected: all pass.

- [ ] **Step 10: Commit**

```bash
cd /Users/marcospecker/Documents/golf-partner-tees
git add src/screens/EditTournamentScreen.js
git commit -m "feat: per-round tee/handicap section in EditTournamentScreen"
```

---

## Task 6: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `cd /Users/marcospecker/Documents/golf-partner-tees && npm test`
Expected: all suites pass.

- [ ] **Step 2: Web bundle build**

Run: `npm run build:web`
Expected: `Exported: dist` with no errors — confirms every modified screen/component compiles and integrates.

- [ ] **Step 3: Manual smoke test**

Run: `npm run web`. Verify:
1. New game: wizard order is **Course → Players → Tees & Handicaps → Scoring → Review**. The Tees & Handicaps step lists the round with each player's tee chips + editable handicap.
2. Picking a tee updates that player's auto handicap; editing a handicap marks it overridden; "Reset all to auto" appears and works.
3. "Configure holes" opens `CourseEditor` — it shows only holes + the Tees editor, no per-player section.
4. Tournament (3 rounds): the Tees & Handicaps step shows all 3 rounds.
5. Edit an existing tournament: each round card shows the tee/handicap section; editing a base index in "Handicap Index" updates non-manual playing handicaps.
6. Start a game and confirm the leaderboard handicaps reflect the chosen tees.

- [ ] **Step 4: Commit any fixes**

If the smoke test surfaced issues, fix them with focused commits referencing the task they belong to.

---

## Self-review notes

- **Spec coverage:** `RoundTeeAssignments` component (Task 1); new `'tees'` step + course-first order (Task 2); `CourseEditorScreen` course-only (Task 3); wizard step rendering (Task 4); `EditTournamentScreen` integration (Task 5); regression (Task 6).
- **`onSave` shape:** `CourseEditorScreen` emits `{ holes, tees }` (Task 3); consumed identically by `handleHolesSaved` in Task 4 and Task 5.
- **`onChange` shape:** `RoundTeeAssignments` emits `{ playerTees, playerHandicaps, manualHandicaps }` with numeric `playerHandicaps` (Task 1); consumed identically by `handleRoundTeesChange` in Tasks 4 and 5.
- **Step ordering:** the sequence lives only in `wizardSteps` (Task 2); `SetupScreen`'s render switch is order-independent (Task 4).
- **Edit-screen base-index reactivity:** handled by the base-index signature in the `RoundTeeAssignments` key (Task 5 Step 4), which is why `updateBaseHandicap` no longer patches rounds (Task 5 Step 5).
