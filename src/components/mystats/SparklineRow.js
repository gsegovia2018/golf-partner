import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import PressableScale from '../ui/PressableScale';
import Reveal from '../ui/Reveal';
import TrendLineChart from './TrendLineChart';
import { scalePoints, toSegments, dropGaps as dropGapEntries } from './chartGeometry';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;
const SPARK_H = 26;

// ~12% wash of a 6-digit hex theme color, for the delta-chip fill.
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// The sparkline sweeps in from the left (scaleX 0→1, origin left) behind an
// overflow-hidden wrapper, staggered by row position; the delta chip fades in
// once its row's sweep has landed. Reduced motion ⇒ both static.
function SparkReveal({ delay, style, children }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withDelay(delay, withTiming(1, { duration: 350, easing: EASE_OUT }));
    }
  }, [reduced, scaleX, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

function ChipFade({ delay, children }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      opacity.value = withDelay(delay, withTiming(1, { duration: 150, easing: EASE_OUT }));
    }
  }, [reduced, opacity, delay]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

// Disclosure chevron: a single chevron-down that rotates a half turn to read
// as chevron-up while the row is expanded. Reduced motion ⇒ instant flip.
function ChevronFlip({ expanded, color }) {
  const reduced = useReducedMotion();
  const rotation = useSharedValue(expanded ? 180 : 0);

  useEffect(() => {
    const target = expanded ? 180 : 0;
    rotation.value = reduced
      ? target
      : withTiming(target, { duration: 200, easing: EASE_OUT });
  }, [expanded, reduced, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Feather name="chevron-down" size={14} color={color} />
    </Animated.View>
  );
}

// One Instruments-card metric row: label + muted comparison sub, a compact
// sparkline, and the latest value over a polarity-aware delta chip.
//   metric: { key, label, recent, history, delta, direction } (stats.form.metrics
//           entry — `direction` is already polarity-aware: 'up' = improved).
//   series: [{ label, value }] (stats.formSeries.metrics[key]).
//   dropGaps: connect over null rounds (round-total metrics); shot metrics
//           keep their gaps — a gap there means "not tracked that round".
//   expanded/onToggle: controlled progressive disclosure — when `onToggle`
//           is provided the row becomes a button with a chevron, and while
//           `expanded` it shows the full per-round TrendLineChart under the
//           row. The accordion (one row open at a time) lives in the parent.
export default function SparklineRow({
  metric, series = [], color, formatValue, infoKey, onInfo, index = 0, dropGaps = false,
  expanded = false, onToggle,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [width, setWidth] = useState(0);
  const fmt = formatValue || ((v) => `${v}`);
  const toggleable = typeof onToggle === 'function';

  const data = dropGaps ? dropGapEntries(series) : series;
  const points = useMemo(
    () => (width > 0
      ? scalePoints(data.map((p) => p.value), {
        width, height: SPARK_H, padX: 4, padTop: 4, padBottom: 4,
      })
      : []),
    [data, width],
  );
  const segments = useMemo(() => toSegments(points), [points]);
  const drawn = points.filter((p) => p.y != null);
  const lastDot = drawn.length ? drawn[drawn.length - 1] : null;

  const latest = [...series].reverse().find((p) => p.value != null);
  const latestText = latest ? fmt(latest.value) : '—';

  const delta = metric.delta;
  const improved = metric.direction === 'up';
  const chipColor = delta == null || delta === 0
    ? theme.text.muted
    : improved ? theme.scoreColor('good') : theme.destructive;
  const chipIcon = delta == null || delta === 0
    ? 'minus'
    : delta > 0 ? 'trending-up' : 'trending-down';
  const chipText = delta == null || delta === 0
    ? 'level'
    : `${delta > 0 ? '+' : ''}${delta}`;
  const chipLabel = delta == null || delta === 0
    ? `${metric.label}: level with your history`
    : `${metric.label}: ${improved ? 'improved' : 'declined'} ${Math.abs(delta)} vs your history`;

  const sub = metric.history != null
    ? `vs ${fmt(metric.history)} previous`
    : 'No history to compare';

  const delay = index * STAGGER_MS;

  const rowLabel = `${metric.label}: ${latestText}. ${expanded ? 'Hide' : 'Show'} round-by-round values.`;

  const rowContent = (
    <>
      <View style={s.copy}>
        <View style={s.nameWrap}>
          <Text style={s.label} numberOfLines={2}>{metric.label}</Text>
          {infoKey && onInfo ? (
            <TouchableOpacity
              onPress={() => onInfo(infoKey)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`What is ${metric.label}`}
            >
              <Feather name="info" size={13} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={s.sub} numberOfLines={2}>{sub}</Text>
      </View>
      <View
        style={s.sparkSlot}
        testID={`sparkline-slot-${metric.key}`}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={s.sparkClip}>
          <SparkReveal delay={delay} style={s.sparkInner}>
            {width > 0 && drawn.length > 0 ? (
              <Svg
                width={width}
                height={SPARK_H}
                viewBox={`0 0 ${width} ${SPARK_H}`}
                testID={`sparkline-canvas-${metric.key}`}
              >
                {segments.map((seg, i) => (
                  <Polyline
                    key={`seg-${i}`}
                    points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {lastDot ? <Circle cx={lastDot.x} cy={lastDot.y} r={2.5} fill={color} /> : null}
              </Svg>
            ) : null}
          </SparkReveal>
        </View>
      </View>
      <View style={s.valueCol}>
        <Text style={s.value}>{latestText}</Text>
        {delta != null ? (
          <ChipFade delay={delay + 400}>
            <View
              style={[s.chip, { backgroundColor: delta === 0 ? theme.bg.secondary : withAlpha(chipColor, 0.12) }]}
              testID={`sparkline-chip-${metric.key}`}
              accessible
              accessibilityLabel={chipLabel}
            >
              <Feather name={chipIcon} size={11} color={chipColor} />
              <Text style={[s.chipText, { color: chipColor }]}>{chipText}</Text>
            </View>
          </ChipFade>
        ) : null}
      </View>
      {toggleable ? <ChevronFlip expanded={expanded} color={theme.text.muted} /> : null}
    </>
  );

  return (
    <View style={index > 0 ? s.rowDivider : null} testID={`sparkline-row-${metric.key}`}>
      {toggleable ? (
        <PressableScale
          activeScale={0.98}
          onPress={onToggle}
          style={s.row}
          testID={`sparkline-press-${metric.key}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={rowLabel}
        >
          {rowContent}
        </PressableScale>
      ) : (
        <View style={s.row}>{rowContent}</View>
      )}
      {expanded ? (
        <View style={s.expand} testID={`sparkline-expanded-${metric.key}`}>
          <Reveal key={`expand-${metric.key}`} dy={4} duration={200}>
            <TrendLineChart
              series={series}
              color={color}
              variant="compact"
              formatValue={fmt}
              dropGaps={dropGaps}
              caption="oldest → newest"
            />
          </Reveal>
        </View>
      ) : null}
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
    copy: { width: 110, gap: 2 },
    nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    label: {
      fontSize: 12.5,
      lineHeight: 16,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
      flexShrink: 1,
    },
    sub: { fontSize: 10, lineHeight: 13, color: theme.text.muted },
    sparkSlot: { flex: 1, minWidth: 0, height: SPARK_H },
    sparkClip: { overflow: 'hidden', height: SPARK_H },
    sparkInner: { transformOrigin: 'left', height: SPARK_H },
    valueCol: { alignItems: 'flex-end', gap: 3, minWidth: 52 },
    value: {
      fontSize: 14.5,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
    },
    chipText: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
    expand: { paddingBottom: theme.spacing.sm },
  });
}
