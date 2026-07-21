# Clubhouse UI Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved "Clubhouse" light-theme direction: refined cream/green tokens with hairline borders and no card shadows, muted gold reserved for winners, a "jump back in" live-round hero on Home, serif display moments (hole numeral, handicap index), and a press-state motion pass.

**Architecture:** The app is token-driven (`useTheme()` in ~125 files), so most of the direction lands as value changes in `src/theme/tokens.js`. The rest is a hardcoded-gold sweep to a new `semantic.winner` token, one new Home component fed by the same `tournamentStore` live-round pattern the tab bar already uses, one new `PressableScale` primitive (Reanimated 4), and two serif touch-ups.

**Tech Stack:** Expo SDK 54, React Native 0.81, react-native-reanimated ~4.1.1 (installed), expo-haptics (installed), Jest (jest-expo).

**Reference:** The approved mockup (Alternative 01 "Clubhouse") in the session artifact; palette: ground `#f6f3ee`, card `#ffffff`, hairline `#e7e2d5`, accent `#006747`, hero surface `#0f3d2c`, winner gold `#a9821e` (light) / `#ffd700` (dark surfaces).

## Global Constraints

- **Do not modify any `dark` theme values** in `tokens.js` — the dark theme ships unchanged.
- **Do not change the shape of existing exports** in `tokens.js` (only add `semantic.winner`); existing consumers must not break.
- **No new npm dependencies.**
- **`npm run lint` must stay clean; the full Jest suite must stay green** (~124 suites / ~1500 tests).
- Fonts already loaded in `App.js`: use exact family names `PlayfairDisplay-Bold`, `PlayfairDisplay-Black`, `PlusJakartaSans-*` — never `fontWeight` with a static custom font family.
- Reduced motion must be respected in all new animation code (`useReducedMotion` from `react-native-reanimated`).
- Commit after each task with a conventional-commit message.

---

### Task 1: Clubhouse tokens

**Files:**
- Modify: `src/theme/tokens.js`
- Test: `src/theme/__tests__/tokens.clubhouse.test.js` (create)

**Interfaces:**
- Produces: `semantic.winner = { light: '#a9821e', dark: '#ffd700' }` — Task 2 replaces hardcoded `#ffd700` with this. Light theme: `light.border.default === '#e7e2d5'`, `light.shadow.card` is a no-op shadow.

- [ ] **Step 1: Write the failing test**

Create `src/theme/__tests__/tokens.clubhouse.test.js`:

```js
import { light, dark, semantic } from '../tokens';

describe('Clubhouse tokens', () => {
  it('uses hairline borders and flat cards in light theme', () => {
    expect(light.border.default).toBe('#e7e2d5');
    expect(light.shadow.card.shadowOpacity).toBe(0);
    expect(light.shadow.card.elevation).toBe(0);
  });

  it('exposes a mode-aware winner gold', () => {
    expect(semantic.winner).toEqual({ light: '#a9821e', dark: '#ffd700' });
  });

  it('keeps the dark theme untouched', () => {
    expect(dark.bg.primary).toBe('#0c1a14');
    expect(dark.shadow.card.shadowOpacity).toBe(0.2);
    expect(dark.border.default).toBe('rgba(255,255,255,0.07)');
  });

  it('keeps existing semantic shape for consumers', () => {
    expect(semantic.rank.gold).toBe('#d4af37');
    expect(semantic.masters.yellow).toBe('#ffd700');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/theme/__tests__/tokens.clubhouse.test.js`
Expected: FAIL — `light.border.default` is `'#ece8e1'`, `semantic.winner` undefined.

- [ ] **Step 3: Apply the token changes**

In `src/theme/tokens.js`, change ONLY these values inside `light` (lines 19–27) and add `winner` to `semantic` (after `rank`, line 69):

