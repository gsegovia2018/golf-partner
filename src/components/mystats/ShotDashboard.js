import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import { SGBar } from './SGBars';
import {
  APPROACH_BUCKETS,
  MIN_SG_CATEGORY_SAMPLE,
  PUTT_BUCKETS,
  SG_CATEGORIES,
  formatSignedFixed,
  sampleText,
  signed,
} from './shotMetrics';

function CategoryRow({ category, strokesGained }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const sample = strokesGained?.sampleHolesByCategory?.[category.key] ?? 0;
  if (sample < MIN_SG_CATEGORY_SAMPLE) {
    return (
      <Text style={s.gatedRow}>
        {`${category.label}: needs ${MIN_SG_CATEGORY_SAMPLE - sample} more holes`}
      </Text>
    );
  }
  const delta = strokesGained?.personalDelta?.[category.key];
  const showDelta = delta?.delta != null && delta.delta !== 0;
  const up = delta?.direction === 'up';
  return (
    <View style={s.categoryRow}>
      <SGBar label={category.label} value={strokesGained.byCategory?.[category.key]} />
      <View style={s.categoryMeta}>
        {showDelta ? (
          <Text style={[s.deltaBadge, { color: up ? theme.scoreColor('good') : theme.destructive }]}>
            {`${up ? '▲' : '▼'} ${delta.delta > 0 ? '+' : ''}${delta.delta} vs your last stretch`}
          </Text>
        ) : <View />}
        <Text style={s.sampleChip}>{sampleText(sample, 'holes')}</Text>
      </View>
    </View>
  );
}

// Weakest-category call-out: name the thinnest sample when anything is still
// gated, otherwise confirm the tracked base.
function evidenceMeta(strokesGained) {
  const samples = strokesGained?.sampleHolesByCategory;
  if (!samples) return 'Bucketed from logged shots.';
  const gated = SG_CATEGORIES
    .map((c) => ({ label: c.label, sample: samples[c.key] ?? 0 }))
    .filter((c) => c.sample < MIN_SG_CATEGORY_SAMPLE)
    .sort((a, b) => a.sample - b.sample);
  if (gated.length === 0) return 'All five categories sampled.';
  return `${gated[0].label}: needs ${MIN_SG_CATEGORY_SAMPLE - gated[0].sample} more holes`;
}

export default function ShotDashboard({ stats, targetHandicap, onChangeTarget, onInfo, TargetNudge }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const strokesGained = stats?.strokesGained;
  const hasStrokesGained = strokesGained?.total != null;
  const signals = useMemo(() => buildShotSignals(stats), [stats]);
  const targetCopy = targetTitle(targetHandicap);
  const sample = sampleText(strokesGained?.sampleHoles, 'holes') ?? trackedSample(stats);

  return (
    <SectionCard
      title="Strokes Gained Dashboard"
      infoKey="strokesGained"
      onInfo={onInfo}
      right={
        onChangeTarget ? (
          <TouchableOpacity
            onPress={onChangeTarget}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change target handicap"
          >
            <Feather name="edit-2" size={14} color={theme.text.secondary} />
          </TouchableOpacity>
        ) : null
      }
    >
      <View style={s.summaryGrid}>
        <View style={s.summaryPanel}>
          <Text style={s.panelLabel}>Target gap</Text>
          <Text
            style={[
              s.panelValue,
              hasStrokesGained && {
                color: strokesGained.total >= 0 ? theme.scoreColor('good') : theme.destructive,
              },
            ]}
          >
            {hasStrokesGained ? `${formatSignedFixed(strokesGained.total)} / round` : '-'}
          </Text>
          <Text style={s.panelMeta}>{hasStrokesGained ? targetCopy : 'Log putt distance and regulation approach shots.'}</Text>
        </View>
        <View style={s.summaryPanel}>
          <Text style={s.panelLabel}>Evidence</Text>
          <Text style={s.panelValue}>{sample ?? 'Tracked data'}</Text>
          <Text style={s.panelMeta}>{evidenceMeta(strokesGained)}</Text>
        </View>
      </View>

      {strokesGained?.byCategory ? (
        <View style={s.sgBlock}>
          {SG_CATEGORIES.map((category) => (
            <CategoryRow key={category.key} category={category} strokesGained={strokesGained} />
          ))}
          {TargetNudge && strokesGained.sampleHoles >= 18
            && (targetHandicap == null || targetHandicap === 0)
            && <TargetNudge onTap={onChangeTarget} />}
        </View>
      ) : null}

      <SignalList title="What is working" signals={signals.good} tone="good" />
      <SignalList title="What is costing shots" signals={signals.bad} tone="bad" />
    </SectionCard>
  );
}

