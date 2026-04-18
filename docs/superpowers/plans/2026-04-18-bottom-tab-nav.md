# Bottom Tab Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat stack navigator in `App.js` with a task-oriented bottom tab bar (Home · Tournament · Scorecard) whose tabs appear/disappear based on tournament state, keeping all existing flow screens as push-on-top routes.

**Architecture:** Root becomes a `createStackNavigator`. Its first screen is `MainTabs` (a `createBottomTabNavigator` host). All existing non-primary screens remain siblings in the root stack — pushing any of them on top of `MainTabs` hides the tab bar natively. A small module-level event emitter in `tournamentStore` drives a `useActiveTournament` hook that feeds the tab navigator so the visible tab set reacts to writes without polling.

**Tech Stack:** React Native 0.81, Expo 54, React Navigation 7 (stack + bottom-tabs), Supabase for persistence, `react-native-safe-area-context` (already installed), Feather icons.

**Spec:** `docs/superpowers/specs/2026-04-18-bottom-tab-nav-design.md`

**Testing note:** This project has **no test harness** (no jest, no react-native-testing-library). Bootstrapping one is out of scope for this feature. Each task ends with a manual verification step in the running Expo app and a commit. Task 8 is a dedicated end-to-end verification pass against the spec's acceptance criteria.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `package.json` / `package-lock.json` | modify | add `@react-navigation/bottom-tabs@^7` |
| `src/store/tournamentStore.js` | modify | add `isRoundInProgress`, `subscribe`, `_emitChange`; wrap mutators to emit |
| `src/store/useActiveTournament.js` | create | hook that subscribes to the store and returns `{ tournament, loading }` |
| `src/screens/ScorecardScreen.js` | modify | accept missing `route.params` and fall back to `tournament.currentRound` |
| `src/screens/HomeScreen.js` | modify | split internal render into `HomeListView` + `TournamentView`; accept `mode` prop |
| `src/navigation/MainTabs.js` | create | `createBottomTabNavigator` with dynamic tab set + Augusta styling |
| `App.js` | modify | root becomes stack whose first screen is `MainTabs`; flow screens stay as siblings |

---

## Task 1: Install bottom-tabs navigator

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the package**

Run:
```bash
npm install @react-navigation/bottom-tabs@^7
```

Expected: `package.json` gains `"@react-navigation/bottom-tabs": "^7.x.x"` under `dependencies`. No peer-dep warnings that block install (warnings about optional React Native versions are acceptable; errors are not).

- [ ] **Step 2: Verify the app still boots**

Run:
```bash
npx expo start --web
```

