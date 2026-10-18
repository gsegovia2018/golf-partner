import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import { useT, formatNumber } from '../../../i18n';
import PressableScale from '../../ui/PressableScale';
import DiagnosisCard from '../DiagnosisCard';
import WeeklyPlanCard from '../WeeklyPlanCard';
import CoachBoard from '../CoachBoard';
import FocusCard from '../FocusCard';
import PlaySmarterCard from '../PlaySmarterCard';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';

// The one-time notice's text by its kind (store/coachFocus.js loadFocusNotice).
const NOTICE_KEY = {
  'v1-closed': 'stats.my.coach.ui.notice.v1Closed',
  'since-commit': 'stats.my.coach.ui.notice.sinceCommit',
};

// Memoised: the six stats tabs all stay mounted behind the pager, so without
// this every tab commit re-renders all of them and blocks the swipe.
// Composition only (spec §12): target row, one-time notice, focus (only with a
// focus), diagnosis, weekly plan, current form, the board folded as "More
// findings", then the Play smarter tips.
// `week` comes from store/coachWeek.js buildCoachWeek.
function CoachTab({
  stats, onInfo, targetHandicap, onChangeTarget, focus, focusVerdict, onCommitFocus, onEndFocus,
  week = null, onChangeMinutes, swingSupport, onRecordSwing, onOpenSwing, focusNotice = null, onDismissNotice,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { metrics = {}, form = {}, formSeries = {}, coach = {} } = stats ?? {};
  const fixFirstIds = (coach.board?.fixFirst ?? []).map((insight) => insight.id).filter(Boolean);
  const noticeKey = NOTICE_KEY[focusNotice?.kind] ?? null;

  return (
    <View style={s.wrap}>
      <TargetBenchmarkRow targetHandicap={targetHandicap} onChangeTarget={onChangeTarget} />
      {noticeKey ? (
        <View style={s.notice} testID="focus-notice">
          <Feather name="info" size={14} color={theme.info} />
          <Text style={s.noticeText}>{t(noticeKey)}</Text>
          {onDismissNotice ? (
            <PressableScale
              onPress={onDismissNotice}
              accessibilityRole="button"
              accessibilityLabel={t('stats.my.coach.ui.notice.dismiss')}
              style={s.noticeBtn}
            >
              <Text style={s.noticeBtnText}>{t('stats.my.coach.ui.notice.dismiss')}</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {focus ? <FocusCard focus={focus} verdict={focusVerdict} onEndFocus={onEndFocus} onInfo={onInfo} /> : null}
      <DiagnosisCard
        week={week}
        diagnosis={stats?.coachDiagnosis}
        roundCount={stats?.roundCount ?? 0}
        focusActive={!!focus}
        onCommitFocus={onCommitFocus}
        onInfo={onInfo}
        swingSupport={swingSupport}
        onRecordSwing={onRecordSwing}
        onOpenSwing={onOpenSwing}
      />
      <WeeklyPlanCard week={week} focus={focus} verdict={focusVerdict} onChangeMinutes={onChangeMinutes} onInfo={onInfo} />
      <FormTrendCard form={form} formSeries={formSeries} metrics={metrics} />
      <CoachBoard
        board={coach.board}
        weekPills={week?.pills}
        excludeInsightIds={fixFirstIds}
        collapsible
      />
      <PlaySmarterCard tips={stats?.coachStrategy ?? []} onInfo={onInfo} />
    </View>
  );
}

// Mirrors ShotDashboard's target title so both tabs describe the same
// baseline the SG and coach numbers are computed against.
function targetBenchmarkCopy(t, targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return t('stats.tab.coach.benchScratch');
  return t('stats.tab.coach.benchTarget', { target: formatNumber(targetHandicap) });
}

function TargetBenchmarkRow({ targetHandicap, onChangeTarget }) {
  const t = useT();
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.targetRow}>
      <Feather name="crosshair" size={14} color={theme.text.secondary} />
      <Text style={s.targetText}>{targetBenchmarkCopy(t, targetHandicap)}</Text>
      {onChangeTarget ? (
        <PressableScale
          onPress={onChangeTarget}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('stats.tab.coach.changeTarget')}
        >
          <Feather name="edit-2" size={14} color={theme.text.secondary} />
        </PressableScale>
      ) : null}
    </View>
  );
}

function FormTrendCard({ form = {}, formSeries = {}, metrics = {} }) {
  const t = useT();
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // Score differential, not points per round: points are net of the handicap
  // each round was played off, so a falling index makes identical golf read
  // as a decline. See the note above syntheticDifferential in personalStats.
  const diffMetric = form.metrics?.find((metric) => metric.key === 'avgDifferential');
  const direction = diffMetric?.direction ?? 'flat';
  const tone = direction === 'up' ? 'good' : direction === 'down' ? 'bad' : 'neutral';
  const color = toneColor(theme, tone);
  const series = formSeries.metrics?.avgDifferential ?? [];
  const delta = diffMetric?.delta;
  const title = direction === 'up' ? t('stats.tab.coach.improving')
    : direction === 'down' ? t('stats.tab.coach.trendingDown')
      : t('stats.tab.coach.steady');
  const avgDiff = metrics.avgDifferential;
  const value = delta == null
    ? t('stats.tab.coach.diff', { value: typeof avgDiff === 'number' ? formatNumber(avgDiff) : (avgDiff ?? '-') })
    : t('stats.tab.coach.diff', { value: `${delta > 0 ? '+' : ''}${formatNumber(delta)}` });
  const meta = form.hasHistory
    ? t('stats.tab.coach.recentVsPrevious', {
      recent: form.recentCount ?? 0, previous: form.historyCount ?? 0,
    })
    : t('stats.tab.coach.selectMore');

  const wash = toneWash(theme, tone);

  return (
    <SectionCard
      title={t('stats.tab.coach.currentForm')}
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
        caption={t('stats.tab.coach.scoreDifferential')}
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
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.card,
    },
    noticeText: { ...theme.typography.caption, color: theme.text.primary, flex: 1 },
    noticeBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
    noticeBtnText: { ...theme.typography.caption, color: theme.info, fontWeight: '800' },
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

export default React.memo(CoachTab);
