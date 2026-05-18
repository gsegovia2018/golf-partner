# Game & Round Notifications — Design

**Date:** 2026-05-18
**Status:** Approved design, pending implementation plan

## Problem

The notification system (see
`docs/superpowers/specs/2026-05-18-friend-request-notifications-design.md`)
currently only covers friend requests. Two events that users care about
produce no notification:

- Being **added to a casual game** — the added friend has no idea.
- A friend **finishing a round** — friends would like to know, with a
  direct link to see it.

## Goal

- When a friend is added to a casual game, that friend is notified.
- When a user finishes a round (casual or official), all of that user's
  friends are notified, with a deep link to the round.
- Notifications are visible in-app through a notification inbox, and the
  badge becomes an honest unread count.

## Non-goals

- "Added to tournament" for **official** tournaments — official players
  self-join via magic-token invite links, so there is no "someone added
  your account" moment. Skipped by decision.
- Realtime in-app updates — the badge refreshes on screen focus and on
  foreground push, as in the existing notification feature.
- Notification preferences / per-type mute — out of scope.

## Decisions (from brainstorming)

- Scope: **casual + official**.
- "Round finished" recipients: **all of the finisher's friends** (a
  social broadcast), not just friends who played.
- Casual "finish a round" trigger: the **existing "Finish" button** in
  `ScorecardScreen` (`handleFinish`) — no new button, no new mutation.
- Official "added to tournament": **skipped**.
- A notification **inbox** screen is included.

## Architecture overview

Approach A — hybrid. A database trigger is used wherever a relational
signal exists; a client-invoked RPC is used for the one event whose data
lives only in the casual JSONB blob.

```
added to casual game
  -> tournament_participants INSERT
  -> trigger notify_participant_added
  -> create_notification(added user, 'added_to_game', creator, ...)

finish official round
  -> player attests card -> tournament_attestations INSERT
  -> trigger notify_attestation
  -> notify_friends(attesting user, 'round_finished', ...)

finish casual round
  -> existing "Finish" button (handleFinish in ScorecardScreen)
  -> RPC notify_round_finished(...)
  -> notify_friends(auth.uid(), 'round_finished', ...)

any notifications INSERT
  -> existing webhook -> send-push edge function -> Expo push
```

The `notifications` table and `create_notification` function from the
friend-request feature are reused unchanged — `type` is free text, so
the two new types (`added_to_game`, `round_finished`) need no schema
change.

## Server-side

All objects go in a single new migration.

### `notify_friends` helper

```
notify_friends(p_actor uuid, p_type text, p_data jsonb) RETURNS void
```

`SECURITY DEFINER`. One `INSERT … SELECT` that creates a notification
row for every **accepted friend** of `p_actor` — the friend is the other
side of each `friendships` row where `status = 'accepted'` and the actor
is requester or addressee. Shared by the casual RPC and the official
attestation trigger so the fan-out lives in one place. Inserts directly
into `notifications` (not via `create_notification`); a friend can never
equal the actor, so no self-check is needed.

### Trigger 1 — `added_to_game`

`AFTER INSERT` on `tournament_participants`. Joins to `tournaments` for
`kind`, `name`, `created_by`.

- Fires only when `kind = 'casual'`.
- Calls `create_notification(NEW.user_id, 'added_to_game',
  t.created_by, NULL, jsonb_build_object('tournament_id', NEW.tournament_id,
  'tournament_name', t.name))`.
- `create_notification` already no-ops when recipient = actor, so a
  creator who appears as their own participant is skipped.

`tournament_participants` rows are inserted by
`syncTournamentParticipants` (in `tournamentStore.js`) after a player
with a `user_id` is added to a casual tournament. The PK
`(tournament_id, user_id)` with `ON CONFLICT DO NOTHING` guarantees a
re-sync never re-inserts, so no duplicate notification.

### Trigger 2 — `round_finished` (official)

