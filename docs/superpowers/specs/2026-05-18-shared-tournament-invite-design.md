# Shared Tournament Invite — Design Spec

**Date:** 2026-05-18
**Status:** Approved — ready for implementation planning
**Scope:** Casual tournaments only (not official tournaments)

## Problem

Today, casual tournaments require every participant to have an app account and
sign in — RLS is keyed on `auth.uid()`. There is no way to bring in a friend
who hasn't installed the app, or to let someone join by tapping a link. The
creator wants to:

- Add non-app-users (guests) to a casual tournament's player roster.
- Send one link/QR; recipients without the app land on the Vercel web build.
- Have recipients identify which player slot is theirs — except friends added
  from the friends list, who are matched automatically.

## Goals

- One shared invite link + QR per casual tournament.
- A no-account guest can play via the link (anonymous), with the option to log
  in instead.
- Recipients self-select their player slot; slots lock once claimed.
- Friends pre-bound to a slot skip the selection screen.
- The creator can release a wrongly claimed slot.

## Non-Goals

- Official tournaments are unchanged (they already have magic-token guest play).
- Native Universal Links / Android App Links domain verification — installed
  apps will open the link in the browser (web build), which is fully
  functional. Can be revisited later.
- Per-player invite links — a single shared link is used.
- Changing how casual scoring permissions work — claimers get full editor
  access, identical to today's `editor` invite role.

## Key Decisions

