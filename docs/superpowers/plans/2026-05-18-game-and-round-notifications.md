# Game & Round Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a friend when they're added to a casual game, and notify all of a user's friends when that user finishes a round (casual or official), with deep links — surfaced through a new in-app notification inbox.

**Architecture:** Hybrid (Approach A). Database triggers handle events with a relational signal (`tournament_participants` insert → "added to game"; `tournament_attestations` insert → official "round finished"). A `SECURITY DEFINER` RPC handles casual "round finished", since that data lives only in the JSONB blob. All reuse the existing generic `notifications` table and `create_notification` function. An inbox screen renders notifications and the badge becomes an honest unread count.

**Tech Stack:** React Native (Expo SDK 54), Supabase (Postgres + RLS + Edge Functions/Deno), `expo-notifications`, Jest (`jest-expo`).

**Spec:** `docs/superpowers/specs/2026-05-18-game-and-round-notifications-design.md`

---

## File Structure

New files:
- `supabase/migrations/20260518000002_game_round_notifications.sql` — `notify_friends`, two trigger functions + triggers, `notify_round_finished` RPC.
- `src/lib/notificationContent.js` — `renderNotification` and `notificationLink` pure functions.
- `src/lib/__tests__/notificationContent.test.js` — tests for both.
- `src/screens/NotificationsScreen.js` — the in-app notification inbox.

Modified files:
- `src/store/notificationStore.js` — add `notifyRoundFinished` RPC wrapper.
- `src/store/__tests__/notificationStore.test.js` — add `rpc` to the mock + `notifyRoundFinished` tests.
- `src/screens/ScorecardScreen.js` — `handleFinish` calls `notifyRoundFinished` for casual rounds.
- `supabase/functions/send-push/index.ts` — `RENDERERS` return a `deepLink`; push payload carries it.
- `App.js` — tap handler passes params; register the `Notifications` route.
- `src/screens/HomeScreen.js` — `openTournamentId` route param; "Notifications" menu item; move the count badge off the Friends row.
- `src/screens/FriendsScreen.js` — remove the `markAllRead()` call.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260518000002_game_round_notifications.sql`

SQL only — not exercised by the JS test suite; verified by review and by manual application.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260518000002_game_round_notifications.sql` with exactly this content:

```sql
-- ============================================================================
-- Game & Round Notifications — schema.
-- Spec: docs/superpowers/specs/2026-05-18-game-and-round-notifications-design.md
-- Builds on 20260518000001_notifications.sql (notifications table,
-- create_notification). Safe to re-run. Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) Fan-out helper: create one notification per accepted friend of p_actor.
--    Bakes the actor's display name into data.actor_name so both the push
--    text and the in-app inbox can render without an extra lookup.
CREATE OR REPLACE FUNCTION public.notify_friends(
  p_actor uuid, p_type text, p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_name text;
  v_data jsonb;
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  SELECT COALESCE(display_name, username, 'A friend') INTO v_actor_name
    FROM public.profiles WHERE user_id = p_actor;
  v_data := COALESCE(p_data, '{}'::jsonb)
            || jsonb_build_object('actor_name', COALESCE(v_actor_name, 'A friend'));
  INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
  SELECT
    CASE WHEN f.requester_id = p_actor THEN f.addressee_id ELSE f.requester_id END,
    p_type, p_actor, NULL, v_data
  FROM public.friendships f
  WHERE f.status = 'accepted'
    AND (f.requester_id = p_actor OR f.addressee_id = p_actor);
END;
$$;

-- 2) Trigger: a user added to a CASUAL game gets an 'added_to_game'
--    notification. create_notification no-ops when recipient = actor, so a
--    creator appearing as their own participant is skipped. Official
--    tournaments are intentionally not covered (players self-join via tokens).
CREATE OR REPLACE FUNCTION public.notify_participant_added() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind    text;
  v_name    text;
  v_creator uuid;
BEGIN
  SELECT kind, name, created_by INTO v_kind, v_name, v_creator
    FROM public.tournaments WHERE id = NEW.tournament_id;
  IF v_kind = 'casual' THEN
    PERFORM public.create_notification(
      NEW.user_id, 'added_to_game', v_creator, NULL,
      jsonb_build_object(
        'tournament_id', NEW.tournament_id,
        'tournament_name', COALESCE(v_name, 'a game')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_participants_notify ON public.tournament_participants;
CREATE TRIGGER tournament_participants_notify
  AFTER INSERT ON public.tournament_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_participant_added();

-- 3) Trigger: a player attesting their card in an official tournament has
--    finished their round — notify all of that player's friends. Guests
--    (roster rows with no linked account) are skipped.
CREATE OR REPLACE FUNCTION public.notify_attestation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user             uuid;
  v_round_index      int;
  v_tournament_id    text;
  v_course_name      text;
  v_tournament_name  text;
BEGIN
  SELECT user_id INTO v_user FROM public.tournament_roster WHERE id = NEW.roster_id;
  IF v_user IS NULL THEN RETURN NEW; END IF;
  SELECT r.round_index, r.tournament_id, COALESCE(r.course->>'name', '')
    INTO v_round_index, v_tournament_id, v_course_name
    FROM public.tournament_rounds r WHERE r.id = NEW.round_id;
  SELECT name INTO v_tournament_name
    FROM public.tournaments WHERE id = v_tournament_id;
  PERFORM public.notify_friends(v_user, 'round_finished', jsonb_build_object(
    'tournament_id',   v_tournament_id,
    'round_id',        NEW.round_id::text,
    'round_index',     v_round_index,
    'tournament_name', COALESCE(v_tournament_name, 'a tournament'),
    'course_name',     v_course_name,
    'kind',            'official'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_attestations_notify ON public.tournament_attestations;
CREATE TRIGGER tournament_attestations_notify
  AFTER INSERT ON public.tournament_attestations
  FOR EACH ROW EXECUTE FUNCTION public.notify_attestation();

-- 4) RPC: casual "round finished". The casual "Finish" button persists
--    nothing, so this is idempotent — a re-tap finds the existing
--    notification and returns. Actor is always the caller.
CREATE OR REPLACE FUNCTION public.notify_round_finished(
  p_tournament_id text, p_round_id text, p_round_index int,
  p_tournament_name text, p_course_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications
     WHERE actor_id = v_actor
       AND type = 'round_finished'
       AND data->>'round_id' = p_round_id
  ) THEN
    RETURN;
  END IF;
  PERFORM public.notify_friends(v_actor, 'round_finished', jsonb_build_object(
    'tournament_id',   p_tournament_id,
    'round_id',        p_round_id,
    'round_index',     p_round_index,
    'tournament_name', COALESCE(p_tournament_name, 'a game'),
    'course_name',     COALESCE(p_course_name, ''),
    'kind',            'casual'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_round_finished(text,text,int,text,text)
  TO authenticated;
```

- [ ] **Step 2: Verify the SQL**

Review against the spec's "Server-side" section. Confirm: `notify_friends`, `notify_participant_added` + its trigger, `notify_attestation` + its trigger, `notify_round_finished` + its GRANT are all present; every function is `CREATE OR REPLACE`; every trigger has a preceding `DROP TRIGGER IF EXISTS`. Applying to the remote DB is a deployment step (Task 10).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260518000002_game_round_notifications.sql
git commit -m "feat: triggers and RPC for game/round notifications"
```

---

## Task 2: notificationContent.js — render + link pure functions

**Files:**
- Create: `src/lib/notificationContent.js`
- Test: `src/lib/__tests__/notificationContent.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/notificationContent.test.js`:

```javascript
import { renderNotification, notificationLink } from '../notificationContent';

