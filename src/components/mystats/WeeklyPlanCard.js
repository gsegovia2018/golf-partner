import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatDate } from '../../i18n';
import { PRACTICE_MINUTES_OPTIONS } from '../../store/settingsStore';
import { progression } from '../../swing/drills';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import { DrillLine } from './CoachBits';
import { renderMsg, renderDatedMsg } from './msg';

const KIND_ICON = { range: 'wind', shortGame: 'flag', putting: 'circle', course: 'map' };
const KINDS = ['range', 'shortGame', 'putting', 'course'];

// The week's practice (design B): minutes picker in the header, a split bar
// with the minutes also in text, one tile per session, the on-course task,
// the level line and the re-planned note. `week` is store/coachWeek.js
// buildCoachWeek's result; the picker writes practiceMinutesPerWeek upstream.
export default function WeeklyPlanCard({ week, focus, verdict, onChangeMinutes, onInfo }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const plan = week?.plan;
  if (!plan) return null;

  const splitParts = KINDS.filter((k) => plan.split[k] > 0);
  const total = splitParts.reduce((a, k) => a + plan.split[k], 0);
  const levelLine = focus
    ? t('stats.my.coach.ui.level.line', {
      level: plan.level,
      rounds: t('stats.my.count.rounds', { count: verdict?.roundsSince ?? 0 }),
      date: formatDate(focus.committedAt, 'day'),
    })
    : t('stats.my.coach.ui.level.none');
  const note = plan.replan?.note ? renderDatedMsg(plan.replan.note) : null;
  const tileColor = (kind) => (kind === 'range' ? theme.accent.primary : kind === 'shortGame' ? theme.info
    : kind === 'putting' ? theme.text.muted : theme.border.default);

  return (
    <SectionCard
      title={t('stats.my.coach.ui.week.title')}
      infoKey="weeklyPlan"
      onInfo={onInfo}
      testID="weekly-plan-card"
      right={(
        <View style={s.pickerWrap}>
          <View style={s.picker} accessibilityRole="radiogroup" accessibilityLabel={t('stats.my.coach.ui.week.picker')}>
            {PRACTICE_MINUTES_OPTIONS.map((m) => {
              const on = m === plan.minutes;
              return (
                <PressableScale
                  key={m}
                  onPress={() => onChangeMinutes?.(m)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  accessibilityLabel={t('stats.my.coach.ui.week.option', { minutes: m })}
                  style={[s.opt, on && s.optOn]}
                  testID={`minutes-${m}`}
                >
                  <Text style={[s.optText, on && s.optTextOn]}>{m}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={s.caption}>{t('stats.my.coach.ui.week.minutesCaption')}</Text>
        </View>
      )}
    >
      {total > 0 ? (
        <View style={s.splitWrap}>
          <View style={s.split} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {splitParts.map((k) => <View key={k} style={[s.seg, { flex: plan.split[k], backgroundColor: tileColor(k) }]} />)}
          </View>
          <View style={s.splitCap}>
            <Text style={s.splitText} testID="plan-split-text">
              {splitParts.map((k) => t('stats.my.coach.ui.week.splitItem', { kind: t(`stats.my.coach.ui.kind.${k}`), minutes: plan.split[k] })).join(' · ')}
            </Text>
            <Text style={s.splitText}>{t('stats.my.coach.ui.week.total', { minutes: total })}</Text>
          </View>
        </View>
      ) : null}

      {plan.sessions.map((session) => (
        <View
          key={session.id}
          style={s.tile}
          testID={session.part > 1 ? `session-${session.kind}-${session.part}` : `session-${session.kind}`}
          accessible
          accessibilityLabel={renderMsg(session.title)}
        >
          <View style={s.tileIcon}><Feather name={KIND_ICON[session.kind]} size={16} color={theme.accent.primary} /></View>
          <View style={s.tileBody}>
            <View style={s.tileHead}>
              <Text style={s.tileKind}>
                {session.parts > 1
                  ? t('stats.my.coach.ui.kind.part', { kind: t(`stats.my.coach.ui.kind.${session.kind}`), part: session.part })
                  : t(`stats.my.coach.ui.kind.${session.kind}`)}
              </Text>
              <Text style={s.tileMin}>{t('stats.my.coach.ui.fix.minutes', { minutes: session.minutes })}</Text>
            </View>
            <Text style={s.why}>{renderMsg(session.why)}</Text>
            {session.drills.map((d) => (
              <View key={`${d.drillId}-${d.role}`} style={s.drillRow}><DrillLine drill={d} showLocation={false} /></View>
            ))}
            {session.drills.some((d) => d.source === 'swing') ? <Text style={s.why}>{progression()}</Text> : null}
          </View>
        </View>
      ))}

      <View style={s.tile} testID="session-course-task">
        <View style={s.tileIcon}><Feather name="map" size={16} color={theme.accent.primary} /></View>
        <View style={s.tileBody}>
          <View style={s.tileHead}>
            <Text style={s.tileKind}>{t('stats.my.coach.ui.fix.course')}</Text>
            <Text style={s.tileMin}>{t('stats.my.coach.ui.week.onCourse')}</Text>
          </View>
          <Text style={s.body}>{renderMsg(plan.courseTask)}</Text>
          {plan.logAsk ? <Text style={s.why}>{renderMsg(plan.logAsk)}</Text> : null}
        </View>
      </View>

      <Text style={s.level} testID="plan-level">{levelLine}</Text>
      {note ? (
        <View style={s.note} testID="plan-replanned">
          <Feather name="refresh-cw" size={12} color={theme.text.muted} />
          <Text style={s.noteText}>{note}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    pickerWrap: { alignItems: 'flex-end', gap: 2 },
    picker: {
      flexDirection: 'row',
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.secondary,
      padding: 2,
    },
    opt: { minWidth: 44, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    optOn: { backgroundColor: theme.accent.primary },
    optText: { ...theme.typography.subhead, color: theme.text.secondary, fontWeight: '800' },
    optTextOn: { color: theme.text.inverse },
    caption: { ...theme.typography.tiny, color: theme.text.muted },
    splitWrap: { gap: 6 },
    split: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 },
    seg: { height: 8 },
    splitCap: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm },
    splitText: { ...theme.typography.caption, color: theme.text.secondary, flexShrink: 1 },
    tile: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
    },
    tileIcon: {
      width: 30, height: 30, borderRadius: theme.radius.sm,
      alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.light,
    },
    tileBody: { flex: 1, minWidth: 0, gap: 4 },
    tileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.spacing.sm },
    tileKind: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    tileMin: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    why: { ...theme.typography.caption, color: theme.text.secondary },
    body: { ...theme.typography.body, color: theme.text.primary },
    drillRow: { paddingTop: 2 },
    level: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    noteText: { ...theme.typography.caption, color: theme.text.secondary, flex: 1 },
  });
}
