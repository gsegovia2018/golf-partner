# Coach "Quiet Clubhouse" Color System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reserve Masters red for *earned* bad news (getting worse / declining form): the always-present "Fix first" hero and negative Strokes Gained hero return to the clubhouse green (gold accents mark them as "work"), and the Coach tab's "Current form" card tints its surface by status (green wash improving / plain steady / red wash declining).

**Architecture:** Three surgical component changes, no store/domain changes. `CoachHero` drops `fixFirst` from its red-surface set and renders a gold badge kicker for that group; `ShotDashboard`'s target-gap hero loses its negative-total red override; `CoachTab`'s `FormTrendCard` gains tone-tinted `SectionCard` surfaces. Red survives only where state *changed for the worse*: `gettingWorse` hero group and the declining form card.

**Tech Stack:** React Native (Expo 54), Jest + @testing-library/react-native, existing theme tokens (`src/theme/tokens.js` — no token changes needed).

## Global Constraints

- No new dependencies.
- `npm run lint` must pass (ESLint 9 flat config, CI-blocking).
- Full suite `npm test` must stay green (~2348 tests). Run targeted suites per task, full suite at the end.
- Do not modify `src/theme/tokens.js` — all colors used already exist there or are file-local constants.
- Colors: green surface `#0f3d2c`, Masters red `semantic.masters.red` (`#c8102e`), gold `semantic.winner.dark` (`#ffd700`), cream `#f3efe6`, cream-70 `rgba(243,239,230,0.7)`.
- Jest note: run tests from the worktree root; ignore any `.claude/worktrees` / `.worktrees` failures (known scanning quirk — but you will be inside a dedicated worktree, so this should not arise).

---

### Task 1: CoachHero — green surface + gold "Fix first" badge; red only for gettingWorse

**Files:**
- Modify: `src/components/mystats/CoachHero.js`
- Test: `src/components/mystats/__tests__/CoachHero.test.js`

**Interfaces:**
- Consumes: existing `insight` prop shape (`{ group, tone, areaLabel, ... }`), `semantic` tokens.
- Produces: same public API (`CoachHero({ insight, onCommitFocus, focusActive })`, exported `GROUP_LABELS`). New testID `fix-first-badge` on the badge row. Tasks 2/3 do not depend on this task.

- [ ] **Step 1: Rewrite the surface-color tests to the new contract**

Replace the body of `describe('CoachHero surface color', ...)` in `src/components/mystats/__tests__/CoachHero.test.js` with:

```jsx
describe('CoachHero surface color', () => {
  test('fixFirst insight renders the green surface with a gold badge', () => {
    const view = render(wrap(<CoachHero insight={insight} />));
    expect(surfaceColor(view)).toBe(GREEN);
    const badge = view.getByTestId('fix-first-badge');
    expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe('rgba(255,215,0,0.16)');
    const badgeLabel = view.getByText('Fix first');
    expect(StyleSheet.flatten(badgeLabel.props.style).color).toBe(semantic.winner.dark);
  });

  test('gettingWorse insight renders the Masters-red surface with no badge', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} />));
    expect(surfaceColor(view)).toBe(RED);
    expect(view.queryByTestId('fix-first-badge')).toBeNull();
  });

  test('keepDoing insight renders the green surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'keepDoing', tone: 'good' }} />));
    expect(surfaceColor(view)).toBe(GREEN);
  });

  test('empty state renders the green surface', () => {
    const view = render(wrap(<CoachHero insight={null} />));
    expect(surfaceColor(view)).toBe(GREEN);
  });

  test('bad-tone area label uses winner gold on the Masters-red surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe(semantic.winner.dark);
  });

  test('fixFirst area label stays neutral cream — never red on the standing card', () => {
    const view = render(wrap(<CoachHero insight={insight} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe('rgba(243,239,230,0.7)');
  });

  test('bad-tone area label keeps destructive red on the green surface', () => {
    const view = render(wrap(<CoachHero insight={{ ...insight, group: 'watch' }} />));
    const area = view.getByText('Putting');
    expect(StyleSheet.flatten(area.props.style).color).toBe(semantic.destructive.dark);
  });

  test('focus button text matches the active surface color', () => {
    const onCommitFocus = jest.fn();
    const fixFirst = render(wrap(<CoachHero insight={insight} onCommitFocus={onCommitFocus} />));
    expect(StyleSheet.flatten(fixFirst.getByText('Make this my focus').props.style).color).toBe(GREEN);

    const worse = render(
      wrap(<CoachHero insight={{ ...insight, group: 'gettingWorse' }} onCommitFocus={onCommitFocus} />)
    );
    expect(StyleSheet.flatten(worse.getByText('Make this my focus').props.style).color).toBe(RED);
  });
});
```

