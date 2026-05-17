# Responsive Web/Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Expo / react-native-web golf app look good on wide PC monitors by constraining every screen to a centered, capped-width column, while leaving the phone layout pixel-unchanged.

**Architecture:** A single `useResponsive()` hook owns all breakpoints. A `ScreenContainer` component is a drop-in replacement for `SafeAreaView`: the outer `SafeAreaView` stays full-bleed (so the app background fills the side gutters) and an inner column caps content at 960px and centers it. A `CardGrid` component reflows card lists into 2–3 columns on wide windows. The bottom tab bar and bottom sheets get the same width cap.

**Tech Stack:** React Native 0.81 / React 19, Expo 54, react-native-web, react-navigation, Jest + jest-expo.

---

## Spec coverage / planning refinements

Spec: `docs/superpowers/specs/2026-05-17-responsive-web-layout-design.md`.

Two refinements made during planning, for transparency:

- **Grid reflow is scoped to genuine card lists** — `HistoryScreen` (game/tournament cards) and `CoursesLibraryScreen` (course cards). `FriendsScreen` and `PlayersLibraryScreen` render full-width *rows* (name + edit/delete controls), which do not reflow into columns cleanly; they stay single-column inside the centered container. `StatsScreen` is a deep vertical scroll of self-contained chart sections — it gets the centered cap only, no internal reflow. This still satisfies the spec's "reflow where it reads well".
- All ~24 screens still get the centered container (the core fix). Only the reflow set is narrowed.

---

## File Structure

**New files:**
- `src/theme/responsive.js` — breakpoint constants + pure derivation + `useResponsive()` hook.
- `src/components/ScreenContainer.js` — drop-in `SafeAreaView` replacement that centers/caps content.
- `src/components/CardGrid.js` — wrap-layout grid for card lists.
- `src/theme/__tests__/responsive.test.js` — tests for the pure derivation functions.
- `src/components/__tests__/cardGrid.test.js` — tests for the grid layout function.

**Modified files:**
- `App.js` — tab bar width cap.
- All screen files in `src/screens/` — `SafeAreaView` → `ScreenContainer`.
- `src/screens/AuthScreen.js`, `src/screens/JoinTournamentScreen.js` — form width cap (no `SafeAreaView`).
- `src/screens/HistoryScreen.js`, `src/screens/CoursesLibraryScreen.js` — `CardGrid` reflow.
- `src/components/CommentsSheet.js`, `src/components/StatDetailSheet.js`, `src/components/MediaLightbox.js` — modal width cap.

---

## Task 1: Responsive primitives (`responsive.js`)

**Files:**
- Create: `src/theme/responsive.js`
- Test: `src/theme/__tests__/responsive.test.js`

The hook itself calls `useWindowDimensions()`, but all breakpoint logic lives in pure functions so it is unit-testable without rendering.

- [ ] **Step 1: Write the failing test**

Create `src/theme/__tests__/responsive.test.js`:

```js
import {
  BREAKPOINTS,
  CONTENT_MAX_WIDTH,
  deriveResponsive,
} from '../responsive';

describe('constants', () => {
  test('breakpoints and content cap have expected values', () => {
    expect(BREAKPOINTS).toEqual({ md: 600, lg: 960 });
    expect(CONTENT_MAX_WIDTH).toBe(960);
  });
});

describe('deriveResponsive', () => {
  test('phone width is compact, 1 column, not wide', () => {
    const r = deriveResponsive(390);
    expect(r.isCompact).toBe(true);
    expect(r.isWide).toBe(false);
    expect(r.gridColumns).toBe(1);
    expect(r.width).toBe(390);
  });

  test('599 is still compact (boundary)', () => {
    expect(deriveResponsive(599).isCompact).toBe(true);
    expect(deriveResponsive(599).gridColumns).toBe(1);
  });

  test('600 is regular: not compact, not wide, 2 columns', () => {
    const r = deriveResponsive(600);
    expect(r.isCompact).toBe(false);
    expect(r.isWide).toBe(false);
    expect(r.gridColumns).toBe(2);
  });

  test('959 is still regular (boundary)', () => {
    const r = deriveResponsive(959);
    expect(r.isWide).toBe(false);
    expect(r.gridColumns).toBe(2);
  });

  test('960 is wide: 3 columns', () => {
    const r = deriveResponsive(960);
    expect(r.isCompact).toBe(false);
    expect(r.isWide).toBe(true);
    expect(r.gridColumns).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/theme/__tests__/responsive.test.js`
