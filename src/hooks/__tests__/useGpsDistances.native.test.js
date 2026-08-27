/**
 * @jest-environment node
 */
import React from 'react';
import { Text, AppState } from 'react-native';
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

// The native counterpart of the web wake test: Android suspends the
// expo-location watch when the screen locks or the user switches app — which
// is what pocketing the phone between shots does — and does not reliably
// resume it. Returning to the foreground has to start a fresh watch, and
// there is no `document` out here to hang a visibilitychange listener on.
test('native restarts the watch when the app returns to the foreground', async () => {
  const Location = require('expo-location');
  let onAppState;
  const remove = jest.fn();
  const sub = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') onAppState = handler;
    return { remove };
  });

  try {
    render(<Probe />);
    await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1));

    await act(async () => { onAppState('background'); });
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1); // backgrounded: nothing to do

    await act(async () => { onAppState('active'); });
    await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2));
  } finally {
    sub.mockRestore();
  }
});