Keep the file's imports, mocks, `insight` fixture, `GREEN`/`RED` constants, and `surfaceColor` helper exactly as they are.

- [ ] **Step 2: Run the test file to verify the new expectations fail**

Run: `npx jest src/components/mystats/__tests__/CoachHero.test.js`
Expected: FAIL — fixFirst surface is still red, `fix-first-badge` testID does not exist.

- [ ] **Step 3: Implement the CoachHero changes**

In `src/components/mystats/CoachHero.js`:

3a. Replace the surface comment + constants block (lines 19–30) so the red set only holds `gettingWorse` and gold is available:

```js
// Clubhouse hero surface — cream-on-green, matches LiveRoundCard.js. The
// standing green card is the default for every group: "Fix first" always
// exists, so it must not wear alarm red. Masters red is reserved for the one
// group that reports a change for the worse (gettingWorse) — red is earned,
// never permanent. Fix first is marked as "the work" by a gold badge instead.
const GREEN = '#0f3d2c';
// Masters red — the app's one light-surface red. Cream #f3efe6 on it is ~5:1
// (AA); gold #ffd700 is ~4.2:1 (AA-large, fine for the big area label).
const RED = semantic.masters.red;
const GOLD = semantic.winner.dark;
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_85 = 'rgba(243,239,230,0.85)';

const RED_SURFACE_GROUPS = new Set(['gettingWorse']);
```

3b. In the component, compute the badge flag and pass the group to the area-color helper:

```js
  const isRedSurface = Boolean(insight && RED_SURFACE_GROUPS.has(insight.group));
  const isFixFirst = insight?.group === 'fixFirst';
  const surfaceColor = isRedSurface ? RED : GREEN;
  const areaColor = areaAccentColor(insight?.tone, isRedSurface, isFixFirst);
```

3c. Replace the `topRow` kicker line (`<Text style={s.kicker}>{GROUP_LABELS[insight.group] ?? 'Coach'}</Text>`) with a badge for fixFirst, plain kicker otherwise:

```jsx
      <View style={s.topRow}>
        {isFixFirst ? (
          <View style={s.fixFirstBadge} testID="fix-first-badge">
            <Feather name="target" size={10} color={GOLD} />
            <Text style={s.fixFirstBadgeText}>{GROUP_LABELS.fixFirst}</Text>
          </View>
        ) : (
          <Text style={s.kicker}>{GROUP_LABELS[insight.group] ?? 'Coach'}</Text>
        )}
        <Text style={[s.area, { color: areaColor }]}>{insight.areaLabel ?? insight.area}</Text>
      </View>
```

3d. Replace `areaAccentColor` — a fixFirst insight's `bad` tone must not paint the area label red (the group is permanent, so the red would be permanent too):

```js
// Hero surface is a fixed dark color in both themes, so tone accents always
// use the dark-surface variants regardless of the active app theme. On the
// Masters-red surface a red area label would vanish, so a 'bad' area label
// renders in winner gold there instead. Fix first always carries a bad tone,
// so its area label stays neutral cream — the gold badge already marks it.
function areaAccentColor(tone, isRedSurface, isFixFirst) {
  if (isFixFirst) return CREAM_70;
  if (tone === 'bad') return isRedSurface ? semantic.winner.dark : semantic.destructive.dark;
  if (tone === 'good') return semantic.winner.dark;
  return CREAM_70;
}
```

3e. Add the badge styles inside `makeStyles` (next to `kicker`):

```js
    fixFirstBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(255,215,0,0.16)',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    fixFirstBadgeText: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: GOLD,
    },
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx jest src/components/mystats/__tests__/CoachHero.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Run neighboring coach suites**

Run: `npx jest src/components/mystats/__tests__/CoachComponents.test.js src/components/mystats/__tests__/CoachTab.test.js src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS — the badge still renders the literal text "Fix first", which those suites assert via `getByText`.

- [ ] **Step 6: Commit**

