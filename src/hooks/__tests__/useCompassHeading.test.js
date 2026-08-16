import React from 'react';
import { Text, Platform } from 'react-native';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useCompassHeading, smoothHeading, compassLikelyAvailable } from '../useCompassHeading';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  watchHeadingAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

function Probe() {
  const c = useCompassHeading();
  return <Text testID="out">{JSON.stringify({ h: c.heading, l: c.lowAccuracy, s: c.status })}</Text>;
}

const out = () => JSON.parse(screen.getByTestId('out').props.children);

// The expo mock hands the same callback back to every test; grab it from the
// most recent watchHeadingAsync call and drive it like the sensor would.
const emitNative = async (h) => {
  const cb = Location.watchHeadingAsync.mock.calls.at(-1)[0];
  await act(async () => { cb(h); });
};

// jest-expo runs with window === global and no DOM event plumbing, so the web
// path needs the handful of globals it touches stubbed in. Returns a `fire`
// that invokes whatever the hook registered, plus the teardown.
function setupWeb({ requestPermission, maxTouchPoints = 5, screenAngle = 0 } = {}) {
  const osDesc = Object.getOwnPropertyDescriptor(Platform, 'OS');
  const navDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  Object.defineProperty(global, 'navigator', { configurable: true, value: { maxTouchPoints } });

  const listeners = {};
  const DeviceOrientationEvent = function DeviceOrientationEventStub() {};
  if (requestPermission) DeviceOrientationEvent.requestPermission = requestPermission;
  global.DeviceOrientationEvent = DeviceOrientationEvent;
  global.screen = { orientation: { angle: screenAngle } };
  global.addEventListener = jest.fn((type, fn) => { listeners[type] = fn; });
  global.removeEventListener = jest.fn((type) => { delete listeners[type]; });

  return {
    listeners,
    fire: async (type, event) => {
      await act(async () => { listeners[type]?.({ type, ...event }); });
    },
    restore: () => {
      Object.defineProperty(Platform, 'OS', osDesc);
      if (navDesc) Object.defineProperty(global, 'navigator', navDesc);
      else delete global.navigator;
      delete global.DeviceOrientationEvent;
      delete global.screen;
      delete global.addEventListener;
      delete global.removeEventListener;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.watchHeadingAsync.mockResolvedValue({ remove: jest.fn() });
});

describe('smoothHeading', () => {
  test('first reading is adopted verbatim and normalised into 0–360', () => {
    expect(smoothHeading(null, 90).deg).toBeCloseTo(90, 6);
    expect(smoothHeading(null, -90).deg).toBeCloseTo(270, 6);
    expect(smoothHeading(null, 370).deg).toBeCloseTo(10, 6);
  });

  test('converges toward a steady input', () => {
    let s = smoothHeading(null, 0);
    for (let i = 0; i < 40; i += 1) s = smoothHeading(s, 120);
    expect(s.deg).toBeCloseTo(120, 3);
  });

  test('lags a step change instead of jumping (that is the point of the filter)', () => {
    const s = smoothHeading(smoothHeading(null, 0), 90);
    expect(s.deg).toBeGreaterThan(0);
    expect(s.deg).toBeLessThan(45);
  });

  test('wrap-around: alternating 359 and 1 smooths to ~0, never ~180', () => {
    let s = smoothHeading(null, 359);
    for (let i = 0; i < 40; i += 1) s = smoothHeading(s, i % 2 === 0 ? 1 : 359);
    // Naive degree averaging lands on 180 here — the sin/cos filter must not.
    const offNorth = Math.min(s.deg, 360 - s.deg);
    expect(offNorth).toBeLessThan(2);
  });

  test('non-finite readings are ignored, keeping the previous state', () => {
    const s = smoothHeading(null, 45);
    expect(smoothHeading(s, NaN)).toBe(s);
    expect(smoothHeading(s, undefined)).toBe(s);
    expect(smoothHeading(null, NaN)).toBeNull();
  });
});

describe('compassLikelyAvailable', () => {
  test('native is always a candidate', () => {
    expect(compassLikelyAvailable()).toBe(true);
  });

  test('web with touch points and the constructor is a candidate', () => {
    const web = setupWeb();
    try {
      expect(compassLikelyAvailable()).toBe(true);
    } finally { web.restore(); }
  });

  test('web without touch points (desktop) is not', () => {
    const web = setupWeb({ maxTouchPoints: 0 });
    try {
      expect(compassLikelyAvailable()).toBe(false);
    } finally { web.restore(); }
  });
});

describe('native', () => {
  test('starts acquiring, then reports smoothed headings from the watch', async () => {
    render(<Probe />);
    expect(out()).toEqual({ h: null, l: false, s: 'acquiring' });
    await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalled());

    await emitNative({ trueHeading: 90, magHeading: 88, accuracy: 3 });
    expect(out()).toEqual({ h: 90, l: false, s: 'ok' });
  });

  test('prefers trueHeading over magHeading when it is valid', async () => {
    render(<Probe />);
    await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalled());
    await emitNative({ trueHeading: 200, magHeading: 10, accuracy: 3 });
    expect(out().h).toBeCloseTo(200, 6);
  });

  test('falls back to magHeading when trueHeading is -1 (no location fix yet)', async () => {
    render(<Probe />);
    await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalled());
    await emitNative({ trueHeading: -1, magHeading: 45, accuracy: 3 });
    expect(out().h).toBeCloseTo(45, 6);
  });

  test('accuracy <= 1 raises lowAccuracy, and a good reading clears it', async () => {
    render(<Probe />);
    await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalled());
    await emitNative({ trueHeading: 10, magHeading: 10, accuracy: 1 });
    expect(out().l).toBe(true);
    await emitNative({ trueHeading: 10, magHeading: 10, accuracy: 2 });
    expect(out().l).toBe(false);
  });

  test('denied location permission reports unavailable (no sensor on Android without it)', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    render(<Probe />);
    await waitFor(() => expect(out().s).toBe('unavailable'));
    expect(Location.watchHeadingAsync).not.toHaveBeenCalled();
  });

  test('a throwing watch reports unavailable instead of crashing', async () => {
    Location.watchHeadingAsync.mockRejectedValueOnce(new Error('no magnetometer'));
    render(<Probe />);
    await waitFor(() => expect(out().s).toBe('unavailable'));
  });

  test('unmount removes the subscription, even when remove() throws', async () => {
    const remove = jest.fn(() => { throw new Error('removeSubscription is not a function'); });
    Location.watchHeadingAsync.mockResolvedValue({ remove });
    const view = render(<Probe />);
    await waitFor(() => expect(Location.watchHeadingAsync).toHaveBeenCalled());
    expect(() => view.unmount()).not.toThrow();
    expect(remove).toHaveBeenCalled();
  });
});