```js
  border: {
    default:   '#e7e2d5',
    subtle:    '#f0ede8',
  },
  shadow: {
    card:     { shadowColor: '#000', shadowOpacity: 0, shadowOffset: { width: 0, height: 0 }, shadowRadius: 0, elevation: 0 },
    elevated: { shadowColor: '#0f3d2c', shadowOpacity: 0.10, shadowOffset: { width: 0, height: 4 }, shadowRadius: 14, elevation: 4 },
    accent:   { shadowColor: '#006747', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
  },
```

```js
  winner: {
    light: '#a9821e',
    dark:  '#ffd700',
  },
```

Do not touch `dark`, `typography`, `fonts`, `spacing`, `radius`.

- [ ] **Step 4: Run the new test and the full theme suite**

Run: `npx jest src/theme`
Expected: PASS.

- [ ] **Step 5: Full suite + lint sanity**

Run: `npx jest --silent 2>&1 | tail -5 && npm run lint`
Expected: all suites pass (flat cards may alter no snapshot; if a snapshot fails, inspect — only shadow/border values may differ — then `npx jest -u` for those snapshots only).

- [ ] **Step 6: Commit**

```bash
git add src/theme/tokens.js src/theme/__tests__/tokens.clubhouse.test.js
git commit -m "feat(theme): Clubhouse light tokens — hairline borders, flat cards, winner gold"
```

---

### Task 2: Gold sweep — `#ffd700` → `semantic.winner`

**Files (every production site of literal `#ffd700` / `'#ffd700'+'66'` outside tokens.js):**
- Modify: `src/screens/HomeScreen.js:1659,1676,2696,2708`
- Modify: `src/screens/ProfileScreen.js`, `src/screens/PlayerPickerScreen.js`, `src/screens/PlayersScreen.js` (×2), `src/screens/SetupScreen.js`, `src/screens/SetNewPasswordScreen.js`, `src/screens/StatsScreen.js`, `src/screens/AuthScreen.js`, `src/screens/FriendsScreen.js`, `src/screens/editTeams/EditTeamsView.js`, `src/screens/NextRoundScreen.js` (locate with `grep -n ffd700 <file>`)
- Modify: `src/components/ShareableCard.js`, `src/components/RoundScoreboard.js:173`, `src/components/CommentThread.js`, `src/components/ErrorBoundary.js`, `src/components/StatDetailSheet.js` (×2), `src/components/QuickStartCourses.js:642`, `src/components/LoadingSplash.js` (×3), `src/components/feed/FeedRoundCard.js:347`, `src/components/scorecard/constants.js:99,111`, `src/components/scorecard/styles.js`
- Leave alone: `src/theme/tokens.js` (`semantic.masters.yellow` stays), `src/screens/__tests__/StatsScreen.test.js` (update only if an assertion breaks).

**Interfaces:**
- Consumes: `semantic.winner` from Task 1.
- Produces: no new interfaces. Replacement rule for later tasks: winner/rank gold on a **light surface** → `semantic.winner[theme?.isDark ? 'dark' : 'light']` (in `styles(t)` factories: `t.isDark ? semantic.winner.dark : semantic.winner.light`); gold rendered on a **dark surface regardless of theme** (the deep-green "masters" leaderboard card in HomeScreen, ShareableCard's branded export, LoadingSplash's splash ring, scorecard "Augusta gold" accents in `constants.js`) → `semantic.winner.dark`.

- [ ] **Step 1: Enumerate the sites**

Run: `grep -rn --include='*.js' -i "ffd700" src | grep -v tokens.js | grep -v __tests__`
Expected: ~27 lines. Keep this list open; every line must be gone by Step 4.

- [ ] **Step 2: Replace per the surface rule**

For each file: add `import { semantic } from '<rel-path>/theme/tokens';` if absent, then replace the literal. Two worked examples that cover both patterns —

`src/screens/HomeScreen.js:1659` (rank medal colors, light surface, `t` in scope):

```js
const rankColors = [t.isDark ? semantic.winner.dark : semantic.winner.light, '#c0c8d4', '#daa06d'];
```

`src/screens/HomeScreen.js:2708` (masters leaderboard card — dark-green surface in both themes):