```bash
git add src/components/mystats/CoachHero.js src/components/mystats/__tests__/CoachHero.test.js
git commit -m "feat(coach): fix-first hero goes clubhouse green with gold badge — red reserved for gettingWorse"
```

---

### Task 2: ShotDashboard — target-gap hero stays green regardless of SG sign

**Files:**
- Modify: `src/components/mystats/ShotDashboard.js`
- Test: `src/components/mystats/__tests__/ShotDashboard.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: same public API (`ShotDashboard`, `buildShotSignals`). `sg-hero-surface` testID keeps its existing name; its background is now always `#0f3d2c`.

- [ ] **Step 1: Rewrite the hero-surface tests**

Replace the `describe('ShotDashboard target-gap hero surface', ...)` block in `src/components/mystats/__tests__/ShotDashboard.test.js` with:

```jsx
describe('ShotDashboard target-gap hero surface', () => {
  test('stays clubhouse green when the SG total is negative — the gap is standing work, not an alarm', () => {
    const r = renderDash({ ...baseSG, total: -1.2 });
    expect(heroColor(r)).toBe(GREEN);
  });
  test('stays green when the SG total is positive', () => {
    const r = renderDash({ ...baseSG, total: 0.8 });
    expect(heroColor(r)).toBe(GREEN);
  });
  test('stays green at exactly zero and without data', () => {
    expect(heroColor(renderDash({ ...baseSG, total: 0 }))).toBe(GREEN);
    expect(heroColor(renderDash({ ...baseSG, total: null }))).toBe(GREEN);
  });
  test('headline number is winner gold on both signs', () => {
    const losing = renderDash({ ...baseSG, total: -1.2 });
    expect(StyleSheet.flatten(losing.getByText('-1.20 / round').props.style).color)
      .toBe(semantic.winner.dark);
    const winning = renderDash({ ...baseSG, total: 0.8 });
    expect(StyleSheet.flatten(winning.getByText('+0.80 / round').props.style).color)
      .toBe(semantic.winner.dark);
  });
});
```

The `RED` constant at the top of the test file becomes unused — delete the line `const RED = semantic.masters.red; // '#c8102e'` (keep the `semantic` import; it is still used for `semantic.winner.dark`).

- [ ] **Step 2: Run the test file to verify the negative-total test fails**

Run: `npx jest src/components/mystats/__tests__/ShotDashboard.test.js`
Expected: FAIL — negative total still renders `#c8102e`.

- [ ] **Step 3: Implement the ShotDashboard change**

In `src/components/mystats/ShotDashboard.js`:

3a. Update the constants comment and drop the now-unused `RED` (lines 22–28):

```js
// Clubhouse hero surfaces — same constants as CoachHero.js. The target-gap
// hero is always green: a negative SG total vs the target is the standing
// state for most players, and a permanent red stops meaning anything. Red
// in this screen is reserved for per-category "getting worse" deltas.
const GREEN = '#0f3d2c';
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_85 = 'rgba(243,239,230,0.85)';
```

Keep the `semantic` import on line 8 — it is still used (`semantic.winner.dark` for the hero value).

3b. In the component body, delete the `losing` line:

```js
  const losing = hasStrokesGained && strokesGained.total < 0;
```

3c. Simplify the hero View (currently `<View style={[s.hero, losing && { backgroundColor: RED }]} testID="sg-hero-surface">`) to:

```jsx
      <View style={s.hero} testID="sg-hero-surface">
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx jest src/components/mystats/__tests__/ShotDashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Lint the touched files**

Run: `npx eslint src/components/mystats/ShotDashboard.js src/components/mystats/__tests__/ShotDashboard.test.js`
Expected: no errors (an unused `RED` const would surface here).

- [ ] **Step 6: Commit**

```bash
git add src/components/mystats/ShotDashboard.js src/components/mystats/__tests__/ShotDashboard.test.js
git commit -m "feat(stats): target-gap hero stays clubhouse green — negative SG is standing work, not an alarm"
```

---

### Task 3: Current form card — status-tinted surface (green wash / plain / red wash)

**Files:**
- Modify: `src/components/mystats/SectionCard.js` (add `testID` passthrough)
- Modify: `src/components/mystats/tabs/CoachTab.js` (FormTrendCard wash)
- Test: `src/components/mystats/__tests__/CoachTab.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `SectionCard` gains an optional `testID` prop applied to its root View (all existing call sites unaffected — it defaults to `undefined`). `FormTrendCard`'s SectionCard renders with `testID="current-form-card"`.