Open the URL printed. The current Home screen should load exactly as before (no navigation changes yet). Close the dev server once confirmed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add @react-navigation/bottom-tabs dependency"
```

---

## Task 2: Store — add `isRoundInProgress` and subscribe primitive

**Files:**
- Modify: `src/store/tournamentStore.js`

- [ ] **Step 1: Add the subscription primitive near the top of the file (after the existing migration block, before `loadAllTournaments`)**

Paste this block after the `ensureMigrated` function (around line 41):

```js
// --- change subscription ---
// Lightweight pub/sub so navigators/components can react to tournament writes
// without polling Supabase. Fires on setActive/clearActive/save/delete.
const _subs = new Set();
function _emitChange() {
  _subs.forEach((fn) => { try { fn(); } catch (_) {} });
}
export function subscribeTournamentChanges(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}
```

- [ ] **Step 2: Emit on every write. Update the four mutating functions so each ends with `_emitChange()`**

Replace `saveTournament`:
```js
export async function saveTournament(tournament) {
  await persistTournament(tournament);
  await AsyncStorage.setItem(ACTIVE_ID_KEY, tournament.id);
  _emitChange();
}
```

Replace `setActiveTournament`:
```js
export async function setActiveTournament(id) {
  await AsyncStorage.setItem(ACTIVE_ID_KEY, id);
  _emitChange();
}
```

Replace `clearActiveTournament` (find the existing one near line 81 and add `_emitChange()` before it returns):
```js
export async function clearActiveTournament() {
  await AsyncStorage.removeItem(ACTIVE_ID_KEY);
  _emitChange();
}
```

Replace `deleteTournament` (currently at lines 85–90):
```js
export async function deleteTournament(id) {
  const activeId = await AsyncStorage.getItem(ACTIVE_ID_KEY);
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) throw error;
  if (activeId === id) await AsyncStorage.removeItem(ACTIVE_ID_KEY);
  _emitChange();
}
```

- [ ] **Step 3: Add `isRoundInProgress` as an exported helper. Paste this at the end of the file**

```js
// Round is "in progress" if at least one score has been entered AND
// the round is not fully scored for every player on every hole.
export function isRoundInProgress(tournament) {
  if (!tournament) return false;
  const round = tournament.rounds?.[tournament.currentRound];
  if (!round || !round.scores) return false;

  const playerIds = tournament.players.map((p) => p.id);
  const holeCount = round.course?.holes?.length ?? 18;

  let entered = 0;
  let expected = playerIds.length * holeCount;
  for (const pid of playerIds) {
    const perPlayer = round.scores[pid];
    if (!perPlayer) continue;
    entered += Object.keys(perPlayer).length;
  }
  return entered > 0 && entered < expected;
}
```

- [ ] **Step 4: Verify by running the app and confirming nothing regressed**

Run:
```bash
npx expo start --web
```

Open Home, create a tournament if none, select it, open Scorecard, enter a score. No crashes. Home still reloads on focus. Close dev server.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "Store: add isRoundInProgress helper and change subscription"
```

---

## Task 3: `useActiveTournament` hook

**Files:**
- Create: `src/store/useActiveTournament.js`

- [ ] **Step 1: Create the hook file**

Full file contents:

```js
import { useEffect, useState, useCallback } from 'react';
import { loadTournament, subscribeTournamentChanges } from './tournamentStore';

// Returns the currently active tournament (or null) and re-fetches whenever
// the store emits a change. Used by the tab navigator to decide which tabs
// to show, and usable by any screen that needs live active-tournament state.
export function useActiveTournament() {
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const t = await loadTournament();
      setTournament(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const unsub = subscribeTournamentChanges(reload);
    return unsub;
  }, [reload]);

  return { tournament, loading, reload };
}
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
node --check src/store/useActiveTournament.js
```

Expected: no output (syntactic OK). If `node --check` rejects JSX/import syntax on this file, fall back to starting the dev server (`npx expo start --web`) and confirming no red screen.

- [ ] **Step 3: Commit**

```bash
git add src/store/useActiveTournament.js
git commit -m "Add useActiveTournament hook"
```

---

## Task 4: ScorecardScreen tolerates missing `roundIndex`

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

Currently `ScorecardScreen` does `const { roundIndex } = route.params;` — this crashes when mounted as a tab (no params). Fix: fall back to `tournament.currentRound`, resolved after the tournament loads.

- [ ] **Step 1: Replace the destructure and reload to handle missing params**

Find (around line 26):
```js
  const { roundIndex } = route.params;
```

Replace with:
```js
  const paramRoundIndex = route.params?.roundIndex;
```

- [ ] **Step 2: Update `reload` to resolve the effective round index from state when missing**

Find the existing `reload` (around line 39):
```js
  const reload = useCallback(async () => {
    const t = await loadTournament();
    if (!t) return;
    setTournament(t);
    setScores(t.rounds[roundIndex].scores ?? {});
    setNotes(t.rounds[roundIndex].notes ?? '');
  }, [roundIndex]);
```

