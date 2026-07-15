import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { formatConfidence, formatSample, formatPointsPerRound } from './CoachInsightRow';

const GROUP_LABELS = {
  fixFirst: 'Fix first',
  keepDoing: 'Keep doing',
  gettingBetter: 'Getting better',
  gettingWorse: 'Getting worse',
  nextGain: 'Next gain',
  nextGains: 'Next gain',
  watch: 'Watch',
};

export default function CoachHero({ insight, onCommitFocus, focusActive = false }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const proofs = [insight?.basis, formatSample(insight?.sample), formatConfidence(insight?.confidence)].filter(Boolean);
  const tone = toneStyles(theme, insight?.tone);

  if (!insight) {
    return (
      <View style={s.card}>
        <Text style={s.kicker}>Coach</Text>
        <Text style={s.title}>No coach insight yet</Text>
        <Text style={s.reason}>Play more scored rounds to unlock a useful practice priority.</Text>
      </View>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor }]}>
      <View style={s.topRow}>
        <Text style={[s.kicker, { color: tone.color }]}>{GROUP_LABELS[insight.group] ?? 'Coach'}</Text>
        <Text style={[s.area, { color: tone.metaColor }]}>{insight.areaLabel ?? insight.area}</Text>
      </View>
      <Text style={s.title}>{insight.title}</Text>
      {insight.reason ? <Text style={s.reason}>{insight.reason}</Text> : null}
      <View style={s.bottomRow}>
        {insight.metric ? (
          <View style={{ flexShrink: 1 }}>
            <Text style={[s.metric, { color: tone.color }]}>{insight.metric}</Text>
            {Number.isFinite(insight.pointsPerRound) ? (
              <Text style={[s.pointsCaption, { color: tone.metaColor }]}>{formatPointsPerRound(insight.pointsPerRound)}</Text>
            ) : null}
          </View>
        ) : null}
        <View style={s.chips}>
          {proofs.map((proof) => (
            <View key={proof} style={[s.chip, { backgroundColor: tone.chipColor }]}>
              <Feather name="check-circle" size={12} color={tone.color} />
              <Text style={[s.chipText, { color: tone.metaColor }]}>{proof}</Text>
            </View>
          ))}
        </View>
      </View>
      {onCommitFocus && insight && !focusActive ? (
        <TouchableOpacity
          onPress={() => onCommitFocus(insight)}
          accessibilityRole="button"
          accessibilityLabel="Make this my focus"
          style={[s.focusBtn, { borderColor: tone.borderColor }]}
          activeOpacity={0.7}
        >
          <Feather name="target" size={14} color={tone.color} />
          <Text style={[s.focusBtnText, { color: tone.color }]}>Make this my focus</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function toneStyles(theme, tone) {
  if (tone === 'bad') {
    return {
      color: theme.destructive,
      metaColor: theme.isDark ? 'rgba(248,113,113,0.82)' : '#991b1b',
      backgroundColor: theme.isDark ? 'rgba(248,113,113,0.11)' : '#fff1f2',
      borderColor: theme.isDark ? 'rgba(248,113,113,0.28)' : '#fecdd3',
      chipColor: theme.isDark ? 'rgba(248,113,113,0.13)' : '#fee2e2',
    };
  }
  if (tone === 'good') {
    return {
      color: theme.scoreColor('good'),
      metaColor: theme.accent.primary,
      backgroundColor: theme.accent.light,
      borderColor: theme.isDark ? 'rgba(79,174,138,0.28)' : '#c7ddd3',
      chipColor: theme.isDark ? 'rgba(79,174,138,0.16)' : '#dbece4',
    };
  }
  return {
    color: theme.text.secondary,
    metaColor: theme.text.secondary,
    backgroundColor: theme.bg.secondary,
    borderColor: theme.border.default,
    chipColor: theme.bg.card,
  };
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.secondary,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
    },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
    kicker: { ...theme.typography.overline },
    area: { ...theme.typography.caption, fontWeight: '700' },
    title: { ...theme.typography.heading, color: theme.text.primary },
    reason: { ...theme.typography.body, color: theme.text.secondary },
    bottomRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.spacing.md },
    metric: { ...theme.typography.title, flexShrink: 1 },
    pointsCaption: { ...theme.typography.tiny, fontWeight: '700' },
    chips: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: theme.spacing.xs, flex: 1 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: theme.radius.pill,
    },
    chipText: { ...theme.typography.tiny, fontWeight: '800' },
    focusBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      marginTop: theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
    },
    focusBtnText: { ...theme.typography.caption, fontWeight: '800' },
  });
}

export { GROUP_LABELS };
