import * as Sentry from '@sentry/react-native';
import { installReporter, isNetworkFailure } from './errorReporting';
import {
  getAppSettings, isSettingsHydrated, subscribeSettingsHydration, subscribeAppSettings,
} from '../store/settingsStore';

// Crash reports to Sentry (project golf-partner-app). They follow the same
// switch as usage counts: Settings → "Share usage stats" off sends nothing.
// Sentry starts only once settings have hydrated, so an opted-out user's
// crash from a previous run is never sent before the app knows the choice;
// turning the switch off mid-run closes the client. Off in dev builds and
// without a DSN (EXPO_PUBLIC_SENTRY_DSN).

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const enabled = () => getAppSettings().usageStats !== false;

let started = false;
let userId = null;

function start() {
  if (started || !enabled()) return;
  started = true;
  Sentry.init({
    dsn: DSN,
    // Only the account id (setCrashReportUser) — no IP, no request bodies.
    sendDefaultPii: false,
    // Errors only; no performance tracing.
    tracesSampleRate: 0,
    // The switch can go off between init and an event.
    beforeSend: (event) => (enabled() ? event : null),
  });
  if (userId) Sentry.setUser({ id: userId });
  // Every captureException / captureMessage in the app already goes through
  // errorReporting; this forwards them.
  installReporter((event, error) => {
    // No signal is normal on a course: the offline-first sync retries, and
    // the failure stays in the in-app buffer. Not a crash.
    if (isNetworkFailure(error)) return;
    if (event.level === 'error') {
      Sentry.captureException(error instanceof Error ? error : new Error(event.message), { extra: event.context ?? undefined });
    } else {
      Sentry.captureMessage(event.message, { level: 'warning', extra: event.context ?? undefined });
    }
  });
}

function stop() {
  if (!started) return;
  started = false;
  installReporter(null);
  Sentry.close();
}

export function startCrashReporting() {
  if (!DSN || __DEV__) return;
  if (isSettingsHydrated()) start();
  subscribeSettingsHydration(() => { if (isSettingsHydrated()) start(); });
  subscribeAppSettings(() => {
    if (!isSettingsHydrated()) return;
    if (enabled()) start();
    else stop();
  });
}

// The signed-in account's id, or null when signed out.
export function setCrashReportUser(id) {
  userId = id ?? null;
  if (started) Sentry.setUser(userId ? { id: userId } : null);
}
