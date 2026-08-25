/**
 * @jest-environment jsdom
 */
import React from 'react';
import { Text, Platform } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
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

// Mobile browsers suspend a geolocation watch while the page is hidden and
// often never resume it: the watch stays registered but silent, which froze
// the live fix until the user reloaded. Coming back to the foreground has to
// start a fresh watch.
test('web restarts the watch when the page comes back to the foreground', async () => {
  const osDesc = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  const geolocation = {
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(() => 11),
    clearWatch: jest.fn(),
  };
  const visDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  let visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  navigator.geolocation = geolocation;
  try {
    render(<Probe />);
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(1));

    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1); // hidden: nothing to do

    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(2));
    expect(geolocation.clearWatch).toHaveBeenCalledWith(11); // the stale watch is dropped
  } finally {
    Object.defineProperty(Platform, 'OS', osDesc);
    delete document.visibilityState;
    if (visDesc) Object.defineProperty(Document.prototype, 'visibilityState', visDesc);
  }
});
