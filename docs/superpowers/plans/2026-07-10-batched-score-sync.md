# Batched Score Sync + Finish-Time Conflict Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score edits stay local until the user changes hole / finishes / backgrounds the app; a score the user wrote never silently changes; all conflicts are resolved in one summary sheet at finish time.

**Architecture:** Three layers change. (1) `mutate()` gains a `deferSync` option so score saves enqueue without kicking the network worker; `syncWorker` gains an awaitable `syncNow()`. (2) `mergeTournaments()` gets dedicated always-mine semantics for score-cell paths plus per-cell resolution stamps that let an explicit resolution override either side. (3) `ScorecardScreen` defers score pushes, flushes on hole change/unmount/background, and replaces the finish-time blocking alert with a conflict summary sheet.

**Tech Stack:** React Native (Expo SDK 54) + plain JS stores, Jest (jest-expo), @testing-library/react-native for component tests.

**Spec:** `docs/superpowers/specs/2026-07-10-batched-score-sync-design.md`

## Global Constraints

- Plain JavaScript — no TypeScript annotations anywhere.
- `npm run lint` (ESLint 9 flat config) must pass — CI-blocking.
- `npm test` (~330 tests) must stay green after every task.
- No new npm dependencies.
- Domain logic lives in `src/store/`, not screens (CLAUDE.md).
- Casual rounds only — do not touch `useOfficialRound` or any `official*` module.
- Work on branch `feature/batched-score-sync` in an isolated worktree (superpowers:using-git-worktrees).
- Data-shape invariants: score cells live at blob path `rounds.<roundId>.scores.<playerId>.h<hole>` (`_meta` key) but in data as `round.scores[playerId][hole]` (numeric key — `resolveKey` in merge.js strips the `h`). Conflict markers: `round.scoreConflicts[playerId][hole] = { candidates: [{value, ts}, ...], detectedAt }`. New resolution stamps: `round.scoreResolutions[playerId][hole] = <ts number>`.

---

### Task 1: Awaitable `syncNow()` + `deferSync` mutate option

**Files:**
- Modify: `src/store/syncWorker.js:141-162` (scheduleSync / retrySync)
- Modify: `src/store/mutate.js:255-302` (mutate signature + kick)
- Test: `src/store/__tests__/mutateDeferSync.test.js` (create)
- Test: `src/store/__tests__/syncWorker.test.js` (extend)

**Interfaces:**
- Consumes: existing `drainOnce`, `isOnline`, `_markPendingOrIdle`, `_setSyncStatus` internals of syncWorker; existing `mutate(tournamentBefore, mutation)`.
- Produces: `syncNow(): Promise<void>` exported from `src/store/syncWorker.js` — awaitable drain; returns the in-flight drain's promise if one is already running. `mutate(tournamentBefore, mutation, opts = {})` — `opts.deferSync === true` skips the sync kick (still saves locally + enqueues) and sets sync status to `'pending'`. Tasks 4 and 5 rely on both.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/mutateDeferSync.test.js`:

```js
// jest.mock calls are hoisted above imports by babel-jest.
jest.mock('../syncWorker', () => ({ scheduleSync: jest.fn(), syncNow: jest.fn() }));
jest.mock('../tournamentStore', () => ({
  saveLocal: jest.fn(async () => {}),
  _setSyncStatus: jest.fn(),
}));
jest.mock('../syncQueue', () => ({ syncQueue: { enqueue: jest.fn(async () => {}) } }));
jest.mock('../../lib/connectivity', () => ({ isOnline: () => true }));

import { mutate } from '../mutate';
import { scheduleSync } from '../syncWorker';
import { syncQueue } from '../syncQueue';
import { saveLocal, _setSyncStatus } from '../tournamentStore';

const baseTournament = () => ({ id: 't1', rounds: [{ id: 'r1', scores: {} }] });
const scoreMutation = { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 5 };

beforeEach(() => jest.clearAllMocks());

describe('mutate deferSync option', () => {
  it('deferSync skips the sync kick but still saves locally and enqueues', async () => {
    const t = await mutate(baseTournament(), scoreMutation, { deferSync: true });
    expect(saveLocal).toHaveBeenCalledTimes(1);
    expect(syncQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(scheduleSync).not.toHaveBeenCalled();
    expect(_setSyncStatus).toHaveBeenCalledWith('pending');
    expect(t.rounds[0].scores.p1[3]).toBe(5);
  });

  it('default (no opts) still kicks sync immediately', async () => {
    await mutate(baseTournament(), scoreMutation);
    expect(scheduleSync).toHaveBeenCalledTimes(1);
  });

  it('deferSync still stamps _meta for the score cell', async () => {
    const t = await mutate(baseTournament(), scoreMutation, { deferSync: true });
    expect(t._meta['rounds.r1.scores.p1.h3']).toEqual(expect.any(Number));
  });
});
```