| Decision | Choice |
|---|---|
| Account-less access | Supabase **anonymous sign-in** (`signInAnonymously()`) |
| Invite shape | One shared link per tournament + QR; slots lock on claim |
| Permissions after claim | Full editor (same as today's editor invite) |
| Guest auth on join screen | Choose: *Log in* or *Continue without an account* |
| Friend auto-match | Slot whose `user_id == auth.uid()` is auto-claimed |

## Architecture

### Anonymous access (the core enabler)

"Continue without an account" calls `supabase.auth.signInAnonymously()`. The
guest receives a real but anonymous `auth.uid()`, so **all existing casual
machinery works unchanged** — RLS, `tournament_members` editor role,
`ClaimPlayerScreen`, score saving. A guest who later wants a real account links
an email to the anonymous user (Supabase-native), carrying over their claimed
slot and scores.

**Manual setup step:** Anonymous sign-ins must be enabled in the Supabase
dashboard (Auth → Providers). Not a code change.

### Player slots — claim, lock, release

A "player slot" is an entry in `tournaments.data.players`
(`{ id, name, handicap, user_id }`). The `user_id` field is the lock:

- `user_id == null` → open slot, shown in the picker.
- `user_id` set → claimed/locked, hidden from the picker.

**Claiming** — new `SECURITY DEFINER` RPC `claim_tournament_player(
tournament_id, player_id)`:

1. Verify the caller is already an `editor` member of the tournament (the
   `editor` `tournament_members` row was inserted when the invite code was
   redeemed — see Join flow). This is the authorization check.
2. Atomically set the player's `user_id` to the caller **only if it is still
   null** — prevents a double-claim race.
3. Return the claimed `player_id`.

If step 2 finds the slot already claimed, the RPC returns a "slot taken" error
and the UI refreshes the picker. The `editor` membership is *not* re-inserted
here — it is owned solely by the code-redeem step, so a caller never gets two
membership rows.

**Releasing** — new `SECURITY DEFINER` RPC `release_tournament_player(
tournament_id, player_id)`, restricted to the tournament owner/creator. Clears
the player's `user_id` and deletes the matching `tournament_members` row. Scores
already entered stay attached to the slot (keyed by `player.id`, not `user_id`).

### Friend auto-match (pre-binding)

No new data. When the creator builds the roster in `PlayerPickerScreen` and
picks a friend from their friends list, that slot already carries the friend's
`user_id`. On join, the app looks for a slot where `user_id == auth.uid()`; if
found, it adds the membership and skips the picker. A friend added as a typed
name (no `user_id`) sees the picker like anyone else.

### Routing and web

- New path route `join-tournament/:code` added to the `linking` config in
  `App.js`, alongside the existing official `join/:token`.
- The route must render before the auth gate — same pattern `JoinOfficial`
  already uses for unauthenticated official guests.
- Link format: `https://<vercel-domain>/join-tournament/<code>`.
- `vercel.json` (new) adds an SPA rewrite so path routes survive direct
  load/refresh:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
- "Redirect to Vercel" requires no redirect logic: the link is an ordinary web
  URL; a no-app user simply lands on the functional web build.

### Join flow

1. Recipient opens `https://<vercel-domain>/join-tournament/<code>`.
2. **`JoinTournamentLinkScreen`** (new, pre-auth) shows two buttons:
   - *Log in* → normal email/Google login.
   - *Continue without an account* → `signInAnonymously()`.
3. After auth, redeem the invite code → `tournament_members` editor row.
4. App checks for a slot where `user_id == auth.uid()`:
   - **Found** → auto-claim, skip the picker (friend case).
   - **Not found** → `ClaimPlayerScreen` shows only unclaimed slots; picking one
     calls `claim_tournament_player`.
5. Anonymous users see a gentle, dismissable "save your account" prompt.

## Components and Files

### New files

- `vercel.json` — SPA rewrite.
- `src/screens/JoinTournamentLinkScreen.js` — pre-auth *Log in / Continue
  without an account* screen.
- One SQL migration under `supabase/migrations/` — `claim_tournament_player`
  and `release_tournament_player` RPCs (`SECURITY DEFINER`).

### Modified files

- `App.js` — add `join-tournament/:code` to `linking`; make it reachable before
  the auth gate.
- `src/screens/JoinTournamentScreen.js` — accept `code` from the route param;
  after redeeming, detect a pre-bound slot → auto-claim, else go to the picker.
- `src/screens/ClaimPlayerScreen.js` — hide claimed slots; claim via the new RPC.
- `src/screens/MembersScreen.js` — per-slot "Release" action (owner only);
  repoint the share UI to the new link.
- `src/screens/HomeScreen.js` — repoint QR/share to `join-tournament/:code`.
- `src/store/tournamentStore.js` — `claimTournamentPlayer` /
  `releaseTournamentPlayer` wrappers; link/QR helper.
- Auth layer (`src/lib/oauth.js` / `src/screens/AuthScreen.js`) —
  `signInAnonymously()` helper; optional email-link upgrade for anonymous users.

## Error Handling

- **Double-claim race:** `claim_tournament_player` re-checks `user_id IS NULL`
  inside the RPC; the loser gets a "slot taken" error and the picker refreshes.
- **Invalid/expired/revoked code:** existing `tournament_invites` validation
  rejects with a clear message on the join screen.
- **Anonymous session lost** (cleared storage / new device): the slot stays
  locked to the old anonymous id. Resolution: the creator releases it, or the
  guest logs into a real account. The email-link upgrade prompt mitigates this.
- **Release by non-owner:** `release_tournament_player` enforces owner-only;
  rejects otherwise.

## Test Plan

Store-level tests (extend `src/store/__tests__/tournamentStore.test.js`):

- `claimTournamentPlayer` success path returns the claimed `player_id`.
- Double-claim returns a "slot taken" error.
- `releaseTournamentPlayer` clears `user_id` and reopens the slot.
- Pre-bound auto-match detection (slot `user_id == auth.uid()`).

Manual / E2E walkthrough:

1. Logged-out → *Continue without an account* → pick a slot → enter a score.
2. Friend logs in → auto-matched, no picker shown.
3. Two browsers race the same slot → exactly one succeeds.
4. Creator releases a slot → it reappears in the picker with scores intact.

## Open Risks

- Anonymous accounts accumulate in `auth.users`; acceptable at this app's
  scale, but worth a periodic cleanup if usage grows.
- Trust-based model: anyone with the shared link can claim any open slot.
  Acceptable for a 4-friend golf group; slot locking + creator release are the
  guardrails.
