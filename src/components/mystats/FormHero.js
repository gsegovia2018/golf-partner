import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import TrendLineChart from './TrendLineChart';

// Clubhouse hero surface — cream-on-green, matches CoachHero/LiveRoundCard.
const GREEN = '#00553c';
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_80 = 'rgba(243,239,230,0.8)';
const CREAM_85 = 'rgba(243,239,230,0.85)';
const GOLD = semantic.winner.dark;

// Verdict copy mirrors CoachTab's FormTrendCard: both read the
// avgDifferential entry of stats.form.metrics, whose `direction` is already
// polarity-aware ('up' always means improving). No new stats are invented
// here.
export function formVerdict(direction) {
  if (direction === 'up') return 'Improving lately';
  if (direction === 'down') return 'Trending down lately';
  return 'Holding steady';
}

// Form-tab hero: verdict + score-differential headline number in gold, with
// the differential trend chart drawn on the dark surface itself.
//
// The headline used to be points per round. It isn't any more, because
// points are net of the handicap the round was played off: the same golf is
// worth fewer points once your index drops, so an improving player watched
// this hero call their form "Trending down". The differential is gross and
// slope/rating-adjusted, so it moves only when the golf does. Points per
// round still appears in the meta line as the as-played fact it is.
//   form:       stats.form        ({ metrics, hasHistory, recentCount, historyCount })
//   formSeries: stats.formSeries  ({ metrics: { avgDifferential: [{label, value}] } })
//   metrics:    stats.metrics     (fallback values when form has no slice)
export default function FormHero({ form = {}, formSeries = {}, metrics = {}, n, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const diffMetric = form.metrics?.find((m) => m.key === 'avgDifferential');
  const verdict = formVerdict(diffMetric?.direction ?? 'flat');
  const diffValue = diffMetric?.recent ?? metrics.avgDifferential ?? null;
  const delta = diffMetric?.delta;
  const series = formSeries.metrics?.avgDifferential ?? [];

  // Lower differential is better, so a negative delta is the improvement —
  // the arrow is inverted relative to a points delta.
  const deltaPart = delta == null || delta === 0
    ? null
    : `${delta < 0 ? '▲ ' : '▼ +'}${delta}`;
  const ptsPart = metrics.avgPoints == null ? null : `${metrics.avgPoints} pts/rnd`;
  const meta = form.hasHistory
    ? [`Score differential · recent ${form.recentCount ?? 0} vs previous ${form.historyCount ?? 0} rounds`, deltaPart, ptsPart]
      .filter(Boolean).join(' · ')
    : ['Score differential · select more rounds to compare recent form.', ptsPart]
      .filter(Boolean).join(' · ');

  return (
    <View style={s.card} testID="form-hero-surface">
      <View style={s.kickerRow}>
        <Text style={s.kicker}>{`Current form · Last ${n}`}</Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('scoreDifferential')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="What is Score differential"
          >
            <Feather name="info" size={14} color={CREAM_70} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={s.verdictRow}>
        <Text style={s.verdict}>{verdict}</Text>
        <Text style={s.pts} testID="form-hero-pts">
          {diffValue == null ? '—' : `${diffValue}`}
          <Text style={s.ptsSuffix}> diff</Text>
        </Text>
      </View>
      <TrendLineChart
        series={series}
        color={CREAM}
        labelColor={CREAM_85}
        variant="compact"
        dropGaps
        ringColor={GREEN}
        lastDotColor={GOLD}
      />
      <Text style={s.meta}>{meta}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: GREEN,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    kicker: {
      color: CREAM_70,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    verdictRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    verdict: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 26,
      color: CREAM,
      flexShrink: 1,
    },
    pts: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 32,
      color: GOLD,
      fontVariant: ['tabular-nums'],
    },
    ptsSuffix: {
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: CREAM_70,
    },
    meta: {
      fontSize: 11.5,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: CREAM_80,
    },
  });
}
