# Offline Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make score entry, notes, pair changes, per-tournament handicap edits, and library player adds work without internet. Changes are persisted locally and reconciled with Supabase on the next successful sync using field-level last-write-wins.

**Architecture:** A new `mutate.js` entry point wraps every write: it updates the in-memory tournament, bumps a per-path `_meta` timestamp, persists to AsyncStorage, emits the change to existing subscribers, and appends to a persisted `syncQueue`. A `syncWorker` drains the queue when online by merging local and remote blobs through a pure `merge.js` function and upserting the result to Supabase. A sync-status icon in the header reflects queue state.

**Tech Stack:** React Native 0.81, Expo 54, React Navigation 7, Supabase JS v2, AsyncStorage, plus two new deps (`uuid`, `@react-native-community/netinfo`).

**Spec:** `docs/superpowers/specs/2026-04-19-offline-mode-design.md`

**Testing note:** This project has **no Jest / react-native-testing-library harness**. Bootstrapping one is out of scope. Pure-logic modules (`merge.js`, `syncQueue.js`) get tiny `node --test` scripts under `scripts/`. UI and worker changes are verified manually via an offline matrix (airplane mode + DevTools "Offline"). A final end-to-end verification task enumerates the acceptance checks.

**In-scope limitation:** Offline only covers a tournament the user has already opened at least once (so its blob is in AsyncStorage). The Home screen's "all tournaments" list still reads from Supabase and will fail offline. Persisting the tournaments list for offline browsing is out of v1 scope per the design spec.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json` | modify | add `uuid`, `@react-native-community/netinfo` |
| `src/store/merge.js` | create | pure LWW merge by `_meta` path |
| `src/store/syncQueue.js` | create | persisted FIFO queue backed by AsyncStorage |
| `src/lib/connectivity.js` | create | online/offline detector (NetInfo + web fallback) |
| `src/store/tournamentStore.js` | modify | split `saveTournament`, add `saveLocal`, `schedulePush`, `syncStatus` + `subscribeSyncStatus` |
| `src/store/mutate.js` | create | single entry for all mutation types; updates state, bumps `_meta`, persists, enqueues |
| `src/store/syncWorker.js` | create | drains `syncQueue`, merges, upserts, backs off on failure |
| `src/screens/ScorecardScreen.js` | modify | route `setScore` and `saveNotes` through `mutate()` |
| `src/screens/EditTeamsScreen.js` | modify | route pair save through `mutate()` |
| `src/screens/NextRoundScreen.js` | modify | route handicap save through `mutate()` |
| `src/screens/PlayersLibraryScreen.js` | modify | generate UUID on new-player creation; route through `mutate()` library path |
| `src/store/libraryStore.js` | modify | accept client-supplied UUID in `upsertPlayer` |
| `src/components/SyncStatusIcon.js` | create | four-state icon subscribed to `subscribeSyncStatus` |
| `App.js` | modify | mount `SyncStatusIcon` in the shared header region |
| `scripts/test-merge.mjs` | create | `node --test` smoke tests for merge.js |
| `scripts/test-sync-queue.mjs` | create | `node --test` smoke tests for syncQueue with injected storage |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install uuid and NetInfo**

Run:
```bash
npm install uuid @react-native-community/netinfo
```

Expected: both land under `dependencies`. `@react-native-community/netinfo` may print a peer-dep note for Expo; that's fine as long as the install succeeds.

- [ ] **Step 2: Verify app still boots**

Run:
```bash
npx expo start --web
```

Open the printed URL. Confirm the Home screen loads as before. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add uuid and NetInfo for offline mode"
```

---

## Task 2: `merge.js` — pure LWW merge

**Files:**
- Create: `src/store/merge.js`
- Create: `scripts/test-merge.mjs`

- [ ] **Step 1: Write the failing smoke tests**

Create `scripts/test-merge.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTournaments, setAtPath, getAtPath } from '../src/store/merge.js';

test('remote-only blob returns unchanged', () => {
  const remote = { id: 't1', name: 'A', _meta: { name: 10 } };
  assert.deepEqual(mergeTournaments(null, remote), remote);
});

test('local-only blob returns unchanged', () => {
  const local = { id: 't1', name: 'A', _meta: { name: 10 } };
  assert.deepEqual(mergeTournaments(local, null), local);
});

