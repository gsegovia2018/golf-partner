import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import { drillsForInsight } from '../../store/coachDrills';

const VERDICT_COPY = {
  improving: { icon: 'trending-up', text: 'Improving since you committed', tone: 'good' },
  flat: { icon: 'minus', text: 'Holding steady since you committed', tone: 'neutral' },
  worse: { icon: 'trending-down', text: 'Getting worse since you committed', tone: 'bad' },
  resolved: { icon: 'check-circle', text: 'No longer flagged — nice work', tone: 'good' },
};

// The player's committed focus: what they promised to work on, whether the
// numbers actually moved since, and the drill to keep working it.
export default function FocusCard({ focus, verdict, onEndFocus }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!focus) return null;

  const drill = drillsForInsight({ area: focus.area, title: focus.title })[0] ?? null;
  const copy = verdict?.state === 'needs-more-rounds'
    ? {
      icon: 'clock',
      text: `Play ${verdict.roundsNeeded} more round${verdict.roundsNeeded === 1 ? '' : 's'} for a verdict`,
      tone: 'neutral',
    }
    : VERDICT_COPY[verdict?.state] ?? null;
  const toneColor = copy?.tone === 'good' ? theme.scoreColor('good')
    : copy?.tone === 'bad' ? theme.destructive : theme.text.secondary;

  return (
    <SectionCard title="Your Focus">
      <View style={s.head}>
        <View style={s.copy}>
          <Text style={s.area}>{focus.areaLabel ?? focus.area}</Text>
          <Text style={s.title}>{focus.title}</Text>
        </View>
        <PressableScale
          onPress={onEndFocus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="End focus"
          style={s.endBtn}
        >
          <Text style={s.endBtnText}>End focus</Text>
        </PressableScale>
      </View>
      {copy ? (
        <View style={s.verdictRow}>
          <Feather name={copy.icon} size={15} color={toneColor} />
          <Text style={[s.verdictText, { color: toneColor }]}>{copy.text}</Text>
        </View>
      ) : null}
      {verdict?.currentMetric && focus.metric ? (
        <Text style={s.metricLine}>{`${focus.metric} → ${verdict.currentMetric}`}</Text>
      ) : (
        focus.metric ? <Text style={s.metricLine}>{`Committed at ${focus.metric}`}</Text> : null
      )}
      {drill ? (
        <View style={s.drillBlock}>
          <View style={s.drillHead}>
            <Text style={s.drillTitle}>{drill.title}</Text>
            <Text style={s.drillLocation}>{drill.location}</Text>
          </View>
          <Text style={s.drillInstruction}>{drill.instruction}</Text>
          <Text style={s.passTarget}>{`Pass: ${drill.passTarget}`}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    area: { ...theme.typography.overline, color: theme.info },
    title: { ...theme.typography.heading, color: theme.text.primary },
    endBtn: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: theme.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
    },
    endBtnText: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    verdictText: { ...theme.typography.subhead, fontWeight: '800' },
    metricLine: { ...theme.typography.caption, color: theme.text.secondary },
    drillBlock: {
      gap: 2,
      backgroundColor: theme.bg.secondary,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
    },
    drillHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    drillLocation: { ...theme.typography.tiny, color: theme.text.muted, textTransform: 'uppercase', fontWeight: '800' },
    drillInstruction: { ...theme.typography.body, color: theme.text.primary },
    passTarget: { ...theme.typography.caption, color: theme.info, fontWeight: '700' },
  });
}
