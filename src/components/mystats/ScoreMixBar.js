import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// The segment row grows in from the left on mount (scaleX 0→1, origin left)
// so the stacked shares sweep into place together. Reduced motion ⇒ static
// full-width row. Mirrors GrowBar in DistributionBars.js.
function GrowRow({ style, children }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withTiming(1, { duration: 400, easing: EASE_OUT });
    }
  }, [reduced, scaleX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ONE horizontal stacked bar showing the share of holes ending birdie+ /
// par / bogey / double+, fed by the same `stats.distribution` counts the
// scoring-pattern rows use — this component never recomputes stats.
// buildCourseBreakdown()'s `summary.scoreMix` carries the same
// {eagles,birdies,pars,bogeys,doubles,worse} keys (plus an ignored `total`),
// so CourseStatsScreen passes it straight in as `distribution`.
export default function ScoreMixBar({ distribution }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const segments = useMemo(() => {
    const d = distribution ?? {};
    return [
      { key: 'birdie', label: 'Birdie+', count: (d.eagles ?? 0) + (d.birdies ?? 0), color: theme.accent.primary },
      { key: 'par', label: 'Par', count: d.pars ?? 0, color: '#7fb59f' },
      { key: 'bogey', label: 'Bogey', count: d.bogeys ?? 0, color: '#e7d7b4' },
      { key: 'double', label: 'Double+', count: (d.doubles ?? 0) + (d.worse ?? 0), color: theme.isDark ? '#b57070' : '#d9a29a' },
    ];
  }, [distribution, theme]);

  const total = segments.reduce((sum, seg) => sum + seg.count, 0);
  if (total <= 0) return null;

  const shown = segments.filter((seg) => seg.count > 0);

  return (
    <View
      accessible
      accessibilityLabel={`Score mix of ${total} holes: ${shown.map((seg) => `${seg.count} ${seg.label}`).join(', ')}`}
    >
      <View style={s.track}>
        <GrowRow style={s.segments}>
          {shown.map((seg) => (
            <View
              key={seg.key}
              testID={`scoremix-segment-${seg.key}`}
              style={[s.segment, { flexGrow: seg.count, backgroundColor: seg.color }]}
            />
          ))}
        </GrowRow>
      </View>
      <View style={s.legend}>
        {shown.map((seg) => (
          <View key={seg.key} style={s.legendItem} testID={`scoremix-legend-${seg.key}`}>
            <View style={[s.legendDot, { backgroundColor: seg.color }]} />
            <Text style={s.legendText}>
              {seg.label} <Text style={s.legendCount}>{seg.count}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    track: {
      height: 12,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    segments: {
      flexDirection: 'row',
      height: '100%',
      width: '100%',
      gap: 2,
      transformOrigin: 'left',
    },
    segment: {
      flexBasis: 0,
      minWidth: 3,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
    legendText: {
      ...theme.typography.tiny,
      color: theme.text.muted,
      fontWeight: '700',
    },
    legendCount: {
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
  });
}
