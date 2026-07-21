import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedStyle, withDelay, withTiming,
  Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';

const AnimatedG = Animated.createAnimatedComponent(G);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Canvas + fan geometry. The tee sits at bottom center; the fan opens upward
// across FAN_ARC_DEG. FAN_RADIUS is capped so the ±48° edges stay inside the
// 170px-wide viewBox (85 + R·sin48° ≤ 170 ⇒ R ≤ ~114).
export const FAN_WIDTH = 170;
export const FAN_HEIGHT = 150;
export const TEE = { x: FAN_WIDTH / 2, y: 142 };
export const FAN_RADIUS = 112;
export const FAN_ARC_DEG = 96;
// Any nonzero bucket keeps at least this angular span so it stays visible.
export const MIN_WEDGE_DEG = 6;
// The `short` stub renders near the tee at 20% of the fan radius.
export const SHORT_STUB_RADIUS = FAN_RADIUS * 0.2;

// Spatial order across the fan, left of the fairway to right of it. `short`
// is not part of the main fan — it renders as a stub arc at the tee.
export const FAN_ORDER = ['left', 'fairway', 'super', 'right'];
export const BUCKET_LABELS = {
  left: 'Left', fairway: 'Fairway', super: 'Super', right: 'Right', short: 'Short',
};

// Polar → cartesian on the fan's coordinate system: 0° points straight up
// (12 o'clock, away from the tee), positive degrees rotate clockwise
// (toward the golfer's right).
export function polarToCartesian(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

// Closed wedge path from (cx, cy): line out to the arc start, sweep the arc
// clockwise to the end angle, close back to the origin.
export function wedgePath(cx, cy, r, startDeg, endDeg) {
  const a = polarToCartesian(cx, cy, r, startDeg);
  const b = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${a.x} ${a.y} A ${r} ${r} 0 ${largeArc} 1 ${b.x} ${b.y} Z`;
}

// Lays the nonzero non-short buckets across the arc in spatial order
// (Left → Fairway → Super → Right). Spans are proportional to each bucket's
// share of the fanned (non-short) drives so together they fill the whole
// arc; any nonzero bucket keeps at least `minDeg`, with the excess taken
// proportionally from the larger wedges. Returns wedges with start/end
// degrees relative to straight-up 0° (arc spans -arc/2 … +arc/2), plus each
// bucket's share of ALL recorded drives (what the legend shows).
export function fanLayout(distribution, recorded, {
  arcDeg = FAN_ARC_DEG, minDeg = MIN_WEDGE_DEG,
} = {}) {
  if (!recorded || recorded <= 0) return { wedges: [], short: null };

  const nonzero = FAN_ORDER
    .map((key) => ({ key, count: distribution?.[key] ?? 0 }))
    .filter((b) => b.count > 0);
  const fanTotal = nonzero.reduce((sum, b) => sum + b.count, 0);

  const wedges = nonzero.map((b) => ({
    key: b.key,
    count: b.count,
    share: b.count / recorded,
    span: (b.count / fanTotal) * arcDeg,
  }));

  // Min-span redistribution: bump the tiny wedges to minDeg and shave the
  // deficit off the larger ones, proportional to their excess over minDeg.
  const small = wedges.filter((w) => w.span < minDeg);
  const big = wedges.filter((w) => w.span >= minDeg);
  const deficit = small.reduce((sum, w) => sum + (minDeg - w.span), 0);
  const excess = big.reduce((sum, w) => sum + (w.span - minDeg), 0);
  small.forEach((w) => { w.span = minDeg; });
  if (deficit > 0 && excess > 0) {
    big.forEach((w) => { w.span -= deficit * ((w.span - minDeg) / excess); });
  }

  let cursor = -arcDeg / 2;
  wedges.forEach((w) => {
    w.startDeg = cursor;
    w.endDeg = cursor + w.span;
    cursor = w.endDeg;
  });

  const shortCount = distribution?.short ?? 0;
  const short = shortCount > 0
    ? (() => {
      const share = shortCount / recorded;
      const span = Math.max(minDeg, share * arcDeg);
      // Centered on the fairway line, hugging the tee.
      return { count: shortCount, share, startDeg: -span / 2, endDeg: span / 2 };
    })()
    : null;

  return { wedges, short };
}

// One fan wedge that fades in on mount (reduced motion ⇒ static).
function FadeWedge({ delay, reduced, children }) {
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration: 300, easing: EASE_OUT }));
  }, [reduced, delay, progress]);
  const animatedProps = useAnimatedProps(() => ({ opacity: progress.value }));
  if (reduced) return <G>{children}</G>;
  return <AnimatedG animatedProps={animatedProps}>{children}</AnimatedG>;
}

// Drive dispersion drawn as a fairway seen from the tee: a muted full-fan
// background, then one wedge per recorded drive bucket (angular span ∝ share,
// see fanLayout), a short-drive stub at the tee, and a legend column on the
// right. The whole fan scales up from the tee origin on mount while the
// wedges fade in with a stagger — misses first, the fairway wedge last.
// Callers should omit the component entirely when drives.recorded === 0.
export default function FairwayFan({ drives }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const reduced = useReducedMotion();

  const recorded = drives?.recorded ?? 0;
  const { wedges, short } = useMemo(
    () => fanLayout(drives?.distribution, recorded),
    [drives, recorded],
  );

  // Whole-fan entrance: grow out of the tee point (transform origin at the
  // tee) while the wedges fade in individually.
  const grow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    grow.value = 0;
    grow.value = withTiming(1, { duration: 380, easing: EASE_OUT });
  }, [reduced, grow]);
  const growStyle = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [{ scale: 0.85 + 0.15 * grow.value }],
  }));

  if (recorded <= 0) return null;

  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const colorFor = (key) => (
    key === 'fairway' ? { fill: theme.accent.primary, opacity: 1 }
      : key === 'super' ? { fill: gold, opacity: 1 }
        : key === 'short' ? { fill: theme.text.muted, opacity: 0.5 }
          : { fill: theme.destructive, opacity: 0.45 } // left / right misses
  );

  // Stagger order: misses and the short stub first, the fairway wedge LAST —
  // the hero wedge lands as the finale.
  const staggerKeys = [
    ...wedges.filter((w) => w.key !== 'fairway').map((w) => w.key),
    ...(short ? ['short'] : []),
    ...wedges.filter((w) => w.key === 'fairway').map((w) => w.key),
  ];
  const delayFor = (key) => staggerKeys.indexOf(key) * 60;

  const legendRows = [...FAN_ORDER, 'short']
    .map((key) => {
      const count = drives.distribution?.[key] ?? 0;
      return { key, count, pct: Math.round((count / recorded) * 100) };
    })
    .filter((row) => row.count > 0);

  const FanWrap = reduced ? View : Animated.View;

  return (
    <View style={s.row} testID="fairway-fan">
      <FanWrap style={[s.fanWrap, !reduced && growStyle]}>
        <Svg width={FAN_WIDTH} height={FAN_HEIGHT} viewBox={`0 0 ${FAN_WIDTH} ${FAN_HEIGHT}`}>
          <Path
            d={wedgePath(TEE.x, TEE.y, FAN_RADIUS, -FAN_ARC_DEG / 2, FAN_ARC_DEG / 2)}
            fill={theme.bg.secondary}
            testID="fan-background"
          />
          {wedges.map((w) => {
            const c = colorFor(w.key);
            return (
              <FadeWedge key={w.key} delay={delayFor(w.key)} reduced={reduced}>
                <Path
                  d={wedgePath(TEE.x, TEE.y, FAN_RADIUS, w.startDeg, w.endDeg)}
                  fill={c.fill}
                  fillOpacity={c.opacity}
                  testID={`fan-wedge-${w.key}`}
                />
              </FadeWedge>
            );
          })}
          {short ? (
            <FadeWedge delay={delayFor('short')} reduced={reduced}>
              <Path
                d={wedgePath(TEE.x, TEE.y, SHORT_STUB_RADIUS, short.startDeg, short.endDeg)}
                fill={colorFor('short').fill}
                fillOpacity={colorFor('short').opacity}
                testID="fan-wedge-short"
              />
            </FadeWedge>
          ) : null}
          <Circle cx={TEE.x} cy={TEE.y} r={4} fill={theme.text.primary} testID="fan-tee" />
        </Svg>
      </FanWrap>
      <View style={s.legend}>
        {legendRows.map((row) => {
          const c = colorFor(row.key);
          return (
            <View key={row.key} style={s.legendRow} testID={`fan-legend-${row.key}`}>
              <View style={[s.legendDot, { backgroundColor: c.fill, opacity: c.opacity }]} />
              <Text style={s.legendLabel}>{BUCKET_LABELS[row.key]}</Text>
              <Text style={s.legendPct}>{`${row.pct}%`}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
    fanWrap: {
      width: FAN_WIDTH,
      height: FAN_HEIGHT,
      // Entrance scale grows out of the tee point at (50%, 142/150 ≈ 95%).
      transformOrigin: '50% 95%',
    },
    legend: { flex: 1, gap: 7 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendLabel: {
      flex: 1,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
    },
    legendPct: {
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
      color: theme.text.primary,
    },
  });
}
