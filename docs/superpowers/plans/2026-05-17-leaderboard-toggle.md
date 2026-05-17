# Generalized Leaderboard Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HomeScreen LEADERBOARD card's view toggle mode-aware — per-mode labels, shown for every mode, with a new "Stroke Play" alternate for Stableford modes.

**Architecture:** A pure `leaderboardToggleLabels(mode)` helper in `scoringModes.js` provides the two toggle labels per mode. `HomeScreen` renames `leaderboardBestBall` → `leaderboardAlt` (a generic show-alternate boolean), selects the displayed board from `(mode, leaderboardAlt)`, adds a Stroke-Play re-sort of the Stableford board for Stableford modes, and renders each row's prominent value per the active view.

**Tech Stack:** React Native 0.81, Expo 54, jest + jest-expo. No React Native Testing Library — the pure helper is TDD'd; UI is verified by the jest suite staying green plus a manual + Playwright checklist.

**Spec:** `docs/superpowers/specs/2026-05-17-leaderboard-toggle-design.md`

---

## File Structure

- **`src/components/scoringModes.js`** (modify) — add the pure `leaderboardToggleLabels` helper.
- **`src/components/__tests__/scoringModes.test.js`** (modify) — tests for it.
- **`src/screens/HomeScreen.js`** (modify) — rename `leaderboardBestBall` → `leaderboardAlt`; generalize the toggle, board selection, and row rendering.

---

## Task 1: `leaderboardToggleLabels` helper

**Files:**
- Modify: `src/components/scoringModes.js`
- Test: `src/components/__tests__/scoringModes.test.js`

- [ ] **Step 1: Write the failing tests**

Add `leaderboardToggleLabels` to the test file's existing `import { ... } from '../scoringModes';` block. Append this describe block to `src/components/__tests__/scoringModes.test.js`:

```js
describe('leaderboardToggleLabels', () => {
  test('Stableford modes get Stableford / Stroke Play', () => {
    expect(leaderboardToggleLabels('individual')).toEqual({ left: 'Stableford', right: 'Stroke Play' });
    expect(leaderboardToggleLabels('stableford')).toEqual({ left: 'Stableford', right: 'Stroke Play' });
  });
  test('Match Play gets Match Play / Stableford', () => {
    expect(leaderboardToggleLabels('matchplay')).toEqual({ left: 'Match Play', right: 'Stableford' });
  });
  test('Sindicato gets Sindicato / Stableford', () => {
    expect(leaderboardToggleLabels('sindicato')).toEqual({ left: 'Sindicato', right: 'Stableford' });
  });
  test('Best Ball gets Best Ball / Stableford', () => {
    expect(leaderboardToggleLabels('bestball')).toEqual({ left: 'Best Ball', right: 'Stableford' });
  });
  test('unknown mode falls back to Stableford / Stroke Play', () => {
    expect(leaderboardToggleLabels('nope')).toEqual({ left: 'Stableford', right: 'Stroke Play' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest scoringModes -t "leaderboardToggleLabels" --verbose`
Expected: FAIL — `leaderboardToggleLabels` is not exported.

- [ ] **Step 3: Implement**

In `src/components/scoringModes.js`, append after the existing `scoringModeUsesTeams` function (or anywhere after `SCORING_MODES`):

```js
// The two labels for the LEADERBOARD card's view toggle, per scoring mode.
// `left` is the mode's native view (the default), `right` is the alternate.
// Stableford-scored modes (individual, stableford) toggle to Stroke Play;
// every other mode toggles to Stableford.
export function leaderboardToggleLabels(scoringMode) {
  if (scoringMode === 'matchplay') return { left: 'Match Play', right: 'Stableford' };
  if (scoringMode === 'sindicato') return { left: 'Sindicato', right: 'Stableford' };
  if (scoringMode === 'bestball') return { left: 'Best Ball', right: 'Stableford' };
  return { left: 'Stableford', right: 'Stroke Play' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest scoringModes --verbose`
