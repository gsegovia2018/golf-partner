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
  const { merged } = mergeTournaments(local, remote);

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
