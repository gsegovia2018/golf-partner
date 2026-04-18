import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { light, dark, semantic, typography, fonts, spacing, radius } from './tokens';

const STORAGE_KEY = '@golf_theme_mode';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === 'light' || saved === 'dark') setMode(saved);
      setReady(true);
    });
  }, []);

  const toggle = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const colors = mode === 'light' ? light : dark;
  const destructive = mode === 'light' ? semantic.destructive.light : semantic.destructive.dark;
  const pairA = mode === 'light' ? semantic.pair.a.light : semantic.pair.a.dark;
  const pairB = mode === 'light' ? semantic.pair.b.light : semantic.pair.b.dark;

  const scoreColor = (level) =>
    mode === 'light' ? semantic.score[level].light : semantic.score[level].dark;

  const theme = {
    ...colors,
    semantic,
    masters: semantic.masters,
    destructive,
    pairA,
    pairB,
    scoreColor,
    typography,
    fonts,
    spacing,
    radius,
    mode,
    isDark: mode === 'dark',
  };

  return (
    <ThemeContext.Provider value={{ theme, mode, toggle, ready }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
