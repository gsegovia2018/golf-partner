# Sync v2: Normalized Schema — Design

**Date:** 2026-07-11
**Status:** Approved (user approved Parts 1 & 2 in-session)
**Supersedes:** the blob-merge sync architecture (`merge.js` LWW engine, `_meta` stamping, blob push), including two of today's tactical fixes (merge-before-push `saveTournament`, local-inclusive home list — see `docs/superpowers/plans/2026-07-11-sync-leaderboard-round-fixes.md`).

## Problem

The current sync layer stores each tournament as one JSON `data` blob in Supabase and relies on client-side merging (per-path LWW via `_meta` device timestamps + always-mine score cells) with whole-blob upserts. This architecture produced a recurring class of bugs:

- **Unstamped-write trap:** any field written outside `mutate()` (e.g. `currentRound` via raw `saveTournament`) carries no `_meta` stamp; the merge's tie-to-local rule pins every peer to its own stale value. This broke the leaderboard and home round label (fixed tactically 2026-07-11, but the trap remains for any future field).
- **No server-side concurrency control:** concurrent fetch→merge→push cycles race; last row-level upsert wins. A device that pushes once and goes offline can have its contribution clobbered.
- **Whole-blob writes:** every score tap eventually rewrites the entire tournament JSON.
- **Convergence is pull-lottery:** no realtime; peers converge only when a device happens to pull.
- **Clock-skew-sensitive LWW:** merge order depends on device clocks.

## Decision

Approach B — hybrid normalization ("hot data as rows, cold data as JSONB"), chosen over (A) op-log sync and (C) hardened blob. Rationale: the server row becomes the single truth per cell; the client merge engine is deleted rather than hardened; realtime is per-row and cheap; conflict resolution shrinks to arrival order + the existing conflict-marker UX; no op-replay/rebase machinery, no replay-determinism risk. Effort was explicitly excluded as a criterion by the user.

### Constraints (user-confirmed)

- **Clean cut-over:** the friends group updates to the new EAS build together; no old/new coexistence layer.
- **Preserve everything:** all historical tournaments AND the in-flight weekend tournament migrate losslessly.
- **Keep the conflict UX:** genuinely concurrent same-cell score edits surface to humans (marker + resolve), not silently merged.
- **Execution note:** implementation subagents run on Sonnet.

## Schema

```sql
-- tournaments (exists): add columns
ALTER TABLE tournaments
  ADD COLUMN settings jsonb,          -- scoringMode, fixedTeams, manualTeams, …
  ADD COLUMN current_round int,       -- first-class, no longer buried in the blob
  ADD COLUMN finished_at timestamptz;
-- `data` blob column is FROZEN as a legacy archive: never written again, kept for rollback.

CREATE TABLE tournament_players (
  tournament_id text REFERENCES tournaments,
  player_id     text,                 -- existing player.id values
  name          text,
  handicap      numeric,
  user_id       uuid,                 -- claims must propagate cross-device
  extras        jsonb,                -- gender, tee prefs, anything cold
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE rounds (
  id            text PRIMARY KEY,     -- existing round.id values
  tournament_id text REFERENCES tournaments,
  round_index   int,
  course        jsonb,                -- name, holes[] (par/SI/distance), tees — cold config
  scoring_mode  text,                 -- null = inherit tournament settings
  pairs         jsonb,
  revealed      boolean,
  settings      jsonb                 -- bestBallValue, worstBallValue, playerHandicaps, playerIndexes
);

CREATE TABLE scores (
  round_id   text REFERENCES rounds,
  player_id  text,
  hole       int,
  strokes    int,                     -- NULL = cleared (tombstone row so clears propagate)
  updated_at timestamptz DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (round_id, player_id, hole)
);

CREATE TABLE shot_details (
  round_id   text REFERENCES rounds,
  player_id  text,
  hole       int,
  detail     jsonb,                   -- putts / drive / penalties
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (round_id, player_id, hole)
);

CREATE TABLE round_notes (
  round_id   text REFERENCES rounds,
  hole_key   text,                    -- 'round' or the hole number as text
  body       text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (round_id, hole_key)
);
```

- Realtime is enabled on `scores`, `shot_details`, `rounds`, `tournaments`, `tournament_players`.
- `scoreConflicts` / `scoreResolutions` leave the server entirely — they become client-local UX state (server has one truth; conflicts are a display concern).
- `meId` remains device-local (AsyncStorage), unchanged.
- RLS mirrors the existing tournament access rules (owner / member / participant), applied per table.
- **Pre-work:** verify the live Supabase schema against repo migrations before writing DDL (known drift; Management API token in `.env`).

## RPCs

```sql
get_tournament(id) RETURNS jsonb
-- Joins all tables and returns JSON in EXACTLY today's blob shape
-- (rounds[].scores[pid][hole], players[], settings, currentRound, finishedAt …).
-- One round trip per cold load. The client-side domain code is unchanged.

set_score(round_id, player_id, hole, strokes, client_written_at) RETURNS jsonb
-- Atomic upsert; returns { previous_strokes, previous_updated_at }.
-- The client raises a conflict marker when it stomped a DIFFERENT concurrent value.

backfill_tournament(id) RETURNS void
-- Explodes a legacy `data` blob into rows. IDEMPOTENT (safe to re-run;
-- used both for the bulk migration and the weekend straggler sweep).
```

Structural writes (pairs, settings, course, roster, `current_round`, `finished_at`, notes) are plain column/row updates — granular enough that concurrent structural edits (rare, admin-ish) resolve by arrival order.

## Client architecture

### Read path
- `get_tournament` RPC returns the assembled object; `readLocal`/`saveLocal` keep working as the offline cache of that object.
- A thin client assembler applies **row-level patches** (from realtime events) onto the cached object without refetching.
- The home list becomes one query + cache; the local cache is only ever a cache, never a competing source of truth (deletes the dual-source flicker class).

