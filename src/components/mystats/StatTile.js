import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// One large value + caption. tone: 'default' | 'up' | 'down'.
// surface: 'card' (default, on a light card) | 'hero' (on the green hero).
export default function StatTile({ value, caption, tone = 'default', surface = 'card' }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const hero = surface === 'hero';
  const valueColor = tone === 'up' ? (hero ? theme.text.inverse : theme.accent.primary)
    : tone === 'down' ? theme.destructive
      : (hero ? theme.text.inverse : theme.text.primary);

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
    tileHero: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'transparent' },
    value: { ...theme.typography.title, color: theme.text.primary },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginTop: 1 },
    captionHero: { color: 'rgba(255,255,255,0.75)' },
  });
}