Expected: FAIL — `Cannot find module '../responsive'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/theme/responsive.js`:

```js
import { useWindowDimensions } from 'react-native';

// Layout breakpoints (in dp / CSS px).
//   width < md           -> compact   (phone)
//   md <= width < lg     -> regular   (large phone / tablet / small window)
//   width >= lg          -> wide      (desktop)
export const BREAKPOINTS = { md: 600, lg: 960 };

// Screen content never grows wider than this; beyond it the app background
// shows as side gutters.
export const CONTENT_MAX_WIDTH = 960;

// Pure: turn a window width into the responsive flags every screen reads.
// Kept separate from the hook so it can be unit-tested without rendering.
export function deriveResponsive(width) {
  const isCompact = width < BREAKPOINTS.md;
  const isWide = width >= BREAKPOINTS.lg;
  const gridColumns = isWide ? 3 : isCompact ? 1 : 2;
  return { width, isCompact, isWide, gridColumns };
}

// Hook: re-renders on window resize via useWindowDimensions().
export function useResponsive() {
  const { width } = useWindowDimensions();
  return deriveResponsive(width);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/theme/__tests__/responsive.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/theme/responsive.js src/theme/__tests__/responsive.test.js
git commit -m "feat: add responsive breakpoint primitives"
```

---

## Task 2: Card grid layout (`CardGrid.js`)

**Files:**
- Create: `src/components/CardGrid.js`
- Test: `src/components/__tests__/cardGrid.test.js`

`CardGrid` renders its children in a wrapping row. Each child is wrapped in a cell whose `flexBasis` is derived from the column count. The basis math lives in a pure exported function so it is testable.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/cardGrid.test.js`:

```js
import { cardCellBasis } from '../CardGrid';