### Write path
- `mutate.js` keeps typed mutations and optimistic local apply (offline-first UX unchanged).
- `syncQueue` keeps persisting pending mutations; the **drain changes**: each mutation executes as a targeted row write (`score.set` → `set_score` RPC; `pairs.set` → `rounds.pairs` update; round advance → `tournaments.current_round` update; …). Upserts are idempotent by PK — replay-safe.
- The ~8 raw `saveTournament` call sites (NextRound, Home, Setup, EditTournament, Players) are converted to proper mutations. The blob-push path is **deleted** — a write either maps to a mutation or it cannot sync at all (the `currentRound` bug class becomes unrepresentable).

### Liveness
- One Supabase Realtime channel per active tournament (`postgres_changes` filtered by tournament/round ids) → patch local object → existing `_emitChange` → subscribed screens update in ~1–2s.
- The 20s scorecard focus-poll (added 2026-07-11) stays as fallback for dropped websockets; full refetch on screen focus.

### Conflict policy
- Normal case: `set_score` returns an unsurprising previous value; nothing to report.
- Offline-drain overwrite of a different concurrent value: client raises the existing conflict-marker UI (both values, tap to resolve; a resolve is another `set_score`).
- Order is server arrival time — device clock skew is irrelevant.

### Deleted
- `merge.js` (LWW engine, `_meta` stamping, always-mine machinery, tombstone paths)
- Blob `persistRemote` / `pushRemote` and the fetch→merge→push drain in `syncWorker`
- `loadAllTournamentsWithFallback` dual-source complexity
- Today's Fix 2 (merge-before-push) and Fix 3 (local-inclusive list) — superseded bandages

### Survives
- `mutate.js` mutation types + optimistic apply; `syncQueue` offline persistence; conflict-marker UI; `meId` device-locality; all domain logic (`scoring.js`, `statsEngine.js`, tournament stores) and screens — they consume the identical tournament object shape.

## Migration

1. **SQL migration** creates tables + RPCs + RLS, then runs `backfill_tournament(id)` for every existing tournament (history + the live weekend one). Blobs stay frozen in `data` as a permanent archive → rollback path.
2. **Client refactor** merges → EAS build → the whole group installs.
3. **Straggler sweep:** if anyone scored on an old build after the backfill (writes landed in their blob), re-run `backfill_tournament(weekend-id)` to fold those in. Cut-over is lossless without perfect synchronization.
4. Official tournaments already keep an empty blob and use columns/RPCs — verify integration during planning; they should slot into the same read path.

## Testing

- **Round-trip proof:** real historical blobs → `backfill_tournament` → `get_tournament` → deep-equal the original (minus `_meta`, `scoreConflicts`, `scoreResolutions`, `meId`). This is the losslessness gate.
- **Two-device simulations** at the repository layer (mocked Supabase): concurrent cell writes, offline drain over a newer committed value → marker raised; realtime patch application.
- Existing ~1141 tests keep running against the assembled object shape; store tests that mocked blob-sync internals are retargeted to the repository interface.
- Runtime verification via the `verify` skill (Expo web, two browser contexts) before any build.

## Rollout & risk

- Server-first deploy is backward-compatible (old builds keep blob-writing, unaware) until the group updates.
- Biggest-change-yet caveat: multi-day effort, staged with review gates per plan task.
- Rollback: the frozen blobs + previous APK.

## Amendments (planning recon, 2026-07-11)

1. **Table names:** official mode already owns `tournament_rounds`, `tournament_scores`, `tournament_roster`. The new tables are named `game_players`, `game_rounds`, `game_scores`, `game_shot_details`, `game_round_notes`. Hot tables carry a denormalized `tournament_id` so realtime channels filter on one column.
2. **Losslessness by construction:** instead of enumerating cold columns, `game_rounds` stores the whole round object minus hot keys in a `body jsonb` catch-all (`body = round − {scores, shotDetails, notes}`); `game_players` likewise (`body` + extracted `user_id`, `pos` preserves array order); tournament-level leftovers (settings, `finishedAt`, misc) live in a `tournaments.props jsonb`. Unknown/future fields round-trip automatically. `current_round` stays a real column, advanced server-side with `GREATEST` (monotonic).
3. **RPC names:** `get_game_tournament`, `get_my_game_tournaments` (computes owner/member/participant role server-side, replacing the client's 3-query union), `set_game_score` (row-locked, returns previous value), `patch_game_round` / `patch_game_tournament` (one-level-deep jsonb merge), `advance_game_round`, `backfill_game_tournament`.
4. **`claim_tournament_player` dual-writes** during transition: keeps its existing blob `jsonb_set` (old builds) and also stamps `game_players.user_id` (new builds).
5. **Backfill vs straggler sweep:** the backfill uses the blob's `_meta` per-cell timestamps — a re-run only overwrites a `game_scores` row when the blob cell is genuinely newer, so sweeping after cut-over cannot clobber new-build writes.
6. **Round-trip normalization:** absent `scores`/`shotDetails` and empty `{}` compare equal; `_meta`, `scoreConflicts`, `scoreResolutions`, `meId` are excluded from equality. `get_game_tournament` always emits `scores: {}` / `shotDetails: {}`.
7. **Offline overlay replaces merge:** after any fetch, undrained queue mutations for that tournament re-apply on top via `applyPendingMutations(t, entries)` (reusing `applyToTournament`) — server truth + my pending ops, no LWW.
8. **`tournaments` table predates the migrations dir** (dashboard-created; known drift). A schema-facts task runs first and the DDL's FK/id types follow its findings.
