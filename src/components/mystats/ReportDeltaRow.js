import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { fmtDelta } from './reportCardView';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;

// Bar sweeping out of the center axis (scaleX 0→1), staggered by row.
// Own component because hooks can't sit behind the "has a bar" conditional.
function AxisBarFill({ style, delay, testID }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withDelay(delay, withTiming(1, { duration: 420, easing: EASE_OUT }));
    }
  }, [reduced, scaleX, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return <Animated.View testID={testID} style={[style, animatedStyle]} />;
}

// One chapter row: label + sub on the left, a center-baseline diverging bar
// in the middle (green sweeping right = gained vs average, red sweeping left
// = cost you — polarity already folded into `row.good`), and the raw signed
// delta on the right. `row.good == null` ⇒ no bar, em-dash delta.
export default function ReportDeltaRow({ row, rowIndex = 0, first = false, testID }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const positive = row.good != null && row.good > 0;
  const negative = row.good != null && row.good < 0;
  const widthPct = Math.min(1, Math.max(0, row.ratio || 0)) * 50;
  const deltaColor = positive ? theme.accent.primary
    : negative ? theme.destructive : theme.text.muted;

  return (
    <View style={[s.row, !first && s.rowDivider]}>
      <View style={s.copy}>
        <Text style={s.label} numberOfLines={1}>{row.label}</Text>
        <Text style={s.sub} numberOfLines={1}>{row.sub}</Text>
      </View>
      <View style={s.axis}>
        <View style={s.zeroLine} />
        {row.good != null && widthPct > 0 ? (
          <AxisBarFill
            testID={testID ? `${testID}-fill` : undefined}
            delay={rowIndex * STAGGER_MS}
            style={[
              s.bar,
              positive ? s.barPositive : s.barNegative,
              { width: `${widthPct}%` },
              positive
                ? { backgroundColor: theme.accent.primary, transformOrigin: 'left center' }
                : { backgroundColor: theme.destructive, opacity: 0.75, transformOrigin: 'right center' },
            ]}
          />
        ) : null}
      </View>
      <Text style={[s.delta, { color: deltaColor }]}>{fmtDelta(row.delta)}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle },
    copy: { width: 96, gap: 1 },
    label: { fontSize: 12, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary },
    sub: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted,
      fontVariant: ['tabular-nums'],
    },
    axis: { flex: 1, minWidth: 0, height: 18, justifyContent: 'center' },
    zeroLine: {
      position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1.5,
      marginLeft: -0.75, backgroundColor: theme.border.default,
    },
    bar: { position: 'absolute', top: 4, bottom: 4, borderRadius: 999 },
    barPositive: { left: '50%' },
    barNegative: { right: '50%' },
    delta: {
      width: 44, textAlign: 'right', fontSize: 12,
      fontFamily: 'PlusJakartaSans-ExtraBold', fontVariant: ['tabular-nums'],
    },
  });
}
