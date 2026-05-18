# Scoped Player Library — Design

**Date:** 2026-05-18
**Status:** Approved

## Problem

The add-player picker (`PlayerPickerScreen`) and the manage screen
(`PlayersLibraryScreen`) both call `fetchPlayers()`, which returns **every
player row in the database** — no scoping. The picker is therefore cluttered
with two kinds of irrelevant rows:

1. Players that *other app users* created for their own games.
2. Legacy players from before accounts existed.

When adding a player, the user should only see:

- **Friends** — app users they have an accepted friendship with.
- **Guest players they created** — players with no app account, used purely
  to track a score.

## Goals

- The add-player picker shows only friends + guest players the current user
  created (plus the current user themselves).
- The Players Library (manage) screen shows only the current user's own guest
  players. Friends are managed through the Friends screen, not here.
- Historical scorecards keep resolving any player by id — no regression in
  `ScorecardScreen` / `SetupScreen`.

## Non-Goals

- Tightening Row Level Security on the `players` table. RLS stays open for
  reads because `ScorecardScreen` and `SetupScreen` must resolve arbitrary
  player ids to render existing games. Scoping is enforced at the application
  layer. This is acceptable for a small (4-friend) app.
- Changing how friends' name/handicap are edited (they sync from the friend's
  own profile via the existing `sync_player_from_profile` trigger).

## Approach

Application-level filtering backed by a new ownership column.

Alternatives considered and rejected:

- **RLS-enforced scoping** — would require a recursive "player appears in a
  tournament I can see" policy so lookup callers still work. Too heavy here.
- **Derive ownership at read time from tournament history** — fragile, no
  durable record of who created a player.

## 1. Schema migration

New migration: `supabase/migrations/20260518000000_players_created_by.sql`.
Idempotent — safe to re-run.

- Add the ownership column:

  ```sql
  ALTER TABLE public.players
    ADD COLUMN IF NOT EXISTS created_by uuid
      REFERENCES auth.users(id) ON DELETE SET NULL
      DEFAULT auth.uid();
  ```

  `DEFAULT auth.uid()` auto-stamps the creator on every new INSERT, so no
  app-side code is needed to set it. Upserts of an existing player send only
  `name`/`handicap`, so `created_by` is never overwritten on update.

- **Backfill from tournament history.** Attribute each player to the owner
  (`tournaments.created_by`) of the *earliest* tournament they appear in
  (`data->'players'` JSON array). Only fills rows where `created_by IS NULL`:

  ```sql
  UPDATE public.players p
     SET created_by = sub.owner
    FROM (
      SELECT DISTINCT ON ((pl->>'id'))
             (pl->>'id') AS player_id,
             t.created_by AS owner
        FROM public.tournaments t,
             LATERAL jsonb_array_elements(
               COALESCE(t.data->'players', '[]'::jsonb)) pl
       WHERE t.created_by IS NOT NULL
       ORDER BY (pl->>'id'), t.created_at
    ) sub
   WHERE p.id::text = sub.player_id
     AND p.created_by IS NULL;
  ```

- **App users own their own row:**

  ```sql
  UPDATE public.players
     SET created_by = user_id
   WHERE created_by IS NULL
     AND user_id IS NOT NULL;
  ```

- Truly orphaned rows (never in any owned tournament, no `user_id`) keep
  `created_by = NULL` and simply stop appearing in any picker.

## 2. Store layer (`src/store/libraryStore.js`)

`fetchPlayers()` is **unchanged** — `ScorecardScreen` and `SetupScreen` keep
using it to look up players by id.

Two new scoped functions:

### `fetchMyPlayers()` — for the add-player picker

- Resolves the current user id via `supabase.auth.getUser()`.
- Resolves accepted-friend user ids via `friendStore.listFriends()`, falling
  back to `friendStore.getCachedFriends()` when the network read fails.
- Returns players where `created_by = me` **OR**
  `user_id IN (me + friendIds)`, ordered by name. Same column selection as
  `fetchPlayers()` plus `created_by`.
- Signed-out: returns `[]` (the app is unusable signed out anyway).

### `fetchMyGuestPlayers()` — for the Players Library screen

- Returns players where `created_by = me AND user_id IS NULL` — only the
  current user's own guest players. Excludes friends and the user's own
  app-linked row (handicap is edited via Profile, not here).
- Signed-out: returns `[]`.

`libraryStore` importing `friendStore` introduces no cycle (`friendStore`
does not import `libraryStore`).

## 3. Screens

- `PlayerPickerScreen`: `fetchPlayers()` → `fetchMyPlayers()`.
- `PlayersLibraryScreen`: `fetchPlayers()` → `fetchMyGuestPlayers()`.
- Player creation flow is unchanged — the column default stamps `created_by`.
- Existing empty-state and error-state UI is reused unchanged.

## 4. Testing

Unit tests (`src/store/__tests__`) with a mocked Supabase client:

- `fetchMyPlayers()`:
  - includes friends, the current user, and own guest players;
  - excludes strangers' players and orphaned legacy rows;
  - falls back to cached friends when the friends read fails;
  - returns `[]` when signed out.
- `fetchMyGuestPlayers()`:
  - returns only `created_by = me AND user_id IS NULL` rows;
  - excludes friends and the user's own app-linked row;
  - returns `[]` when signed out.

Migration backfill correctness is verified by the `DISTINCT ON` earliest-
tournament rule and the `WHERE created_by IS NULL` guard (re-run safe).
