import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { scoreBandColors } from '../../theme/tone';
import { duration as motion, ease } from '../../theme/motion';

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

// One band. When the counts change (the Strokes | Points switch) it slides to
// its new share instead of jumping, in step with the scorecard's roll. Every
// band stays mounted so an empty one can shrink to nothing and grow back; the
// 2 px gap is the fill's left margin, clipped away with the band.
function Segment({ count, color, first, testID, s }) {
  const reduced = useReducedMotion();
  const grow = useSharedValue(count);
  useEffect(() => {
    grow.value = reduced ? count : withTiming(count, { duration: motion.place, easing: ease.out });
  }, [count, reduced, grow]);
  const growStyle = useAnimatedStyle(() => ({ flexGrow: grow.value }));
  return (
    <Animated.View testID={count > 0 ? testID : undefined} style={[s.segment, growStyle]}>
      <View style={[s.fill, !first && s.fillGap, { backgroundColor: color }]} />
    </Animated.View>
  );
}

// The four bands (colour + label + count). Shared by the bar and the
// stand-alone legend so the two always agree.
function mixSegments(distribution, theme, t) {
  const d = distribution ?? {};
  const C = scoreBandColors(theme);
  return [
    { key: 'birdie', label: t('stats.my.mix.birdiePlus'), count: (d.eagles ?? 0) + (d.birdies ?? 0), color: C.birdiePlus },
    { key: 'par', label: t('stats.my.mix.par'), count: d.pars ?? 0, color: C.par },
    { key: 'bogey', label: t('stats.my.mix.bogey'), count: d.bogeys ?? 0, color: C.bogey },
    { key: 'double', label: t('stats.my.mix.doublePlus'), count: (d.doubles ?? 0) + (d.worse ?? 0), color: C.double },
  ];
}

// One legend for several bars (no counts): the Game Stats "everyone" card.
export function ScoreMixLegend() {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.legend} testID="scoremix-legend">
      {mixSegments(null, theme, t).map((seg) => (
        <View key={seg.key} style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: seg.color }]} />
          <Text style={s.legendText}>{seg.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ONE horizontal stacked bar showing the share of holes ending birdie+ /
// par / bogey / double+, fed by the same `stats.distribution` counts the
// scoring-pattern rows use — this component never recomputes stats.
// buildCourseBreakdown()'s `summary.scoreMix` carries the same
// {eagles,birdies,pars,bogeys,doubles,worse} keys (plus an ignored `total`),
// so CourseStatsScreen passes it straight in as `distribution`.
// `legend={false}` drops the per-bar legend (pair it with ScoreMixLegend).
export default function ScoreMixBar({ distribution, legend = true }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const segments = useMemo(() => mixSegments(distribution, theme, t), [distribution, theme, t]);

  const total = segments.reduce((sum, seg) => sum + seg.count, 0);
  if (total <= 0) return null;

  const shown = segments.filter((seg) => seg.count > 0);

  return (
    <View
      accessible
      accessibilityLabel={t('stats.my.mix.a11y', { total, parts: shown.map((seg) => `${seg.count} ${seg.label}`).join(', ') })}
    >
      <View style={s.track}>
        <GrowRow style={s.segments}>
          {segments.map((seg) => (
            <Segment
              key={seg.key}
              s={s}
              count={seg.count}
              color={seg.color}
              first={seg.key === shown[0].key}
              testID={`scoremix-segment-${seg.key}`}
            />
          ))}
        </GrowRow>
      </View>
      {legend && (
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
      )}
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
      transformOrigin: 'left',
    },
    segment: {
      flexBasis: 0,
      overflow: 'hidden',
    },
    fill: { flex: 1 },
    fillGap: { marginLeft: 2 },
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