Expected: PASS — the full `scoringModes.test.js` suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/scoringModes.js src/components/__tests__/scoringModes.test.js
git commit -m "feat: leaderboardToggleLabels helper"
```

---

## Task 2: Generalize the LEADERBOARD toggle in HomeScreen

**Files:**
- Modify: `src/screens/HomeScreen.js`

No unit test (RN UI) — verified by the jest suite staying green plus a Playwright/manual checklist. Read each target region before editing to confirm it matches; if a region has diverged, STOP and report BLOCKED.

- [ ] **Step 1: Import `leaderboardToggleLabels`**

`HomeScreen.js` imports from `'../components/scoringModes'` (e.g. `import { scoringModeUsesTeams } from '../components/scoringModes';`). Add `leaderboardToggleLabels` to that import (or add a new import line if there is no existing one):
```js
import { scoringModeUsesTeams, leaderboardToggleLabels } from '../components/scoringModes';
```
(Match the actual existing import — just ensure `leaderboardToggleLabels` is imported from `'../components/scoringModes'`.)

- [ ] **Step 2: Rename the state**

Find:
```js
  const [leaderboardBestBall, setLeaderboardBestBall] = useState(false);
```
Replace with:
```js
  const [leaderboardAlt, setLeaderboardAlt] = useState(false);
```

- [ ] **Step 3: Replace the toggle-sync effect**

Find this effect:
```js
  useEffect(() => {
    if (!bestBallAvailable) {
      setLeaderboardBestBall(false);
      return;
    }
    const isBB = settings.scoringMode === 'bestball';
    setLeaderboardBestBall(isBB);
  }, [tournament?.id, settings.scoringMode, bestBallAvailable]);
```
Replace it with (every mode now defaults to its native view — toggle off):
```js
  useEffect(() => {
    setLeaderboardAlt(false);
  }, [tournament?.id, settings.scoringMode]);
```

- [ ] **Step 4: Remove `bestBallAvailable` if now unused**

Find `const bestBallAvailable = (tournament?.players?.length ?? 0) >= 4;`. After Steps 3 and 9, grep `bestBallAvailable` across the file. If it has no remaining references, delete that line. If it is still referenced elsewhere, keep it. Report which.

- [ ] **Step 5: Make `leaderboard` the native board for every mode**

Find the `leaderboard` memo:
```js
  const leaderboard = useMemo(
    () => {
      if (!tournament) return [];
      if (settings.scoringMode === 'matchplay') return matchPlayStandings?.board ?? [];
      if (settings.scoringMode === 'sindicato') return tournamentSindicatoLeaderboard(tournament);
      return tournamentLeaderboard(tournament);
    },
    [tournament, settings.scoringMode, matchPlayStandings],
  );
```
Replace it with (add the `bestball` native board; also add `stablefordBoard` for the alternate view):
```js
  const leaderboard = useMemo(
    () => {
      if (!tournament) return [];
      if (settings.scoringMode === 'matchplay') return matchPlayStandings?.board ?? [];
      if (settings.scoringMode === 'sindicato') return tournamentSindicatoLeaderboard(tournament);
      if (settings.scoringMode === 'bestball') return tournamentBestWorstLeaderboard(tournament);
      return tournamentLeaderboard(tournament);
    },
    [tournament, settings.scoringMode, matchPlayStandings],
  );
  // The Stableford board — native view for Stableford modes, alternate view
  // for every other mode, and the source of per-player gross strokes.
  const stablefordBoard = useMemo(
    () => (tournament ? tournamentLeaderboard(tournament) : []),
    [tournament],
  );
```

- [ ] **Step 6: Replace the `bestWorstLeaderboard` memo with a `displayedBoard` memo**

Find the `bestWorstLeaderboard` memo:
```js
  const bestWorstLeaderboard = useMemo(
    () => (tournament && leaderboardBestBall ? tournamentBestWorstLeaderboard(tournament) : null),
    [tournament, leaderboardBestBall],
  );
```
Replace it with (the toggled board selection — `tournamentBestWorstLeaderboard` is now reached via the `leaderboard` memo from Step 5, so this dedicated memo is no longer needed):
```js
  // Stableford modes: native = Stableford (points), alternate = Stroke Play
  // (gross strokes ascending, unplayed/0-stroke players last). Other modes:
  // native = the mode board, alternate = Stableford.
  const isStablefordMode = settings.scoringMode === 'individual'
    || settings.scoringMode === 'stableford';
  const displayedBoard = useMemo(() => {
    if (!leaderboardAlt) return leaderboard;
    if (isStablefordMode) {
      return [...stablefordBoard].sort(
        (a, b) => (a.strokes || Infinity) - (b.strokes || Infinity));
    }
    return stablefordBoard;
  }, [leaderboardAlt, isStablefordMode, leaderboard, stablefordBoard]);
  const isStrokePlayView = leaderboardAlt && isStablefordMode;