Replace with:
```js
  const reload = useCallback(async () => {
    const t = await loadTournament();
    if (!t) return;
    const idx = paramRoundIndex ?? t.currentRound;
    setTournament(t);
    setScores(t.rounds[idx]?.scores ?? {});
    setNotes(t.rounds[idx]?.notes ?? '');
  }, [paramRoundIndex]);
```

- [ ] **Step 3: Replace every other reference to `roundIndex` in the file with a resolved local**

Run Grep to find remaining references:
```bash
grep -n "roundIndex" src/screens/ScorecardScreen.js
```

For each site (typically inside save handlers, view-switch handlers, and render JSX), compute once near the top of the component body:

Add this line immediately after the state hooks (after `const tournamentRef = useRef(null);`):
```js
  const roundIndex = paramRoundIndex ?? tournament?.currentRound ?? 0;
```

This lets the rest of the file continue using `roundIndex` unchanged. Remove the original `const { roundIndex } = route.params;` line if it still exists.

- [ ] **Step 4: Verify**

Run `npx expo start --web`, create a tournament, navigate to Scorecard from Home (this still passes `roundIndex` explicitly). Confirm scores enter and persist exactly as before. Close dev server.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "ScorecardScreen: resolve roundIndex from state when no param"
```

---

## Task 5: Split HomeScreen rendering via `mode` prop

**Files:**
- Modify: `src/screens/HomeScreen.js`

Today `HomeScreen` renders list-mode when `!tournament` and tournament-mode otherwise. We need to mount each mode independently in its own tab while keeping one file and one source of truth for data loading.

- [ ] **Step 1: Accept a `mode` prop on the default export**

Find the current signature:
```js
export default function HomeScreen({ navigation }) {
```

Replace with:
```js
export default function HomeScreen({ navigation, mode = 'auto' }) {
```

`mode = 'auto'` preserves today's behavior (auto-branch on `!tournament`). `mode = 'list'` forces the list view. `mode = 'tournament'` forces the tournament view.

- [ ] **Step 2: Change the branch condition near line 80**

Find:
```js
  if (!tournament) {
    return (
      <View style={s.screen}>
```

Replace the condition with:
```js
  const showList = mode === 'list' || (mode === 'auto' && !tournament);
  const showTournament = mode === 'tournament' || (mode === 'auto' && !!tournament);

  if (showList) {
    return (
      <View style={s.screen}>
```

- [ ] **Step 3: Add a graceful fallback for the tournament tab when it mounts without an active tournament**

Scroll to where the tournament-mode JSX begins (the `return` after the list-mode block). Immediately before that `return`, insert:

```js
  if (showTournament && !tournament) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Feather name="flag" size={48} color={theme.text.muted} />
        <Text style={[s.emptyTitle, { marginTop: 16 }]}>No active tournament</Text>
        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 20 }]}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.8}
        >
          <Text style={s.primaryBtnText}>Go to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }
```

This branch is defensive — the tab navigator will hide the Tournament tab when there is no active tournament, so users shouldn't reach it.

- [ ] **Step 4: Verify**

Run `npx expo start --web`. Default behavior (no `mode` prop passed) must be identical to before. Create a tournament, select it, confirm the active-tournament dashboard renders. Delete it, confirm the list renders. Close dev server.

- [ ] **Step 5: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "HomeScreen: add mode prop to separate list vs tournament view"
```

---

## Task 6: MainTabs navigator

**Files:**
- Create: `src/navigation/MainTabs.js`

- [ ] **Step 1: Create the directory and file**

Run:
```bash
mkdir -p src/navigation
```

Then create `src/navigation/MainTabs.js` with full contents:

```js
import React from 'react';
import { View, StyleSheet, Pressable, Text, Animated, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import ScorecardScreen from '../screens/ScorecardScreen';
import { useTheme } from '../theme/ThemeContext';
import { useActiveTournament } from '../store/useActiveTournament';
import { isRoundInProgress } from '../store/tournamentStore';
import { typography, spacing, radius } from '../theme/tokens';

const Tab = createBottomTabNavigator();

function HomeListTab(props) {
  return <HomeScreen {...props} mode="list" />;
}
function HomeTournamentTab(props) {
  return <HomeScreen {...props} mode="tournament" />;
}

function TabBar({ state, descriptors, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const fade = React.useRef(new Animated.Value(1)).current;
  const routeCount = state.routes.length;
  const prevCount = React.useRef(routeCount);

  React.useEffect(() => {
    if (prevCount.current !== routeCount) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      prevCount.current = routeCount;
    }
  }, [routeCount, fade]);

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          backgroundColor: theme.bg.card,
          borderTopColor: theme.border.default,
          paddingBottom: insets.bottom,
          opacity: fade,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const iconName = options.tabBarIconName;
        const label = options.tabBarLabel ?? route.name;
        const color = focused ? theme.accent.primary : theme.text.muted;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityLabel={`${label} tab`}
            accessibilityState={focused ? { selected: true } : {}}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View
              style={[
                styles.iconPill,
                focused && { backgroundColor: theme.accent.light },
              ]}
            >
              <Feather name={iconName} size={20} color={color} />
            </View>
            <Text style={[styles.label, typography.caption, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

export default function MainTabs() {
  const { tournament } = useActiveTournament();
  const showTournament = !!tournament;
  const showScorecard = isRoundInProgress(tournament);

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen
        name="Home"
        component={HomeListTab}
        options={{ tabBarLabel: 'Home', tabBarIconName: 'home' }}
      />
      {showTournament && (
        <Tab.Screen
          name="Tournament"
          component={HomeTournamentTab}
          options={{ tabBarLabel: 'Tournament', tabBarIconName: 'flag' }}
        />
      )}
      {showScorecard && (
        <Tab.Screen
          name="Scorecard"
          component={ScorecardScreen}
          options={{ tabBarLabel: 'Scorecard', tabBarIconName: 'edit-3' }}
        />
      )}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: spacing.xs,
    ...Platform.select({
      ios: {},
      android: { elevation: 0 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  iconPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  label: {
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: Verify the file parses and imports resolve**

Run:
```bash
node --check src/navigation/MainTabs.js || echo "(JSX — rely on bundler)"
```

This will likely fail because of JSX; that's expected. The real verification happens in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/navigation/MainTabs.js
git commit -m "Add MainTabs navigator with dynamic visibility"
```

---

## Task 7: Wire MainTabs into App.js

**Files:**
- Modify: `App.js`

- [ ] **Step 1: Replace the imports and the `AppNavigator` function**

Open `App.js`. Add near the other screen imports:
```js
import MainTabs from './src/navigation/MainTabs';
```

Replace the entire `AppNavigator` function with:

```js
function AppNavigator() {
  const { theme, mode } = useTheme();

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack.Navigator
        initialRouteName="MainTabs"
        screenOptions={{
          headerShown: false,
          cardStyle: { flex: 1, backgroundColor: theme.bg.primary },
          cardStyleInterpolator: CardStyleInterpolators.forFadeFromBottomAndroid,
          transitionSpec: {
            open: { animation: 'timing', config: { duration: 250 } },
            close: { animation: 'timing', config: { duration: 200 } },
          },
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="Setup" component={SetupScreen} />
        <Stack.Screen name="Scorecard" component={ScorecardScreen} />
        <Stack.Screen name="NextRound" component={NextRoundScreen} />
        <Stack.Screen name="CourseEditor" component={CourseEditorScreen} />
        <Stack.Screen name="EditTournament" component={EditTournamentScreen} />
        <Stack.Screen name="PlayersLibrary" component={PlayersLibraryScreen} />
        <Stack.Screen name="CoursesLibrary" component={CoursesLibraryScreen} />
        <Stack.Screen name="CourseLibraryDetail" component={CourseLibraryDetailScreen} />
        <Stack.Screen name="PlayerPicker" component={PlayerPickerScreen} />
        <Stack.Screen name="CoursePicker" component={CoursePickerScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="EditTeams" component={EditTeamsScreen} />
      </Stack.Navigator>
    </>
  );
}
```

Key changes:
- `initialRouteName` is now `MainTabs`.
- `Home` is removed from the root stack — it lives inside `MainTabs`.
- Every other `Stack.Screen` stays, so existing `navigation.navigate('Setup')`, `navigation.navigate('Scorecard', { roundIndex })`, etc. still resolve and push on top of the tabs.

- [ ] **Step 2: Boot the app and confirm it loads into MainTabs**

Run:
```bash
npx expo start --web
```

Expected on load with no tournament: a single "Home" tab at the bottom. The HomeScreen list renders above it.

- [ ] **Step 3: Exercise the primary navigations**

In the running app:
1. Tap "+ New Tournament" → Setup pushes on top, tab bar is hidden. Complete setup.
2. Back on MainTabs: two tabs now appear (Home · Tournament), fading in.
3. Open Scorecard from the tournament view (existing button) → Scorecard pushes on top with tab bar hidden.
4. Enter one score, back out to MainTabs → a third tab (Scorecard) is now visible.
5. Tap the Scorecard tab → renders the current round's scorecard inline (no push).

If any step fails, stop and debug before committing.

- [ ] **Step 4: Commit**

```bash
git add App.js
git commit -m "App: host MainTabs inside root stack"
```

---

## Task 8: End-to-end verification against spec acceptance criteria

**Files:** none (verification only)

- [ ] **Step 1: Fresh state — delete all tournaments (or start from a clean Supabase table). Reload the app**

Expected: one tab only ("Home"). HomeScreen shows the empty state.

- [ ] **Step 2: Create a tournament**

Tap `+ New Tournament` → Setup. Complete it. Return to MainTabs.

Expected: Home tab + Tournament tab (2 tabs). A fade transition when the second tab appears.

- [ ] **Step 3: Tap the Tournament tab**

Expected: renders the active-tournament dashboard (leaderboard, round selector). Same visual as HomeScreen used to show when active.

- [ ] **Step 4: Enter one score on the current round**

From the Tournament tab, open the scorecard for the current round and enter a single hole score. Back out.

Expected: Scorecard tab now visible (3 tabs). Tapping it shows the scorecard inline.

- [ ] **Step 5: Complete the current round (enter all remaining scores)**

Expected: Scorecard tab disappears (fade back to 2 tabs). If the user was on the Scorecard tab when it vanished, they land on Tournament.

- [ ] **Step 6: Delete the active tournament from the Home tab**

Expected: collapses back to 1 tab (Home only).

- [ ] **Step 7: Push a flow screen (e.g., PlayersLibrary from the Home header icon)**

Expected: tab bar is completely hidden for the duration of the flow. Back navigation returns to MainTabs with the bar restored.

- [ ] **Step 8: Toggle dark mode from the Home header**

Expected: tab bar re-colors correctly — cream/card bg in light, translucent dark in dark; active tab pill uses `accent.primary` in both.

- [ ] **Step 9: Final commit (only if any fix-ups were needed during verification)**

If steps 1–8 passed without changes, no commit is needed — the feature is complete at Task 7's commit. If fixes were needed, commit them now:

```bash
git add <fixed-files>
git commit -m "Fix: <description of issue caught during verification>"
```

- [ ] **Step 10: Final sanity check — run the web build to catch anything only the bundler sees**

Run:
```bash
npx expo export --platform web
```

Expected: build completes without errors. Warnings about bundle size / peer deps are acceptable.

---

## Rollback

If the tab navigator causes regressions that can't be fixed quickly, revert Task 7's commit (`git revert <hash>`). That single revert disables the tab bar and restores the flat stack. Tasks 1–6 are additive and harmless if left in place.
