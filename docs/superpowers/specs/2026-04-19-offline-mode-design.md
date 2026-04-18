# Offline Mode — Design Spec

**Date:** 2026-04-19
**Status:** Approved for implementation planning

## Goal

Make the app usable without internet for the cases that matter during a round in the field, and silently reconcile the local edits with Supabase once connectivity returns. No user-facing errors on network loss; no destructive "last write wins the whole blob" behavior.

## Scope (v1)

Offline-editable:

- Score entry in the current round (strokes per player per hole).
- Round notes.
- Pair changes within an existing round.
- Per-tournament player handicap edits.
- Adding a new player to the library and into the current tournament.

Out of scope in v1:

- Creating a new round, a new course, or a new tournament offline.
- Deleting players, rounds, courses, or tournaments offline.
- Service worker / PWA manifest on web (first-load without network still fails).
- Supabase Realtime (live peer-to-peer updates without pull-to-refresh).
- Schema normalization of the current tournament JSONB blob.
- Per-field UI indicator of pending edits (only a global indicator in v1).

## Architectural Shape

Local-first with a mutation queue and a field-level LWW merge on sync.

```
UI edit
  │
  ▼
in-memory tournament state (mutated in place + _meta[path]=ts)
  │
  ▼
AsyncStorage (always succeeds; source of truth for the UI)
  │
  ▼
syncQueue (persisted, append-only)
  │  drained when online
  ▼
syncWorker ──► Supabase (fetch remote, LWW merge, upsert)
```

### Assumptions

- Supabase `tournaments.data` is a JSONB blob; we can extend it with a `_meta` subobject without a schema migration.
- `Date.now()` is acceptable as a merge clock. Modern phones sync via NTP; the failure mode of a skewed clock is a single field reverting to the "wrong" value, which the user can reedit.
- A Supabase row already exists for any tournament being edited offline (v1 scope excludes creating tournaments offline).

## New Modules

| File | Responsibility |
|---|---|
| `src/lib/connectivity.js` | Online/offline detector. `NetInfo` on React Native, `navigator.onLine` + periodic HEAD heartbeat on web. Exposes `isOnline()` and `subscribe(fn)`. |
| `src/store/syncQueue.js` | Persisted FIFO queue of pending mutations. Backed by AsyncStorage key `@golf_sync_queue`. API: `enqueue(mutation)`, `peek()`, `drop(id)`, `all()`. |
| `src/store/syncWorker.js` | Drains the queue. Runs on: connectivity regain, `mutate()` call (if online), app foreground, manual retry tap. Exponential backoff (1s → 60s cap). Coalesces queue entries per `(tournamentId)` so one sync pass covers all pending mutations for a tournament. |
| `src/store/merge.js` | Pure function `mergeTournaments(local, remote) → merged`. LWW per path using `_meta`. Tested in isolation. |
| `src/store/mutate.js` | Single entry point for every mutation type (see "Mutation Types" below). Updates in-memory state, bumps `_meta`, persists to AsyncStorage, emits change, enqueues. |

## Changes to Existing Modules

### `src/store/tournamentStore.js`

- `saveTournament(t)` splits into:
  - `saveLocal(t)` — AsyncStorage write, never throws on network reasons.
  - `schedulePush(tournamentId)` — delegates to `syncWorker`.
- `persistTournament` no longer throws to the UI. Errors go to the sync worker's backoff state.
- New observable: `syncStatus` with values `idle | syncing | pending | error`, exposed as a sibling `subscribeSyncStatus(fn)` alongside the existing `subscribeTournamentChanges`.
- Load order on app start: AsyncStorage first (render instantly), then background pull-and-merge if online.

### `src/screens/ScorecardScreen.js`

- `setScore` calls `mutate({ type: 'score.set', ... })` instead of `setScores(...) + autoSave(...)`.
- 300 ms debounce moves out of the screen and into `mutate()` per `(roundId, playerId, hole)` key so rapid keystrokes produce a single queue entry.

### `src/store/libraryStore.js`

- `upsertPlayer(p)` accepts a client-supplied UUID and routes through `mutate({ type: 'player.upsertLibrary', ... })`.

### Navigation / header

- A small sync-status icon is mounted in the global header (the same place the tournament title lives today). Tapping `error` triggers an immediate retry.

## Mutation Types

Each mutation is a plain object with a stable `id` (UUID), `ts` (`Date.now()`), and a payload. Mutation type determines which `_meta` path is bumped and which field in the tournament blob is updated.

