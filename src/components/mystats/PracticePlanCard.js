import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { msgText, drillText, drillLocation } from './msg';
import { useT, formatNumber } from '../../i18n';
import SectionCard from './SectionCard';

// Catalogue keys; render with t(ROLE_LABELS[role]).
const ROLE_LABELS = {
  practiceFirst: 'stats.my.practice.role.practiceFirst',
  secondaryFocus: 'stats.my.practice.role.secondaryFocus',
  onCourseCue: 'stats.my.practice.role.onCourseCue',
};

const ROLE_ORDER = ['practiceFirst', 'secondaryFocus', 'onCourseCue'];

export default function PracticePlanCard({ plan, onInfo }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const items = ROLE_ORDER.map((role) => plan?.find((item) => item.role === role)).filter(Boolean);

  return (
    <SectionCard title={t('stats.my.practice.title')} infoKey="coachPractice" onInfo={onInfo}>
      {items.length ? items.map((item) => (
        <View key={item.id ?? item.role} style={s.item}>
          <Text style={s.role}>{t(ROLE_LABELS[item.role] ?? 'stats.my.practice.role.default')}</Text>
          <Text style={s.title}>{msgText(item.titleMsg, item.title)}</Text>
          {item.drill ? (
            <View style={s.drillBlock}>
              <View style={s.drillHead}>
                <Text style={s.drillTitle}>{drillText(item.drill, 'title')}</Text>
                <Text style={s.drillLocation}>{drillLocation(item.drill.location)}</Text>
              </View>
              <Text style={s.instruction}>{drillText(item.drill, 'instruction')}</Text>
              <Text style={s.passTarget}>{t('stats.my.practice.pass', { target: drillText(item.drill, 'pass') })}</Text>
            </View>
          ) : (
            item.instruction ? <Text style={s.instruction}>{msgText(item.instructionMsg, item.instruction)}</Text> : null
          )}
          {Number.isFinite(item.payoffPointsPerRound) ? (
            <Text style={s.payoff}>{t('stats.my.practice.worth', { value: formatNumber(item.payoffPointsPerRound) })}</Text>
          ) : null}
          {item.reason ? <Text style={s.reason}>{msgText(item.reasonMsg, item.reason)}</Text> : null}
        </View>
      )) : (
        <Text style={s.empty}>{t('stats.my.practice.empty')}</Text>
      )}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    item: {
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      gap: 2,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      ...(theme.isDark ? {} : { shadowColor: '#00553c', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1 }),
    },
    role: { ...theme.typography.overline, color: theme.accent.primary },
    title: { ...theme.typography.subhead, color: theme.text.primary },
    instruction: { ...theme.typography.body, color: theme.text.primary },
    reason: { ...theme.typography.caption, color: theme.text.secondary },
    empty: { ...theme.typography.body, color: theme.text.secondary, paddingVertical: theme.spacing.sm },
    drillBlock: { gap: 2, marginTop: 2 },
    drillHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    drillLocation: { ...theme.typography.tiny, color: theme.text.muted, textTransform: 'uppercase', fontWeight: '800' },
    passTarget: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    payoff: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '800' },
  });
}

export { ROLE_LABELS, ROLE_ORDER };
