import React from 'react';
import { Text } from 'react-native';
import { render, screen, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true, default: jest.fn(() => 'dark'),
}));

function Probe() {
  const { mode, themePref, setThemeMode } = useTheme();
  Probe.api = { setThemeMode };
  return <Text testID="probe">{`${themePref}:${mode}`}</Text>;
}

beforeEach(() => AsyncStorage.clear());

test('defaults to system and resolves via OS scheme', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('system:dark'));
});

test('explicit pref overrides system and persists', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => screen.getByTestId('probe'));
  await act(async () => { Probe.api.setThemeMode('light'); });
  expect(screen.getByTestId('probe')).toHaveTextContent('light:light');
  expect(await AsyncStorage.getItem('@golf_theme_mode')).toBe('light');
});

test('stored legacy value still respected', async () => {
  await AsyncStorage.setItem('@golf_theme_mode', 'dark');
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('dark:dark'));
});
