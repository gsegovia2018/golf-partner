import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, t as tNow, formatNumber } from '../../i18n';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import TrendLineChart from './TrendLineChart';
import { SGBar } from './SGBars';
import { renderMsg } from './msg';

// The headline form metric: score differential, which — unlike points per
// round — does not move when the handicap does. `direction` is already
// polarity-aware ('up' means improving even though a lower differential is
// the better one).
const formMetric = (form) => form?.metrics?.find((m) => m.key === 'avgDifferential');

function verdict(form) {
  if (!form?.hasHistory) return tNow('stats.my.snapshot.noHistory');
  const direction = formMetric(form)?.direction;
  if (direction === 'up') return tNow('stats.my.snapshot.improving');
  if (direction === 'down') return tNow('stats.my.snapshot.declining');
  return tNow('stats.my.snapshot.steady');
}

function signed(value) {
  if (value == null) return '-';
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function sgTitle(targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return tNow('stats.my.snapshot.sgScratch');
  return tNow('stats.my.snapshot.sgHandicap', { target: formatNumber(targetHandicap) });
}

function formTrendCopy(form) {
  if (!form?.hasHistory) return tNow('stats.my.snapshot.playMore');
  const delta = formMetric(form)?.delta;
  if (delta == null) return tNow('stats.my.snapshot.notEnoughScored');
  return tNow('stats.my.snapshot.diffVsEarlier', { delta: `${delta > 0 ? '+' : ''}${formatNumber(delta)}` });
}

export default function PerformanceSnapshot({
  metrics = {},
  form = {},
  formSeries = {},
  ranking = {},
  strokesGained,
  targetHandicap,
  onChangeTarget,
}) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // Matches the metric the verdict above the chart is drawn from.
  const diffSeries = formSeries.metrics?.avgDifferential ?? [];
  const hasStrokesGained = strokesGained?.total != null;

  return (
    <SectionCard title={t('stats.my.snapshot.title')}>
      <View style={s.summaryGrid}>
        <View style={s.summaryPanel}>
          <Text style={s.panelLabel}>{t('stats.my.snapshot.currentForm')}</Text>
          <Text style={s.panelValue}>{verdict(form)}</Text>
          <Text style={s.panelMeta}>{formTrendCopy(form)}</Text>
        </View>
        <View style={s.summaryPanel}>
          <Text style={s.panelLabel}>{t('stats.my.snapshot.targetGap')}</Text>
          <Text
            style={[
              s.panelValue,
              hasStrokesGained && {
                color: strokesGained.total >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor'),
              },
            ]}
          >
            {hasStrokesGained ? `${strokesGained.total >= 0 ? '+' : ''}${formatNumber(strokesGained.total, { decimals: 2 })}` : '-'}
          </Text>
          <View style={s.targetRow}>
            <Text style={s.panelMeta}>{hasStrokesGained ? sgTitle(targetHandicap) : t('stats.my.snapshot.noTarget')}</Text>
            {onChangeTarget ? (
              <PressableScale
                onPress={onChangeTarget}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('stats.my.snapshot.changeTarget')}
              >
                <Feather name="edit-2" size={14} color={theme.text.secondary} />
              </PressableScale>
            ) : null}
          </View>
        </View>
      </View>

      <TrendLineChart series={diffSeries} color={theme.accent.primary} labelColor={theme.text.secondary} dropGaps />

      <View style={s.metricRail}>
        <MetricCell label={t('stats.my.snapshot.rounds')} value={`${metrics.rounds ?? 0}`} s={s} />
        <MetricCell label={t('stats.my.snapshot.avgPts')} value={metrics.avgPoints == null ? '-' : formatNumber(metrics.avgPoints, { maxDecimals: 4 })} s={s} />
        <MetricCell label={t('stats.my.snapshot.bestRound')} value={metrics.bestRoundPoints == null ? '-' : formatNumber(metrics.bestRoundPoints, { maxDecimals: 4 })} s={s} />
      </View>

      {hasStrokesGained ? (
        <View style={s.block}>
          <Text style={s.blockTitle}>{t('stats.my.snapshot.sgByArea')}</Text>
          <Text style={s.blockMeta}>{sgTitle(targetHandicap)}</Text>
          <SGBar label={t('stats.my.snapshot.offTheTee')} value={strokesGained.byCategory?.offTheTee} />
          <SGBar label={t('stats.my.snapshot.approach')} value={strokesGained.byCategory?.approach} />
          <SGBar label={t('stats.my.snapshot.aroundGreen')} value={strokesGained.byCategory?.aroundGreen} />
          <SGBar label={t('stats.my.snapshot.putting')} value={strokesGained.byCategory?.putting} />
        </View>
      ) : null}

      <View style={s.block}>
        <Text style={s.blockTitle}>{t('stats.my.snapshot.evidence')}</Text>
        {ranking.baseline == null ? (
          <Text style={s.note}>{t('stats.my.snapshot.noData')}</Text>
        ) : (
          <>
            <EvidenceGroup title={t('stats.my.snapshot.strengths')} cells={(ranking.strengths ?? []).slice(0, 3)} kind="good" s={s} theme={theme} />
            <EvidenceGroup title={t('stats.my.snapshot.leaks')} cells={(ranking.weaknesses ?? []).slice(0, 3)} kind="bad" s={s} theme={theme} />
            <Text style={s.note}>{t('stats.my.snapshot.baseline', { value: formatNumber(ranking.baseline, { maxDecimals: 4 }) })}</Text>
          </>
        )}
      </View>
    </SectionCard>
  );
}

