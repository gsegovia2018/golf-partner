# Round Summary Photos Tab Add-Photo FAB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floating + button on RoundSummaryScreen's Photos tab that lets a player of that round add photos to it via the shared attach flow.

**Architecture:** RoundSummaryScreen (a root stack screen — no tab bar overlays it) consumes the existing `useMediaAttachFlow` hook, renders its `sheets`, and shows a Gallery-style FAB only when `activeTab === 'photos' && iAmPlaying && round` exists. `onAttached` re-runs the screen's `load()` so the photo grid refreshes.

**Tech Stack:** Expo SDK 54 / RN 0.81 / React 19, Jest (jest-expo) + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-07-16-round-summary-photos-fab-design.md`

## Global Constraints

- No new npm dependencies; no new components — reuse `useMediaAttachFlow` (signature: `{ tournament, defaultRoundIndex, onAttached } → { openCaptureMenu, sheets }`; defaults `defaultHoleIndex: null`, `allowBatch: true` are correct here — do not pass them).
- FAB: same recipe as GalleryScreen's (56 px circle, `theme.accent.primary`, Feather `plus` size 26 `theme.text.inverse`, `right: 20, bottom: 28`, shadow), `accessibilityLabel="Add photo"`.
- FAB gating: `activeTab === 'photos' && iAmPlaying && round` — absent on other tabs, for non-players, and while loading/missing round.
- Only `src/screens/RoundSummaryScreen.js` and its existing test file change.
- `npm test` and `npm run lint` must pass. (Note: jest runs from the main checkout may scan stale `.claude/worktrees`/`.worktrees` copies — failures in those paths are noise.)

---

### Task 1: FAB + attach flow on RoundSummaryScreen

**Files:**
- Modify: `src/screens/RoundSummaryScreen.js`
- Test: `src/screens/__tests__/RoundSummaryScreen.test.js` (extend)

**Interfaces:**
- Consumes: `useMediaAttachFlow` from `src/hooks/useMediaAttachFlow.js` — `useMediaAttachFlow({ tournament, defaultRoundIndex, onAttached })` returns `{ openCaptureMenu: () => void, sheets: JSX }`.
- Produces: nothing consumed by later tasks (single-task plan).

- [ ] **Step 1: Write the failing tests**

In `src/screens/__tests__/RoundSummaryScreen.test.js`, add this mock after the existing `jest.mock('../../store/tournamentStore', …)` block (top level, before `const navigation = …`):

```js
const mockOpenCaptureMenu = jest.fn();
let lastAttachFlowArgs = null;
jest.mock('../../hooks/useMediaAttachFlow', () => ({
  __esModule: true,
  default: jest.fn((args) => {
    lastAttachFlowArgs = args;
    return { openCaptureMenu: mockOpenCaptureMenu, sheets: null };
  }),
}));
```

Then add this describe block alongside the existing tests (same nesting level as the current `test(...)` calls):

```js
  describe('Photos tab add-photo FAB', () => {
    test('FAB shows on the Photos tab for a player and opens the capture menu', async () => {
      const { findByText, findByLabelText, queryByLabelText } = render(wrap(
        <RoundSummaryScreen navigation={navigation} route={route} />,
      ));
      await findByText('Winner: Marcos');

      // Not on the default (scorecard) tab.
      expect(queryByLabelText('Add photo')).toBeNull();

      fireEvent.press(await findByLabelText('Photos'));
      const fab = await findByLabelText('Add photo');
      fireEvent.press(fab);
      expect(mockOpenCaptureMenu).toHaveBeenCalled();
      // The hook is wired at this round.
      expect(lastAttachFlowArgs.defaultRoundIndex).toBe(0);
      expect(lastAttachFlowArgs.tournament?.id).toBe('t1');
    });

    test('FAB is hidden for a viewer who did not play in the round', async () => {
      const { supabase } = require('../../lib/supabase');
      supabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'u3' } } });

      const { findByText, findByLabelText, queryByLabelText } = render(wrap(
        <RoundSummaryScreen navigation={navigation} route={route} />,
      ));
      await findByText('Winner: Marcos');

      fireEvent.press(await findByLabelText('Photos'));
      expect(queryByLabelText('Add photo')).toBeNull();
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/screens/__tests__/RoundSummaryScreen.test.js`
Expected: the two new tests FAIL (no element with accessibilityLabel "Add photo"); all pre-existing tests still PASS.

- [ ] **Step 3: Implement in `src/screens/RoundSummaryScreen.js`**

a) Add the import (with the other local imports):

```js
import useMediaAttachFlow from '../hooks/useMediaAttachFlow';
```

b) Below the existing `roundIndex` and `iAmPlaying` declarations, add:

```js
  // Add-photo flow for the Photos tab — pre-targeted at this round; a saved
  // photo re-runs load() so the grid picks it up.
  const { openCaptureMenu, sheets: attachSheets } = useMediaAttachFlow({
    tournament,
    defaultRoundIndex: Math.max(0, roundIndex),
    onAttached: load,
  });
```

(`load` is a `useCallback` declared above this point; `roundIndex` is -1 while the round is missing — clamped to 0, and the FAB is hidden in that state anyway.)

c) Inside `<ScreenContainer>`, AFTER the whole `{loading ? … : (<PullToRefresh>…</PullToRefresh>)}` expression (direct child of ScreenContainer, not inside the ternary), add:

```jsx
      {!loading && round && iAmPlaying && activeTab === 'photos' ? (
        <TouchableOpacity
          style={s.fab}
          onPress={openCaptureMenu}
          accessibilityLabel="Add photo"
          activeOpacity={0.85}
        >
          <Feather name="plus" size={26} color={theme.text.inverse} />
        </TouchableOpacity>
      ) : null}
      {attachSheets}
```

d) Add the FAB style to `makeStyles` (copied from GalleryScreen's `fab`):

```js
    fab: {
      position: 'absolute',
      right: 20, bottom: 28,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/__tests__/RoundSummaryScreen.test.js`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Full suite + lint**

Run: `npx jest && npm run lint`
Expected: full suite green (2043+ tests as of master @ 65ae450 merge), lint 0 errors and no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/screens/RoundSummaryScreen.js src/screens/__tests__/RoundSummaryScreen.test.js
git commit -m "feat(round-summary): add-photo FAB on the Photos tab"
```

---

## Final verification

- [ ] `npm test` green, `npm run lint` clean.
- [ ] Manual smoke (optional): feed → open own round → Photos tab → + → pick → wheels pre-targeted at that round → Save → grid refreshes.
