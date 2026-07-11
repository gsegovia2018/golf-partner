# Stats Navigation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statistics always show the game they were opened from — casual games and old games from History get their own stats (not the last active tournament's), and the "Round Stats" button in the Stats tab opens the statistics screen scoped to that round instead of the feed round page.

**Architecture:** `StatsScreen` currently loads data with `loadTournament()`, which returns the *active* tournament from AsyncStorage and returns `null` for finished tournaments — so it ignores which game the user navigated from. The store already exposes `getTournament(id)` + `getTournamentSnapshot(id)` for exactly this case (screens reached from the feed). Fix: `StatsScreen` honors `route.params.tournamentId` (load via `getTournament`) and an optional `route.params.roundId` (preselects the screen-level `roundScope`). `HomeScreen` passes `tournamentId` when opening Statistics. `MyStatsScreen`'s "Round Stats" button navigates to `Stats` with `{ tournamentId, roundId }` instead of `RoundSummary`.

**Tech Stack:** React Native (Expo SDK 54), React Navigation stack, Jest + @testing-library/react-native (jest-expo preset).

## Global Constraints

- `npm test` must stay green; run scoped suites per task, full `npx jest src` before finishing.
- `npm run lint` (ESLint 9 flat config) is CI-blocking — no new warnings on changed files.
- Domain logic stays in `src/store/`; screens only consume it. No new store logic is needed here — reuse `getTournament` / `getTournamentSnapshot`.
- Follow existing code style: single quotes, trailing commas, comments only for non-obvious constraints.
- Commit after each task with a conventional-commit message.
- Jest picks up nested worktree copies (`.claude/worktrees`, `.worktrees`); run tests with explicit `src/...` paths to avoid them.

---

### Task 1: StatsScreen honors `route.params.tournamentId` and `route.params.roundId`

**Files:**
- Modify: `src/screens/StatsScreen.js` (component signature at line 83, state seed at line 89, load effect at lines 106–126, imports at lines 7–10)
- Test: `src/screens/__tests__/StatsScreen.test.js`

**Interfaces:**
- Consumes: `getTournament(id)` (async, `src/store/tournamentStore.js:375`), `getTournamentSnapshot(id)` (sync, `tournamentStore.js:430`) — both already exported.
- Produces: `StatsScreen` accepts optional route params `{ tournamentId?: string, roundId?: string }`. With `tournamentId` it loads that tournament (works for finished ones); with `roundId` it preselects the round-scope chip for that round. Without params, behavior is unchanged (active tournament). Tasks 2 and 3 rely on this contract.

- [ ] **Step 1: Write the failing tests**

Add to `src/screens/__tests__/StatsScreen.test.js`. The existing `jest.mock('../../store/tournamentStore', ...)` factory must gain two entries (`getTournament`, `getTournamentSnapshot`); the file already defines `mockActiveTournament`, `player`, `makeRound`, and imports `StyleSheet` from `react-native`.

Extend the store mock (inside the existing `jest.mock('../../store/tournamentStore', () => ({ ... }))` factory, alongside `loadTournament`):

```js
  getTournament: jest.fn(() => Promise.resolve(mockRouteTournament)),
  getTournamentSnapshot: jest.fn(() => null),
```

Add a module-scope `let mockRouteTournament;` next to `let mockActiveTournament;`.

Add the tests (follow the render pattern already used in this file — if existing tests render with a `navigation` prop only, add a `route` prop):

```js
describe('route params', () => {
  test('loads the tournament from route.params.tournamentId instead of the active one', async () => {
    const { loadTournament, getTournament } = require('../../store/tournamentStore');
    mockRouteTournament = {
      id: 't-old',
      name: 'Old Casual Game',
      players: [player],
      rounds: [makeRound('r-1')],
    };
    const { findByText } = render(
      <StatsScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
        route={{ params: { tournamentId: 't-old' } }}
      />,
    );
    // The round-scope chip proves the route tournament rendered.
    await findByText('R1');
    expect(getTournament).toHaveBeenCalledWith('t-old');
    expect(loadTournament).not.toHaveBeenCalled();
  });

  test('preselects the round scope from route.params.roundId', async () => {
    mockRouteTournament = {
      id: 't-old',
      name: 'Old Casual Game',
      players: [player],
      rounds: [makeRound('r-1'), makeRound('r-2')],
    };
    const { findByText } = render(
      <StatsScreen
        navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
        route={{ params: { tournamentId: 't-old', roundId: 'r-2' } }}
      />,
    );
    const chip = await findByText('R2');
    // roundChipTextActive sets color to theme.text.inverse — the selected chip.
    expect(StyleSheet.flatten(chip.props.style).color).toBe(mockTheme.text.inverse);
    // "Total" chip must NOT be the active one.
    const totalChip = await findByText('Total');
    expect(StyleSheet.flatten(totalChip.props.style).color).not.toBe(mockTheme.text.inverse);
  });
});
```

