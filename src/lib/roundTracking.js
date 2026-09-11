import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Keeps GPS alive while a live round's scorecard is open, screen off or not.
//
// Android stops delivering location to an app that is not visible, so every
// time the phone came out of a pocket the header and the map sat on a fix
// seconds behind the player until the watch re-locked. The only sanctioned way
// to keep the GPS engine running is a foreground service with a persistent
// notification, which is what expo-location's task API runs under the hood.
// Fixes it delivers are published here; useGpsDistances seeds from and
// subscribes to this feed, so they pass through the same quality gate as the
// foreground watch's own.
//
// Design: docs/superpowers/specs/2026-09-11-background-gps-tracking-design.md
//
// This module is imported from index.js: expo-task-manager needs the task
// defined before the app renders. Android only — web cannot run location
// while hidden and iOS is not shipped.

export const ROUND_LOCATION_TASK = 'golf-round-location';
// A text change re-posts the notification; the shade re-renders it silently
// (the channel is low importance) but there is no reason to do that faster
// than a walking player can read it.
export const NOTIFICATION_UPDATE_MIN_MS = 3000;
const NOTIFICATION_COLOR = '#006747';

export const isRoundTrackingSupported = () => Platform.OS === 'android';

let latest = null;
const listeners = new Set();

export const getLiveFix = () => latest;

export function subscribeLiveFix(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function publish(loc) {
  latest = loc;
  listeners.forEach((fn) => fn(loc));
}

if (isRoundTrackingSupported()) {
  TaskManager.defineTask(ROUND_LOCATION_TASK, ({ data, error }) => {
    if (error) return;
    const locs = data?.locations;
    if (locs?.length) publish(locs[locs.length - 1]);
  });
}

let desired = null; // { title, body } the caller wants on screen; null = stop
let posted = null; // text the running service was last given
let postedAt = 0;
let timer = null;
let queue = Promise.resolve(); // start/update/stop never overlap
let wakeSub = null;

const enqueue = (job) => {
  queue = queue.then(job, job);
  return queue;
};

async function post(text) {
  // Calling start again on a running task updates its options — expo-location
  // re-posts the notification with the new text rather than restarting the
  // service.
  await Location.startLocationUpdatesAsync(ROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 2000,
    distanceInterval: 2,
    foregroundService: {
      notificationTitle: text.title,
      notificationBody: text.body,
      notificationColor: NOTIFICATION_COLOR,
      killServiceOnDestroy: true,
    },
  });
  // A stop that landed while the call was in flight has already cleared
  // `desired`; recording this text as posted would make the next identical
  // request dedupe against a service that is no longer running.
  if (desired === text) {
    posted = text;
    postedAt = Date.now();
  }
}

function flush() {
  timer = null;
  const text = desired;
  if (!text) return;
  if (posted && posted.title === text.title && posted.body === text.body) return;
  const wait = NOTIFICATION_UPDATE_MIN_MS - (Date.now() - postedAt);
  if (posted && wait > 0) {
    timer = setTimeout(flush, wait);
    return;
  }
  enqueue(async () => {
    if (desired !== text) return; // superseded while queued
    try {
      await post(text);
    } catch {
      // Not foregrounded yet, or permission still pending: the next text
      // change or the next return to the foreground retries. The foreground
      // watch keeps the header alive meanwhile.
    }
  });
}

// Starting is only allowed while the app is visible. If the first attempt
// raced a screen lock, retry once the app is back.
function ensureWakeRetry() {
  if (wakeSub) return;
  wakeSub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && desired && !posted && !timer) flush();
  });
}

function stop() {
  desired = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  posted = null;
  postedAt = 0;
  latest = null;
  enqueue(async () => {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(ROUND_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(ROUND_LOCATION_TASK);
      }
    } catch {
      // Nothing to stop, or the task manager is unavailable — either way the
      // service is not running.
    }
  });
}

// The single control surface. `{ title, body }` starts the service if it is
// not running and updates the notification text; identical text is a no-op
// and changes are posted at most once per NOTIFICATION_UPDATE_MIN_MS. `null`
// stops the service and drops the live fix.
export function setRoundTracking(text) {
  if (!isRoundTrackingSupported()) return;
  if (!text) {
    stop();
    return;
  }
  desired = text;
  ensureWakeRetry();
  if (!timer) flush();
}

export function __resetRoundTrackingForTests() {
  desired = null;
  posted = null;
  postedAt = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  queue = Promise.resolve();
  wakeSub?.remove?.();
  wakeSub = null;
  latest = null;
  listeners.clear();
}
