import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { msgText, areaText, drillText, drillLocation } from './msg';
import { useT, formatDate } from '../../i18n';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import { drillsForInsight } from '../../store/coachDrills';

const VERDICT_COPY = {
  improving: { icon: 'trending-up', textKey: 'stats.my.focus.improving', tone: 'good' },
  flat: { icon: 'minus', textKey: 'stats.my.focus.flat', tone: 'neutral' },
  worse: { icon: 'trending-down', textKey: 'stats.my.focus.worse', tone: 'bad' },
  resolved: { icon: 'check-circle', textKey: 'stats.my.focus.resolved', tone: 'good' },
};

// The player's committed focus: what they promised to work on, whether the
// numbers actually moved since, and the drill to keep working it.
export default function FocusCard({ focus, verdict, onEndFocus }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!focus) return null;

  const drill = drillsForInsight({ area: focus.area, title: focus.title })[0] ?? null;
  const copy = verdict?.state === 'needs-more-rounds'
    ? {
      icon: 'clock',
      text: t('stats.my.focus.needMore', { count: verdict.roundsNeeded }),
      tone: 'neutral',
    }
    : VERDICT_COPY[verdict?.state] ?? null;
  const copyText = copy ? (copy.text ?? t(copy.textKey)) : null;
  const toneColor = copy?.tone === 'good' ? theme.scoreColor('good')
    : copy?.tone === 'bad' ? theme.destructive : theme.text.secondary;

  return (
    <SectionCard title={t('stats.my.focus.title')}>
      <View style={s.head}>
        <View style={s.copy}>
          <Text style={s.area}>{areaText(focus)}</Text>
          <Text style={s.title}>{msgText(focus.titleMsg, focus.title)}</Text>
        </View>
        <PressableScale
          onPress={onEndFocus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('stats.my.focus.end')}
          style={s.endBtn}
        >
          <Text style={s.endBtnText}>{t('stats.my.focus.end')}</Text>
        </PressableScale>
      </View>
      {copy ? (
        <View style={s.verdictRow}>
          <Feather name={copy.icon} size={15} color={toneColor} />
          <Text style={[s.verdictText, { color: toneColor }]}>{copyText}</Text>
        </View>
      ) : null}
      {focus.rebasedAt ? (
        <Text style={s.metricLine}>{t('stats.my.focus.rebased', { date: formatDate(focus.rebasedAt, 'day') })}</Text>
      ) : null}
      {verdict?.currentMetric && focus.metric ? (
        <Text style={s.metricLine}>{`${msgText(focus.metricMsg, focus.metric)} → ${msgText(verdict.currentMetricMsg, verdict.currentMetric)}`}</Text>
      ) : (
        focus.metric ? <Text style={s.metricLine}>{t('stats.my.focus.committedAt', { metric: msgText(focus.metricMsg, focus.metric) })}</Text> : null
      )}
      {drill ? (
        <View style={s.drillBlock}>
          <View style={s.drillHead}>
            <Text style={s.drillTitle}>{drillText(drill, 'title')}</Text>
            <Text style={s.drillLocation}>{drillLocation(drill.location)}</Text>
          </View>
          <Text style={s.drillInstruction}>{drillText(drill, 'instruction')}</Text>
          <Text style={s.passTarget}>{t('stats.my.practice.pass', { target: drillText(drill, 'pass') })}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    area: { ...theme.typography.overline, color: theme.text.muted },
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
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      ...(theme.isDark ? {} : { shadowColor: '#00553c', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1 }),
    },
    drillHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    drillLocation: { ...theme.typography.tiny, color: theme.text.muted, textTransform: 'uppercase', fontWeight: '800' },
    drillInstruction: { ...theme.typography.body, color: theme.text.primary },
    passTarget: { ...theme.typography.caption, color: theme.info, fontWeight: '700' },
  });
}
