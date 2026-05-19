import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// bars: [{ label, count, muted? }]  — vertical bars scaled to the largest count.
export default function DistributionBars({ bars = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <View style={s.row}>
      {bars.map((b) => (
        <View key={b.label} style={s.col}>
          <Text style={s.count}>{b.count}</Text>
          <View
            style={[
              s.bar,
              {
                height: `${Math.max(3, Math.round((b.count / max) * 100))}%`,
                backgroundColor: b.muted ? theme.border.default : theme.accent.primary,
              },
            ]}
          />
          <Text style={s.label}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, height: 128, paddingTop: 16 },
    col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
    count: { ...theme.typography.caption, fontWeight: '800', color: theme.text.primary, marginBottom: 3 },
    bar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
    label: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginTop: 5, textAlign: 'center' },
  });
}