function SignalList({ title, signals, tone }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.signalList}>
      <Text style={s.signalTitle}>{title}</Text>
      {signals.length ? signals.slice(0, 3).map((signal) => (
        <ShotSignalRow key={`${tone}-${signal.id}`} signal={signal} tone={tone} />
      )) : (
        <Text style={s.note}>{tone === 'good' ? 'Nothing positive stands out yet.' : 'No clear leak yet.'}</Text>
      )}
    </View>
  );
}

function ShotSignalRow({ signal, tone }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const good = tone === 'good';
  const color = good ? theme.scoreColor('good') : theme.destructive;
  const icon = good ? 'trending-up' : 'alert-triangle';
  return (
    <View style={s.signalRow}>
      <View style={[s.signalIcon, { backgroundColor: good ? theme.accent.light : badWash(theme) }]}>
        <Feather name={icon} size={15} color={color} />
      </View>
      <View style={s.signalCopy}>
        <Text style={s.signalArea}>{signal.area}</Text>
        <Text style={s.signalName}>{signal.title}</Text>
        <Text style={s.signalDetail}>{signal.detail}</Text>
      </View>
      <Text style={[s.signalMetric, { color }]}>{signal.metric}</Text>
    </View>
  );
}

function badWash(theme) {
  return theme.isDark ? 'rgba(248,113,113,0.14)' : '#fee2e2';
}

function targetTitle(targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return 'Strokes gained vs scratch';
  return `Strokes gained vs ${targetHandicap}-handicap target`;
}

function trackedSample(stats) {
  if (stats?.shots?.putts?.holes != null) return sampleText(stats.shots.putts.holes, 'holes');
  if (stats?.teeShot?.fairway?.holes != null || stats?.teeShot?.missed?.holes != null) {
    return sampleText((stats.teeShot.fairway?.holes ?? 0) + (stats.teeShot.missed?.holes ?? 0), 'holes');
  }
  return undefined;
}

function buildShotSignals(stats) {
  const good = [];
  const bad = [];
  const push = (signal) => {
    if (signal.score >= 0) good.push(signal);
    else bad.push(signal);
  };

  SG_CATEGORIES.forEach((category) => {
    const value = stats?.strokesGained?.byCategory?.[category.key];
    if (value == null) return;
    push({
      id: `sg-${category.key}`,
      area: category.area,
      title: category.signalTitle ?? category.label,
      metric: `${formatSignedFixed(value)} SG`,
      detail: `${sampleText(stats?.strokesGained?.sampleHoles, 'holes') ?? 'Tracked holes'} against target.`,
      score: value,
    });
  });

  PUTT_BUCKETS.forEach((bucket) => {
    const row = stats?.puttingTarget?.buckets?.[bucket];
    if (!row || row.attempts === 0 || row.sgPerPutt == null) return;
    push({
      id: `putt-${bucket}`,
      area: 'Putting',
      title: `${bucket} m putts`,
      metric: `${signed(row.sgPerPutt)} SG`,
      detail: `${row.avgPutts} avg vs ${row.expectedPutts} target · ${sampleText(row.attempts, 'putts')}`,
      score: row.sgPerPutt,
    });
  });

  APPROACH_BUCKETS.forEach((bucket) => {
    const row = stats?.approachTarget?.buckets?.[bucket];
    if (!row || row.holes === 0 || row.avgSg == null) return;
    push({
      id: `approach-${bucket}`,
      area: 'Approach',
      title: `${bucket} m approaches`,
      metric: `${signed(row.avgSg)} SG`,
      detail: `${row.greenRate ?? row.girRate}% green · ${sampleText(row.holes, 'shots')}`,
      score: row.avgSg,
    });
  });

  good.sort((a, b) => b.score - a.score);
  bad.sort((a, b) => a.score - b.score);
  return { good, bad };
}

function makeStyles(theme) {
  return StyleSheet.create({
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
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
    sgBlock: { gap: 1, paddingTop: theme.spacing.sm },
    categoryRow: { gap: 2, paddingVertical: 2 },
    categoryMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    deltaBadge: { ...theme.typography.tiny, fontWeight: '800' },
    sampleChip: { ...theme.typography.tiny, color: theme.text.muted },
    gatedRow: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', paddingVertical: 6 },
    signalList: {
      gap: 0,
      paddingTop: theme.spacing.md,
      marginTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
    },
    signalTitle: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800', marginBottom: theme.spacing.xs },
    signalRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    signalIcon: {
      width: 30,
      height: 30,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signalCopy: { flex: 1, gap: 1 },
    signalArea: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '800', textTransform: 'uppercase' },
    signalName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    signalDetail: { ...theme.typography.caption, color: theme.text.secondary },
    signalMetric: { ...theme.typography.caption, fontWeight: '800', maxWidth: 72, textAlign: 'right' },
  });
}

export { buildShotSignals };