Note: `beforeEach` should reset `mockRouteTournament = null;` and clear the new mocks if the file uses `jest.clearAllMocks()` — match whatever reset pattern the file already has.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/screens/__tests__/StatsScreen.test.js -t "route params"`
Expected: FAIL — `getTournament` never called / `loadTournament` called instead (the component ignores `route`).

- [ ] **Step 3: Implement route-param support in StatsScreen**

In `src/screens/StatsScreen.js`:

1. Extend the store import (lines 7–10):

```js
import {
  loadTournament, getTournament, getPlayingHandicap, calcStablefordPoints,
  playerPartnerSplits, getActiveTournamentSnapshot, getTournamentSnapshot,
  roundScoringMode,
} from '../store/tournamentStore';
```

2. Change the component signature and state seed (lines 83, 89):

```js
export default function StatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  // Which tournament to show: an explicit id when opened from a specific
  // game (History, My Stats round link), otherwise the active tournament.
  const routeTournamentId = route?.params?.tournamentId ?? null;
  const routeRoundId = route?.params?.roundId ?? null;
  // Memoised so StyleSheet.create only re-runs when the theme actually
  // changes — not on every tab switch / metric toggle re-render.
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [tournament, setTournament] = useState(() => (
    routeTournamentId ? getTournamentSnapshot(routeTournamentId) : getActiveTournamentSnapshot()
  ));
```

3. Change the load effect (lines 106–126). `loadTournament()` only returns the active, unfinished tournament — `getTournament(id)` loads any tournament, including finished ones, which is what History games need:

```js
  useEffect(() => {
    const load = routeTournamentId ? getTournament(routeTournamentId) : loadTournament();
    load.then(t => {
      setTournament(t);
      if (routeRoundId && t?.rounds) {
        const idx = t.rounds.findIndex((r) => r.id === routeRoundId);
        if (idx >= 0) setRoundScope(idx);
      }
      // Default selections to the signed-in user when they're one of the
      // players in this tournament. Falls back to the first player otherwise.
      if (t?.players?.length && user?.id) {
        const mine = t.players.findIndex((p) => p.user_id === user.id);
        if (mine >= 0) {
          setPlayersTabPlayer(mine);
          setPairsTabPlayer(mine);
          setH2hP1(mine);
          setH2hP2(mine === 0 ? 1 : 0);
        }
      }
    }).catch((e) => {
      // Without this catch a load failure is an unhandled rejection and the
      // screen silently stays blank. Leaving `tournament` null renders the
      // "no tournament" fallback below.
      console.warn('StatsScreen: failed to load tournament', e);
    });
  }, [user?.id, routeTournamentId, routeRoundId]);
```

(Keep the existing comments; the `setRoundScope` call is the only new body line besides the `load` selection.)

- [ ] **Step 4: Run the new tests and the whole suite for this screen**

Run: `npx jest src/screens/__tests__/StatsScreen.test.js`
Expected: PASS — all pre-existing tests still green (they pass no `route`, so `routeTournamentId` is null and the `loadTournament()` path is untouched).

- [ ] **Step 5: Lint the changed files**

Run: `npx eslint src/screens/StatsScreen.js src/screens/__tests__/StatsScreen.test.js`
Expected: no errors, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/screens/StatsScreen.js src/screens/__tests__/StatsScreen.test.js
git commit -m "feat(stats): StatsScreen loads the tournament and round from route params"
```

---

### Task 2: HomeScreen opens Statistics for the tournament it is showing

**Files:**
- Modify: `src/screens/HomeScreen.js:2094` (Statistics item in the settings BottomSheet)

**Interfaces:**
- Consumes: Task 1's `Stats` route param contract (`{ tournamentId }`).
- Produces: nothing new — behavioral fix only.

