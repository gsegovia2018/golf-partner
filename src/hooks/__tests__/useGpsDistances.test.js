import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useGpsDistances } from '../useGpsDistances';
import { updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';
import { resolveScorecardDistances } from '../../lib/flyoverModel';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  Accuracy: { High: 4 },
}));
jest.mock('../../lib/geo', () => ({
  findCourseGeometry: jest.fn(() => ({ holes: {} })),
  subscribeCourseGeometry: jest.fn(() => () => {}),
  getCourseGeometryVersion: jest.fn(() => 1),
}));
const defaultResolveScorecardDistances = ({ fix }) => (fix
  ? { distances: { center: 120 }, source: 'gps' }
  : { distances: { center: 340, front: 330, back: 350 }, source: 'tee' });
jest.mock('../../lib/flyoverModel', () => ({
  resolveScorecardDistances: jest.fn((...args) => defaultResolveScorecardDistances(...args)),
}));
jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(),
}));

function Probe({ course = 'C', hole = 1 }) {
  const gps = useGpsDistances(course, hole);
  return <Text testID="out">{JSON.stringify({ a: gps.available, s: gps.source, p: gps.position })}</Text>;
}

beforeEach(() => { jest.clearAllMocks(); __resetAppSettingsForTests(); });

test('gpsEnabled=false: no permission request, tee source, null position', async () => {
  await updateAppSettings({ gpsEnabled: false });
  render(<Probe />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('out').props.children))
      .toEqual({ a: true, s: 'tee', p: null });
  });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test('gpsEnabled=true keeps requesting permission (default path)', async () => {
  render(<Probe />);
  await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
});

test('denied resets to false once permission is later granted', async () => {
  // Force a 'gps'-sourced (non-tee) result even without a fix, so `denied`
  // is the only thing gating `available` here — the tee fallback would
  // otherwise mask a stuck `denied` flag.
  resolveScorecardDistances.mockImplementation(() => ({ distances: { center: 120 }, source: 'gps' }));
  Location.requestForegroundPermissionsAsync
    .mockResolvedValueOnce({ status: 'denied' })
    .mockResolvedValueOnce({ status: 'granted' });

  try {
    render(<Probe />);
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('out').props.children).a).toBe(false);
    });

    // Re-run the permission effect (its deps are [hasGeometry, gpsEnabled])
    // via the GPS toggle, simulating the user re-granting permission and
    // flipping the setting back on.
    await act(async () => { await updateAppSettings({ gpsEnabled: false }); });
    await act(async () => { await updateAppSettings({ gpsEnabled: true }); });

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('out').props.children).a).toBe(true);
    });
  } finally {
    resolveScorecardDistances.mockImplementation((...args) => defaultResolveScorecardDistances(...args));
  }
});
