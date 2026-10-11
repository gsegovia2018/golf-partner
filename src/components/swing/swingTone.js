import { useMemo } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';

/**
 * Status colours for the swing screens (D14): a dot carries the colour, the word and the
 * value stay in ink. `none` is "nothing measured here".
 */
export function useSwingTone() {
  const { theme } = useTheme();
  return useMemo(() => ({
    green: theme.accent.primary,
    yellow: theme.isDark ? semantic.warning.dark : semantic.warning.light,
    red: theme.isDark ? semantic.destructive.dark : semantic.destructive.light,
    unknown: theme.text.muted,
    none: theme.text.muted,
  }), [theme]);
}
