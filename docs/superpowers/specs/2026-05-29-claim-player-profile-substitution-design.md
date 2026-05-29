# Claim Player Profile Substitution — Design Spec

**Date:** 2026-05-29
**Status:** Approved for implementation planning
**Scope:** Casual shared-invite tournaments only

## Problem

When an organiser creates a casual tournament with an unlinked typed player
slot, for example `Noel`, and shares an editor invite link, a signed-in user
can claim that slot through `ClaimPlayerScreen`. The existing claim flow only
stamps `players[i].user_id`. The tournament then knows the slot belongs to the
logged-in account, but UI still displays the organiser's placeholder name.

Desired behavior: if account `Noe` claims the typed `Noel` slot, the roster and
round views should show `Noe` as the player while preserving the original
player slot identity and scores.

## Goals

- Substitute the claimed slot's display identity with the logged-in account's
  profile identity.
- Preserve all scores, shot details, notes, conflicts, pair assignments, and
  player id references.
- Keep the organiser-entered handicap and per-round playing handicaps
  unchanged. The player can edit handicaps later through existing controls.
- Keep the claim race-safe and merge-safe.
- Make the behavior work for already-generated `round.pairs` snapshots, not
  only the canonical `players` array.

## Non-Goals

- Recalculate handicaps on claim.
- Move scores to a different `player.id`.
- Create per-player invite links.
- Change official tournament invite behavior.
- Add UI for resolving a wrong name beyond the existing release/edit controls.

## Data Model

Casual tournament score data is keyed by `player.id`, not `user_id` or player
name. Claiming a slot must therefore keep `player.id` stable. The change is a
display/account substitution on the existing slot:

- `user_id`: set to `auth.uid()`.
- `name`: set from the caller's profile, preferring `display_name`, then
  `username`, then the current slot name.
- `avatar_url`: set from the caller's profile when available.
- `handicap`: unchanged.

All existing score maps (`round.scores[player.id]`,
`round.shotDetails[player.id]`, `round.scoreConflicts[player.id]`) remain
untouched, so scores stay assigned to the claimed player.

## Architecture

Update the server-side `claim_tournament_player(text, text)` RPC, which already
owns the race-safe claim boundary:

1. Validate the caller is signed in and can edit the tournament.
2. Lock the tournament row with `SELECT ... FOR UPDATE`.
3. Find the target player slot by `player.id`.
4. Reject the claim with `SLOT_TAKEN` if the slot is claimed by another user.
5. Read the caller's profile from `public.profiles`.
6. Build a claimed player object by merging profile identity fields into the
   existing slot while preserving handicap and id.
7. Write the merged player back to `data.players[index]`.
8. Walk `data.rounds[*].pairs[*][*]` and replace any embedded player snapshot
   with the same `id` using the same identity fields, preserving handicap and
   all other pair-player fields.
9. Bump `data._meta.players` so the claim wins the next client merge.

The client wrapper `claimTournamentPlayer()` can keep the same API. After the
RPC succeeds, `ClaimPlayerScreen` still refreshes the tournament and applies
local `tournament.setMe`; the refreshed blob now carries the substituted
identity.

## Error Handling

- **Slot already claimed by another user:** RPC raises `SLOT_TAKEN`; existing
  UI refreshes and asks the user to pick another slot.
- **Missing profile or blank profile name:** keep the current slot name while
  still stamping `user_id`; this avoids replacing a useful organiser-entered
  name with an empty label.
- **Offline claim:** unchanged. Slot claims require the server RPC.
- **Sync race:** `_meta.players` is bumped inside the locked RPC transaction.

## Testing

Add a pure helper for the JSON transformation and cover it with Jest before
touching production behavior:

- Replaces `players[]` slot name, `user_id`, and `avatar_url` from profile.
- Preserves `id`, handicap, scores, shot details, conflicts, and other unrelated
  round data.
- Updates matching players inside all `round.pairs` snapshots.
- Keeps the organiser-entered name when the profile has no displayable name.
- Does not alter other players.

Migration verification:

- Claim an unlinked `Noel` slot as account `Noe`.
- Confirm the roster, scorecard, and stats show `Noe`.
- Confirm any existing scores under the claimed `player.id` remain visible for
  `Noe`.
- Confirm the slot handicap remains the organiser-entered value.
