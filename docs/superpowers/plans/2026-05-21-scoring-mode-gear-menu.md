# Scoring Mode in Gear Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the scoring-mode control out of the Edit Tournament/Round screen and make it a direct "Scoring Mode" item in the Tournament-view gear settings menu.

**Architecture:** A new "Scoring Mode" row in the existing `HomeScreen` settings bottom-sheet opens a new bottom-sheet `Modal` that hosts the existing `ScoringModeField` component (mode list + Best Ball point inputs). Saving persists via the established `saveTournament` + `reload` path. The pure save-time normalization is extracted into a unit-tested helper, `mergeScoringSettings`, in `scoringModes.js`. The old "Scoring Mode" section is removed from `EditTournamentScreen`.

**Tech Stack:** React Native 0.81 / Expo SDK 54, React 19, `@expo/vector-icons` (Feather), Jest (jest-expo). Plain JS store modules. ESLint 9 flat config.

---

## Spec

Full design: `docs/superpowers/specs/2026-05-21-scoring-mode-gear-menu-design.md`

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/components/scoringModes.js` | Pure scoring-mode data + helpers (no React) | Add `mergeScoringSettings` helper |
| `src/components/__tests__/scoringModes.test.js` | Unit tests for the above | Add `mergeScoringSettings` tests |
| `src/screens/HomeScreen.js` | Tournament/round-info view | Add menu item, sheet `Modal`, draft state, save handler |
| `src/screens/EditTournamentScreen.js` | Edit Tournament/Round screen | Remove the "Scoring Mode" section; narrow import |

**Note on testing strategy:** This codebase unit-tests pure logic modules (e.g. `setupWizard.js`, `scoreModel.js`, `scoringModes.js`) but does not render screens/components in Jest. Accordingly, Task 1 is full TDD on the pure helper; the screen-wiring tasks (2 and 3) are verified by `npm run lint` plus a manual smoke test — consistent with how the rest of the codebase treats screen UI.

---

## Task 1: Add the `mergeScoringSettings` pure helper

**Files:**
- Modify: `src/components/scoringModes.js`
- Test: `src/components/__tests__/scoringModes.test.js`

`mergeScoringSettings(currentSettings, draft)` takes the tournament's current
`settings` object and a scoring-mode draft (the mode key plus Best Ball point
values, which the picker holds as **strings** because its inputs are
`TextInput`s) and returns a new settings object with the mode applied and the
Best Ball values coerced to positive integers. This is exactly the
normalization `EditTournamentScreen` does today at save time
(`parseInt(value, 10) || 1`).

- [ ] **Step 1: Write the failing tests**

Open `src/components/__tests__/scoringModes.test.js`. Add `mergeScoringSettings`
to the existing import from `'../scoringModes'` (the file already imports other
helpers from that path). Then append this `describe` block to the end of the
file:

```js
describe('mergeScoringSettings', () => {
  test('applies the chosen mode and preserves unrelated settings', () => {
    const result = mergeScoringSettings(
      { scoringMode: 'individual', startDate: '2026-05-21' },
      { scoringMode: 'matchplay', bestBallValue: '1', worstBallValue: '1' },
    );
    expect(result).toEqual({
      scoringMode: 'matchplay',
      startDate: '2026-05-21',
      bestBallValue: 1,
      worstBallValue: 1,
    });
  });

  test('coerces string Best Ball point values to integers', () => {
    const result = mergeScoringSettings(
      { scoringMode: 'individual' },
      { scoringMode: 'bestball', bestBallValue: '3', worstBallValue: '2' },
    );
    expect(result.bestBallValue).toBe(3);
    expect(result.worstBallValue).toBe(2);
  });

  test('falls back to 1 for empty or non-numeric Best Ball values', () => {
    const result = mergeScoringSettings(
      {},
      { scoringMode: 'bestball', bestBallValue: '', worstBallValue: 'abc' },
    );
    expect(result.bestBallValue).toBe(1);
    expect(result.worstBallValue).toBe(1);
  });

  test('falls back to 1 when a Best Ball value is zero', () => {
    const result = mergeScoringSettings(
      {},
      { scoringMode: 'bestball', bestBallValue: '0', worstBallValue: '0' },
    );
    expect(result.bestBallValue).toBe(1);
    expect(result.worstBallValue).toBe(1);
  });

  test('accepts already-numeric Best Ball values', () => {
    const result = mergeScoringSettings(
      {},
      { scoringMode: 'bestball', bestBallValue: 4, worstBallValue: 5 },
    );
    expect(result.bestBallValue).toBe(4);
    expect(result.worstBallValue).toBe(5);
  });

  test('tolerates a missing current settings object', () => {
    const result = mergeScoringSettings(undefined, {
      scoringMode: 'sindicato', bestBallValue: '1', worstBallValue: '1',
    });
    expect(result.scoringMode).toBe('sindicato');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/components/__tests__/scoringModes.test.js`
Expected: FAIL — `mergeScoringSettings is not a function` (or `not defined`).

- [ ] **Step 3: Implement the helper**

In `src/components/scoringModes.js`, append this function to the end of the
file (after `fallbackNoticeText`):

```js
// Merges a scoring-mode draft back into a tournament's settings object.
// The draft carries the mode key plus Best Ball point values, which the
// picker holds as strings (its inputs are TextInputs); this coerces them to
// positive integers, defaulting to 1 — the same normalization the Edit
// Tournament screen has always applied at save time.
export function mergeScoringSettings(currentSettings, draft) {
  return {
    ...(currentSettings ?? {}),
    scoringMode: draft.scoringMode,
    bestBallValue: parseInt(draft.bestBallValue, 10) || 1,
    worstBallValue: parseInt(draft.worstBallValue, 10) || 1,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/components/__tests__/scoringModes.test.js`
Expected: PASS — all `mergeScoringSettings` tests green, no existing tests broken.

- [ ] **Step 5: Commit**

```bash
git add src/components/scoringModes.js src/components/__tests__/scoringModes.test.js
git commit -m "feat: add mergeScoringSettings helper for scoring-mode persistence"
```

---

## Task 2: Wire the Scoring Mode sheet and gear menu item into HomeScreen

**Files:**
- Modify: `src/screens/HomeScreen.js`

This task adds: (a) two imports, (b) two pieces of state, (c) a save handler,
(d) a new "Scoring Mode" row in the settings bottom-sheet, (e) the new Scoring
Mode `Modal`. Line numbers shift as you edit — locate each anchor by its
text, not by line number.

- [ ] **Step 1: Add the imports**

In `src/screens/HomeScreen.js`, find this line:

```js
import { scoringModeUsesTeams, leaderboardToggleLabels, isScoringModeAllowed, fallbackScoringMode, getScoringMode } from '../components/scoringModes';
```

Add `mergeScoringSettings` to it:

```js
import { scoringModeUsesTeams, leaderboardToggleLabels, isScoringModeAllowed, fallbackScoringMode, getScoringMode, mergeScoringSettings } from '../components/scoringModes';
```

Then find the next line:

```js
import ScoringModeChangeSheet from '../components/ScoringModeChangeSheet';
```

Add a new import directly below it:

```js
import ScoringModeField from '../components/ScoringModePicker';
```

(`ScoringModeField` is the default export of `ScoringModePicker.js` — it
renders the mode list and, when Best Ball is selected, the
`bestBallValue` / `worstBallValue` inputs.)

- [ ] **Step 2: Add the state**

Find this existing state line:

```js
  const [showSettings, setShowSettings] = useState(false);
```

Add two new state declarations directly below it:

```js
  const [showScoringModeSheet, setShowScoringModeSheet] = useState(false);
  // Draft scoring settings while the sheet is open. Best Ball values are held
  // as strings because ScoringModeField edits them through TextInputs. null
  // until the sheet is opened.
  const [scoringDraft, setScoringDraft] = useState(null);
```

- [ ] **Step 3: Add the save handler**

Find the existing `setTournamentFinished` function. Directly **above** it
(`  async function setTournamentFinished(t, finished) {`), insert this new
function:

```js
  // Persist the scoring-mode draft. saveTournament writes the whole tournament
  // blob (the established settings-save path); reload() refreshes local state.
  async function saveScoringMode() {
    if (!tournament || !scoringDraft) return;
    try {
      const updated = {
        ...tournament,
        settings: mergeScoringSettings(tournament.settings, scoringDraft),
      };
      await saveTournament(updated);
      await reload();
      setShowScoringModeSheet(false);
    } catch (err) {
      const msg = err?.message ?? 'Could not update scoring mode';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }
```

- [ ] **Step 4: Add the "Scoring Mode" menu item**

In the settings bottom-sheet `Modal`, find the "Edit Tournament / Edit Round"
menu item — it is the `{!isViewer && (` block whose `onPress` calls
`navigation.navigate('EditTournament')`:

```jsx
          {!isViewer && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); navigation.navigate('EditTournament'); }}
              activeOpacity={0.7}
            >
              <Feather name="edit-3" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>{tournament.rounds.length === 1 ? 'Edit Round' : 'Edit Tournament'}</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
```

Insert this new block **immediately above** it:

```jsx
          {!isViewer && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                setShowSettings(false);
                setScoringDraft({
                  scoringMode: tournament.settings?.scoringMode ?? 'stableford',
                  bestBallValue: String(tournament.settings?.bestBallValue ?? 1),
                  worstBallValue: String(tournament.settings?.worstBallValue ?? 1),
                });
                setShowScoringModeSheet(true);
              }}
              activeOpacity={0.7}
            >
              <Feather name="sliders" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>Scoring Mode</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
```

- [ ] **Step 5: Add the Scoring Mode sheet Modal**

Find the closing `</Modal>` of the settings bottom-sheet — it is the
`</Modal>` immediately followed by a line containing `<ConfirmModal`. Insert
this new `Modal` directly **after** that `</Modal>` and **before** the
`<ConfirmModal ... />` line:

```jsx
      <Modal
        visible={showScoringModeSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowScoringModeSheet(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setShowScoringModeSheet(false)}>
          <Pressable style={s.modalSheet} onPress={() => {}}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Scoring Mode</Text>
            {scoringDraft && (
              <>
                <ScoringModeField
                  value={scoringDraft.scoringMode}
                  onChange={(mode) => setScoringDraft((d) => ({ ...d, scoringMode: mode }))}
                  playerCount={tournament.players.length}
                  settings={scoringDraft}
                  onSettingsChange={(next) => setScoringDraft(next)}
                />
                <View style={[s.confirmActions, { marginTop: 16 }]}>
                  <TouchableOpacity
                    style={[s.confirmBtn, s.confirmBtnCancel]}
                    onPress={() => setShowScoringModeSheet(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.confirmBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.confirmBtn, s.confirmBtnPrimary]}
                    onPress={saveScoringMode}
                    activeOpacity={0.7}
                  >
                    <Text style={s.confirmBtnPrimaryText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
```

All style keys used here (`modalBackdrop`, `modalSheet`, `modalHandle`,
`modalTitle`, `confirmActions`, `confirmBtn`, `confirmBtnCancel`,
`confirmBtnCancelText`, `confirmBtnPrimary`, `confirmBtnPrimaryText`) already
exist in `HomeScreen`'s `makeStyles` — no new styles are needed. `Modal`,
`Pressable`, `View`, `Text`, `TouchableOpacity`, `Feather`, `Alert`, and
`Platform` are already imported in this file.

- [ ] **Step 6: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors. Pre-existing warnings are acceptable; there
must be **zero** new errors or warnings attributable to `HomeScreen.js`.

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: add Scoring Mode item to the tournament gear menu"
```

---

## Task 3: Remove the Scoring Mode section from EditTournamentScreen

**Files:**
- Modify: `src/screens/EditTournamentScreen.js`

The scoring mode is now changed via the gear menu, so the inline section in the
Edit screen is removed. The validation effect that keeps `settings.scoringMode`
valid when the player count changes is **kept**, so the named helpers stay
imported — only the default `ScoringModePicker` import is dropped.

- [ ] **Step 1: Narrow the import**

In `src/screens/EditTournamentScreen.js`, find this line:

```js
import ScoringModePicker, { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';
```

Replace it with (dropping the default `ScoringModePicker`, keeping the named
helpers used by the validation effect):

```js
import { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';
```

- [ ] **Step 2: Remove the "Scoring Mode" section**

Find this block (the last child before the screen's closing `</ScrollView>`):

```jsx
        <View>
          <Text style={s.sectionTitle}>Scoring Mode</Text>
          <ScoringModePicker
            value={settings.scoringMode}
            onChange={(mode) => setSettings((sv) => ({ ...sv, scoringMode: mode }))}
            playerCount={players.length}
            settings={settings}
            onSettingsChange={(next) => setSettings(next)}
          />
        </View>
```

Delete the entire block. Do **not** touch the `<View>` block above it (the
"Add Round" button) or the `</ScrollView>` below it.

Leave everything else unchanged — in particular **keep**:
- The scoring-mode validation effect (`if (!isScoringModeAllowed(settings.scoringMode, players.length)) { setSettings(... fallbackScoringMode(players.length) ...) }`).
- The Best Ball string conversion at load and the `parseInt(..., 10) || 1`
  conversion in `handleSave` — the Edit screen still passes `settings` through
  untouched.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: PASS — no new errors. Specifically, no "unused variable" or
"undefined" error for `ScoringModePicker` (the default import is gone) and no
new warnings for `EditTournamentScreen.js`.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests green (the suite includes the new
`mergeScoringSettings` tests from Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/screens/EditTournamentScreen.js
git commit -m "refactor: remove Scoring Mode section from Edit Tournament screen"
```

---

## Manual Verification

After all three tasks are committed, run the app (`npm run web` or
`npm run android`) and verify against an existing multi-round tournament/game:

1. **Open the gear menu** on the Tournament (round-info) view as an editor/owner
   → a "Scoring Mode" row appears, just above "Edit Tournament/Edit Round".
2. **Tap "Scoring Mode"** → the gear sheet closes and the Scoring Mode
   bottom-sheet opens, preselecting the current mode.
3. **Pick a different mode** valid for the player count → tap **Save** → the
   sheet closes; the leaderboard and scorecard reflect the new mode.
4. **Reopen and select Best Ball** (with a 4-player game) → the
   `bestBallValue` / `worstBallValue` inputs appear; edit them, Save, reopen →
   the edited values persist.
5. **Open the sheet, change something, tap Cancel** → no change is persisted.
6. **As a viewer** (a shared tournament opened with a viewer invite) → the
   "Scoring Mode" row is **absent** from the gear menu.
7. **Open Edit Tournament/Round** → there is no longer a "Scoring Mode"
   section; saving the screen still works without error.

---

## Self-Review Notes

- **Spec coverage:** Gear menu item (Task 2 Step 4), bottom-sheet with full
  picker incl. Best Ball inputs (Task 2 Step 5), `saveTournament`+`reload`
  persistence (Task 2 Step 3 + `mergeScoringSettings` Task 1), removal from
  Edit screen with import narrowed and validation effect kept (Task 3) — all
  spec sections map to a task.
- **Naming consistency:** `mergeScoringSettings`, `scoringDraft`,
  `showScoringModeSheet`, `saveScoringMode`, `ScoringModeField` are used
  identically across every task.
- **No placeholders:** every code step shows complete code; every command
  shows expected output.
