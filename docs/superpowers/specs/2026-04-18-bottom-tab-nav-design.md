# Bottom Tab Navigation — Design Spec

**Date:** 2026-04-18
**Status:** Approved for implementation planning

## Goal

Replace the flat 13-screen stack navigator with a **task-oriented bottom tab bar** that surfaces only what the user cares about during a tournament weekend: the list, the active tournament, and the round being played. Tabs appear/disappear based on state so the bar reflects the current progress.

## Scope

- Introduce a bottom tab bar for primary navigation.
- Tabs are **dynamic**: 1, 2, or 3 visible depending on tournament state.
- Tabs are **only visible** on the three primary screens — flow screens pushed on top of them keep hiding the bar (native behavior of React Navigation stacks above tabs).
- Visual treatment matches the existing Augusta National palette and typography.

Out of scope: redesigning any individual screen's internals, moving Stats/Players/Courses out of their current locations, drawer or top-header refactor.

## Navigation Architecture

Today `App.js` declares a single `Stack.Navigator` with 13 screens and `headerShown: false`. It becomes:

```
RootStack  (createStackNavigator)
├── MainTabs                       ← single screen that hosts the tabs
│   └── createBottomTabNavigator
│       ├── Home        → HomeScreen in "list" mode
│       ├── Tournament  → HomeScreen in "active tournament" mode
│       └── Scorecard   → ScorecardScreen
└── Flow screens (pushed on top, hide tabs automatically)
    Setup · NextRound · CourseEditor · EditTournament ·
    PlayersLibrary · CoursesLibrary · CourseLibraryDetail ·
    PlayerPicker · CoursePicker · Stats · EditTeams
```

Pushing any flow screen on top of `MainTabs` hides the tab bar natively — no special handling needed.

### Why this shape

- Keeps the existing stack-push flows untouched. Only the root is restructured.
- Each tab is a thin wrapper; no screen logic moves out of its current file (except HomeScreen, see below).
- Deep-linking and `navigation.navigate('Scorecard')` continue to work from anywhere because the tab navigator's routes are siblings of root routes in React Navigation's resolution order.

## Dynamic Tab Visibility

The visible tab set is derived from tournament state loaded via `loadTournament()` from `tournamentStore`:

| State | Tabs shown |
|---|---|
| No active tournament | Home |
| Active tournament, current round not started | Home · Tournament |
| Active tournament + current round in progress | Home · Tournament · Scorecard |

**"Round in progress"** is defined as: `tournament.rounds[tournament.currentRound].scores` exists and has at least one entered score, and the round is not fully complete (i.e., `scores` count < expected entries). The exact predicate lives in a helper `isRoundInProgress(tournament)` in `tournamentStore.js`.

**Reactivity.** The tab bar must update when state changes (new tournament created, round started, round finished, tournament deleted, tournament switched). The existing pattern is `navigation.addListener('focus', reload)`. For the tab bar we need a slightly broader hook — a lightweight store subscription or a shared React context that listens to the same write points (`setActiveTournament`, `clearActiveTournament`, `deleteTournament`, score writes from ScorecardScreen). Implementation choice deferred to the plan, but the constraint is: **no polling**, and no requirement that the user navigate back to Home for the tab set to update.

**Transition.** When the tab set changes, the bar fades (200ms) rather than snapping. If the user is currently on a tab that disappears (e.g., round completes while on Scorecard), navigate them to the nearest surviving tab (Tournament, falling back to Home).

## HomeScreen Split

`HomeScreen.js` today branches on `if (!tournament)` to render either the tournament list or the active-tournament dashboard. To mount these in separate tabs without duplicating load logic:

- Extract the two branches into `HomeListView` and `TournamentView` (can live as components inside the same file or as siblings — implementation detail).
- The **Home tab** renders `HomeListView`.
- The **Tournament tab** renders `TournamentView`. If there is no active tournament when this tab is somehow reached, it renders a minimal empty state and the tab should not have been visible in the first place — so this is a defensive fallback, not a normal path.
- Both share the same `loadTournament()` / focus listener pattern already in HomeScreen.

The current `HomeScreen.js` file remains the home of this logic; we're restructuring within it, not spreading it across new files.

## Scorecard Tab

`ScorecardScreen` already derives its data from the active tournament + current round. As a tab, it renders exactly what it does today when navigated to without params. Any `navigation.navigate('Scorecard', { roundIndex })` calls from flow screens continue to work — they push the flow-style Scorecard on top of the tabs (so the tab bar hides), which is the correct behavior during a guided flow.

Decision: **a single Scorecard exists in two places** — once as a tab (default view, current round), once as a root-stack flow screen (parameterized). They share the component; React Navigation handles the two mount points independently. This is acceptable because the component is already state-driven.

## Visual Design

Augusta-aligned, light and dark aware via `useTheme()`.

- **Container:** `backgroundColor: theme.bg.card`, `borderTopWidth: 1`, `borderTopColor: theme.border.default`, height `60 + safeAreaInsets.bottom`.
- **Active tab:** icon + label in `theme.accent.primary`; subtle pill `theme.accent.light` behind the icon (corner radius `radius.pill`, horizontal padding `spacing.md`, vertical `spacing.xs`).
- **Inactive tab:** icon + label in `theme.text.muted`.
- **Icons (Feather):** `home` · `flag` · `edit-3`. Size 20.
- **Labels:** `typography.caption` (12px, weight 500). Same label whether active or inactive (no bold swap).
- **Tap feedback:** `activeOpacity: 0.7` on pressable, matching the rest of the app.
- **Shadow:** none on the bar itself; the top border carries the separation. Matches the restrained Augusta treatment.
- **Safe area:** respected on iOS (home indicator) and Android (gesture nav). Use `useSafeAreaInsets()`.

## Accessibility

- Each tab has an `accessibilityLabel` (e.g., "Home tab", "Tournament tab", "Scorecard tab") and `accessibilityRole="button"`.
- Active tab sets `accessibilityState={{ selected: true }}`.
- Minimum tap target 44×44.

## Non-Goals / Explicit YAGNI

- No badges (e.g., "3 holes left"). Can be added later; not in this spec.
- No haptics on tab switch. React Navigation default is fine.
- No custom transitions between tabs. Default cross-fade.
- No gesture to hide the bar. Always visible on primary screens.
- No settings or profile tab. Theme toggle stays in Home's header.

## Files Affected (expected, to be confirmed during planning)

- `App.js` — restructure to RootStack + MainTabs.
- `src/navigation/MainTabs.js` — new file, the tab navigator component.
- `src/screens/HomeScreen.js` — split internal rendering into list / tournament views.
- `src/store/tournamentStore.js` — add `isRoundInProgress(tournament)` helper and a minimal subscription primitive if none exists.
- `package.json` — add `@react-navigation/bottom-tabs` if not already present.

## Acceptance

1. With no tournaments, the app shows only the Home tab and the HomeScreen list view.
2. After creating a tournament and selecting it, a Tournament tab appears (with fade).
3. Entering a score on any hole of the current round reveals the Scorecard tab.
4. Completing the current round (all scores entered) makes the Scorecard tab disappear; the user stays on Tournament (or lands there if they were on Scorecard).
5. Deleting the active tournament collapses the bar back to Home only.
6. Pushing Setup/NextRound/any picker/editor hides the tab bar entirely for the duration of that flow.
7. Light and dark themes both render correctly, matching the Augusta palette.
