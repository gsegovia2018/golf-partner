// Vendor-agnostic error reporting.
//
// The app previously had no error reporting at all: uncaught UI errors and
// every sync-failure/data-loss path were console.warn/console.error only, so on
// a production device they left no trace. This gives one capture point that:
//   - buffers the most recent events in memory (capped) so they are inspectable
//     in-app (e.g. a debug view / SyncStatusSheet) instead of vanishing, and
//   - forwards to an optional external sink via installReporter().
//
// It intentionally has NO native dependency. To ship crash reporting, add the
// vendor SDK (e.g. @sentry/react-native) at the app entry and do:
//     import * as Sentry from '@sentry/react-native';
//     Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN });
//     installReporter((event, error) => Sentry.captureException(error ?? event.message));
// Nothing else in the app has to change — every captureException/captureMessage
// call already routes here.

export const MAX_REPORT_EVENTS = 50;

let _sink = null;
const _events = [];

// Attach (or clear, with null) the external reporter. The sink receives
// (event, originalError). Any throw inside it is swallowed — see record().
export function installReporter(fn) {
  _sink = typeof fn === 'function' ? fn : null;
}

function record(level, error, context) {
  const event = {
    level,
    message: (error && error.message != null) ? String(error.message) : String(error),
    code: error && error.code != null ? error.code : undefined,
    context: context ?? null,
    at: Date.now(),
  };
  _events.push(event);
  if (_events.length > MAX_REPORT_EVENTS) {
    _events.splice(0, _events.length - MAX_REPORT_EVENTS);
  }
  // Reporting must never mask or replace the failure it is reporting: a broken
  // sink cannot be allowed to throw out of a catch block.
  if (_sink) {
    try { _sink(event, error); } catch (_) { /* swallow */ }
  }
  return event;
}

export function captureException(error, context) {
  console.error('[report]', (error && error.message) || error, context ?? '');
  return record('error', error, context);
}

export function captureMessage(message, context) {
  console.warn('[report]', message, context ?? '');
  return record('warn', { message }, context);
}

// A defensive copy — callers must not be able to mutate the internal buffer.
export function getRecentEvents() {
  return _events.slice();
}

// Test-only: clear the buffer and detach any sink.
export function _resetErrorReportingForTests() {
  _events.length = 0;
  _sink = null;
}
