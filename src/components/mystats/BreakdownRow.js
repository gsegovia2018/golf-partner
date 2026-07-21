import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { toneColor } from './metricTone';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;

// The bar fill sweeps in from the left on mount (scaleX 0→1, origin left),
// staggered by row position within its section. Reduced motion ⇒ static
// full-scale fill. Mirrors GrowRow in ScoreMixBar.js. Its own component
// because hooks can't sit behind the "has a bar" conditional in the row.
function BarFill({ style, delay, testID }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withDelay(delay, withTiming(1, { duration: 400, easing: EASE_OUT }));
    }
  }, [reduced, scaleX, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return <Animated.View testID={testID} style={[style, animatedStyle]} />;
}

// Magnitude is "how much", tone is "is it good" — the fill length shows the
// row's share of its section's biggest value, while color stays on tone duty.
function barFillStyle(theme, tone) {
  if (tone === 'good') return { backgroundColor: theme.accent.primary };
  if (tone === 'bad') return { backgroundColor: theme.destructive, opacity: 0.75 };
  return { backgroundColor: '#7fb59f' };
}

// Magnitude-bar row: fixed label column (with muted secondary/sample line),
// a thin bar track whose fill length is the row's magnitude normalized
// against the section max (`barRatio` 0..1), and a right-aligned
// tone-colored value. `barRatio` undefined ⇒ no track at all (rows whose
// units aren't comparable within the section); zero/dim ⇒ empty track.
// `first` drops the hairline separator; `rowIndex` staggers the fill sweep.
export default function BreakdownRow({
  label, value, secondary, tone = 'neutral', dim = false, first = false,
  barRatio, rowIndex = 0, testID,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const valueColor = dim ? theme.text.muted : toneColor(theme, tone);
  const hasTrack = typeof barRatio === 'number' && Number.isFinite(barRatio);
  const fillPct = hasTrack && !dim ? Math.min(1, Math.max(0, barRatio)) * 100 : 0;

  return (
    <View style={[s.row, !first && s.rowDivider, dim && s.rowDim]}>
      <View style={s.copy}>
        <Text style={[s.label, dim && s.dimText]} numberOfLines={2}>
          {label}
        </Text>
        {secondary ? (
          <Text style={s.secondary} numberOfLines={3}>
            {secondary}
          </Text>
        ) : null}
      </View>
      <View style={s.barSlot}>
        {hasTrack ? (
          <View style={s.track} testID={testID}>
            {fillPct > 0 ? (
              <BarFill
                testID={testID ? `${testID}-fill` : undefined}
                delay={rowIndex * STAGGER_MS}
                style={[s.fill, { width: `${fillPct}%` }, barFillStyle(theme, tone)]}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      <Text style={[s.value, { color: valueColor }]} numberOfLines={2}>
        {dim ? '-' : value}
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
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
      width: 110,
      gap: 2,
    },
    label: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '600',
      color: theme.text.primary,
    },
    secondary: {
      fontSize: 10.5,
      lineHeight: 14,
      color: theme.text.muted,
    },
    barSlot: {
      flex: 1,
      minWidth: 0,
    },
    track: {
      height: 8,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    fill: {
      height: '100%',
      borderRadius: 999,
      transformOrigin: 'left center',
    },
    value: {
      flexShrink: 0,
      minWidth: 58,
      maxWidth: 130,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    dimText: {
      color: theme.text.muted,
    },
  });
}
