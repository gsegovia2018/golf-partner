import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import CountUpText from './CountUpText';
import TrendLineChart from './TrendLineChart';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;
const COL_H = 90;

// ~10% wash of a 6-digit hex theme color, for the delta pill and the soft
// double-bogey band (same helper as ShotDashboard/SparklineRow).
function withAlpha(hex, alpha) {
  const m = /^#([a-f\d]{6})$/i.exec(hex ?? '');
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Each column grows up from its baseline (scaleY 0→1, origin bottom),
// staggered left-to-right. Reduced motion ⇒ static full-height column.
// Mirrors GrowRow in ScoreMixBar.js.
function GrowColumn({ delay, style, testID, accessibilityLabel, children }) {
  const reduced = useReducedMotion();
  const scaleY = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleY.value = withDelay(delay, withTiming(1, { duration: 300, easing: EASE_OUT }));
    }
  }, [reduced, scaleY, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[style, animatedStyle]}
    >
      {children}
    </Animated.View>
  );
}

// Damage headline: latest round's strokes-lost-past-bogey vs the average of
// the other selected rounds. Accessible tinted-pill delta chip — green ▼
// when the latest round leaked less than average, red ▲ when more, muted
// "level" pill inside half a stroke.
function damageDelta(damage) {
  const values = damage.map((d) => d.value).filter((v) => v != null);
  if (values.length === 0) return { latest: null, delta: null };
  const latest = values[values.length - 1];
  const others = values.slice(0, -1);
  if (others.length === 0) return { latest, delta: null };
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  return { latest, delta: latest - avg };
}

function DamageHeadline({ damage, onInfo, reduced, theme, s }) {
  const { latest, delta } = damageDelta(damage);
  const level = delta != null && Math.abs(delta) < 0.5;
  const lower = delta != null && delta <= -0.5;
  const chipColor = level ? theme.text.muted : lower ? theme.accent.primary : theme.destructive;
  const chipText = level
    ? 'level with your average'
    : `${lower ? '▼' : '▲'} ${Math.round(Math.abs(delta))} vs your average`;
  const chipA11y = level
    ? 'Level with your average of the other rounds'
    : `${Math.round(Math.abs(delta))} strokes ${lower ? 'below' : 'above'} your average of the other rounds`;

  return (
    <View style={s.damageRow}>
      <View style={s.damageOvRow}>
        <Text style={s.overline}>Damage · strokes lost past bogey</Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('damage')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="What is Damage"
          >
            <Feather name="info" size={13} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={s.damageValueRow}>
        <Text style={s.damageValue} testID="scoremix-damage-value">
          {latest == null ? '—' : (
            <CountUpText value={latest} duration={500} disabled={reduced} />
          )}
        </Text>
        {delta != null ? (
          <View
            accessible
            testID="scoremix-damage-chip"
            style={[s.deltaChip, { backgroundColor: withAlpha(chipColor, 0.12) }]}
            accessibilityLabel={chipA11y}
          >
            <Text style={[s.deltaChipText, { color: chipColor }]}>{chipText}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// "Score mix" damage-report card content: latest-round damage headline, then
// per-round stacked columns of the five-band net score mix (birdie+ → worse)
// in ScoreMixBar's visual language — one column per round, the latest at
// full opacity, earlier rounds stepped back — then a steady-holes (% at
// bogey or better) trend line under a hairline divider.
//   rounds:    formSeries.scoreMix  [{ label, birdiePlus, par, bogey, double, worse }]
//   damage:    formSeries.damage    [{ label, value }]
//   steadyPct: formSeries.steadyPct [{ label, value }]
export default function ScoreMixColumns({ rounds = [], damage = [], steadyPct = [], onInfo }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const C = {
    birdiePlus: theme.accent.primary,
    par: '#7fb59f',
    bogey: '#e7d7b4',
    double: withAlpha(theme.destructive, 0.45),
    worse: theme.destructive,
  };

  if (rounds.length < 2) {
    return <Text style={s.empty}>Select two or more rounds to see the score mix.</Text>;
  }

  return (
    <View style={s.wrap}>
      <DamageHeadline damage={damage} onInfo={onInfo} reduced={reduced} theme={theme} s={s} />

      <Text style={s.caption}>One column per round · share of holes, birdie+ → worse</Text>
      <View style={s.columnsRow}>
        {rounds.map((r, i) => {
          const total = r.birdiePlus + r.par + r.bogey + r.double + r.worse || 1;
          const isLatest = i === rounds.length - 1;
          const segs = [
            { key: 'birdiePlus', count: r.birdiePlus, color: C.birdiePlus },
            { key: 'par', count: r.par, color: C.par },
            { key: 'bogey', count: r.bogey, color: C.bogey },
            { key: 'double', count: r.double, color: C.double },
            { key: 'worse', count: r.worse, color: C.worse },
          ].filter((seg) => seg.count > 0);
          return (
            <View key={r.label ?? i} style={s.col}>
              <GrowColumn
                delay={i * STAGGER_MS}
                style={[s.stack, !isLatest && s.stackPast]}
                testID={`scoremix-col-${i}`}
                accessibilityLabel={
                  `Round ${i + 1}: ${r.birdiePlus} birdie or better, ${r.par} par, `
                  + `${r.bogey} bogey, ${r.double} double bogey, ${r.worse} worse`
                }
              >
                {segs.map((seg, j) => (
                  <View
                    key={seg.key}
                    testID={`scoremix-col-${i}-${seg.key}`}
                    style={[
                      s.segment,
                      { height: (seg.count / total) * COL_H, backgroundColor: seg.color },
                      j === 0 && s.segmentTop,
                    ]}
                  />
                ))}
              </GrowColumn>
              <Text style={s.colLabel}>{`R${i + 1}`}</Text>
            </View>
          );
        })}
      </View>
      <View style={s.legend}>
        {[
          ['Birdie+', C.birdiePlus], ['Par', C.par], ['Bogey', C.bogey],
          ['Double', C.double], ['Worse', C.worse],
        ].map(([label, color]) => (
          <View key={label} style={s.lg}>
            <View style={[s.sw, { backgroundColor: color }]} />
            <Text style={s.lgText}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={s.divider} />
      <View style={s.damageOvRow}>
        <Text style={s.overline}>Steady holes · bogey or better</Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('steadyHoles')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="What is Steady holes"
          >
            <Feather name="info" size={13} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <TrendLineChart
        series={steadyPct}
        color={theme.accent.primary}
        variant="compact"
        formatValue={(v) => `${v}%`}
        dropGaps
      />
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    empty: {
      ...theme.typography.caption,
      color: theme.text.muted,
      fontStyle: 'italic',
      paddingVertical: theme.spacing.md,
      textAlign: 'center',
    },
    damageRow: { gap: 2 },
    damageOvRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    overline: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: theme.text.muted,
    },
    damageValueRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    damageValue: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 26,
      color: theme.destructive,
      fontVariant: ['tabular-nums'],
    },
    deltaChip: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    deltaChipText: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    columnsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 6,
    },
    col: { flex: 1, minWidth: 0, gap: 4, alignItems: 'stretch' },
    stack: {
      height: COL_H,
      transformOrigin: 'bottom',
    },
    stackPast: { opacity: 0.8 },
    segment: { width: '100%' },
    segmentTop: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    colLabel: {
      ...theme.typography.tiny,
      color: theme.text.muted,
      fontWeight: '700',
      textAlign: 'center',
    },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, rowGap: 4 },
    lg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sw: { width: 10, height: 10, borderRadius: 3 },
    lgText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
