import { supabase } from '../lib/supabase';
import { syncQueue } from './syncQueue';
import {
  saveLocal, readLocal, _setSyncStatus, _setLastSyncAt,
} from './tournamentStore';
import { fetchTournament } from './tournamentRepo';
import { executeMutation } from './mutationWrites';
import { applyPendingMutations, preserveLocalScoreConflicts } from './mutate';
import { upsertPlayer } from './libraryStore';
import { isOnline, subscribeConnectivity } from '../lib/connectivity';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
let _attempt = 0;
let _timer = null;
let _running = false;

// How many times a RECOVERABLE coded error may fail before we give up on an
// entry as poison (see isPermanentSyncError below for why "has a .code"
// alone can't be trusted to mean "give up now").
const RECOVERABLE_ATTEMPT_CAP = 8;

// Classifies a write failure as PERMANENT (retrying can never succeed, so
// drop the mutation now) vs RECOVERABLE (the write may succeed on a later
// attempt, so keep it queued).
//
// The historical heuristic here was "has a .code -> permanent". That is
// backwards for a whole class of coded errors that ARE transient: an
// expired/invalid session (PostgREST 'PGRST301', JWT expired), plain
// 401/403, 429 rate-limiting, 5xx, and SQLSTATE class 08 (connection
// exception) all carry a `.code` but describe a temporary condition, not a
// malformed or rejected write. Treating them as permanent silently and
// PERMANENTLY drops the user's action (e.g. a "Finish tournament" mutation
// dropped because the JWT happened to be stale at drain time).
//
// Genuinely permanent (drop-now) cases:
//   - SQLSTATE class 22 (data exception, e.g. 22P02 invalid text repr.)
//   - SQLSTATE class 23 (integrity constraint violation, e.g. 23505 unique)
//   - SQLSTATE class 42 (syntax error / undefined object / insufficient
//     privilege, e.g. 42501)
//   - PostgREST 'PGRST116' (no rows) and other PGRST1xx malformed-request
//     codes
//   - the "unknown mutation type" throw from executeMutation — the op
//     itself is unprocessable, not a server hiccup
//
// Everything else that carries a `.code` (auth, rate-limit, 5xx, connection
// errors, or any code this list doesn't recognize) is treated as
// RECOVERABLE, same as the historical no-code/network-error path.
export function isPermanentSyncError(error) {
  if (!error) return false;
  if (typeof error.message === 'string' && error.message.startsWith('unknown mutation type')) {
    return true;
  }
  const code = error.code;
  if (!code) return false;
  const codeStr = String(code);
  if (codeStr === 'PGRST116') return true;
  if (codeStr.startsWith('PGRST1')) return true; // PostgREST malformed/parse-request codes
  // PL/pgSQL RAISE default class: a `RAISE EXCEPTION 'party locked'` with no
  // explicit errcode surfaces as SQLSTATE P0001 (P0002 no_data_found, P0003
  // too_many_rows, P0004 assert_failure). These are business-rule raises
  // (e.g. official-mode submit_score rejecting a locked party / invalid
  // token) — never transient, so retrying can never succeed.
  if (codeStr.length === 5 && codeStr.startsWith('P0')) return true;
  // SQLSTATE codes are always 5 characters (e.g. '23505', '22P02',
  // '42501') — gate on length too, or a 3-digit HTTP code like '429'
  // (rate-limit, recoverable) would false-positive on the '42' prefix.
  if (codeStr.length === 5 && /^(22|23|42)/.test(codeStr)) return true;
  return false;
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
        if (isPermanentSyncError(error)) {
          // Terminal failure: the RPC reached the database and the
          // function raised a genuinely un-retryable exception / hit a
          // constraint (SQLSTATE classes 22/23/42, PGRST1xx). Retrying
          // will never succeed, so drop the entry — but still flip the
          // sync indicator so the failure isn't invisible.
          console.warn(`rpc.call ${m.fn} permanently rejected; dropping: ${error.message}`);
          await syncQueue.drop(entry.id);
          _setSyncStatus('error');
          continue;
        }

        // Recoverable failure: network/transport error, expired session
        // (PGRST301/JWT), 401/403, 429, 5xx, or any unrecognized code.
        // Bump the poison counter — a recoverable error that never actually
        // recovers must NOT retry forever (that is what wedged the whole
        // pipeline: a stuck rpc.call throwing on every pass, aborting
        // drainOnce before any tournament could drain).
        const attempts = await syncQueue.incrementAttempts(entry.id);
        if (attempts >= RECOVERABLE_ATTEMPT_CAP) {
          console.warn(
            `rpc.call ${m.fn} failed ${attempts} times with a recoverable `
            + `error (${error?.code ?? 'no code'}); dropping as poison: ${error?.message}`,
          );
          await syncQueue.drop(entry.id);
          _setSyncStatus('error');
          continue;
        }
        // Under the cap: leave the entry queued and let scheduleSync's
        // backoff retry it on the next pass.
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
// Error heuristic: see isPermanentSyncError above for the full
// classification. A PERMANENT failure (genuinely un-retryable — SQLSTATE
// 22/23/42, PGRST1xx, or an unknown mutation type) drops the entry now,
// since retrying can never succeed, and flips the sync status to 'error' so
// the drop is visible rather than a console.warn nobody sees. A RECOVERABLE
// failure — no error.code (network/transport), OR a code that isn't
// genuinely terminal (expired session, 401/403, 429, 5xx, connection
// errors) — is rethrown, which leaves the entry (and any not-yet-attempted
// entries for this tournament) queued and aborts the reconcile below;
// drainOnce's caller (syncNow) catches it, flips status to 'error', and
// schedules a backoff retry.
//
// A recoverable entry's `attempts` counter (persisted via
// syncQueue.incrementAttempts) is a poison guard: if the SAME entry keeps
// failing recoverably past RECOVERABLE_ATTEMPT_CAP attempts, something is
// wrong beyond a one-off blip (e.g. a permanently expired credential that
// never refreshes) and we drop it rather than retry forever — surfaced via
// 'error' status, never silently.
export async function drainTournament(tournamentId, entries) {
  for (const entry of entries) {
    const local = await readLocal(tournamentId);
    try {
      await executeMutation(entry, local);
      await syncQueue.drop(entry.id);
    } catch (error) {
      if (isPermanentSyncError(error)) {
        console.warn(
          `mutation ${entry.mutation?.type} permanently rejected; dropping: ${error.message}`,
        );
        await syncQueue.drop(entry.id);
        _setSyncStatus('error');
        continue;
      }

      const attempts = await syncQueue.incrementAttempts(entry.id);
      if (attempts >= RECOVERABLE_ATTEMPT_CAP) {
        console.warn(
          `mutation ${entry.mutation?.type} failed ${attempts} times with a recoverable `
          + `error (${error?.code ?? 'no code'}); dropping as poison: ${error?.message}`,
        );
        await syncQueue.drop(entry.id);
        _setSyncStatus('error');
        continue;
      }

      // Recoverable and under the cap: leave this entry (and the rest of
      // this tournament's batch) queued and stop draining it.
      throw error;
    }
  }

  // Every entry for this tournament landed on the server. Pull the fresh row
  // state and overlay whatever queued for this tournament arrived while we
  // were draining (the read-path replacement for the old fetch/merge race
  // guard). Reconcile failures are logged and swallowed — the worker retries
  // on the next drain pass.
  //
  // The overlay snapshot races mutate(): mutate saves locally BEFORE it
  // enqueues, so a score entered right now can be present in local state but
  // absent from the queue snapshot — and a reconcile save computed from that
  // snapshot would erase the just-entered value until the next drain (the
  // "scores erased as entered" scar). Take the snapshot as late as possible
  // (after the fetch), and after each save re-read the queue: if it changed,
  // recompute the overlay from the SAME fresh base and save again. Bounded
  // to 3 passes — on hitting the bound, skip the further save and leave
  // local as-is (local wins; the still-queued mutations drain next pass and
  // re-reconcile anyway). This shrinks the exposure window from a full
  // network round-trip to a couple of JS ticks.
  try {
    const fresh = await fetchTournament(tournamentId);
    if (fresh) {
      // Snapshot local's CURRENT scoreConflicts markers once, before the
      // settle loop below — conflict state is derived from synced entries
      // elsewhere, not raised by this drain, and any resolve already cleared
      // its marker from local directly (mutate()
      // saves locally before it ever reaches this drain). `fresh` and
      // applyPendingMutations' replay never carry scoreConflicts (see
      // preserveLocalScoreConflicts) so every pass below must re-stamp them
      // back onto the freshly computed state or the reconcile save wipes
      // them.
      const localForConflicts = await readLocal(tournamentId);
      const queuedForTournament = async () => (await syncQueue.all())
        .filter((e) => e.tournamentId === tournamentId);
      let snapshot = await queuedForTournament();
      for (let pass = 0; pass < 3; pass++) {
        const merged = preserveLocalScoreConflicts(
          applyPendingMutations(fresh, snapshot), localForConflicts,
        );
        await saveLocal(merged);
        const latest = await queuedForTournament();
        const stable = latest.length === snapshot.length
          && latest.every((e, i) => e.id === snapshot[i].id);
        if (stable) break;
        snapshot = latest;
      }
    }
  } catch (error) {
    // Swallow — worker retries next drain.
    console.warn(`post-drain reconcile failed for ${tournamentId}: ${error?.message}`);
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
  // Isolate the library drain: a single stuck library mutation (e.g. an
  // official-mode submit_score rejected by a business-rule raise, or a
  // recoverable error still under its retry cap) throws here, but it must
  // NEVER abort the per-tournament drains below — a wedged official-score
  // write must not block casual-tournament score/finish sync. The entry
  // stays queued (or was already dropped by drainLibrary); the worker
  // retries on the next pass.
  try {
    await drainLibrary(libraryMuts);
  } catch (error) {
    _setSyncStatus('error');
    console.warn(`library drain failed; continuing with tournament drains: ${error?.message}`);
  }

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
