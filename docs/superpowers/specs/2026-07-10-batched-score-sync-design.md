# Batched Score Sync + Finish-Time Conflict Resolution

**Date:** 2026-07-10
**Status:** Approved
**Scope:** Casual rounds only (`ScorecardScreen` + `mutate`/`merge`/`syncWorker` stores). Official tournaments use the separate realtime path (`useOfficialRound`) and are not touched.

## Problem

When multiple players enter scores in the same game:

1. Every +/- tap saves **and pushes to Supabase immediately** (`ScorecardScreen` `stepScore`/`setScore` → `autoSave` → `mutate` → `syncQueue.enqueue` + `scheduleSync`). A single tap (par) is on the server before the user finishes entering, so other devices see half-entered scores.
2. Each sync also pulls and merges remote state per-cell, so mid-entry collisions surface "tap to resolve" conflict markers while both players are still typing.
3. The merge is last-write-wins by device wall clock (`Date.now()`). Clock skew, missing `_meta` stamps, or null-vs-value cases let a stale remote copy **silently overwrite** a locally committed score — no conflict marker, no warning. This is the "my previous hole's score changed without me knowing" bug.

## Decisions (user-confirmed)

- **Push timing:** hole change + finish + leaving the screen + app background. No idle timeout, no per-tap push.
- **Conflict UX during round:** subtle amber dot only; tap-to-resolve stays available but never blocks or interrupts.
- **Displayed value under conflict:** always the local user's own entry. A cell the user wrote never visibly changes until the user resolves it.
- **Finish flow:** a summary sheet lists every conflicted hole/player with both values; the user picks each one; then the round finishes.

## Design

### 1. Defer the sync kick, keep per-tap local persistence

Per tap, unchanged: local React state update, `autoSave` diff, `mutate('score.set')` → `saveLocal` + `syncQueue.enqueue`. Crash safety and the offline queue are untouched.

New: `mutate` accepts an options argument (e.g. `{ deferSync: true }`) that skips the `scheduleSync()` call. The scorecard's score-save path passes it; every other mutation (notes, handicaps, finish, conflict resolution) keeps current behavior.

New `flushScoreSync()` in `ScorecardScreen` kicks `scheduleSync()` (which drains the already-enqueued mutations: push + pull-merge). Triggered by:

- Hole navigation: `goToNextHole`, `goToHole`, pager swipe settle.
- Finish (`handleFinish`) — awaited, so the conflict summary sees fresh remote state.
- Screen unmount / navigation blur.
- AppState transition to background/inactive.

Connectivity-restore draining in `syncWorker` is unchanged — queued score mutations ride along whenever a drain runs.

### 2. "Always mine" merge semantics for score cells

In `mergeTournaments` (`src/store/merge.js`), the score-cell pass (`rounds.<rid>.scores.<pid>.h<hole>`) changes from timestamp-ordered LWW to:

- **Local wrote the cell** (`localMeta[path]` exists): merged value = **local value, always**, regardless of timestamps.
  - Remote also wrote a **different** value (including null-vs-value): write/refresh a conflict marker at `rounds.<rid>.scoreConflicts.<pid>.h<hole>` holding both candidates and their timestamps.
  - Remote value equal or remote never wrote: clear any stale marker.
- **Local never wrote the cell:** take remote (partner's entries appear normally), no marker.

Non-score paths keep existing LWW behavior.

This closes all silent-overwrite paths: a cell the user wrote either keeps its value or gains a visible marker — never a quiet flip. Clock skew no longer affects what is displayed.

### 3. Resolution propagation

Resolving (existing `conflict.resolve` mutation) writes the chosen value, clears the marker, and additionally records a **resolution stamp** per cell (e.g. `rounds.<rid>.scoreResolutions.<pid>.h<hole> = ts`, with its own `_meta` path).

Merge rule addition: if one side carries a resolution stamp for a cell that is newer than the other side's raw write of that cell, the resolved value wins on both devices and markers clear. A raw write newer than the resolution re-enters the normal always-mine flow (someone deliberately edited after resolving). If both sides resolved, the later resolution wins — acceptable for this rare case.

### 4. Finish-time conflict summary

`handleFinish` flow becomes:

1. `await autoSave(...)` (existing) + `await flushScoreSync()` with a final drain so remote state is current.
2. Collect all open conflicts via `listRoundConflicts` for the round.
3. If any: open a **conflict summary sheet** (built on the shared `src/components/BottomSheet.js`) listing each conflict — hole number, player, "mine" vs "theirs" values — with a per-row choice. Each choice fires `conflict.resolve`. When the list is empty, finishing proceeds automatically.
4. If none: finish as today.

This replaces the current blocking "Resolve conflict to finish" alert that jumps to a single hole at a time.

During the round, the amber hole-picker dot and hero-card tap-to-resolve remain as-is (non-blocking).

### 5. Error handling & edge cases

- **App killed mid-hole:** mutations are already in the persisted sync queue; they push on next launch/flush.
- **Offline round:** queue drains on reconnect; conflicts surface at that point (dot) and at finish.
- **Flush while a drain is running:** existing `_running` re-entrancy guard in `syncWorker` handles it.
- **Both players finish concurrently:** each resolves in their own summary; resolution stamps order the outcome; later resolution wins.
- **Score edit after finishing** (viewOnly re-entry, admin edits): unchanged paths; always-mine merge still applies.

### 6. Testing

- `merge.js` unit tests: always-mine for written cells; marker creation on differing values including null-vs-value; marker clearing on equal values; untouched cells take remote; resolution stamp propagation and post-resolution edits; clock-skew scenarios that previously overwrote silently.
- `mutate.js`: `deferSync` skips the sync kick, still saves locally and enqueues.
- ScorecardScreen: flush fires on hole change / unmount / background; no sync kick on tap.
- Finish flow: summary listing, sequential resolution, auto-proceed when clear.
- Full existing suite (~330 tests) stays green.

## Alternatives considered

- **Merge the parked `wip/score-entry-perf` branch (400ms trailing debounce):** rejected — still pushes mid-hole, so half-entered scores leak and mid-entry conflicts persist. Its `trailingDebounce` utility may still be reused if convenient, but hole-change batching is the behavior driver.
- **Buffer edits in screen state and only `mutate` on hole change:** rejected — loses crash safety and offline-queue integrity for the active hole.
- **Server-authoritative ordering (Postgres timestamps):** out of scope; the offline-first blob model makes per-cell always-mine + explicit resolution the better fit.
