# Notification Tap Navigation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tapping the "Added to a game" notification (inbox row or push) open that game's Tournament view.

**Architecture:** The `added_to_game` deep link currently targets the bare screen name `Home`, which is nested inside the `Main` bottom-tab navigator and therefore unreachable from the root stack — the NAVIGATE action is silently dropped. Fix: emit React Navigation's nested form `{ screen: 'Main', params: { screen: 'Home', params: { openTournamentId } } }` from `notificationLink()`, mirror it in the `send-push` edge function, and normalize legacy bare-`Home` push payloads in the App.js push-tap listener via a new exported helper `normalizeDeepLink()`. Everything downstream (HomeScreen's `openTournamentId` effect) already works.

**Tech Stack:** React Native / Expo, React Navigation (stack + bottom-tabs), Jest (jest-expo), Supabase Edge Function (Deno).

**Spec:** `docs/superpowers/specs/2026-07-11-notification-tap-navigation-design.md`

## Global Constraints

- Do NOT modify `HomeScreen.js`, the notifications table, or any DB trigger — the downstream `openTournamentId` handling already exists and works.
- `supabase/functions/send-push/index.ts` is Deno and hand-mirrors `src/lib/notificationContent.js`; keep the two consistent.
- `npm test` (~330+ tests) and `npm run lint` must pass before each commit.

---

### Task 1: Nested deep link + `normalizeDeepLink` helper in notificationContent

**Files:**
- Modify: `src/lib/notificationContent.js` (the `added_to_game` case in `notificationLink`, ~line 63; add `normalizeDeepLink` export at the end)
- Test: `src/lib/__tests__/notificationContent.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `notificationLink('added_to_game', data)` now returns `{ screen: 'Main', params: { screen: 'Home', params: { openTournamentId: data.tournament_id } } }`. New export `normalizeDeepLink(link)` — takes a `{ screen, params? }` object, returns it unchanged unless `screen === 'Home'`, in which case it wraps it into the nested `Main → Home` form. Task 2 imports `normalizeDeepLink` from `./src/lib/notificationContent`.

- [ ] **Step 1: Update the existing `added_to_game` link test and add `normalizeDeepLink` tests (failing first)**

In `src/lib/__tests__/notificationContent.test.js`, change the import line (line 1) to:

```js
import { renderNotification, notificationLink, normalizeDeepLink } from '../notificationContent';
```

Replace the existing `added_to_game routes to Home with the tournament id` test (lines 69–72) with:

```js
  test('added_to_game routes to the Home tab (nested under Main) with the tournament id', () => {
    expect(notificationLink('added_to_game', { tournament_id: 't1' }))
      .toEqual({
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: 't1' } },
      });
  });