- [ ] **Step 1: Add failing tests for the three form-card states**

In `src/components/mystats/__tests__/CoachTab.test.js`, add `import { StyleSheet } from 'react-native';` after the React import (the file currently imports nothing from `react-native`), then append this block at the end of the file:

```jsx
const formStats = (direction, delta) => ({
  ...stats,
  form: {
    hasHistory: true,
    recentCount: 5,
    historyCount: 12,
    metrics: [{ key: 'avgPoints', direction, delta }],
  },
});

const formCardBg = (r) =>
  StyleSheet.flatten(r.getByTestId('current-form-card').props.style).backgroundColor;

describe('FormTrendCard status surface', () => {
  test('improving form tints the card with the green wash', () => {
    const r = render(<CoachTab stats={formStats('up', 2.1)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Improving lately')).toBeTruthy();
    expect(formCardBg(r)).toBe('#e6f0eb');
  });

  test('declining form tints the card with the red wash', () => {
    const r = render(<CoachTab stats={formStats('down', -1.8)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Trending down lately')).toBeTruthy();
    expect(formCardBg(r)).toBe('#fbeaec');
  });

  test('steady form keeps the plain card surface', () => {
    const r = render(<CoachTab stats={formStats('flat', null)} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Holding steady')).toBeTruthy();
    expect(formCardBg(r)).toBe('#ffffff');
  });
});
```

(Light-theme `bg.card` is `#ffffff` and `accent.light` is `#e6f0eb` — see `src/theme/tokens.js`. The CoachTab test file mocks the light theme.)

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run: `npx jest src/components/mystats/__tests__/CoachTab.test.js`
Expected: FAIL — `current-form-card` testID does not exist yet.

- [ ] **Step 3: Add `testID` passthrough to SectionCard**

In `src/components/mystats/SectionCard.js`, add `testID` to the destructured props and root View:

```js
export default function SectionCard({
  title, infoKey, onInfo, right, tone = 'default', titleVariant = 'overline', children, style, testID,
}) {
```

```jsx
    <View style={[s.card, hero && s.cardHero, style]} testID={testID}>
```

- [ ] **Step 4: Implement the wash in FormTrendCard**

In `src/components/mystats/tabs/CoachTab.js`:

4a. In `FormTrendCard`, compute the wash and pass it to `SectionCard` — replace the current `return (<SectionCard title="Current form">` opening with:

```jsx
  const wash = toneWash(theme, tone);

  return (
    <SectionCard
      title="Current form"
      testID="current-form-card"
      style={wash ? { backgroundColor: wash, borderColor: 'transparent' } : null}
    >
```

(The card body — `formHead`, pill, `TrendLineChart` — stays exactly as it is.)

4b. Replace `toneFill` and add `toneWash` below `toneColor`. On a washed surface the old pill fills (`accent.light` on the green wash) would disappear into the background, so toned pills sit on the plain card color instead:

```js
// Surface tint for the whole card: the first thing the Coach tab says should
// be readable from the card color alone. Neutral stays on the plain card.
function toneWash(theme, tone) {
  if (tone === 'good') return theme.accent.light;
  if (tone === 'bad') return theme.isDark ? 'rgba(248,113,113,0.10)' : '#fbeaec';
  return null;
}

// Pill fill sits on top of the wash, so toned pills use the plain card color
// (translucent white in dark mode) to stay visible against the tinted surface.
function toneFill(theme, tone) {
  if (tone === 'neutral') return theme.bg.secondary;
  return theme.isDark ? 'rgba(255,255,255,0.08)' : theme.bg.card;
}
```

- [ ] **Step 5: Run the test file to verify it passes**

Run: `npx jest src/components/mystats/__tests__/CoachTab.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the neighboring suites that render SectionCard heavily**

Run: `npx jest src/components/mystats src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS — `testID` defaults to `undefined` for all existing call sites.

- [ ] **Step 7: Commit**

```bash
git add src/components/mystats/SectionCard.js src/components/mystats/tabs/CoachTab.js src/components/mystats/__tests__/CoachTab.test.js
git commit -m "feat(coach): current-form card tints its surface by status — green wash, plain, red wash"
```

---

### Task 4: Full verification

**Files:** none new.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass (~2348+ tests; count grows with the new cases).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit any straggler fixes**

Only if Steps 1–2 surfaced issues; otherwise nothing to commit.