test('disjoint paths are both preserved', () => {
  const local  = { a: 1, b: 0, _meta: { a: 20 } };
  const remote = { a: 0, b: 2, _meta: { b: 15 } };
  const out = mergeTournaments(local, remote);
  assert.equal(out.a, 1);
  assert.equal(out.b, 2);
  assert.equal(out._meta.a, 20);
  assert.equal(out._meta.b, 15);
});

test('same path: higher ts wins', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { v: 'R', _meta: { v: 20 } };
  assert.equal(mergeTournaments(local, remote).v, 'R');
});

test('tie on ts: local wins', () => {
  const local  = { v: 'L', _meta: { v: 10 } };
  const remote = { v: 'R', _meta: { v: 10 } };
  assert.equal(mergeTournaments(local, remote).v, 'L');
});

test('legacy blob without _meta: local wins on any set path', () => {
  const local  = { v: 'L', _meta: { v: 1 } };
  const remote = { v: 'R' }; // no _meta at all
  assert.equal(mergeTournaments(local, remote).v, 'L');
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

- [ ] **Step 2: Run the tests and watch them fail**

Run:
```bash
node --test scripts/test-merge.mjs
```

Expected: all tests fail with import errors (module not found).

- [ ] **Step 3: Implement `merge.js`**

Create `src/store/merge.js`:

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
export function mergeTournaments(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const merged = deepClone(remote);
  const mergedMeta = { ...(remote._meta ?? {}) };
  const localMeta = local._meta ?? {};
  const paths = new Set([...Object.keys(localMeta), ...Object.keys(mergedMeta)]);

  for (const path of paths) {
    const lTs = localMeta[path] ?? 0;
    const rTs = mergedMeta[path] ?? 0;
    if (lTs >= rTs) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
    }
  }

  merged._meta = mergedMeta;
  return merged;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run:
```bash
node --test scripts/test-merge.mjs
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/store/merge.js scripts/test-merge.mjs
git commit -m "Add pure LWW merge for tournament blobs"
```

---

## Task 3: `syncQueue.js` — persisted FIFO

**Files:**
- Create: `src/store/syncQueue.js`
- Create: `scripts/test-sync-queue.mjs`

- [ ] **Step 1: Write the failing smoke tests**

Create `scripts/test-sync-queue.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncQueue } from '../src/store/syncQueue.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: async (k) => m.has(k) ? m.get(k) : null,
    setItem: async (k, v) => { m.set(k, v); },
    removeItem: async (k) => { m.delete(k); },
    _map: m,
  };
}

test('enqueue appends; all() returns FIFO order', async () => {
  const q = createSyncQueue({ storage: memoryStorage() });
  await q.enqueue({ type: 'score.set', value: 1 });
  await q.enqueue({ type: 'score.set', value: 2 });
  const all = await q.all();
  assert.equal(all.length, 2);
  assert.equal(all[0].value, 1);
  assert.equal(all[1].value, 2);
  assert.ok(all[0].id && all[1].id, 'entries get ids');
});

test('drop removes by id', async () => {
  const q = createSyncQueue({ storage: memoryStorage() });
  const a = await q.enqueue({ type: 'x' });
  const b = await q.enqueue({ type: 'y' });
  await q.drop(a.id);
  const all = await q.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, b.id);
});

test('queue survives a reload via the same storage', async () => {
  const storage = memoryStorage();
  const q1 = createSyncQueue({ storage });
  await q1.enqueue({ type: 'x', value: 42 });
  const q2 = createSyncQueue({ storage });
  const all = await q2.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].value, 42);
});
```

- [ ] **Step 2: Run tests and watch them fail**

Run:
```bash
node --test scripts/test-sync-queue.mjs
```

Expected: import errors on all three tests.

- [ ] **Step 3: Implement `syncQueue.js`**

Create `src/store/syncQueue.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_KEY = '@golf_sync_queue';

// Storage is injectable for tests. In production it is AsyncStorage, which
// implements the same getItem/setItem/removeItem surface.
export function createSyncQueue({ storage = AsyncStorage, key = QUEUE_KEY } = {}) {
  async function readAll() {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeAll(entries) {
    await storage.setItem(key, JSON.stringify(entries));
  }

  return {
    async enqueue(mutation) {
      const entry = { id: uuidv4(), ...mutation };
      const all = await readAll();
      all.push(entry);
      await writeAll(all);
      return entry;
    },
    async all() {
      return readAll();
    },
    async drop(id) {
      const all = await readAll();
      await writeAll(all.filter((e) => e.id !== id));
    },
    async clear() {
      await storage.removeItem(key);
    },
  };
}

// Singleton used by the app. Tests pass their own storage instead.
export const syncQueue = createSyncQueue();
```

- [ ] **Step 4: Run tests and watch them pass**

Run:
```bash
node --test scripts/test-sync-queue.mjs
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/store/syncQueue.js scripts/test-sync-queue.mjs
git commit -m "Add persisted mutation queue"
```

---

## Task 4: `connectivity.js` — online/offline signal

**Files:**
- Create: `src/lib/connectivity.js`

- [ ] **Step 1: Implement the module**

Create `src/lib/connectivity.js`:

```js
import { Platform } from 'react-native';

// NetInfo on native; navigator.onLine on web (with a window listener).
// `isOnline()` returns the last known state. `subscribe(fn)` fires fn(online:boolean)
// whenever the state changes. First event on subscribe is the current state.

let _online = true;
const _subs = new Set();

function _emit() {
  _subs.forEach((fn) => { try { fn(_online); } catch (_) {} });
}

function _set(next) {
  if (next === _online) return;
  _online = next;
  _emit();
}

if (Platform.OS === 'web') {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    _online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    window.addEventListener('online', () => _set(true));
    window.addEventListener('offline', () => _set(false));
  }
} else {
  // Lazy-require so web doesn't try to resolve the native module
  const NetInfo = require('@react-native-community/netinfo').default;
  NetInfo.fetch().then((s) => _set(!!s.isConnected));
  NetInfo.addEventListener((s) => _set(!!s.isConnected));
}

export function isOnline() {
  return _online;
}

export function subscribeConnectivity(fn) {
  _subs.add(fn);
  try { fn(_online); } catch (_) {}
  return () => _subs.delete(fn);
}
```

- [ ] **Step 2: Smoke-test on web**

Run:
```bash
npx expo start --web
```

In the browser DevTools console on the running app:
```js
// paste
(async () => {
  const m = await import('/src/lib/connectivity.js');
  console.log('online?', m.isOnline());
})();
```

Expected: logs `true`. Toggle DevTools Network "Offline" and repeat — should log `false` within a second.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/lib/connectivity.js
git commit -m "Add connectivity signal"
```

---

## Task 5: Extend `tournamentStore.js` — split save + syncStatus

**Files:**
- Modify: `src/store/tournamentStore.js`

- [ ] **Step 1: Add `saveLocal` and `syncStatus` plumbing**

Replace the current `persistTournament` + `saveTournament` block (lines 71–85 of `src/store/tournamentStore.js`) with:

```js
const ACTIVE_TOURNAMENT_KEY = '@golf_tournament_'; // + id

async function persistRemote(tournament) {
  const { error } = await supabase.from('tournaments').upsert({
    id: tournament.id,
    name: tournament.name,
    created_at: tournament.createdAt,
    data: tournament,
  });
  if (error) throw error;
}

export async function saveLocal(tournament) {
  await AsyncStorage.multiSet([
    [ACTIVE_ID_KEY, tournament.id],
    [ACTIVE_TOURNAMENT_KEY + tournament.id, JSON.stringify(tournament)],
  ]);
  _emitChange();
}

export async function readLocal(id) {
  const raw = await AsyncStorage.getItem(ACTIVE_TOURNAMENT_KEY + id);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Backwards-compatible entry: local first, then attempt remote. Never throws on
// remote failure — the sync worker picks it up later.
export async function saveTournament(tournament) {
  await saveLocal(tournament);
  try {
    await persistRemote(tournament);
  } catch (_) {
    // Swallow: the sync worker will retry.
  }
}

// Worker-only: used by syncWorker when pushing a merged blob.
export async function pushRemote(tournament) {
  await persistRemote(tournament);
}

// ── Sync status observable ───────────────────────────────────────────────────

const SYNC_STATES = ['idle', 'syncing', 'pending', 'error'];
let _syncStatus = 'idle';
const _syncSubs = new Set();

export function getSyncStatus() { return _syncStatus; }

export function subscribeSyncStatus(fn) {
  _syncSubs.add(fn);
  try { fn(_syncStatus); } catch (_) {}
  return () => _syncSubs.delete(fn);
}

export function _setSyncStatus(next) {
  if (!SYNC_STATES.includes(next) || next === _syncStatus) return;
  _syncStatus = next;
  _syncSubs.forEach((fn) => { try { fn(next); } catch (_) {} });
}
```

Update the first `loadTournament` (lines 62–69) to prefer local cache, falling back to remote:

```js
export async function loadTournament() {
  const activeId = await AsyncStorage.getItem(ACTIVE_ID_KEY);
  if (!activeId) return null;

  const cached = await readLocal(activeId);
  if (cached) {
    // Kick remote refresh in background; do not block the UI.
    loadAllTournaments()
      .then((all) => {
        const remote = all.find((t) => t.id === activeId);
        if (remote) saveLocal(remote).catch(() => {});
      })
      .catch(() => {});
    return cached;
  }

  const all = await loadAllTournaments();
  const remote = all.find((t) => t.id === activeId) ?? null;
  if (remote) await saveLocal(remote);
  return remote;
}
```

Remove the `_migrated` guard early-return from any path that is now offline-capable: keep `ensureMigrated` inside `loadAllTournaments` only (already the case).

- [ ] **Step 2: Boot the app and confirm no regression**

Run:
```bash
npx expo start --web
```

Open the app, open an existing tournament, edit a score. Confirm it saves as before (Supabase row updates). Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "Split saveTournament into local+remote and add syncStatus observable"
```

---

## Task 6: `mutate.js` — single entry for all writes

**Files:**
- Create: `src/store/mutate.js`

- [ ] **Step 1: Implement the mutation dispatcher**

Create `src/store/mutate.js`:

```js
import { syncQueue } from './syncQueue';
import { saveLocal, _setSyncStatus } from './tournamentStore';
import { setAtPath } from './merge';
import { isOnline } from '../lib/connectivity';

// Maps a mutation to the in-tournament `_meta` path it bumps.
// Returns null for library-only mutations (which do not touch the tournament blob).
function metaPathFor(m) {
  switch (m.type) {
    case 'score.set':    return `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`;
    case 'note.set':
      return m.scope === 'hole'
        ? `rounds.${m.roundId}.notes.hole.${m.hole}`
        : `rounds.${m.roundId}.notes.round`;
    case 'pairs.set':    return `rounds.${m.roundId}.pairs`;
    case 'handicap.set': return `playerHandicaps.${m.playerId}`;
    // Players array LWW's as a single unit. Two concurrent offline adds
    // from different devices → last sync wins; this edge case is out of v1
    // scope per the spec's conflict section.
    case 'tournament.addPlayer': return `players`;
    case 'player.upsertLibrary': return null;
    default: throw new Error(`unknown mutation type: ${m.type}`);
  }
}

// Applies the mutation's side effect to a cloned tournament object in place.
function applyToTournament(t, m) {
  switch (m.type) {
    case 'score.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      if (m.value == null) delete round.scores[m.playerId][m.hole];
      else round.scores[m.playerId][m.hole] = m.value;
      break;
    }
    case 'note.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      if (m.scope === 'hole') {
        round.notes = { ...(round.notes ?? {}) };
        round.notes.hole = { ...(round.notes.hole ?? {}) };
        round.notes.hole[m.hole] = m.text;
      } else {
        round.notes = { ...(round.notes ?? {}), round: m.text };
      }
      break;
    }
    case 'pairs.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.pairs = m.pairs;
      break;
    }
    case 'handicap.set': {
      t.playerHandicaps = { ...(t.playerHandicaps ?? {}), [m.playerId]: m.handicap };
      break;
    }
    case 'tournament.addPlayer': {
      t.players = [...(t.players ?? []), m.player];
      break;
    }
    default:
      break; // library-only mutations don't change the tournament object
  }
}

export async function mutate(tournamentBefore, mutation) {
  const ts = mutation.ts ?? Date.now();
  const m = { ...mutation, ts };

  // Library-only mutations do not touch any tournament blob — just enqueue.
  if (m.type === 'player.upsertLibrary') {
    await syncQueue.enqueue({ tournamentId: null, mutation: m, path: null });
    const { scheduleSync } = require('./syncWorker');
    if (isOnline()) scheduleSync();
    else _setSyncStatus('pending');
    return tournamentBefore;
  }

  // 1. Clone + apply + bump _meta
  const t = JSON.parse(JSON.stringify(tournamentBefore));
  applyToTournament(t, m);
  const path = metaPathFor(m);
  if (path) {
    t._meta = { ...(t._meta ?? {}), [path]: ts };
  }

  // 2. Persist local (UI source of truth)
  await saveLocal(t);

  // 3. Enqueue for sync
  await syncQueue.enqueue({ tournamentId: t.id, mutation: m, path });

  // 4. Kick worker (lazy require to break circular import)
  const { scheduleSync } = require('./syncWorker');
  if (isOnline()) scheduleSync();
  else _setSyncStatus('pending');

  return t;
}
```

- [ ] **Step 2: Verify module imports resolve**

Run:
```bash
node --check src/store/mutate.js
```

Expected: exits 0 (syntax is valid).

- [ ] **Step 3: Commit**

```bash
git add src/store/mutate.js
git commit -m "Add mutate() entry point for offline-safe writes"
```

---

## Task 7: `syncWorker.js` — drain queue, merge, upsert

**Files:**
- Create: `src/store/syncWorker.js`

- [ ] **Step 1: Implement the worker**

Create `src/store/syncWorker.js`:

```js
import { supabase } from '../lib/supabase';
import { syncQueue } from './syncQueue';
import { mergeTournaments } from './merge';
import { saveLocal, pushRemote, readLocal, _setSyncStatus } from './tournamentStore';
import { upsertPlayer } from './libraryStore';
import { isOnline, subscribeConnectivity } from '../lib/connectivity';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
let _attempt = 0;
let _timer = null;
let _running = false;

async function fetchRemote(tournamentId) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('data')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

async function drainLibrary(libraryMuts) {
  // Library mutations (player.upsertLibrary) drain independently; no merge.
  for (const entry of libraryMuts) {
    const m = entry.mutation;
    if (m.type === 'player.upsertLibrary') {
      await upsertPlayer({ id: m.playerId, name: m.name, handicap: m.handicap });
      await syncQueue.drop(entry.id);
    }
  }
}

async function drainTournament(tournamentId, entries) {
  const local = await readLocal(tournamentId);
  if (!local) {
    // Nothing to push — drop the stale entries.
    for (const e of entries) await syncQueue.drop(e.id);
    return;
  }
  const remote = await fetchRemote(tournamentId);
  const merged = mergeTournaments(local, remote);

  await saveLocal(merged);
  await pushRemote(merged);

  for (const e of entries) {
    const pathTs = merged._meta?.[e.path] ?? 0;
    if (!e.path || (e.mutation.ts ?? 0) <= pathTs) {
      await syncQueue.drop(e.id);
    }
  }
}

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
  _setSyncStatus(remaining.length === 0 ? 'idle' : 'pending');
}

export function scheduleSync() {
  if (!isOnline()) { _setSyncStatus('pending'); return; }
  if (_running) return;
  if (_timer) { clearTimeout(_timer); _timer = null; }

  _running = true;
  drainOnce()
    .then(() => { _attempt = 0; })
    .catch(() => {
      _setSyncStatus('error');
      const delay = BACKOFF_MS[Math.min(_attempt, BACKOFF_MS.length - 1)];
      _attempt++;
      _timer = setTimeout(() => { _timer = null; scheduleSync(); }, delay);
    })
    .finally(() => { _running = false; });
}

export function retrySync() {
  _attempt = 0;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  scheduleSync();
}

// Auto-trigger on connectivity regain.
subscribeConnectivity((online) => {
  if (online) retrySync();
  else _setSyncStatus('pending');
});
```

- [ ] **Step 2: Verify syntax**

Run:
```bash
node --check src/store/syncWorker.js
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/store/syncWorker.js
git commit -m "Add sync worker with backoff and LWW merge"
```

---

## Task 8: Route score + notes edits through `mutate()`

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Replace `autoSave` and `saveNotes`**

In `src/screens/ScorecardScreen.js`:

Replace the import line at the top that imports from `../store/tournamentStore` to also import `mutate`:

```js
import { mutate } from '../store/mutate';
```

Replace the `autoSave` callback (`src/screens/ScorecardScreen.js:131-151`) with:

```js
const autoSave = useCallback((newScores) => {
  // Compute the diff between the previously-synced scores and newScores,
  // emitting one score.set mutation per changed cell. This naturally coalesces
  // rapid keystrokes because `scores` state is already debounced upstream.
  if (!tournamentRef.current) return;
  const round = tournamentRef.current.rounds[roundIndex];
  const prevScores = round.scores ?? {};

  const changedCells = [];
  const playerIds = new Set([...Object.keys(prevScores), ...Object.keys(newScores)]);
  for (const pid of playerIds) {
    const prevByHole = prevScores[pid] ?? {};
    const nextByHole = newScores[pid] ?? {};
    const holes = new Set([...Object.keys(prevByHole), ...Object.keys(nextByHole)]);
    for (const h of holes) {
      const before = prevByHole[h];
      const after = nextByHole[h];
      if (before !== after) changedCells.push({ playerId: pid, hole: Number(h), value: after ?? null });
    }
  }
  if (changedCells.length === 0) return;

  pendingSaveRef.current = true;
  (async () => {
    let t = tournamentRef.current;
    for (const cell of changedCells) {
      t = await mutate(t, {
        type: 'score.set',
        roundId: round.id,
        playerId: cell.playerId,
        hole: cell.hole,
        value: cell.value,
      });
    }
    tournamentRef.current = t;
    if (!saveTimeoutRef.current && !notesSaveTimeoutRef.current) {
      pendingSaveRef.current = false;
    }
  })();
}, [roundIndex]);
```

Replace the `saveNotes` callback (`src/screens/ScorecardScreen.js:153-174`) with:

```js
const saveNotes = useCallback((value) => {
  setNotes(value);
  if (notesSaveTimeoutRef.current) clearTimeout(notesSaveTimeoutRef.current);
  pendingSaveRef.current = true;
  notesSaveTimeoutRef.current = setTimeout(async () => {
    notesSaveTimeoutRef.current = null;
    if (!tournamentRef.current) return;
    const round = tournamentRef.current.rounds[roundIndex];
    const t = await mutate(tournamentRef.current, {
      type: 'note.set',
      roundId: round.id,
      scope: 'round',
      text: value,
    });
    tournamentRef.current = t;
    if (!saveTimeoutRef.current && !notesSaveTimeoutRef.current) {
      pendingSaveRef.current = false;
    }
  }, 400);
}, [roundIndex]);
```

- [ ] **Step 2: Remove the now-unused `saveTournament` import**

Locate the import near `src/screens/ScorecardScreen.js:11` and remove `saveTournament` from the destructured list (keep `loadTournament`, `subscribeTournamentChanges`, and anything else).

- [ ] **Step 3: Manual verification**

Run:
```bash
npx expo start --web
```

1. Open an existing tournament, go to Scorecard.
2. Enter strokes for a few holes. Confirm they persist on refresh.
3. Open DevTools → Network → "Offline". Enter a new stroke. Navigate away and back. Confirm the value is still there.
4. Uncheck "Offline". Wait ~3 seconds. Confirm the Supabase row updated (check via another device or via `select data from tournaments` in the Supabase dashboard).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "Route scorecard edits and notes through mutate()"
```

---

## Task 9: Route pair changes through `mutate()`

**Files:**
- Modify: `src/screens/EditTeamsScreen.js`

- [ ] **Step 1: Locate the current save path**

Open `src/screens/EditTeamsScreen.js`. Find the save handler that currently does something like `saveTournament({ ...tournament, rounds: [...] })` where a round's `pairs` array is replaced. It's typically named `handleSave`, `onDone`, or similar and is wired to a "Confirmar" or "Guardar" button.

- [ ] **Step 2: Replace the save with a mutate call**

Where the save currently builds a new tournament object and calls `saveTournament(next)`, replace with:

```js
import { mutate } from '../store/mutate';
// ...
const next = await mutate(tournament, {
  type: 'pairs.set',
  roundId: round.id,
  pairs: newPairs,
});
// Use `next` in place of the previously-saved tournament.
```

Remove the now-unused `saveTournament` import if it is no longer referenced in this file.

- [ ] **Step 3: Manual verification**

Run:
```bash
npx expo start --web
```

1. Open a tournament, go to EditTeams for the current round.
2. Change the pairing, confirm.
3. Refresh — the new pairing must persist.
4. DevTools "Offline", change again, refresh — must still persist locally.
5. Back online, wait a few seconds, confirm Supabase row reflects the latest pairing.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/screens/EditTeamsScreen.js
git commit -m "Route pair edits through mutate()"
```

---

## Task 10: Route handicap edits through `mutate()`

**Files:**
- Modify: `src/screens/NextRoundScreen.js` (and any other screen that saves `playerHandicaps`)

- [ ] **Step 1: Locate the handicap save path**

Use Grep (or `rg`) for `playerHandicaps` across `src/screens/`:

```
Grep pattern=playerHandicaps, path=src/screens, output_mode=files_with_matches
```

For each screen that writes `playerHandicaps` and then calls `saveTournament`, replace with a per-player loop emitting `handicap.set` mutations:

```js
import { mutate } from '../store/mutate';
// ...
let t = tournament;
for (const [playerId, handicap] of Object.entries(nextHandicaps)) {
  if (tournament.playerHandicaps?.[playerId] === handicap) continue;
  t = await mutate(t, { type: 'handicap.set', playerId, handicap });
}
// Use `t` wherever the screen previously used the saved result.
```

- [ ] **Step 2: Manual verification**

Run:
```bash
npx expo start --web
```

1. Open a tournament, edit a player's playing handicap for the current round.
2. Confirm, refresh — persists.
3. Offline, change handicap, refresh — still there.
4. Back online, confirm Supabase row reflects the edit.

- [ ] **Step 3: Commit**

```bash
git add src/screens/
git commit -m "Route handicap edits through mutate()"
```

---

## Task 11: Add-player-to-library uses client UUID + mutate()

**Files:**
- Modify: `src/store/libraryStore.js`
- Modify: `src/screens/PlayersLibraryScreen.js` (and any screen that calls `upsertPlayer` with no `id`)

- [ ] **Step 1: Make `upsertPlayer` UUID-compatible**

In `src/store/libraryStore.js`, `upsertPlayer` (lines 11–17) already accepts an `id`. No code change required here — the call sites do.

- [ ] **Step 2: Emit a library mutation from PlayersLibraryScreen**

Open `src/screens/PlayersLibraryScreen.js`. Find the handler that creates a new player (typically `handleCreate`, `onSave`, or the form submit in the "new player" sheet).

Replace the direct `upsertPlayer({ name, handicap })` call with:

```js
import { v4 as uuidv4 } from 'uuid';
import { mutate } from '../store/mutate';
// ...

const playerId = uuidv4();
// Library mutations accept null as the tournament argument.
await mutate(null, {
  type: 'player.upsertLibrary',
  playerId,
  name,
  handicap,
});
// If this screen also adds the new player to the current tournament:
if (tournament) {
  await mutate(tournament, {
    type: 'tournament.addPlayer',
    playerId,
    player: { id: playerId, name, handicap },
  });
}
```

If the screen does not have access to the current tournament and is strictly library-only, the second `mutate` is skipped. The mutation queue accepts library-only entries (see `syncWorker.drainLibrary`).

- [ ] **Step 3: Manual verification**

Run:
```bash
npx expo start --web
```

1. Offline (DevTools Network "Offline"): create a new player in PlayersLibrary.
2. Navigate to the current tournament and add that player to it (if your UI supports this from library or from PlayerPicker).
3. Confirm the player shows in the list.
4. Back online: wait a few seconds, then verify the `players` table in Supabase contains the row with the client-generated UUID.

- [ ] **Step 4: Commit**

```bash
git add src/store/libraryStore.js src/screens/PlayersLibraryScreen.js
git commit -m "Generate client UUIDs for new library players"
```

---

## Task 12: `SyncStatusIcon` component

**Files:**
- Create: `src/components/SyncStatusIcon.js`

- [ ] **Step 1: Implement the component**

Create `src/components/SyncStatusIcon.js`:

```js
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { subscribeSyncStatus } from '../store/tournamentStore';
import { retrySync } from '../store/syncWorker';

const COLOR = {
  idle:    '#4a7c4a',
  syncing: '#c0a15c',
  pending: '#c77a0a',
  error:   '#b33a3a',
};

const LABEL = {
  idle: '',
  syncing: 'Sincronizando',
  pending: 'Pendiente',
  error: 'Reintentar',
};

export default function SyncStatusIcon() {
  const [status, setStatus] = useState('idle');
  useEffect(() => subscribeSyncStatus(setStatus), []);

  if (status === 'idle') {
    return (
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR.idle, marginHorizontal: 8 }} />
    );
  }

  const content = status === 'syncing'
    ? <ActivityIndicator size="small" color={COLOR.syncing} />
    : (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR[status], marginRight: 6 }} />
        <Text style={{ color: COLOR[status], fontSize: 12 }}>{LABEL[status]}</Text>
      </View>
    );

  if (status === 'error') {
    return <Pressable onPress={retrySync} style={{ paddingHorizontal: 8 }}>{content}</Pressable>;
  }
  return <View style={{ paddingHorizontal: 8 }}>{content}</View>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SyncStatusIcon.js
git commit -m "Add SyncStatusIcon component"
```

---

## Task 13: Mount `SyncStatusIcon` in the header

**Files:**
- Modify: `App.js`

- [ ] **Step 1: Add the icon to the shared screen options**

In `App.js`, locate the `Stack.Navigator` / `createStackNavigator` options or the top-level header container (the file uses a shared header region set by `screenOptions`).

Import the component:

```js
import SyncStatusIcon from './src/components/SyncStatusIcon';
```

Add `headerRight: () => <SyncStatusIcon />` to the navigator's `screenOptions`. If the app renders its own custom header (not React Navigation's), mount `<SyncStatusIcon />` inside that component instead.

- [ ] **Step 2: Manual verification**

Run:
```bash
npx expo start --web
```

1. Confirm a small green dot is visible in the header.
2. DevTools Network "Offline" → dot becomes amber with "Pendiente".
3. Edit a score → briefly shows the syncing spinner when you go back online.
4. Leave one stroke pending while offline → status is "Pendiente" until reconnect, then returns to green.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add App.js
git commit -m "Mount SyncStatusIcon in the header"
```

---

## Task 14: End-to-end offline verification matrix

**Files:** none (verification only)

- [ ] **Step 1: Boot the app**

```bash
npx expo start --web
```

- [ ] **Step 2: Run through each acceptance case**

Go offline (DevTools Network "Offline") and confirm each case persists across a page refresh while offline; then go online and confirm the Supabase row reflects the edit.

| Case | Action | Expected |
|---|---|---|
| Scores | Enter strokes for 3 players, 5 holes | All persist offline; sync on reconnect; Supabase `data.rounds[i].scores` matches |
| Round notes | Type notes in the round-note field | Persists offline; syncs on reconnect |
| Pairs | Change pairing via EditTeams | Persists offline; syncs |
| Handicap | Edit a player's handicap for current round | Persists offline; syncs |
| New library player | Add a player offline; add to tournament | Both persist offline; library row and tournament both sync |
| Mixed concurrent | Device A scores hole 1 offline; device B scores hole 2 online; bring A online | Both holes present after A syncs |
| Same-cell conflict | Device A scores hole 5 = 4 offline; device B scores hole 5 = 5 online a few seconds later; A goes online | Hole 5 = 5 (the later `ts` wins) |
| Error surface | Break Supabase URL env var temporarily and edit | Sync icon turns red; tapping it retries; fixing the URL resolves the next drain |

- [ ] **Step 3: Fix anything that doesn't pass**

Any failure indicates a defect in Tasks 2–13. Fix and recommit against the relevant task's file(s). Do not expand scope.

- [ ] **Step 4: Final commit (if nothing else to change)**

```bash
git commit --allow-empty -m "Offline mode end-to-end verification passed"
```
