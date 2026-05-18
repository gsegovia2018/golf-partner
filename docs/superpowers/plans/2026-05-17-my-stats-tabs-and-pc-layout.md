# My Stats — Tabs & PC Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `MyStatsScreen` into Overview / Form / Breakdown / Shots tabs and make the screen render well on wide desktop windows.

**Architecture:** One file changes — `src/screens/MyStatsScreen.js`. It reuses two existing primitives: `ScreenContainer` (centers + width-caps content at 960px) replaces the root `SafeAreaView`; `CardGrid` (responsive wrapping row) tiles the Breakdown tab's cards. A tab bar styled like `StatsScreen`'s splits the section stack.

**Tech Stack:** React Native (Expo), Jest (`jest-expo`).

**Spec:** `docs/superpowers/specs/2026-05-17-my-stats-tabs-and-pc-layout-design.md`

**Refinement vs. spec:** The spec said both the Breakdown and Shots tabs use `CardGrid`. The Shots tab has at most 2 cards; a 3-column grid would leave a lone card at ~31% width on desktop. Since ≤2 cards is never the "long column" problem the spec set out to fix, the **Shots tab stays a plain full-width stack** — only the Breakdown tab (4–5 cards) is gridded.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/screens/MyStatsScreen.js` | Personal stats screen — gains tabs + PC layout | Modify |

No new files. `ScreenContainer` (`src/components/ScreenContainer.js`) and `CardGrid` (`src/components/CardGrid.js`) already exist and are unchanged.

This is a UI-only change. `MyStatsScreen` has no unit tests (the project has no React Native component-test setup), so the two tasks below are verified by the existing Jest suite staying green, an `expo export` web bundle, and manual review — not TDD.

---

## Task 1: Center and width-cap the screen with `ScreenContainer`

Replaces the root `SafeAreaView` with `ScreenContainer` in all five render branches, so content centers and caps at 960px on wide windows (a visual no-op on phones).

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Swap the import**

In `src/screens/MyStatsScreen.js`, the imports currently include:

```js
import { SafeAreaView } from 'react-native-safe-area-context';
```

Replace that line with:

```js
import ScreenContainer from '../components/ScreenContainer';
```

(`ScreenContainer` wraps `SafeAreaView` internally — see `src/components/ScreenContainer.js` — so the direct `SafeAreaView` import is no longer needed. It forwards `edges` to the inner `SafeAreaView` and applies `style` to the outer one.)

- [ ] **Step 2: Replace every `SafeAreaView` element with `ScreenContainer`**

There are five `<SafeAreaView style={s.container} edges={['top', 'bottom']}>` … `</SafeAreaView>` pairs in the file — in the loading branch, the error branch, the no-rounds empty branch, the all-deselected empty branch, and the main return.

Replace every opening tag:

```jsx
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
```

with:

```jsx
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
```

and every closing tag `</SafeAreaView>` with `</ScreenContainer>`.

Use a global replace — all five opening tags are character-identical, and all five closing tags are identical. After the edit, confirm there are zero remaining occurrences of `SafeAreaView` in the file.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: PASS — 7 suites green (no test imports this screen; this confirms nothing else broke).

- [ ] **Step 4: Bundle check**

Run: `npx expo export --platform web`
Expected: completes successfully ("Exported", writes a `dist/` folder).
Then run: `rm -rf dist`

- [ ] **Step 5: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat: center My Stats with ScreenContainer for wide windows"
```

---

## Task 2: Split the screen into Overview / Form / Breakdown / Shots tabs

Adds a tab bar under the header and splits the single section stack into four tabs. The Breakdown tab tiles its cards with `CardGrid`.

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Add the `CardGrid` import**

In `src/screens/MyStatsScreen.js`, immediately after the line `import MyStatsRoundSelector from '../components/MyStatsRoundSelector';`, add:

```js
import CardGrid from '../components/CardGrid';
```