describe('cardCellBasis', () => {
  test('1 column is full width', () => {
    expect(cardCellBasis(1)).toBe('100%');
  });

  test('2 columns leaves room for the gap', () => {
    // Two cells per row with a gap between -> just under 50%.
    expect(cardCellBasis(2)).toBe('48%');
  });

  test('3 columns leaves room for two gaps', () => {
    expect(cardCellBasis(3)).toBe('31%');
  });

  test('unexpected column counts fall back to full width', () => {
    expect(cardCellBasis(0)).toBe('100%');
    expect(cardCellBasis(5)).toBe('100%');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/cardGrid.test.js`
Expected: FAIL — `Cannot find module '../CardGrid'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/CardGrid.js`:

```js
import React from 'react';
import { View } from 'react-native';
import { useResponsive } from '../theme/responsive';

// Pure: flexBasis for one cell given the column count. Values sit just under
// the exact fraction so a `gap` between cells does not force a wrap.
export function cardCellBasis(columns) {
  if (columns === 2) return '48%';
  if (columns === 3) return '31%';
  return '100%';
}

// Lays its children out in a wrapping row. On compact widths gridColumns is 1,
// so this is a plain vertical stack — identical to the previous list layout.
// `columns` may be passed to override the responsive default (e.g. to cap a
// list at 2 columns even on very wide windows).
export default function CardGrid({ children, columns, gap = 12, style }) {
  const responsive = useResponsive();
  const cols = columns ?? responsive.gridColumns;
  const basis = cardCellBasis(cols);
  const items = React.Children.toArray(children);

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>
      {items.map((child, i) => (
        <View key={child.key ?? i} style={{ flexBasis: basis, flexGrow: 0, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/__tests__/cardGrid.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CardGrid.js src/components/__tests__/cardGrid.test.js
git commit -m "feat: add CardGrid wrap-layout component"
```

---

## Task 3: ScreenContainer component

**Files:**
- Create: `src/components/ScreenContainer.js`

This is a pure presentational wrapper (a `SafeAreaView` plus a centered inner `View`). It has no branching logic, so there is no unit test — it is verified visually in Task 11. Keep it tiny.

- [ ] **Step 1: Create the component**

Create `src/components/ScreenContainer.js`:

```js
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';

// Drop-in replacement for `SafeAreaView` in screen roots.
//
// The outer SafeAreaView stays full-bleed so the app background fills the side
// gutters on wide windows. The inner column caps content at CONTENT_MAX_WIDTH
// and centers it. On phones the window is narrower than the cap, so the inner
// column is simply full width -- a visual no-op.
//
// All props except `style`/`children` (e.g. `edges`) are forwarded to the
// SafeAreaView. `style` is applied to the outer SafeAreaView so screen-level
// `flex:1` + `backgroundColor` keep working unchanged.
export default function ScreenContainer({ style, children, ...rest }) {
  return (
    <SafeAreaView style={[styles.fill, style]} {...rest}>
      <View style={styles.column}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
```

- [ ] **Step 2: Verify it parses**

Run: `npx eslint src/components/ScreenContainer.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScreenContainer.js
git commit -m "feat: add ScreenContainer centered-column wrapper"
```

---

## Task 4: Apply ScreenContainer to all SafeAreaView screens

**Files (modify each):**
`src/screens/` — `ClaimPlayerScreen.js`, `CourseEditorScreen.js`, `CourseLibraryDetailScreen.js`, `CoursePickerScreen.js`, `CoursesLibraryScreen.js`, `EditTeamsScreen.js`, `EditTournamentScreen.js`, `FeedScreen.js`, `FinishedScreen.js`, `FriendsScreen.js`, `GalleryScreen.js`, `HistoryScreen.js`, `HomeScreen.js`, `MembersScreen.js`, `NextRoundScreen.js`, `PlayerPickerScreen.js`, `PlayersLibraryScreen.js`, `ProfileScreen.js`, `RoundSummaryScreen.js`, `ScorecardScreen.js`, `SetupScreen.js`, `StatsScreen.js`.

This is mechanical and identical for every file. `AuthScreen.js` and `JoinTournamentScreen.js` are NOT in this list — they have no `SafeAreaView` and are handled in Task 5.

**The transformation, per file:**

1. Find the import line:
   ```js
   import { SafeAreaView } from 'react-native-safe-area-context';
   ```
   Replace it with:
   ```js
   import ScreenContainer from '../components/ScreenContainer';
   ```
   - If the file also uses `useSafeAreaInsets` from the same import (e.g. `import { SafeAreaView, useSafeAreaInsets } from ...`), keep that import and add the `ScreenContainer` import on its own line instead of removing it:
     ```js
     import { useSafeAreaInsets } from 'react-native-safe-area-context';
     import ScreenContainer from '../components/ScreenContainer';
     ```

2. Replace **every** `<SafeAreaView ...>` opening tag with `<ScreenContainer ...>` — keep all props (`style`, `edges`) exactly as they are.

3. Replace **every** `</SafeAreaView>` closing tag with `</ScreenContainer>`.

Several screens render `SafeAreaView` more than once (loading / error / main states — e.g. `HomeScreen.js`, `ScorecardScreen.js`, `NextRoundScreen.js`, `CourseLibraryDetailScreen.js`). Replace **all** occurrences in each file; the centered column is harmless on loading/error states.

- [ ] **Step 1: Transform the primary screens first**

Apply the transformation to `FeedScreen.js`, `HomeScreen.js`, `HistoryScreen.js`, `ScorecardScreen.js`, `StatsScreen.js`.

- [ ] **Step 2: Verify the primary screens lint clean**

Run: `npx eslint src/screens/FeedScreen.js src/screens/HomeScreen.js src/screens/HistoryScreen.js src/screens/ScorecardScreen.js src/screens/StatsScreen.js`
Expected: no errors (no unused `SafeAreaView`, no missing `ScreenContainer`).

- [ ] **Step 3: Commit the primary screens**

```bash
git add src/screens/FeedScreen.js src/screens/HomeScreen.js src/screens/HistoryScreen.js src/screens/ScorecardScreen.js src/screens/StatsScreen.js
git commit -m "feat: center primary screens with ScreenContainer"
```

- [ ] **Step 4: Transform the remaining screens**

Apply the same transformation to: `ClaimPlayerScreen.js`, `CourseEditorScreen.js`, `CourseLibraryDetailScreen.js`, `CoursePickerScreen.js`, `CoursesLibraryScreen.js`, `EditTeamsScreen.js`, `EditTournamentScreen.js`, `FinishedScreen.js`, `FriendsScreen.js`, `GalleryScreen.js`, `MembersScreen.js`, `NextRoundScreen.js`, `PlayerPickerScreen.js`, `PlayersLibraryScreen.js`, `ProfileScreen.js`, `RoundSummaryScreen.js`, `SetupScreen.js`.

- [ ] **Step 5: Verify the remaining screens lint clean**

Run: `npx eslint src/screens/`
Expected: no errors.

- [ ] **Step 6: Commit the remaining screens**

```bash
git add src/screens/
git commit -m "feat: center remaining screens with ScreenContainer"
```

---

## Task 5: Cap form width on Auth & Join screens

**Files:**
- Modify: `src/screens/AuthScreen.js` (style `inner`, ~line 227)
- Modify: `src/screens/JoinTournamentScreen.js` (styles `content` and `header`)

These two screens use `KeyboardAvoidingView` as their root (no `SafeAreaView`). They are simple centered forms — they only need their content width capped so the form/card does not stretch on desktop.

- [ ] **Step 1: Cap the AuthScreen form**

In `src/screens/AuthScreen.js`, the `inner` style is currently:
```js
  inner: { paddingHorizontal: 24 },
```
Change it to:
```js
  inner: { paddingHorizontal: 24, width: '100%', maxWidth: 460, alignSelf: 'center' },
```

- [ ] **Step 2: Cap the JoinTournamentScreen content**

In `src/screens/JoinTournamentScreen.js`, find the `content` style in the `StyleSheet.create` block. Add `width: '100%'`, `maxWidth: 460`, and `alignSelf: 'center'` to it, keeping its existing properties. Also find the `header` style and add `width: '100%'`, `maxWidth: 460`, `alignSelf: 'center'` so the header aligns with the content.

- [ ] **Step 3: Verify**

Run: `npx eslint src/screens/AuthScreen.js src/screens/JoinTournamentScreen.js`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/AuthScreen.js src/screens/JoinTournamentScreen.js
git commit -m "feat: cap form width on Auth and Join screens"
```

---

## Task 6: Reflow HistoryScreen card lists into a grid

**Files:**
- Modify: `src/screens/HistoryScreen.js`

`HistoryScreen` renders `tournaments.map(renderCard)` and `games.map(renderCard)` as stacked cards, plus a `statsGrid` that already wraps. Convert the two card lists to `CardGrid`, and tie the `statCell.flexBasis` to the responsive column count.

- [ ] **Step 1: Add the imports**

At the top of `src/screens/HistoryScreen.js`, after the existing component imports, add:
```js
import CardGrid from '../components/CardGrid';
import { useResponsive } from '../theme/responsive';
```

- [ ] **Step 2: Read the responsive state and pass it to makeStyles**

Inside `HistoryScreen`, the line `const s = makeStyles(theme);` currently builds styles. Replace it with:
```js
  const { gridColumns } = useResponsive();
  const s = makeStyles(theme, gridColumns);
```

- [ ] **Step 3: Wrap the tournament list**

Find:
```jsx
                  <Text style={s.sectionLabel}>TOURNAMENTS</Text>
                  {tournaments.map(renderCard)}
```
Replace with:
```jsx
                  <Text style={s.sectionLabel}>TOURNAMENTS</Text>
                  <CardGrid>{tournaments.map(renderCard)}</CardGrid>
```

- [ ] **Step 4: Wrap the games list**

Find:
```jsx
                  <Text style={s.sectionLabel}>GAMES</Text>
                  {games.map(renderCard)}
```
Replace with:
```jsx
                  <Text style={s.sectionLabel}>GAMES</Text>
                  <CardGrid>{games.map(renderCard)}</CardGrid>
```

- [ ] **Step 5: Remove the per-card bottom margin (the grid `gap` handles spacing)**

In `makeStyles`, the `card` style contains `padding: 16, marginBottom: 10, flexDirection: 'row', ...`. Remove only `marginBottom: 10,` from it. Leave every other `card` property unchanged.

- [ ] **Step 6: Parameterise makeStyles and the statCell basis**

Change the function signature from:
```js
function makeStyles(theme) {
```
to:
```js
function makeStyles(theme, statColumns) {
```
Then in the `statCell` style, change:
```js
      flexGrow: 1, flexBasis: '30%',
```
to:
```js
      flexGrow: 1, flexBasis: statColumns >= 3 ? '30%' : '46%',
```
This makes the 6 stat cells show 2 per row on phones/regular and 3 per row on wide windows. (`statsGrid` itself already has `flexWrap: 'wrap'` — leave it unchanged.)

- [ ] **Step 7: Verify**

Run: `npx eslint src/screens/HistoryScreen.js && npx jest`
Expected: lint clean, all existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/screens/HistoryScreen.js
git commit -m "feat: reflow History card lists into responsive grid"
```

---

## Task 7: Reflow CoursesLibraryScreen course cards into a grid

**Files:**
- Modify: `src/screens/CoursesLibraryScreen.js`

`CoursesLibraryScreen` renders a list of course cards. Apply the same `CardGrid` pattern used in Task 6.

- [ ] **Step 1: Read the file to locate the card list**

Read `src/screens/CoursesLibraryScreen.js` and identify (a) the `.map(...)` that renders the course cards inside the `ScrollView`, and (b) the style applied to each course card.

- [ ] **Step 2: Add the import**

After the existing component imports, add:
```js
import CardGrid from '../components/CardGrid';
```

- [ ] **Step 3: Wrap the card list**

Wrap the course-card `.map(...)` expression in `<CardGrid> ... </CardGrid>`, exactly as in Task 6 Step 3 — e.g. if the list is `{courses.map(renderCourse)}`, change it to `<CardGrid>{courses.map(renderCourse)}</CardGrid>`.

- [ ] **Step 4: Remove the per-card bottom margin**

In the `StyleSheet.create` block, the course card style has a `marginBottom` property for vertical spacing. Remove that `marginBottom` property so the grid `gap` is the only spacing. Leave all other card properties unchanged.

- [ ] **Step 5: Verify**

Run: `npx eslint src/screens/CoursesLibraryScreen.js`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/CoursesLibraryScreen.js
git commit -m "feat: reflow Courses library into responsive grid"
```

---

## Task 8: Cap the floating tab bar width

**Files:**
- Modify: `App.js` (`tabBarStyles`, `bar` style — around line 145)

The bottom pill `bar` currently stretches the full window width inside its 24px-padded `slot`. Cap it so on desktop it sits under the centered content column.

- [ ] **Step 1: Add the import**

Near the other local imports at the top of `App.js`, add:
```js
import { CONTENT_MAX_WIDTH } from './src/theme/responsive';
```

- [ ] **Step 2: Cap the `bar` style**

In `tabBarStyles`, the `bar` style begins:
```js
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 62,
```
Insert three properties immediately after `flexDirection: 'row',` so it becomes:
```js
    bar: {
      flexDirection: 'row',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      alignItems: 'center',
      height: 62,
```
Leave the rest of the `bar` style unchanged.

- [ ] **Step 3: Verify**

Run: `npx eslint App.js`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add App.js
git commit -m "feat: cap floating tab bar width on wide windows"
```

---

## Task 9: Cap bottom-sheet / modal width

**Files:**
- Modify: `src/components/CommentsSheet.js`
- Modify: `src/components/StatDetailSheet.js`
- Modify: `src/components/MediaLightbox.js`

On a wide window a full-bleed bottom sheet looks wrong. Cap each sheet's panel and center it. Mobile (panel narrower than the cap) is unchanged.

- [ ] **Step 1: Cap CommentsSheet**

Read `src/components/CommentsSheet.js`. Find the style of the sheet *panel* — the inner `View` that holds the sheet content (it is the elevated/rounded surface, typically styled with `borderTopLeftRadius`/`borderTopRightRadius` and a background colour; not the dark backdrop overlay). Add to that panel style:
```js
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
```
Leave all other properties unchanged.

- [ ] **Step 2: Cap StatDetailSheet**

Apply the identical change to the sheet panel style in `src/components/StatDetailSheet.js` (`width: '100%'`, `maxWidth: 560`, `alignSelf: 'center'`).

- [ ] **Step 3: Cap MediaLightbox**

Read `src/components/MediaLightbox.js`. The lightbox shows media centered on a dark backdrop. Find the style of the media container (the `View`/`Image` wrapper, not the backdrop). Add `maxWidth: 720` and `alignSelf: 'center'` so the media does not stretch arbitrarily wide. If the media element already has a computed width from `Dimensions`, keep that logic and only add `maxWidth: 720` as a ceiling.

- [ ] **Step 4: Verify**

Run: `npx eslint src/components/CommentsSheet.js src/components/StatDetailSheet.js src/components/MediaLightbox.js`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommentsSheet.js src/components/StatDetailSheet.js src/components/MediaLightbox.js
git commit -m "feat: cap bottom-sheet and lightbox width on wide windows"
```

---

## Task 10: Full test run

**Files:** none (verification only)

- [ ] **Step 1: Run the whole Jest suite**

Run: `npx jest`
Expected: PASS — all tests, including the new `responsive.test.js` and `cardGrid.test.js`, and the pre-existing `scoringModes.test.js`.

- [ ] **Step 2: Lint the whole project**

Run: `npm run lint`
Expected: no new errors introduced by this change.

---

## Task 11: Manual responsive verification

**Files:** none (verification only)

- [ ] **Step 1: Start the web build**

Run: `npm run web`

- [ ] **Step 2: Verify wide layout (desktop)**

In a maximised browser window (≥ 960px):
- Feed, Play/Home, History, Stats, Scorecard content sits in a centered column, not edge-to-edge.
- The bottom tab bar is centered under the column, not stretched full width.
- History and Courses library show cards in 3 columns.
- Open a comments sheet and a stat detail sheet — the panel is centered and capped, not full-bleed.

- [ ] **Step 3: Verify regular layout**

Resize the window to ~700px wide:
- Content still centered; History/Courses show 2 columns.
- No horizontal scrollbar; nothing clipped.

- [ ] **Step 4: Verify compact layout (phone parity)**

Resize the window to ~390px wide (or use device mode):
- Layout is identical to the pre-change phone layout: single-column lists, full-width content, full-width tab bar.
- The Auth screen form is full-width with its normal padding.

- [ ] **Step 5: Final commit if any fixes were needed**

If Steps 2–4 surfaced fixes, apply them and commit:
```bash
git add -A
git commit -m "fix: responsive layout adjustments from manual QA"
```

---

## Self-review notes

- **Spec coverage:** centered container (Tasks 3–5), multi-column reflow (Tasks 6–7, scoped per the refinement note above), tab bar cap (Task 8), bottom sheets (Task 9), breakpoints/`useResponsive` (Task 1), resize handling (via `useWindowDimensions`, Task 1). All spec sections map to a task.
- **Type consistency:** `useResponsive()` returns `{ width, isCompact, isWide, gridColumns }` — used consistently in Tasks 1, 2, 6. `cardCellBasis(columns)` and `CardGrid` props (`columns`, `gap`, `style`) are consistent across Tasks 2, 6, 7. `CONTENT_MAX_WIDTH` is imported in Tasks 3 and 8.
- **No placeholders:** Tasks 7 and 9 ask the engineer to read a file first because exact line content there was not captured at plan time; each still specifies the precise transformation and target style properties.
