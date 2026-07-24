import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useGpsDistances } from '../useGpsDistances';
import { updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';
import { resolveScorecardDistances } from '../../lib/flyoverModel';

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
  return <Text testID="out">{JSON.stringify({ a: gps.available, s: gps.source, p: gps.position, o: gps.offTee, f: gps.fixState })}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetAppSettingsForTests();
  // clearAllMocks resets calls but NOT implementations — restore the default
  // resolutions so a test that overrode them (e.g. a persistent 'denied')
  // can't leak into the tests that follow.
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getCurrentPositionAsync.mockResolvedValue(null);
});

test('gpsEnabled=false: no permission request, tee source, null position', async () => {
  await updateAppSettings({ gpsEnabled: false });
  render(<Probe />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('out').props.children))
      .toEqual({ a: true, s: 'tee', p: null, o: false, f: 'disabled' });
  });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test('granted but no fix yet: fixState is acquiring', async () => {
  render(<Probe />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('out').props.children).f).toBe('acquiring');
  });
});

test('a held fix reports fixState ok', async () => {
  // Once, so the shared default (resolves null) is restored for later tests.
  Location.getCurrentPositionAsync.mockResolvedValueOnce({ coords: { latitude: 38.5, longitude: -0.15, accuracy: 6 } });
  render(<Probe />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('out').props.children).f).toBe('ok');
  });
});

test('denied permission reports fixState denied', async () => {
  // Once, so the shared default (resolves granted) is restored for later tests.
  Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
  render(<Probe />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('out').props.children).f).toBe('denied');
  });
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

test('denied recovers automatically once permission is granted in system settings', async () => {
  jest.useFakeTimers();
  resolveScorecardDistances.mockImplementation(() => ({ distances: { center: 120 }, source: 'gps' }));
  // First request: denied. The recovery poll then sees granted and re-runs
  // the effect, whose second request succeeds.
  Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
  try {
    render(<Probe />);
    await act(async () => {});
    expect(JSON.parse(screen.getByTestId('out').props.children).a).toBe(false);

    await act(async () => { jest.advanceTimersByTime(5001); });
    await act(async () => {}); // flush the status check + effect re-run
    await act(async () => {});
    expect(JSON.parse(screen.getByTestId('out').props.children).a).toBe(true);
  } finally {
    jest.useRealTimers();
    resolveScorecardDistances.mockImplementation((...args) => defaultResolveScorecardDistances(...args));
  }
});

test('offTee flips true once a live fix is >50 m from the mapped tee', async () => {
  const geo = require('../../lib/geo');
  geo.holeFeatures.mockReturnValue({ start: [38.55, -0.14] });
  geo.haversineMeters.mockReturnValue(120);
  Location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 38.551, longitude: -0.141, accuracy: 5 } });
  try {
    render(<Probe />);
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('out').props.children).o).toBe(true);
    });
  } finally {
    geo.holeFeatures.mockImplementation(() => null);
    geo.haversineMeters.mockImplementation(() => 0);
    Location.getCurrentPositionAsync.mockResolvedValue(null);
  }
});
