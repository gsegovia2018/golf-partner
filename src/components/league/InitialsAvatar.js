import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { initials } from '../../store/leagueView';

// Round initials chip for a person who has no photo (league invitees).
// `muted` is the grey variant used for "+" style rows.
export default function InitialsAvatar({ name, size = 36, muted = false, children }) {
  const { theme } = useTheme();
  const s = makeStyles(theme, size, muted);
  return (
    <View style={s.avatar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {children ?? <Text style={s.text}>{initials(name)}</Text>}
    </View>
  );
}

function makeStyles(theme, size, muted) {
  return StyleSheet.create({
    avatar: {
      width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: muted ? theme.bg.secondary : theme.accent.light, marginRight: 12,
    },
    text: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: Math.round(size * 0.36),
      color: muted ? theme.text.secondary : theme.accent.primary,
    },
  });
}
