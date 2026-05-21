import { supabase } from '../lib/supabase';
import { syncQueue } from './syncQueue';
import { mergeTournaments } from './merge';
import {
  saveLocal, pushRemote, readLocal, _setSyncStatus,
  _appendConflicts, _setLastSyncAt,
} from './tournamentStore';
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

// Exported for unit testing the fetch/merge/save ordering.
export async function drainTournament(tournamentId, entries) {
  const local = await readLocal(tournamentId);
  if (!local) {
    // Nothing to push — drop the stale entries.
    for (const e of entries) await syncQueue.drop(e.id);
    return;
  }
  const remote = await fetchRemote(tournamentId);
  // Re-read the local blob AFTER the network round-trip. A score or
  // shot-detail edit the user makes WHILE fetchRemote is in flight is saved
  // locally but is absent from the `local` snapshot taken before the fetch.
  // Merging that stale snapshot and writing it back would silently revert
  // the just-entered value. loadTournament()'s background refresh guards
  // itself the same way.
  const latest = await readLocal(tournamentId);
  const { merged, conflicts } = mergeTournaments(latest ?? local, remote);

  await saveLocal(merged);
  await pushRemote(merged);

  if (conflicts.length > 0) {
    await _appendConflicts(conflicts);
  }

  // Push succeeded: every entry for this tournament is now reflected in
  // the remote blob (either as the winner of its LWW cell or as a
  // captured conflict). Drop them unconditionally; the previous ts-gate
  // occasionally left entries stuck when `merged._meta[path]` didn't
  // bump — those would linger and paint the dot orange permanently.
  for (const e of entries) {
    await syncQueue.drop(e.id);
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

export function scheduleSync() {
  if (!isOnline()) { _markPendingOrIdle(); return; }
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
  else _markPendingOrIdle();
});