- [ ] **Step 2: Add the `ALL_TABS` constant**

Immediately after the `SELECTION_PREFIX` constant line (`const SELECTION_PREFIX = '@mystats_round_selection:';`), add:

```js
const ALL_TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'form',      label: 'Form' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'shots',     label: 'Shots' },
];
```

- [ ] **Step 3: Add the `tab` state**

In the `MyStatsScreen` component, the state hooks currently end with:

```js
  const [loadNonce, setLoadNonce] = useState(0);
```

Immediately after that line, add:

```js
  const [tab, setTab] = useState('overview');
```

- [ ] **Step 4: Add the `TabBar` element**

The component defines a `Header` element (a `const Header = ( <View style={s.header}> … </View> );`). Immediately after the `Header` definition closes (after its `);`), add a `TabBar` element:

```js
  const TabBar = (
    <View style={s.tabBar}>
      {ALL_TABS.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[s.tab, tab === t.key && s.tabActive]}
          onPress={() => setTab(t.key)}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === t.key }}
        >
          <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
```

- [ ] **Step 5: Replace the main `return` block**

The component's final `return` (the data-state render) currently runs from `return (` with `<ScreenContainer …>` (after Task 1) through its closing `);`. It starts right after the two lines:

```js
  const fb = stats.frontBack;
  const fbHoles = fb ? fb.rounds.length * 9 : 0;
```

Replace the ENTIRE final `return ( … );` block — from `return (` through the matching `);` — with exactly this:

```jsx
  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      {TabBar}
      <ScrollView contentContainerStyle={s.scroll}>
        {tab === 'overview' && (
          <>
            <Snapshot stats={stats} metric={metric} onToggleMetric={setMetric} s={s} theme={theme} />
            <StrengthsSection ranking={stats.ranking} s={s} theme={theme} />
          </>
        )}

        {tab === 'form' && (
          <FormSection form={stats.form} history={stats.history} n={n} onChangeN={setN} s={s} theme={theme} />
        )}

        {tab === 'breakdown' && (
          <CardGrid>
            <BreakdownSection key="parType" title="Par type" rows={[
              ['Par 3s', stats.parType.par3.avgPoints, stats.parType.par3.holes],
              ['Par 4s', stats.parType.par4.avgPoints, stats.parType.par4.holes],
              ['Par 5s', stats.parType.par5.avgPoints, stats.parType.par5.holes],
            ]} s={s} />
            <BreakdownSection key="difficulty" title="Hole difficulty" rows={[
              ['Hard (SI 1-6)', stats.difficulty.hard.avgPoints, stats.difficulty.hard.holes],
              ['Mid (SI 7-12)', stats.difficulty.mid.avgPoints, stats.difficulty.mid.holes],
              ['Easy (SI 13-18)', stats.difficulty.easy.avgPoints, stats.difficulty.easy.holes],
            ]} s={s} />
            <BreakdownSection key="roundShape" title="Round shape" rows={[
              ['Front nine', fb ? fb.frontAvg : 0, fbHoles],
              ['Back nine', fb ? fb.backAvg : 0, fbHoles],
              ['Opening 3', stats.warmupClosing.warmup.avgPoints, stats.warmupClosing.warmup.holes],
              ['Closing 3', stats.warmupClosing.closing.avgPoints, stats.warmupClosing.closing.holes],
            ]} s={s} />
            <DistributionSection key="distribution" dist={stats.distribution} s={s} />
            {(stats.bounceBack || stats.scrambling) ? (
              <BreakdownSection key="recovery" title="Recovery" rows={[
                ['Bounce-back rate %', stats.bounceBack ? stats.bounceBack.rate : 0, stats.bounceBack ? stats.bounceBack.opportunities : 0],
                ['Scrambling %', stats.scrambling ? stats.scrambling.pct : 0, stats.scrambling ? stats.scrambling.missedGir : 0],
              ]} s={s} />
            ) : null}
          </CardGrid>
        )}

        {tab === 'shots' && (
          <>
            {stats.teeShot.hasData ? (
              <BreakdownSection title="Tee shot impact" rows={[
                ['Fairway found', stats.teeShot.fairway.avgPoints, stats.teeShot.fairway.holes],
                ['Fairway missed', stats.teeShot.missed.avgPoints, stats.teeShot.missed.holes],
                ['Miss left', stats.teeShot.byDirection.left.avgPoints, stats.teeShot.byDirection.left.holes],
                ['Miss right', stats.teeShot.byDirection.right.avgPoints, stats.teeShot.byDirection.right.holes],
                ['Miss short', stats.teeShot.byDirection.short.avgPoints, stats.teeShot.byDirection.short.holes],
                ['After tee penalty', stats.teeShot.teePenalty.avgPoints, stats.teeShot.teePenalty.holes],
                ['Penalty drag (pts lost)', stats.teeShot.penaltyDrag, stats.teeShot.teePenalty.holes],
              ]} s={s} />
            ) : null}
            {stats.shots.hasData ? (
              <BreakdownSection title="Putting & driving" rows={[
                ['Putts / round', stats.shots.putts.perRound, stats.shots.putts.holes],
                ['1-putts', stats.shots.putts.onePutts, stats.shots.putts.holes],
                ['3-putts+', stats.shots.putts.threePuttPlus, stats.shots.putts.holes],
                ['Fairways hit %', stats.shots.drives.fairwayPct, stats.shots.drives.recorded],
                ['Greens in reg %', stats.shots.gir.pct, stats.shots.gir.eligible],
                ['Penalties / round', stats.shots.penalties.total, stats.shots.roundsWithData],
              ]} s={s} />
            ) : null}
            {!stats.teeShot.hasData && !stats.shots.hasData ? (
              <View style={s.card}>
                <Text style={s.note}>
                  Log putts and drives during a round to unlock tee-shot, putting and
                  driving stats.
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {Selector}
    </ScreenContainer>
  );
```

