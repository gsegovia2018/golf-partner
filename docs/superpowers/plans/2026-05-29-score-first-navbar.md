# Score-First Navbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-item floating navbar with the approved five-item score-first action dock: Feed, Stats, Play/Score, History, Profile.

**Architecture:** Keep React Navigation's existing root Stack + nested bottom Tab shape. Extract the custom tab bar out of `App.js` into `src/navigation/FloatingTabBar.js`, and keep route/icon/center-action rules in a pure `src/navigation/tabBarModel.js` helper so routing behavior is easy to test without mounting the whole app.

**Tech Stack:** Expo SDK 54, React Native 0.81, React Navigation bottom tabs, `@expo/vector-icons` MaterialCommunityIcons, Jest + `@testing-library/react-native`.

---

## File Structure

- Create `src/navigation/tabBarModel.js`: pure metadata and routing helpers for the bottom navbar.
- Create `src/navigation/FloatingTabBar.js`: presentational/custom tab bar component plus live-round subscription.
- Create `src/navigation/__tests__/tabBarModel.test.js`: focused tests for route order, icon metadata, and Play vs Score center routing.
- Create `src/navigation/__tests__/FloatingTabBar.test.js`: component tests for visible labels/accessibility labels and center action navigation.
- Modify `App.js`: remove inline `FloatingTabBar` implementation, import the extracted component, and add `MyStats` and `Profile` to `MainTabs`.

## Task 1: Add The Pure Tab-Bar Model

**Files:**
- Create: `src/navigation/tabBarModel.js`
- Test: `src/navigation/__tests__/tabBarModel.test.js`

- [ ] **Step 1: Write the failing model tests**

Create `src/navigation/__tests__/tabBarModel.test.js`:

```javascript
import {
  CENTER_ROUTE_NAME,
  SCORECARD_ROUTE_NAME,
  TAB_ROUTE_NAMES,
  getTabBarItem,
  isCenterTab,
} from '../tabBarModel';

describe('tabBarModel', () => {
  test('defines the approved navbar route order', () => {
    expect(TAB_ROUTE_NAMES).toEqual([
      'Feed',
      'MyStats',
      'Home',
      'History',
      'Profile',
    ]);
  });

  test('maps secondary routes to modern MaterialCommunityIcons metadata', () => {
    expect(getTabBarItem('Feed')).toMatchObject({
      routeName: 'Feed',
      targetRouteName: 'Feed',
      label: 'Feed',
      icon: 'newspaper-variant-outline',
      center: false,
    });
    expect(getTabBarItem('MyStats')).toMatchObject({
      routeName: 'MyStats',
      targetRouteName: 'MyStats',
      label: 'Stats',
      icon: 'chart-bar',
      center: false,
    });
    expect(getTabBarItem('History')).toMatchObject({
      routeName: 'History',
      targetRouteName: 'History',
      label: 'History',
      icon: 'history',
      center: false,
    });
    expect(getTabBarItem('Profile')).toMatchObject({
      routeName: 'Profile',
      targetRouteName: 'Profile',
      label: 'Profile',
      icon: 'account-circle-outline',
      center: false,
    });
  });

  test('uses Home as the center tab route', () => {
    expect(CENTER_ROUTE_NAME).toBe('Home');
    expect(isCenterTab('Home')).toBe(true);
    expect(isCenterTab('Feed')).toBe(false);
  });

  test('center action opens Home as Play when no round is live', () => {
    expect(getTabBarItem('Home', { roundLive: false })).toMatchObject({
      routeName: 'Home',
      targetRouteName: CENTER_ROUTE_NAME,
      label: 'Play',
      icon: 'flag-variant',
      center: true,
      live: false,
    });
  });

  test('center action opens Scorecard as Score when a round is live', () => {
    expect(SCORECARD_ROUTE_NAME).toBe('Scorecard');
    expect(getTabBarItem('Home', { roundLive: true })).toMatchObject({
      routeName: 'Home',
      targetRouteName: SCORECARD_ROUTE_NAME,
      label: 'Score',
      icon: 'scoreboard-outline',
      center: true,
      live: true,
    });
  });
});
```

- [ ] **Step 2: Run the model test to verify it fails**

Run:

```bash
npm test -- src/navigation/__tests__/tabBarModel.test.js --runInBand
```

