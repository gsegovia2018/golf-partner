import { captureMessage } from '../lib/errorReporting';

// The floating tab bar sometimes vanishes on Android (2026-11-03): still in
// the view tree and tappable, but not drawn. This keeps a short trail of what
// the bar went through and sends it to Sentry (lib/errorReporting) when the
// bar's own state says it should show but cannot, or when the golfer
// long-presses a tab to report it. If a report says everything looked right,
// the fault is in what Android drew, not in the bar's state.

const TRAIL_MAX = 15;
const AUTO_GAP_MS = 10 * 60 * 1000;
const USER_GAP_MS = 5 * 1000;

const trail = [];
const probes = { host: null, bar: null };
let lastAuto = 0;
let lastUser = 0;

export function noteTabBar(what, data) {
  trail.push({ at: Date.now(), what, ...data });
  if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX);
}

// TabBarHost ('host': top route, visible, fade) and FloatingTabBar ('bar':
// collapse, menu, keyboard) each register a function reading their live values.
export function setTabBarProbe(part, fn) {
  probes[part] = fn;
}

export function readTabBar() {
  const snap = {};
  for (const part of ['host', 'bar']) {
    try {
      Object.assign(snap, probes[part] ? probes[part]() : (part === 'bar' ? { mounted: false } : {}));
    } catch (e) {
      snap[`${part}ProbeError`] = String(e?.message ?? e);
    }
  }
  return snap;
}

// True when the host wants the bar shown but its values keep it out of sight.
export function tabBarLooksHidden(snap) {
  if (!snap.visible) return false;
  return snap.shown < 0.99
    || snap.mounted === false
    || snap.keyboard === true
    || (snap.menuOpen === false && snap.open > 0.01);
}

function send(reason, snap) {
  const now = Date.now();
  captureMessage(`Tab bar: ${reason}`, {
    ...snap,
    trail: trail.map(({ at, ...e }) => ({ ...e, msAgo: now - at })),
  });
}

export function reportTabBarIfHidden(snap = readTabBar()) {
  if (!tabBarLooksHidden(snap)) return false;
  const now = Date.now();
  if (now - lastAuto < AUTO_GAP_MS) return false;
  lastAuto = now;
  send('hidden after navigation', snap);
  return true;
}

export function reportTabBarByUser(snap = readTabBar()) {
  const now = Date.now();
  if (now - lastUser < USER_GAP_MS) return false;
  lastUser = now;
  send('reported by user', snap);
  return true;
}

export function _resetTabBarWatchForTests() {
  trail.length = 0;
  probes.host = null;
  probes.bar = null;
  lastAuto = 0;
  lastUser = 0;
}