describe('renderNotification', () => {
  test('friend_request uses the actor name', () => {
    const r = renderNotification('friend_request', { actor_name: 'Sam' });
    expect(r.title).toBe('New friend request');
    expect(r.body).toBe('Sam wants to be your golf partner');
  });

  test('friend_accepted uses the actor name', () => {
    const r = renderNotification('friend_accepted', { actor_name: 'Sam' });
    expect(r.title).toBe('Friend request accepted');
    expect(r.body).toBe('Sam accepted your friend request');
  });

  test('added_to_game names the tournament', () => {
    const r = renderNotification('added_to_game', { tournament_name: 'Weekend Cup' });
    expect(r.title).toBe('Added to a game');
    expect(r.body).toBe('You were added to Weekend Cup');
  });

  test('round_finished uses actor name and course name', () => {
    const r = renderNotification('round_finished', { actor_name: 'Jo', course_name: 'Pebble' });
    expect(r.title).toBe('Round finished');
    expect(r.body).toBe('Jo finished a round at Pebble');
  });

  test('round_finished falls back to tournament name when course is empty', () => {
    const r = renderNotification('round_finished', { actor_name: 'Jo', course_name: '', tournament_name: 'Spring Open' });
    expect(r.body).toBe('Jo finished a round at Spring Open');
  });

  test('missing actor name falls back to "A friend"', () => {
    const r = renderNotification('round_finished', { course_name: 'Pebble' });
    expect(r.body).toBe('A friend finished a round at Pebble');
  });

  test('unknown type returns a generic notification', () => {
    const r = renderNotification('something_else', {});
    expect(r.title).toBe('Notification');
  });
});