Expected: FAIL because `../tabBarModel` does not exist yet.

- [ ] **Step 3: Implement the tab-bar model**

Create `src/navigation/tabBarModel.js`:

```javascript
export const CENTER_ROUTE_NAME = 'Home';
export const SCORECARD_ROUTE_NAME = 'Scorecard';

export const TAB_ROUTE_NAMES = [
  'Feed',
  'MyStats',
  CENTER_ROUTE_NAME,
  'History',
  'Profile',
];

const TAB_BAR_ITEMS = {
  Feed: {
    label: 'Feed',
    icon: 'newspaper-variant-outline',
  },
  MyStats: {
    label: 'Stats',
    icon: 'chart-bar',
  },
  Home: {
    label: 'Play',
    icon: 'flag-variant',
  },
  History: {
    label: 'History',
    icon: 'history',
  },
  Profile: {
    label: 'Profile',
    icon: 'account-circle-outline',
  },
};

export function isCenterTab(routeName) {
  return routeName === CENTER_ROUTE_NAME;
}

export function getTabBarItem(routeName, { roundLive = false } = {}) {
  const base = TAB_BAR_ITEMS[routeName] ?? {
    label: routeName,
    icon: 'circle-outline',
  };
  const center = isCenterTab(routeName);

  if (!center) {
    return {
      ...base,
      routeName,
      targetRouteName: routeName,
      center: false,
    };
  }

  const live = Boolean(roundLive);
  return {
    ...base,
    routeName,
    targetRouteName: live ? SCORECARD_ROUTE_NAME : CENTER_ROUTE_NAME,
    label: live ? 'Score' : 'Play',
    icon: live ? 'scoreboard-outline' : 'flag-variant',
    center: true,
    live,
  };
}
```

- [ ] **Step 4: Run the model test to verify it passes**

Run:

```bash
npm test -- src/navigation/__tests__/tabBarModel.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the pure model**

```bash
git add src/navigation/tabBarModel.js src/navigation/__tests__/tabBarModel.test.js
git commit -m "feat(nav): add score-first tab model"
```

## Task 2: Extract And Test The Custom Floating Tab Bar

**Files:**
- Create: `src/navigation/FloatingTabBar.js`
- Test: `src/navigation/__tests__/FloatingTabBar.test.js`

- [ ] **Step 1: Write the failing component tests**

Create `src/navigation/__tests__/FloatingTabBar.test.js`:

```javascript
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import FloatingTabBar from '../FloatingTabBar';

const loadTournament = jest.fn();
const isRoundInProgress = jest.fn();
const subscribeTournamentChanges = jest.fn(() => jest.fn());

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: (...args) => loadTournament(...args),
  isRoundInProgress: (...args) => isRoundInProgress(...args),
  subscribeTournamentChanges: (...args) => subscribeTournamentChanges(...args),
}));

function makeState(index = 2) {
  const names = ['Feed', 'MyStats', 'Home', 'History', 'Profile'];
  return {
    index,
    routes: names.map((name) => ({ key: `${name}-key`, name })),
  };
}

function makeNavigation() {
  return {
    emit: jest.fn(() => ({ defaultPrevented: false })),
    navigate: jest.fn(),
    isFocused: jest.fn(() => true),
  };
}

