import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { toneColor } from './metricTone';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;
const FILL_MS = 400;
const TICK_MS = 150;
// Headroom above the larger of value/target so both always land inside the
// track — the visible gap between fill end and tick IS the gap to target.
const SCALE_HEADROOM = 1.15;

// The fill sweeps in from the left on mount (scaleX 0→1, origin left),
// staggered by row position. Reduced motion ⇒ static full-scale fill.
// Own component because hooks can't sit behind the "has a meter"
// conditional in the row.
function FillSweep({ style, delay, testID }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withDelay(delay, withTiming(1, { duration: FILL_MS, easing: EASE_OUT }));
    }
  }, [reduced, scaleX, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return <Animated.View testID={testID} style={[style, animatedStyle]} />;
}

// The gold target tick fades in only after its row's fill has landed
// (delay = row stagger + fill duration) — the meter draws first, then the
// goal appears against it. Reduced motion ⇒ static, fully visible.
function TickFade({ style, delay, testID }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      opacity.value = withDelay(delay, withTiming(1, { duration: TICK_MS }));
    }
  }, [reduced, opacity, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View testID={testID} style={[style, animatedStyle]} />;
}

// Length is "how much", color stays on tone duty (mirrors BreakdownRow):
// green good, red bad, info blue for neither.
function fillToneStyle(theme, tone) {
  if (tone === 'good') return { backgroundColor: theme.accent.primary };
  if (tone === 'bad') return { backgroundColor: theme.destructive, opacity: 0.8 };
  return { backgroundColor: theme.info, opacity: 0.8 };
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampPct(value) {
  return Math.min(100, Math.max(0, value));
}

function formatTarget(value) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

// Target-meter row: label (with muted sample line) on the left, an 8px pill
// track in the middle whose tone-colored fill is YOUR value and whose gold
// tick marks the TARGET, and the tone-colored value (with a muted
// "target n" line) on the right. Both numbers share a per-row scale of
// max(value, target) × SCALE_HEADROOM so they always fit; fill and tick
// clamp into [0,100]%. Rows missing either number render meter-less
// (label + value only). `first` drops the hairline separator; `rowIndex`
// staggers the fill sweep.
export default function TargetMeterRow({
  label, meta, value, numericValue, target, targetDisplay,
  tone = 'neutral', rowIndex = 0, first = false, testID,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const scale = isNumber(numericValue) && isNumber(target)
    ? Math.max(numericValue, target) * SCALE_HEADROOM
    : null;
  const hasMeter = isNumber(scale) && scale > 0;
  const fillPct = hasMeter ? clampPct((numericValue / scale) * 100) : 0;
  const tickPct = hasMeter ? clampPct((target / scale) * 100) : 0;
  const targetText = hasMeter ? `target ${targetDisplay ?? formatTarget(target)}` : null;
  const tickColor = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;
  const accessibilityLabel = targetText
    ? `${label}: ${value}, ${targetText}`
    : `${label}: ${value}`;

  return (
    <View
      style={[s.row, !first && s.rowDivider]}
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      <View style={s.copy}>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        {meta ? <Text style={s.meta} numberOfLines={1}>{meta}</Text> : null}
      </View>
      <View style={s.meterSlot}>
        {hasMeter ? (
          <>
            <View style={s.track} testID={testID}>
              {fillPct > 0 ? (
                <FillSweep
                  testID={testID ? `${testID}-fill` : undefined}
                  delay={rowIndex * STAGGER_MS}
                  style={[s.fill, { width: `${fillPct}%` }, fillToneStyle(theme, tone)]}
                />
              ) : null}
            </View>
            <TickFade
              testID={testID ? `${testID}-tick` : undefined}
              delay={rowIndex * STAGGER_MS + FILL_MS}
              style={[s.tick, { left: `${tickPct}%`, backgroundColor: tickColor }]}
            />
          </>
        ) : null}
      </View>
      <View style={s.valueCol}>
        <Text style={[s.value, { color: toneColor(theme, tone) }]} numberOfLines={1}>
          {value}
        </Text>
        {targetText ? (
          <Text style={s.targetText} numberOfLines={1}>{targetText}</Text>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: 8,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    copy: {
      width: 104,
      gap: 2,
    },
    label: {
      fontSize: 12.5,
      lineHeight: 16,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
    },
    meta: {
      fontSize: 10,
      lineHeight: 13,
      color: theme.text.muted,
    },
    // The slot is taller than the track so the tick can overhang it; the
    // track keeps flexBasis 'auto' because it is a fixed-height child in
    // a column flex context (react-native-web would otherwise stretch it).
    meterSlot: {
      flex: 1,
      minWidth: 0,
      height: 14,
      justifyContent: 'center',
    },
    track: {
      height: 8,
      flexBasis: 'auto',
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    fill: {
      height: '100%',
      borderRadius: 999,
      transformOrigin: 'left center',
    },
    tick: {
      position: 'absolute',
      top: 0,
      width: 2.5,
      height: 14,
      borderRadius: 1.25,
      marginLeft: -1.25,
    },
    valueCol: {
      flexShrink: 0,
      minWidth: 48,
      alignItems: 'flex-end',
      gap: 1,
    },
    value: {
      fontSize: 13,
      lineHeight: 17,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    targetText: {
      fontSize: 9.5,
      lineHeight: 12,
      color: theme.text.muted,
    },
  });
}
