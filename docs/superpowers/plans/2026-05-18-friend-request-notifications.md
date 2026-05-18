# Friend Request Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the recipient of a friend request (and the sender when it is accepted) via a push notification and an in-app badge, using a generic notification system reusable by future features.

**Architecture:** A Postgres trigger on `friendships` writes rows into a type-agnostic `notifications` table through a `create_notification` function. The in-app badge reads the unread count from that table. A Supabase database webhook on `notifications` INSERT fires a `send-push` edge function that delivers an Expo push to the recipient's stored device tokens.

**Tech Stack:** React Native (Expo SDK 54), Supabase (Postgres + RLS + Edge Functions/Deno), `expo-notifications`, Jest (`jest-expo`).

**Spec:** `docs/superpowers/specs/2026-05-18-friend-request-notifications-design.md`

---

## File Structure

New files:
- `supabase/migrations/20260518000001_notifications.sql` — `notifications` + `push_tokens` tables, RLS, `create_notification`, `delete_notification_for_entity`, the `friendships` trigger.
- `supabase/functions/send-push/index.ts` — the edge function that sends Expo pushes.
- `src/store/notificationStore.js` — client read/write surface for notifications.
- `src/store/__tests__/notificationStore.test.js` — unit tests for the store.
- `src/lib/pushNotifications.js` — Expo push registration + notification handler config.

Modified files:
- `package.json` — adds `expo-notifications`.
- `src/store/friendStore.js` — `declineRequest` clears the related notification.
- `src/store/__tests__/friendStore.test.js` — new test file covering the `declineRequest` change.
- `src/screens/HomeScreen.js` — unread badge on the menu icon and the "Friends" menu row.
- `src/screens/FriendsScreen.js` — marks notifications read when opened.
- `App.js` — registers the push token after login and routes notification taps to `Friends`.

---

## Task 1: Database migration — notifications schema

**Files:**
- Create: `supabase/migrations/20260518000001_notifications.sql`

This task is SQL only — it cannot be exercised by the JS test suite, so it is verified by review and by manual application.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260518000001_notifications.sql` with exactly this content:

```sql
-- ============================================================================
-- Friend Request Notifications — schema.
-- Spec: docs/superpowers/specs/2026-05-18-friend-request-notifications-design.md
-- Safe to re-run (every statement idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) Generic notifications table. Knows nothing about friendships — `type` is
--    a free-text event string and `entity_id` is a polymorphic (FK-less)
--    reference, so future notification types reuse this table unchanged.
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (length(type) > 0),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_id   uuid,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- Clients only ever flip read_at; no INSERT/DELETE policy — rows are written
-- by create_notification and removed by delete_notification_for_entity.
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2) Expo push tokens, one row per device.
CREATE TABLE IF NOT EXISTS public.push_tokens (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Owner-only. The edge function reads tokens with the service-role key, which
-- bypasses RLS, so other clients never see another user's tokens.
DROP POLICY IF EXISTS push_tokens_all ON public.push_tokens;
CREATE POLICY push_tokens_all ON public.push_tokens
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3) Single insertion point for every notification type. SECURITY DEFINER so
--    triggers can write rows the caller could not insert directly. No-op when
--    the recipient is the actor (never notify yourself).
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid, p_type text, p_actor_id uuid, p_entity_id uuid, p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
  VALUES (p_user_id, p_type, p_actor_id, p_entity_id, COALESCE(p_data, '{}'::jsonb));
END;
$$;

