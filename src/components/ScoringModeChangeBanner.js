// Transient banner shown on ScorecardScreen when the tournament's scoring
// mode just changed. Auto-dismisses after ~5s. Tap-to-reopen lets the
// user change the mode again via the supplied callback.
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function ScoringModeChangeBanner({ message, onPress, onDismiss }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <TouchableOpacity style={s.banner} onPress={onPress} activeOpacity={0.85}>
      <Feather name="info" size={16} color={theme.text.primary} />
      <Text style={s.text} numberOfLines={2}>{message}</Text>
      <Text style={s.cta}>Change</Text>
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
