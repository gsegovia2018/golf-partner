# Friend Request Notifications — Design

**Date:** 2026-05-18
**Status:** Approved design, pending implementation plan

## Problem

When a user sends a friend request, the recipient has no way to know it
arrived. The accept/decline UI already exists (the "Incoming Requests"
section in `FriendsScreen`), but it is only discovered by opening the
Friends screen and pulling to refresh. The sender of a request likewise
has no signal when it is accepted.

## Goal

- The recipient of a new friend request gets a push notification and an
  in-app badge.
- The sender of a request gets a push notification and an in-app badge
  when it is accepted.
- The notification infrastructure is generic, so future notification
  types (tournament invites, feed comments, etc.) reuse it without
  schema or plumbing changes.

## Non-goals

- Realtime in-app updates (badge appearing instantly without a screen
  focus) — out of scope; the badge refreshes on screen focus and on
  foreground push delivery.
- A full notification center / history screen — out of scope. The badge
  count and the existing Friends screen cover this feature. The
  `notifications` table is built to support a history screen later.
- Notifications for declined requests.

## Architecture overview

```
sendRequest / acceptRequest  (existing client code, unchanged)
        |
        v
  friendships row insert/update
        |
        v
  AFTER trigger on friendships  --> public.create_notification(...)
        |
        v
  notifications row insert
        |
        +--> in-app badge (client reads unread count)
        |
        v
  Database Webhook on notifications INSERT
        |
        v
  Edge Function `send-push`
        |
        v
  Expo Push API --> recipient devices
```

The only friendship-specific server code is the trigger on the
`friendships` table. Everything downstream (the `notifications` table,
`create_notification`, the webhook, the edge function, `push_tokens`,
the client store and badge) is type-agnostic.

## Data model

Two new tables, added in a single migration.

### `notifications`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | recipient; FK `auth.users(id)` `ON DELETE CASCADE` |
| `type` | text NOT NULL | event string, e.g. `'friend_request'`. No narrow CHECK — new types need no migration. CHECK only that it is non-empty |
| `actor_id` | uuid NULL | who triggered it; FK `auth.users(id)` `ON DELETE SET NULL`. Null allowed for system notifications |
| `entity_id` | uuid NULL | the related record's id (a friendship id here, a tournament id later). No FK — polymorphic |
| `data` | jsonb NOT NULL DEFAULT `'{}'::jsonb` | type-specific payload, including `actor_name` so push text renders without extra lookups |
| `read_at` | timestamptz NULL | null = unread |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` | |

Index: `(user_id, read_at)` to support the unread-count badge query.

RLS:
- `SELECT`: `user_id = auth.uid()`
- `UPDATE`: `user_id = auth.uid()` (used only to set `read_at`)
- No client `INSERT` or `DELETE` policy — rows are written by
  `create_notification` (SECURITY DEFINER) and removed by server-side
  cleanup only.

### `push_tokens`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid NOT NULL | owner; FK `auth.users(id)` `ON DELETE CASCADE` |
| `token` | text NOT NULL | Expo push token |
| `platform` | text | `'android'` \| `'web'` \| `'ios'` |
| `updated_at` | timestamptz NOT NULL DEFAULT `now()` | refreshed on each app start |

Primary key: `(user_id, token)`.

RLS: owner can `SELECT`/`INSERT`/`UPDATE`/`DELETE` only their own rows
(`user_id = auth.uid()`). The edge function reads tokens with the
service-role key, so tokens are never exposed to other clients.

## Generic insertion point

`public.create_notification(p_user_id uuid, p_type text, p_actor_id
uuid, p_entity_id uuid, p_data jsonb)` — a `SECURITY DEFINER` function
that inserts one `notifications` row. The friendships trigger calls it;
every future feature calls the same function rather than inserting
directly. It is a no-op when `p_user_id = p_actor_id` (never notify
yourself).

## Server-side flow

### Trigger on `friendships`

The only friendship-specific server code.

- `AFTER INSERT` where `NEW.status = 'pending'`:
  `create_notification(NEW.addressee_id, 'friend_request',
  NEW.requester_id, NEW.id, jsonb_build_object('actor_name', <requester
  display_name>))`
- `AFTER UPDATE` where `OLD.status = 'pending'` and `NEW.status =
  'accepted'`: `create_notification(NEW.requester_id,
  'friend_accepted', NEW.addressee_id, NEW.id,
  jsonb_build_object('actor_name', <addressee display_name>))`

`actor_name` is looked up from `profiles` inside the trigger and baked
into `data`, so the edge function never queries for it.

### Decline cleanup

`declineRequest` deletes the pending friendship. Because
`notifications.entity_id` has no FK cascade, the decline path also
deletes the `friend_request` notification whose `entity_id` matches the
friendship id, keeping the recipient's badge honest. Implemented via a
`SECURITY DEFINER` `delete_notification_for_entity(entity_id, type)`
helper that `declineRequest` calls (the deleting user is the
notification owner, but there is no client DELETE policy, so the helper
performs the cleanup).

### Database webhook → edge function `send-push`

1. A Supabase database webhook fires on every `notifications` INSERT and
   POSTs the new row to the `send-push` edge function.
2. The edge function (Deno, service-role key) looks up `push_tokens`
   for `notification.user_id`.
3. It renders push title/body by switching on `type`:
   - `friend_request` → title "New friend request", body
     "`<actor_name>` wants to be your golf partner"
   - `friend_accepted` → title "Friend request accepted", body
     "`<actor_name>` accepted your friend request"
   - unknown `type` → skip push (the in-app notification row still
     exists).
4. It POSTs to the Expo Push API
   (`https://exp.host/--/api/v2/push/send`) with all the user's tokens
   and a deep-link payload `{ screen: 'Friends' }`.
