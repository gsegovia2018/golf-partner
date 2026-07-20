import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile, upsertProfile } from './profileStore';

// Per-user app settings (spec: docs/superpowers/specs/2026-07-20-user-settings-design.md).
// Synced via profiles.settings; mirrored to AsyncStorage so the app has them
// instantly offline. Defaults live here — a missing key always means default,
// so old blobs and old app versions never break.

export const SETTINGS_KEY = '@golf_settings';
export const SETTINGS_DIRTY_KEY = '@golf_settings_dirty';
const LEGACY_RUNNING_SCORE_KEY = '@scorecard_show_running_score';

export const DEFAULT_APP_SETTINGS = {
  gpsEnabled: true,
  keepAwake: true,
  autoAdvanceHole: false,
  haptics: true,
  noSpoilers: false,
  showRunningScore: true,
  statGroups: { putting: true, teeShot: true, approach: true, shortGame: true, penalties: true },
  units: 'meters', // 'meters' | 'yards' — display-only, storage is always meters
  notifications: { scores: true, invites: true, media: true },
};

// One level deep: object-valued keys (statGroups, notifications) merge
// key-wise; everything else replaces.
export function mergeAppSettings(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...base[k], ...v } : v;
  }
  return out;
}

let current = DEFAULT_APP_SETTINGS;
const listeners = new Set();
// Bumped by every updateAppSettings call so hydrateAppSettings can detect a
// concurrent local write racing its in-flight loadProfile() and avoid
// clobbering it with a stale server copy.
let mutationSeq = 0;

export function getAppSettings() { return current; }
export function subscribeAppSettings(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function set(next) { current = next; listeners.forEach((cb) => cb()); }

export function __resetAppSettingsForTests() { current = DEFAULT_APP_SETTINGS; listeners.clear(); mutationSeq = 0; }

async function pushToServer(snapshot) {
  try {
    await upsertProfile({ settings: snapshot });
    await AsyncStorage.removeItem(SETTINGS_DIRTY_KEY);
  } catch {
    await AsyncStorage.setItem(SETTINGS_DIRTY_KEY, '1');
  }
}

// Write-through: UI state and the local mirror update immediately; the
// server write is best-effort with a dirty flag replayed on next hydrate.
export async function updateAppSettings(patch) {
  mutationSeq += 1;
  set(mergeAppSettings(current, patch));
  const snapshot = current;
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
  await pushToServer(snapshot);
}

// Call at app start and whenever the auth session appears. Local mirror
// first (instant), then reconcile with the server: dirty or first-ever blob
// pushes local up, otherwise the server copy wins.
export async function hydrateAppSettings() {
  // Captured synchronously, before any awaits below, so a concurrent
  // updateAppSettings() anywhere during this hydrate — including while the
  // local-mirror read (AsyncStorage.getItem below) or the loadProfile()
  // network call further down is still pending — is reliably detected. In
  // both windows, a local write that lands mid-await is fresher than
  // anything hydrate read and must not be clobbered by it.
  const seqBefore = mutationSeq;
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (mutationSeq === seqBefore) {
      if (raw != null) {
        set(mergeAppSettings(DEFAULT_APP_SETTINGS, JSON.parse(raw)));
      } else {
        // First run of the settings system on this device: import the one
        // legacy pref that predates it.
        const legacy = await AsyncStorage.getItem(LEGACY_RUNNING_SCORE_KEY);
        if (mutationSeq === seqBefore && legacy != null) {
          set(mergeAppSettings(current, { showRunningScore: legacy === '1' }));
        }
      }
    }
  } catch { /* corrupted mirror — stay on defaults */ }

  try {
    const profile = await loadProfile();
    if (!profile) return;
    const server = profile.settings ?? {};
    const dirty = await AsyncStorage.getItem(SETTINGS_DIRTY_KEY);
    // A concurrent updateAppSettings() while loadProfile() was in flight
    // means the server copy we just fetched is now stale — treat it like
    // the dirty path and push the newer local state up instead of adopting.
    const staleServer = mutationSeq !== seqBefore;
    if (dirty === '1' || Object.keys(server).length === 0 || staleServer) {
      const snapshot = current;
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
      await pushToServer(snapshot);
    } else {
      set(mergeAppSettings(DEFAULT_APP_SETTINGS, server));
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    }
  } catch { /* offline — local copy stands */ }
}
