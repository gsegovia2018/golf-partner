import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import AsyncStorage from '@react-native-async-storage/async-storage';

// JS side of the shot listener (modules/golf-shot-sense): while a live round
// is tracked, the phone listens for strikes and feels for its own swings, and
// keeps per round an events log and a 1 s clip per strike, on the phone.
// Android only, and only in a build that has the module: elsewhere every call
// is a no-op and there is simply no sound data, so OTA updates are safe
// against older binaries.
//
// Events (one JSON object per line in the native log):
//   { type: 'start', t, source } / { type: 'alive', t } / { type: 'stop', t }
//   { type: 'strike', t, frameDb, bgDb, peakDb, riseMs, decayMs, centroidHz, gyroPeak, accPeak, clip? }
//   { type: 'swing', t, gyroPeak, accPeak }
//   { type: 'error', t, error }
// Without the module (web, tests) the events are read from AsyncStorage under
// SOUND_EVENTS_PREFIX + session (localStorage on web), as an array: that is
// how they are seeded for testing.
//
// Plan: docs/superpowers/plans/2026-10-25-shot-sound-confidence.md

export const SOUND_EVENTS_PREFIX = '@shot_sound_events/';

let native;
function nativeModule() {
  if (native === undefined) {
    native = Platform.OS === 'android' ? requireOptionalNativeModule('GolfShotSense') : null;
  }
  return native;
}

export const isShotSenseSupported = () => nativeModule() != null;

// The folder name the native side keeps a session under.
export const sessionFolder = (session) => String(session).replace(/[^A-Za-z0-9_-]/g, '_');

// One event per line; lines that do not parse (a write cut short) are skipped.
export function parseShotSenseEvents(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.type === 'string' && Number.isFinite(e.t)) out.push(e);
    } catch { /* partial line */ }
  }
  return out;
}

// A session's events, oldest first. Never throws; [] when there are none.
export async function readShotSenseEvents(session) {
  try {
    const mod = nativeModule();
    const events = mod
      ? parseShotSenseEvents(await mod.readEvents(String(session)))
      : JSON.parse((await AsyncStorage.getItem(SOUND_EVENTS_PREFIX + session)) ?? '[]');
    return Array.isArray(events) ? [...events].sort((a, b) => a.t - b.t) : [];
  } catch {
    return [];
  }
}

// Every kept session: [{ name, modified, bytes, clips }], newest first.
export async function listShotSenseSessions() {
  const mod = nativeModule();
  if (!mod) return [];
  try {
    const rows = await mod.sessions();
    return [...(rows ?? [])].sort((a, b) => b.modified - a.modified);
  } catch {
    return [];
  }
}

export function shotSenseDir(session) {
  const mod = nativeModule();
  try { return mod ? mod.sessionDir(String(session)) : null; } catch { return null; }
}

// Asks for the microphone. Resolves true when it may be used.
export async function requestShotSensePermission() {
  if (!isShotSenseSupported()) return false;
  try {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// The single control surface, like lib/roundTracking's setRoundTracking:
// `session` (a round's proposal key) with the notification `title` starts
// listening, null stops it. A microphone service may only start while the app
// is visible, so a start refused in the background is retried when it is.
let desired = null; // { session, title } | null
let wakeSub = null;
let queue = Promise.resolve();
const enqueue = (job) => {
  queue = queue.then(job, job);
  return queue;
};

function apply() {
  const mod = nativeModule();
  if (!mod) return queue;
  return enqueue(async () => {
    try {
      const want = desired;
      if (!want) {
        await mod.stop();
        return;
      }
      if (mod.running() === want.session) return;
      await mod.start(want.session, want.title);
    } catch {
      // No permission or not visible yet: the next change or return to the foreground retries.
    }
  });
}

export function setShotListening(session, title) {
  if (!isShotSenseSupported()) return;
  const next = session ? { session: String(session), title } : null;
  if ((next?.session ?? null) === (desired?.session ?? null)) return;
  desired = next;
  if (desired && !wakeSub) {
    wakeSub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && desired) apply();
    });
  }
  if (!desired) {
    wakeSub?.remove?.();
    wakeSub = null;
  }
  apply();
}

export function __resetShotSenseForTests(mod) {
  native = mod === undefined ? undefined : mod;
  desired = null;
  wakeSub?.remove?.();
  wakeSub = null;
  queue = Promise.resolve();
}
