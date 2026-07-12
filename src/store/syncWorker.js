import { supabase } from '../lib/supabase';
import { syncQueue } from './syncQueue';
import {
  saveLocal, readLocal, _setSyncStatus, _setLastSyncAt,
} from './tournamentStore';
import { fetchTournament } from './tournamentRepo';
import { executeMutation } from './mutationWrites';
import { applyPendingMutations } from './mutate';
import { upsertPlayer } from './libraryStore';
import { isOnline, subscribeConnectivity } from '../lib/connectivity';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
let _attempt = 0;
let _timer = null;
let _running = false;

// Conflict seam: Task 11 registers the real marker-writer here. Defaults to
// a no-op so drains never crash before that wiring lands.
let _scoreConflictHandler = null;
export function setScoreConflictHandler(fn) {
  _scoreConflictHandler = fn;
}

async function notifyScoreConflict(tournamentId, conflict) {
  if (!_scoreConflictHandler) return;
  try {
    await _scoreConflictHandler(tournamentId, conflict);
  } catch (_) {
    // The handler's own failure (e.g. a marker write) must never abort the
    // drain — the mutation that produced this conflict already landed.
  }
}

// Exported for unit testing the mutation → upsertPlayer field mapping.
export async function drainLibrary(libraryMuts) {
  // Library mutations (player.upsertLibrary) drain independently; no merge.
  for (const entry of libraryMuts) {
    const m = entry.mutation;
    if (m.type === 'player.upsertLibrary') {
      await upsertPlayer({ id: m.playerId, name: m.name, handicap: m.handicap, gender: m.gender });
      await syncQueue.drop(entry.id);
    } else if (m.type === 'rpc.call') {
      // Generic RPC dispatch (e.g. official-tournament score writes).
      const { error } = await supabase.rpc(m.fn, m.args);
      if (error) {
        if (error.code) {
          // Terminal failure: the RPC reached the database and the
          // function raised an exception / hit a constraint (SQLSTATE
          // codes like P0001, 23xxx — "party locked", "invalid token").
          // Retrying will never succeed, so drop the entry rather than
          // let it sit forever pinning the sync dot to orange.
          console.warn(`rpc.call ${m.fn} permanently rejected; dropping: ${error.message}`);
          await syncQueue.drop(entry.id);
          continue;
        }
        // Transient failure: no SQLSTATE means a network/transport
        // error. Leave the entry queued and let scheduleSync's backoff
        // retry it on the next pass.
        throw error;
      }
      await syncQueue.drop(entry.id);
    } else {
      // Unknown library-type mutation: drop so it can't sit in the queue
      // forever pinning the sync dot to orange.
      await syncQueue.drop(entry.id);
    }
  }
}

// Exported for unit testing the row-write drain + post-drain reconcile.
//
// Executes each queued mutation for one tournament, in order, via
// executeMutation (Task 8) — the row-write replacement for the old
// fetch→merge→push blob cycle. Local is re-read before every entry (cheap:
// readLocal is an in-memory cache) so entry N sees whatever entry N-1 (or a
// concurrent screen edit) just saved.
//
// Error heuristic (unchanged from the legacy blob-push path, see
// drainLibrary's rpc.call branch above): a terminal failure — error.code
// present, meaning the write reached the database and was rejected there —
// drops the entry permanently, since retrying can never succeed. A
// transient failure — no error.code, i.e. a network/transport error — is
// rethrown, which leaves the entry (and any not-yet-attempted entries for
// this tournament) queued and aborts the reconcile below; drainOnce's caller
// (syncNow) catches it, flips status to 'error', and schedules a backoff
// retry.
export async function drainTournament(tournamentId, entries) {
  for (const entry of entries) {
    const local = await readLocal(tournamentId);
    try {
      const { conflict } = await executeMutation(entry, local);
      if (conflict) await notifyScoreConflict(tournamentId, conflict);
      await syncQueue.drop(entry.id);
    } catch (error) {
      if (error && error.code) {
        console.warn(
          `mutation ${entry.mutation?.type} permanently rejected; dropping: ${error.message}`,
        );
        await syncQueue.drop(entry.id);
        continue;
      }
      // Transient: leave this entry (and the rest of this tournament's
      // batch) queued and stop draining it.
      throw error;
    }
  }

  // Every entry for this tournament landed on the server. Pull the fresh row
  // state and overlay whatever queued elsewhere for this tournament arrived
  // while we were draining (the read-path replacement for the old
  // fetch/merge race guard). Reconcile failures are swallowed — the worker
  // retries on the next drain pass.
  try {
    const fresh = await fetchTournament(tournamentId);
    if (fresh) {
      const all = await syncQueue.all();
      const stillQueued = all.filter((e) => e.tournamentId === tournamentId);
      await saveLocal(applyPendingMutations(fresh, stillQueued));
    }
  } catch (_) {
    // Swallow — worker retries next drain.
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
  if (remaining.length === 0) {
    await _setLastSyncAt(Date.now());
    _setSyncStatus('idle');
  } else {
    _setSyncStatus('pending');
  }
}

// "pending" should only mean "there's something waiting to sync".
// Flipping the dot orange with an empty queue (because isOnline() lied
// for a frame or NetInfo's first fetch hadn't resolved) is what keeps
// users stuck in orange forever.
async function _markPendingOrIdle() {
  try {
    const all = await syncQueue.all();
    _setSyncStatus(all.length > 0 ? 'pending' : 'idle');
  } catch (_) {
    _setSyncStatus('idle');
  }
}

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

// Drain-and-settle for callers that need the queue empty before reading
// merged state (the finish-time conflict summary). syncNow() alone can
// return a drain that was already in flight and snapshotted the queue
// before the caller's latest enqueue; one follow-up pass covers entries
// that arrived mid-drain.
export async function syncSettled() {
  await syncNow();
  const remaining = await syncQueue.all();
  if (remaining.length > 0) await syncNow();
}

export function scheduleSync() { syncNow(); }

export function retrySync() {
  _attempt = 0;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  scheduleSync();
}

// Auto-trigger on connectivity regain.
subscribeConnectivity((online) => {
  if (online) retrySync();
  else _markPendingOrIdle();
});
