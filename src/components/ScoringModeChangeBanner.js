// Transient notice banner on ScorecardScreen. Auto-dismisses after ~5s.
// Used for the scoring-mode change (tap-to-reopen via `onPress`, with a
// "Change" call to action) and for a setup change that arrived from another
// phone (no `onPress`: informational, tapping dismisses).
import React, { useEffect } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function ScoringModeChangeBanner({
  message, onPress, onDismiss, ctaLabel = 'Change', icon = 'info',
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <TouchableOpacity style={s.banner} onPress={onPress ?? onDismiss} activeOpacity={0.85}>
      <Feather name={icon} size={16} color={theme.text.primary} />
      <Text style={s.text} numberOfLines={2}>{message}</Text>
      {onPress ? <Text style={s.cta}>{ctaLabel}</Text> : null}
    </TouchableOpacity>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
      marginHorizontal: 12,
      marginTop: 8,
      borderRadius: 8,
      backgroundColor: theme.accent.light,
      borderWidth: 1,
      borderColor: theme.accent.primary + '40',
      gap: 8,
    },
    text: { flex: 1, fontSize: 13, color: theme.text.primary },
    cta: { fontSize: 13, color: theme.accent.primary, fontWeight: '600' },
  });
}