| type | payload | `_meta` path | Notes |
|---|---|---|---|
| `score.set` | `{ roundId, playerId, hole, value }` | `rounds[roundId].scores[playerId][hole]` | `value=null` means "cleared" |
| `note.set` | `{ roundId, scope: 'round'\|'hole', hole?, text }` | `rounds[roundId].notes[scope,hole]` | Hole-scoped notes keyed by hole number |
| `pairs.set` | `{ roundId, pairs }` | `rounds[roundId].pairs` | Whole pairs structure is one LWW unit |
| `handicap.set` | `{ playerId, handicap }` | `playerHandicaps[playerId]` | Per-tournament, not per-player-library |
| `player.upsertLibrary` | `{ playerId: <uuid>, name, handicap?, ... }` | n/a (library, not tournament) | Writes to the `players` table via its own sync path |
| `tournament.addPlayer` | `{ playerId }` | `players[playerId]` | Adds an existing library player to the active tournament |

Adding a brand-new player to the tournament offline produces two mutations atomically: `player.upsertLibrary` + `tournament.addPlayer`. The queue records both; the sync worker pushes the library write first.

## `_meta` Structure

`_meta` is a sibling key inside the tournament object:

```js
tournament._meta = {
  "rounds.r1.scores.p7.h5":   1713523812345,
  "rounds.r1.notes.hole.5":   1713523901000,
  "rounds.r1.pairs":          1713523720000,
  "playerHandicaps.p7":       1713520000000,
  "players.p7":               1713519000000,
};
```

- Keys are dot-encoded paths into the tournament object (the "logical path" column in the mutation table, rendered as dot-separated segments). Values are epoch millis.
- Every `mutate()` writes the field and updates its `_meta` key in the same transaction.
- `_meta` travels inside the JSONB blob; no Supabase schema migration.

## Merge Algorithm

```
mergeTournaments(local, remote):
  if !remote: return local
  if !local:  return remote

  merged = deepClone(remote)
  mergedMeta = { ...remote._meta }

  for path in union(keys(local._meta), keys(remote._meta)):
    lTs = local._meta[path] ?? 0
    rTs = remote._meta[path] ?? 0
    if lTs >= rTs:                       // tie → local wins
      setAtPath(merged, path, getAtPath(local, path))
      mergedMeta[path] = lTs

  merged._meta = mergedMeta
  return merged
```

Properties:

- Commutative and idempotent per path (classic LWW register).
- Handles fields present on only one side (the side's `_meta` entry exists, the other's is `0`).
- Tie resolution favors local because the local side has an in-flight mutation not yet pushed.

## Sync Worker Lifecycle

Events that trigger a drain:

1. Connectivity regain (from `connectivity.js` subscription).
2. App foreground (`AppState` change to `active`).
3. A new mutation enqueued while online.
4. User tapping the `error` sync indicator.

Drain flow per tournament:

```
1. Pull remote blob for tournamentId (SELECT from tournaments).
2. merged = mergeTournaments(localBlob, remoteBlob)
3. Write merged to AsyncStorage + upsert to Supabase.
4. On success: drop all queue entries whose (tournamentId, path) is reflected in merged._meta with ts >= entry.ts.
5. On failure: bump backoff, keep queue intact, set syncStatus=error.
```

Library writes (`player.upsertLibrary`) drain independently against the `players` table and do not pass through `mergeTournaments`.

Backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s cap. Reset on connectivity regain or successful push.

## UX

Sync-status icon states:

| State | Shown when |
|---|---|
| `idle` | Queue empty, last push succeeded |
| `syncing` | Drain in progress |
| `pending` | Queue non-empty and offline |
| `error` | Last drain failed; tappable for immediate retry |

No modal, no toast, no blocking UI on network failure. A one-line explanation is shown only when the user taps the icon in `error` state.

## Data & Edge Cases

- **Legacy tournaments without `_meta`.** Treated as if every field has `ts = 0`; any local edit wins on first merge. After one merge, `_meta` is populated.
- **Clock skew.** Accepted risk. Degrades to a losing field on a single merge, never to data loss elsewhere.
- **Tournament deleted remotely while we have local edits.** v1: the local edits are discarded on next merge (remote wins because deletion is not modeled as a mutation here). The scope excludes offline deletes, so this only happens if a remote user deletes — acceptable.
- **Two offline devices adding the same new player.** Different client-generated UUIDs → two library rows. Deduplication is a user-visible concern and not handled in v1.
- **Same-hole score edited on two devices.** LWW by `ts`. The loser can reedit.

## Testing Strategy

- Unit tests on `merge.js` covering: disjoint paths, same path different ts, same path tie, missing `_meta` on either side, legacy blob without `_meta`.
- Unit tests on `syncQueue.js` covering persistence round-trip and FIFO order.
- Integration test on `syncWorker.js` with a mocked Supabase client simulating: offline push, online push, transient failure with retry, remote-newer merge, local-newer merge.
- Manual test matrix: kill WiFi mid-round, score several holes, reconnect; same matrix while a second device is also editing.

## Rollout

- Single branch, single PR.
- Feature is on by default — the local-first path replaces the current error-throwing path. There is no way to opt out in v1.
- Existing production tournaments without `_meta` continue working (see "Legacy" above).
