/**
 * @jest-environment jsdom
 */
import React from 'react';
import { Text, Platform } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { useGpsDistances } from '../useGpsDistances';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  Accuracy: { High: 4 },
}));
jest.mock('../../lib/geo', () => ({
  findCourseGeometry: jest.fn(() => ({ holes: {} })),
  holeFeatures: jest.fn(() => null),
  haversineMeters: jest.fn(() => 0),
  subscribeCourseGeometry: jest.fn(() => () => {}),
  getCourseGeometryVersion: jest.fn(() => 1),
}));
jest.mock('../../lib/flyoverModel', () => ({
  resolveScorecardDistances: jest.fn(({ fix }) => (fix
    ? { distances: { center: 120 }, source: 'gps' }
    : { distances: { center: 340 }, source: 'tee' })),
}));
jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(),
}));

function Probe() {
  const gps = useGpsDistances('C', 1);
  return <Text testID="out">{JSON.stringify(gps.position)}</Text>;
}

// The hook's WAKE_PROBE_MS — a wake gives the provider this long to answer
// before the watch is restarted.
const PROBE_MS = 3000;

// A web environment with a scripted geolocation provider. `state.answers`
// decides whether the provider ever calls back — flip it to false mid-test to
// play the watch a hidden page suspended. A live provider also delivers one
// fix as the watch registers, which is what tells the hook the watch works.
function webEnv({ answers = true } = {}) {
  const osDesc = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  const visDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const state = { visibility: 'visible', answers };
  const FIX = { coords: { latitude: 40.1, longitude: -3.7, accuracy: 5 } };
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state.visibility,
  });
  const geolocation = {
    getCurrentPosition: jest.fn((ok) => { if (state.answers) ok(FIX); }),
    watchPosition: jest.fn((ok) => { if (state.answers) ok(FIX); return 11; }),
    clearWatch: jest.fn(),
  };
  navigator.geolocation = geolocation;
  return {
    geolocation,
    state,
    restore: () => {
      Object.defineProperty(Platform, 'OS', osDesc);
      delete document.visibilityState;
      if (visDesc) Object.defineProperty(Document.prototype, 'visibilityState', visDesc);
    },
  };
}

// The RNTL wait helper drives its own clock, which fights the fake timers
// these tests need to step over the wake probe. The pending work is a short
// promise chain (permission check -> watch start), so draining microtasks is
// enough to settle it.
const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const pageshow = (persisted) => {
  const e = new Event('pageshow');
  Object.defineProperty(e, 'persisted', { value: persisted });
  return e;
};

// Mobile browsers suspend a geolocation watch while the page is hidden and
// often never resume it: the watch stays registered but silent, which froze
// the live fix until the user reloaded. A wake that finds the provider gone
// quiet has to start a fresh watch.
test('web restarts the watch when a wake finds the provider silent', async () => {
  jest.useFakeTimers();
  const env = webEnv();
  try {
    render(<Probe />);
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);

    env.state.visibility = 'hidden';
    env.state.answers = false; // hidden page: the provider stops answering
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1); // hidden: nothing to do

    env.state.visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    // The probe is out but unanswered — the restart waits for it to time out
    // rather than dropping a watch that might still be delivering.
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(2);
    expect(env.geolocation.clearWatch).toHaveBeenCalledWith(11); // the stale watch is dropped
  } finally {
    env.restore();
    jest.useRealTimers();
  }
});

// The regression this guards: restarting on every wake drops a healthy watch
// and forces a cold high-accuracy re-lock (maximumAge: 0), so the distance sat
// on its old value for seconds every time the phone came out of a pocket.
test('web leaves a live watch alone when a wake is answered', async () => {
  jest.useFakeTimers();
  const env = webEnv();
  try {
    render(<Probe />);
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);

    env.state.visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    env.state.visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();

    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(env.geolocation.clearWatch).not.toHaveBeenCalled();
  } finally {
    env.restore();
    jest.useRealTimers();
  }
});

// pageshow fires on every normal load, not only on the bfcache restore it is
// here for, and the listener is attached before `load` — so an unguarded
// handler made a cold start restart the very watch it was still acquiring.
test('web ignores the pageshow of a normal page load', async () => {
  jest.useFakeTimers();
  const env = webEnv();
  try {
    render(<Probe />);
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    env.state.answers = false;

    await act(async () => { window.dispatchEvent(pageshow(false)); });
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);

    // A real bfcache restore still counts as a wake.
    await act(async () => { window.dispatchEvent(pageshow(true)); });
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(2);
  } finally {
    env.restore();
    jest.useRealTimers();
  }
});

// A bfcache restore fires visibilitychange and pageshow together. Two restarts
// back to back is worse than one: the second kills the acquisition the first
// just started.
test('web collapses two wake signals for one return into a single restart', async () => {
  jest.useFakeTimers();
  const env = webEnv();
  try {
    render(<Probe />);
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    env.state.answers = false;

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(pageshow(true));
    });
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(2);

    // No second probe was ever armed, so nothing else fires.
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(2);
  } finally {
    env.restore();
    jest.useRealTimers();
  }
});

// The regression that made the first fix take forever: a cold high-accuracy
// lock takes longer than WAKE_PROBE_MS, so a watch that hasn't answered yet
// looks identical to a suspended one. Restarting it there throws the
// acquisition away and starts the cold lock again — and the OS hands out
// wake signals freely while acquiring (a permission dialog closing, an
// unlock). A watch that has never delivered is left to keep trying.
test('web leaves a watch still acquiring its first fix alone', async () => {
  jest.useFakeTimers();
  const env = webEnv({ answers: false }); // never delivered a fix yet
  try {
    render(<Probe />);
    await flush();
    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);

    env.state.visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    env.state.visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();

    expect(env.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(env.geolocation.clearWatch).not.toHaveBeenCalled();
  } finally {
    env.restore();
    jest.useRealTimers();
  }
});
