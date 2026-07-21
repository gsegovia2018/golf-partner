import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// The colored bar grows up from the baseline on mount (scaleY 0→1, origin
// bottom), staggered per column. Reduced motion ⇒ static full-height bar.
// Value labels live OUTSIDE this view so they never scale with the bar.
function GrowBar({ index, style }) {
  const reduced = useReducedMotion();
  const scaleY = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleY.value = withDelay(index * 40, withTiming(1, { duration: 300, easing: EASE_OUT }));
    }
  }, [index, reduced, scaleY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
  }));

  return <Animated.View style={[style, animatedStyle]} />;
}

// bars: [{ label, count, displayValue?, muted? }] — vertical bars scaled to the
// largest count; displayValue (e.g. '45%') replaces count as the shown text.
export default function DistributionBars({ bars = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <View style={s.row}>
      {bars.map((b, i) => (
        <View key={b.label} style={s.col}>
          <Text style={s.count}>{b.displayValue ?? b.count}</Text>
          <GrowBar
            index={i}
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
    bar: {
      width: '100%',
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      transformOrigin: 'bottom',
    },
    label: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginTop: 5, textAlign: 'center' },
  });
}