```

- [ ] **Step 7: Fix the remaining `leaderboardBestBall` references**

`leaderboardBestBall` no longer exists. Update each remaining reference:

(7a) The OLD inline `const displayedBoard = leaderboardBestBall && bestWorstLeaderboard ? bestWorstLeaderboard : leaderboard;` line — DELETE it (Step 6's memo now defines `displayedBoard`).

(7b) `strokesByPlayer` currently reads:
```js
  const strokesByPlayer = Object.fromEntries(leaderboard.map((e) => [e.player.id, e.strokes]));
```
Change its source to `stablefordBoard` (always per-player gross strokes, every mode):
```js
  const strokesByPlayer = Object.fromEntries(stablefordBoard.map((e) => [e.player.id, e.strokes]));
```

(7c) `selectedRoundPlayerTotals` memo — its first line is:
```js
    if (!tournament || !selectedRoundData || !selectedRoundHasScores || leaderboardBestBall) return null;
```
Replace `leaderboardBestBall` with the bestball-native-view predicate:
```js
    if (!tournament || !selectedRoundData || !selectedRoundHasScores
      || (settings.scoringMode === 'bestball' && !leaderboardAlt)) return null;
```
And in that memo's dependency array, replace `leaderboardBestBall` with `leaderboardAlt`.

(7d) `selectedRoundBB` memo currently reads:
```js
  const selectedRoundBB = useMemo(
    () => (tournament && selectedRoundData && selectedRoundHasScores && leaderboardBestBall && selectedRoundData.pairs?.length
      ? calcBestWorstBall(selectedRoundData, tournament.players)
      : null),
    [tournament, selectedRoundData, selectedRoundHasScores, leaderboardBestBall],
  );
```
Replace `leaderboardBestBall` (both the condition and the dep array) with the bestball-native-view predicate:
```js
  const selectedRoundBB = useMemo(
    () => (tournament && selectedRoundData && selectedRoundHasScores
      && settings.scoringMode === 'bestball' && !leaderboardAlt && selectedRoundData.pairs?.length
      ? calcBestWorstBall(selectedRoundData, tournament.players)
      : null),
    [tournament, selectedRoundData, selectedRoundHasScores, settings.scoringMode, leaderboardAlt],
  );
