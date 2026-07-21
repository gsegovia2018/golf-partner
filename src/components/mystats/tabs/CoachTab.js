import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import PressableScale from '../../ui/PressableScale';
import CoachHero from '../CoachHero';
import CoachBoard from '../CoachBoard';
import FocusCard from '../FocusCard';
import PlaySmarterCard from '../PlaySmarterCard';
import PracticePlanCard from '../PracticePlanCard';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';

export default function CoachTab({ stats, onInfo, targetHandicap, onChangeTarget, focus, focusVerdict, onCommitFocus, onEndFocus }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { metrics = {}, form = {}, formSeries = {}, coach = {} } = stats ?? {};
  const priorityInsight = coach.board?.fixFirst?.[0] ?? coach.hero;

  return (
    <View style={s.wrap}>
      <TargetBenchmarkRow targetHandicap={targetHandicap} onChangeTarget={onChangeTarget} />
      {focus ? <FocusCard focus={focus} verdict={focusVerdict} onEndFocus={onEndFocus} /> : null}
      <FormTrendCard form={form} formSeries={formSeries} metrics={metrics} />
      <CoachHero insight={priorityInsight} onCommitFocus={onCommitFocus} focusActive={!!focus} />
      <CoachBoard
        board={coach.board}
        practicePlan={coach.practicePlan}
        excludeInsightIds={priorityInsight?.id ? [priorityInsight.id] : []}
      />
      <PlaySmarterCard tips={stats?.coachStrategy} onInfo={onInfo} />
      <PracticePlanCard plan={coach.practicePlan} onInfo={onInfo} />
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
      <Feather name="crosshair" size={14} color={theme.text.secondary} />
      <Text style={s.targetText}>{targetBenchmarkCopy(targetHandicap)}</Text>
      {onChangeTarget ? (
        <PressableScale
          onPress={onChangeTarget}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Change target handicap"
        >
          <Feather name="edit-2" size={14} color={theme.text.secondary} />
        </PressableScale>
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

  const wash = toneWash(theme, tone);

  return (
    <SectionCard
      title="Current form"
      testID="current-form-card"
      style={wash ? { backgroundColor: wash, borderColor: 'transparent' } : null}
    >
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
        dropGaps
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

// Surface tint for the whole card: the first thing the Coach tab says should
// be readable from the card color alone. Neutral stays on the plain card.
function toneWash(theme, tone) {
  if (tone === 'good') return theme.accent.light;
  if (tone === 'bad') return theme.isDark ? 'rgba(248,113,113,0.10)' : '#fbeaec';
  return null;
}

// Pill fill sits on top of the wash, so toned pills use the plain card color
// (translucent white in dark mode) to stay visible against the tinted surface.
function toneFill(theme, tone) {
  if (tone === 'neutral') return theme.bg.secondary;
  return theme.isDark ? 'rgba(255,255,255,0.08)' : theme.bg.card;
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