This is the bug's entry point for History/casual games: HomeScreen may be displaying a tournament loaded via `getTournament(routeTournamentId)` (opened from History), but the Statistics menu item navigated with **no params**, so StatsScreen fell back to the active tournament. The settings sheet only renders when `tournament` is set, so `tournament.id` is always available here.

- [ ] **Step 1: Pass the tournament id**

In `src/screens/HomeScreen.js` line 2094, change:

```js
            onPress={() => { setShowSettings(false); navigation.navigate('Stats'); }}
```

to:

```js
            onPress={() => { setShowSettings(false); navigation.navigate('Stats', { tournamentId: tournament.id }); }}
```

- [ ] **Step 2: Run the existing HomeScreen suites**

Run: `npx jest src/screens/__tests__/HomeScreen.quickStart.test.js src/screens/__tests__/HomeScreen.roundPager.test.js`
Expected: PASS (no test covers the settings sheet; the param contract itself is covered by Task 1's tests).

- [ ] **Step 3: Lint the changed file**

Run: `npx eslint src/screens/HomeScreen.js`
Expected: no errors, no new warnings versus master.

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "fix(stats): open Statistics for the tournament shown, not the active one"
```

---

### Task 3: MyStats "Round Stats" button opens the round's statistics, not the feed round page

**Files:**
- Modify: `src/screens/MyStatsScreen.js:210-222` (the `openReportRound` memo)
- Test: `src/screens/__tests__/MyStatsScreen.test.js:266-274` (existing `navigates to RoundSummary for the selected round` test)

**Interfaces:**
- Consumes: Task 1's `Stats` route param contract (`{ tournamentId, roundId }`). `myRounds` items already carry `tournamentId` and `round.id` (see `collectMyRounds` in `src/store/personalStats.js`).
- Produces: nothing new — behavioral fix only.

- [ ] **Step 1: Update the existing test to expect the new destination**

In `src/screens/__tests__/MyStatsScreen.test.js` (test at line 266, currently asserting `RoundSummary`), rename and re-target it. Keep the test's existing setup/interaction lines (rendering and pressing the mocked "Open round stats" button) exactly as they are; only change the name and the assertion:

```js
  test('navigates to the round statistics for the selected round', async () => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    // ...existing render + press steps unchanged...
    expect(navigation.navigate).toHaveBeenCalledWith('Stats', {
      tournamentId: 't-1',
      roundId: 'r-1',
    });
  });
```

(The mocked `collectMyRounds` in this file returns `{ key: 'round-1', tournamentId: 't-1', round: { id: 'r-1' } }` — the ids above come from that mock.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js -t "round statistics"`
Expected: FAIL — actual call is `navigate('RoundSummary', { tournamentId: 't-1', roundId: 'r-1' })`.

- [ ] **Step 3: Re-target the navigation**

In `src/screens/MyStatsScreen.js`, replace lines 210–222 with:

```js
  // Link to the full statistics screen (holes, players, etc.) scoped to the
  // selected round — only when the round is resolvable there (StatsScreen
  // matches rounds by round.id, which older local rounds may lack).
  const openReportRound = useMemo(() => {
    const r = myRounds && reportRoundKey
      ? myRounds.find((it) => it.key === reportRoundKey)
      : null;
    if (!r?.tournamentId || !r?.round?.id) return null;
    return () => navigation.navigate('Stats', {
      tournamentId: r.tournamentId,
      roundId: r.round.id,
    });
  }, [myRounds, reportRoundKey, navigation]);
```

- [ ] **Step 4: Run the screen's suite**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS.

- [ ] **Step 5: Lint the changed files**

Run: `npx eslint src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js`
Expected: no errors, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "fix(stats): Round Stats opens the round's statistics screen, not the feed round page"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full src test suite**

Run: `npx jest src`
Expected: all suites pass (≈1080 tests as of the last run).

- [ ] **Step 2: Run lint over the repo**

Run: `npm run lint`
Expected: exit 0, no new warnings versus master.

- [ ] **Step 3: Runtime verification (main session, not a subagent)**

Use the project `verify` skill (Playwright against Expo web) to confirm:
1. History → open an old finished game → gear/settings → Statistics shows THAT game's course/rounds (chips match its round count), not the last tournament.
2. Stats tab (nav bar) → Report Card → "Round Stats" lands on the statistics screen with the pressed round's chip preselected — not on the RoundSummary feed page.
