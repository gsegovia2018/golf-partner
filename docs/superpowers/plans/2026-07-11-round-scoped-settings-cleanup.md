# Round-Scoped Settings Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tournament gear sheet's tournament-wide scoring-mode picker with round-scoped behavior plus a Team Settings sheet, make best/worst ball point values per-round, switch the round-card trigger to a gear icon, and fix the round pager showing the wrong round's card after a re-layout.

**Architecture:** A `roundBestBallValues(tournament, round)` helper (mirroring `roundScoringMode`) becomes the single resolution point for point values; two new mutations (`round.setBestBallValues`, `tournament.setTeamSettings`) carry per-path LWW stamps; HomeScreen's gear sheet swaps the old picker for a Team Settings sheet reusing the already-exported `TeamsSettingsFields`; the pager fix re-asserts scroll position on the pager ScrollView's own `onLayout`.

**Tech Stack:** Expo/React Native (plain JS), Jest (jest-expo), @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-07-11-round-scoped-settings-cleanup-design.md`

## Global Constraints

- Copy/icons: gear entry "Team Settings" (icon `users`); round sheet item "Point Values" (icon `hash`); button "Edit Pairs"; round-card trigger icon becomes `settings` (label stays "Round options"); single-round gear keeps "Scoring Mode".
- Helper: `roundBestBallValues(tournament, round)` → `{ bestBallValue, worstBallValue }`; round override → settings → 1; only positive integers count as present.
- Mutations: `round.setBestBallValues { roundId, bestBallValue, worstBallValue }` stamps `rounds.<id>.bestBallValue` + `rounds.<id>.worstBallValue`; `tournament.setTeamSettings { fixedTeams, manualTeams }` stamps `settings.fixedTeams` + `settings.manualTeams`.
- The 6e0e580 pager regression tests (`HomeScreen.roundPager.test.js`) must stay green.
- `npx jest src/` and `npm run lint` green; ignore failures from `.claude/worktrees/` or `.worktrees/` copies.
- Work in a git worktree on branch `feature/round-scoped-settings` (controller sets it up; node_modules symlinked).

---

### Task 1: `roundBestBallValues` helper (TDD)

**Files:**
- Modify: `src/store/scoring.js` (append directly after `roundScoringMode`, which ends at line 320)
- Test: Create `src/store/__tests__/roundBestBallValues.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function roundBestBallValues(tournament, round)` → `{ bestBallValue: number, worstBallValue: number }`. Tasks 3–5 import it from `../store/scoring` / `./scoring`.

- [ ] **Step 1: Write the failing tests**

```js
import { roundBestBallValues } from '../scoring';

