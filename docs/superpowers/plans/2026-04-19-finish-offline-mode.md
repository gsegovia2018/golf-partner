# Finish Offline Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining gaps in offline mode: make the Home screen usable without network via a lightweight tournaments index, and surface LWW merge conflicts through a subtle pulse + badge on the `SyncStatusIcon` with details in a bottom sheet.

**Architecture:** `merge.js` upgrades its return shape to `{ merged, conflicts }` so `syncWorker.js` can persist same-cell conflicts into a bounded log. A new `SyncStatusSheet` replaces the icon's tap-to-retry with a full status + conflict-log view. For Home offline, a new `tournamentsIndex.js` module writes a light summary every time `loadAllTournaments()` succeeds, and `HomeScreen` falls back to it with a stale banner when the network call fails. Tournaments that have a summary entry but no cached blob render as non-openable.

**Tech Stack:** React Native 0.81, Expo 54, React Navigation 7, Supabase JS v2, AsyncStorage. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-19-finish-offline-mode-design.md`

**Testing note:** Same constraints as the v1 offline plan — pure-logic modules get `node --test` scripts under `scripts/`; UI and worker changes are verified manually via the offline matrix. No Jest/RTL harness is set up; bootstrapping one remains out of scope.

**Out of scope:** Executing the v1 plan's Task 14 acceptance matrix (tracked separately); discarding pending mutations from the sheet; manual conflict resolution; opening tournaments whose blob is not cached.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/store/merge.js` | modify | Return `{ merged, conflicts }`; detect same-cell remote-wins only |
| `scripts/test-merge.mjs` | modify | Cover new return shape and conflict detection rules |
| `src/store/tournamentStore.js` | modify | Add conflict observable API (`getConflicts`, `subscribeConflicts`, `markConflictsRead`, `getLastSyncAt`); add `loadAllTournamentsWithFallback`; write index on success |
| `src/store/syncWorker.js` | modify | Capture conflicts, persist conflict log + unread counter + last-sync-at, emit |
| `src/store/conflictLabels.js` | create | `pathToLabel(entry, blob)` mapping dotted paths to Spanish human strings |
| `scripts/test-conflict-labels.mjs` | create | Smoke tests for each known path pattern |
| `src/store/tournamentsIndex.js` | create | Read/write lightweight index; enumerate cached blob ids |
| `scripts/test-tournaments-index.mjs` | create | Smoke test read/write/getLocalBlobIds with injected storage |
| `src/components/SyncStatusSheet.js` | create | Bottom sheet: status section + conflict-log section |
| `src/components/SyncStatusIcon.js` | modify | Badge + pulse; tap opens sheet (no more retry-on-tap) |
| `src/screens/HomeScreen.js` | modify | Consume `_stale` list, render banner, grey non-openable cards |

---

## Task 1: `merge.js` returns `{ merged, conflicts }`

**Files:**
- Modify: `src/store/merge.js`
- Modify: `scripts/test-merge.mjs`

- [ ] **Step 1: Add failing tests for the new return shape**

Replace the contents of `scripts/test-merge.mjs` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTournaments, setAtPath, getAtPath } from '../src/store/merge.js';

test('returns { merged, conflicts } with empty conflicts for remote-only', () => {
  const remote = { id: 't1', name: 'A', _meta: { name: 10 } };
  const out = mergeTournaments(null, remote);
  assert.deepEqual(out.merged, remote);
  assert.deepEqual(out.conflicts, []);
});

test('returns { merged, conflicts } with empty conflicts for local-only', () => {
  const local = { id: 't1', name: 'A', _meta: { name: 10 } };
  const out = mergeTournaments(local, null);
  assert.deepEqual(out.merged, local);
  assert.deepEqual(out.conflicts, []);
});

