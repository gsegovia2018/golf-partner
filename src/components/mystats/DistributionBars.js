import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// bars: [{ label, count, displayValue?, muted? }] — vertical bars scaled to the
// largest count; displayValue (e.g. '45%') replaces count as the shown text.
export default function DistributionBars({ bars = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <View style={s.row}>
      {bars.map((b) => (
        <View key={b.label} style={s.col}>
          <Text style={s.count}>{b.displayValue ?? b.count}</Text>
          <View
            style={[
              s.bar,
              {
                // Cap at 75% of the column so the value label above the
                // tallest bar stays inside the chart instead of overflowing
                // into the content above it.
                height: `${Math.max(3, Math.round((b.count / max) * 75))}%`,
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
