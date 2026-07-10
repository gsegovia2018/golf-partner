# Notification Tap Navigation — "Added to a game" Deep Link Fix

**Date:** 2026-07-11
**Status:** Approved

## Problem

Tapping the "Added to a game" notification does nothing. Every notification
type already has a tap target defined in `notificationLink()`
(`src/lib/notificationContent.js`), and all of them work except
`added_to_game`:

- `friend_request` / `friend_accepted` → `Friends` (root stack) — works
- `round_finished` / `feed_reaction` / `feed_comment` → `RoundSummary`
  (root stack) — works
- `added_to_game` → `navigate('Home', { openTournamentId })` — **no-op**

`Home` is not a root-stack screen; it is nested inside the `Main` bottom-tab
navigator (`App.js`). React Navigation cannot resolve a nested screen by bare
name from a root-stack screen (the Notifications inbox) or from the push-tap
handler (`navigationRef.navigate(data.screen, data.params)` in `App.js`), so
the NAVIGATE action is dropped.

Everything downstream already works: `HomeScreen` has an effect on
`route.params?.openTournamentId` that selects the game and opens the
Tournament view. The param just never arrives.

## Fix

Use React Navigation's nested-navigator form for the `added_to_game` link,
in all three places that encode or decode it:

1. **`src/lib/notificationContent.js`** — `notificationLink('added_to_game')`
   returns
   `{ screen: 'Main', params: { screen: 'Home', params: { openTournamentId } } }`.
   Both consumers (inbox row tap, push tap) pass `(screen, params)` straight
   to `navigate`, so the nested form works through both paths unchanged.
2. **`supabase/functions/send-push/index.ts`** — the hand-mirrored
   `added_to_game` renderer emits the same nested deep link.
3. **`App.js` push listener** — normalize legacy payloads before navigating:
   a deep link with bare `screen: 'Home'` (sent by the old edge function, or
   delivered to a device before the edge function redeploy) is rewritten to
   the nested form. Implemented as a small exported helper
   (`normalizeDeepLink`) in `notificationContent.js` so it is unit-testable;
   the listener calls it on every push payload.

No change to notification rendering, the notifications table, triggers, or
`HomeScreen`.

## Behavior after the fix

Tapping "Added to a game" (inbox row or push) navigates to the Home tab with
`openTournamentId`, whose existing effect selects the game and pushes the
Tournament screen — the same place as tapping the game in the games list.
Unknown notification types keep their existing fallback (open the inbox).

Offline edge case: `selectTournament` loads the list remotely when online;
a tap while offline on a game that never synced locally leaves the user on
the games list. Accepted — a notification tap implies recent connectivity,
and the failure mode is benign.

## Testing

- Update `src/lib/__tests__/notificationContent.test.js`: `added_to_game`
  link asserts the nested `Main → Home` shape.
- New tests for `normalizeDeepLink`: legacy `{ screen: 'Home', params }`
  is rewritten to the nested form; already-nested and non-Home links pass
  through untouched.
- Manual verification via the Expo web app: tap the inbox row and confirm
  the game opens.

## Alternatives considered

- **Route to the root-stack `Tournament` screen directly** — avoids nesting
  but briefly renders the previously active game before the effect swaps it.
- **Push carries `type` + `data`; client computes the link** — removes the
  hand-mirrored routing in the Deno function, but is a push-contract change
  affecting old app versions; bigger than this bug needs.