describe('notificationLink', () => {
  test('friend types route to Friends', () => {
    expect(notificationLink('friend_request', {})).toEqual({ screen: 'Friends' });
    expect(notificationLink('friend_accepted', {})).toEqual({ screen: 'Friends' });
  });

  test('added_to_game routes to Home with the tournament id', () => {
    expect(notificationLink('added_to_game', { tournament_id: 't1' }))
      .toEqual({ screen: 'Home', params: { openTournamentId: 't1' } });
  });

  test('round_finished routes to RoundSummary with tournament and round ids', () => {
    expect(notificationLink('round_finished', { tournament_id: 't1', round_id: 'r1' }))
      .toEqual({ screen: 'RoundSummary', params: { tournamentId: 't1', roundId: 'r1' } });
  });

  test('unknown type routes to the Notifications inbox', () => {
    expect(notificationLink('something_else', {})).toEqual({ screen: 'Notifications' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/lib/__tests__/notificationContent.test.js`
Expected: FAIL — `Cannot find module '../notificationContent'`.

- [ ] **Step 3: Write the module**

Create `src/lib/notificationContent.js`:

```javascript
// Pure rendering + routing for notifications. The send-push edge function
// (Deno) deliberately mirrors renderNotification — it cannot import React
// Native code, so the two are kept in sync by hand.

const FALLBACK_NAME = 'A friend';

// notification type + data -> { icon, title, body } for the in-app inbox.
// `icon` values are Feather icon names.
export function renderNotification(type, data = {}) {
  const actorName = data.actor_name || FALLBACK_NAME;
  switch (type) {
    case 'friend_request':
      return {
        icon: 'user-plus',
        title: 'New friend request',
        body: `${actorName} wants to be your golf partner`,
      };
    case 'friend_accepted':
      return {
        icon: 'user-check',
        title: 'Friend request accepted',
        body: `${actorName} accepted your friend request`,
      };
    case 'added_to_game':
      return {
        icon: 'flag',
        title: 'Added to a game',
        body: `You were added to ${data.tournament_name || 'a game'}`,
      };
    case 'round_finished':
      return {
        icon: 'check-circle',
        title: 'Round finished',
        body: `${actorName} finished a round at `
          + `${data.course_name || data.tournament_name || 'the course'}`,
      };
    default:
      return { icon: 'bell', title: 'Notification', body: '' };
  }
}

// notification type + data -> { screen, params? } for navigation. Used by
// both the inbox (row tap) and App.js (push tap).
export function notificationLink(type, data = {}) {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
      return { screen: 'Friends' };
    case 'added_to_game':
      return { screen: 'Home', params: { openTournamentId: data.tournament_id } };
    case 'round_finished':
      return {
        screen: 'RoundSummary',
        params: { tournamentId: data.tournament_id, roundId: data.round_id },
      };
    default:
      return { screen: 'Notifications' };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/lib/__tests__/notificationContent.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificationContent.js src/lib/__tests__/notificationContent.test.js
git commit -m "feat: notificationContent render + link pure functions"
```

---

## Task 3: notificationStore — notifyRoundFinished RPC wrapper

**Files:**
- Modify: `src/store/notificationStore.js`
- Test: `src/store/__tests__/notificationStore.test.js`

- [ ] **Step 1: Extend the test mock and add failing tests**

In `src/store/__tests__/notificationStore.test.js`, update the `mockState` declaration line:

```javascript
const mockState = { user: { id: 'user-1' }, rows: [], error: null, updatePayload: undefined };
```

to:

```javascript
const mockState = {
  user: { id: 'user-1' }, rows: [], error: null, updatePayload: undefined,
  rpcCalls: [], rpcError: null,
};
```

In the `jest.mock('../../lib/supabase', ...)` factory, the returned `client` object currently is:

```javascript
  const client = {
    from: () => builder(),
    auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
  };
```

Change it to add an `rpc` method:

```javascript
  const client = {
    from: () => builder(),
    rpc: (name, args) => {
      mockState.rpcCalls.push({ name, args });
      return Promise.resolve({ error: mockState.rpcError });
    },
    auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
  };
```

In the `beforeEach` block, add two reset lines so it becomes:

```javascript
  beforeEach(() => {
    mockState.user = { id: 'user-1' };
    mockState.rows = [];
    mockState.error = null;
    mockState.updatePayload = undefined;
    mockState.rpcCalls = [];
    mockState.rpcError = null;
  });
```

Update the import line at the top of the file to include the new export:

```javascript
import { unreadCount, listNotifications, markAllRead, notifyRoundFinished } from '../notificationStore';
```

Add this `describe` block at the end of the file:

```javascript
describe('notifyRoundFinished', () => {
  test('calls the notify_round_finished RPC with stringified ids', async () => {
    await notifyRoundFinished({
      tournamentId: 1747000000000, roundId: 'r1', roundIndex: 2,
      tournamentName: 'Weekend Cup', courseName: 'Pebble',
    });
    expect(mockState.rpcCalls).toContainEqual({
      name: 'notify_round_finished',
      args: {
        p_tournament_id: '1747000000000',
        p_round_id: 'r1',
        p_round_index: 2,
        p_tournament_name: 'Weekend Cup',
        p_course_name: 'Pebble',
      },
    });
  });

  test('throws when the RPC returns an error', async () => {
    mockState.rpcError = { message: 'boom' };
    await expect(notifyRoundFinished({
      tournamentId: 't1', roundId: 'r1', roundIndex: 0,
      tournamentName: 'X', courseName: 'Y',
    })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/notificationStore.test.js`
Expected: FAIL — `notifyRoundFinished` is not exported.

- [ ] **Step 3: Add `notifyRoundFinished` to the store**

Append to `src/store/notificationStore.js`:

```javascript
// Fire the casual "round finished" fan-out. Invoked from the Scorecard
// "Finish" button. The RPC is idempotent server-side, so a re-tap is safe.
export async function notifyRoundFinished({
  tournamentId, roundId, roundIndex, tournamentName, courseName,
}) {
  const { error } = await supabase.rpc('notify_round_finished', {
    p_tournament_id: String(tournamentId),
    p_round_id: String(roundId),
    p_round_index: roundIndex ?? 0,
    p_tournament_name: tournamentName ?? '',
    p_course_name: courseName ?? '',
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/store/__tests__/notificationStore.test.js`
Expected: PASS — all tests green (the original 6 plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/store/notificationStore.js src/store/__tests__/notificationStore.test.js
git commit -m "feat: notifyRoundFinished RPC wrapper in notificationStore"
```

---

## Task 4: ScorecardScreen — fire the notification on Finish

**Files:**
- Modify: `src/screens/ScorecardScreen.js` — import + `handleFinish` (around lines 847-891).

UI wiring — verified manually plus the store test suite for regressions.

- [ ] **Step 1: Add the import**

At the top of `src/screens/ScorecardScreen.js`, alongside the other store imports, add:

```javascript
import { notifyRoundFinished } from '../store/notificationStore';
```

- [ ] **Step 2: Call `notifyRoundFinished` in `handleFinish`**

In `handleFinish` (around line 847), the function currently begins:

```javascript
  const handleFinish = useCallback(() => {
    const t = tournamentRef.current;
    const r = t?.rounds?.[roundIndex];
    if (!t || !r) { goBack(); return; }

    const liveRound = { ...r, scores };
```

Insert the notification call right after the `if (!t || !r)` guard, so it becomes:

```javascript
  const handleFinish = useCallback(() => {
    const t = tournamentRef.current;
    const r = t?.rounds?.[roundIndex];
    if (!t || !r) { goBack(); return; }

    // Notify the finisher's friends that a casual round wrapped up. Official
    // rounds notify server-side on attestation, so skip them here.
    // Best-effort — a failure never blocks finishing the round.
    if (!official && t.kind !== 'official') {
      notifyRoundFinished({
        tournamentId: t.id,
        roundId: r.id,
        roundIndex,
        tournamentName: t.name,
        courseName: r.courseName,
      }).catch(() => {});
    }

    const liveRound = { ...r, scores };
```

- [ ] **Step 3: Verify**

Run: `npx jest src/store`
Expected: PASS — no store regressions. Then start the app (`npm run web`) and confirm `ScorecardScreen` still loads with no red-box error.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: notify friends when a casual round is finished"
```

---

## Task 5: send-push edge function — deep links per type

**Files:**
- Modify: `supabase/functions/send-push/index.ts`

Deno — verified by review and deployment, not the JS suite.

- [ ] **Step 1: Replace the RENDERERS map**

In `supabase/functions/send-push/index.ts`, the current `RENDERERS` constant is:

```typescript
// type -> push title/body. Unknown types are skipped (the in-app row still
// exists, it just gets no push).
const RENDERERS: Record<string, (d: Record<string, unknown>) => { title: string; body: string }> = {
  friend_request: (d) => ({
    title: 'New friend request',
    body: `${d.actor_name ?? 'Someone'} wants to be your golf partner`,
  }),
  friend_accepted: (d) => ({
    title: 'Friend request accepted',
    body: `${d.actor_name ?? 'Someone'} accepted your friend request`,
  }),
};
```

Replace it with (each renderer now also returns a `deepLink`):

```typescript
type DeepLink = { screen: string; params?: Record<string, unknown> };
type Rendered = { title: string; body: string; deepLink: DeepLink };

// type -> push title/body/deepLink. Mirrors src/lib/notificationContent.js
// (Deno cannot import React Native code). Unknown types are skipped.
const RENDERERS: Record<string, (d: Record<string, unknown>) => Rendered> = {
  friend_request: (d) => ({
    title: 'New friend request',
    body: `${d.actor_name ?? 'Someone'} wants to be your golf partner`,
    deepLink: { screen: 'Friends' },
  }),
  friend_accepted: (d) => ({
    title: 'Friend request accepted',
    body: `${d.actor_name ?? 'Someone'} accepted your friend request`,
    deepLink: { screen: 'Friends' },
  }),
  added_to_game: (d) => ({
    title: 'Added to a game',
    body: `You were added to ${d.tournament_name ?? 'a game'}`,
    deepLink: { screen: 'Home', params: { openTournamentId: d.tournament_id } },
  }),
  round_finished: (d) => ({
    title: 'Round finished',
    body: `${d.actor_name ?? 'A friend'} finished a round at `
      + `${d.course_name || d.tournament_name || 'the course'}`,
    deepLink: {
      screen: 'RoundSummary',
      params: { tournamentId: d.tournament_id, roundId: d.round_id },
    },
  }),
};
```

- [ ] **Step 2: Use `deepLink` in the push payload**

In the same file, the message-build currently is:

```typescript
    const render = RENDERERS[note.type];
    if (!render) return new Response('ignored type', { status: 200 });
    const { title, body } = render(note.data ?? {});
```

Change the destructuring to include `deepLink`:

```typescript
    const render = RENDERERS[note.type];
    if (!render) return new Response('ignored type', { status: 200 });
    const { title, body, deepLink } = render(note.data ?? {});
```

Then the messages array currently is:

```typescript
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      title,
      body,
      sound: 'default',
      data: { screen: 'Friends' },
    }));
```

Change `data` to carry the deep link:

```typescript
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      title,
      body,
      sound: 'default',
      data: deepLink,
    }));
```

- [ ] **Step 3: Review**

Confirm the four `RENDERERS` entries match `src/lib/notificationContent.js` (`notificationLink`) — `friend_request`/`friend_accepted` → `Friends`, `added_to_game` → `Home` + `openTournamentId`, `round_finished` → `RoundSummary` + `tournamentId`/`roundId`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-push/index.ts
git commit -m "feat: per-type deep links in send-push edge function"
```

---

## Task 6: NotificationsScreen — the inbox

**Files:**
- Create: `src/screens/NotificationsScreen.js`

New screen — verified manually; its rendering/link logic is the pure functions already tested in Task 2.

- [ ] **Step 1: Create the screen**

Create `src/screens/NotificationsScreen.js`:

```javascript
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../theme/ThemeContext';
import { listNotifications, markAllRead } from '../store/notificationStore';
import { renderNotification, notificationLink } from '../lib/notificationContent';

// Relative "time ago" for the notification list. Coarse on purpose.
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load on focus, and mark everything read — opening this screen IS the
  // user seeing their notifications, so the badge should clear.
  const reload = useCallback(async () => {
    try {
      const data = await listNotifications();
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
    markAllRead().catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const openItem = (item) => {
    const { screen, params } = notificationLink(item.type, item.data);
    navigation.navigate(screen, params);
  };

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
          activeOpacity={0.7}
        >
          <Feather name="chevron-left" size={24} color={theme.text.primary} />
        </TouchableOpacity>
        <Text style={s.title}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Feather name="bell" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {items.map((item) => {
            const { icon, title, body } = renderNotification(item.type, item.data);
            const unread = !item.readAt;
            return (
              <TouchableOpacity
                key={item.id}
                style={[s.row, unread && s.rowUnread]}
                onPress={() => openItem(item)}
                activeOpacity={0.7}
              >
                <View style={s.iconWrap}>
                  <Feather name={icon} size={18} color={theme.accent.primary} />
                </View>
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{title}</Text>
                  {!!body && <Text style={s.rowText}>{body}</Text>}
                  <Text style={s.rowTime}>{timeAgo(item.createdAt)}</Text>
                </View>
                {unread && <View style={s.unreadDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, color: t.text.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, color: t.text.muted },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 14,
    borderRadius: 14, marginBottom: 8,
    backgroundColor: t.bg.card,
    borderWidth: 1, borderColor: t.border.default,
  },
  rowUnread: { borderColor: t.accent.primary },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.bg.secondary,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: t.text.primary },
  rowText: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: t.text.secondary },
  rowTime: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: t.text.muted },
  unreadDot: {
    width: 9, height: 9, borderRadius: 5, backgroundColor: t.accent.primary,
  },
});
```

Note: this follows the existing screen conventions (`ScreenContainer`, `useTheme`, `makeStyles(theme)`, Feather icons, `PlusJakartaSans-*` fonts). If a theme token used here is missing (e.g. `theme.text.secondary` or `theme.border.default`), substitute the nearest existing token used by `FriendsScreen.js` rather than inventing one.

- [ ] **Step 2: Verify**

Run: `npx jest src/store src/lib`
Expected: PASS. The screen is wired into navigation in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/screens/NotificationsScreen.js
git commit -m "feat: NotificationsScreen inbox"
```

---

## Task 7: App.js — register the route and pass params on tap

**Files:**
- Modify: `App.js`

- [ ] **Step 1: Import NotificationsScreen**

In `App.js`, alongside the other screen imports (e.g. after `import FriendsScreen from './src/screens/FriendsScreen';`), add:

```javascript
import NotificationsScreen from './src/screens/NotificationsScreen';
```

- [ ] **Step 2: Register the `Notifications` route**

In the `Stack.Navigator` (in `AppNavigator`), alongside the other `Stack.Screen` entries (e.g. right after the `Friends` screen line), add:

```jsx
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
```

- [ ] **Step 3: Pass params in the notification-tap handler**

In `AppNavigator`, the notification-response effect currently is:

```javascript
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const screen = response?.notification?.request?.content?.data?.screen;
      if (screen && navigationRef.isReady()) {
        navigationRef.navigate(screen);
      }
    });
    return () => sub.remove();
  }, []);
```

Replace it with (read `params` too):

```javascript
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.screen && navigationRef.isReady()) {
        navigationRef.navigate(data.screen, data.params);
      }
    });
    return () => sub.remove();
  }, []);
