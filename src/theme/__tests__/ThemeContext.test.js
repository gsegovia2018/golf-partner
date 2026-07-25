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

// ~149 modules call useTheme, and the expensive ones (makeScorecardStyles and
// friends) memoize whole StyleSheets on `theme` identity. A provider re-render
// that hands out a fresh theme object rebuilds every one of those and breaks
// React.memo across the app — on the scorecard alone that is 111 stylesheet
// rebuilds. Identity must therefore track `mode`, not render count.
describe('context identity', () => {
  function IdentityProbe({ seen }) {
    const ctx = useTheme();
    seen.push(ctx);
    return <Text testID="identity">{ctx.mode}</Text>;
  }

  test('theme and context keep their identity across provider re-renders', async () => {
    const seen = [];
    let bump;
    function Parent() {
      const [n, setN] = React.useState(0);
      bump = setN;
      // `n` is unused by the theme — it only forces ThemeProvider to re-render,
      // exactly as an unrelated state change higher in the app would.
      return (
        <ThemeProvider>
          <Text testID="tick">{String(n)}</Text>
          <IdentityProbe seen={seen} />
        </ThemeProvider>
      );
    }
    render(<Parent />);
    await waitFor(() => screen.getByTestId('identity'));

    const before = seen.length;
    await act(async () => { bump(1); });
    await act(async () => { bump(2); });

    expect(seen.length).toBeGreaterThan(before); // it really did re-render
    const first = seen[before - 1];
    for (const ctx of seen.slice(before)) {
      expect(ctx.theme).toBe(first.theme);
      expect(ctx.theme.scoreColor).toBe(first.theme.scoreColor);
      expect(ctx.setThemeMode).toBe(first.setThemeMode);
      expect(ctx).toBe(first);
    }
  });

  test('theme identity DOES change when the mode changes', async () => {
    const seen = [];
    render(<ThemeProvider><IdentityProbe seen={seen} /><Probe /></ThemeProvider>);
    await waitFor(() => screen.getByTestId('identity'));

    const beforeTheme = seen[seen.length - 1].theme;
    await act(async () => { Probe.api.setThemeMode('light'); });

    const afterTheme = seen[seen.length - 1].theme;
    expect(afterTheme).not.toBe(beforeTheme);
    expect(afterTheme.mode).toBe('light');
    expect(afterTheme.isDark).toBe(false);
  });
});
