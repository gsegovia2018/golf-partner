/**
 * @jest-environment node
 */
import React from 'react';
import { Text, AppState } from 'react-native';
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

// Two tests share the expo-location mock; only the call counts need resetting
// between them (clearAllMocks leaves the factory's implementations in place).
beforeEach(() => { jest.clearAllMocks(); });

// The hook's WAKE_PROBE_MS — a wake gives the provider this long to answer
// before the watch is restarted.
const PROBE_MS = 3000;

// The RNTL wait helper drives its own clock, which fights the fake timers
// these tests need to step over the wake probe. The pending work is a short
// promise chain, so draining microtasks is enough to settle it.
const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

// Take over AppState so a test can drive the foreground transition itself.
function captureAppState() {
  const handlers = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') handlers.push(handler);
    return { remove: jest.fn() };
  });
  return {
    send: (state) => handlers.forEach((h) => h(state)),
    restore: () => spy.mockRestore(),
  };
}

// The native counterpart of the web wake test: Android suspends the
// expo-location watch when the screen locks or the user switches app — which
// is what pocketing the phone between shots does — and does not reliably
// resume it. Returning to a provider that has gone quiet has to start a fresh
// watch, and there is no `document` out here to hang a visibilitychange
// listener on.
test('native restarts the watch when a wake finds the provider silent', async () => {
  const Location = require('expo-location');
  Location.getCurrentPositionAsync.mockResolvedValue(null); // never yields a fix
  jest.useFakeTimers();
  const appState = captureAppState();

  try {
    render(<Probe />);
    await flush();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    await act(async () => { appState.send('background'); });
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1); // backgrounded: nothing to do

    await act(async () => { appState.send('active'); });
    // The probe is out and unanswered — the watch is not dropped until it
    // times out.
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
  } finally {
    appState.restore();
    jest.useRealTimers();
  }
});

// The regression this guards: restarting on every 'active' dropped a healthy
// watch and forced a cold high-accuracy re-lock, so the distance sat on its
// old value for seconds every time the phone came out of a pocket. Android
// also reaches 'active' for things that never suspended the watch at all —
// a permission dialog, the notification shade, an unlock.
test('native leaves a live watch alone when a wake is answered', async () => {
  const Location = require('expo-location');
  Location.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 40.1, longitude: -3.7, accuracy: 5 },
  });
  jest.useFakeTimers();
  const appState = captureAppState();

  try {
    render(<Probe />);
    await flush();
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    await act(async () => { appState.send('background'); });
    await act(async () => { appState.send('active'); });
    await flush(); // the probe answers
    await act(async () => { jest.advanceTimersByTime(PROBE_MS + 10); });
    await flush();

    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
  } finally {
    appState.restore();
    jest.useRealTimers();
  }
});
