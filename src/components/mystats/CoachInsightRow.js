import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { msgText, areaText } from './msg';
import { toneColor, toneFill } from '../../theme/tone';
import { useT, t, formatNumber } from '../../i18n';

const TONES = {
  good: {
    icon: 'trending-up',
    labelKey: 'stats.my.coach.tone.good',
    color: (theme) => toneColor(theme, 'good'),
    backgroundColor: (theme) => theme.accent.light,
  },
  bad: {
    icon: 'alert-triangle',
    labelKey: 'stats.my.coach.tone.bad',
    color: (theme) => toneColor(theme, 'bad'),
    backgroundColor: (theme) => toneFill(theme, 'bad'),
  },
  watch: {
    icon: 'eye',
    labelKey: 'stats.my.coach.tone.watch',
    color: (theme) => theme.text.muted,
    backgroundColor: (theme) => theme.bg.secondary,
  },
  neutral: {
    icon: 'activity',
    labelKey: 'stats.my.coach.tone.neutral',
    color: (theme) => theme.text.muted,
    backgroundColor: (theme) => theme.bg.secondary,
  },
};

function formatSample(sample) {
  if (sample == null) return null;
  return t('stats.my.sample', { count: sample });
}

function formatConfidence(confidence) {
  if (!confidence) return null;
  const key = `stats.my.confidence.${confidence}`;
  const out = t(key);
  return out === key ? `${confidence.slice(0, 1).toUpperCase()}${confidence.slice(1)} confidence` : out;
}

function formatPointsPerRound(pointsPerRound) {
  if (!Number.isFinite(pointsPerRound)) return null;
  const sign = pointsPerRound > 0 ? '+' : '';
  return t('stats.my.pointsPerRound', { value: `${sign}${formatNumber(pointsPerRound)}` });
}

export default function CoachInsightRow({ insight, weekPill }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tone = TONES[insight?.tone] ?? TONES.neutral;
  const toneName = TONES[insight?.tone] ? insight.tone : 'neutral';
  const color = tone.color(theme);
  const backgroundColor = tone.backgroundColor(theme);
  const proofs = [msgText(insight?.basisMsg, insight?.basis), formatSample(insight?.sample), formatConfidence(insight?.confidence)].filter(Boolean);

  if (!insight) return null;

  return (
    <View style={s.row}>
      <View
        style={[s.iconWrap, { backgroundColor }]}
        testID={`coach-insight-tone-${toneName}`}
        accessibilityLabel={t('stats.my.coach.toneLabel', { tone: t(tone.labelKey) })}
      >
        <Feather name={tone.icon} size={16} color={color} testID={`coach-insight-icon-${toneName}`} />
      </View>
      <View style={s.body}>
        <View style={s.metaRow}>
          <Text style={s.area}>{areaText(insight)}</Text>
          {proofs.length ? <Text style={s.proof}>{proofs.join(' · ')}</Text> : null}
          {weekPill ? (
            <View style={s.practicePill}>
              <Text style={s.practiceText}>{weekPill}</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.title}>{msgText(insight.titleMsg, insight.title)}</Text>
        {insight.reason ? <Text style={s.reason}>{msgText(insight.reasonMsg, insight.reason)}</Text> : null}
      </View>
      {insight.metric ? (
        <View style={s.metricWrap}>
          <Text style={[s.metric, { color }]} testID={`coach-insight-metric-${toneName}`}>
            {msgText(insight.metricMsg, insight.metric)}
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
