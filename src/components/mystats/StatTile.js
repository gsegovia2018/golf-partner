import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// One large value + caption. tone: 'default' | 'up' | 'down'. Renders a
// secondary-tinted tile that sits on white cards and white inset panels.
export default function StatTile({ value, caption, tone = 'default' }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const valueColor = tone === 'up' ? theme.accent.primary
    : tone === 'down' ? theme.destructive
      : theme.text.primary;

  return (
    <View style={s.tile}>
      <Text style={[s.value, { color: valueColor }]}>{value}</Text>
      <Text style={s.caption}>{caption}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tile: {
      flex: 1, backgroundColor: theme.bg.secondary, borderRadius: theme.radius.lg,
      padding: theme.spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    value: {
      fontSize: 22,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
      color: theme.text.primary,
    },
    caption: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: theme.text.muted,
      marginTop: 2,
    },
  });
}
