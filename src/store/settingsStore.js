import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadProfile, upsertProfile } from './profileStore';

// Per-user app settings (spec: docs/superpowers/specs/2026-07-20-user-settings-design.md).
// Synced via profiles.settings; mirrored to AsyncStorage so the app has them
// instantly offline. Defaults live here — a missing key always means default,
// so old blobs and old app versions never break.

export const SETTINGS_KEY = '@golf_settings';
export const SETTINGS_DIRTY_KEY = '@golf_settings_dirty';
export const SETTINGS_USER_KEY = '@golf_settings_user';
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
  // Coach-marks tour: ISO timestamp when a chapter was completed/skipped,
  // null (or missing — same thing) means the chapter hasn't run yet.
  tour: { home: null, scorecard: null },
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
// The userId hydrateAppSettings last stamped SETTINGS_USER_KEY with (or null
// if no hydrate has stamped one yet, or the last hydrate signed out). Lets
// updateAppSettings re-stamp the owner on every write, so a mirror written
// after hydrate is always owned even if something else clears the key.
let hydratedUserId = null;

// True once hydrateAppSettings has completed at least once this app run with
// a *trustworthy* outcome (server-adopted, first-ever signed-out reset, or
// offline fallback) — false again in the window between a signed-out reset
// that invalidates a real prior session and the next hydrate resolving.
// Consumers that must not act on stale-or-mid-transition state (the tour)
// wait on this. See the `if (!profile)` branch of hydrateAppSettings for why
// a signed-out reset can close the gate instead of opening it.
let settingsHydrated = false;
const hydrationListeners = new Set();
export function isSettingsHydrated() { return settingsHydrated; }
export function subscribeSettingsHydration(cb) {
  hydrationListeners.add(cb);
  return () => hydrationListeners.delete(cb);
}
function setSettingsHydrated(value) {
  if (settingsHydrated === value) return;
  settingsHydrated = value;
  hydrationListeners.forEach((cb) => cb());
}

export function getAppSettings() { return current; }
export function subscribeAppSettings(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function set(next) { current = next; listeners.forEach((cb) => cb()); }

export function __resetAppSettingsForTests() {
  current = DEFAULT_APP_SETTINGS;
  listeners.clear();
  mutationSeq = 0;
  hydratedUserId = null;
  settingsHydrated = false;
  hydrationListeners.clear();
}

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
  // Cheap idempotent re-stamp: if hydrate has ever established an owner for
  // this mirror, keep it owned on every write, even if the key was somehow
  // cleared — an unowned mirror can't be detected as foreign on a later
  // user-switch hydrate.
  if (hydratedUserId) await AsyncStorage.setItem(SETTINGS_USER_KEY, hydratedUserId);
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
  // Every exit path ends the gate open (hydrated=true) *except* a signed-out
  // reset that invalidates a previously-hydrated real session — see the
  // `if (!profile)` branch below for why that one closes it instead.
  let gateOpensOnExit = true;
  try {
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
      if (!profile) {
        // Signed out: the app is auth-gated, so a signed-out device should
        // not carry the previous user's synced prefs around.
        //
        // Whether this reset should *open* the hydration gate depends on
        // what it's resetting away from. If a real user was hydrated before
        // (hydratedUserId set), these defaults — tour flags included — are
        // not that fact a mounted consumer (TourOverlay) can safely see:
        // signing out just made "flags=null" true only because we wiped
        // them, not because whoever signs in next has never run the tour.
        // Close the gate so it stays hidden until the next hydrate (that
        // user's sign-in) actually resolves and re-opens it with real data.
        // If nobody was ever signed in (fresh install, gate never opened),
        // this reset *is* the real, final state — leave the gate open.
        const wasSignedIn = hydratedUserId != null;
        set(DEFAULT_APP_SETTINGS);
        await AsyncStorage.removeItem(SETTINGS_KEY);
        await AsyncStorage.removeItem(SETTINGS_DIRTY_KEY);
        await AsyncStorage.removeItem(SETTINGS_USER_KEY);
        hydratedUserId = null;
        gateOpensOnExit = !wasSignedIn;
        return;
      }

      const storedOwner = await AsyncStorage.getItem(SETTINGS_USER_KEY);
      const server = profile.settings ?? {};

      // A different user just signed in on this shared device — whatever is
      // in memory (and mirrored) belongs to whoever was here before. Never
      // treat it as this user's dirty local state or push it into their
      // profile; only adopt what the server already has for them.
      if (storedOwner != null && storedOwner !== profile.userId) {
        // Same staleness guard as the same-user branch below: a concurrent
        // updateAppSettings() that landed while loadProfile() was in flight is
        // by definition the new user's own action (nothing else could have
        // written between the switch starting and hydrate finishing) — it
        // wins over both the reset-to-default and the server adopt.
        const staleWrite = mutationSeq !== seqBefore;
        await AsyncStorage.removeItem(SETTINGS_KEY);
        await AsyncStorage.removeItem(SETTINGS_DIRTY_KEY);
        if (staleWrite) {
          // The old mirror we just cleared held the winning write's snapshot
          // too — re-persist `current` (untouched above) so it isn't lost.
          await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
        } else {
          set(DEFAULT_APP_SETTINGS);
          if (Object.keys(server).length > 0) {
            set(mergeAppSettings(DEFAULT_APP_SETTINGS, server));
            await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
          }
        }
        // Empty server blob: stay on defaults without pushing anything up —
        // the caller (fix scenario) must never push a foreign/default blob.
        hydratedUserId = profile.userId;
        await AsyncStorage.setItem(SETTINGS_USER_KEY, profile.userId);
        return;
      }

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
      hydratedUserId = profile.userId;
      await AsyncStorage.setItem(SETTINGS_USER_KEY, profile.userId);
    } catch { /* offline — local copy stands */ }
  } finally { setSettingsHydrated(gateOpensOnExit); }
}
