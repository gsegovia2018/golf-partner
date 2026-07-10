# Report Card → Round Stats Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Round Stats" link at the bottom of the round report card (My Stats screen) that opens the RoundSummary screen for the selected round.

**Architecture:** `RoundReportCard` stays purely presentational: it gains an optional `onOpenRound` callback prop and renders a footer button only when the prop is provided. `MyStatsScreen` resolves the selected round record from `myRounds` (which carries `tournamentId` and the raw `round` object) and passes a navigation handler only when `round.id` exists — RoundSummary resolves rounds by id, so older local rounds without an id must not show the link.

**Tech Stack:** React Native (Expo), Jest + @testing-library/react-native (jest-expo preset).

**Spec:** `docs/superpowers/specs/2026-07-10-report-card-round-link-design.md`

## Global Constraints

- Button label is exactly **"Round Stats"**.
- Navigation call must match the feed's existing shape exactly: `navigation.navigate('RoundSummary', { tournamentId, roundId })`.
- No changes to `buildRoundReportCard`, any store module, or `RoundSummaryScreen`.
- `npm run lint` must stay clean.

---

### Task 1: "Round Stats" footer button in RoundReportCard

**Files:**
- Modify: `src/components/RoundReportCard.js`
- Test: `src/components/__tests__/RoundReportCard.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RoundReportCard` accepts optional prop `onOpenRound: () => void`. When set, a button labelled `Round Stats` (testID `report-card-open-round`) renders at the bottom of the card and calls `onOpenRound()` on press. When unset, the button is absent.

- [ ] **Step 1: Write the failing tests**

In `src/components/__tests__/RoundReportCard.test.js`, change the testing-library import (line 3) to include `fireEvent`:

```js
import { render, fireEvent } from '@testing-library/react-native';
```

Then add these tests inside the existing `describe('RoundReportCard', ...)` block, after the `colors the verdict card by headline tone` test:

```js
  test('renders a Round Stats link that fires onOpenRound', () => {
    const onOpenRound = jest.fn();
    const { getByText, getByTestId } = render(wrap(
      <RoundReportCard
        card={card('good', 'Strong round')}
        rounds={[]}
        selectedKey="round-1"
        onSelect={() => {}}
        onOpenRound={onOpenRound}
      />
    ));

    expect(getByTestId('report-card-open-round')).toBeTruthy();
    fireEvent.press(getByText('Round Stats'));
    expect(onOpenRound).toHaveBeenCalledTimes(1);
  });

  test('hides the Round Stats link when onOpenRound is not provided', () => {
    const { queryByText } = render(wrap(
      <RoundReportCard
        card={card('good', 'Strong round')}
        rounds={[]}
        selectedKey="round-1"
        onSelect={() => {}}
      />
    ));

    expect(queryByText('Round Stats')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/components/__tests__/RoundReportCard.test.js`
Expected: the two new tests FAIL (`Unable to find an element with testID: report-card-open-round`); the existing tone test still passes.

- [ ] **Step 3: Implement the footer button**

In `src/components/RoundReportCard.js`:

1. Add `onOpenRound` to the component's props (line 53):

```js
export default function RoundReportCard({ card, rounds, selectedKey, onSelect, onOpenRound }) {
```

2. Render the button after the expandable breakdown block (after the `{expanded && groups.map(...)}` JSX that ends at line 149, before the `{/* Round picker modal */}` comment):

```js
      {/* Link to the full round page (scorecard, leaderboard, photos, comments) */}
      {onOpenRound && (
        <TouchableOpacity
          testID="report-card-open-round"
          style={[s.expandBtn, s.openRoundBtn]}
          onPress={onOpenRound}
          activeOpacity={0.8}
        >
          <Text style={s.expandText}>Round Stats</Text>
          <Feather name="chevron-right" size={16} color={theme.accent.primary} />
        </TouchableOpacity>
      )}
```

3. In `makeStyles`, add after the `expandText` entry (line 238):

```js
    openRoundBtn: { marginTop: 8 },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/components/__tests__/RoundReportCard.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/RoundReportCard.js src/components/__tests__/RoundReportCard.test.js
git commit -m "feat(stats): add Round Stats footer link to round report card"
```

---

### Task 2: Wire the link from MyStatsScreen to RoundSummary

**Files:**
- Modify: `src/screens/MyStatsScreen.js`
- Test: `src/screens/__tests__/MyStatsScreen.test.js`

