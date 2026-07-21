import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// One large value + caption. tone: 'default' | 'up' | 'down'.
// surface: 'card' (default, secondary-tinted tile on a white card) | 'hero'
// (card-colored tile on a secondary-tinted inset panel, e.g. the SG hero).
export default function StatTile({ value, caption, tone = 'default', surface = 'card' }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const hero = surface === 'hero';
  const valueColor = tone === 'up' ? theme.accent.primary
    : tone === 'down' ? theme.destructive
      : theme.text.primary;

  return (
    <View style={[s.tile, hero && s.tileHero]}>
      <Text style={[s.value, { color: valueColor }]}>{value}</Text>
      <Text style={[s.caption, hero && s.captionHero]}>{caption}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tile: {
      flex: 1, backgroundColor: theme.bg.secondary, borderRadius: theme.radius.lg,
      padding: theme.spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    tileHero: { backgroundColor: theme.bg.card, borderColor: 'transparent' },
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
    captionHero: { color: theme.text.muted },
  });
}
