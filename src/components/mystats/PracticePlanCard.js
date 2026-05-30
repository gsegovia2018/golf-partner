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

export default function PracticePlanCard({ plan }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const items = ROLE_ORDER.map((role) => plan?.find((item) => item.role === role)).filter(Boolean);

  return (
    <SectionCard title="Practice Plan">
      {items.length ? items.map((item) => (
        <View key={item.id ?? item.role} style={s.item}>
          <Text style={s.role}>{ROLE_LABELS[item.role] ?? 'Practice'}</Text>
          <Text style={s.title}>{item.title}</Text>
          {item.instruction ? <Text style={s.instruction}>{item.instruction}</Text> : null}
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
  });
}

export { ROLE_LABELS, ROLE_ORDER };