```js
mastersPoints: { fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 16, marginRight: 8 },
```

`src/components/RoundScoreboard.js:173` keeps its alpha suffix: `borderColor: semantic.winner.dark + '66',` (it decorates the gold winner chip on tinted cards in both themes — verify visually in Task 6; if it reads muddy on light, switch to the mode-aware form).

- [ ] **Step 3: Run lint + tests**

Run: `npm run lint && npx jest --silent 2>&1 | tail -5`
Expected: clean. If `src/screens/__tests__/StatsScreen.test.js` asserts the literal color, update the assertion to `semantic.winner.dark`.

- [ ] **Step 4: Verify zero remaining literals**

Run: `grep -rn --include='*.js' -i "ffd700" src | grep -v tokens.js | grep -v __tests__ | wc -l`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor(theme): replace hardcoded #ffd700 with semantic.winner token"
```

---

### Task 3: Home "jump back in" live-round hero

**Files:**
- Create: `src/components/LiveRoundCard.js`
- Create: `src/lib/liveRoundSummary.js`
- Test: `src/lib/__tests__/liveRoundSummary.test.js`
- Modify: `src/screens/HomeScreen.js` (~line 1188, directly above the `Start playing` heading)

**Interfaces:**
- Consumes: `loadTournament({ refreshRemote: false, resolveIdentity: false })`, `isRoundInProgress(t)`, `subscribeTournamentChanges(fn)` from `src/store/tournamentStore` (exact pattern of `src/navigation/FloatingTabBar.js:18-39`); `roundLeaderboard(tournament, round)` from the same store (`src/store/tournamentStore.js:1547`).
- Produces: `liveRoundSummary(tournament)` → `null` when no live round, else `{ name, roundLabel, courseName, myPoints, thru, holeCount }`. `<LiveRoundCard onOpen={fn} />` renders nothing when there is no live round.

- [ ] **Step 1: Write failing tests for the summary helper**

Create `src/lib/__tests__/liveRoundSummary.test.js`:

```js
import { liveRoundSummary } from '../liveRoundSummary';

const holes = Array.from({ length: 18 }, (_, i) => ({ par: 4, strokeIndex: i + 1 }));

function makeTournament(overrides = {}) {
  return {
    name: 'Weekend Golf',
    kind: 'tournament',
    meId: 'p1',
    currentRound: 1,
    players: [{ id: 'p1', name: 'Marcos' }, { id: 'p2', name: 'Noé' }],
    rounds: [
      { courseName: 'CCVM Amarillo', holes, scores: {} },
      {
        courseName: 'CCVM Negro',
        holes,
        scores: { p1: { 1: 4, 2: 5, 3: 4 }, p2: { 1: 5, 2: 5 } },
      },
    ],
    ...overrides,
  };
}

describe('liveRoundSummary', () => {
  it('returns null without a tournament or when finished', () => {
    expect(liveRoundSummary(null)).toBeNull();
    expect(liveRoundSummary(makeTournament({ finishedAt: 123 }))).toBeNull();
  });

  it('summarizes the live round', () => {
    const s = liveRoundSummary(makeTournament());
    expect(s).not.toBeNull();
    expect(s.name).toBe('Weekend Golf');
    expect(s.roundLabel).toBe('Round 2');
    expect(s.courseName).toBe('CCVM Negro');
    expect(s.thru).toBe(3);            // my entered holes
    expect(s.holeCount).toBe(18);
    expect(typeof s.myPoints).toBe('number');
  });

  it('returns null when the round is fully scored', () => {
    const full = {};
    for (let h = 1; h <= 18; h++) full[h] = 4;
    const t = makeTournament();
    t.rounds[1].scores = { p1: { ...full }, p2: { ...full } };
    expect(liveRoundSummary(t)).toBeNull();
  });
});
```

Note for implementer: `makeTournament` mimics the real store shape; before finalizing, open `isRoundInProgress` (`src/store/tournamentStore.js:1899`) and `roundLeaderboard` (`:1547`) and confirm the field names the fixture and helper rely on (`rounds[].scores[playerId][holeNumber]`, row `playerId`/`points`). Adjust fixture/helper to the real shapes — read the functions, do not guess.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/__tests__/liveRoundSummary.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/liveRoundSummary.js`:

```js
import { isRoundInProgress, roundLeaderboard } from '../store/tournamentStore';

export function liveRoundSummary(tournament) {
  if (!tournament || !isRoundInProgress(tournament)) return null;
  const round = tournament.rounds?.[tournament.currentRound];
  if (!round) return null;

  const holeCount = round.holes?.length ?? 18;
  const myScores = round.scores?.[tournament.meId] ?? {};
  const thru = Object.values(myScores).filter((v) => v != null).length;

  let myPoints = 0;
  try {
    const rows = roundLeaderboard(tournament, round) ?? [];
    const mine = rows.find((r) => (r.playerId ?? r.id) === tournament.meId);
    if (mine && typeof mine.points === 'number') myPoints = mine.points;
  } catch {
    myPoints = 0;
  }

  return {
    name: tournament.name || 'Golf',
    roundLabel: `Round ${Number(tournament.currentRound) + 1}`,
    courseName: round.courseName || round.course?.name || '',
    myPoints,
    thru,
    holeCount,
  };
}
```

- [ ] **Step 4: Run tests to green**

Run: `npx jest src/lib/__tests__/liveRoundSummary.test.js`
Expected: PASS.

- [ ] **Step 5: Build the card component**

Create `src/components/LiveRoundCard.js` (subscription pattern copied from `FloatingTabBar.js:18-39`):

```js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { loadTournament, subscribeTournamentChanges } from '../store/tournamentStore';
import { liveRoundSummary } from '../lib/liveRoundSummary';

export default function LiveRoundCard({ onOpen }) {
  const { theme } = useTheme();
  const [summary, setSummary] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      loadTournament({ refreshRemote: false, resolveIdentity: false })
        .then((t) => { if (!cancelled) setSummary(liveRoundSummary(t)); })
        .catch(() => {});
    };
    check();
    const unsub = subscribeTournamentChanges(check);
    return () => { cancelled = true; unsub(); };
  }, []);

  if (!summary) return null;
  const s = styles(theme);

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={s.livePill}><View style={s.liveDot} /><Text style={s.liveText}>LIVE</Text></View>
        <Text style={s.overline}>{summary.roundLabel.toUpperCase()}</Text>
      </View>
      <Text style={s.name} numberOfLines={1}>{summary.name}</Text>
      <Text style={s.meta} numberOfLines={1}>
        {summary.courseName}
        {summary.thru > 0 ? ` · ${summary.myPoints} pts thru ${summary.thru}` : ''}
      </Text>
      <TouchableOpacity style={s.cta} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open scorecard">
        <Feather name="clipboard" size={15} color="#0f3d2c" />
        <Text style={s.ctaText}>Open scorecard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (t) => StyleSheet.create({
  card: {
    backgroundColor: '#0f3d2c', borderRadius: 16, padding: 16, marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.elevated),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#b3392e', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff' },
  liveText: { color: '#ffffff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
  overline: { color: 'rgba(243,239,230,0.7)', fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4 },
  name: { color: '#f3efe6', fontFamily: 'PlayfairDisplay-Bold', fontSize: 21 },
  meta: { color: 'rgba(243,239,230,0.82)', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, marginTop: 2 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    backgroundColor: '#f3efe6', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginTop: 12,
  },
  ctaText: { color: '#0f3d2c', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13 },
});
```

- [ ] **Step 6: Mount it on Home**