describe('roundBestBallValues', () => {
  const tournament = { settings: { bestBallValue: 2, worstBallValue: 3 } };

  test('round overrides win over tournament settings', () => {
    const round = { bestBallValue: 5, worstBallValue: 4 };
    expect(roundBestBallValues(tournament, round)).toEqual({ bestBallValue: 5, worstBallValue: 4 });
  });

  test('missing round values fall back to settings', () => {
    expect(roundBestBallValues(tournament, {})).toEqual({ bestBallValue: 2, worstBallValue: 3 });
  });

  test('each value falls back independently', () => {
    expect(roundBestBallValues(tournament, { bestBallValue: 7 }))
      .toEqual({ bestBallValue: 7, worstBallValue: 3 });
  });

  test('no settings at all defaults to 1', () => {
    expect(roundBestBallValues({}, {})).toEqual({ bestBallValue: 1, worstBallValue: 1 });
    expect(roundBestBallValues(null, null)).toEqual({ bestBallValue: 1, worstBallValue: 1 });
  });

  test('non-positive, fractional, or string values do not count as present', () => {
    const round = { bestBallValue: 0, worstBallValue: '4' };
    expect(roundBestBallValues(tournament, round)).toEqual({ bestBallValue: 2, worstBallValue: 3 });
    expect(roundBestBallValues({ settings: { bestBallValue: 1.5 } }, {}))
      .toEqual({ bestBallValue: 1, worstBallValue: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/roundBestBallValues.test.js`
Expected: FAIL — `roundBestBallValues is not a function`.

- [ ] **Step 3: Implement**

Append to `src/store/scoring.js` right after `roundScoringMode`:

```js
// A round may override the tournament's best/worst ball point values. Same
// single-source-of-truth pattern as roundScoringMode above — every best-ball
// points consumer resolves values here instead of reading settings directly.
// Only positive integers count as present; anything else falls through to
// the tournament settings, then 1, so legacy data renders unchanged.
export function roundBestBallValues(tournament, round) {
  const num = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  const s = tournament?.settings ?? {};
  return {
    bestBallValue: num(round?.bestBallValue) ?? num(s.bestBallValue) ?? 1,
    worstBallValue: num(round?.worstBallValue) ?? num(s.worstBallValue) ?? 1,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/roundBestBallValues.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/roundBestBallValues.test.js
git commit -m "feat(scoring): roundBestBallValues resolves per-round point values"
```

---

### Task 2: `round.setBestBallValues` + `tournament.setTeamSettings` mutations (TDD)

**Files:**
- Modify: `src/store/mutate.js` (two `metaPathFor` cases near `round.setScoringMode` at lines 18-19; two `applyToTournament` cases near `round.setScoringMode` at lines 155-164)
- Test: Create `src/store/__tests__/roundValuesAndTeamSettingsMutations.test.js`

**Interfaces:**
- Consumes: existing exported `metaPathFor(m)` and `applyToTournament(t, m)` (see `src/store/__tests__/pairsSetMutation.test.js` for the harness pattern).
- Produces: mutation types `'round.setBestBallValues'` and `'tournament.setTeamSettings'` dispatched via `mutate()` by Tasks 4–5.

- [ ] **Step 1: Write the failing tests**

```js
import { applyToTournament, metaPathFor } from '../mutate';

describe('round.setBestBallValues mutation', () => {
  test('stamps both per-round value paths', () => {
    expect(metaPathFor({ type: 'round.setBestBallValues', roundId: 'r1' }))
      .toEqual(['rounds.r1.bestBallValue', 'rounds.r1.worstBallValue']);
  });

  test('sets both values on the target round only', () => {
    const t = { rounds: [{ id: 'r1' }, { id: 'r2' }] };
    applyToTournament(t, {
      type: 'round.setBestBallValues', roundId: 'r2', bestBallValue: 3, worstBallValue: 2,
    });
    expect(t.rounds[1].bestBallValue).toBe(3);
    expect(t.rounds[1].worstBallValue).toBe(2);
    expect(t.rounds[0].bestBallValue).toBeUndefined();
  });

  test('unknown round is a no-op', () => {
    const t = { rounds: [{ id: 'r1' }] };
    applyToTournament(t, {
      type: 'round.setBestBallValues', roundId: 'nope', bestBallValue: 3, worstBallValue: 2,
    });
    expect(t.rounds[0].bestBallValue).toBeUndefined();
  });
});

describe('tournament.setTeamSettings mutation', () => {
  test('stamps both settings paths', () => {
    expect(metaPathFor({ type: 'tournament.setTeamSettings' }))
      .toEqual(['settings.fixedTeams', 'settings.manualTeams']);
  });

  test('merges booleans into settings without touching other keys', () => {
    const t = { settings: { scoringMode: 'bestball', bestBallValue: 2 } };
    applyToTournament(t, { type: 'tournament.setTeamSettings', fixedTeams: true, manualTeams: false });
    expect(t.settings).toEqual({
      scoringMode: 'bestball', bestBallValue: 2, fixedTeams: true, manualTeams: false,
    });
  });

  test('coerces truthy/falsy inputs to booleans and tolerates missing settings', () => {
    const t = {};
    applyToTournament(t, { type: 'tournament.setTeamSettings', fixedTeams: 1, manualTeams: undefined });
    expect(t.settings).toEqual({ fixedTeams: true, manualTeams: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/roundValuesAndTeamSettingsMutations.test.js`
Expected: FAIL — `metaPathFor` returns `null` and `applyToTournament` leaves objects untouched for unknown types.

- [ ] **Step 3: Implement**

In `metaPathFor`'s switch, after the `round.setScoringMode` case (line 18-19):

```js
    // Per-round best/worst ball point value overrides. Two scalar LWW paths.
    case 'round.setBestBallValues':
      return [`rounds.${m.roundId}.bestBallValue`, `rounds.${m.roundId}.worstBallValue`];
    // Tournament-wide team behavior (fixed teams / manual teams). Edited from
    // the gear Team Settings sheet; each toggle is its own LWW path.
    case 'tournament.setTeamSettings':
      return ['settings.fixedTeams', 'settings.manualTeams'];
```

In `applyToTournament`'s switch, after the `round.setScoringMode` case (lines 155-164):

```js
    case 'round.setBestBallValues': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      round.bestBallValue = m.bestBallValue;
      round.worstBallValue = m.worstBallValue;
      break;
    }
    case 'tournament.setTeamSettings': {
      t.settings = {
        ...(t.settings ?? {}),
        fixedTeams: Boolean(m.fixedTeams),
        manualTeams: Boolean(m.manualTeams),
      };
      break;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/roundValuesAndTeamSettingsMutations.test.js`
Expected: PASS (6 tests). Also run `npx jest src/store/` — no regressions in the other mutation/merge suites.

- [ ] **Step 5: Commit**

```bash
git add src/store/mutate.js src/store/__tests__/roundValuesAndTeamSettingsMutations.test.js
git commit -m "feat(mutate): round.setBestBallValues and tournament.setTeamSettings mutations"
```

---

### Task 3: Best-ball scoring consumes per-round values (TDD)

**Files:**
- Modify: `src/store/tournamentStore.js` (`tournamentBestWorstLeaderboard` lines 1201-1228; `tournamentPlayerClinched` bestball branch lines 1299-1330)
- Modify: `src/screens/ScorecardScreen.js` (settings memo lines 826-829; `roundPairClinched` calls at lines 1089 and 1099)
- Modify: `src/screens/HomeScreen.js` (`playerRoundBestWorstPoints` call at line 1508; import at line 46)
- Test: Create `src/store/__tests__/roundBestBallValuesScoring.test.js`

**Interfaces:**
- Consumes: `roundBestBallValues(tournament, round)` from Task 1.
- Produces: no new API. `playerRoundBestWorstPoints`, `roundPairClinched`, `roundMaxRemainingBestBall`, `calcBestWorstBall` keep their signatures — callers now pass EFFECTIVE settings (merged with the round's values); the two tournament-level loops resolve per round internally.

- [ ] **Step 1: Write the failing test**

```js
import { tournamentBestWorstLeaderboard } from '../tournamentStore';

// One hole; handicaps 0. a scores 3 (stableford 3), everyone else 5
// (stableford 1): pair1 [a,b] wins BEST via a, WORST is halved (1 vs 1).
// So per round: a gets bestWon=1 → bestBallValue points; nobody gets worst points.
const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
const players = [
  { id: 'a', name: 'A', handicap: 0 }, { id: 'b', name: 'B', handicap: 0 },
  { id: 'c', name: 'C', handicap: 0 }, { id: 'd', name: 'D', handicap: 0 },
];
const mkRound = (id, extra = {}) => ({
  id, holes,
  pairs: [[players[0], players[1]], [players[2], players[3]]],
  playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
  scores: { a: { 1: 3 }, b: { 1: 5 }, c: { 1: 5 }, d: { 1: 5 } },
  ...extra,
});

test('per-round bestBallValue override scales only its own round', () => {
  const tournament = {
    players,
    currentRound: 1,
    settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 },
    rounds: [
      mkRound('r0'),
      mkRound('r1', { bestBallValue: 5 }),
    ],
  };
  const board = tournamentBestWorstLeaderboard(tournament);
  const a = board.find((row) => row.player.id === 'a');
  // r0: 1 best win × 1 pt; r1: 1 best win × 5 pts.
  expect(a.points).toBe(6);
  expect(a.bestWins).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/roundBestBallValuesScoring.test.js`
Expected: FAIL — `a.points` is 2 (both rounds scaled by the tournament-level value of 1).

If the fixture itself errors (e.g. `getPlayingHandicap` needs more round fields), mirror the round shape used in `src/store/__tests__/bestWorstRoles.test.js` and adjust the fixture — not the assertion.

- [ ] **Step 3: Implement**

In `src/store/tournamentStore.js`:

1. `roundBestBallValues` is exported from `./scoring` — add it to the existing import from `./scoring` at the top of the file (the one that already carries `roundScoringMode`).

2. `tournamentBestWorstLeaderboard` (lines 1201-1228): delete the top-level
   `const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };`
   (line 1203; `settings` then becomes unused in the destructure on line 1202 — reduce it to `const { players, rounds } = tournament;`) and resolve per round inside the loop:

```js
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament) || !round.pairs?.length) return;
    if (roundScoringMode(tournament, round) !== 'bestball') return;
    const { bestBallValue, worstBallValue } = roundBestBallValues(tournament, round);
    const roles = assignBestWorstRoles(round, players);
    ...unchanged body...
  });
```

3. `tournamentPlayerClinched` (lines 1299-1330): delete the function-level
   `const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };`
   and `const bbCap = bestBallValue + worstBallValue;` (lines 1310-1311). Inside its `rounds.forEach`, resolve the cap per round at the top of the bestball branch:

```js
    if (mode === 'bestball') {
      const { bestBallValue, worstBallValue } = roundBestBallValues(tournament, round);
      const bbCap = bestBallValue + worstBallValue;
      ...existing branch body unchanged...
```

   Read the whole function first: every use of `bbCap` / `bestBallValue` / `worstBallValue` in the loop body must use the per-round resolution (there are uses below line 1320 for partially-scored rounds — move them all under the per-round consts). If `settings` becomes unused in the function's destructure, remove it there too.

4. `src/screens/ScorecardScreen.js`: import `roundBestBallValues` alongside the existing `roundScoringMode` import from `'../store/scoring'` (line 48), then make the settings memo per-round-effective (the scorecard shows exactly one round, so merging here feeds GridView, `summaryState`, and the live match strip for free):

```js
  const settings = useMemo(
    () => ({
      ...DEFAULT_SETTINGS,
      ...(tournament?.settings ?? {}),
      ...(tournament && round ? roundBestBallValues(tournament, round) : {}),
    }),
    [tournament, round],
  );
```

   And switch the two clinch calls at lines 1089 and 1099 from `tournament.settings` to the memoized `settings`.

5. `src/screens/HomeScreen.js`: add `roundBestBallValues` to the import from `'../store/scoring'` (line 46) and change line 1508 to:

```js
      return playerRoundBestWorstPoints(
        selectedRoundData, playerId, tournament.players,
        { ...settings, ...roundBestBallValues(tournament, selectedRoundData) },
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/roundBestBallValuesScoring.test.js` then `npx jest src/`
Expected: new test PASS; full src suite green (the scorecard scoreModel/GridView suites exercise the settings flow).

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js src/screens/ScorecardScreen.js src/screens/HomeScreen.js src/store/__tests__/roundBestBallValuesScoring.test.js
git commit -m "feat(scoring): best/worst ball points resolve per-round values"
```

---

### Task 4: Gear sheet — Team Settings replaces tournament-wide Scoring Mode

**Files:**
- Modify: `src/screens/HomeScreen.js`:
  - imports: line 14 (drop `mergeScoringSettings` if now unused), line 15 (`import ScoringModeField, { ScoringModeSheet } from ...` → `import { ScoringModeSheet, TeamsSettingsFields } from ...`), line 34 (drop `setScoringModeRoundPatches`)
  - state: lines 152-156 (`showScoringModeSheet`, `scoringDraft` removed; add `showTeamSettings`)
  - delete `saveScoringMode` (the function containing lines 785-823)
  - gear entry lines 2058-2078 (replace)
  - `showScoringModeSheet` BottomSheet block starting line 2143 (replace with Team Settings sheet)
- Modify test mocks: `src/screens/__tests__/HomeScreen.roundPager.test.js` lines 93-97, and any other HomeScreen test that mocks `../../components/ScoringModePicker` (grep for it) — the mock must export `TeamsSettingsFields: () => null` and may drop `default`.

**Interfaces:**
- Consumes: `TeamsSettingsFields({ value, playerCount, settings, onSettingsChange })` (already exported from `src/components/ScoringModePicker.js:94` — it self-hides unless `scoringModeUsesTeams(value, playerCount)`); `tournament.setTeamSettings` mutation from Task 2; existing `mutate`, `reload`, `roundScoringMode`, `scoringModeUsesTeams`, `getScoringMode`, `saveRoundScoringMode`, `setShowRoundModeSheet`.
- Produces: gear sheet entries that Task 5 appends to (single-round Point Values item sits beside the single-round Scoring Mode entry).

- [ ] **Step 1: Remove the tournament-wide picker plumbing**

Delete: the `showScoringModeSheet` + `scoringDraft` state (lines 152-156), the whole `saveScoringMode` function (async function containing lines 785-823), the gear "Scoring Mode" entry (lines 2058-2078), and the `showScoringModeSheet` BottomSheet (the block starting at line 2143 through its closing `</BottomSheet>`). Update imports per the Files list; keep `getScoringMode` (still used by the per-round sheet subtitle at line 1950) and keep `mergeScoringSettings` ONLY if grep still finds a use in this file (expected: none — remove it).

- [ ] **Step 2: Add the derivation + save handler**

Near the other plain derivations after the `settings` memo (around line 900), add:

```js
  // The mode that decides whether team settings apply: the first round whose
  // effective mode is a team mode the roster supports. Null → no team rounds,
  // the gear hides Team Settings entirely.
  const teamSettingsMode = tournament
    ? ((tournament.rounds ?? [])
        .map((r) => roundScoringMode(tournament, r))
        .find((m) => scoringModeUsesTeams(m, tournament.players.length)) ?? null)
    : null;
```

Next to `saveRoundScoringMode`, add:

```js
  // Persist the gear sheet's team toggles. Tournament-wide by design —
  // fixedTeams/manualTeams shape how EVERY round builds its pairs. No eager
  // pair rebuilds: pairsForNextRound applies fixedTeams lazily at reveal.
  async function saveTeamSettings(next) {
    if (!tournament) return;
    try {
      await mutate(tournament, {
        type: 'tournament.setTeamSettings',
        fixedTeams: Boolean(next.fixedTeams),
        manualTeams: Boolean(next.manualTeams),
      });
      await reload();
    } catch (err) {
      const msg = err?.message ?? 'Could not update team settings';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }
```

Add state next to the other sheet booleans: `const [showTeamSettings, setShowTeamSettings] = useState(false);`

- [ ] **Step 3: New gear entries**

Where the old entry was (after the "Players" item, before "Edit Tournament"):

```jsx
          {/* Scoring mode is round-scoped. Single-round games have no
              per-round sheet, so the round-scoped picker surfaces here;
              multi-round tournaments edit each round from its own sheet. */}
          {!isViewer && tournament.rounds.length === 1 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); setShowRoundModeSheet(true); }}
              activeOpacity={0.7}
            >
              <Feather name="flag" size={18} color={theme.accent.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.menuItemText}>Scoring Mode</Text>
                <Text style={s.modalSubtle}>
                  {getScoringMode(roundScoringMode(tournament, tournament.rounds[0])).label}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}

          {!isViewer && teamSettingsMode && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowSettings(false); setShowTeamSettings(true); }}
              activeOpacity={0.7}
            >
              <Feather name="users" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>Team Settings</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
```

Note: the round-scoped `ScoringModeSheet` at line 1961 and `saveRoundScoringMode` already work for single-round tournaments (`selectedRound` is 0) — no extra wiring.

- [ ] **Step 4: Team Settings sheet**

Where the old picker BottomSheet was:

```jsx
    <BottomSheet visible={showTeamSettings} onClose={() => setShowTeamSettings(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Team Settings</Text>
          <TeamsSettingsFields
            value={teamSettingsMode}
            playerCount={tournament.players.length}
            settings={{
              fixedTeams: Boolean(tournament.settings?.fixedTeams),
              manualTeams: Boolean(tournament.settings?.manualTeams),
            }}
            onSettingsChange={saveTeamSettings}
          />
          {Boolean(tournament.settings?.fixedTeams) && tournament.rounds[0]?.pairs?.length === 2 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setShowTeamSettings(false); navigation.navigate('EditTeams', { roundIndex: 0 }); }}
              activeOpacity={0.7}
            >
              <Feather name="edit-2" size={18} color={theme.accent.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.menuItemText}>Edit Pairs</Text>
                <Text style={s.modalSubtle}>{pairsPreviewText(tournament)}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
    </BottomSheet>
```

Toggles save immediately via `saveTeamSettings` (no confirm step — matches the other sheets). Add the preview helper above the component (module scope, next to other module helpers):

```js
// "Marcos + Noé vs Guille + Alex" — the tournament's fixed pairs, first
// names only, read from round 1 (fixedTeams keeps them identical everywhere).
function pairsPreviewText(t) {
  const pairs = t?.rounds?.[0]?.pairs ?? [];
  if (pairs.length !== 2) return '';
  const firstName = (p) => {
    const live = t.players?.find((x) => x.id === p.id);
    return ((live ?? p)?.name ?? '').split(' ')[0];
  };
  return pairs.map((pr) => pr.map(firstName).join(' + ')).join(' vs ');
}
```

Editing pairs from here targets `roundIndex: 0` deliberately: EditTeams' fixed-teams save propagates to all LATER rounds, so round 0 covers the whole tournament.

- [ ] **Step 5: Update HomeScreen test mocks**

`grep -rn "components/ScoringModePicker" src/screens/__tests__/` — in each mock (e.g. `HomeScreen.roundPager.test.js:93-97`), make it:

```js
jest.mock('../../components/ScoringModePicker', () => ({
  __esModule: true,
  ScoringModeSheet: () => null,
  TeamsSettingsFields: () => null,
}));
```

(Keep `default: () => null` in any test whose subject still imports the default — HomeScreen no longer does.)

- [ ] **Step 6: Run the suite and lint**

Run: `npx jest src/screens/ && npx jest src/ 2>&1 | tail -4` then `npm run lint`
Expected: all green; no unused-import lint errors in HomeScreen.

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.js src/screens/__tests__/
git commit -m "feat(home): gear sheet gains Team Settings; tournament-wide mode picker removed"
```

---

### Task 5: Per-round "Point Values" item + sheet

**Files:**
- Modify: `src/components/ScoringModePicker.js` (extract the bestball value inputs, lines 216-245, into an exported `BestBallValueFields`)
- Modify: `src/screens/HomeScreen.js` (new menu item renderer + sheet + save handler; render in the Round N modal after the Scoring Mode item at line ~1954, and in the gear next to the single-round Scoring Mode entry from Task 4)

**Interfaces:**
- Consumes: `roundBestBallValues` (Task 1), `round.setBestBallValues` mutation (Task 2), `mutate`/`reload`.
- Produces: `export function BestBallValueFields({ settings, onSettingsChange })` in ScoringModePicker.js — renders the two "pts / hole" inputs; `settings` carries string `bestBallValue`/`worstBallValue` (TextInput values).

- [ ] **Step 1: Extract `BestBallValueFields`**

In `src/components/ScoringModePicker.js`, lift the `value === 'bestball' && settings && onSettingsChange` inner JSX (the `<View style={s.valueRow}>…</View>` block, lines 217-244) into:

```js
// The Best Ball / Worst Ball "pts / hole" inputs. Shared by ScoringModeField
// (tournament defaults at setup) and HomeScreen's per-round Point Values
// sheet. `settings` holds the two values as strings (TextInput-backed).
export function BestBallValueFields({ settings, onSettingsChange }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.valueRow}>
      ...the existing two valueBlock Views, verbatim...
    </View>
  );
}
```

and render it from `ScoringModeField` at the original spot:

```jsx
      {value === 'bestball' && settings && onSettingsChange && (
        <BestBallValueFields settings={settings} onSettingsChange={onSettingsChange} />
      )}
```

Run: `npx jest src/ 2>&1 | tail -4` — SetupScreen/wizard suites stay green (pure extraction).

- [ ] **Step 2: HomeScreen — state, save handler, menu item**

Imports: extend line 15 with `BestBallValueFields`. State next to the other sheets:

```js
  const [showPointValues, setShowPointValues] = useState(false);
  // Strings — BestBallValueFields edits through TextInputs.
  const [pointValuesDraft, setPointValuesDraft] = useState(null);
```

Handler next to `saveRoundScoringMode`:

```js
  // Persist the selected round's best/worst point values (round override).
  async function savePointValues() {
    const r = tournament?.rounds?.[selectedRound];
    if (!r || !pointValuesDraft) return;
    try {
      await mutate(tournament, {
        type: 'round.setBestBallValues',
        roundId: r.id,
        bestBallValue: parseInt(pointValuesDraft.bestBallValue, 10) || 1,
        worstBallValue: parseInt(pointValuesDraft.worstBallValue, 10) || 1,
      });
      await reload();
      setShowPointValues(false);
    } catch (err) {
      const msg = err?.message ?? 'Could not update point values';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }
```

Menu item renderer next to `renderTeamsMenuItem`:

```js
  // Point values are only meaningful for a Best Ball round. Rendered in the
  // per-round sheet (multi-round) and the gear sheet (single-round).
  function renderPointValuesMenuItem(onClose) {
    const r = tournament.rounds[selectedRound];
    if (isViewer || roundScoringMode(tournament, r) !== 'bestball') return null;
    const vals = roundBestBallValues(tournament, r);
    return (
      <TouchableOpacity
        style={s.menuItem}
        onPress={() => {
          onClose();
          setPointValuesDraft({
            bestBallValue: String(vals.bestBallValue),
            worstBallValue: String(vals.worstBallValue),
          });
          setShowPointValues(true);
        }}
        activeOpacity={0.7}
      >
        <Feather name="hash" size={18} color={theme.accent.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.menuItemText}>Point Values</Text>
          <Text style={s.modalSubtle}>{`Best ${vals.bestBallValue} · Worst ${vals.worstBallValue} pts / hole`}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </TouchableOpacity>
    );
  }
```

- [ ] **Step 3: Render the item + sheet**

In the Round N modal, directly after the Scoring Mode TouchableOpacity (before `renderTeamsMenuItem`, line ~1955): `{renderPointValuesMenuItem(() => setShowRoundEdit(false))}`.
In the gear sheet, directly after the single-round Scoring Mode entry from Task 4: `{tournament.rounds.length === 1 && renderPointValuesMenuItem(() => setShowSettings(false))}`.

Sheet, next to the Team Settings BottomSheet:

```jsx
    <BottomSheet visible={showPointValues} onClose={() => setShowPointValues(false)} sheetStyle={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>{`Point Values · Round ${selectedRound + 1}`}</Text>
          {pointValuesDraft && (
            <>
              <BestBallValueFields settings={pointValuesDraft} onSettingsChange={setPointValuesDraft} />
              <TouchableOpacity
                style={[s.menuItem, { borderBottomWidth: 0, justifyContent: 'center' }]}
                onPress={savePointValues}
                activeOpacity={0.7}
              >
                <Feather name="check" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Save</Text>
              </TouchableOpacity>
            </>
          )}
    </BottomSheet>
```

- [ ] **Step 4: Run the suite and lint**

Run: `npx jest src/ 2>&1 | tail -4` then `npm run lint`
Expected: green (update any ScoringModePicker test mocks that now need `BestBallValueFields: () => null` — grep as in Task 4 Step 5).

- [ ] **Step 5: Commit**

```bash
git add src/components/ScoringModePicker.js src/screens/HomeScreen.js src/screens/__tests__/
git commit -m "feat(home): per-round Point Values sheet for best ball rounds"
```

---

### Task 6: Gear icon for the round settings trigger

**Files:**
- Modify: `src/screens/HomeScreen.js:2266` (inside the button labeled `accessibilityLabel="Round options"` at line 2264)

**Interfaces:** none.

- [ ] **Step 1: Swap the icon**

Change `<Feather name="more-horizontal" size={16} color={theme.text.muted} />` to `<Feather name="settings" size={16} color={theme.text.muted} />`. Label stays `"Round options"`.

- [ ] **Step 2: Verify + commit**

Run: `npx jest src/screens/__tests__/HomeScreen.roundPager.test.js` (uses the label, not the icon — must stay green).

```bash
git add src/screens/HomeScreen.js
git commit -m "feat(home): round settings trigger uses a gear icon"
```

---

### Task 7: Pager re-asserts the selected round on re-layout (TDD)

**Files:**
- Modify: `src/screens/HomeScreen.js` (wrap View line 1686 gets `testID="round-pager-wrap"`; pager ScrollView line 1714 gets `testID="round-pager"` and an `onLayout`)
- Test: `src/screens/__tests__/HomeScreen.roundPager.test.js` (append one test)

**Interfaces:**
- Consumes: existing pager refs (`roundPagerRef`, `roundScrollOffset`, `selectedRound`, `roundPagerWidth`).
- Produces: nothing downstream.

**Background (the bug):** on web the ScrollView cannot honor `contentOffset` before children lay out (see the comment at `HomeScreen.js:1689-1693`). When the pager REMOUNTS with `selectedRound` preserved (list ↔ tournament switch, navigating away and back — HomeScreen stays mounted so state and refs survive), the ScrollView starts at x=0, `onLayout` on the wrap sets the SAME width (no state change), the sync effect never re-runs, and `roundScrollOffset.current` still claims the old position — so the R2 tab stays selected while round 1's card shows. Reproduce first via the test below (RED), then fix.

- [ ] **Step 1: Write the failing test**

Append to `HomeScreen.roundPager.test.js`:

```js
test('pager re-asserts the selected round when it re-lays-out', async () => {
  const { ScrollView } = require('react-native');
  const view = renderTournamentHome();
  // Smart default lands on R2 (index 1).
  await waitFor(() => expect(activeTabLabel(view)).toBe('R2'));

  // Give the pager a width so the inner ScrollView mounts.
  fireEvent(view.getByTestId('round-pager-wrap'), 'layout', {
    nativeEvent: { layout: { width: 320, height: 400 } },
  });
  const pagerNode = view.UNSAFE_getAllByType(ScrollView)
    .find((n) => n.props.testID === 'round-pager');
  expect(pagerNode).toBeTruthy();

  // Simulate a fresh layout pass after a remount-style reset: the real
  // offset is 0 but selectedRound is still 1. The pager must re-assert
  // its page without animation.
  const scrollTo = jest.fn();
  pagerNode.instance.scrollTo = scrollTo;
  fireEvent(view.getByTestId('round-pager'), 'layout', {
    nativeEvent: { layout: { width: 320, height: 400 } },
  });
  expect(scrollTo).toHaveBeenCalledWith({ x: 320, animated: false });
});
```

If `pagerNode.instance` is null (function-component ScrollView in this RN version), the spy can't attach that way — find the working seam (e.g. `pagerNode.instance?.getNativeScrollRef`, or spying on the module's ScrollView before render) during the RED run and use it; do NOT ship a test without the `scrollTo` assertion.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/screens/__tests__/HomeScreen.roundPager.test.js`
Expected: the new test FAILS — either `getByTestId('round-pager-wrap')` not found (testIDs don't exist yet) or `scrollTo` not called.

- [ ] **Step 3: Implement**

1. Wrap View (line 1686): add `testID="round-pager-wrap"` alongside the existing `onLayout`.
2. Pager ScrollView (line 1714): add `testID="round-pager"` and:

```jsx
                onLayout={() => {
                  // A remount (list ↔ tournament switch, or a modal-driven
                  // re-layout) resets the ScrollView's real offset to 0 on web
                  // while roundScrollOffset still holds the last position, so
                  // the sync effect thinks nothing moved. Re-assert the
                  // selected page — a no-op when already there.
                  const target = selectedRound * roundPagerWidth;
                  roundPagerRef.current?.scrollTo({ x: target, animated: false });
                  roundScrollOffset.current = target;
                }}
```

- [ ] **Step 4: Run to verify it passes — including the 6e0e580 regressions**

Run: `npx jest src/screens/__tests__/HomeScreen.roundPager.test.js` then `npx jest src/ 2>&1 | tail -4` and `npm run lint`
Expected: 3/3 in the pager suite; full src suite green; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/screens/HomeScreen.js src/screens/__tests__/HomeScreen.roundPager.test.js
git commit -m "fix(home): pager re-asserts selected round after re-layout resets"
```

---

### Task 8: Runtime verification (main session, verify skill)

**Files:** none.

- [ ] **Step 1:** Launch Expo web per the project `verify` skill; sign in as a QA user; seed (or create) a 4-player, 3-round Best Ball tournament with fixed teams ON.
- [ ] **Step 2:** Gear sheet: no "Scoring Mode" entry; "Team Settings" opens with the fixed-teams toggle ON, the pairs preview text, and Edit Pairs navigating to the round-1 team editor.
- [ ] **Step 3:** Round 2 gear-icon (was •••) sheet: set Pairs Match Play; confirm no Point Values item on that round; round 1's sheet (bestball) shows "Point Values", set Best=2/Worst=1, and confirm round 1's leaderboard points double best-ball wins while other rounds are unchanged.
- [ ] **Step 4:** Toggle fixed teams OFF and ON in Team Settings; confirm it persists across a reload (Supabase row's `_meta` gains `settings.fixedTeams`).
- [ ] **Step 5:** Pager: select R2, switch to the tournament list, reopen the tournament — the R2 tab AND round 2's card show together; also open/close both settings sheets on R2 and confirm no desync; 0 console errors.
- [ ] **Step 6:** Single-round game: gear shows round-scoped "Scoring Mode" (+ Point Values when bestball). Clean up QA data.