```

(7e) In `getSelectedRoundValue`, find:
```js
    if (leaderboardBestBall) {
```
Replace with:
```js
    if (settings.scoringMode === 'bestball' && !leaderboardAlt) {
```

After this step, `grep -n "leaderboardBestBall\|bestWorstLeaderboard" src/screens/HomeScreen.js` must return NO matches. If any remain, fix them.

- [ ] **Step 8: Compute the toggle labels**

Near the other derived values in the component body (anywhere before the `return (`), add:
```js
  const toggleLabels = leaderboardToggleLabels(settings.scoringMode);
```

- [ ] **Step 9: Replace the toggle JSX**

In the LEADERBOARD card's title row, find:
```js
          {bestBallAvailable && (
            <View style={s.inlineToggle}>
              <Text style={[s.mastersToggleLabel, !leaderboardBestBall && s.mastersToggleLabelActive]}>Stableford</Text>
              <Switch
                value={leaderboardBestBall}
                onValueChange={setLeaderboardBestBall}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: 'rgba(255,215,0,0.4)' }}
                thumbColor="#fff"
              />
              <Text style={[s.mastersToggleLabel, leaderboardBestBall && s.mastersToggleLabelActive]}>Best Ball</Text>
            </View>
          )}
```
Replace it with (no `bestBallAvailable` gate — the toggle shows for every mode whenever the card renders):
```js
          <View style={s.inlineToggle}>
            <Text style={[s.mastersToggleLabel, !leaderboardAlt && s.mastersToggleLabelActive]}>{toggleLabels.left}</Text>
            <Switch
              value={leaderboardAlt}
              onValueChange={setLeaderboardAlt}
              trackColor={{ false: 'rgba(255,255,255,0.2)', true: 'rgba(255,215,0,0.4)' }}
              thumbColor="#fff"
            />
            <Text style={[s.mastersToggleLabel, leaderboardAlt && s.mastersToggleLabelActive]}>{toggleLabels.right}</Text>
          </View>
```

- [ ] **Step 10: Make the row's prominent value follow the active view**

In the `displayedBoard.map((entry, i) => { ... })` row, find the prominent-value `Text` and the sub `Text`:
```js
              <Text style={[s.mastersPoints, i === 0 && { fontSize: 18 }]}>{
                !showRunning ? '—'
                  : settings.scoringMode === 'matchplay'
                    ? `${entry.points} ${entry.points === 1 ? 'hole' : 'holes'}`
                    : `${entry.points} pts`
              }</Text>
              <Text style={s.mastersSub}>{showRunning ? `${strokes || '-'} str` : ''}</Text>
```
Replace both with (Stroke Play view shows gross strokes prominently with points as the sub; Match Play's *native* view shows holes; everything else shows points):
```js
              <Text style={[s.mastersPoints, i === 0 && { fontSize: 18 }]}>{
                !showRunning ? '—'
                  : isStrokePlayView
                    ? `${strokesByPlayer[entry.player.id] || '-'} str`
                    : settings.scoringMode === 'matchplay' && !leaderboardAlt
                      ? `${entry.points} ${entry.points === 1 ? 'hole' : 'holes'}`
                      : `${entry.points} pts`
              }</Text>
              <Text style={s.mastersSub}>{
                !showRunning ? ''
                  : isStrokePlayView ? `${entry.points} pts` : `${strokes || '-'} str`
              }</Text>
```
(`strokes` is the existing `const strokes = strokesByPlayer[entry.player.id] ?? 0;` already declared inside the map callback — leave that line as-is.)

- [ ] **Step 11: Verify**

Run: `npx jest`
Expected: PASS — full suite green (no test imports `HomeScreen.js`).

Run: `grep -n "leaderboardBestBall\|bestWorstLeaderboard" src/screens/HomeScreen.js`
Expected: no matches.

- [ ] **Step 12: Manual / Playwright verification**

Start the app (or use the running web build). For a tournament/game in each mode (2+ players):
- The LEADERBOARD card shows the toggle with the correct two labels: Stableford → `Stableford / Stroke Play`; Match Play → `Match Play / Stableford`; Sindicato → `Sindicato / Stableford`; Best Ball → `Best Ball / Stableford`.
- The toggle defaults to the left (native) view.
- Flipping the toggle swaps the board: a Stableford game's right side ranks players by gross strokes, lowest first, with strokes shown as the prominent number and points as the sub; a Sindicato/Match Play/Best Ball game's right side shows the Stableford ranking.
- Best Ball's per-round sub-line still shows best/worst points when on the native (Best Ball) side.
- Verified in light and dark mode.

- [ ] **Step 13: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: mode-aware LEADERBOARD toggle with Stroke Play view"
```

---

## Self-Review Notes

- **Spec coverage:** `leaderboardToggleLabels` per-mode labels (Task 1) ✓; toggle shown for every mode, no `bestBallAvailable` gate (Task 2 Step 9) ✓; `leaderboardBestBall` → `leaderboardAlt`, defaults to native, sync effect simplified (Steps 2–3) ✓; native/alternate board selection per `(mode, leaderboardAlt)` incl. Stroke Play gross-stroke re-sort with 0-stroke players last (Steps 5–6) ✓; row prominent value follows the active view — strokes for Stroke Play, holes for Match Play native, else points (Step 10) ✓; `selectedRoundBB`/`selectedRoundPlayerTotals`/`getSelectedRoundValue` predicates updated for Best Ball now being the *native* (toggle-off) view (Step 7) ✓; leaderboard still 2+ players only (untouched) ✓.
- **Type consistency:** `leaderboardToggleLabels(mode)` → `{ left: string, right: string }`. `leaderboardAlt` is a boolean; `false` = native, `true` = alternate, everywhere. `displayedBoard` entries are `{ player, points, strokes }` for every board source. `strokesByPlayer` is derived from `stablefordBoard` and keyed by `player.id`.
- **No placeholders:** every code step contains complete, runnable code.
