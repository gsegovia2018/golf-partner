import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SettingsScreen from '../SettingsScreen';
import { getAppSettings, updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(),
}));
jest.mock('../../store/tourStore', () => ({ resetTour: jest.fn().mockResolvedValue(undefined) }));
const { resetTour } = require('../../store/tourStore');

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const renderScreen = () => render(
  <ThemeProvider><SettingsScreen navigation={navigation} /></ThemeProvider>,
);

beforeEach(() => __resetAppSettingsForTests());

test('renders the five sections', async () => {
  renderScreen();
  await waitFor(() => screen.getByText('ON THE COURSE'));
  expect(screen.getByText('SCORE VISIBILITY')).toBeTruthy();
  expect(screen.getByText('STATS TRACKING')).toBeTruthy();
  expect(screen.getByText('DISPLAY')).toBeTruthy();
  expect(screen.getByText('NOTIFICATIONS')).toBeTruthy();
});

test('GPS toggle updates the store', async () => {
  renderScreen();
  const sw = await screen.findByTestId('setting-gpsEnabled');
  fireEvent(sw, 'valueChange', false);
  await waitFor(() => expect(getAppSettings().gpsEnabled).toBe(false));
});

test('stat group rows show what is lost', async () => {
  renderScreen();
  await screen.findByText(/no putting stats, no GIR/i);
  const sw = screen.getByTestId('setting-statGroups.putting');
  fireEvent(sw, 'valueChange', false);
  await waitFor(() => expect(getAppSettings().statGroups.putting).toBe(false));
});

test('units segment switches to yards', async () => {
  renderScreen();
  fireEvent.press(await screen.findByText('Yards'));
  await waitFor(() => expect(getAppSettings().units).toBe('yards'));
});

test('no-spoilers mode disables the running-score switch and forces it off', async () => {
  await updateAppSettings({ noSpoilers: true });
  renderScreen();
  const sw = await screen.findByTestId('setting-showRunningScore');
  expect(sw.props.disabled).toBe(true);
  expect(sw.props.accessibilityState?.disabled ?? sw.props.disabled).toBe(true);
  expect(sw.props.value).toBe(false);
});

test('replays the app tour from the DISPLAY section', async () => {
  renderScreen();
  const row = await screen.findByTestId('setting-replayTour');
  fireEvent.press(row);
  await waitFor(() => expect(resetTour).toHaveBeenCalledTimes(1));
});
