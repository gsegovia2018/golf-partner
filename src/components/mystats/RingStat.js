import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, withDelay, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import CountUpText from './CountUpText';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const SIZE = 52;
const STROKE_WIDTH = 5;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const DRAW_MS = 500;
const STAGGER_MS = 60;

// Raw fill ratio (value / visual scale) → [0, 1]. Over-benchmark values clamp
// at a full ring (the CENTER always shows the real value — the ring is only a
// visual gauge); null/NaN (no data) renders an empty ring.
export function clampFill(fill) {
  if (fill == null || !Number.isFinite(fill)) return 0;
  return Math.min(1, Math.max(0, fill));
}

// One progress-ring stat tile (Clubhouse "Shot detail" row): an SVG ring that
// draws clockwise from 12 o'clock on mount, the real value centered inside,
// and an overline label below. `fill` is the pre-scaled ratio (see the
// *_RING_SCALE constants at the call site); `value` is what the center shows
// (null ⇒ em-dash). Integers count up via CountUpText; non-integers render
// static (CountUpText convention — it rounds every frame). Reduced motion ⇒
// full final ring, no animation.
export default function RingStat({
  value, suffix = '', label, fill, color, index = 0, testID = 'ring',
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const reduced = useReducedMotion();

  const f = clampFill(fill);
  const finalOffset = RING_CIRCUMFERENCE * (1 - f);
  const delay = index * STAGGER_MS;

  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration: DRAW_MS, easing: EASE_OUT }));
  }, [reduced, delay, f, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - f * progress.value),
  }));

  const center = value == null || !Number.isFinite(value)
    ? '—'
    : Number.isInteger(value)
      ? <><CountUpText value={value} duration={DRAW_MS} delay={delay} disabled={reduced} />{suffix}</>
      : `${value}${suffix}`;

  const progressCircleProps = {
    cx: SIZE / 2,
    cy: SIZE / 2,
    r: RADIUS,
    fill: 'none',
    stroke: color,
    strokeWidth: STROKE_WIDTH,
    strokeLinecap: 'round',
    strokeDasharray: RING_CIRCUMFERENCE,
    // Rotate around the center so the ring starts at 12 o'clock and the
    // dash sweep reads clockwise.
    transform: `rotate(-90 ${SIZE / 2} ${SIZE / 2})`,
  };

  return (
    <View style={s.tile} testID={testID}>
      <View style={s.ringWrap}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={theme.bg.secondary}
            strokeWidth={STROKE_WIDTH}
            testID={`${testID}-track`}
          />
          {/* A zero fill renders no progress circle at all — round caps would
              otherwise leave a stray dot at 12 o'clock. */}
          {f > 0 ? (
            reduced ? (
              <Circle
                {...progressCircleProps}
                strokeDashoffset={finalOffset}
                testID={`${testID}-progress`}
              />
            ) : (
              <AnimatedCircle
                {...progressCircleProps}
                animatedProps={animatedProps}
                testID={`${testID}-progress`}
              />
            )
          ) : null}
        </Svg>
        <View style={s.centerWrap} pointerEvents="none">
          <Text style={s.centerValue} testID={`${testID}-value`}>{center}</Text>
        </View>
      </View>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tile: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      backgroundColor: theme.bg.primary,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.xs,
    },
    ringWrap: { width: SIZE, height: SIZE },
    centerWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerValue: {
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
      color: theme.text.primary,
    },
    label: {
      fontSize: 8,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: theme.text.muted,
      textAlign: 'center',
    },
  });
}