function renderTabBar({ index = 2, navigation = makeNavigation() } = {}) {
  const state = makeState(index);
  const result = render(
    <SafeAreaProvider>
      <ThemeProvider>
        <FloatingTabBar state={state} navigation={navigation} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return { ...result, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadTournament.mockResolvedValue({});
  isRoundInProgress.mockReturnValue(false);
});

describe('FloatingTabBar', () => {
  test('renders the five approved navbar destinations as accessible buttons', () => {
    const { getByLabelText } = renderTabBar();

    expect(getByLabelText('Feed')).toBeTruthy();
    expect(getByLabelText('Stats')).toBeTruthy();
    expect(getByLabelText('Play')).toBeTruthy();
    expect(getByLabelText('History')).toBeTruthy();
    expect(getByLabelText('Profile')).toBeTruthy();
  });

  test('routes secondary tabs by their tab route names', () => {
    const { getByLabelText, navigation } = renderTabBar();

    fireEvent.press(getByLabelText('Stats'));
    fireEvent.press(getByLabelText('Profile'));

    expect(navigation.navigate).toHaveBeenCalledWith('MyStats');
    expect(navigation.navigate).toHaveBeenCalledWith('Profile');
  });

  test('routes the center action to Home when no round is live', () => {
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    fireEvent.press(getByLabelText('Play'));

    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  test('changes the center action to Score and routes to Scorecard when a round is live', async () => {
    loadTournament.mockResolvedValue({ id: 'tournament-1' });
    isRoundInProgress.mockReturnValue(true);
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    await waitFor(() => expect(getByLabelText('Score')).toBeTruthy());
    fireEvent.press(getByLabelText('Score'));

    expect(navigation.navigate).toHaveBeenCalledWith('Scorecard');
  });
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
npm test -- src/navigation/__tests__/FloatingTabBar.test.js --runInBand
```

Expected: FAIL because `../FloatingTabBar` does not exist yet.

- [ ] **Step 3: Implement the extracted FloatingTabBar component**

Create `src/navigation/FloatingTabBar.js`:

```javascript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';
import { loadTournament, isRoundInProgress, subscribeTournamentChanges } from '../store/tournamentStore';
import { getTabBarItem, isCenterTab } from './tabBarModel';

export default function FloatingTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => tabBarStyles(theme), [theme]);
  const [roundLive, setRoundLive] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      loadTournament()
        .then((t) => {
          if (!cancelled) setRoundLive(isRoundInProgress(t));
        })
        .catch(() => {});
    };

    check();
    const unsub = subscribeTournamentChanges(check);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigation]);

  return (
    <View style={[styles.slot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const item = getTabBarItem(route.name, { roundLive });
          const center = isCenterTab(route.name);
          const selected = focused && (!center || !item.live);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!event.defaultPrevented && (!focused || item.targetRouteName !== route.name)) {
              navigation.navigate(item.targetRouteName);
            }
          };

          const iconColor = center
            ? item.live
              ? theme.masters.yellow
              : theme.text.inverse
            : focused
              ? theme.accent.primary
              : theme.text.muted;

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={selected ? { selected: true } : {}}
              accessibilityLabel={item.label}
              onPress={onPress}
              activeOpacity={0.82}
              style={[styles.tab, center && styles.centerTab]}
            >
              <View
                style={[
                  center ? styles.centerButton : styles.secondaryButton,
                  center && item.live && styles.centerButtonLive,
                  !center && focused && styles.secondaryButtonActive,
                ]}
              >
                <MaterialCommunityIcons name={item.icon} size={center ? 25 : 22} color={iconColor} />
                {center && <Text style={[styles.centerLabel, item.live && styles.centerLabelLive]}>{item.label}</Text>}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function tabBarStyles(theme) {
  return StyleSheet.create({
    slot: {
      backgroundColor: theme.bg.primary,
      paddingHorizontal: 20,
      paddingTop: 18,
    },
    bar: {
      flexDirection: 'row',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'space-around',
      minHeight: 68,
      paddingHorizontal: 8,
      borderRadius: 22,
      backgroundColor: theme.isDark ? theme.bg.elevated : 'rgba(255,255,255,0.96)',
      borderWidth: 1,
      borderColor: theme.isDark
        ? theme.glass?.border ?? theme.border.default
        : theme.border.default,
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.42 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 14,
      overflow: 'visible',
    },
    tab: {
      flex: 1,
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerTab: {
      minHeight: 76,
    },
    secondaryButton: {
      width: 46,
      height: 46,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonActive: {
      backgroundColor: theme.accent.light,
    },
    centerButton: {
      width: 68,
      height: 68,
      marginTop: -26,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: theme.accent.primary,
      borderWidth: 3,
      borderColor: theme.bg.primary,
      shadowColor: theme.accent.primary,
      shadowOpacity: theme.isDark ? 0.25 : 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 16,
    },
    centerButtonLive: {
      backgroundColor: theme.isDark ? theme.bg.primary : '#14231d',
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.5 : 0.22,
    },
    centerLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 10,
      lineHeight: 12,
      color: theme.text.inverse,
    },
    centerLabelLive: {
      color: theme.masters.yellow,
    },
  });
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run:

```bash
npm test -- src/navigation/__tests__/FloatingTabBar.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the extracted tab bar**

```bash
git add src/navigation/FloatingTabBar.js src/navigation/__tests__/FloatingTabBar.test.js
git commit -m "feat(nav): add score-first floating tab bar"
```

## Task 3: Wire The New Navbar Into App.js

**Files:**
- Modify: `App.js`

- [ ] **Step 1: Update imports**

In `App.js`, replace the React Native and safe-area imports:

```javascript
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
```

Remove these imports from `App.js`:

```javascript
import { Feather } from '@expo/vector-icons';
import { CONTENT_MAX_WIDTH } from './src/theme/responsive';
import { loadTournament, isRoundInProgress, subscribeTournamentChanges } from './src/store/tournamentStore';
```

Add this import near the other local imports:

```javascript
import FloatingTabBar from './src/navigation/FloatingTabBar';
```

- [ ] **Step 2: Delete the old inline tab-bar implementation from App.js**

Remove the entire old inline block:

```javascript
const TAB_META = {
  Feed: { icon: 'rss', label: 'Feed' },
  Home: { icon: 'flag', label: 'Play' },
  History: { icon: 'clock', label: 'History' },
};

function FloatingTabBar({ state, navigation }) {
  // delete the old inline implementation
}

function tabBarStyles(theme) {
  // delete the old inline styles
}
```

The next declaration after `configureNotificationHandler();` should be `function MainTabs()`.

- [ ] **Step 3: Update the MainTabs route set**

Replace `MainTabs` with:

```javascript
// Primary navigation: Feed, personal Stats, the raised Play/Score action,
// History, and Profile. The center route keeps the name "Home" so existing
// navigate('Home') targets still resolve; the custom tab bar redirects it to
// Scorecard while a round is live.
function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="MyStats" component={MyStatsScreen} />
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        initialParams={{ viewMode: 'list' }}
      />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
```

Keep the existing root-stack `Stats`, `MyStats`, and `Profile` screens. `Stats` remains the per-tournament stats route; `MyStats` and `Profile` can still be pushed from flow screens outside `MainTabs`.

- [ ] **Step 4: Run focused nav tests**

Run:

```bash
npm test -- src/navigation/__tests__/tabBarModel.test.js src/navigation/__tests__/FloatingTabBar.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run lint on the changed files**

Run:

```bash
npm run lint -- App.js src/navigation/FloatingTabBar.js src/navigation/tabBarModel.js src/navigation/__tests__/FloatingTabBar.test.js src/navigation/__tests__/tabBarModel.test.js
```

Expected: PASS with no unused imports in `App.js`.

- [ ] **Step 6: Commit App.js wiring**

```bash
git add App.js
git commit -m "feat(nav): wire score-first tabs"
```

## Task 4: Final Verification

**Files:**
- No required source changes unless verification exposes defects.

- [ ] **Step 1: Run all focused navbar tests**

Run:

```bash
npm test -- src/navigation/__tests__/tabBarModel.test.js src/navigation/__tests__/FloatingTabBar.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite if focused checks pass**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS. If unrelated pre-existing tests fail, capture the failing test names and confirm whether failures touch navbar behavior before changing anything.

- [ ] **Step 3: Run project lint**

Run:

```bash
npm run lint
```

Expected: PASS. If the dirty worktree already has unrelated lint failures, do not modify unrelated files; record the exact failures and continue only if navbar files are clean.

- [ ] **Step 4: Run web build**

Run:

```bash
npm run build:web
```

Expected: static export completes successfully.

- [ ] **Step 5: Browser smoke test**

Start the web app:

```bash
npm run web -- --port 8081
```

Open `http://localhost:8081` with the Browser plugin. Verify the app loads without a redbox. If a logged-in session is available, verify the bottom navbar shows Feed, Stats, Play/Score, History, and Profile, and that the secondary tabs are icon-only while the center action shows text.

- [ ] **Step 6: Final commit if verification fixes were needed**

If Task 4 required fixes, commit only the navbar-related files:

```bash
git add App.js src/navigation/FloatingTabBar.js src/navigation/tabBarModel.js src/navigation/__tests__/FloatingTabBar.test.js src/navigation/__tests__/tabBarModel.test.js
git commit -m "fix(nav): verify score-first navbar"
```