-- 4) Cleanup helper — removes the caller's notification(s) for a given entity
--    (used when a friend request is declined). Scoped to auth.uid() so a
--    caller can only ever delete their own notifications.
CREATE OR REPLACE FUNCTION public.delete_notification_for_entity(
  p_entity_id uuid, p_type text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE entity_id = p_entity_id
    AND type = p_type
    AND user_id = auth.uid();
END;
$$;

-- 5) The only friendship-specific server code: turn friendship row changes
--    into notifications. actor_name is baked into data so the edge function
--    never has to look it up.
CREATE OR REPLACE FUNCTION public.notify_friendship() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_name text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    SELECT COALESCE(display_name, username, 'A golfer') INTO actor_name
      FROM public.profiles WHERE user_id = NEW.requester_id;
    PERFORM public.create_notification(
      NEW.addressee_id, 'friend_request', NEW.requester_id, NEW.id,
      jsonb_build_object('actor_name', COALESCE(actor_name, 'A golfer')));
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(display_name, username, 'A golfer') INTO actor_name
      FROM public.profiles WHERE user_id = NEW.addressee_id;
    PERFORM public.create_notification(
      NEW.requester_id, 'friend_accepted', NEW.addressee_id, NEW.id,
      jsonb_build_object('actor_name', COALESCE(actor_name, 'A golfer')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_notify ON public.friendships;
CREATE TRIGGER friendships_notify
  AFTER INSERT OR UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.notify_friendship();
```

- [ ] **Step 2: Verify the SQL parses**

The migration cannot be unit-tested. Review it against the spec's "Data model" and "Server-side flow" sections and confirm:
- both tables, the index, and all four objects (`create_notification`, `delete_notification_for_entity`, `notify_friendship`, the trigger) are present;
- every `CREATE` is idempotent (`IF NOT EXISTS` / `OR REPLACE`) and every `POLICY`/`TRIGGER` is preceded by a `DROP ... IF EXISTS`.

Applying it to the remote database is a deployment step (see Task 9).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260518000001_notifications.sql
git commit -m "feat: notifications schema, push_tokens table, friendship trigger"
```

---

## Task 2: notificationStore.js — client read/write surface

**Files:**
- Create: `src/store/notificationStore.js`
- Test: `src/store/__tests__/notificationStore.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/notificationStore.test.js`:

```javascript
import { unreadCount, listNotifications, markAllRead } from '../notificationStore';

// mockState is read inside the jest.mock factory; the `mock` prefix is what
// lets jest's hoisted factory reference it.
const mockState = { user: { id: 'user-1' }, rows: [], error: null, updatePayload: undefined };

jest.mock('../../lib/supabase', () => {
  // A minimal supabase query-builder stub. Every chain method returns the
  // builder; awaiting it resolves to {data}/{count}/{error} depending on the
  // operation that was started by select()/update().
  function builder() {
    return {
      _op: 'select',
      _head: false,
      select(_cols, opts) { this._op = 'select'; this._head = !!(opts && opts.head); return this; },
      update(payload) { this._op = 'update'; mockState.updatePayload = payload; return this; },
      eq() { return this; },
      is() { return this; },
      order() { return this; },
      limit() { return this; },
      then(resolve) {
        if (mockState.error) return resolve({ data: null, count: null, error: mockState.error });
        if (this._op === 'update') return resolve({ error: null });
        if (this._head) return resolve({ count: mockState.rows.length, error: null });
        return resolve({ data: mockState.rows, error: null });
      },
    };
  }
  const client = {
    from: () => builder(),
    auth: { getUser: () => Promise.resolve({ data: { user: mockState.user } }) },
  };
  return { supabase: client };
});

describe('notificationStore', () => {
  beforeEach(() => {
    mockState.user = { id: 'user-1' };
    mockState.rows = [];
    mockState.error = null;
    mockState.updatePayload = undefined;
  });

  test('unreadCount returns the number of unread rows', async () => {
    mockState.rows = [{ id: 'n1' }, { id: 'n2' }];
    expect(await unreadCount()).toBe(2);
  });

  test('unreadCount returns 0 when no user is signed in', async () => {
    mockState.user = null;
    expect(await unreadCount()).toBe(0);
  });

  test('listNotifications maps DB rows to camelCase notification objects', async () => {
    mockState.rows = [{
      id: 'n1', type: 'friend_request', actor_id: 'user-2', entity_id: 'f1',
      data: { actor_name: 'Sam' }, read_at: null, created_at: '2026-05-18T10:00:00Z',
    }];
    const [n] = await listNotifications();
    expect(n).toEqual({
      id: 'n1', type: 'friend_request', actorId: 'user-2', entityId: 'f1',
      data: { actor_name: 'Sam' }, readAt: null, createdAt: '2026-05-18T10:00:00Z',
    });
  });

  test('listNotifications returns [] when no user is signed in', async () => {
    mockState.user = null;
    expect(await listNotifications()).toEqual([]);
  });

  test('markAllRead writes a read_at timestamp', async () => {
    await markAllRead();
    expect(typeof mockState.updatePayload.read_at).toBe('string');
  });

  test('markAllRead is a no-op when no user is signed in', async () => {
    mockState.user = null;
    await markAllRead();
    expect(mockState.updatePayload).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/notificationStore.test.js`
Expected: FAIL — `Cannot find module '../notificationStore'`.

- [ ] **Step 3: Write the store**

Create `src/store/notificationStore.js`:

```javascript
import { supabase } from '../lib/supabase';

// Client surface for the generic `notifications` table (see
// supabase/migrations/20260518000001_notifications.sql). Rows are written
// server-side by triggers; the client only reads them and marks them read.

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function rowToNotification(row) {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id ?? null,
    entityId: row.entity_id ?? null,
    data: row.data ?? {},
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

// Count of unread notifications for the current user — drives the in-app badge.
export async function unreadCount() {
  const me = await currentUserId();
  if (!me) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', me)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

// Recent notifications for the current user, newest first.
export async function listNotifications() {
  const me = await currentUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, actor_id, entity_id, data, read_at, created_at')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(rowToNotification);
}

// Mark every unread notification as read — called when the user opens a
// screen that surfaces them (currently the Friends screen).
export async function markAllRead() {
  const me = await currentUserId();
  if (!me) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', me)
    .is('read_at', null);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/store/__tests__/notificationStore.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/notificationStore.js src/store/__tests__/notificationStore.test.js
git commit -m "feat: notificationStore with unreadCount, listNotifications, markAllRead"
```

---

## Task 3: friendStore.declineRequest clears the related notification

**Files:**
- Modify: `src/store/friendStore.js:191-195`
- Test: `src/store/__tests__/friendStore.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/friendStore.test.js`:

```javascript
import { declineRequest } from '../friendStore';

const mockState = { rpcCalls: [], deleteError: null };

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/supabase', () => {
  function builder() {
    return {
      delete() { return this; },
      eq() { return Promise.resolve({ error: mockState.deleteError }); },
    };
  }
  const client = {
    from: () => builder(),
    rpc: (name, args) => { mockState.rpcCalls.push({ name, args }); return Promise.resolve({ error: null }); },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  };
  return { supabase: client };
});

describe('declineRequest', () => {
  beforeEach(() => {
    mockState.rpcCalls = [];
    mockState.deleteError = null;
  });

  test('deletes the friend_request notification for the declined friendship', async () => {
    await declineRequest('friendship-9');
    expect(mockState.rpcCalls).toContainEqual({
      name: 'delete_notification_for_entity',
      args: { p_entity_id: 'friendship-9', p_type: 'friend_request' },
    });
  });

  test('throws when the friendship delete fails, before any cleanup', async () => {
    mockState.deleteError = { message: 'boom' };
    await expect(declineRequest('friendship-9')).rejects.toBeTruthy();
    expect(mockState.rpcCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/friendStore.test.js`
Expected: FAIL — the first test fails because `declineRequest` does not yet call `rpc`.

- [ ] **Step 3: Modify `declineRequest`**

In `src/store/friendStore.js`, replace the existing function (lines 191-195):

```javascript
// Decline an incoming request or cancel an outgoing one — both delete the row.
export async function declineRequest(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}
```

with:

```javascript
// Decline an incoming request or cancel an outgoing one — both delete the row.
// Also clears the friend_request notification so the recipient's badge stays
// honest. The cleanup is best-effort: the friendship is already gone, and a
// stale notification is harmless (it is marked read next time Friends opens).
export async function declineRequest(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
  try {
    await supabase.rpc('delete_notification_for_entity', {
      p_entity_id: friendshipId,
      p_type: 'friend_request',
    });
  } catch {
    // best-effort cleanup
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/store/__tests__/friendStore.test.js`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full store test suite for regressions**

Run: `npx jest src/store`
Expected: PASS — all store tests green.

- [ ] **Step 6: Commit**

```bash
git add src/store/friendStore.js src/store/__tests__/friendStore.test.js
git commit -m "feat: declineRequest clears the related friend_request notification"
```

---

## Task 4: In-app badge on the HomeScreen menu

**Files:**
- Modify: `src/screens/HomeScreen.js` — imports, badge state/effect, menu icon (lines ~677-683), Friends menu row (lines ~913-921), styles.

This task is UI wiring and is verified manually — the JS test suite does not render screens here.

- [ ] **Step 1: Add the imports**

At the top of `src/screens/HomeScreen.js`, add alongside the existing imports:

```javascript
import * as Notifications from 'expo-notifications';
import { unreadCount } from '../store/notificationStore';
```

- [ ] **Step 2: Add badge state and refresh effect**

Inside the `HomeScreen` component, near the other `useState` declarations (e.g. after `const [showListMenu, setShowListMenu] = useState(false);` at line 104), add:

```javascript
const [unreadNotifs, setUnreadNotifs] = useState(0);
```

Then add this effect alongside the other `useEffect`s in the component:

```javascript
// Unread-notification badge. Refreshes when the screen regains focus and
// whenever a push arrives while the app is foregrounded.
useEffect(() => {
  const refresh = () => {
    unreadCount().then(setUnreadNotifs).catch(() => {});
  };
  refresh();
  const unsubFocus = navigation.addListener('focus', refresh);
  const sub = Notifications.addNotificationReceivedListener(refresh);
  return () => { unsubFocus(); sub.remove(); };
}, [navigation]);
```

- [ ] **Step 3: Add the badge to the menu icon**

Replace the menu `TouchableOpacity` (lines ~677-683):

```jsx
<TouchableOpacity
  style={s.iconBtn}
  onPress={() => setShowListMenu(true)}
  activeOpacity={0.7}
  accessibilityLabel="Menu"
>
  <Feather name="menu" size={18} color={theme.accent.primary} />
</TouchableOpacity>
```

with:

```jsx
<TouchableOpacity
  style={s.iconBtn}
  onPress={() => setShowListMenu(true)}
  activeOpacity={0.7}
  accessibilityLabel={unreadNotifs > 0 ? `Menu, ${unreadNotifs} notifications` : 'Menu'}
>
  <Feather name="menu" size={18} color={theme.accent.primary} />
  {unreadNotifs > 0 && <View style={s.notifDot} />}
</TouchableOpacity>
```

- [ ] **Step 4: Add the count to the Friends menu row**

Replace the Friends menu row (lines ~913-921):

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
```

with:

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

- [ ] **Step 5: Add the styles**

In the `HomeScreen` `StyleSheet.create({...})` block, add these entries (the file builds styles from `theme`; use the same `theme` reference the surrounding styles use):

```javascript
notifDot: {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 9,
  height: 9,
  borderRadius: 5,
  backgroundColor: theme.accent.danger ?? '#e5484d',
  borderWidth: 1.5,
  borderColor: theme.bg.card,
},
menuItemBadge: {
  minWidth: 20,
  height: 20,
  borderRadius: 10,
  paddingHorizontal: 6,
  backgroundColor: theme.accent.danger ?? '#e5484d',
  alignItems: 'center',
  justifyContent: 'center',
},
menuItemBadgeText: {
  fontFamily: 'PlusJakartaSans-Bold',
  fontSize: 11,
  color: theme.text.inverse ?? '#fff',
},
```

Note: if `s.menuItemText` does not already use `flex: 1` to push the chevron to the right, leave the layout as-is — the badge sits between the label and the chevron either way.

- [ ] **Step 6: Verify the screen builds**

Run: `npx jest src/store` (confirms no store regressions) and start the app (`npm run web`) to confirm `HomeScreen` renders with no red-box error. The badge shows only once notifications exist (created by real friend requests once the migration is deployed).

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: unread-notification badge on the HomeScreen menu"
```

---

## Task 5: FriendsScreen marks notifications read on open

**Files:**
- Modify: `src/screens/FriendsScreen.js` — import and the `reload` callback (lines ~73-87).

- [ ] **Step 1: Add the import**

At the top of `src/screens/FriendsScreen.js`, add:

```javascript
import { markAllRead } from '../store/notificationStore';
```

- [ ] **Step 2: Mark read inside `reload`**

The screen already calls `reload()` on focus via `useFocusEffect` (line 87). In the `reload` callback (starts line 73), after the `listFriends()/listPendingRequests()` results are applied, add a best-effort `markAllRead()`. The updated callback:

```javascript
const reload = useCallback(async () => {
  try {
    const [f, p] = await Promise.all([listFriends(), listPendingRequests()]);
    setFriends(f);
    setPending(p);
  } catch (e) {
    alert('Could not load friends', e?.message ?? 'Please try again.');
  } finally {
    setLoading(false);
  }
  // Opening the Friends screen is the user seeing their requests — clear the
  // notification badge. Best-effort: a failure just leaves the badge until
  // the next visit.
  markAllRead().catch(() => {});
}, []);
```

Preserve the existing `reload` body exactly — the `setFriends`/`setPending`/`setLoading`/`alert` calls and any variable names already in the file stay as they are. Only append the trailing `markAllRead().catch(() => {});` after the existing logic.

- [ ] **Step 3: Verify**

Run: `npx jest src/store`
Expected: PASS (no store regressions). Manually: open the Friends screen — the badge on the HomeScreen menu clears on next focus of Home.

- [ ] **Step 4: Commit**

```bash
git add src/screens/FriendsScreen.js
git commit -m "feat: clear notification badge when the Friends screen opens"
```

---

## Task 6: Push registration library

**Files:**
- Modify: `package.json` (via `expo install`)
- Create: `src/lib/pushNotifications.js`

- [ ] **Step 1: Install expo-notifications**

Run: `npx expo install expo-notifications`
Expected: `package.json` gains an `expo-notifications` entry at the Expo SDK 54-compatible version.

- [ ] **Step 2: Create the push library**

Create `src/lib/pushNotifications.js`:

```javascript
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

// Push notification plumbing. Registration is best-effort: a denied
// permission, a web browser, or a missing EAS project id all just mean no
// push — the in-app badge keeps working regardless.

// Foreground behaviour: still show the banner so the user sees the request
// without leaving their current screen.
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Ask permission, fetch this device's Expo push token, and store it. Safe to
// call on every app start — the upsert refreshes updated_at.
export async function registerPushToken() {
  try {
    if (Platform.OS === 'web') return; // Expo push tokens require a device
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    // getExpoPushTokenAsync needs the EAS project id. Read it defensively —
    // if the project has no EAS id yet, this throws and we no-op.
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await supabase.from('push_tokens').upsert(
      {
        user_id: user.id,
        token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );
  } catch {
    // best-effort — push is optional, the in-app badge is the guarantee
  }
}
```

- [ ] **Step 3: Verify it imports cleanly**

`expo-constants` ships with Expo SDK 54 by default; if `import Constants from 'expo-constants'` fails to resolve, run `npx expo install expo-constants`.
Run: `npx jest src/store`
Expected: PASS — the existing suite still loads (`pushNotifications.js` is not imported by tests).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/pushNotifications.js
git commit -m "feat: expo-notifications push token registration"
```

---

## Task 7: Wire push registration and tap-routing into App.js

**Files:**
- Modify: `App.js` — imports, navigation ref, registration effect, response listener.

- [ ] **Step 1: Add imports**

In `App.js`, the line `import { NavigationContainer } from '@react-navigation/native';` (line 3) becomes:

```javascript
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
```

Then add, near the other imports:

```javascript
import * as Notifications from 'expo-notifications';
import { registerPushToken, configureNotificationHandler } from './src/lib/pushNotifications';
```

- [ ] **Step 2: Create the navigation ref and configure the handler**

Below the `Stack`/`Tab` declarations (after line 65), add:

```javascript
const navigationRef = createNavigationContainerRef();

// Set the foreground notification handler once, at module load.
configureNotificationHandler();
```

- [ ] **Step 3: Register the token after login**

In `AppNavigator` (which already reads `session` from `useAuth`), add an effect after the `useAuth` call:

```javascript
useEffect(() => {
  if (session) registerPushToken();
}, [session]);
```

`useEffect` is already imported in `App.js` (line 1).

- [ ] **Step 4: Route notification taps to the Friends screen**

Add a second effect in `AppNavigator`:

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

- [ ] **Step 5: Attach the ref to NavigationContainer**

In the `App` component, change:

```jsx
<NavigationContainer linking={linking}>
```

to:

```jsx
<NavigationContainer linking={linking} ref={navigationRef}>
```

- [ ] **Step 6: Verify the app builds**

Run: `npx jest src/store`
Expected: PASS.
Then run `npm run web` and confirm the app loads with no red-box error. On web, `registerPushToken` returns early (no device token) — expected and correct.

- [ ] **Step 7: Commit**

```bash
git add App.js
git commit -m "feat: register push token on login, route notification taps to Friends"
```

---

## Task 8: send-push edge function

**Files:**
- Create: `supabase/functions/send-push/index.ts`

This is a Deno edge function — not exercised by the JS test suite. It is verified by review and by deployment.

- [ ] **Step 1: Write the edge function**

Create `supabase/functions/send-push/index.ts`:

```typescript
// send-push — invoked by a Supabase database webhook on every
// `notifications` INSERT. Looks up the recipient's Expo push tokens and
// delivers a push. Generic: a new notification type only needs a new entry
// in RENDERERS below.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type NotificationRow = {
  user_id: string;
  type: string;
  data: Record<string, unknown> | null;
};

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

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const note: NotificationRow | undefined = payload?.record;
    if (!note) return new Response('no record', { status: 400 });

    const render = RENDERERS[note.type];
    if (!render) return new Response('ignored type', { status: 200 });
    const { title, body } = render(note.data ?? {});

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', note.user_id);
    if (!tokens || tokens.length === 0) return new Response('no tokens', { status: 200 });

    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      title,
      body,
      sound: 'default',
      data: { screen: 'Friends' },
    }));

    const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await expoResp.json();

    // Prune tokens Expo reports as no longer registered.
    const receipts = Array.isArray(result?.data) ? result.data : [];
    const stale: string[] = [];
    receipts.forEach((r: { status?: string; details?: { error?: string } }, i: number) => {
      if (r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered') {
        stale.push(tokens[i].token);
      }
    });
    if (stale.length > 0) {
      await supabase.from('push_tokens').delete().in('token', stale);
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('send-push error', e);
    // Return 200 so the database webhook does not retry-storm on our errors.
    return new Response('error', { status: 200 });
  }
});
```

- [ ] **Step 2: Review against the spec**

Confirm the function matches the spec's "Database webhook → edge function" steps: token lookup, `type`-switched rendering, Expo POST, `DeviceNotRegistered` pruning, and a non-retrying error response.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-push/index.ts
git commit -m "feat: send-push edge function for Expo push delivery"
```

