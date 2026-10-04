import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { recordLeagueFinal } from '../store/leagueStore';
import { onSyncDrained } from '../store/syncWorker';

// Starting a League Final creates the tournament through the sync queue, so
// its `tournaments` row may not exist on the server when record_league_final
// runs (league_finals.tournament_id is a foreign key). The link is therefore
// kept as a small persisted queue and retried: after the sync worker drains,
// when the app returns to the foreground, on League screen focus, and on a
// short backoff timer. A retry that races a success is harmless.

const KEY = '@golf_league_final_pending';
const FK_VIOLATION = '23503';
const BACKOFF_MS = [5000, 15000, 60000];

let flushing = null;
let timer = null;
let attempt = 0;
const subs = new Set();

async function read() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

async function write(list) {
  try {
    if (list.length) await AsyncStorage.setItem(KEY, JSON.stringify(list));
    else await AsyncStorage.removeItem(KEY);
  } catch { /* best-effort */ }
  subs.forEach((fn) => { try { fn(list); } catch { /* ignore */ } });
}

// Offline, or the tournament row has not reached the server yet.
export function isRetryableFinalError(e) {
  return !!e?.offline || e?.code === FK_VIOLATION
    || /league_finals_tournament_id_fkey/.test(e?.message ?? '');
}

export async function enqueueLeagueFinal({ leagueId, tournamentId, strokes }) {
  const list = (await read()).filter((x) => x.tournamentId !== tournamentId);
  await write([...list, { leagueId, tournamentId, strokes }]);
  scheduleRetry();
}

export async function getPendingLeagueFinals() { return read(); }

export function subscribePendingLeagueFinals(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function scheduleRetry() {
  if (timer) return;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt++;
  timer = setTimeout(() => { timer = null; flushPendingLeagueFinals(); }, delay);
}

// Try every pending entry once. Success removes it; a retryable failure keeps
// it (and arms the backoff); anything else is a refusal that will not change
// on retry (not admin, league archived), so it is dropped and logged.
export function flushPendingLeagueFinals() {
  if (flushing) return flushing;
  flushing = (async () => {
    const list = await read();
    if (!list.length) { attempt = 0; return; }
    const kept = [];
    for (const entry of list) {
      try {
        await recordLeagueFinal(entry.leagueId, entry.tournamentId, entry.strokes);
      } catch (e) {
        if (isRetryableFinalError(e)) kept.push(entry);
        else console.warn('League Final link dropped', e?.message ?? e);
      }
    }
    // Entries enqueued while we were flushing must survive the rewrite.
    const handled = new Set(list.map((x) => x.tournamentId));
    const added = (await read()).filter((x) => !handled.has(x.tournamentId));
    await write([...kept, ...added]);
    if (kept.length) scheduleRetry(); else attempt = 0;
  })().finally(() => { flushing = null; });
  return flushing;
}

let started = false;
export function startLeagueFinalPending() {
  if (started) return;
  started = true;
  onSyncDrained(() => { flushPendingLeagueFinals(); });
  AppState.addEventListener('change', (s) => { if (s === 'active') flushPendingLeagueFinals(); });
  flushPendingLeagueFinals();
}

export function resetLeagueFinalPendingForTests() {
  flushing = null;
  if (timer) clearTimeout(timer);
  timer = null;
  attempt = 0;
  subs.clear();
}
