import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatDate } from '../../i18n';
import { progression } from '../../swing/drills';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import MinutesSheet from './MinutesSheet';
import { DrillLine } from './CoachBits';
import { renderMsg, renderDatedMsg } from './msg';

const KIND_ICON = { range: 'wind', shortGame: 'flag', putting: 'circle', course: 'map' };

// The week's practice (design B): one tile per session (its minutes are the
// split), the on-course task, the re-planned note and a footer with the level
// and "60 min a week · Change", which opens the minutes sheet. `week` is
// store/coachWeek.js buildCoachWeek's result; the sheet's choice is written to
// practiceMinutesPerWeek upstream (onChangeMinutes).
export default function WeeklyPlanCard({ week, focus, verdict, onChangeMinutes, onInfo }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const plan = week?.plan;
  if (!plan) return null;

  const levelLine = focus
    ? t('stats.my.coach.ui.level.line', {
      level: plan.level,
      rounds: t('stats.my.count.rounds', { count: verdict?.roundsSince ?? 0 }),
      date: formatDate(focus.committedAt, 'day'),
    })
    : t('stats.my.coach.ui.level.none');
  const note = plan.replan?.note ? renderDatedMsg(plan.replan.note) : null;

  return (
    <SectionCard
      title={t('stats.my.coach.ui.week.title')}
      infoKey="weeklyPlan"
      onInfo={onInfo}
      testID="weekly-plan-card"
    >
      {plan.sessions.map((session) => (
        <View
          key={session.id}
          style={s.tile}
          testID={session.part > 1 ? `session-${session.kind}-${session.part}` : `session-${session.kind}`}
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

      {note ? (
        <View style={s.note} testID="plan-replanned">
          <Feather name="refresh-cw" size={12} color={theme.text.muted} />
          <Text style={s.noteText}>{note}</Text>
        </View>
      ) : null}

      <View style={s.foot}>
        <Text style={s.level} testID="plan-level">{levelLine}</Text>
        <View style={s.footRight}>
          <Text style={s.minutes} testID="plan-minutes">{t('stats.my.coach.ui.week.minutesAWeek', { minutes: plan.minutes })}</Text>
          <Text style={s.minutes}>·</Text>
          <PressableScale
            onPress={() => setMinutesOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('stats.my.coach.ui.week.change')}
            style={s.change}
            testID="plan-change-minutes"
          >
            <Text style={s.changeText}>{t('stats.my.coach.ui.week.change')}</Text>
          </PressableScale>
        </View>
      </View>
      <MinutesSheet
        visible={minutesOpen}
        onClose={() => setMinutesOpen(false)}
        minutes={plan.minutes}
        onSelect={(m) => onChangeMinutes?.(m)}
      />
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
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
    foot: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, minHeight: 44,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle,
    },
    level: { ...theme.typography.caption, flex: 1, color: theme.text.secondary, fontWeight: '700' },
    footRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    minutes: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '600' },
    change: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    changeText: { ...theme.typography.caption, color: theme.info, fontWeight: '800' },
    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    noteText: { ...theme.typography.caption, color: theme.text.secondary, flex: 1 },
  });
}