`AFTER INSERT` on `tournament_attestations`. A player attesting their
card is their personal "I finished this round."

- Resolves `NEW.roster_id` → `tournament_roster.user_id`.
- If `user_id IS NULL` (guest, no account) → do nothing.
- Otherwise looks up `tournament_rounds` (round_index, tournament_id,
  course) and `tournaments` (name), then calls
  `notify_friends(user_id, 'round_finished', <data>)` where `<data>` is
  `jsonb_build_object('tournament_id', tournament_id, 'round_id',
  NEW.round_id, 'round_index', round_index, 'tournament_name', name,
  'course_name', course->>'name', 'kind', 'official')`.

### RPC — `notify_round_finished` (casual)

```
notify_round_finished(
  p_tournament_id text, p_round_id text, p_round_index int,
  p_tournament_name text, p_course_name text
) RETURNS void
```

`SECURITY DEFINER`. Actor is `auth.uid()`.

- **Idempotency:** first checks whether a `round_finished` notification
  already exists with `actor_id = auth.uid()` and
  `data->>'round_id' = p_round_id`; if so, returns immediately. This
  replaces a persisted "finished" marker — the casual "Finish" button
  stores nothing, so re-taps must be de-duplicated here.
- Otherwise calls `notify_friends(auth.uid(), 'round_finished',
  jsonb_build_object('tournament_id', p_tournament_id, 'round_id',
  p_round_id, 'round_index', p_round_index, 'tournament_name',
  p_tournament_name, 'course_name', p_course_name, 'kind', 'casual'))`.

A caller can only ever notify as themselves and only their own friends,
so the RPC is safe to expose to authenticated clients.

## Client-side

### Casual "Finish" hook

`ScorecardScreen`'s existing `handleFinish()` (the "Finish" button shown
on the last hole; it already fires regardless of score completeness)
gains one call: after its existing logic, when the tournament `kind` is
**not** `official`, it calls the `notify_round_finished` RPC with the
round's `tournamentId`, `roundId`, `roundIndex`, tournament name, and
course name. Best-effort — a failure is swallowed (the round is still
finished locally; the notification is secondary). Official rounds notify
via Trigger 2, so the RPC is skipped for them.

### Notification rendering

A pure function `renderNotification(notification)` →
`{ title, body, icon }`, used by the inbox. It mirrors the edge
function's `RENDERERS`:

- `friend_request` → "New friend request" / "`<actor_name>` wants to be
  your golf partner"
- `friend_accepted` → "Friend request accepted" / "`<actor_name>`
  accepted your friend request"
- `added_to_game` → "Added to a game" / "You were added to
  `<tournament_name>`"
- `round_finished` → "Round finished" / "`<actor_name>` finished a round
  at `<course_name>`" (falls back to `<tournament_name>` when
  `course_name` is empty)

`friend_request` / `friend_accepted` data carries `actor_name`.
`round_finished` data does not carry a name, so `renderNotification`
takes the whole notification object and uses an `actorName` field that
the inbox resolves (see "Notification inbox" below); when absent it
falls back to "A friend".

### Deep-link mapping

A pure function `notificationLink(type, data)` → `{ screen, params }`:

- `friend_request` / `friend_accepted` → `{ screen: 'Friends' }`
- `added_to_game` → `{ screen: 'Home', params: { openTournamentId:
  data.tournament_id } }`
- `round_finished` → `{ screen: 'RoundSummary', params: { tournamentId:
  data.tournament_id, roundId: data.round_id } }`

Used by both the inbox (row tap) and `App.js` (push tap).

### Edge function `send-push`

Each `RENDERERS` entry returns a `deepLink` (`{ screen, params }`)
alongside `title`/`body`, computed with the same logic as
`notificationLink`. The push payload's `data` is set to that `deepLink`.
`friend_request` / `friend_accepted` keep `{ screen: 'Friends' }` —
unchanged behavior.

### `App.js` tap routing

