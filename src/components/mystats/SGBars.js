import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';

const HEIGHT = 14;
const MAX_WIDTH = 200;
const MAX_ABS = 1.5; // ±1.5 SG/round visual cap
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Bare diverging track — zero line in the middle, bar growing out of it.
// No label/value columns, so it can sit inside a board row (ShotDashboard)
// as well as the standalone SGBar. `style` lets callers override the track
// shell (height, maxWidth, ...).
export function SGBarTrack({ value, style }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  // Reduced motion ⇒ render at full width with no animation.
  const scale = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scale.value = withTiming(1, { duration: 400, easing: EASE_OUT });
    }
  }, [reduced, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scale.value }],
  }));

  const clamped = Math.max(-MAX_ABS, Math.min(MAX_ABS, value));
  const positive = clamped >= 0;
  const widthPct = (Math.abs(clamped) / MAX_ABS) * 50;
  // theme.scoreColor is a function: scoreColor('good') / scoreColor('poor')
  const fill = positive ? theme.scoreColor('good') : theme.scoreColor('poor');

  return (
    <View testID="sg-bar-track" style={[styles.track, { backgroundColor: theme.bg.secondary }, style]}>
      <View style={[styles.zeroLine, { backgroundColor: theme.border.default }]} />
      <Animated.View
        style={[
          styles.bar,
          positive ? styles.barPositive : styles.barNegative,
          {
            width: `${widthPct}%`,
            backgroundColor: fill,
            // Grow out of the zero line: anchor scaleX at the center edge.
            transformOrigin: positive ? 'left center' : 'right center',
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

export function SGBar({ label, value }) {
  const { theme } = useTheme();

  if (value == null) {
    return (
      <View testID="sg-bar-row" style={styles.row}>
        <Text style={[styles.label, { color: theme.text.muted }]} numberOfLines={1}>{label}</Text>
        <Text style={{ color: theme.text.muted }}>—</Text>
      </View>
    );
  }

  const fill = value >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor');

  return (
    <View testID="sg-bar-row" style={styles.row}>
      <Text style={[styles.label, { color: theme.text.muted }]} numberOfLines={1}>{label}</Text>
      <SGBarTrack value={value} />
      <Text
        testID="sg-bar-value"
        style={[styles.value, { color: fill }]}
      >
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </Text>
    </View>
  );
}

const styles = {
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
    width: '100%',
  },
  label: {
    width: 92,
    flexShrink: 0,
    fontSize: 11.5,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  track: {
    flex: 1,
    minWidth: 80,
    maxWidth: MAX_WIDTH,
    height: HEIGHT,
    borderRadius: 999,
    overflow: 'hidden',
  },
  zeroLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1.5,
    marginLeft: -0.75,
  },
  bar: {
    position: 'absolute',
    top: 2,
    bottom: 2, // inset instead of fixed height so track-height overrides work
    borderRadius: 4,
  },
  barPositive: {
    left: '50%',
  },
  barNegative: {
    right: '50%',
  },
  value: {
    width: 46,
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontVariant: ['tabular-nums'],
  },
};
