import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import TrendLineChart from './TrendLineChart';
import { SGBar } from './SGBars';

function verdict(form) {
  if (!form?.hasHistory) return 'Not enough history';
  const direction = form.metrics?.[0]?.direction;
  if (direction === 'up') return 'Improving';
  if (direction === 'down') return 'Declining';
  return 'Holding steady';
}

function signed(value) {
  if (value == null) return '-';
  return value > 0 ? `+${value}` : `${value}`;
}

function sgTitle(targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return 'Strokes gained vs scratch';
  return `Strokes gained vs handicap ${targetHandicap}`;
}

function pointsTrendCopy(form) {
  if (!form?.hasHistory) return 'Play more rounds to see a trend.';
  const delta = form.metrics?.[0]?.delta;
  if (delta == null) return 'Not enough scored rounds for a trend.';
  return `${delta > 0 ? '+' : ''}${delta} pts / round vs earlier rounds`;
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
  const s = useMemo(() => makeStyles(theme), [theme]);
  const pointsSeries = formSeries.metrics?.avgPoints ?? [];
  const hasStrokesGained = strokesGained?.total != null;

  return (
    <SectionCard title="Performance Snapshot">
      <View style={s.summaryGrid}>
        <View style={s.summaryPanel}>
          <Text style={s.panelLabel}>Current form</Text>
          <Text style={s.panelValue}>{verdict(form)}</Text>
          <Text style={s.panelMeta}>{pointsTrendCopy(form)}</Text>
        </View>
        <View style={s.summaryPanel}>
          <Text style={s.panelLabel}>Target gap</Text>
          <Text
            style={[
              s.panelValue,
              hasStrokesGained && {
                color: strokesGained.total >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor'),
              },
            ]}
          >
            {hasStrokesGained ? `${strokesGained.total >= 0 ? '+' : ''}${strokesGained.total.toFixed(2)}` : '-'}
          </Text>
          <View style={s.targetRow}>
            <Text style={s.panelMeta}>{hasStrokesGained ? sgTitle(targetHandicap) : 'No target data yet'}</Text>
            {onChangeTarget ? (
              <TouchableOpacity
                onPress={onChangeTarget}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change target handicap"
              >
                <Feather name="edit-2" size={14} color={theme.text.secondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <TrendLineChart series={pointsSeries} color={theme.accent.primary} labelColor={theme.text.secondary} />

      <View style={s.metricRail}>
        <MetricCell label="Rounds" value={`${metrics.rounds ?? 0}`} s={s} />
        <MetricCell label="Avg pts" value={`${metrics.avgPoints ?? '-'}`} s={s} />
        <MetricCell label="Best round" value={`${metrics.bestRoundPoints ?? '-'}`} s={s} />
      </View>

      {hasStrokesGained ? (
        <View style={s.block}>
          <Text style={s.blockTitle}>Strokes gained by area</Text>
          <Text style={s.blockMeta}>{sgTitle(targetHandicap)}</Text>
          <SGBar label="Off the tee" value={strokesGained.byCategory?.tee} />
          <SGBar label="Approach" value={strokesGained.byCategory?.approach} />
          <SGBar label="Around green" value={strokesGained.byCategory?.aroundGreen} />
          <SGBar label="Putting" value={strokesGained.byCategory?.putting} />
        </View>
      ) : null}

      <View style={s.block}>
        <Text style={s.blockTitle}>Evidence behind it</Text>
        {ranking.baseline == null ? (
          <Text style={s.note}>Not enough data yet.</Text>
        ) : (
          <>
            <EvidenceGroup title="Top strengths" cells={(ranking.strengths ?? []).slice(0, 3)} kind="good" s={s} theme={theme} />
            <EvidenceGroup title="Bottom leaks" cells={(ranking.weaknesses ?? []).slice(0, 3)} kind="bad" s={s} theme={theme} />
            <Text style={s.note}>{`Measured against your ${ranking.baseline} pts/hole average.`}</Text>
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
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.evidenceGroup}>
      <Text style={[s.evidenceGroupTitle, { color }]}>{title}</Text>
      {cells.length === 0 ? (
        <Text style={s.note}>Nothing stands out yet.</Text>
      ) : cells.map((cell) => (
        <EvidenceRow key={`${kind}-${cell.label}`} cell={cell} kind={kind} s={s} theme={theme} />
      ))}
    </View>
  );
}

function EvidenceRow({ cell, kind, s, theme }) {
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.evidenceRow}>
      <Feather name={kind === 'good' ? 'trending-up' : 'trending-down'} size={16} color={color} />
      <View style={s.evidenceText}>
        <Text style={s.evidenceName}>{cell.label}</Text>
        <Text style={s.evidenceSub}>{`${cell.avgPoints ?? '-'} pts / hole`}</Text>
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