The `addNotificationResponseReceivedListener` handler reads both
`data.screen` **and `data.params`**, and calls
`navigationRef.navigate(screen, params)`.

### `HomeScreen` — open a specific game

`HomeScreen` gains handling for an `openTournamentId` route param: on
mount / when the param changes, it auto-selects that tournament (the
screen already has `selectTournament(id)`).

### Notification inbox

A new `NotificationsScreen`:

- Lists notifications via the existing `listNotifications()`.
- For `round_finished` rows, resolves the actor's display name from
  `profiles` (by `actorId`) so `renderNotification` can show it; this is
  a single batched `profiles` lookup for the visible rows.
- Each row: an icon, the rendered title/body (`renderNotification`), and
  a relative timestamp. Unread rows are visually distinct (e.g. a dot or
  tint).
- Tapping a row navigates with `notificationLink(type, data)`.
- Calls `markAllRead()` when the screen opens — so the badge clears when
  the user actually sees the notifications.
- Registered as a `Notifications` route in `App.js`.
- Reached from a new "Notifications" item in the `HomeScreen` overflow
  menu, beside "Friends" and "Statistics".

### Move `markAllRead` off the Friends screen

`FriendsScreen` currently calls `markAllRead()` on open. That call is
**removed** — marking-all-read now belongs to `NotificationsScreen`.
Otherwise visiting Friends would silently clear round/game notifications
the user never saw.

## Error handling & edge cases

- **No friends** — `notify_friends` inserts zero rows; no error.
- **Re-finishing a casual round** — the RPC's idempotency check prevents
  a second fan-out.
- **Official re-attestation** — `attest_card` already prevents a player
  attesting the same round twice; the rare double-fire is accepted.
- **Null `created_by`** (legacy casual tournaments) — `added_to_game` is
  created with a null actor; the title still renders.
- **Deleted tournament/round** — tapping a stale notification lands on
  `Home` or `RoundSummary`, which already render an empty state when the
  target is gone — no crash.
- **Push** — best-effort and unchanged: a recipient with no push token
  still gets the in-app inbox entry and badge.
- **Known duplication** — notification text is rendered both in the Deno
  edge function and in the client `renderNotification`. Deno cannot
  import React Native code, so this duplication is unavoidable; both are
  small and kept in sync deliberately.

## Testing

- Unit tests for `renderNotification` (notification → title/body) and
  `notificationLink` (`type` + `data` → `{ screen, params }`) — both are
  pure functions, tested with `jest-expo` following the existing
  `src/store/__tests__/` and `src/lib/__tests__/` patterns.
- `notificationStore` (`listNotifications`, `unreadCount`, `markAllRead`)
  is already covered by existing tests.
- The two SQL triggers, the `notify_round_finished` RPC, the
  `notify_friends` helper, and the edge-function deep-link change are
  verified manually — the JS suite cannot exercise SQL or Deno.

## Files affected

New:
- `supabase/migrations/<timestamp>_game_round_notifications.sql` —
  `notify_friends`, the two triggers, `notify_round_finished`.
- `src/lib/notificationContent.js` — `renderNotification` and
  `notificationLink` pure functions.
- `src/lib/__tests__/notificationContent.test.js`
- `src/screens/NotificationsScreen.js` — the inbox.

Modified:
- `supabase/functions/send-push/index.ts` — `RENDERERS` returns
  `deepLink`; payload carries it.
- `App.js` — tap handler passes params; register `Notifications` route.
- `src/screens/ScorecardScreen.js` — `handleFinish` calls
  `notify_round_finished` for casual rounds.
- `src/screens/HomeScreen.js` — `openTournamentId` param handling; new
  "Notifications" menu item.
- `src/screens/FriendsScreen.js` — remove the `markAllRead()` call.

## Deployment notes

- Apply the new migration to the remote Supabase database.
- Re-deploy the `send-push` edge function.
- No new webhook or infrastructure — the existing `notifications`
  INSERT webhook already covers the new types.