test('disjoint paths are both preserved with no conflicts', () => {
  const local  = { a: 1, b: 0, _meta: { a: 20 } };
  const remote = { a: 0, b: 2, _meta: { b: 15 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.a, 1);
  assert.equal(merged.b, 2);
  assert.equal(merged._meta.a, 20);
  assert.equal(merged._meta.b, 15);
  assert.deepEqual(conflicts, []);
});

test('same path, local wins: no conflict reported', () => {
  const local  = { v: 'L', _meta: { v: 20 } };
  const remote = { v: 'R', _meta: { v: 10 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('same path, remote wins: conflict reported with both values', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { id: 't1', v: 'R', _meta: { v: 20 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'R');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].path, 'v');
  assert.equal(conflicts[0].localTs, 10);
  assert.equal(conflicts[0].remoteTs, 20);
  assert.equal(conflicts[0].winnerValue, 'R');
  assert.equal(conflicts[0].losingValue, 'L');
  assert.equal(conflicts[0].tournamentId, 't1');
  assert.equal(typeof conflicts[0].detectedAt, 'number');
});

test('tie on ts: local wins with no conflict (v1 policy)', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { v: 'R', _meta: { v: 10 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('one-sided ts (remote only) is not a conflict even if remote wins', () => {
  // local never wrote this path → not a user loss from local's perspective
  const local  = { v: 'L', _meta: {} };
  const remote = { v: 'R', _meta: { v: 5 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'R');
  assert.deepEqual(conflicts, []);
});

test('one-sided ts (local only) is not a conflict', () => {
  const local  = { v: 'L', _meta: { v: 5 } };
  const remote = { v: 'R', _meta: {} };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('multiple paths mix wins and losses; only remote-wins reported', () => {
  const local  = { a: 'La', b: 'Lb', _meta: { a: 100, b: 10 } };
  const remote = { id: 't2', a: 'Ra', b: 'Rb', _meta: { a: 50, b: 20 } };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.a, 'La');  // local newer
  assert.equal(merged.b, 'Rb');  // remote newer
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].path, 'b');
  assert.equal(conflicts[0].losingValue, 'Lb');
  assert.equal(conflicts[0].winnerValue, 'Rb');
});

test('legacy blob without _meta: local wins on any set path with no conflicts', () => {
  const local  = { v: 'L', _meta: { v: 1 } };
  const remote = { v: 'R' };
  const { merged, conflicts } = mergeTournaments(local, remote);
  assert.equal(merged.v, 'L');
  assert.deepEqual(conflicts, []);
});

test('setAtPath creates missing intermediate objects', () => {
  const obj = {};
  setAtPath(obj, 'a.b.c', 7);
  assert.equal(obj.a.b.c, 7);
});

test('getAtPath returns undefined for missing paths', () => {
  assert.equal(getAtPath({}, 'x.y'), undefined);
  assert.equal(getAtPath({ x: { y: 3 } }, 'x.y'), 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test scripts/test-merge.mjs
```

Expected: failures on every test that reads `out.merged` / `out.conflicts` because `mergeTournaments` still returns the merged blob directly.

- [ ] **Step 3: Update `mergeTournaments` to return the new shape**

Replace `src/store/merge.js` with:

```js
// Dot-encoded path helpers. Paths look like "rounds.r1.scores.p7.h5".
export function getAtPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function setAtPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function deepClone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}

// LWW merge. Compares _meta[path] on both sides; higher ts wins; ties go to local
// (local has an in-flight mutation not yet pushed).
//
// Returns { merged, conflicts } where `conflicts` is the subset of paths where
// BOTH sides had a _meta ts AND remote's ts was strictly higher (i.e. remote
// overwrote a value the user had also written). Ties, one-sided-ts cases, and
// local-wins cases do not emit conflict entries.
export function mergeTournaments(local, remote) {
  if (!remote) return { merged: local, conflicts: [] };
  if (!local) return { merged: remote, conflicts: [] };

  const merged = deepClone(remote);
  const mergedMeta = { ...(remote._meta ?? {}) };
  const localMeta = local._meta ?? {};
  const paths = new Set([...Object.keys(localMeta), ...Object.keys(mergedMeta)]);
  const conflicts = [];
  const detectedAt = Date.now();

  for (const path of paths) {
    const lTs = localMeta[path] ?? 0;
    const rTs = mergedMeta[path] ?? 0;
    const bothHadTs = localMeta[path] != null && mergedMeta[path] != null;

    if (lTs >= rTs) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
    } else if (bothHadTs) {
      // Remote wins AND local had also written this path → same-cell conflict.
      conflicts.push({
        path,
        localTs: lTs,
        remoteTs: rTs,
        winnerValue: getAtPath(remote, path),
        losingValue: getAtPath(local, path),
        tournamentId: remote.id ?? local.id ?? null,
        detectedAt,
      });
    }
  }

  merged._meta = mergedMeta;
  return { merged, conflicts };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test scripts/test-merge.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/merge.js scripts/test-merge.mjs
git commit -m "$(cat <<'EOF'
Return conflicts from mergeTournaments

merge() now returns { merged, conflicts } so the sync worker can
surface same-cell remote-wins to the user instead of losing them
silently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update `syncWorker` to consume the new merge shape (keep behavior identical for now)

**Files:**
- Modify: `src/store/syncWorker.js`

Rationale: we ship the shape change in a single small commit before we start persisting conflicts, so a regression in the merge consumer is easy to bisect.

- [ ] **Step 1: Adapt `drainTournament` to unpack `{ merged }`**

Edit `src/store/syncWorker.js` around line 42. Replace:

```js
  const merged = mergeTournaments(local, remote);
```

with:

```js
  const { merged } = mergeTournaments(local, remote);
```

- [ ] **Step 2: Boot the app and confirm no regression**

Run:
```bash
npx expo start --web
```

Sign in, open an existing tournament, edit a score, confirm it still saves and syncs as before. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/store/syncWorker.js
git commit -m "$(cat <<'EOF'
Unpack merged blob from new merge return shape

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `tournamentStore.js` with conflict-log API and `lastSyncAt`

**Files:**
- Modify: `src/store/tournamentStore.js`

This adds the plumbing the worker will write to and the icon/sheet will read from. No UI yet.

- [ ] **Step 1: Add storage keys near the top of the file**

Edit `src/store/tournamentStore.js`. Directly after line 6 (`const LEGACY_KEY = '@golf_tournament';`) add:

```js
const CONFLICT_LOG_KEY = '@golf_conflict_log';       // array of conflict entries, cap 20 FIFO
const CONFLICT_UNREAD_KEY = '@golf_conflict_unread'; // integer
const LAST_SYNC_AT_KEY = '@golf_last_sync_at';       // ms epoch of last successful drain

const CONFLICT_LOG_CAP = 20;
```

- [ ] **Step 2: Add the conflict observable block**

Append at the very end of `src/store/tournamentStore.js`:

```js
// ── Conflict log observable ──────────────────────────────────────────────────

let _conflictLog = null;      // lazy-loaded array
let _conflictUnread = null;   // lazy-loaded integer
let _lastSyncAt = null;       // lazy-loaded number | null
const _conflictSubs = new Set();

async function _ensureConflictLoaded() {
  if (_conflictLog != null) return;
  const [rawLog, rawUnread, rawLast] = await Promise.all([
    AsyncStorage.getItem(CONFLICT_LOG_KEY),
    AsyncStorage.getItem(CONFLICT_UNREAD_KEY),
    AsyncStorage.getItem(LAST_SYNC_AT_KEY),
  ]);
  try { _conflictLog = rawLog ? JSON.parse(rawLog) : []; }
  catch { _conflictLog = []; }
  if (!Array.isArray(_conflictLog)) _conflictLog = [];
  const n = parseInt(rawUnread ?? '0', 10);
  _conflictUnread = Number.isFinite(n) && n >= 0 ? n : 0;
  const t = parseInt(rawLast ?? '0', 10);
  _lastSyncAt = Number.isFinite(t) && t > 0 ? t : null;
}

function _emitConflicts() {
  const snapshot = { log: _conflictLog.slice(), unread: _conflictUnread, lastSyncAt: _lastSyncAt };
  _conflictSubs.forEach((fn) => { try { fn(snapshot); } catch (_) {} });
}

export async function getConflicts() {
  await _ensureConflictLoaded();
  return _conflictLog.slice();
}

export async function getConflictUnreadCount() {
  await _ensureConflictLoaded();
  return _conflictUnread;
}

export async function getLastSyncAt() {
  await _ensureConflictLoaded();
  return _lastSyncAt;
}

export function subscribeConflicts(fn) {
  _conflictSubs.add(fn);
  _ensureConflictLoaded().then(() => {
    try { fn({ log: _conflictLog.slice(), unread: _conflictUnread, lastSyncAt: _lastSyncAt }); }
    catch (_) {}
  });
  return () => _conflictSubs.delete(fn);
}

// Worker-only: append a batch of conflicts and bump unread. FIFO cap.
export async function _appendConflicts(entries) {
  if (!entries || entries.length === 0) return;
  await _ensureConflictLoaded();
  const next = _conflictLog.concat(entries);
  // Drop oldest if we exceed cap.
  const trimmed = next.length > CONFLICT_LOG_CAP
    ? next.slice(next.length - CONFLICT_LOG_CAP)
    : next;
  _conflictLog = trimmed;
  _conflictUnread = _conflictUnread + entries.length;
  await AsyncStorage.multiSet([
    [CONFLICT_LOG_KEY, JSON.stringify(_conflictLog)],
    [CONFLICT_UNREAD_KEY, String(_conflictUnread)],
  ]);
  _emitConflicts();
}

// Worker-only: record a successful drain timestamp.
export async function _setLastSyncAt(ts) {
  await _ensureConflictLoaded();
  _lastSyncAt = ts;
  await AsyncStorage.setItem(LAST_SYNC_AT_KEY, String(ts));
  _emitConflicts();
}

export async function markConflictsRead() {
  await _ensureConflictLoaded();
  if (_conflictUnread === 0) return;
  _conflictUnread = 0;
  await AsyncStorage.setItem(CONFLICT_UNREAD_KEY, '0');
  _emitConflicts();
}
```

- [ ] **Step 2b: Smoke-test the observable in isolation**

Run the app and in the web DevTools console (after loading at least one screen that imports `tournamentStore`):

```js
(async () => {
  const s = await import('/src/store/tournamentStore.js');
  console.log('initial unread:', await s.getConflictUnreadCount());
  console.log('initial log:', await s.getConflicts());
  await s._appendConflicts([{
    path: 'rounds.r1.scores.p1.h5',
    localTs: 10, remoteTs: 20, winnerValue: 5, losingValue: 4,
    tournamentId: 'debug', detectedAt: Date.now(),
  }]);
  console.log('after append:', await s.getConflictUnreadCount());
  await s.markConflictsRead();
  console.log('after markRead:', await s.getConflictUnreadCount());
  // cleanup so the next task starts fresh
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  await AS.multiRemove(['@golf_conflict_log', '@golf_conflict_unread', '@golf_last_sync_at']);
})();
```

Expected: logs `initial unread: 0`, then `after append: 1`, then `after markRead: 0`.

- [ ] **Step 3: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "$(cat <<'EOF'
Add conflict-log observable and lastSyncAt to tournament store

Lazy-loaded from AsyncStorage, bounded at 20 FIFO entries, with
subscribe/markRead API consumed by the sync icon and sheet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Persist conflicts and `lastSyncAt` from `syncWorker`

**Files:**
- Modify: `src/store/syncWorker.js`

- [ ] **Step 1: Import the new store helpers**

Edit `src/store/syncWorker.js` line 4. Replace:

```js
import { saveLocal, pushRemote, readLocal, _setSyncStatus } from './tournamentStore';
```

with:

```js
import {
  saveLocal, pushRemote, readLocal, _setSyncStatus,
  _appendConflicts, _setLastSyncAt,
} from './tournamentStore';
```

- [ ] **Step 2: Capture conflicts and emit them**

In the same file, replace the body of `drainTournament` (currently lines 34–53) with:

```js
async function drainTournament(tournamentId, entries) {
  const local = await readLocal(tournamentId);
  if (!local) {
    // Nothing to push — drop the stale entries.
    for (const e of entries) await syncQueue.drop(e.id);
    return;
  }
  const remote = await fetchRemote(tournamentId);
  const { merged, conflicts } = mergeTournaments(local, remote);

  await saveLocal(merged);
  await pushRemote(merged);

  if (conflicts.length > 0) {
    await _appendConflicts(conflicts);
  }

  for (const e of entries) {
    const pathTs = merged._meta?.[e.path] ?? 0;
    if (!e.path || (e.mutation.ts ?? 0) <= pathTs) {
      await syncQueue.drop(e.id);
    }
  }
}
```

- [ ] **Step 3: Record `lastSyncAt` after a successful drain**

In the same file, replace the body of `drainOnce` (currently lines 55–79) with:

```js
async function drainOnce() {
  const all = await syncQueue.all();
  if (all.length === 0) {
    _setSyncStatus('idle');
    return;
  }

  _setSyncStatus('syncing');

  const libraryMuts = all.filter((e) => !e.tournamentId);
  await drainLibrary(libraryMuts);

  const byTournament = new Map();
  for (const e of all) {
    if (!e.tournamentId) continue;
    if (!byTournament.has(e.tournamentId)) byTournament.set(e.tournamentId, []);
    byTournament.get(e.tournamentId).push(e);
  }
  for (const [tid, entries] of byTournament) {
    await drainTournament(tid, entries);
  }

  const remaining = await syncQueue.all();
  if (remaining.length === 0) {
    await _setLastSyncAt(Date.now());
    _setSyncStatus('idle');
  } else {
    _setSyncStatus('pending');
  }
}
```

- [ ] **Step 4: Smoke-test by forcing a conflict manually**

Run:
```bash
npx expo start --web
```

In the web DevTools console once signed in and with at least one tournament active:

```js
(async () => {
  const t = await import('/src/store/tournamentStore.js');
  const w = await import('/src/store/syncWorker.js');
  // Poison a conflict directly via _appendConflicts (fake) just to verify the
  // sync timestamp path — the real E2E verification is in Task 14 of the v1 plan.
  console.log('before lastSyncAt:', await t.getLastSyncAt());
})();
```

Then cause any real edit (type a score) and wait ~2s. Back in the console:

```js
(async () => {
  const t = await import('/src/store/tournamentStore.js');
  console.log('after lastSyncAt:', await t.getLastSyncAt());
})();
```

Expected: `after lastSyncAt` is a numeric ms epoch within the last few seconds. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/store/syncWorker.js
git commit -m "$(cat <<'EOF'
Persist merge conflicts and last-sync-at from sync worker

Conflicts returned by mergeTournaments are appended to the bounded
log; the worker stamps a last-sync-at timestamp on clean drains so
the status sheet can show a human-readable "hace X min".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `conflictLabels.js` — dotted paths → human strings

**Files:**
- Create: `src/store/conflictLabels.js`
- Create: `scripts/test-conflict-labels.mjs`

The paths we care about match those emitted by `mutate.js`:

| Path pattern | Label format |
|---|---|
| `rounds.<roundId>.scores.<playerId>.h<hole>` | `Ronda {i+1} · Hoyo {hole} · {playerName or '—'}` |
| `rounds.<roundId>.notes.round` | `Ronda {i+1} · Notas` |
| `rounds.<roundId>.notes.hole.<hole>` | `Ronda {i+1} · Nota hoyo {hole}` |
| `rounds.<roundId>.pairs` | `Ronda {i+1} · Parejas` |
| `rounds.<roundId>.playerHandicaps.<playerId>` | `Ronda {i+1} · Handicap · {playerName or '—'}` |
| `players` | `Jugadores` |
| anything else | the raw path (fallback) |

Round index `i+1` is computed by finding `roundId` in `blob.rounds[]`; if not found we fall back to `—`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-conflict-labels.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToLabel } from '../src/store/conflictLabels.js';

const blob = {
  id: 't1',
  rounds: [
    { id: 'r1' },
    { id: 'r2' },
  ],
  players: [
    { id: 'p1', name: 'Carlos' },
    { id: 'p2', name: 'Ana' },
  ],
};

function entry(path) {
  return {
    path,
    localTs: 1, remoteTs: 2,
    winnerValue: null, losingValue: null,
    tournamentId: 't1', detectedAt: 0,
  };
}

test('score path with known player + round', () => {
  assert.equal(
    pathToLabel(entry('rounds.r2.scores.p1.h5'), blob),
    'Ronda 2 · Hoyo 5 · Carlos',
  );
});

test('score path with unknown player', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.scores.p9.h3'), blob),
    'Ronda 1 · Hoyo 3 · —',
  );
});

test('round notes path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.notes.round'), blob),
    'Ronda 1 · Notas',
  );
});

test('hole note path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r2.notes.hole.7'), blob),
    'Ronda 2 · Nota hoyo 7',
  );
});

