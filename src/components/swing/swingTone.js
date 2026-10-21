import { useMemo } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { semantic, hud } from '../../theme/tokens';

/**
 * Status colours for the swing screens (D14): a dot carries the colour, the word and the
 * value stay in ink. The tone rule: green "Bien", ink "Vigilar", red "Corregir" (the
 * `yellow` status key is the model's name for the mid state, not its colour). `none` is
 * "nothing measured here"; `warning` is the amber of a caution (a failed placement, a
 * low-fps clip), never a status.
 */
export function useSwingTone() {
  const { theme } = useTheme();
  return useMemo(() => ({
    green: theme.accent.primary,
    yellow: theme.text.primary,
    red: theme.isDark ? semantic.destructive.dark : semantic.destructive.light,
    unknown: theme.text.muted,
    none: theme.text.muted,
    warning: theme.isDark ? semantic.warning.dark : semantic.warning.light,
  }), [theme]);
}

/** The status colour of the focus-mode still. The still is always dark, so mid is the light ink. */
export const focusTone = (status) => (status === 'yellow' ? hud.text : semantic.destructive.dark);
