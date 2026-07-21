import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;
const COL_H = 90;

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

// Per-round stacked columns of score-mix shares — the honest form for the
// 3–10 rounds the Form tab shows, in ScoreMixBar's visual language. One
// column per round; segment heights are that round's share of holes ending
// birdie+ / par / bogey+. The latest round is full-opacity, earlier rounds
// step back. rounds: [{ label, birdie, par, bogey }] (formSeries.scoreMix).
export default function ScoreMixColumns({ rounds = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const C = { birdie: theme.accent.primary, par: '#7fb59f', bogey: '#e7d7b4' };

  if (rounds.length < 2) {
    return <Text style={s.empty}>Select two or more rounds to see the score mix.</Text>;
  }

  return (
    <View>
      <View style={s.columnsRow}>
        {rounds.map((r, i) => {
          const total = r.birdie + r.par + r.bogey || 1;
          const isLatest = i === rounds.length - 1;
          const segs = [
            { key: 'birdie', count: r.birdie, color: C.birdie },
            { key: 'par', count: r.par, color: C.par },
            { key: 'bogey', count: r.bogey, color: C.bogey },
          ].filter((seg) => seg.count > 0);
          return (
            <View key={r.label ?? i} style={s.col}>
              <GrowColumn
                delay={i * STAGGER_MS}
                style={[s.stack, !isLatest && s.stackPast]}
                testID={`scoremix-col-${i}`}
                accessibilityLabel={
                  `Round ${i + 1}: ${r.birdie} birdie or better, ${r.par} par, ${r.bogey} bogey or worse`
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
        {[['Birdie+', C.birdie], ['Par', C.par], ['Bogey+', C.bogey]].map(([label, color]) => (
          <View key={label} style={s.lg}>
            <View style={[s.sw, { backgroundColor: color }]} />
            <Text style={s.lgText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    empty: {
      ...theme.typography.caption,
      color: theme.text.muted,
      fontStyle: 'italic',
      paddingVertical: theme.spacing.md,
      textAlign: 'center',
    },
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
    legend: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm },
    lg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sw: { width: 10, height: 10, borderRadius: 3 },
    lgText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
