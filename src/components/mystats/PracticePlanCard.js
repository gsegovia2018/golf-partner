import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';

const ROLE_LABELS = {
  practiceFirst: 'Practice first',
  secondaryFocus: 'Secondary focus',
  onCourseCue: 'On-course cue',
};

const ROLE_ORDER = ['practiceFirst', 'secondaryFocus', 'onCourseCue'];

export default function PracticePlanCard({ plan, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const items = ROLE_ORDER.map((role) => plan?.find((item) => item.role === role)).filter(Boolean);

  return (
    <SectionCard title="Practice Plan" infoKey="coachPractice" onInfo={onInfo}>
      {items.length ? items.map((item) => (
        <View key={item.id ?? item.role} style={s.item}>
          <Text style={s.role}>{ROLE_LABELS[item.role] ?? 'Practice'}</Text>
          <Text style={s.title}>{item.title}</Text>
          {item.drill ? (
            <View style={s.drillBlock}>
              <View style={s.drillHead}>
                <Text style={s.drillTitle}>{item.drill.title}</Text>
                <Text style={s.drillLocation}>{item.drill.location}</Text>
              </View>
              <Text style={s.instruction}>{item.drill.instruction}</Text>
              <Text style={s.passTarget}>{`Pass: ${item.drill.passTarget}`}</Text>
            </View>
          ) : (
            item.instruction ? <Text style={s.instruction}>{item.instruction}</Text> : null
          )}
          {Number.isFinite(item.payoffPointsPerRound) ? (
            <Text style={s.payoff}>{`worth ≈ ${item.payoffPointsPerRound} pts / round`}</Text>
          ) : null}
          {item.reason ? <Text style={s.reason}>{item.reason}</Text> : null}
        </View>
      )) : (
        <Text style={s.empty}>No practice plan yet. Play more rounds to unlock focused practice cues.</Text>
      )}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    item: {
      backgroundColor: theme.bg.secondary,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      gap: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
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
