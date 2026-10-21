import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, t as tNow, formatNumber } from '../../i18n';
import { toneOfDirection, toneSurface } from '../../theme/tone';
import TrendLineChart from './TrendLineChart';

// Verdict copy mirrors CoachTab's FormTrendCard: both read the
// avgDifferential entry of stats.form.metrics, whose `direction` is already
// polarity-aware ('up' always means improving). No new stats are invented
// here.
export function formVerdict(direction) {
  if (direction === 'up') return tNow('stats.my.form.improving');
  if (direction === 'down') return tNow('stats.my.form.trendingDown');
  return tNow('stats.my.form.steady');
}

// Form-tab hero: verdict + score-differential headline number, with the
// differential trend chart drawn on the surface itself. The surface is the
// verdict's tone, like the Informe de vuelta hero: green improving, ink
// steady, red trending down (the tone rule, src/theme/tone.js).
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
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const diffMetric = form.metrics?.find((m) => m.key === 'avgDifferential');
  const direction = diffMetric?.direction ?? 'flat';
  const verdict = formVerdict(direction);
  const surface = toneSurface(theme, toneOfDirection(direction));
  const diffValue = diffMetric?.recent ?? metrics.avgDifferential ?? null;
  const delta = diffMetric?.delta;
  const series = formSeries.metrics?.avgDifferential ?? [];

  // Lower differential is better, so a negative delta is the improvement —
  // the arrow is inverted relative to a points delta.
  const deltaPart = delta == null || delta === 0
    ? null
    : `${delta < 0 ? '▲ ' : '▼ +'}${formatNumber(delta)}`;
  const ptsPart = metrics.avgPoints == null ? null : t('stats.my.form.ptsRnd', { value: formatNumber(metrics.avgPoints) });
  const meta = form.hasHistory
    ? [t('stats.my.form.metaHistory', { recent: form.recentCount ?? 0, previous: form.historyCount ?? 0 }), ptsPart]
      .filter(Boolean).join(' · ')
    : [t('stats.my.form.metaSelectMore'), ptsPart]
      .filter(Boolean).join(' · ');

  return (
    <View style={[s.card, { backgroundColor: surface }]} testID="form-hero-surface">
      <View style={s.kickerRow}>
        <Text style={s.kicker}>{t('stats.my.form.kicker', { n })}</Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('scoreDifferential')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('stats.my.whatIs', { name: t('stats.my.metric.avgDifferential') })}
          >
            <Feather name="info" size={14} color={theme.text.inverse} style={s.faint} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={s.verdictRow}>
        <Text style={s.verdict}>{verdict}</Text>
        <Text style={s.pts} testID="form-hero-pts">
          {diffValue == null ? '—' : formatNumber(diffValue, { maxDecimals: 4 })}
          <Text style={s.ptsSuffix}>{t('stats.my.form.diffSuffix')}</Text>
        </Text>
      </View>
      <TrendLineChart
        series={series}
        color={theme.text.inverse}
        labelColor={theme.text.inverse}
        variant="compact"
        dropGaps
        ringColor={surface}
      />
      {deltaPart ? (
        <View style={s.chip}>
          <Text style={s.chipText} testID="form-hero-delta">{t('stats.my.form.deltaChip', { delta: deltaPart })}</Text>
        </View>
      ) : null}
      <Text style={s.meta}>{meta}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    faint: { opacity: 0.75 },
    kicker: {
      color: theme.text.inverse,
      opacity: 0.75,
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
      color: theme.text.inverse,
      flexShrink: 1,
    },
    pts: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 32,
      color: theme.text.inverse,
      fontVariant: ['tabular-nums'],
    },
    ptsSuffix: {
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.inverse,
      opacity: 0.75,
    },
    // Same chip as the report hero's chips.
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: theme.isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)',
      borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
    },
    chipText: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse,
      fontVariant: ['tabular-nums'],
    },
    meta: {
      fontSize: 11.5,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.inverse,
      opacity: 0.8,
    },
  });
}
