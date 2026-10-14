import { supabase } from './supabase';
import { getLanguage, subscribeLanguage } from '../i18n';
import { subscribeConnectivity } from './connectivity';

// Tells the server which language this account's app runs in
// (profiles.locale, via set_my_locale), so send-push writes push
// notifications in the recipient's language. See docs/i18n.md.
//
// Best-effort and silent: no UI, never throws. It sends the effective
// language (getLanguage(): the Settings override, else the device language),
// debounced, when a session starts, when the language changes and when the
// connection comes back after a failed send. The last value the server
// acknowledged for this user is kept in memory, so nothing is re-sent while
// it is unchanged; a cold start sends once (the RPC writes nothing when the
// value is the same).

export const LOCALE_SYNC_DEBOUNCE_MS = 1500;

let timer = null;
let started = false;
let acked = null; // `${userId}:${lang}` the server has
let failed = false;
const unsubs = [];

async function flush() {
  timer = null;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return;
    const lang = getLanguage();
    if (lang !== 'es' && lang !== 'en') return;
    const key = `${userId}:${lang}`;
    if (key === acked) return;
    const { error } = await supabase.rpc('set_my_locale', { p_locale: lang });
    if (error) {
      failed = true;
      return;
    }
    acked = key;
    failed = false;
  } catch {
    // Offline or no client: retried on the next trigger.
    failed = true;
  }
}

// Debounced: a burst (stored preference loading right after sign-in, a few
// taps in Settings) becomes one call with the final language.
export function scheduleLocaleSync() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, LOCALE_SYNC_DEBOUNCE_MS);
}

// Called once at app start. Idempotent.
export function startProfileLocaleSync() {
  if (started) return;
  started = true;
  unsubs.push(subscribeLanguage(scheduleLocaleSync));
  try {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        acked = null;
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        scheduleLocaleSync();
      }
    });
    unsubs.push(() => data?.subscription?.unsubscribe?.());
  } catch {
    // No auth client: nothing to sync.
  }
  // First event is the current state; only a reconnect after a failure retries.
  unsubs.push(subscribeConnectivity((online) => {
    if (online && failed) scheduleLocaleSync();
  }));
  scheduleLocaleSync();
}

// Test helper.
export function __resetProfileLocaleForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  unsubs.splice(0).forEach((u) => { try { u(); } catch { /* ignore */ } });
  started = false;
  acked = null;
  failed = false;
}
