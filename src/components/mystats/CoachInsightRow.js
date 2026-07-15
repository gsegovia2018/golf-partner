import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

const TONES = {
  good: {
    icon: 'trending-up',
    label: 'Good',
    color: (theme) => theme.scoreColor('good'),
    backgroundColor: (theme) => theme.accent.light,
  },
  bad: {
    icon: 'alert-triangle',
    label: 'Bad',
    color: (theme) => theme.destructive,
    backgroundColor: (theme) => (theme.isDark ? 'rgba(248,113,113,0.14)' : '#fee2e2'),
  },
  watch: {
    icon: 'eye',
    label: 'Watch',
    color: (theme) => theme.text.muted,
    backgroundColor: (theme) => theme.bg.secondary,
  },
  neutral: {
    icon: 'activity',
    label: 'Neutral',
    color: (theme) => theme.text.muted,
    backgroundColor: (theme) => theme.bg.secondary,
  },
};

function formatSample(sample) {
  if (sample == null) return null;
  return `${sample} ${sample === 1 ? 'sample' : 'samples'}`;
}

function formatConfidence(confidence) {
  if (!confidence) return null;
  return `${confidence.slice(0, 1).toUpperCase()}${confidence.slice(1)} confidence`;
}

function formatPointsPerRound(pointsPerRound) {
  if (!Number.isFinite(pointsPerRound)) return null;
  const sign = pointsPerRound > 0 ? '+' : '';
  return `≈ ${sign}${pointsPerRound} pts / round`;
}

export default function CoachInsightRow({ insight, practiceRole }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tone = TONES[insight?.tone] ?? TONES.neutral;
  const toneName = TONES[insight?.tone] ? insight.tone : 'neutral';
  const color = tone.color(theme);
  const backgroundColor = tone.backgroundColor(theme);
  const proofs = [insight?.basis, formatSample(insight?.sample), formatConfidence(insight?.confidence)].filter(Boolean);

  if (!insight) return null;

  return (
    <View style={s.row}>
      <View
        style={[s.iconWrap, { backgroundColor }]}
        testID={`coach-insight-tone-${toneName}`}
        accessibilityLabel={`${tone.label} coach insight tone`}
      >
        <Feather name={tone.icon} size={16} color={color} testID={`coach-insight-icon-${toneName}`} />
      </View>
      <View style={s.body}>
        <View style={s.metaRow}>
          <Text style={s.area}>{insight.areaLabel ?? insight.area ?? 'Coach'}</Text>
          {proofs.length ? <Text style={s.proof}>{proofs.join(' · ')}</Text> : null}
          {practiceRole ? (
            <View style={s.practicePill}>
              <Text style={s.practiceText}>{`Plan: ${practiceRole}`}</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.title}>{insight.title}</Text>
        {insight.reason ? <Text style={s.reason}>{insight.reason}</Text> : null}
      </View>
      {insight.metric ? (
        <View style={s.metricWrap}>
          <Text style={[s.metric, { color }]} testID={`coach-insight-metric-${toneName}`}>
            {insight.metric}
          </Text>
          {Number.isFinite(insight.pointsPerRound) ? (
            <Text style={s.pointsCaption}>{formatPointsPerRound(insight.pointsPerRound)}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.sm },
    area: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '800', textTransform: 'uppercase' },
    proof: { ...theme.typography.tiny, color: theme.text.muted },
    practicePill: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 3,
      backgroundColor: theme.bg.secondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
    },
    practiceText: { ...theme.typography.tiny, color: theme.text.secondary, fontWeight: '800' },
    title: { ...theme.typography.subhead, color: theme.text.primary },
    reason: { ...theme.typography.caption, color: theme.text.secondary },
    metricWrap: { maxWidth: 92 },
    metric: { ...theme.typography.caption, fontWeight: '800', textAlign: 'right' },
    pointsCaption: { ...theme.typography.tiny, color: theme.text.muted, textAlign: 'right' },
  });
}

export { formatConfidence, formatSample, formatPointsPerRound };
