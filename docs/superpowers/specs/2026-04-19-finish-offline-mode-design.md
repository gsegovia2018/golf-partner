# Finish Offline Mode — Design Spec

**Date:** 2026-04-19
**Status:** Approved
**Predecessor:** `docs/superpowers/specs/2026-04-19-offline-mode-design.md` (v1 offline mode, already implemented as tasks 1–13 of `docs/superpowers/plans/2026-04-19-offline-mode.md`)

## Goal

Close the two gaps left by v1 of offline mode:

1. **Home offline** — the Home screen currently calls Supabase directly to list the user's tournaments, so it fails without network even when the user has cached tournaments available.
2. **Sync & conflict UX** — the LWW merge silently overwrites local writes when remote has a newer timestamp for the same field, and the `SyncStatusIcon` only exposes a tap-to-retry on error (no way to see what is pending, what failed, or what was overwritten).

Out of scope for this spec:

- Executing the existing Task 14 end-to-end verification matrix (tracked separately as a checklist).
- Opening tournaments whose full blob is not yet cached (remains a v1 limitation).
- Manual conflict resolution — we keep LWW as the merge policy; we only surface what it did.
- Discarding pending writes from the queue (too risky for silent data loss).

## Non-goals

- No new merge policy. LWW by `_meta` timestamp stays.
- No new persistence engine. AsyncStorage remains the only client store.
- No background sync on app backgrounded/killed state beyond what v1 already does.

---

## A) Home offline — tournaments index

### Behavior

- When `loadAllTournaments()` succeeds against Supabase, we write a light index `[{id, name, createdAt, role, updatedAt}]` to AsyncStorage under `@golf_tournaments_index`.
- When `loadAllTournaments()` fails (network error, timeout), Home falls back to the cached index and renders it, tagging the result as stale.
- Tournaments whose `id` has no corresponding `@golf_tournament_<id>` blob (i.e. never opened) render as **non-openable** offline: greyed-out card with an offline icon and a helper line *"Requiere conexión"*. Tap is a no-op (or a subtle shake / toast) while offline.
- When connectivity returns, the index refreshes on next Home focus and the stale banner disappears.

### UI

- Stale banner: a single thin strip at the top of Home, non-dismissable while offline, copy *"Sin conexión · mostrando última lista guardada"*. Styled like existing informational strips in the app (no red, no modal).
- Non-openable tournament card: same layout as a normal card, opacity ~0.5, an `offline` / `cloud-off` icon in the top-right of the card, tap disabled.

### Data shape

`@golf_tournaments_index` → `Array<{ id: string, name: string, createdAt: string, role: 'owner'|'editor'|'viewer', updatedAt: string }>`

`updatedAt` is the max of `data.updatedAt` or `createdAt` from the remote row, so the index can sort stable-newest-first without reading each blob.

### Module layout

- **New:** `src/store/tournamentsIndex.js` — `readIndex()`, `writeIndex(list)`, `getLocalBlobIds()` (list of ids that have a full blob cached, computed by scanning AsyncStorage keys prefixed with `@golf_tournament_`).
- **Modify:** `src/store/tournamentStore.js` — `loadAllTournaments()` writes the index on success; a new `loadAllTournamentsWithFallback()` wrapper tries remote, falls back to index with `_stale: true`.
- **Modify:** `src/screens/HomeScreen.js` — consume the `_stale` flag, render the banner, mark non-openable cards.

### Edge cases

- First-ever launch offline with no index and no cached blobs → Home renders empty state with *"Sin conexión · aún no hay torneos guardados"*.
- Index written while online for tournament X; later that tournament is deleted server-side and the user reconnects → the next `loadAllTournaments()` overwrites the index with the fresh list; stale entries disappear automatically.
- Index out of sync with blob cache (blob removed manually, or tournament never opened) → `getLocalBlobIds()` is the source of truth for "is this openable now".

---

## C) Sync & conflict UX

### Behavior overview

