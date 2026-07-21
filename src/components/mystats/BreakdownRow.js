import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { toneColor, toneFill } from './metricTone';

// Quiet data-dense row: label (plus muted secondary text) on the left, value
// on the right as a compact tone-colored chip. Color only appears in the chip
// when the tone is good/bad — neutral rows stay gray, so a wall of rows reads
// as data instead of colored stripes. `first` drops the hairline separator.
export default function BreakdownRow({
  label, value, secondary, tone = 'neutral', dim = false, first = false,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const color = dim ? theme.text.muted : toneColor(theme, tone);

  return (
    <View style={[s.row, !first && s.rowDivider, dim && s.rowDim]}>
      <View style={s.copy}>
        <Text style={[s.label, dim && s.dimText]} numberOfLines={2}>
          {label}
        </Text>
        {secondary ? (
          <Text style={[s.secondary, dim && s.dimText]} numberOfLines={3}>
            {secondary}
          </Text>
        ) : null}
      </View>
      <View style={[s.chip, { backgroundColor: toneFill(theme, tone) }]}>
        <Text style={[s.chipText, { color }]} numberOfLines={2}>
          {dim ? '-' : value}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    rowDim: {
      opacity: 0.72,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    label: {
      ...theme.typography.body,
      color: theme.text.primary,
    },
    secondary: {
      ...theme.typography.caption,
      color: theme.text.secondary,
    },
    chip: {
      flexShrink: 0,
      minWidth: 52,
      maxWidth: 130,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    chipText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
      maxWidth: 118,
    },
    dimText: {
      color: theme.text.muted,
    },
  });
}
