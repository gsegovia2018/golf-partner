import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { renderMsg, metricValueText } from './msg';
import { useT, formatDate, formatNumber } from '../../i18n';
import { msg as makeMsg } from '../../store/statsMsg';
import { metricLabel } from '../../store/coachCheck';
import { EARLY_ROUNDS, MAX_LEVEL } from '../../store/coachFocus';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';

const VERDICT_COPY = {
  improving: { icon: 'trending-up', textKey: 'stats.my.focus.improving', tone: 'good' },
  flat: { icon: 'minus', textKey: 'stats.my.focus.flat', tone: 'neutral' },
  worse: { icon: 'trending-down', textKey: 'stats.my.focus.worse', tone: 'bad' },
  resolved: { icon: 'check-circle', textKey: 'stats.my.focus.resolved', tone: 'good' },
};

const targetText = (hcp, t) => (hcp === 0 ? t('stats.my.coach.ui.vs.scratch') : formatNumber(hcp));

// The player's committed focus (v2 record): what they promised to work on and
// whether its own metric moved since. Shown only with a focus; the diagnosis
// card carries the chain and the plan card carries the drills.
export default function FocusCard({ focus, verdict, onEndFocus, onInfo }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!focus) return null;

  const state = verdict?.state;
  const copy = state === 'needs-more-rounds'
    ? { icon: 'clock', text: t('stats.my.focus.needMore', { count: verdict.roundsNeeded }), tone: 'neutral' }
    : VERDICT_COPY[state] ?? null;
  const copyText = copy ? (copy.text ?? t(copy.textKey)) : null;
  const toneColor = copy?.tone === 'good' ? theme.accent.primary
    : copy?.tone === 'bad' ? theme.destructive : theme.text.primary;

  const unit = verdict?.unit ?? null;
  const before = unit && verdict?.baseline != null ? metricValueText(unit, verdict.baseline) : null;
  const after = unit && verdict?.current != null ? metricValueText(unit, verdict.current) : null;
  const showEarly = verdict && state !== 'needs-more-rounds' && state !== 'resolved' && verdict.early;
  const ready = state === 'improving' && (verdict?.level ?? 1) >= MAX_LEVEL;
  const area = renderMsg(makeMsg(`stats.my.coach.plan.area.${focus.category}`));
  const kicker = focus.bucket
    ? t('stats.my.coach.ui.kicker.bucket', { area, bucket: focus.bucket })
    : t('stats.my.coach.ui.kicker', { area });
  const title = focus.metricKey ? renderMsg(metricLabel(focus.metricKey)) : area;
  const level = verdict?.level ?? 1;

  return (
    <SectionCard
      title={t('stats.my.focus.title')}
      infoKey="coachDiagnosis"
      onInfo={onInfo}
      testID="focus-card"
    >
      <View style={s.head}>
        <View style={s.copy}>
          <Text style={s.area}>{kicker}</Text>
          <Text style={s.title}>{title}</Text>
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
      {showEarly ? (
        <Text style={s.metricLine} testID="focus-early">
          {t('stats.my.coach.ui.focus.early', {
            rounds: t('stats.my.count.rounds', { count: verdict.roundsSince }),
            settles: EARLY_ROUNDS,
          })}
        </Text>
      ) : null}
      {before != null ? (
        <View style={s.ba} testID="focus-before-after">
          <View style={s.baCell}>
            <Text style={s.baValue}>{before}</Text>
            <Text style={s.baLabel}>{t('stats.my.coach.ui.focus.before')}</Text>
          </View>
          <Feather name="arrow-right" size={16} color={theme.text.muted} />
          <View style={s.baCell}>
            <Text style={s.baValue}>{after ?? '–'}</Text>
            <Text style={s.baLabel}>{after != null ? t('stats.my.coach.ui.focus.now') : t('stats.my.coach.ui.focus.noData')}</Text>
          </View>
        </View>
      ) : null}
      <Text style={s.metricLine} testID="focus-level">
        {t('stats.my.coach.ui.level.line', {
          level,
          rounds: t('stats.my.count.rounds', { count: verdict?.roundsSince ?? 0 }),
          date: formatDate(focus.committedAt, 'day'),
        })}
      </Text>
      {ready ? <Text style={s.ready}>{t('stats.my.coach.ui.focus.ready')}</Text> : null}
      {focus.rebasedAt ? (
        <View style={s.note}>
          <Feather name="info" size={12} color={theme.text.muted} />
          <Text style={s.noteText}>
            {focus.rebaseReason?.kind === 'target'
              ? t('stats.my.coach.ui.focus.targetChanged', { to: targetText(focus.rebaseReason.to, t), date: formatDate(focus.rebasedAt, 'day') })
              : t('stats.my.focus.rebased', { date: formatDate(focus.rebasedAt, 'day') })}
          </Text>
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
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
    },
    endBtnText: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    verdictText: { ...theme.typography.subhead, fontWeight: '800', flexShrink: 1 },
    metricLine: { ...theme.typography.caption, color: theme.text.secondary },
    ba: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    baCell: { gap: 1 },
    baValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 20, lineHeight: 24, color: theme.text.primary },
    baLabel: { ...theme.typography.caption, color: theme.text.muted },
    ready: { ...theme.typography.subhead, color: theme.accent.primary, fontWeight: '800' },
    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    noteText: { ...theme.typography.caption, color: theme.text.secondary, flex: 1 },
  });
}