---

## Task 9: Deployment

These steps run against live infrastructure and are performed once, by the user or with their approval.

- [ ] **Step 1: Apply the migration**

Apply `supabase/migrations/20260518000001_notifications.sql` to the remote database (Supabase SQL editor, or `supabase db push`). Verify the `notifications` and `push_tokens` tables exist and the `friendships_notify` trigger is listed on the `friendships` table.

- [ ] **Step 2: Deploy the edge function**

Run: `supabase functions deploy send-push`
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase — no manual secrets needed.

- [ ] **Step 3: Create the database webhook**

In the Supabase dashboard → Database → Webhooks, create a webhook:
- Table: `notifications`
- Events: `INSERT`
- Type: Supabase Edge Function → `send-push`

- [ ] **Step 4: (Required for real push delivery) EAS + FCM setup**

`getExpoPushTokenAsync` needs an EAS project id, and Android delivery needs FCM credentials. If the project has no EAS project yet, run `eas init` and configure Android push credentials per Expo's docs. Until this is done, `registerPushToken` no-ops gracefully and **the in-app badge still works fully** — only the device-level push is inert.

- [ ] **Step 5: End-to-end verification**

With two accounts: send a friend request from A to B. Confirm (a) B's HomeScreen menu shows the badge, (b) the "Friends" menu row shows the count, (c) opening B's Friends screen clears the badge, and (d) after B accepts, A gets a `friend_accepted` badge. If EAS/FCM is configured, confirm the device push arrives and tapping it opens the Friends screen.

---

## Self-Review Notes

- **Spec coverage:** notifications table + RLS + `create_notification` (Task 1) · `push_tokens` (Task 1) · generic insertion point (Task 1) · friendships trigger (Task 1) · decline cleanup (Tasks 1 & 3) · webhook + edge function (Tasks 8 & 9) · push registration (Tasks 6 & 7) · notification store (Task 2) · in-app badge (Task 4) · markAllRead on Friends open (Task 5) · testing (Tasks 2 & 3) · deployment notes (Task 9). All spec sections map to a task.
- **Type consistency:** `create_notification(p_user_id, p_type, p_actor_id, p_entity_id, p_data)` and `delete_notification_for_entity(p_entity_id, p_type)` signatures are used identically in the SQL (Task 1), the `declineRequest` RPC call (Task 3), and the test (Task 3). The notification object shape (`id/type/actorId/entityId/data/readAt/createdAt`) is defined once in `rowToNotification` (Task 2) and asserted in its test. `data.screen = 'Friends'` is set by the edge function (Task 8) and read by the App.js response listener (Task 7).
- **No placeholders:** every code step contains complete, runnable content.