```

Append a new describe block at the end of the file:

```js
describe('normalizeDeepLink', () => {
  test('rewrites a legacy bare Home link to the nested Main → Home form', () => {
    expect(normalizeDeepLink({ screen: 'Home', params: { openTournamentId: 't1' } }))
      .toEqual({
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: 't1' } },
      });
  });

  test('passes an already-nested link through untouched', () => {
    const nested = {
      screen: 'Main',
      params: { screen: 'Home', params: { openTournamentId: 't1' } },
    };
    expect(normalizeDeepLink(nested)).toEqual(nested);
  });

  test('passes non-Home links through untouched', () => {
    expect(normalizeDeepLink({ screen: 'Friends' })).toEqual({ screen: 'Friends' });
    expect(normalizeDeepLink({
      screen: 'RoundSummary',
      params: { tournamentId: 't1', roundId: 'r1' },
    })).toEqual({
      screen: 'RoundSummary',
      params: { tournamentId: 't1', roundId: 'r1' },
    });
  });

  test('tolerates missing input', () => {
    expect(normalizeDeepLink(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run: `npx jest src/lib/__tests__/notificationContent.test.js`
Expected: FAIL — the `added_to_game` link test gets the old flat shape, and the `normalizeDeepLink` tests fail with "normalizeDeepLink is not a function".

- [ ] **Step 3: Implement the nested link and the helper**

In `src/lib/notificationContent.js`, replace the `added_to_game` case inside `notificationLink` (currently `return { screen: 'Home', params: { openTournamentId: data.tournament_id } };`) with:

```js
    case 'added_to_game':
      // 'Home' lives inside the 'Main' bottom-tab navigator, so the link
      // must use React Navigation's nested form — a bare navigate('Home')
      // from the root stack is silently dropped.
      return {
        screen: 'Main',
        params: { screen: 'Home', params: { openTournamentId: data.tournament_id } },
      };
```

Append at the end of the file:

```js
// Older send-push deployments (and pushes already delivered before an app
// update) carry the bare `{ screen: 'Home' }` deep link, which the root
// navigator cannot resolve. Rewrite it to the nested Main → Home form;
// every other link passes through untouched.
export function normalizeDeepLink(link = {}) {
  if (link.screen === 'Home') {
    return { screen: 'Main', params: { screen: 'Home', params: link.params } };
  }
  return link;
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx jest src/lib/__tests__/notificationContent.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the full suite and lint, then commit**

Run: `npm test` — expected: all pass.
Run: `npm run lint` — expected: no errors.

```bash
git add src/lib/notificationContent.js src/lib/__tests__/notificationContent.test.js
git commit -m "fix(notifications): route added_to_game through nested Main→Home navigator"
```

---

### Task 2: Normalize push deep links in the App.js tap listener

**Files:**
- Modify: `App.js` (push-response listener, ~lines 158–165; import block ~line 66)

**Interfaces:**
- Consumes: `normalizeDeepLink(link)` from `src/lib/notificationContent.js` (Task 1).
- Produces: nothing consumed by later tasks.

There is no existing test harness for `App.js` (it wires navigators and native listeners), so this task is verified by lint + full suite + the manual QA pass at the end.

- [ ] **Step 1: Import the helper**

In `App.js`, next to the existing import on line 66 (`import { registerPushToken, configureNotificationHandler } from './src/lib/pushNotifications';`), add:

```js
import { normalizeDeepLink } from './src/lib/notificationContent';
```

- [ ] **Step 2: Normalize the payload before navigating**

Replace the listener body (currently lines 158–163):

```js
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.screen && navigationRef.isReady()) {
        // Legacy pushes carry a bare 'Home' target the root navigator can't
        // resolve — normalize to the nested form before navigating.
        const link = normalizeDeepLink(data);
        navigationRef.navigate(link.screen, link.params);
      }
    });
```

- [ ] **Step 3: Run the full suite and lint**

Run: `npm test` — expected: all pass.
Run: `npm run lint` — expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add App.js
git commit -m "fix(notifications): normalize legacy push deep links before navigating"
```

---

### Task 3: Mirror the nested deep link in the send-push edge function

**Files:**
- Modify: `supabase/functions/send-push/index.ts` (the `added_to_game` renderer, ~lines 29–33)

**Interfaces:**
- Consumes: the nested link shape defined in Task 1 (must match exactly).
- Produces: push payloads whose `data` is the nested deep link; the App.js listener (Task 2) navigates with it directly (`normalizeDeepLink` passes nested links through).

The edge function is Deno with no local test harness in this repo; verification is a careful diff against `notificationLink` plus the manual QA pass.

- [ ] **Step 1: Update the renderer**

In `supabase/functions/send-push/index.ts`, replace the `added_to_game` entry:

```ts
  added_to_game: (d) => ({
    title: 'Added to a game',
    body: `You were added to ${d.tournament_name ?? 'a game'}`,
    // Nested form — 'Home' lives inside the 'Main' tab navigator; mirrors
    // notificationLink() in src/lib/notificationContent.js.
    deepLink: {
      screen: 'Main',
      params: { screen: 'Home', params: { openTournamentId: d.tournament_id } },
    },
  }),
```

- [ ] **Step 2: Verify the shape matches `notificationLink` exactly**

Run: `grep -A 4 "case 'added_to_game'" src/lib/notificationContent.js` and compare key-by-key with the edge function's `deepLink` (screen `Main`, nested screen `Home`, param `openTournamentId` from `tournament_id`).
Expected: identical structure.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-push/index.ts
git commit -m "fix(send-push): mirror nested Main→Home deep link for added_to_game"
```

- [ ] **Step 4: Flag deployment**

The edge function only takes effect after `supabase functions deploy send-push` (requires Supabase CLI auth). Do not attempt to deploy from the task subagent — report it as a follow-up for the session owner. Until deployed, old-format pushes keep working via `normalizeDeepLink` (Task 2).

---

## Final verification (session owner, after all tasks)

- `npm test` and `npm run lint` clean on the final tree.
- Manual QA via the Expo web app (verify skill): open the Notifications inbox with an `added_to_game` notification present, tap it, confirm the app lands on that game's Tournament view.
- Remind the user to deploy the edge function: `supabase functions deploy send-push`.
