import React, {
  createContext, useContext, useState, useEffect, useMemo, useCallback,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { light, dark, semantic, typography, fonts, spacing, radius } from './tokens';

const STORAGE_KEY = '@golf_theme_mode';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState('system'); // 'light' | 'dark' | 'system'
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPref(saved);
      setReady(true);
    });
  }, []);

  const mode = pref === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : pref;

  const setThemeMode = useCallback((next) => {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return;
    setPref(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggle = useCallback(
    () => setThemeMode(mode === 'light' ? 'dark' : 'light'),
    [mode, setThemeMode],
  );

  // The theme is derived purely from `mode`, so it is rebuilt only when the
  // mode actually flips — never merely because the provider re-rendered.
  // Identity matters far beyond tidiness here: ~215 modules consume this, and
  // the expensive ones memoize entire StyleSheets on `theme` (the scorecard
  // alone builds 111 of them). Handing out a fresh object on every render
  // rebuilt all of those and broke React.memo everywhere downstream.
  // `scoreColor` is built inside the same memo so it inherits that stability
  // instead of silently invalidating the object that carries it.
  const theme = useMemo(() => {
    const colors = mode === 'light' ? light : dark;
    return {
      ...colors,
      semantic,
      masters: semantic.masters,
      destructive: mode === 'light' ? semantic.destructive.light : semantic.destructive.dark,
      info: mode === 'light' ? semantic.info.light : semantic.info.dark,
      pairA: mode === 'light' ? semantic.pair.a.light : semantic.pair.a.dark,
      pairB: mode === 'light' ? semantic.pair.b.light : semantic.pair.b.dark,
      scoreColor: (level) => (
        mode === 'light' ? semantic.score[level].light : semantic.score[level].dark
      ),
      typography,
      fonts,
      spacing,
      radius,
      mode,
      isDark: mode === 'dark',
    };
  }, [mode]);

  // Memoized for the same reason: an unstable context value re-renders every
  // consumer regardless of how stable `theme` itself is.
  const value = useMemo(
    () => ({ theme, mode, themePref: pref, setThemeMode, toggle, ready }),
    [theme, mode, pref, setThemeMode, toggle, ready],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