test('pairs path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.pairs'), blob),
    'Ronda 1 · Parejas',
  );
});

test('handicap path', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.playerHandicaps.p2'), blob),
    'Ronda 1 · Handicap · Ana',
  );
});

test('players array path', () => {
  assert.equal(pathToLabel(entry('players'), blob), 'Jugadores');
});

test('unknown round falls back to em-dash', () => {
  assert.equal(
    pathToLabel(entry('rounds.rXX.scores.p1.h1'), blob),
    'Ronda — · Hoyo 1 · Carlos',
  );
});

test('unknown path falls back to raw path', () => {
  assert.equal(
    pathToLabel(entry('some.unrelated.key'), blob),
    'some.unrelated.key',
  );
});

test('null blob: still resolves hole/round numbers but not names', () => {
  assert.equal(
    pathToLabel(entry('rounds.r1.scores.p1.h5'), null),
    'Ronda — · Hoyo 5 · —',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test scripts/test-conflict-labels.mjs
```

Expected: module-not-found error because `conflictLabels.js` doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `src/store/conflictLabels.js`:

```js
// Maps the dotted `_meta` paths emitted by mutate.js into Spanish human labels
// for display in the SyncStatusSheet's "Cambios sobrescritos" list.
//
// The `blob` argument is the post-merge tournament; we use it to resolve
// round indices and player names. If it's null/incomplete, we fall back
// to em-dashes rather than failing.

function roundIndex(blob, roundId) {
  const rounds = blob?.rounds;
  if (!Array.isArray(rounds)) return null;
  const idx = rounds.findIndex((r) => r?.id === roundId);
  return idx >= 0 ? idx : null;
}

function playerName(blob, playerId) {
  const players = blob?.players;
  if (!Array.isArray(players)) return null;
  const p = players.find((x) => x?.id === playerId);
  return p?.name ?? null;
}

function roundLabel(blob, roundId) {
  const i = roundIndex(blob, roundId);
  return i == null ? 'Ronda —' : `Ronda ${i + 1}`;
}

export function pathToLabel(entry, blob) {
  const path = entry?.path ?? '';
  const parts = path.split('.');

  // rounds.<roundId>.scores.<playerId>.h<hole>
  if (parts[0] === 'rounds' && parts[2] === 'scores' && parts[4]?.startsWith('h')) {
    const hole = parts[4].slice(1);
    const name = playerName(blob, parts[3]) ?? '—';
    return `${roundLabel(blob, parts[1])} · Hoyo ${hole} · ${name}`;
  }

  // rounds.<roundId>.notes.round
  if (parts[0] === 'rounds' && parts[2] === 'notes' && parts[3] === 'round' && parts.length === 4) {
    return `${roundLabel(blob, parts[1])} · Notas`;
  }

  // rounds.<roundId>.notes.hole.<hole>
  if (parts[0] === 'rounds' && parts[2] === 'notes' && parts[3] === 'hole' && parts[4] != null) {
    return `${roundLabel(blob, parts[1])} · Nota hoyo ${parts[4]}`;
  }

  // rounds.<roundId>.pairs
  if (parts[0] === 'rounds' && parts[2] === 'pairs' && parts.length === 3) {
    return `${roundLabel(blob, parts[1])} · Parejas`;
  }

  // rounds.<roundId>.playerHandicaps.<playerId>
  if (parts[0] === 'rounds' && parts[2] === 'playerHandicaps' && parts[3] != null) {
    const name = playerName(blob, parts[3]) ?? '—';
    return `${roundLabel(blob, parts[1])} · Handicap · ${name}`;
  }

  // players (whole array replaced)
  if (path === 'players') return 'Jugadores';

  return path;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test scripts/test-conflict-labels.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/conflictLabels.js scripts/test-conflict-labels.mjs
git commit -m "$(cat <<'EOF'
Add conflictLabels.pathToLabel for human-readable diff entries

Covers score, round/hole notes, pairs, handicap, and full-players
mutations with Spanish labels and graceful fallbacks for unknown
paths or missing blob context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `SyncStatusSheet` component

**Files:**
- Create: `src/components/SyncStatusSheet.js`

Bottom sheet following the pattern of `StatDetailSheet.js` (check that file for the modal/pressable-backdrop pattern before writing). The sheet takes `visible: boolean` and `onClose: () => void` as props.

- [ ] **Step 1: Inspect the existing sheet pattern**

Read `src/components/StatDetailSheet.js` to confirm: animation type used on `<Modal>`, backdrop press-to-dismiss, safe-area handling. Follow whatever pattern it uses. If it uses `Modal` with `animationType="slide"` and `transparent`, do the same.

- [ ] **Step 2: Create the component**

Create `src/components/SyncStatusSheet.js`:

```js
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import {
  subscribeSyncStatus,
  subscribeConflicts,
  markConflictsRead,
  readLocal,
} from '../store/tournamentStore';
import { syncQueue } from '../store/syncQueue';
import { retrySync } from '../store/syncWorker';
import { pathToLabel } from '../store/conflictLabels';

const STATE_LABEL = {
  idle: 'Al día',
  syncing: 'Sincronizando',
  pending: 'Pendiente',
  error: 'Error',
};

const STATE_COLOR = {
  idle: '#4a7c4a',
  syncing: '#c0a15c',
  pending: '#c77a0a',
  error: '#b33a3a',
};

function formatRelative(ts) {
  if (!ts) return 'nunca';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'hace instantes';
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

export default function SyncStatusSheet({ visible, onClose }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [pending, setPending] = useState(0);
  const [blob, setBlob] = useState(null);

  // Subscribe to status + conflicts while visible.
  useEffect(() => {
    if (!visible) return;
    const offStatus = subscribeSyncStatus(setStatus);
    const offConflicts = subscribeConflicts(({ log: nextLog, lastSyncAt: nextTs }) => {
      setLog(nextLog);
      setLastSyncAt(nextTs);
    });
    return () => { offStatus(); offConflicts(); };
  }, [visible]);

  // When the sheet opens, mark as read and refresh pending count.
  useEffect(() => {
    if (!visible) return;
    markConflictsRead().catch(() => {});
    syncQueue.all().then((all) => setPending(all.length)).catch(() => setPending(0));
    // Load the active tournament blob so labels can resolve names.
    // We rely on readLocal of the most recent active id via the log entries.
    // If the log is empty or spans multiple tournaments, labels still work —
    // they just fall back to em-dashes for missing names.
  }, [visible]);

  // Try to resolve a blob for the first entry's tournamentId so labels render
  // with human names. If there are multiple tournamentIds in the log, we pick
  // the first one; the rest fall back to em-dashes, which is acceptable.
  useEffect(() => {
    if (!visible || log.length === 0) { setBlob(null); return; }
    const firstTid = log[log.length - 1]?.tournamentId;
    if (!firstTid) { setBlob(null); return; }
    readLocal(firstTid).then(setBlob).catch(() => setBlob(null));
  }, [visible, log]);

  const onRetry = useCallback(() => { retrySync(); }, []);

  const styles = makeStyles(theme, insets);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <Text style={styles.sectionTitle}>Estado</Text>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: STATE_COLOR[status] }]} />
            <Text style={styles.stateLabel}>{STATE_LABEL[status]}</Text>
          </View>
          <Text style={styles.meta}>Pendientes: {pending}</Text>
          <Text style={styles.meta}>Último sync: {formatRelative(lastSyncAt)}</Text>
          {(status === 'error' || status === 'pending') && (
            <Pressable onPress={onRetry} style={styles.retry}>
              <Text style={styles.retryLabel}>Reintentar</Text>
            </Pressable>
          )}

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Cambios sobrescritos</Text>
          {log.length === 0 ? (
            <Text style={styles.empty}>Sin cambios sobrescritos recientes</Text>
          ) : (
            <ScrollView style={styles.logScroll}>
              {log.slice().reverse().map((entry, i) => (
                <View key={`${entry.detectedAt}-${entry.path}-${i}`} style={styles.logItem}>
                  <Text style={styles.logPrimary}>{pathToLabel(entry, blob)}</Text>
                  <Text style={styles.logSecondary}>
                    {formatRelative(entry.detectedAt)}
                    {entry.winnerValue !== undefined && entry.losingValue !== undefined
                      ? ` · quedó en ${formatValue(entry.winnerValue)} (antes ${formatValue(entry.losingValue)})`
                      : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatValue(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return '…';
  const s = String(v);
  return s.length > 24 ? s.slice(0, 23) + '…' : s;
}

function makeStyles(theme, insets) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.bg.primary,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16 + (insets.bottom ?? 0),
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '75%',
    },
    handle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: theme.text.muted,
      opacity: 0.35,
      alignSelf: 'center',
      marginBottom: 12,
    },
    sectionTitle: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 14,
      color: theme.text.muted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginTop: 8,
      marginBottom: 8,
    },
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    stateLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 16,
      color: theme.text.primary,
    },
    meta: {
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      color: theme.text.secondary,
      marginBottom: 2,
    },
    retry: {
      marginTop: 10,
      paddingVertical: 8,
      paddingHorizontal: 14,
      backgroundColor: theme.accent ?? '#006747',
      borderRadius: 8,
      alignSelf: 'flex-start',
    },
    retryLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: '#fff',
      fontSize: 14,
    },
    divider: {
      height: 1,
      backgroundColor: theme.text.muted,
      opacity: 0.15,
      marginVertical: 14,
    },
    empty: {
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      color: theme.text.muted,
      fontStyle: 'italic',
    },
    logScroll: { maxHeight: 280 },
    logItem: { paddingVertical: 8 },
    logPrimary: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 14,
      color: theme.text.primary,
    },
    logSecondary: {
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 12,
      color: theme.text.secondary,
      marginTop: 2,
    },
  });
}
```

Note: if your theme object uses different property names than `theme.text.primary` / `theme.bg.primary` / `theme.accent`, adjust to match. Check `src/theme/ThemeContext.js` first and align; do not introduce new theme keys.

- [ ] **Step 3: Verify the theme shape matches**

Read `src/theme/ThemeContext.js`. If its palette exposes `bg.primary`, `text.primary`, `text.secondary`, `text.muted`, and `accent`, the sheet compiles as written. Otherwise edit the `makeStyles` function to use whatever the theme actually exposes, keeping the same visual intent (muted labels, primary text, accent button).

- [ ] **Step 4: Commit**

```bash
git add src/components/SyncStatusSheet.js
git commit -m "$(cat <<'EOF'
Add SyncStatusSheet for status + conflict log

Bottom sheet with a Status section (state, pending count, last sync,
retry button) and a Cambios sobrescritos list that maps dotted
merge paths to human Spanish labels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Upgrade `SyncStatusIcon` with badge, pulse, and tap-to-open-sheet

**Files:**
- Modify: `src/components/SyncStatusIcon.js`

- [ ] **Step 1: Replace the component**

Overwrite `src/components/SyncStatusIcon.js` with:

```js
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { subscribeSyncStatus, subscribeConflicts } from '../store/tournamentStore';
import SyncStatusSheet from './SyncStatusSheet';

const COLOR = {
  idle:    '#4a7c4a',
  syncing: '#c0a15c',
  pending: '#c77a0a',
  error:   '#b33a3a',
};

const BADGE_COLOR = '#c77a0a'; // ámbar, distinct from the error red

const LABEL = {
  idle: '',
  syncing: 'Sincronizando',
  pending: 'Pendiente',
  error: 'Error',
};

export default function SyncStatusIcon() {
  const [status, setStatus] = useState('idle');
  const [unread, setUnread] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const lastUnreadRef = useRef(0);

  useEffect(() => subscribeSyncStatus(setStatus), []);
  useEffect(() => subscribeConflicts(({ unread: nextUnread }) => {
    setUnread(nextUnread);
  }), []);

  // Fire a single pulse animation on 0 -> n transitions (live only).
  // `lastUnreadRef` is seeded by the first subscribe callback, so cold-start
  // hydration of a persisted non-zero unread does NOT trigger a pulse.
  useEffect(() => {
    const prev = lastUnreadRef.current;
    lastUnreadRef.current = unread;
    if (prev === 0 && unread > 0) {
      pulse.setValue(1);
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [unread, pulse]);

  const open = useCallback(() => setSheetOpen(true), []);
  const close = useCallback(() => setSheetOpen(false), []);

  const badge = unread > 0 ? (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
    </View>
  ) : null;

  const content = status === 'syncing'
    ? <ActivityIndicator size="small" color={COLOR.syncing} />
    : (
      <View style={styles.dotRow}>
        <Animated.View style={[
          styles.dot,
          { backgroundColor: COLOR[status], transform: [{ scale: pulse }] },
        ]} />
        {status !== 'idle' && <Text style={[styles.label, { color: COLOR[status] }]}>{LABEL[status]}</Text>}
      </View>
    );

  return (
    <>
      <Pressable onPress={open} style={styles.hit} hitSlop={10}>
        <View style={styles.container}>
          {content}
          {badge}
        </View>
      </Pressable>
      <SyncStatusSheet visible={sheetOpen} onClose={close} />
    </>
  );
}

const styles = StyleSheet.create({
  hit: { paddingHorizontal: 8, paddingVertical: 4 },
  container: { position: 'relative', flexDirection: 'row', alignItems: 'center' },
  dotRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 12, marginLeft: 6 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: BADGE_COLOR,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Bold',
    lineHeight: 12,
  },
});
```

- [ ] **Step 2: Smoke-test in the browser**

Run:
```bash
npx expo start --web
```

1. Open the app. The icon should render as a green dot (idle), no badge.
2. In DevTools console:

```js
(async () => {
  const s = await import('/src/store/tournamentStore.js');
  await s._appendConflicts([{
    path: 'rounds.r1.scores.p1.h5',
    localTs: 1, remoteTs: 2, winnerValue: 5, losingValue: 4,
    tournamentId: 'debug', detectedAt: Date.now(),
  }]);
})();
```

Expected: the icon pulses once and shows a `1` ámbar badge. Tap the icon → sheet opens with *"Estado"* and *"Cambios sobrescritos"* sections. Close the sheet → badge is gone.

3. Cleanup for the next run:

```js
(async () => {
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  await AS.multiRemove(['@golf_conflict_log', '@golf_conflict_unread', '@golf_last_sync_at']);
})();
```

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/SyncStatusIcon.js
git commit -m "$(cat <<'EOF'
Add conflict badge + pulse to SyncStatusIcon; tap opens sheet

Icon subscribes to the conflict observable, pulses once on fresh
conflicts (cold-start rehydration does not pulse), and shows an
ámbar numeric badge. Tap opens the new SyncStatusSheet in place of
the previous tap-to-retry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `tournamentsIndex.js` — lightweight list cache

**Files:**
- Create: `src/store/tournamentsIndex.js`
- Create: `scripts/test-tournaments-index.mjs`

Stores a summary array under `@golf_tournaments_index`. Storage is injectable so the smoke test can use a fake.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-tournaments-index.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournamentsIndex } from '../src/store/tournamentsIndex.js';

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    async getItem(k) { return k in store ? store[k] : null; },
    async setItem(k, v) { store[k] = v; },
    async removeItem(k) { delete store[k]; },
    async getAllKeys() { return Object.keys(store); },
    __store: store,
  };
}

test('readIndex returns [] on empty storage', async () => {
  const idx = createTournamentsIndex({ storage: makeStorage() });
  assert.deepEqual(await idx.readIndex(), []);
});

test('writeIndex + readIndex round-trip strips to shape', async () => {
  const idx = createTournamentsIndex({ storage: makeStorage() });
  await idx.writeIndex([
    { id: 'a', name: 'Tour A', createdAt: '2026-04-01', _role: 'owner', updatedAt: 123, extra: 'drop' },
    { id: 'b', name: 'Tour B', createdAt: '2026-04-02', _role: 'editor' },
  ]);
  const out = await idx.readIndex();
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'a', name: 'Tour A', createdAt: '2026-04-01', role: 'owner', updatedAt: 123 });
  assert.deepEqual(out[1], { id: 'b', name: 'Tour B', createdAt: '2026-04-02', role: 'editor', updatedAt: null });
});

test('readIndex tolerates corrupted JSON', async () => {
  const storage = makeStorage({ '@golf_tournaments_index': 'not-json' });
  const idx = createTournamentsIndex({ storage });
  assert.deepEqual(await idx.readIndex(), []);
});

test('getLocalBlobIds returns ids from @golf_tournament_<id> keys', async () => {
  const storage = makeStorage({
    '@golf_tournament_a': '{}',
    '@golf_tournament_b': '{}',
    '@golf_sync_queue': '[]',
    '@unrelated': 'x',
  });
  const idx = createTournamentsIndex({ storage });
  const ids = await idx.getLocalBlobIds();
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('missing name/createdAt fields become empty string / null', async () => {
  const idx = createTournamentsIndex({ storage: makeStorage() });
  await idx.writeIndex([{ id: 'x' }]);
  assert.deepEqual(await idx.readIndex(), [{
    id: 'x', name: '', createdAt: null, role: null, updatedAt: null,
  }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test scripts/test-tournaments-index.mjs
```

Expected: module-not-found error.

- [ ] **Step 3: Implement the module**

Create `src/store/tournamentsIndex.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const INDEX_KEY = '@golf_tournaments_index';
const BLOB_PREFIX = '@golf_tournament_';

// Storage is injectable for tests. In production it's AsyncStorage.
// getAllKeys is used by getLocalBlobIds; AsyncStorage exposes it natively.
export function createTournamentsIndex({ storage = AsyncStorage, key = INDEX_KEY } = {}) {
  function summarize(t) {
    return {
      id: t?.id,
      name: t?.name ?? '',
      createdAt: t?.createdAt ?? null,
      role: t?._role ?? null,
      updatedAt: t?.updatedAt ?? null,
    };
  }

  return {
    async readIndex() {
      const raw = await storage.getItem(key);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },

    async writeIndex(tournaments) {
      const summary = (tournaments ?? []).map(summarize);
      await storage.setItem(key, JSON.stringify(summary));
    },

    async getLocalBlobIds() {
      const keys = typeof storage.getAllKeys === 'function' ? await storage.getAllKeys() : [];
      return keys
        .filter((k) => typeof k === 'string' && k.startsWith(BLOB_PREFIX))
        .map((k) => k.slice(BLOB_PREFIX.length));
    },
  };
}

// Singleton used by the app. Tests call createTournamentsIndex with their own storage.
export const tournamentsIndex = createTournamentsIndex();
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test scripts/test-tournaments-index.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentsIndex.js scripts/test-tournaments-index.mjs
git commit -m "$(cat <<'EOF'
Add lightweight tournaments index for Home offline

Persists a { id, name, createdAt, role, updatedAt } summary per
tournament so Home can render without network. getLocalBlobIds
reports which tournaments actually have a cached full blob.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `loadAllTournamentsWithFallback` in `tournamentStore`

**Files:**
- Modify: `src/store/tournamentStore.js`

- [ ] **Step 1: Import the index helper**

At the top of `src/store/tournamentStore.js` (right below the existing imports), add:

```js
import { tournamentsIndex } from './tournamentsIndex';
```

- [ ] **Step 2: Write the index on successful remote load**

Edit `loadAllTournaments`. The current body ends around line 89 with `return result.sort((a, b) => b.id - a.id);`. Replace that return with:

```js
  const sorted = result.sort((a, b) => b.id - a.id);
  // Fire-and-forget: keep the offline index in sync with the latest remote list.
  tournamentsIndex.writeIndex(sorted).catch(() => {});
  return sorted;
```

(For the `!userId` branch higher up that returns `data.map(...)`, do the same — compute the mapped array into a const, write the index, then return.)

Concrete: replace the `!userId` block (lines 61–67) with:

```js
  if (!userId) {
    const { data, error } = await supabase
      .from('tournaments').select('data')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const list = data.map((row) => ({ ...row.data, _role: 'owner' }));
    tournamentsIndex.writeIndex(list).catch(() => {});
    return list;
  }
```

- [ ] **Step 3: Add `loadAllTournamentsWithFallback`**

Append after the existing `loadAllTournaments` function:

```js
// Used by Home. Tries remote first; on failure, returns the last-known index
// marked with `_stale: true` plus a `_openableIds` set for rendering
// non-openable cards. Never throws.
export async function loadAllTournamentsWithFallback() {
  try {
    const list = await loadAllTournaments();
    return { list, stale: false, openableIds: null };
  } catch (_) {
    const [index, openable] = await Promise.all([
      tournamentsIndex.readIndex(),
      tournamentsIndex.getLocalBlobIds(),
    ]);
    return {
      list: index.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        _role: row.role,
        updatedAt: row.updatedAt,
        _stale: true,
      })),
      stale: true,
      openableIds: new Set(openable),
    };
  }
}
```

- [ ] **Step 4: Smoke-test the fallback**

Run:
```bash
npx expo start --web
```

1. Sign in, navigate to Home with network on — confirm the list loads as before. Open DevTools, inspect AsyncStorage (Application → Storage → Local Storage); `@golf_tournaments_index` should now contain a JSON array of summaries.

2. Turn on DevTools Network "Offline" and refresh Home. The call goes through `loadAllTournamentsWithFallback` (once Task 10 wires it up); for now just verify that in the console:

```js
(async () => {
  const s = await import('/src/store/tournamentStore.js');
  const r = await s.loadAllTournamentsWithFallback();
  console.log('fallback result:', r);
})();
```

Expected: first call (online) returns `{ list: [...], stale: false, openableIds: null }`. With DevTools Network set to Offline and Supabase unreachable, returns `{ list: [...with _stale:true], stale: true, openableIds: Set(...) }`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "$(cat <<'EOF'
Write tournaments index on successful load; add offline fallback

loadAllTournaments now mirrors its result into the lightweight
index. loadAllTournamentsWithFallback reads that index when the
remote call fails, tagging items with _stale and returning the
set of tournament ids that have a cached full blob.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire `HomeScreen` to use the fallback, render stale banner, grey non-openable cards

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Inspect the current rendering of the list**

Read the section of `src/screens/HomeScreen.js` that renders `allTournaments`. Identify:

- The JSX element that wraps each tournament card (look for the map over `allTournaments`).
- The `onPress` handler for opening a tournament.
- The existing theme tokens used for cards (so the "greyed + offline icon" treatment stays on-brand).

- [ ] **Step 2: Switch the loader to the fallback**

Replace the import of `loadAllTournaments` (line 11-19 area) with:

```js
import {
  loadTournament, loadAllTournaments, loadAllTournamentsWithFallback,
  setActiveTournament, clearActiveTournament,
  deleteTournament, saveTournament,
  tournamentLeaderboard, tournamentBestWorstLeaderboard,
  roundPairLeaderboard, calcBestWorstBall, roundTotals,
  playerRoundBestWorstPoints,
  DEFAULT_SETTINGS, generateInviteCode, setInviteRole,
} from '../store/tournamentStore';
```

Add two pieces of state alongside `allTournaments` (near line 45):

```js
  const [listStale, setListStale] = useState(false);
  const [openableIds, setOpenableIds] = useState(null); // null = all openable
```

Replace the `reload` callback (currently around lines 78–88) with:

```js
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [t, listResult] = await Promise.all([
        loadTournament(),
        loadAllTournamentsWithFallback(),
      ]);
      setTournament(t);
      setAllTournaments(listResult.list);
      setListStale(listResult.stale);
      setOpenableIds(listResult.openableIds);
      if (t) setSelectedRound(t.currentRound);
    } finally {
      setLoading(false);
    }
  }, []);