describe('web', () => {
  test('deviceorientationabsolute alpha becomes a clockwise-from-north heading', async () => {
    const web = setupWeb();
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener)
        .toHaveBeenCalledWith('deviceorientationabsolute', expect.any(Function), true));

      await web.fire('deviceorientationabsolute', { alpha: 90, absolute: true });
      // alpha counts counter-clockwise: 90 → 270.
      expect(out()).toEqual({ h: 270, l: false, s: 'ok' });
    } finally { web.restore(); }
  });

  test('the screen orientation angle is added to the heading', async () => {
    const web = setupWeb({ screenAngle: 90 });
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener).toHaveBeenCalled());
      await web.fire('deviceorientationabsolute', { alpha: 30, absolute: true });
      expect(out().h).toBeCloseTo((360 - 30 + 90) % 360, 6);
    } finally { web.restore(); }
  });

  test('relative deviceorientation events are ignored, absolute ones are used', async () => {
    const web = setupWeb();
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener)
        .toHaveBeenCalledWith('deviceorientation', expect.any(Function), true));

      await web.fire('deviceorientation', { alpha: 90, absolute: false });
      expect(out()).toEqual({ h: null, l: false, s: 'acquiring' });

      await web.fire('deviceorientation', { alpha: 90, absolute: true });
      expect(out().h).toBeCloseTo(270, 6);
    } finally { web.restore(); }
  });

  test('iOS webkitCompassHeading is used as-is, not inverted', async () => {
    const web = setupWeb();
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener).toHaveBeenCalled());
      // alpha would invert to 270; webkitCompassHeading must win untouched.
      await web.fire('deviceorientation', { webkitCompassHeading: 90, webkitCompassAccuracy: 10, alpha: 90 });
      expect(out()).toEqual({ h: 90, l: false, s: 'ok' });
    } finally { web.restore(); }
  });

  test('webkitCompassAccuracy worse than 30 degrees raises lowAccuracy', async () => {
    const web = setupWeb();
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener).toHaveBeenCalled());
      await web.fire('deviceorientation', { webkitCompassHeading: 90, webkitCompassAccuracy: 45 });
      expect(out().l).toBe(true);
    } finally { web.restore(); }
  });

  test('no events within the timeout reports unavailable (desktop browsers)', async () => {
    jest.useFakeTimers();
    const web = setupWeb();
    try {
      render(<Probe />);
      expect(out().s).toBe('acquiring');
      await act(async () => { jest.advanceTimersByTime(3001); });
      expect(out().s).toBe('unavailable');
    } finally {
      web.restore();
      jest.useRealTimers();
    }
  });

  test('an event before the timeout keeps the status ok (the timer is cleared)', async () => {
    jest.useFakeTimers();
    const web = setupWeb();
    try {
      render(<Probe />);
      await web.fire('deviceorientationabsolute', { alpha: 0, absolute: true });
      await act(async () => { jest.advanceTimersByTime(10000); });
      expect(out().s).toBe('ok');
    } finally {
      web.restore();
      jest.useRealTimers();
    }
  });

  test('no sensor (desktop, no touch points) is unavailable without listening', async () => {
    const web = setupWeb({ maxTouchPoints: 0 });
    try {
      render(<Probe />);
      await waitFor(() => expect(out().s).toBe('unavailable'));
      expect(global.addEventListener).not.toHaveBeenCalled();
    } finally { web.restore(); }
  });

  test('iOS Safari waits on a tap: needs-permission until requestPermission grants', async () => {
    const requestPermission = jest.fn().mockResolvedValue('granted');
    const web = setupWeb({ requestPermission });
    try {
      let api = null;
      function PermProbe() {
        api = useCompassHeading();
        return <Text testID="out">{JSON.stringify({ h: api.heading, l: api.lowAccuracy, s: api.status })}</Text>;
      }
      render(<PermProbe />);
      await waitFor(() => expect(out().s).toBe('needs-permission'));
      expect(global.addEventListener).not.toHaveBeenCalled();

      await act(async () => { await api.requestPermission(); });
      expect(requestPermission).toHaveBeenCalled();
      await waitFor(() => expect(global.addEventListener).toHaveBeenCalled());

      await web.fire('deviceorientation', { webkitCompassHeading: 120 });
      expect(out()).toEqual({ h: 120, l: false, s: 'ok' });
    } finally { web.restore(); }
  });

  test('a denied prompt stays on needs-permission so the user can tap again', async () => {
    const requestPermission = jest.fn().mockResolvedValue('denied');
    const web = setupWeb({ requestPermission });
    try {
      let api = null;
      function PermProbe() {
        api = useCompassHeading();
        return <Text testID="out">{JSON.stringify({ h: api.heading, l: api.lowAccuracy, s: api.status })}</Text>;
      }
      render(<PermProbe />);
      await waitFor(() => expect(out().s).toBe('needs-permission'));
      await act(async () => { expect(await api.requestPermission()).toBe(false); });
      expect(out().s).toBe('needs-permission');
      expect(global.addEventListener).not.toHaveBeenCalled();
    } finally { web.restore(); }
  });

  test('unmount detaches both listeners without throwing', async () => {
    const web = setupWeb();
    try {
      const view = render(<Probe />);
      await waitFor(() => expect(global.addEventListener).toHaveBeenCalledTimes(2));
      expect(() => view.unmount()).not.toThrow();
      expect(global.removeEventListener)
        .toHaveBeenCalledWith('deviceorientationabsolute', expect.any(Function), true);
      expect(global.removeEventListener)
        .toHaveBeenCalledWith('deviceorientation', expect.any(Function), true);
    } finally { web.restore(); }
  });
});