5. On an Expo `DeviceNotRegistered` receipt error, it deletes the stale
   `push_tokens` row.

Adding a future notification type requires only a new render case in
step 3 plus a trigger/`create_notification` call at the source.

### Decoupling

The friendship write only fires the trigger, which only inserts a
`notifications` row — fast and transactional. The HTTP push happens
later in the webhook/edge function, so a slow or failing Expo call never
blocks or rolls back a friend request.

## Client

### Push registration

- Add the `expo-notifications` dependency.
- On app start *when a user is logged in*: request notification
  permission, get the Expo push token, and upsert it into `push_tokens`
  with `platform` and a fresh `updated_at`.
- Permission denied → no error surfaced; the in-app badge still works.
  Push is best-effort.
- Notification-response handler: tapping a push navigates to the
  `Friends` screen using the `{ screen: 'Friends' }` payload.
- Foreground handler: a push arriving while the app is open refreshes
  the badge count.

### Notification store

New `src/store/notificationStore.js`, mirroring existing store patterns
(`friendStore.js`):
- `unreadCount()` — count of `notifications` where `read_at IS NULL`.
- `listNotifications()` — recent notifications for the current user.
- `markAllRead()` — set `read_at = now()` on all unread rows.

### In-app badge

- A small red dot/count is shown on the hamburger menu icon in the
  `HomeScreen` header and on the "Friends" row inside the menu modal.
- The count refreshes on screen focus and on foreground push delivery.
- Opening the `Friends` screen calls `markAllRead()`, clearing the
  badge.

## Error handling & edge cases

- **No push token for the recipient** (never granted permission) → the
  edge function skips the push; the `notifications` row and in-app
  badge still work.
- **Expo API failure** → logged in the edge function; never affects the
  friendship write.
- **Auto-accept** — `sendRequest` auto-accepts when a reverse pending
  request already exists. The resulting `pending → accepted` update
  fires exactly one `friend_accepted` notification to the original
  requester. Acceptable.
- **Self-notification** — `create_notification` is a no-op when
  recipient equals actor.
- **Stale tokens** — pruned by the edge function on
  `DeviceNotRegistered` errors.

## Testing

- Unit tests for `notificationStore.js` with a mocked Supabase client,
  following the existing `src/store/__tests__/` pattern
  (`unreadCount`, `listNotifications`, `markAllRead`).
- The trigger, webhook, and edge function are verified manually — the
  JS test suite cannot exercise SQL or Deno.

## Files affected

New:
- `supabase/migrations/<timestamp>_notifications.sql` — both tables,
  RLS, `create_notification`, `delete_notification_for_entity`, the
  `friendships` trigger.
- `supabase/functions/send-push/index.ts` — the edge function.
- `src/store/notificationStore.js`
- `src/store/__tests__/notificationStore.test.js`

Modified:
- `package.json` — add `expo-notifications`.
- App startup (push registration) — `App.js` or a dedicated init module.
- `src/store/friendStore.js` — `declineRequest` notification cleanup.
- `src/screens/HomeScreen.js` — menu badge.
- `src/screens/FriendsScreen.js` — `markAllRead()` on open.

## Deployment notes

- The migration must be applied to the remote Supabase database.
- The `send-push` edge function must be deployed
  (`supabase functions deploy send-push`).
- The database webhook on `notifications` INSERT must be configured to
  call the edge function.