```

- [ ] **Step 3: Render the stale banner**

Locate the top-level `SafeAreaView` / scroll container where the tournaments list sits. Directly above that list (or below the header, whichever matches existing banner patterns in the file — search for existing `banner`/`info`/`notice` style to reuse), add:

```jsx
{listStale && (
  <View style={styles.staleBanner}>
    <Feather name="cloud-off" size={14} color="#c77a0a" />
    <Text style={styles.staleBannerText}>Sin conexión · mostrando última lista guardada</Text>
  </View>
)}
```

Add to the StyleSheet at the bottom of the file:

```js
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(199, 122, 10, 0.12)',
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  staleBannerText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 13,
    color: '#c77a0a',
  },
```

- [ ] **Step 4: Grey out non-openable cards**

In the `.map` over `allTournaments`, compute per-card whether it's openable:

```jsx
{allTournaments.map((t) => {
  const openable = !openableIds || openableIds.has(t.id);
  return (
    <TouchableOpacity
      key={t.id}
      disabled={!openable}
      style={[
        yourExistingCardStyle,        // keep whatever the file already uses
        !openable && { opacity: 0.5 },
      ]}
      onPress={() => { /* existing onPress */ }}
    >
      {/* existing card body */}
      {!openable && (
        <View style={styles.offlineBadge}>
          <Feather name="cloud-off" size={12} color="#c77a0a" />
          <Text style={styles.offlineBadgeText}>Requiere conexión</Text>
        </View>
      )}
    </TouchableOpacity>
  );
})}
```

Add to the StyleSheet:

```js
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    position: 'absolute',
    top: 8,
    right: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(199, 122, 10, 0.15)',
  },
  offlineBadgeText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: '#c77a0a',
  },