Add to `src/store/__tests__/syncWorker.test.js` (reuse the file's existing mock preamble — supabase, tournamentStore, syncQueue, libraryStore, connectivity are already mocked at the top; follow its existing test style):

```js
describe('syncNow', () => {
  it('returns a promise that resolves after the drain completes', async () => {
    const { syncNow } = require('../syncWorker');
    // With the queue mock empty, drainOnce sets status idle and resolves.
    await expect(syncNow()).resolves.toBeUndefined();
  });

  it('a second call while a drain is running returns the same in-flight promise', async () => {
    const { syncNow } = require('../syncWorker');
    const p1 = syncNow();
    const p2 = syncNow();
    expect(p2).toBe(p1);
    await p1;
  });
});
```

Note: the existing syncWorker.test.js may reset modules between tests (`jest.resetModules()` / `require` pattern) — match whatever pattern the file already uses for importing the worker. If `isOnline` is mocked to return `false` by default in that file, override it to `true` for these tests the same way other tests there do.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/mutateDeferSync.test.js src/store/__tests__/syncWorker.test.js`
Expected: mutateDeferSync FAILS (scheduleSync called despite deferSync — third arg ignored); syncNow tests FAIL (`syncNow is not a function`).

- [ ] **Step 3: Implement `syncNow` in syncWorker.js**

Replace `scheduleSync` (`src/store/syncWorker.js:141-156`) with:

```js
let _currentDrain = null;

// Awaitable drain. Resolves when the current pass finishes (or immediately
// when offline). A call while a drain is in flight returns that drain's
// promise rather than starting a second pass.
export function syncNow() {
  if (!isOnline()) { _markPendingOrIdle(); return Promise.resolve(); }
  if (_running) return _currentDrain ?? Promise.resolve();
  if (_timer) { clearTimeout(_timer); _timer = null; }

  _running = true;
  _currentDrain = drainOnce()
    .then(() => { _attempt = 0; })
    .catch(() => {
      _setSyncStatus('error');
      const delay = BACKOFF_MS[Math.min(_attempt, BACKOFF_MS.length - 1)];
      _attempt++;
      _timer = setTimeout(() => { _timer = null; scheduleSync(); }, delay);
    })
    .finally(() => { _running = false; _currentDrain = null; });
  return _currentDrain;
}

export function scheduleSync() { syncNow(); }
```

(`retrySync` at :158-162 stays as-is — it already delegates to `scheduleSync`.)

- [ ] **Step 4: Implement `deferSync` in mutate.js**

Change the signature at `src/store/mutate.js:255` and the kick at :296-299:

```js
export async function mutate(tournamentBefore, mutation, opts = {}) {
```

```js
  // 4. Kick worker (lazy require to break circular import). Score entry
  // passes deferSync so taps batch locally; the scorecard flushes the queue
  // on hole change / finish / background instead.
  if (opts.deferSync) {
    _setSyncStatus('pending');
  } else {
    const { scheduleSync } = require('./syncWorker');
    if (isOnline()) scheduleSync();
    else _setSyncStatus('pending');
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/mutateDeferSync.test.js src/store/__tests__/syncWorker.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test` — expected: all green.

```bash
git add src/store/syncWorker.js src/store/mutate.js src/store/__tests__/mutateDeferSync.test.js src/store/__tests__/syncWorker.test.js
git commit -m "feat(sync): awaitable syncNow and deferSync mutate option"
```

---

### Task 2: Resolution stamps on `conflict.resolve`

**Files:**
- Modify: `src/store/mutate.js:81-84` (metaPathFor), `:102-114` (applyToTournament conflict.resolve), `:45-57` (tournament.removePlayer paths + apply at :190-218)
- Test: `src/store/__tests__/conflictResolve.test.js` (create)

**Interfaces:**
- Consumes: existing `conflict.resolve` mutation shape `{ type, roundId, playerId, hole, value }`; `mutate` stamps `m.ts` before `applyToTournament` runs.
- Produces: `round.scoreResolutions[playerId][hole] = <ts>` written on every resolve, with `_meta['rounds.<rid>.scoreResolutions.<pid>.h<hole>']` stamped. `conflict.resolve` with `value: null` deletes the score key (parity with `score.set`). Task 3's merge relies on the `scoreResolutions` path name exactly as written here.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/conflictResolve.test.js`:

```js
jest.mock('../syncWorker', () => ({ scheduleSync: jest.fn(), syncNow: jest.fn() }));
jest.mock('../tournamentStore', () => ({
  saveLocal: jest.fn(async () => {}),
  _setSyncStatus: jest.fn(),
}));
jest.mock('../syncQueue', () => ({ syncQueue: { enqueue: jest.fn(async () => {}) } }));
jest.mock('../../lib/connectivity', () => ({ isOnline: () => true }));

import { mutate, metaPathFor, applyToTournament } from '../mutate';

const baseTournament = () => ({
  id: 't1',
  rounds: [{
    id: 'r1',
    scores: { p1: { 3: 5 } },
    scoreConflicts: { p1: { 3: { candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 90 }], detectedAt: 110 } } },
  }],
});

describe('conflict.resolve', () => {
  it('stamps a scoreResolutions path alongside score and marker paths', () => {
    const paths = metaPathFor({ type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3 });
    expect(paths).toEqual([
      'rounds.r1.scores.p1.h3',
      'rounds.r1.scoreConflicts.p1.h3',
      'rounds.r1.scoreResolutions.p1.h3',
    ]);
  });

  it('records the resolution timestamp in the blob', async () => {
    const t = await mutate(baseTournament(), {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3, value: 6, ts: 500,
    });
    expect(t.rounds[0].scores.p1[3]).toBe(6);
    expect(t.rounds[0].scoreConflicts.p1[3]).toBeUndefined();
    expect(t.rounds[0].scoreResolutions.p1[3]).toBe(500);
    expect(t._meta['rounds.r1.scoreResolutions.p1.h3']).toBe(500);
  });

  it('resolving to null deletes the score key', async () => {
    const t = await mutate(baseTournament(), {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3, value: null, ts: 500,
    });
    expect(Object.prototype.hasOwnProperty.call(t.rounds[0].scores.p1, '3')).toBe(false);
  });

  it('removePlayer clears the player scoreResolutions path', () => {
    const paths = metaPathFor({
      type: 'tournament.removePlayer', playerId: 'p1',
      roundPatches: [{ roundId: 'r1' }],
    });
    expect(paths).toContain('rounds.r1.scoreResolutions.p1');
    const t = baseTournament();
    t.rounds[0].scoreResolutions = { p1: { 3: 500 } };
    applyToTournament(t, { type: 'tournament.removePlayer', playerId: 'p1', roundPatches: [{ roundId: 'r1' }] });
    expect(t.rounds[0].scoreResolutions.p1).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/conflictResolve.test.js`
Expected: FAIL — metaPathFor returns 2 paths, no `scoreResolutions` written, null resolve sets the key instead of deleting.

- [ ] **Step 3: Implement**

`metaPathFor` case (`mutate.js:81-84`):

```js
    // Resolving a score conflict writes the chosen value, clears the marker,
    // AND stamps a resolution marker that outranks raw writes during merge.
    case 'conflict.resolve': return [
      `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`,
      `rounds.${m.roundId}.scoreConflicts.${m.playerId}.h${m.hole}`,
      `rounds.${m.roundId}.scoreResolutions.${m.playerId}.h${m.hole}`,
    ];
```

`applyToTournament` case (`mutate.js:102-114`):

```js
    case 'conflict.resolve': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      if (m.value == null) delete round.scores[m.playerId][m.hole];
      else round.scores[m.playerId][m.hole] = m.value;
      if (round.scoreConflicts?.[m.playerId]) {
        round.scoreConflicts = { ...round.scoreConflicts };
        round.scoreConflicts[m.playerId] = { ...round.scoreConflicts[m.playerId] };
        delete round.scoreConflicts[m.playerId][m.hole];
      }
      // Resolution stamp: mergeTournaments treats a resolution at/after a raw
      // write as authoritative for that cell on every device.
      round.scoreResolutions = { ...(round.scoreResolutions ?? {}) };
      round.scoreResolutions[m.playerId] = {
        ...(round.scoreResolutions[m.playerId] ?? {}),
        [m.hole]: m.ts,
      };
      break;
    }
```

`tournament.removePlayer`: in `metaPathFor` (`:45-57`) add `paths.push(`rounds.${patch.roundId}.scoreResolutions.${m.playerId}`);` next to the existing `scoreConflicts` push. In `applyToTournament` (`:190-218`) add, mirroring the scoreConflicts block:

```js
        if (round.scoreResolutions) {
          const scoreResolutions = { ...round.scoreResolutions };
          delete scoreResolutions[m.playerId];
          round.scoreResolutions = scoreResolutions;
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/conflictResolve.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm test` — all green (existing merge tests are untouched by this task).

```bash
git add src/store/mutate.js src/store/__tests__/conflictResolve.test.js
git commit -m "feat(sync): resolution stamps and null-safe apply for conflict.resolve"
```

---

### Task 3: Always-mine merge semantics for score cells

**Files:**
- Modify: `src/store/merge.js:84-154` (generic loop skip + rewritten score pass)
- Test: `src/store/__tests__/merge.test.js` (extend)

**Interfaces:**
- Consumes: `round.scoreResolutions[pid][hole]` stamps from Task 2; existing `getAtPath`/`setAtPath`/`resolveKey` helpers; existing marker shape.
- Produces: new merge behavior relied on by everything downstream:
  1. A score cell the local device wrote keeps its local value regardless of timestamps.
  2. Both-wrote-different-values ⇒ marker `{ candidates: [{value: mine, ts}, {value: theirs, ts}], detectedAt }` (mine first). Null counts as a value if the side's `_meta` stamp exists.
  3. A resolution stamp at/after the other side's raw write makes the resolved value win everywhere and clears markers.
  4. Score-cell paths no longer emit generic `conflicts` array entries (the sync-sheet "overwritten" list) — markers replace them.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/merge.test.js`:

```js
describe('mergeTournaments — always-mine score cells', () => {
  const cell = 'rounds.r1.scores.p1.h3';
  const marker = 'rounds.r1.scoreConflicts.p1.h3';
  const resolution = 'rounds.r1.scoreResolutions.p1.h3';
  const t = ({ score, meta, conflicts, resolutions }) => ({
    id: 't1',
    rounds: [{
      id: 'r1',
      scores: score === undefined ? {} : { p1: { 3: score } },
      ...(conflicts ? { scoreConflicts: conflicts } : {}),
      ...(resolutions ? { scoreResolutions: resolutions } : {}),
    }],
    _meta: meta ?? {},
  });

  it('keeps the LOCAL value even when remote ts is higher (clock skew)', () => {
    const local = t({ score: 5, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(5);
  });

  it('creates a marker with mine first when both wrote different values', () => {
    const local = t({ score: 5, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    const m = merged.rounds[0].scoreConflicts.p1[3];
    expect(m.candidates[0]).toMatchObject({ value: 5, ts: 100 });
    expect(m.candidates[1]).toMatchObject({ value: 6, ts: 900 });
  });

  it('does not emit a generic conflicts entry for a score cell', () => {
    const local = t({ score: 5, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    expect(mergeTournaments(local, remote).conflicts).toHaveLength(0);
  });

  it('equal values clear a stale marker instead of flagging', () => {
    const local = t({
      score: 5, meta: { [cell]: 100, [marker]: 90 },
      conflicts: { p1: { 3: { candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 80 }], detectedAt: 90 } } },
    });
    const remote = t({ score: 5, meta: { [cell]: 200 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('a cell local never wrote takes the remote value with no marker', () => {
    const local = t({ score: undefined, meta: {} });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('null-vs-value counts as a conflict when both stamped the cell', () => {
    // Local explicitly cleared the cell (stamped, value deleted); remote wrote 6.
    const local = t({ score: undefined, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores?.p1?.[3] ?? null).toBeNull();
    const m = merged.rounds[0].scoreConflicts.p1[3];
    expect(m.candidates[0]).toMatchObject({ value: null, ts: 100 });
    expect(m.candidates[1]).toMatchObject({ value: 6, ts: 900 });
  });

  it('a remote resolution at/after my write wins and clears my marker', () => {
    const local = t({
      score: 5, meta: { [cell]: 100, [marker]: 110 },
      conflicts: { p1: { 3: { candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 90 }], detectedAt: 110 } } },
    });
    const remote = t({
      score: 6, meta: { [cell]: 500, [resolution]: 500 },
      resolutions: { p1: { 3: 500 } },
    });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('my own resolution does not get re-flagged by their stale value', () => {
    const local = t({
      score: 6, meta: { [cell]: 500, [resolution]: 500 },
      resolutions: { p1: { 3: 500 } },
    });
    const remote = t({ score: 5, meta: { [cell]: 100 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('a raw write NEWER than the resolution re-enters always-mine flow', () => {
    // Remote resolved at 500; local deliberately edited again at 600.
    const local = t({ score: 4, meta: { [cell]: 600 } });
    const remote = t({
      score: 6, meta: { [cell]: 500, [resolution]: 500 },
      resolutions: { p1: { 3: 500 } },
    });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(4);
    const m = merged.rounds[0].scoreConflicts.p1[3];
    expect(m.candidates[0]).toMatchObject({ value: 4, ts: 600 });
  });
});
```

Also check the EXISTING score-conflict tests in merge.test.js: any test asserting "remote newer ⇒ remote value displayed" for a score cell now contradicts always-mine. Update those expectations to the new semantics (local value kept + marker created) — do not delete coverage, re-point it.

- [ ] **Step 2: Run to verify failures**

Run: `npx jest src/store/__tests__/merge.test.js`
Expected: new tests FAIL (remote value wins on higher ts today); some existing score-conflict tests may fail after re-pointing — that's the red state.

- [ ] **Step 3: Implement the merge rewrite**

In `src/store/merge.js`:

a) Hoist the regex above the generic loop (it currently sits at :119):

```js
  const SCORE_PATH = /^rounds\.([^.]+)\.scores\.([^.]+)\.h(\d+)$/;
```

b) In the generic LWW loop (:84-109): skip score cells entirely, and exclude `scoreResolutions` from generic conflict entries:

```js
  for (const path of paths) {
    if (path === 'meId') continue;
    // Score cells have dedicated always-mine semantics (pass below) — the
    // generic LWW loop must not touch them or log them as overwrites.
    if (SCORE_PATH.test(path)) continue;
    const lTs = localMeta[path] ?? 0;
    const rTs = mergedMeta[path] ?? 0;
    const bothHadTs = localMeta[path] != null && mergedMeta[path] != null;

    if (lTs >= rTs) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
    } else if (
      bothHadTs
      && !path.includes('.scoreConflicts.')
      && !path.includes('.scoreResolutions.')
    ) {
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
```

c) Replace the whole "Score conflict markers" pass (:111-154) with:

```js
  // ── Score cells: always-mine + explicit resolution ─────────────────────────
  // A score cell this device wrote NEVER silently changes: the local value is
  // kept regardless of timestamps (device clocks skew). If the other side wrote
  // a different value, it is recorded as a conflict marker candidate instead of
  // replacing the display. The only thing that outranks a raw write is an
  // explicit resolution (conflict.resolve stamps round.scoreResolutions) at or
  // after that write. Runs after the generic loop so markers/resolutions have
  // already LWW-settled into `merged`.
  const originalRemoteMeta = remote._meta ?? {};
  for (const path of paths) {
    const sm = path.match(SCORE_PATH);
    if (!sm) continue;
    const [, rid, pid, holeStr] = sm;
    const lTs = localMeta[path] ?? 0;
    const rTs = originalRemoteMeta[path] ?? 0;
    const localWrote = localMeta[path] != null;
    const remoteWrote = originalRemoteMeta[path] != null;
    const lVal = getAtPath(local, path) ?? null;
    const rVal = getAtPath(remote, path) ?? null;
    const cPath = `rounds.${rid}.scoreConflicts.${pid}.h${holeStr}`;
    const resPath = `rounds.${rid}.scoreResolutions.${pid}.h${holeStr}`;
    const lRes = getAtPath(local, resPath) ?? 0;
    const rRes = getAtPath(remote, resPath) ?? 0;

    // 1. Remote carries a resolution at/after my raw write (and at/after any
    //    resolution of mine): the resolved value is authoritative.
    if (remoteWrote && rRes > 0 && rRes >= lTs && rRes >= lRes) {
      mergedMeta[path] = rTs; // merged is a clone of remote — value already there
      if (getAtPath(merged, cPath) != null) {
        setAtPath(merged, cPath, null);
        mergedMeta[cPath] = Math.max(mergedMeta[cPath] ?? 0, rRes);
      }
      continue;
    }

    // 2. I wrote this cell → my value stays, whatever the timestamps say.
    if (localWrote) {
      setAtPath(merged, path, getAtPath(local, path));
      mergedMeta[path] = lTs;
      const bothDiffer = remoteWrote && lVal !== rVal;
      const cMeta = mergedMeta[cPath] ?? 0;
      // My resolution at/after their write means their value is already
      // settled history, not a new conflict. Likewise a marker-clear stamped
      // at/after their write.
      const resolvedPastTheirs = lRes > 0 && lRes >= rTs;
      const clearCoversTheirs = cMeta >= rTs && getAtPath(merged, cPath) == null;
      if (bothDiffer && !resolvedPastTheirs && !clearCoversTheirs) {
        const existing = getAtPath(merged, cPath);
        const markerDetectedAt = existing?.detectedAt ?? Date.now();
        setAtPath(merged, cPath, {
          candidates: [
            { value: lVal, ts: lTs },
            { value: rVal, ts: rTs },
          ],
          detectedAt: markerDetectedAt,
        });
        mergedMeta[cPath] = Math.max(cMeta, markerDetectedAt);
      } else if (!bothDiffer && getAtPath(merged, cPath) != null) {
        // Values agree (or theirs vanished): the dispute is over.
        setAtPath(merged, cPath, null);
        mergedMeta[cPath] = Date.now();
      }
      continue;
    }

    // 3. I never wrote it → remote's value (already in merged) stands.
  }
```

Also update the function's doc comment (:66-72) to describe the score-cell exception.

Note on `null` values: `applyToTournament` deletes the key on `value: null`, so `getAtPath` returns `undefined` — normalized to `null` for comparison/candidates. Writing the local value back uses the raw `getAtPath(local, path)` so a deleted key writes `undefined`, matching listRoundConflicts' value-not-key-presence contract.

- [ ] **Step 4: Run merge tests**

Run: `npx jest src/store/__tests__/merge.test.js`
Expected: PASS, including re-pointed legacy tests.

- [ ] **Step 5: Full suite + commit**

Run: `npm test`. Watch for fallout in `syncWorker.test.js` / any store test that asserted remote-wins on score cells; re-point them to always-mine the same way.

```bash
git add src/store/merge.js src/store/__tests__/merge.test.js
git commit -m "feat(merge): always-mine score cells with resolution stamps"
```

---

### Task 4: Scorecard defers pushes and flushes on hole change / unmount / background

**Files:**
- Modify: `src/screens/ScorecardScreen.js` — `autoSave` (:497-538), new flush wiring near the hole-navigation callbacks (:1072-1092), imports.
- Test: `src/screens/__tests__/ScorecardScreen.flush.test.js` (create)

**Interfaces:**
- Consumes: `mutate(t, m, { deferSync: true })` (Task 1), `syncNow` from `src/store/syncWorker`.
- Produces: score taps no longer kick the network; `syncNow()` fires on hole change, unmount, and app background. Task 5 adds the finish-time flush.

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/ScorecardScreen.flush.test.js`. Copy the mock preamble (navigation, stores, theme, media, notifications mocks) from the existing `src/screens/__tests__/ScorecardScreen.roundDecision.test.js` — it already renders the screen with a casual tournament fixture. Add on top:

```js
jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(),
  syncNow: jest.fn(() => Promise.resolve()),
  retrySync: jest.fn(),
}));
```

and spy on `mutate`:

```js
jest.mock('../../store/mutate', () => {
  const actual = jest.requireActual('../../store/mutate');
  return { ...actual, mutate: jest.fn(actual.mutate) };
});
```

Test cases (use the same render/fixture helpers as the roundDecision test; adapt selectors to what that file uses for the +/- steppers and next-hole button):

```js
it('a score tap saves with deferSync and does not kick syncNow', async () => {
  // render screen, tap the "+" stepper for a player once, flush microtasks
  expect(mutate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'score.set' }),
    expect.objectContaining({ deferSync: true }),
  );
  expect(syncNow).not.toHaveBeenCalled();
});

it('navigating to the next hole kicks syncNow', async () => {
  // render, tap "+", then press the next-hole control
  expect(syncNow).toHaveBeenCalled();
});

it('unmounting the screen kicks syncNow', async () => {
  // render, then unmount()
  expect(syncNow).toHaveBeenCalled();
});
```

Note: the mount-time flush effect (Step 3c) may fire `syncNow` on initial render. For the first test, assert instead that no ADDITIONAL syncNow call happens after the tap: capture `syncNow.mock.calls.length` after render settles, tap, and assert the count is unchanged.

If the roundDecision fixture makes stepper taps awkward to target, testing the hole-change + unmount flushes alone is acceptable screen coverage — the deferSync argument is then asserted at the store level (Task 1). Prefer full coverage; degrade only if the fixture genuinely can't reach the stepper.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/screens/__tests__/ScorecardScreen.flush.test.js`
Expected: FAIL — mutate called without a third argument; syncNow never called on navigation.

- [ ] **Step 3: Implement**

In `src/screens/ScorecardScreen.js`:

a) Imports: add `import { syncNow } from '../store/syncWorker';` (check for an existing syncWorker import first and extend it if present). Add `AppState` to the `react-native` import list.

b) `autoSave` (:525-531): pass the option —

```js
        t = await mutate(t, {
          type: 'score.set',
          roundId: round.id,
          playerId: cell.playerId,
          hole: cell.hole,
          value: cell.value,
        }, { deferSync: true });
```

(Only `score.set` defers. `note.set`, `shot.set`, `conflict.resolve`, `tournament.setFinished` keep their immediate kick.)

c) Flush wiring — add right after `goToHole` (:1089-1092):

```js
  // Batched score pushes: taps only enqueue (deferSync above); the queue is
  // drained when the user moves between holes, leaves the scorecard, or
  // backgrounds the app — never mid-entry on a hole.
  const flushScoreSync = useCallback(() => {
    if (official) return; // official rounds push via RPC per entry
    syncNow();
  }, [official]);

  useEffect(() => { flushScoreSync(); }, [currentHole, flushScoreSync]);
  useEffect(() => () => { flushScoreSync(); }, [flushScoreSync]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') flushScoreSync();
    });
    return () => sub.remove();
  }, [flushScoreSync]);
```

`currentHole` is the screen-owned state behind arrows, the hole picker, AND pager swipes, so one effect covers every navigation path. The mount-time firing is harmless (empty queue → status idle).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/screens/__tests__/ScorecardScreen.flush.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite, lint, commit**

Run: `npm test && npm run lint`

```bash
git add src/screens/ScorecardScreen.js src/screens/__tests__/ScorecardScreen.flush.test.js
git commit -m "feat(scorecard): defer score pushes to hole change / unmount / background"
```

---

### Task 5: Finish-time conflict summary sheet

**Files:**
- Create: `src/components/scorecard/FinishConflictSheet.js`
- Modify: `src/screens/ScorecardScreen.js` — `handleFinish` (:1127-1153 conflict gate), sheet JSX near the other sheets (around :1540-1560), state hooks near `conflictFocus` (:273-274).
- Modify: `src/components/ScoreConflictSheet.js:87-91` (null-value rendering)
- Test: `src/components/scorecard/__tests__/FinishConflictSheet.test.js` (create)

**Interfaces:**
- Consumes: `listRoundConflicts(round)` from `src/store/scoring.js` (returns `[{ playerId, hole }]` ascending); marker shape `{ candidates: [{value, ts}], detectedAt }`; existing `resolveConflict(playerId, hole, value)` screen callback (ScorecardScreen.js:610-631); `syncNow` (Task 1); `readLocal(tournamentId)` from `src/store/tournamentStore`; shared `BottomSheet` from `src/components/BottomSheet.js`.
- Produces: `FinishConflictSheet({ visible, onClose, rows, onPick, onFinish })` where `rows = [{ playerId, hole, playerName, currentValue, candidates }]`, `onPick(playerId, hole, value)` resolves one row, `onFinish()` is enabled only when `rows.length === 0`.

- [ ] **Step 1: Write the failing component test**

Create `src/components/scorecard/__tests__/FinishConflictSheet.test.js`:

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FinishConflictSheet from '../FinishConflictSheet';

const rows = [
  {
    playerId: 'p1', hole: 3, playerName: 'Marcos', currentValue: 5,
    candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 90 }],
  },
  {
    playerId: 'p2', hole: 7, playerName: 'Vielo', currentValue: null,
    candidates: [{ value: null, ts: 100 }, { value: 4, ts: 90 }],
  },
];

// BottomSheet and the sheet itself tolerate a missing ThemeProvider (see
// BottomSheet.js) — bare render is fine. If other tests in this directory
// wrap with a provider, mirror their wrapper instead.
const mount = (props = {}) => render(
  <FinishConflictSheet
    visible
    rows={rows}
    onPick={jest.fn()}
    onFinish={jest.fn()}
    onClose={jest.fn()}
    {...props}
  />,
);

it('lists every conflicted hole with player name and both candidates', () => {
  const { getByText } = mount();
  expect(getByText('Hole 3')).toBeTruthy();
  expect(getByText('Marcos')).toBeTruthy();
  expect(getByText('Hole 7')).toBeTruthy();
  expect(getByText('Vielo')).toBeTruthy();
});

it('renders a null candidate as "No score"', () => {
  const { getAllByText } = mount();
  expect(getAllByText('No score').length).toBeGreaterThan(0);
});

it('tapping a candidate calls onPick with that value', () => {
  const onPick = jest.fn();
  const { getByLabelText } = mount({ onPick });
  fireEvent.press(getByLabelText('Use 6 strokes for Marcos on hole 3'));
  expect(onPick).toHaveBeenCalledWith('p1', 3, 6);
});

it('finish button is disabled while rows remain and enabled when empty', () => {
  const onFinish = jest.fn();
  const withRows = mount({ onFinish });
  fireEvent.press(withRows.getByLabelText('Finish round'));
  expect(onFinish).not.toHaveBeenCalled();

  const empty = mount({ onFinish, rows: [] });
  fireEvent.press(empty.getByLabelText('Finish round'));
  expect(onFinish).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/components/scorecard/__tests__/FinishConflictSheet.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

`src/components/scorecard/FinishConflictSheet.js` — complete file:

```js
import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import { useTheme } from '../../theme/ThemeContext';

const CONFLICT = '#c77a0a';

// Finish-time conflict summary. Lists every hole/player whose score has two
// competing values and lets the finisher settle each one with a tap. Rows are
// derived live from the tournament blob by the parent, so a resolved row
// disappears on the next render; when none remain the Finish button unlocks.
//
// Props:
//   visible  — bool
//   onClose  — dismiss without finishing (conflicts stay for later)
//   rows     — [{ playerId, hole, playerName, currentValue, candidates }]
//   onPick   — (playerId, hole, value) resolve one row
//   onFinish — proceed with the round finish; only tappable when rows is empty
export default function FinishConflictSheet({
  visible, onClose, rows, onPick, onFinish,
}) {
  const { theme } = useTheme() || {};
  const s = makeStyles(theme);
  const list = Array.isArray(rows) ? rows : [];
  const done = list.length === 0;

  const valueLabel = (v) => (v == null ? 'No score' : String(v));

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
      <View style={s.titleRow}>
        <Feather
          name={done ? 'check-circle' : 'alert-circle'}
          size={16}
          color={done ? theme?.accent?.primary : CONFLICT}
        />
        <Text style={s.title}>{done ? 'All scores agreed' : 'Settle the scores'}</Text>
      </View>
      <Text style={s.subtitle}>
        {done
          ? 'Every hole has one agreed score. You can finish the round.'
          : 'These holes were recorded differently on two phones. Pick the correct score for each.'}
      </Text>

      <ScrollView style={s.list} bounces={false}>
        {list.map((row) => (
          <View key={`${row.playerId}:${row.hole}`} style={s.row}>
            <View style={s.rowHead}>
              <Text style={s.rowHole}>{`Hole ${row.hole}`}</Text>
              <Text style={s.rowPlayer}>{row.playerName}</Text>
            </View>
            <View style={s.chips}>
              {(row.candidates ?? []).map((c, i) => {
                const isCurrent = c.value === row.currentValue;
                return (
                  <TouchableOpacity
                    key={`${String(c.value)}-${c.ts}-${i}`}
                    style={[s.chip, isCurrent && s.chipCurrent]}
                    onPress={() => onPick?.(row.playerId, row.hole, c.value)}
                    activeOpacity={0.8}
                    accessibilityLabel={
                      c.value == null
                        ? `Use no score for ${row.playerName} on hole ${row.hole}`
                        : `Use ${c.value} ${c.value === 1 ? 'stroke' : 'strokes'} for ${row.playerName} on hole ${row.hole}`
                    }
                  >
                    <Text style={s.chipValue}>{valueLabel(c.value)}</Text>
                    <Text style={s.chipHint}>{isCurrent ? 'On this phone' : 'Other phone'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={[s.finish, !done && s.finishDisabled]}
        disabled={!done}
        onPress={() => { if (done) onFinish?.(); }}
        activeOpacity={0.8}
        accessibilityLabel="Finish round"
      >
        <Text style={[s.finishText, !done && s.finishTextDisabled]}>
          {done ? 'Finish round' : `${list.length} left to settle`}
        </Text>
      </TouchableOpacity>
      <Text style={s.foot}>Your picks sync to every phone in the group</Text>
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme?.bg?.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24,
    width: '100%', maxWidth: 560, alignSelf: 'center',
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme?.border?.default, marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme?.text?.primary },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme?.text?.muted,
    marginTop: 4, marginBottom: 12,
  },
  list: { flexGrow: 0 },
  row: {
    paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: theme?.border?.default,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  rowHole: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme?.text?.primary },
  rowPlayer: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme?.text?.secondary },
  chips: { flexDirection: 'row', gap: 10 },
  chip: {
    flexGrow: 1, flexBasis: 0,
    backgroundColor: theme?.bg?.card,
    borderRadius: 12, borderWidth: 1.5, borderColor: theme?.border?.default,
    paddingVertical: 10, alignItems: 'center', gap: 2,
  },
  chipCurrent: { borderColor: CONFLICT },
  chipValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 22, color: theme?.text?.primary },
  chipHint: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted },
  finish: {
    marginTop: 16, backgroundColor: theme?.accent?.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  finishDisabled: { backgroundColor: theme?.bg?.secondary },
  finishText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme?.text?.inverse },
  finishTextDisabled: { color: theme?.text?.muted },
  foot: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme?.text?.muted,
    textAlign: 'center', marginTop: 10,
  },
});
```

- [ ] **Step 4: Run the component test**

Run: `npx jest src/components/scorecard/__tests__/FinishConflictSheet.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into handleFinish**

In `src/screens/ScorecardScreen.js`:

a) Imports: `import FinishConflictSheet from '../components/scorecard/FinishConflictSheet';` and add `readLocal` to the tournamentStore import.

b) State, next to `conflictFocus` (:273): `const [finishConflictsOpen, setFinishConflictsOpen] = useState(false);`

c) Derived rows (place near the other `useMemo`s that read `tournament`):

```js
  // Live rows for the finish-time conflict summary — recomputed from the
  // blob so a resolved row disappears as soon as resolveConflict commits.
  const finishConflictRows = useMemo(() => {
    const r = tournament?.rounds?.[roundIndex];
    if (!r) return [];
    return listRoundConflicts(r).map(({ playerId, hole }) => ({
      playerId,
      hole,
      playerName: (tournament.players ?? []).find((p) => p.id === playerId)?.name ?? 'Player',
      currentValue: r.scores?.[playerId]?.[hole] ?? null,
      candidates: r.scoreConflicts?.[playerId]?.[hole]?.candidates ?? [],
    }));
  }, [tournament, roundIndex]);
```

d) Replace the conflict gate in `handleFinish` (:1133-1153, the `listRoundConflicts` + Alert block) with a flush + fresh re-read + sheet. New code at the top of the function, after the `if (!t || !r)` guard:

```js
    // Final flush: push this device's queued score edits and pull the other
    // phones' latest state, so the conflict summary below is complete.
    setFinishBusy(true);
    let freshRound = r;
    try {
      if (!official) {
        await autoSave(scoresRef.current);
        await syncNow();
        const fresh = await readLocal(t.id).catch(() => null);
        if (fresh) {
          tournamentRef.current = fresh;
          setTournament(fresh);
          freshRound = fresh.rounds?.[roundIndex] ?? r;
        }
      }
    } finally {
      setFinishBusy(false);
    }

    // A round cannot finish while a hole still has an unresolved score
    // conflict — every hole must end on one agreed value. The summary sheet
    // lists them all and re-triggers handleFinish once they're settled.
    if (listRoundConflicts(freshRound).length > 0) {
      setFinishConflictsOpen(true);
      return;
    }
```

Then in the remainder of the function: compute `liveRound`/`players`/`liveTournament`/`roundDone`/`tournamentDone` (:1155-1166) AFTER this block using `freshRound` and `tournamentRef.current` instead of the stale `r`/`t` where scores are read, and DELETE the now-duplicate `await autoSave(scoresRef.current);` inside the later `try` (:1177-1179) — the flush above already persisted and pushed. Keep everything else (`tournament.setFinished`, notification, celebration, navigation, error alert) unchanged. Update the `useCallback` dependency array to include any new identifiers it references.

e) Render the sheet next to the other sheets/modals at the bottom of the screen JSX (near where the sync sheet renders):

```js
      <FinishConflictSheet
        visible={finishConflictsOpen}
        onClose={() => setFinishConflictsOpen(false)}
        rows={finishConflictRows}
        onPick={(playerId, hole, value) => resolveConflict(playerId, hole, value)}
        onFinish={() => {
          setFinishConflictsOpen(false);
          handleFinish();
        }}
      />
```

(`resolveConflict` already exists at :610-631 — it optimistically updates `scores`, dispatches `conflict.resolve` with an immediate sync kick, and `setTournament(t)` refreshes `finishConflictRows`.)

f) `ScoreConflictSheet.js` null rendering (:87-91): change the card value line to tolerate null —

```js
                  <Text style={s.cardValue}>{c.value == null ? '—' : c.value}</Text>
```

and its card `accessibilityLabel` to handle null: `c.value == null ? `Use no score for ${subjectName || 'this player'}` : <existing string>`.

- [ ] **Step 6: Run full suite + lint**

Run: `npm test && npm run lint`
Expected: all green. The roundDecision screen test exercises handleFinish paths — if its mocks don't cover the new `readLocal`/`syncNow` imports, add them to its tournamentStore/syncWorker mock objects.

- [ ] **Step 7: Commit**

```bash
git add src/components/scorecard/FinishConflictSheet.js src/components/scorecard/__tests__/FinishConflictSheet.test.js src/screens/ScorecardScreen.js src/components/ScoreConflictSheet.js
git commit -m "feat(scorecard): finish-time conflict summary sheet"
```

---

### Task 6: End-to-end verification and branch finish

**Files:** none created — verification + merge.

- [ ] **Step 1: Full quality gates**

Run: `npm test` (expected: all green, previous ~330 + new tests) and `npm run lint` (expected: 0 errors).

- [ ] **Step 2: Runtime verify (project `verify` skill)**

Invoke the project `verify` skill (drives the Expo web build with Playwright). Scenario:

1. Start the web app, create/open a casual game, open the scorecard.
2. Tap `+` three times on one player on hole 1. Check the network log: **no** `POST`/`PATCH` to the Supabase `tournaments` endpoint during the taps.
3. Tap next hole. Check the network log: exactly one push cycle fires (fetch + upsert of the tournament blob).
4. Reload the page mid-hole after a tap (before navigating): the tapped score is still there (local persistence intact).
5. Tap Finish with no conflicts: round finishes as before (celebration → report card / summary).

- [ ] **Step 3: Two-device conflict smoke (best-effort, browser)**

If feasible in the verify environment (two browser contexts sharing one game): enter different scores for the same player/hole in both, navigate holes in both (pushes), confirm each context keeps ITS OWN value with an amber dot; then Finish in one → summary sheet lists the hole → pick a value → the second context converges to the picked value after its next flush. If a second context isn't feasible, note it and rely on the merge unit tests.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch — present merge/PR options to the user. Do NOT push to master without explicit user go-ahead (the user is actively playing rounds on the current build).
