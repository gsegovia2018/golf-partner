import React from 'react';
import { Text, Platform } from 'react-native';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { DeviceMotion, Magnetometer } from 'expo-sensors';
import {
  useCompassHeading, smoothHeading, compassLikelyAvailable,
  cameraHeadingFromDeviceMotion, cameraHeadingFromOrientation,
} from '../useCompassHeading';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  watchHeadingAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

jest.mock('expo-sensors', () => {
  const sensor = () => ({
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  });
  return { DeviceMotion: sensor(), Magnetometer: sensor() };
});

function Probe() {
  const c = useCompassHeading();
  return <Text testID="out">{JSON.stringify({ h: c.heading, l: c.lowAccuracy, s: c.status })}</Text>;
}

// Rotation matrix (device -> world east/north/up, row-major) from a
// quaternion, the way Android's getRotationMatrixFromVector builds it.
function rotFromQuat(w0, x0, y0, z0) {
  const n = Math.hypot(w0, x0, y0, z0);
  const [w, x, y, z] = [w0 / n, x0 / n, y0 / n, z0 / n];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

// What expo-sensors' DeviceMotion reports for R on Android:
// SensorManager.getOrientation, then alpha = -azimuth, beta = -pitch.
function expoRotationOf(R) {
  return {
    alpha: -Math.atan2(R[1], R[4]),
    beta: -Math.asin(-R[7]),
    gamma: Math.atan2(-R[6], R[8]),
  };
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

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

describe('cameraHeadingFromDeviceMotion (Android)', () => {
  // Held upright with the camera tilted 5° up. Exactly vertical is an Euler
  // gimbal lock — getOrientation itself returns atan2(0, 0) for the azimuth —
  // which a hand-held phone never sits on.
  const c5 = Math.cos((5 * Math.PI) / 180);
  const s5 = Math.sin((5 * Math.PI) / 180);

  test('upright phone, camera facing north -> 0', () => {
    // Device X east, Y up, Z (out of the screen) south.
    const R = [1, 0, 0, 0, -s5, -c5, 0, c5, -s5];
    const r = cameraHeadingFromDeviceMotion(expoRotationOf(R));
    expect(r.flat).toBe(false);
    expect(angleDiff(r.deg, 0)).toBeLessThan(1e-6);
  });

  test('upright phone, camera facing east -> 90', () => {
    // Device X south, Y up, Z west.
    const R = [0, -s5, -c5, -1, 0, 0, 0, c5, -s5];
    expect(angleDiff(cameraHeadingFromDeviceMotion(expoRotationOf(R)).deg, 90)).toBeLessThan(1e-6);
  });

  test('matches the true camera axis for arbitrary orientations', () => {
    // Seeded LCG so a failure reproduces.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    for (let i = 0; i < 2000; i += 1) {
      const R = rotFromQuat(rnd(), rnd(), rnd(), rnd());
      const east = -R[2];
      const north = -R[5];
      const r = cameraHeadingFromDeviceMotion(expoRotationOf(R));
      if (Math.hypot(east, north) < 0.35) {
        expect(r.flat).toBe(true);
      } else {
        const want = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
        expect(angleDiff(r.deg, want)).toBeLessThan(1e-6);
      }
    }
  });

  test('a phone lying flat has no camera heading', () => {
    expect(cameraHeadingFromDeviceMotion({ alpha: 1, beta: 0, gamma: 0 })).toEqual({ deg: null, flat: true });
  });

  test('missing angles return null', () => {
    expect(cameraHeadingFromDeviceMotion(undefined)).toBeNull();
    expect(cameraHeadingFromDeviceMotion({ alpha: 0, beta: null, gamma: 0 })).toBeNull();
  });
});

describe('cameraHeadingFromOrientation (web)', () => {
  test('upright portrait: alpha counter-clockwise becomes a clockwise heading', () => {
    expect(angleDiff(cameraHeadingFromOrientation(0, 90, 0).deg, 0)).toBeLessThan(1e-6);
    expect(angleDiff(cameraHeadingFromOrientation(90, 90, 0).deg, 270)).toBeLessThan(1e-6);
    expect(angleDiff(cameraHeadingFromOrientation(270, 90, 0).deg, 90)).toBeLessThan(1e-6);
  });

  test('tilting the phone back keeps the heading', () => {
    expect(angleDiff(cameraHeadingFromOrientation(90, 60, 0).deg, 270)).toBeLessThan(1e-6);
    expect(angleDiff(cameraHeadingFromOrientation(90, 120, 0).deg, 270)).toBeLessThan(1e-6);
  });

  test('flat on a table is flat', () => {
    expect(cameraHeadingFromOrientation(123, 0, 0)).toEqual({ deg: null, flat: true });
  });

  test('missing beta/gamma return null', () => {
    expect(cameraHeadingFromOrientation(90, null, 0)).toBeNull();
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

describe('android', () => {
  let osDesc;
  beforeEach(() => {
    osDesc = Object.getOwnPropertyDescriptor(Platform, 'OS');
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    DeviceMotion.isAvailableAsync.mockResolvedValue(true);
    Magnetometer.isAvailableAsync.mockResolvedValue(true);
  });
  afterEach(() => { Object.defineProperty(Platform, 'OS', osDesc); });

  const motionCb = () => DeviceMotion.addListener.mock.calls.at(-1)[0];
  const magCb = () => Magnetometer.addListener.mock.calls.at(-1)[0];

  function FlatProbe() {
    const c = useCompassHeading();
    return <Text testID="out">{JSON.stringify({ h: c.heading, l: c.lowAccuracy, f: c.flat, s: c.status })}</Text>;
  }

  test('reports the camera heading from DeviceMotion, not the location heading', async () => {
    render(<FlatProbe />);
    await waitFor(() => expect(DeviceMotion.addListener).toHaveBeenCalled());
    expect(DeviceMotion.setUpdateInterval).toHaveBeenCalledWith(50);
    // Upright, camera facing north.
    await act(async () => { motionCb()({ rotation: { alpha: 0, beta: Math.PI / 2, gamma: 0 } }); });
    expect(out().h).toBeCloseTo(0, 6);
    expect(out()).toMatchObject({ f: false, s: 'ok' });
    expect(Location.watchHeadingAsync).not.toHaveBeenCalled();
  });

  test('a flat phone sets flat and keeps the last heading', async () => {
    render(<FlatProbe />);
    await waitFor(() => expect(DeviceMotion.addListener).toHaveBeenCalled());
    await act(async () => { motionCb()({ rotation: { alpha: 0, beta: Math.PI / 2, gamma: 0 } }); });
    await act(async () => { motionCb()({ rotation: { alpha: 1, beta: 0, gamma: 0 } }); });
    expect(out()).toMatchObject({ f: true, s: 'ok' });
    expect(out().h).toBeCloseTo(0, 6);
    await act(async () => { motionCb()({ rotation: { alpha: 0, beta: Math.PI / 2, gamma: 0 } }); });
    expect(out().f).toBe(false);
  });

  test('a magnetometer field outside Earth range raises lowAccuracy', async () => {
    render(<FlatProbe />);
    await waitFor(() => expect(Magnetometer.addListener).toHaveBeenCalled());
    await act(async () => { magCb()({ x: 150, y: 0, z: 0 }); });
    expect(out().l).toBe(true);
    await act(async () => { magCb()({ x: 30, y: 0, z: -30 }); });
    expect(out().l).toBe(false);
  });

  test('no DeviceMotion sensor reports unavailable', async () => {
    DeviceMotion.isAvailableAsync.mockResolvedValueOnce(false);
    render(<FlatProbe />);
    await waitFor(() => expect(out().s).toBe('unavailable'));
    expect(DeviceMotion.addListener).not.toHaveBeenCalled();
  });

  test('unmount removes both listeners', async () => {
    const motionRemove = jest.fn();
    const magRemove = jest.fn(() => { throw new Error('gone'); });
    DeviceMotion.addListener.mockReturnValueOnce({ remove: motionRemove });
    Magnetometer.addListener.mockReturnValueOnce({ remove: magRemove });
    const view = render(<FlatProbe />);
    await waitFor(() => expect(Magnetometer.addListener).toHaveBeenCalled());
    expect(() => view.unmount()).not.toThrow();
    expect(motionRemove).toHaveBeenCalled();
    expect(magRemove).toHaveBeenCalled();
  });
});

describe('ios (expo-location heading)', () => {
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
  test('deviceorientationabsolute on an upright phone becomes a clockwise camera heading', async () => {
    const web = setupWeb();
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener)
        .toHaveBeenCalledWith('deviceorientationabsolute', expect.any(Function), true));

      await web.fire('deviceorientationabsolute', { alpha: 90, beta: 90, gamma: 0, absolute: true });
      // alpha counts counter-clockwise: 90 → 270.
      expect(out().h).toBeCloseTo(270, 6);
      expect(out()).toMatchObject({ l: false, s: 'ok' });
    } finally { web.restore(); }
  });

  test('the screen orientation angle does not move the camera heading', async () => {
    const web = setupWeb({ screenAngle: 90 });
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener).toHaveBeenCalled());
      await web.fire('deviceorientationabsolute', { alpha: 30, beta: 90, gamma: 0, absolute: true });
      expect(out().h).toBeCloseTo(330, 6);
    } finally { web.restore(); }
  });

  test('relative deviceorientation events are ignored, absolute ones are used', async () => {
    const web = setupWeb();
    try {
      render(<Probe />);
      await waitFor(() => expect(global.addEventListener)
        .toHaveBeenCalledWith('deviceorientation', expect.any(Function), true));

      await web.fire('deviceorientation', { alpha: 90, beta: 90, gamma: 0, absolute: false });
      expect(out()).toEqual({ h: null, l: false, s: 'acquiring' });

      await web.fire('deviceorientation', { alpha: 90, beta: 90, gamma: 0, absolute: true });
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
      await web.fire('deviceorientationabsolute', { alpha: 0, beta: 90, gamma: 0, absolute: true });
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