```

Note: `openableIds === null` (online case) means every card is openable — guard against treating `null` as an empty set.

- [ ] **Step 5: Handle the empty-first-offline case**

If `listStale` is true AND `allTournaments.length === 0`, show a dedicated empty state instead of the default one:

```jsx
{allTournaments.length === 0 && listStale && (
  <View style={styles.staleEmpty}>
    <Feather name="cloud-off" size={32} color={theme.text.muted} />
    <Text style={styles.staleEmptyText}>Sin conexión · aún no hay torneos guardados</Text>
  </View>
)}
```

Add matching styles:

```js
  staleEmpty: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 12,
  },
  staleEmptyText: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 14,
    color: theme?.text?.muted ?? '#888',
    textAlign: 'center',
  },
```

(If the existing file uses a non-`StyleSheet.create` pattern for dynamic theme-dependent styles, match that pattern instead. Do not introduce a new styling convention.)

- [ ] **Step 6: Smoke-test the full offline flow**

Run:
```bash
npx expo start --web
```

1. Sign in, open Home online. Confirm the list renders and nothing new is visible.
2. Open DevTools → Application → Local Storage. Confirm `@golf_tournaments_index` exists and contains the list.
3. DevTools Network → Offline. Hard refresh the page (Ctrl+Shift+R). Home should render with the ámbar stale banner at the top, all tournaments shown, cards for tournaments you've *actually opened before* stay normal-looking and clickable, cards you *haven't* opened are greyed with a "Requiere conexión" badge and are not tappable.
4. Click a greyed card → nothing happens. Click a normal card → opens the tournament (reads from local blob).
5. Toggle Network back to Online, refresh Home. Banner disappears, all cards return to normal.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "$(cat <<'EOF'
Home falls back to cached tournaments index when offline

When loadAllTournaments fails, Home renders the last-known index
with an ámbar "Sin conexión" banner. Tournaments whose full blob
has never been cached render greyed with a "Requiere conexión"
badge and are not tappable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Manual verification checklist

**Files:** none (verification only)

This is the acceptance pass for the two features in this plan. It is separate from the v1 plan's Task 14 matrix.

- [ ] **Step 1: Boot the app**

```bash
npx expo start --web
```

- [ ] **Step 2: Run through each case**

| Case | Action | Expected |
|---|---|---|
| Home fresh online | Sign in, open Home, leave network on | List renders; `@golf_tournaments_index` populated |
| Home offline (with index) | Network offline, refresh Home | Ámbar banner at top; cached tournaments tappable; uncached ones greyed with "Requiere conexión" |
| Home offline (no index) | Clear `@golf_tournaments_index`, network offline, refresh | Empty state *"Sin conexión · aún no hay torneos guardados"* |
| Open greyed card | Offline, tap a "Requiere conexión" card | No navigation, no error |
| Open normal card offline | Offline, tap a normal card | Tournament opens from local blob |
| Recover online | Turn network on, refresh Home | Banner gone; greyed cards return to normal |
| Conflict pulse (synthetic) | Online, append a conflict via console | Icon pulses once, ámbar badge shows `1` |
| Conflict pulse (real) | Two browser tabs signed in as same user; edit same cell offline in tab A while tab B is online; bring A online | Badge on A shows `1` after sync; sheet entry matches |
| Sheet content | Tap the icon when there are conflicts | Sheet shows status + pending + last sync + conflict list with human labels |
| Sheet marks read | Open sheet and close | Badge disappears on close |
| Persist across relaunch | Cause a conflict, hard-refresh the app | Badge persists for unread; sheet still shows the entry. **No pulse on cold start.** |
| Retry from sheet | Force an error state (temp wrong Supabase URL), trigger an edit, open sheet, tap "Reintentar" | Status flips to syncing → error or idle depending on whether the URL is fixed |
| Log cap | Append 25 conflicts via console | Log holds exactly 20; oldest dropped |

- [ ] **Step 3: Fix anything that doesn't pass**

Fix against the relevant task and recommit. Do not expand scope — issues outside this plan (e.g. Task 14 of the v1 plan) go to their own follow-ups.

- [ ] **Step 4: Final commit (empty if nothing else changed)**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
Finish offline mode: verification passed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