In `src/screens/HomeScreen.js`, import it (`import LiveRoundCard from '../components/LiveRoundCard';`) and render it immediately above the `Start playing` heading (before line ~1189's `<Text style={s.startHeading}>`):

```jsx
<LiveRoundCard onOpen={() => navigation.navigate('Scorecard')} />
```

Match how the surrounding code navigates to the scorecard (search `navigate('Scorecard'` in HomeScreen and reuse the exact call including any params).

- [ ] **Step 7: Run suite + lint**

Run: `npx jest --silent 2>&1 | tail -5 && npm run lint`
Expected: green/clean (HomeScreen tests must still pass — the card renders `null` in tests with no live tournament).

- [ ] **Step 8: Commit**

```bash
git add src/components/LiveRoundCard.js src/lib/liveRoundSummary.js src/lib/__tests__/liveRoundSummary.test.js src/screens/HomeScreen.js
git commit -m "feat(home): jump-back-in live round hero card"
```

---

### Task 4: PressableScale primitive + adoption

**Files:**
- Create: `src/components/ui/PressableScale.js`
- Test: `src/components/ui/__tests__/PressableScale.test.js`
- Modify: `src/navigation/FloatingTabBar.js` (tab touchables), `src/screens/HomeScreen.js` (the two start tiles in `startTilesRow`, ~line 1190), `src/components/scorecard/PlayerCard.js` (the − / + stepper touchables)

**Interfaces:**
- Produces: `<PressableScale onPress style activeScale={0.97} {...touchableProps}>` — drop-in replacement for `TouchableOpacity` that scales to 0.97 over 160ms with `Easing.bezier(0.23, 1, 0.32, 1)`; no scale when reduced motion is on.

- [ ] **Step 1: Write the failing render test**

Create `src/components/ui/__tests__/PressableScale.test.js`:

```js
import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import PressableScale from '../PressableScale';

describe('PressableScale', () => {
  it('renders children and fires onPress', () => {
    const onPress = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <PressableScale onPress={onPress} accessibilityLabel="tap me">
          <Text>Tap</Text>
        </PressableScale>
      );
    });
    const pressable = tree.root.findByProps({ accessibilityLabel: 'tap me' });
    act(() => { pressable.props.onPress?.(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/components/ui/__tests__/PressableScale.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/ui/PressableScale.js`:

```js
import React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export default function PressableScale({
  children, style, activeScale = 0.97, disabled, ...rest
}) {
  const reduced = typeof useReducedMotion === 'function' ? useReducedMotion() : false;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const to = (v) => {
    scale.value = withTiming(v, { duration: 160, easing: EASE_OUT });
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => { if (!reduced && !disabled) to(activeScale); rest.onPressIn?.(e); }}
      onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
```

- [ ] **Step 4: Run test to green**

Run: `npx jest src/components/ui/__tests__/PressableScale.test.js`
Expected: PASS (jest-expo ships the reanimated mock).

- [ ] **Step 5: Adopt in the three surfaces**

1. `src/navigation/FloatingTabBar.js`: replace the per-tab `TouchableOpacity` with `PressableScale` (keep all existing props/styles; `activeScale={0.97}`).
2. `src/screens/HomeScreen.js`: the two start tiles inside `startTilesRow` (~line 1190) — replace their `TouchableOpacity` wrappers with `PressableScale`.
3. `src/components/scorecard/PlayerCard.js`: the − and + stepper touchables — replace with `PressableScale`, passing through `onLongPress`, `delayLongPress`, `disabled` untouched.

Preserve every existing prop (`accessibilityRole`, `hitSlop`, `testID`, handlers). Where a replaced `TouchableOpacity` relied on `activeOpacity`, drop that prop — scale replaces it.

- [ ] **Step 6: Full suite + lint**

Run: `npx jest --silent 2>&1 | tail -5 && npm run lint`
Expected: green/clean. Scorecard and tab-bar tests must pass — if a test queried `TouchableOpacity` by type, update it to find by `testID`/props instead.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui src/navigation/FloatingTabBar.js src/screens/HomeScreen.js src/components/scorecard/PlayerCard.js
git commit -m "feat(motion): PressableScale press feedback on tabs, start tiles, steppers"
```

---

### Task 5: Serif display moments

**Files:**
- Modify: `src/components/scorecard/HolePage.js` (the big hole-number `Text`) and/or `src/components/scorecard/styles.js` (its style entry)
- Modify: `src/components/mystats/tabs/HandicapTab.js` (the big index number in the hero card)

**Interfaces:**
- Consumes: fonts loaded in `App.js` (`PlayfairDisplay-Black`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Locate the two numerals**

Run: `grep -n "holeNumber\|holeBig\|bigNum\|indexValue\|heroValue" src/components/scorecard/HolePage.js src/components/scorecard/styles.js src/components/mystats/tabs/HandicapTab.js`
Identify (a) the style for the large hole number in the scorecard hole header, and (b) the style for the big handicap index value. If the grep misses, read the render sections and find the largest `fontSize` style in each.

- [ ] **Step 2: Apply the serif**

For each of the two styles, set:

```js
fontFamily: 'PlayfairDisplay-Black',
```

Keep the existing `fontSize` and `color`. Remove any `fontWeight` from the same style object (static font families conflict with it). Do not letter-space serif numerals.

- [ ] **Step 3: Run related tests + lint**

Run: `npx jest src/components/scorecard src/components/mystats --silent 2>&1 | tail -5 && npm run lint`
Expected: green/clean (snapshot updates acceptable if only `fontFamily` changed: verify diff, then `npx jest -u` scoped to those suites).

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard src/components/mystats
git commit -m "feat(type): Playfair numerals for hole header and handicap index"
```

---

### Task 6: Verification pass

**Files:**
- No production changes expected; fixes only if verification finds issues.

- [ ] **Step 1: Full suite + lint from a clean state**

Run: `npx jest --silent 2>&1 | tail -5 && npm run lint`
Expected: all green, lint clean.

- [ ] **Step 2: Visual runtime verification (verify skill)**

Use the project's `verify` skill: run the Expo web app with Playwright and check, in the **light theme**:
1. Home shows the live-round hero when a round is in progress (create a quick game via Quick Start if needed), with LIVE pill, serif name, working "Open scorecard".
2. Cards across Home/Feed/Stats show hairline borders (`#e7e2d5`) and no shadows.
3. Winner gold reads as muted `#a9821e` on light surfaces and bright gold on the dark masters card.
4. Scorecard hole numeral and Handicap index render in Playfair.
5. Toggle **dark theme**: confirm it is visually unchanged from before this branch.

- [ ] **Step 3: Grep guards**

```bash
grep -rn --include='*.js' -i "ffd700" src | grep -v tokens.js | grep -v __tests__ | wc -l   # expect 0
git diff master --stat | tail -3                                                            # sanity: only intended files
```

- [ ] **Step 4: Commit any verification fixes**

```bash
git add -A && git commit -m "fix(clubhouse): verification pass fixes"
```

(Skip the commit if there are no changes.)

---

# Phase 2 — Mockup chrome the token swap couldn't deliver

User-approved additions after reviewing phase 1: scorecard header/hole chrome, distance-block card, My Stats serif header + pill selectors, SG bar card, coach hero surface, handicap-style stat cards, tab-bar icon/border treatment. Same Global Constraints as phase 1. Phase-1 facts that bind here: `semantic.winner` exists; light hairline is `theme.border.default` (`#e7e2d5`); the Clubhouse hero surface is `#0f3d2c` with cream ink `#f3efe6` (see `src/components/LiveRoundCard.js` for the established pattern).

### Task 7: Scorecard chrome — header buttons, de-carded hole header, distance card

**Files:**
- Modify: `src/components/scorecard/styles.js` (header + hole header styles, lines ~165-294)
- Modify: `src/screens/ScorecardScreen.js` (header buttons pick up the unified style, lines ~1554-1624)
- Modify: `src/components/scorecard/HoleDistanceBlock.js` (own makeStyles, lines ~78-120)

**Spec:**
1. **Unified header icon buttons.** Add one style `headerBtn`: `{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? theme.bg.elevated : theme.bg.secondary, borderWidth: 1, borderColor: isDark ? theme.glass.border : theme.border.default }`. Apply it to ALL header action touchables in ScorecardScreen (`backBtn`, sync indicator's touchable, `viewSwitchBtn`, the eye toggle, award, notes, camera — today a mix of bare 32px and bordered). Keep every icon, handler, dot, and conditional exactly as is; `notesHeaderDot` stays absolute-positioned. `headerTitle` stays PlusJakartaSans-Bold 17 −0.3.
2. **De-card the hole header.** `holeHeaderCard`: remove `backgroundColor`, remove the light-mode `theme.shadow.card` spread, remove `borderBottomWidth`/`borderBottomColor` — the hole info sits directly on `bg.primary`. Keep the row layout and paddings (bump paddingVertical to 16 for breathing room).
3. **Distance block becomes a card** (`HoleDistanceBlock.js` `block` style): `{ alignItems: 'center', gap: 2, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: isDark ? theme.glass?.border ?? theme.border.default : theme.border.default, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, minWidth: 128 }` (center-aligned now, not flex-end). Under the F/B line add a permanent hint `<Text style={s.mapHint}>TAP FOR MAP</Text>` with `{ color: theme.text.muted, fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.2, marginTop: 2 }`; REMOVE the trailing `chevron-right` from heroRow (the hint replaces it). The hint renders in the GPS branch and the FROM TEE branch; keep it out of the off-course/null branches. All variants (NEAREST GREEN, FROM TEE, off-course, poor fix, hazard line) keep working — only container/alignment/hint change. `hero` stays 24 ExtraBold accent.

**Tests:** run `npx jest src/components/scorecard --silent` (must stay green; update snapshots only if the diff is purely these styles). Full suite + lint before commit. Commit: `feat(scorecard): Clubhouse chrome — unified header buttons, open hole header, distance card`.

### Task 8: My Stats chrome + strokes-gained card

**Files:**
- Modify: `src/screens/MyStatsScreen.js` (headerTitle, tab styles, lines ~513-572)
- Modify: `src/components/mystats/ShotDashboard.js` (SectionCard title)
- Modify: `src/components/mystats/SGBars.js` (bar row styling)

**Spec:**
1. **Serif header:** `headerTitle` → `{ fontFamily: 'PlayfairDisplay-Bold', fontSize: 24, color: theme.text.primary, flex: 1, marginLeft: theme.spacing.sm }` (drop the `typography.heading` spread — no fontWeight with static families).
2. **Tab pills:** `tab` bg → `theme.bg.card` (white on cream) keeping hairline border; `tabActive` stays solid `accent.primary`. `tabText` fontSize 12 fontWeight 700 stays.
3. **SG dashboard title:** SectionCard title becomes dynamic: `` `Strokes gained · vs ${targetLabel}` `` where `targetLabel` is the existing target-handicap value formatted like `12-hcp target` (ShotDashboard already knows the target for its "Target gap" panel — reuse that source; scratch handicap 0 renders `scratch target`). Keep infoKey and the pencil `right` node.
4. **SG bar rows** (`SGBars.js`): track gets a rounded chip look — wrap the SVG in the existing `track` view styled `{ flex: 1, minWidth: 80, maxWidth: 200, height: 14, borderRadius: 999, backgroundColor: theme.bg.secondary, overflow: 'hidden' }`; bar `<Rect>` rx → 4; center line keeps `theme.border.default`. `label` → fontSize 11.5, fontFamily 'PlusJakartaSans-Bold', color `theme.text.muted`. `value` → fontSize 12, fontFamily 'PlusJakartaSans-ExtraBold', tabular-nums, colored `scoreColor('good')`/`scoreColor('poor')` by sign (today text.primary).

**Tests:** `npx jest src/components/mystats src/screens --silent` green; full suite + lint. Commit: `feat(mystats): serif header, card tab pills, Clubhouse strokes-gained card`.

### Task 9: Coach hero surface + stat-card overline pattern

**Files:**
- Modify: `src/components/mystats/CoachHero.js`
- Modify: `src/components/mystats/SectionCard.js` (new `titleVariant` prop)
- Modify: `src/components/mystats/tabs/HandicapTab.js` (hero number + adopt overline titles)
- Modify: `src/components/mystats/CareerMilestonesCard.js` (adopt overline title)

**Spec:**
1. **CoachHero → Clubhouse hero surface** (match LiveRoundCard's pattern): container `{ backgroundColor: '#0f3d2c', borderRadius: 16, padding: theme.spacing.lg, gap: theme.spacing.sm }` in BOTH themes (drop tone backgroundColor/borderColor on the container; no border). Kicker: keep the group label text but style `{ color: 'rgba(243,239,230,0.7)', fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.4, textTransform: 'uppercase' }`; `area` label same but right-aligned as today. Title → `{ fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: '#f3efe6' }`. Reason → `{ fontSize: 12.5, fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(243,239,230,0.85)' }`. Metric → `{ fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: '#f3efe6' }`; pointsCaption cream 70%. Proof chips: `{ backgroundColor: 'rgba(243,239,230,0.12)', borderRadius: 999 }` with cream 85% text/icon. CTA `focusBtn` → filled cream pill: `{ backgroundColor: '#f3efe6', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 }`, text/icon `#0f3d2c`, text `{ fontSize: 12.5, fontFamily: 'PlusJakartaSans-ExtraBold' }`. Tone still colors the kicker's leading group word if desired — simplest faithful move: tone only affects the small `area` label color accent; all surfaces cream-on-green. Empty-state variant gets the same surface.
2. **SectionCard `titleVariant="overline"`:** new optional prop; when set, title style becomes `{ fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.4, textTransform: 'uppercase', color: theme.text.muted }` (info button unchanged). Default variant untouched.
3. **HandicapTab:** both SectionCards ("Handicap Index", "Index evolution", "Score differentials") pass `titleVariant="overline"`. Hero number style → `{ fontSize: 38, lineHeight: 44, fontFamily: 'PlayfairDisplay-Black', color: theme.accent.primary, textAlign: 'left' }`; `heroSub` left-aligned `{ textAlign: 'left' }`, stays caption muted. Apply button unchanged.
4. **CareerMilestonesCard:** its SectionCard gets `titleVariant="overline"`.

**Tests:** `npx jest src/components/mystats --silent` green; full suite + lint. Commit: `feat(mystats): Clubhouse coach hero + overline stat-card pattern`.

### Task 10: Floating tab bar — Feather icons + hairline

**Files:**
- Modify: `src/navigation/tabBarModel.js` (icon names)
- Modify: `src/navigation/FloatingTabBar.js` (icon component + bar border)

**Spec:**
1. Swap MaterialCommunityIcons → Feather (the icon set every other screen uses). New mapping in `tabBarModel.js`: Feed `file-text`, MyStats `bar-chart-2`, Home `flag` (live: `clipboard`), History `clock`, Profile `user`. Update `getTabBarItem`'s live-icon branch accordingly.
2. `FloatingTabBar.js`: import `Feather` from `@expo/vector-icons` and render it instead of MaterialCommunityIcons (same sizes); bar style gains `borderWidth: 1, borderColor: isDark ? theme.glass.border : theme.border.default`.
3. Update `src/navigation/__tests__` expectations if any assert icon names (check first: `grep -rn "newspaper-variant\|chart-bar\|flag-variant\|scoreboard-outline" src`).

**Tests:** `npx jest src/navigation --silent` green; full suite + lint. Commit: `feat(nav): Feather tab icons + hairline floating bar`.

### Task 11: Phase-2 verification + final whole-branch review

Same as phase-1 Task 6: full suite + lint + grep guards, runtime verify (Expo web, light theme) of: scorecard header buttons/open hole header/distance card with TAP FOR MAP, My Stats serif header + pills + SG card + coach hero + handicap cards, Feather tab bar; dark theme sanity (unchanged feel, glass borders intact). Then the whole-branch final review.