function MetricCell({ label, value, s }) {
  return (
    <View style={s.metricCell}>
      <Text style={s.metricValue}>{value}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

function EvidenceGroup({ title, cells, kind, s, theme }) {
  const t = useT();
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.evidenceGroup}>
      <Text style={[s.evidenceGroupTitle, { color }]}>{title}</Text>
      {cells.length === 0 ? (
        <Text style={s.note}>{t('stats.my.snapshot.nothing')}</Text>
      ) : cells.map((cell) => (
        <EvidenceRow key={`${kind}-${cell.label}`} cell={cell} kind={kind} s={s} theme={theme} />
      ))}
    </View>
  );
}

function EvidenceRow({ cell, kind, s, theme }) {
  const t = useT();
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.evidenceRow}>
      <Feather name={kind === 'good' ? 'trending-up' : 'trending-down'} size={16} color={color} />
      <View style={s.evidenceText}>
        <Text style={s.evidenceName}>{cell.labelMsg ? renderMsg(cell.labelMsg) : cell.label}</Text>
        <Text style={s.evidenceSub}>{t('stats.my.snapshot.ptsPerHole', { value: cell.avgPoints == null ? '-' : formatNumber(cell.avgPoints, { maxDecimals: 4 }) })}</Text>
      </View>
      <Text style={[s.evidenceDelta, { color }]}>{signed(cell.deviation)}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    summaryGrid: { flexDirection: 'row', gap: theme.spacing.md },
    summaryPanel: {
      flex: 1,
      minWidth: 0,
      gap: 3,
      paddingBottom: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.default,
    },
    panelLabel: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '800' },
    panelValue: { ...theme.typography.heading, color: theme.text.primary, fontWeight: '800' },
    panelMeta: { ...theme.typography.caption, color: theme.text.secondary, flexShrink: 1 },
    targetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
    metricRail: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      marginTop: theme.spacing.xs,
    },
    metricCell: {
      flex: 1,
      paddingVertical: theme.spacing.md,
      paddingRight: theme.spacing.sm,
      gap: 1,
    },
    metricValue: { ...theme.typography.heading, color: theme.text.primary, fontWeight: '800' },
    metricLabel: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '800' },
    block: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.lg,
      marginTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
    },
    blockTitle: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    blockMeta: { ...theme.typography.caption, color: theme.text.secondary },
    evidenceGroup: { gap: 0, marginTop: theme.spacing.xs },
    evidenceGroupTitle: { ...theme.typography.caption, fontWeight: '800', marginBottom: theme.spacing.xs },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', marginTop: theme.spacing.xs },
    evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    evidenceText: { flex: 1 },
    evidenceName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '600' },
    evidenceSub: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    evidenceDelta: { ...theme.typography.caption, fontWeight: '800' },
  });
}

export { EvidenceGroup, EvidenceRow, MetricCell, sgTitle, verdict };