This keeps every section component (`Snapshot`, `FormSection`, `StrengthsSection`, `BreakdownSection`, `DistributionSection`) and the `fb`/`fbHoles` locals exactly as they are — only the section components' grouping changes. The Breakdown cards carry explicit `key` props because `CardGrid` reads `child.key` to key its cells.

- [ ] **Step 6: Add the tab-bar styles**

In `makeStyles`, inside the `StyleSheet.create({ … })` object, add these five entries (keep all existing entries; place them after the `roundsBtnText` entry for readability):

```js
    tabBar: {
      flexDirection: 'row', gap: 6,
      paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm,
    },
    tab: {
      paddingVertical: 6, paddingHorizontal: 14,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    tabActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    tabText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tabTextActive: { color: theme.text.inverse },
```

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: PASS — 7 suites green.

- [ ] **Step 8: Bundle check**

Run: `npx expo export --platform web`
Expected: completes successfully ("Exported", writes `dist/`).
Then run: `rm -rf dist`

- [ ] **Step 9: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat: My Stats — Overview/Form/Breakdown/Shots tabs"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: PASS — all 7 suites, 125 tests.

- [ ] **Manual check** (`npm run web`)

1. Home → menu → "Statistics" opens My Stats with a tab bar under the header; Overview is active by default.
2. Each tab shows only its own cards — Overview (Snapshot + Strengths), Form (Recent vs History + sparkline), Breakdown (Par type / Hole difficulty / Round shape / Distribution / Recovery), Shots (Tee shot impact / Putting & driving, or the muted notice when there is no shot data).
3. The active tab pill is highlighted; tapping a tab switches content.
4. On a wide browser window, content is centered and capped; the Breakdown tab's cards tile 2–3 across. On a narrow window everything is a single column.
5. The round-selector chip in the header still works from every tab; loading and empty states still render centered, without a tab bar.