```

- [ ] **Step 4: Verify**

Run: `npx jest src/store src/lib`
Expected: PASS. Start the app (`npm run web`) and confirm it loads with no red-box error.

- [ ] **Step 5: Commit**

```bash
git add App.js
git commit -m "feat: register Notifications route, pass deep-link params on tap"
```

---

## Task 8: HomeScreen — Notifications menu item + openTournamentId

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Add the "Notifications" menu item and move the badge off Friends**

In `src/screens/HomeScreen.js`, the overflow-menu modal currently contains a Friends row then a Statistics row. The Friends row currently is:

```jsx
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowListMenu(false); navigation.navigate('Friends'); }}
                activeOpacity={0.7}
              >
                <Feather name="users" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Friends</Text>
                {unreadNotifs > 0 && (
                  <View style={s.menuItemBadge}>
                    <Text style={s.menuItemBadgeText}>{unreadNotifs > 9 ? '9+' : unreadNotifs}</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
```

Replace that Friends `TouchableOpacity` with a Friends row (badge removed) followed by a new Notifications row (badge moved here):

```jsx
              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowListMenu(false); navigation.navigate('Friends'); }}
                activeOpacity={0.7}
              >
                <Feather name="users" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Friends</Text>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={s.menuItem}
                onPress={() => { setShowListMenu(false); navigation.navigate('Notifications'); }}
                activeOpacity={0.7}
              >
                <Feather name="bell" size={18} color={theme.accent.primary} />
                <Text style={s.menuItemText}>Notifications</Text>
                {unreadNotifs > 0 && (
                  <View style={s.menuItemBadge}>
                    <Text style={s.menuItemBadgeText}>{unreadNotifs > 9 ? '9+' : unreadNotifs}</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
```

Leave the Statistics row (the one with `borderBottomWidth: 0`) exactly as it is — it stays the last item.

- [ ] **Step 2: Auto-select a tournament from the `openTournamentId` param**

`HomeScreen` receives `route`. It already has an `async function selectTournament(id)`. Add this effect alongside the other `useEffect`s in the component, placed *after* `selectTournament` is defined in the file (to avoid a use-before-define lint error):

```javascript
// Deep link from an "added to a game" notification — open that game.
useEffect(() => {
  const id = route.params?.openTournamentId;
  if (id) selectTournament(id);
}, [route.params?.openTournamentId]);
```

Do not change `selectTournament` itself.

- [ ] **Step 3: Verify**

Run: `npx jest src/store src/lib`
Expected: PASS. Start the app (`npm run web`), open the overflow menu, confirm Friends / Notifications / Statistics all appear and Notifications opens the inbox.

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: Notifications menu entry and openTournamentId deep link"
```

---

## Task 9: FriendsScreen — stop marking notifications read

**Files:**
- Modify: `src/screens/FriendsScreen.js`

- [ ] **Step 1: Remove the markAllRead import**

In `src/screens/FriendsScreen.js`, delete this import line:

```javascript
import { markAllRead } from '../store/notificationStore';
```

- [ ] **Step 2: Remove the markAllRead call from `reload`**

In the `reload` callback, delete the trailing comment + call so the callback ends at its `finally` block:

```javascript
    // Opening the Friends screen is the user seeing their requests — clear the
    // notification badge. Best-effort: a failure just leaves the badge until
    // the next visit.
    markAllRead().catch(() => {});
```

Delete those four lines. The `reload` callback should now end with its `finally { ... }` block immediately followed by `}, []);`.

- [ ] **Step 3: Verify**

Run: `npx jest src/store src/lib`
Expected: PASS. Start the app (`npm run web`) and confirm `FriendsScreen` still loads. Marking-read is now owned by `NotificationsScreen`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/FriendsScreen.js
git commit -m "refactor: move mark-as-read from Friends to Notifications screen"
```

---

## Task 10: Deployment

Runs against live infrastructure — performed once, by the user or with their approval.

- [ ] **Step 1: Apply the migration**

Apply `supabase/migrations/20260518000002_game_round_notifications.sql` to the remote database (Supabase SQL editor or `supabase db push`). Verify `notify_friends`, `notify_round_finished`, and the two triggers (`tournament_participants_notify`, `tournament_attestations_notify`) exist.

- [ ] **Step 2: Re-deploy the edge function**

Run: `supabase functions deploy send-push`

- [ ] **Step 3: End-to-end verification**

With two friend accounts A and B:
- A creates a casual game and adds B → B gets an "Added to a game" notification; tapping it opens that game.
- A finishes a casual round (the "Finish" button on hole 18) → B gets a "Round finished" notification; tapping it opens the round summary. A second tap of "Finish" produces no duplicate.
- In an official tournament, B attesting their card → B's friends get a "Round finished" notification.
- Confirm the HomeScreen menu badge counts these and clears after opening the Notifications inbox (not after opening Friends).

No new webhook is needed — the existing `notifications` INSERT webhook already covers the new types.

---

## Self-Review Notes

- **Spec coverage:** `notify_friends` + both triggers + RPC (Task 1) · casual Finish hook (Tasks 3-4) · official attestation trigger (Task 1) · `renderNotification`/`notificationLink` (Task 2) · edge-function deep links (Task 5) · App.js param routing + route registration (Task 7) · `NotificationsScreen` inbox (Task 6) · HomeScreen menu item + `openTournamentId` (Task 8) · move `markAllRead` off Friends (Task 9) · testing (Tasks 2-3) · deployment (Task 10). All spec sections map to a task.
- **Type consistency:** `notify_round_finished(p_tournament_id, p_round_id, p_round_index, p_tournament_name, p_course_name)` is identical in the SQL (Task 1), the `notifyRoundFinished` wrapper (Task 3), and its test. `renderNotification(type, data)` and `notificationLink(type, data)` signatures are consistent across Tasks 2, 5 (mirrored), 6. The `deepLink` shape `{ screen, params }` produced by the edge function (Task 5) matches what the App.js handler consumes (Task 7) and what `notificationLink` returns (Task 2). `openTournamentId` is produced by `notificationLink`/the edge function and consumed by HomeScreen (Task 8).
- **Spec deviation (intentional):** the spec said the inbox resolves the actor name from `profiles`; this plan instead bakes `actor_name` into `data` inside `notify_friends` (Task 1), so the inbox needs no extra lookup. Same result, simpler — `renderNotification` just reads `data.actor_name`.
- **No placeholders:** every code step contains complete, runnable content.
