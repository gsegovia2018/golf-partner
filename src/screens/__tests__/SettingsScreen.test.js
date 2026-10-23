import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SettingsScreen from '../SettingsScreen';
import { getAppSettings, updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';
import { setLanguagePref } from '../../i18n';

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

test('playing conditions switch lives in Settings, with the Open-Meteo credit', async () => {
  renderScreen();
  const sw = await screen.findByTestId('setting-conditionsEnabled');
  screen.getByText('Weather data by Open-Meteo.com (CC BY 4.0)');
  fireEvent(sw, 'valueChange', true);
  await waitFor(() => expect(getAppSettings().conditionsEnabled).toBe(true));
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

test('miss reasons segment writes the chosen mode', async () => {
  renderScreen();
  expect(await screen.findByTestId('setting-missReasons')).toBeTruthy();
  fireEvent.press(screen.getByTestId('setting-missReasons-manual'));
  await waitFor(() => expect(getAppSettings().missReasons).toBe('manual'));
  fireEvent.press(screen.getByTestId('setting-missReasons-off'));
  await waitFor(() => expect(getAppSettings().missReasons).toBe('off'));
  expect(await screen.findByText("Don't record why shots miss.")).toBeTruthy();
});

test('no-spoilers mode disables the running-score switch and forces it off', async () => {
  await updateAppSettings({ noSpoilers: true });
  renderScreen();
  const sw = await screen.findByTestId('setting-showRunningScore');
  expect(sw.props.accessibilityState.disabled).toBe(true);
  expect(sw.props.accessibilityState.checked).toBe(false);
});

test('replays the app tour from the DISPLAY section', async () => {
  renderScreen();
  const row = await screen.findByTestId('setting-replayTour');
  fireEvent.press(row);
  await waitFor(() => expect(resetTour).toHaveBeenCalledTimes(1));
});

describe('Spanish', () => {
  beforeEach(async () => { await act(async () => { await setLanguagePref('es'); }); });
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('renders section titles and labels in Spanish', async () => {
    renderScreen();
    await waitFor(() => screen.getByText('EN EL CAMPO'));
    expect(screen.getByText('Ajustes')).toBeTruthy();
    expect(screen.getByText('VISIBILIDAD DE RESULTADOS')).toBeTruthy();
    expect(screen.getByText('Distancias GPS')).toBeTruthy();
    expect(screen.getByText('Repetir el recorrido')).toBeTruthy();
    expect(screen.getByText('Idioma')).toBeTruthy();
    expect(screen.getByText('Tema')).toBeTruthy();
  });
});

test('aim tips switch writes the setting', async () => {
  renderScreen();
  expect(await screen.findByText('Aim tips')).toBeTruthy();
  expect(screen.getByText('A one-line tip on the hole when your misses lean one way.')).toBeTruthy();
  fireEvent(screen.getByTestId('setting-aimTips'), 'valueChange', false);
  await waitFor(() => expect(getAppSettings().aimTips).toBe(false));
});

test('usage stats switch is on by default and turns off', async () => {
  renderScreen();
  expect(await screen.findByText('PRIVACY')).toBeTruthy();
  expect(screen.getByText('Share usage stats')).toBeTruthy();
  expect(screen.getByTestId('setting-usageStats').props.accessibilityState.checked).toBe(true);
  fireEvent(screen.getByTestId('setting-usageStats'), 'valueChange', false);
  await waitFor(() => expect(getAppSettings().usageStats).toBe(false));
});

describe('GPS trail switch', () => {
  const { Platform } = require('react-native');
  const realOS = Platform.OS;
  const pinOS = (os) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  afterEach(() => pinOS(realOS));

  test('on Android: off by default, and the switch writes the setting', async () => {
    pinOS('android');
    renderScreen();
    expect(await screen.findByText('Record GPS trail (test)')).toBeTruthy();
    expect(screen.getByText('Saves your position during live rounds so we can test automatic shot detection. Only you can see it.')).toBeTruthy();
    expect(getAppSettings().recordGpsTrail).toBe(false);
    fireEvent(screen.getByTestId('setting-recordGpsTrail'), 'valueChange', true);
    await waitFor(() => expect(getAppSettings().recordGpsTrail).toBe(true));
  });

  test('elsewhere (no background tracking) the row is hidden', async () => {
    pinOS('web');
    renderScreen();
    await screen.findByText('ON THE COURSE');
    expect(screen.queryByTestId('setting-recordGpsTrail')).toBeNull();
  });
});
