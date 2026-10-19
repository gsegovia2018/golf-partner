import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';
import { getAppSettings, isSettingsHydrated } from '../store/settingsStore';

// First-party usage counts (table app_events, migration 20261022000000):
// which features friends actually use. track() never blocks or throws — it
// appends to an AsyncStorage queue and a later flush inserts it in batches,
// so events recorded offline go up when the app is next online.
// Opt-out is the `usageStats` setting: off records nothing and drops the
// queue, and nothing is sent before settings hydrate (an opted-out user's
// pre-hydrate events are dropped at the first flush, never sent).

export const EVENTS_KEY = '@usage_events';
export const MAX_QUEUED = 500; // oldest dropped past this — counts, not a ledger
const BATCH = 100;
const FLUSH_DELAY_MS = 30000;
const TABLE = 'app_events';

let chain = Promise.resolve();
function serial(job) {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

async function readQueue() {
  try {
    const q = JSON.parse(await AsyncStorage.getItem(EVENTS_KEY));
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

const enabled = () => getAppSettings().usageStats !== false;

let timer = null;
function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushEvents(); }, FLUSH_DELAY_MS);
}

// Fire-and-forget. `props` is a small flat object (ids, counts, kinds) — never
// names, emails or positions.
export function track(name, props = null) {
  if (!enabled()) return;
  const at = new Date().toISOString();
  serial(async () => {
    // The author is stamped now: a later flush under another account must not
    // claim (or, through RLS, choke on) these.
    const { data } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id;
    if (!uid) return;
    const q = await readQueue();
    q.push({ id: uuidv4(), uid, name, props, at, v: Constants?.expoConfig?.version ?? null });
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(q.slice(-MAX_QUEUED)));
  }).catch(() => {});
  scheduleFlush();
}

let flushing = null;

// Sends up to one batch of the signed-in user's queued events. Resolves to
// the number sent; never throws. A failure keeps them queued for next time.
export function flushEvents() {
  if (!flushing) {
    flushing = (async () => {
      try {
        if (!isSettingsHydrated()) return 0;
        if (!enabled()) {
          await serial(() => AsyncStorage.removeItem(EVENTS_KEY));
          return 0;
        }
        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id;
        if (!uid) return 0;
        const batch = (await serial(readQueue)).filter((e) => e.uid === uid).slice(0, BATCH);
        if (!batch.length) return 0;
        // The client id makes a retry after a lost response a no-op.
        const { error } = await supabase.from(TABLE).upsert(batch.map((e) => ({
          id: e.id, user_id: uid, name: e.name, props: e.props, created_at: e.at, app_version: e.v,
        })), { onConflict: 'id', ignoreDuplicates: true });
        // A data/constraint error (SQLSTATE 22/23) can never succeed: drop the
        // batch rather than block the queue forever. Anything else retries.
        if (error && !/^2[23]/.test(String(error.code ?? ''))) return 0;
        const sent = new Set(batch.map((e) => e.id));
        await serial(async () => {
          const q = await readQueue();
          await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(q.filter((e) => !sent.has(e.id))));
        });
        return error ? 0 : batch.length;
      } catch {
        return 0;
      }
    })().finally(() => { flushing = null; });
  }
  return flushing;
}

let appStateSub = null;

// App boot: send what an earlier run left, and again on every foreground.
export function startTelemetry() {
  flushEvents();
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushEvents();
    });
  }
}

export function __resetTelemetryForTests() {
  chain = Promise.resolve();
  flushing = null;
  if (timer) clearTimeout(timer);
  timer = null;
  appStateSub?.remove?.();
  appStateSub = null;
}