**Interfaces:**
- Consumes: `RoundReportCard`'s `onOpenRound` prop from Task 1; `myRounds` records from `collectMyRounds` (each has `key`, `tournamentId`, and the raw `round` object).
- Produces: user-facing behavior only — pressing "Round Stats" navigates to `RoundSummary` with `{ tournamentId, roundId }`.

- [ ] **Step 1: Write the failing tests**

In `src/screens/__tests__/MyStatsScreen.test.js`:

1. Change the testing-library import (line 2) to include `fireEvent`:

```js
import { render, fireEvent } from '@testing-library/react-native';
```

2. Update the `collectMyRounds` mock (line 33) so the default round record carries the navigation fields:

```js
  collectMyRounds: jest.fn(() => [{ key: 'round-1', label: 'Round 1', tournamentId: 't-1', round: { id: 'r-1' } }]),
```

3. Update the `MockRoundReportCard` mock (lines 48–56) to expose `onOpenRound` as a pressable:

```js
jest.mock('../../components/RoundReportCard', () => function MockRoundReportCard({ selectedKey, onOpenRound }) {
  const { Text, TouchableOpacity } = require('react-native');
  return (
    <>
      <Text>Report card content</Text>
      <Text>{`Selected round ${selectedKey}`}</Text>
      {onOpenRound ? (
        <TouchableOpacity onPress={onOpenRound}>
          <Text>Open round stats</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
});
```

4. Extend the `screenElement` helper (line 95) to accept a navigation object:

```js
function screenElement(route = {}, navigation = { goBack: jest.fn() }) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <MyStatsScreen
          navigation={navigation}
          route={route}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
```

5. Add a new describe block at the end of the file:

```js
describe('MyStatsScreen report card round link', () => {
  test('navigates to RoundSummary for the selected round', async () => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { findByText } = render(screenElement({ params: { tab: 'reportCard' } }, navigation));

    fireEvent.press(await findByText('Open round stats'));

    expect(navigation.navigate).toHaveBeenCalledWith('RoundSummary', {
      tournamentId: 't-1',
      roundId: 'r-1',
    });
  });

  test('omits the link when the selected round has no id', async () => {
    const { collectMyRounds } = require('../../store/personalStats');
    collectMyRounds.mockReturnValueOnce([
      { key: 'round-1', label: 'Round 1', tournamentId: 't-1', round: {} },
    ]);
    const { findByText, queryByText } = render(screenElement({ params: { tab: 'reportCard' } }));

    expect(await findByText('Report card content')).toBeTruthy();
    expect(queryByText('Open round stats')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: the `navigates to RoundSummary for the selected round` test FAILS (`Unable to find an element with text: Open round stats`) because MyStatsScreen does not pass `onOpenRound` yet. The `omits the link` test passes trivially at this point — that's expected; it guards the implementation once written. All pre-existing tests still pass.

- [ ] **Step 3: Implement the handler in MyStatsScreen**

In `src/screens/MyStatsScreen.js`, add after the `reportCard` memo (ends line 196):

```js
  // Link to the full RoundSummary page — only when the selected round is
  // resolvable there (RoundSummary looks rounds up by round.id, which older
  // local rounds may lack).
  const openReportRound = useMemo(() => {
    const r = myRounds && reportRoundKey
      ? myRounds.find((it) => it.key === reportRoundKey)
      : null;
    if (!r?.tournamentId || !r?.round?.id) return null;
    return () => navigation.navigate('RoundSummary', {
      tournamentId: r.tournamentId,
      roundId: r.round.id,
    });
  }, [myRounds, reportRoundKey, navigation]);
```

Then pass it to the card (the JSX at lines 347–354):

```js
        {tab === 'reportCard' && (
          <RoundReportCard
            card={reportCard}
            rounds={myRounds}
            selectedKey={reportRoundKey}
            onSelect={setReportRoundKey}
            onOpenRound={openReportRound}
          />
        )}
```

(`onOpenRound` is `null` when unresolvable; the component's `{onOpenRound && ...}` guard from Task 1 handles that.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Run the full suite and lint**

Run: `npx jest && npm run lint`
Expected: all tests pass, lint clean. (Note: two failing suites unrelated to this feature existed on master as of 2026-07-10 — if they fail, confirm they are the same pre-existing failures and not caused by this change.)

- [ ] **Step 6: Commit**

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "feat(stats): open RoundSummary from the report card Round Stats link"
```