- LWW merge in `merge.js` emits a structured list of *same-cell conflicts* whenever both local and remote have a `_meta` timestamp for the same leaf path. Fields touched only on one side do not count as conflicts.
- The `syncWorker` persists those conflicts into a bounded log in AsyncStorage and notifies subscribers.
- The `SyncStatusIcon` grows a subtle numeric badge (ámbar) with the count of **unread** conflicts, and briefly pulses on the transition from 0 → n unread.
- Tapping the icon opens a bottom sheet (`SyncStatusSheet`) with two sections: status and overwritten-changes. Opening the sheet marks conflicts as read; badge disappears.
- No toast, no modal, no alert. The pulse + badge is the entire interrupt surface.

### Conflict detection (merge.js)

Return shape changes from `merged` to `{ merged, conflicts }`. A conflict entry is emitted when:

- The path is a leaf (not a container), and
- Both `local._meta[path]` and `remote._meta[path]` exist, and
- They differ (`localTs !== remoteTs`), and
- `remote` wins (i.e. we overwrote a local value the user cared about).

If local wins, we do **not** emit a conflict — from the user's perspective nothing of theirs was lost. The opposite device will see it as remote-winning when it syncs, and the conflict will be logged there.

Conflict entry shape:

```js
{
  path: 'rounds[1].scores[4].strokes',   // dotted path into the blob
  localTs: 1734567890123,
  remoteTs: 1734567990456,
  winnerValue: 5,                        // the value that survived (remote's)
  losingValue: 4,                        // the local value that was overwritten
  tournamentId: 'abc-123',
  detectedAt: 1734568000000,             // when the merge ran
}
```

### Persistence (syncWorker)

- New storage key: `@golf_conflict_log` → `Array<ConflictEntry>` capped at **20** entries, FIFO (oldest dropped on overflow).
- On each successful push, append new conflicts and emit to subscribers.
- `unreadCount` stored separately as `@golf_conflict_unread` (integer). Incremented on each new conflict, reset to 0 by `markConflictsRead()`.

### Store API (tournamentStore.js additions)

```js
export function getConflicts();            // returns the current log (array)
export function getConflictUnreadCount();  // returns integer
export function subscribeConflicts(fn);    // fn({ log, unread }) on any change
export function markConflictsRead();       // zeroes unread, emits
```

### Icon (SyncStatusIcon.js)

- Subscribes to both `subscribeSyncStatus` and `subscribeConflicts`.
- If `unread > 0`, renders a small ámbar circular badge with the count (max `"9+"`) over the top-right of the dot/spinner.
- On the 0 → n transition, runs a single-shot pulse animation (opacity 1 → 0.6 → 1 + scale 1 → 1.15 → 1, 800ms total, React Native `Animated` API).
- On tap, opens `SyncStatusSheet` regardless of current status.
- Existing retry-on-error behavior stays, but now lives inside the sheet's *Reintentar* button (the icon itself no longer has a direct retry tap).

### Sheet (SyncStatusSheet.js, new)

Follows the pattern of `StatDetailSheet.js` / `AttachMediaSheet.js`.

Sections:

1. **Estado**
   - Current sync state (idle/syncing/pending/error) with matching color dot.
   - `Pendientes: N` (from `syncQueue.length`).
   - `Último sync: hace X min` (from a new `lastSyncAt` timestamp written by `syncWorker` on each successful drain).
   - If error: last error message in muted tone.
   - Button *Reintentar* (visible when state is `error` or `pending`).

2. **Cambios sobrescritos**
   - Empty state: *"Sin cambios sobrescritos recientes"*.
   - Otherwise a list, newest first, of up to 20 entries:
     - Primary line: human label from `conflictLabels.pathToLabel(entry)` — e.g. *"Ronda 2 · Hoyo 5 · Carlos"*.
     - Secondary line: *"hace 3 min · quedó en 5 (antes 4)"*.
   - No per-entry actions. This is informational only.

Opening the sheet calls `markConflictsRead()` immediately (debounced to once per open).

### Labels (conflictLabels.js, new)

`pathToLabel(entry, blob)` maps known path patterns to human strings. The post-merge `blob` is passed as context so player/round names can be resolved. Start with the paths we know are mutated by `mutate.js` today:

| Pattern | Label |
|---|---|
| `rounds[i].scores[j].strokes` | `Ronda {i+1} · Hoyo {j+1} · {playerName or '—'}` |
| `rounds[i].notes` | `Ronda {i+1} · Notas` |
| `rounds[i].pairs` | `Ronda {i+1} · Parejas` |
| `rounds[i].handicaps[playerId]` | `Ronda {i+1} · Handicap · {playerName or '—'}` |
| `players[k].*` | `Jugador · {field}` |
| anything else | the raw path (fallback) |

Player name resolution uses the post-merge blob the worker just pushed (we pass it into `pathToLabel` as context). Unknown player ids fall back to `—`.

### Edge cases

- 10 conflicts arrive in a single drain → single pulse, badge shows `10`.
- User has the sheet already open when a new conflict arrives → badge stays at 0 (we marked read on open), but the *Cambios sobrescritos* list prepends the new entry with no animation (to avoid layout jumps while the user is reading).
- Log reaches 20 and another conflict arrives → the oldest entry is dropped; no user-visible indication.
- App killed and relaunched → log and `unreadCount` survive (both in AsyncStorage). Pulse does **not** replay on cold start — it only fires on live 0 → n transitions within a session.

---

## Architecture summary

```
┌───────────────────────────────────────────────────────────────┐
│ merge.js                                                      │
│   merge(local, remote) → { merged, conflicts }                │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│ syncWorker.js                                                 │
│   on successful push:                                         │
│     append conflicts to @golf_conflict_log (cap 20 FIFO)      │
│     write @golf_conflict_unread += conflicts.length           │
│     write @golf_last_sync_at = now                            │
│     emit to subscribers                                       │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│ tournamentStore.js                                            │
│   getConflicts / subscribeConflicts / markConflictsRead       │
│   loadAllTournamentsWithFallback → stale-tolerant list        │
└──────────────────────────┬────────────────────────────────────┘
                           │
     ┌─────────────────────┼────────────────────────────┐
     │                     │                            │
┌────▼─────────┐   ┌───────▼────────┐   ┌───────────────▼───────┐
│ HomeScreen   │   │ SyncStatusIcon │   │ SyncStatusSheet       │
│ _stale list  │   │ badge + pulse  │   │ status + conflict log │
└──────────────┘   └────────────────┘   └───────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│ tournamentsIndex.js                                           │
│   readIndex / writeIndex / getLocalBlobIds                    │
└───────────────────────────────────────────────────────────────┘
```

## File changes

| File | Change | Responsibility |
|---|---|---|
| `src/store/merge.js` | modify | return `{ merged, conflicts }`; detect same-cell remote-wins only |
| `src/store/syncWorker.js` | modify | persist conflict log, unread counter, last-sync-at; emit |
| `src/store/tournamentStore.js` | modify | add conflict observable API; add `loadAllTournamentsWithFallback`; write index on success |
| `src/store/tournamentsIndex.js` | create | read/write lightweight index; enumerate cached blobs |
| `src/store/conflictLabels.js` | create | `pathToLabel(entry, blob)` mapping |
| `src/components/SyncStatusIcon.js` | modify | badge + pulse; tap opens sheet (no longer retry-on-tap) |
| `src/components/SyncStatusSheet.js` | create | bottom sheet with status + conflict log |
| `src/screens/HomeScreen.js` | modify | consume `_stale` flag, show banner, mark non-openable cards |
| `scripts/test-merge.mjs` | modify | cover new return shape + same-cell detection rules |
| `scripts/test-tournaments-index.mjs` | create | smoke test read/write with injected storage |
| `scripts/test-conflict-labels.mjs` | create | smoke test `pathToLabel` for each known pattern |

## Testing

- **Pure logic tests** (node --test): merge conflict detection, tournaments index round-trip, conflict label rendering.
- **Manual smoke:**
  - Home offline from cold: airplane mode before opening the app; confirm banner + grey cards for uncached ids.
  - Conflict pulse: two browser tabs signed in as the same user; edit the same cell in both while one is offline; bring online; confirm pulse + badge + sheet entry.
  - Persistence across relaunch: trigger a conflict, close app, relaunch; confirm log entry still present in sheet but no pulse on startup.

## Open questions

None at spec time. Clarifications during implementation are expected to be small (copy tweaks, animation timing, icon size).
