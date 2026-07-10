import React, { useMemo } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import CoachHero from '../CoachHero';
import CoachBoard from '../CoachBoard';
import PracticePlanCard from '../PracticePlanCard';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';

export default function CoachTab({ stats, targetHandicap, onChangeTarget }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { metrics = {}, form = {}, formSeries = {}, coach = {} } = stats ?? {};
  const priorityInsight = coach.board?.fixFirst?.[0] ?? coach.hero;

  return (
    <View style={s.wrap}>
      <TargetBenchmarkRow targetHandicap={targetHandicap} onChangeTarget={onChangeTarget} />
      <FormTrendCard form={form} formSeries={formSeries} metrics={metrics} />
      <CoachHero insight={priorityInsight} />
      <CoachBoard
        board={coach.board}
        practicePlan={coach.practicePlan}
        excludeInsightIds={priorityInsight?.id ? [priorityInsight.id] : []}
      />
      <PracticePlanCard plan={coach.practicePlan} />
    </View>
  );
}

// Mirrors ShotDashboard's target title so both tabs describe the same
// baseline the SG and coach numbers are computed against.
function targetBenchmarkCopy(targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return 'Benchmarks vs scratch';
  return `Benchmarks vs ${targetHandicap}-handicap target`;
}

function TargetBenchmarkRow({ targetHandicap, onChangeTarget }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.targetRow}>
      <Feather name="crosshair" size={13} color={theme.text.secondary} />
      <Text style={s.targetText}>{targetBenchmarkCopy(targetHandicap)}</Text>
      {onChangeTarget ? (
        <TouchableOpacity
          onPress={onChangeTarget}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Change target handicap"
        >
          <Feather name="edit-2" size={13} color={theme.text.secondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function FormTrendCard({ form = {}, formSeries = {}, metrics = {} }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const pointsMetric = form.metrics?.find((metric) => metric.key === 'avgPoints');
  const direction = pointsMetric?.direction ?? 'flat';
  const tone = direction === 'up' ? 'good' : direction === 'down' ? 'bad' : 'neutral';
  const color = toneColor(theme, tone);
  const series = formSeries.metrics?.avgPoints ?? [];
  const delta = pointsMetric?.delta;
  const title = direction === 'up' ? 'Improving lately'
    : direction === 'down' ? 'Trending down lately'
      : 'Holding steady';
  const value = delta == null
    ? `${metrics.avgPoints ?? '-'} pts / round`
    : `${delta > 0 ? '+' : ''}${delta} pts / round`;
  const meta = form.hasHistory
    ? `Recent ${form.recentCount ?? 0} vs previous ${form.historyCount ?? 0} rounds`
    : 'Select more rounds to compare recent form.';

  return (
    <SectionCard title="Current form">
      <View style={s.formHead}>
        <View style={s.formCopy}>
          <Text style={[s.formTitle, { color }]}>{title}</Text>
          <Text style={s.formMeta}>{meta}</Text>
        </View>
        <View style={[s.formPill, { backgroundColor: toneFill(theme, tone) }]}>
          <Text style={[s.formPillText, { color }]}>{value}</Text>
        </View>
      </View>
      <TrendLineChart
        series={series}
        color={color}
        labelColor={theme.text.secondary}
        variant="compact"
        caption="Points per round"
      />
    </SectionCard>
  );
}

function toneColor(theme, tone) {
  if (tone === 'good') return theme.scoreColor('good');
  if (tone === 'bad') return theme.destructive;
  return theme.text.muted;
}

function toneFill(theme, tone) {
  if (tone === 'good') return theme.accent.light;
  if (tone === 'bad') return theme.isDark ? 'rgba(248,113,113,0.14)' : '#fee2e2';
  return theme.bg.secondary;
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    targetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: theme.spacing.xs,
    },
    targetText: { ...theme.typography.caption, color: theme.text.secondary, flexShrink: 1 },
    formHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    formCopy: { flex: 1, minWidth: 0, gap: 2 },
    formTitle: { ...theme.typography.heading, fontWeight: '900' },
    formMeta: { ...theme.typography.caption, color: theme.text.secondary },
    formPill: {
      flexShrink: 0,
      maxWidth: 132,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    formPillText: { ...theme.typography.caption, fontWeight: '900', textAlign: 'right' },
  });
}
