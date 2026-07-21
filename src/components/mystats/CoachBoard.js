import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import CoachInsightRow from './CoachInsightRow';
import { GROUP_LABELS } from './CoachHero';
import { ROLE_LABELS } from './PracticePlanCard';

const GROUP_ORDER = ['fixFirst', 'keepDoing', 'gettingBetter', 'gettingWorse', 'nextGains', 'watch'];
const BOARD_SECTIONS = [
  {
    key: 'improve',
    title: 'Improve now',
    description: 'Biggest leaks and smaller gains to chase next.',
    groups: ['fixFirst', 'nextGains'],
  },
  {
    key: 'protect',
    title: 'Protect',
    description: 'What is already helping your score.',
    groups: ['keepDoing'],
  },
  {
    key: 'trends',
    title: 'Trends',
    description: 'What changed lately, split into better and worse.',
    groups: ['gettingBetter', 'gettingWorse'],
  },
  {
    key: 'monitor',
    title: 'Monitor',
    description: 'Signals to watch before making them the main practice block.',
    groups: ['watch'],
  },
];

export default function CoachBoard({ board, practicePlan = [], excludeInsightIds = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const excluded = useMemo(() => new Set(excludeInsightIds), [excludeInsightIds]);
  const practiceByInsight = useMemo(() => new Map(
    (practicePlan ?? [])
      .filter((item) => item.sourceInsightId)
      .map((item) => [item.sourceInsightId, ROLE_LABELS[item.role] ?? 'Practice'])
  ), [practicePlan]);
  const sections = BOARD_SECTIONS.map((section) => ({
    ...section,
    groups: section.groups
      .map((key) => ({
        key,
        insights: (board?.[key] ?? []).filter((insight) => !excluded.has(insight.id)),
      }))
      .filter((group) => group.insights.length > 0),
  })).filter((section) => section.groups.length > 0);

  return (
    <SectionCard title="Coach Board">
      {sections.length ? sections.map((section, index) => (
        <View key={section.key} style={[s.section, index === 0 && s.sectionFirst]}>
          <View style={s.sectionHead}>
            <View style={s.sectionCopy}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              <Text style={s.sectionDescription}>{section.description}</Text>
            </View>
            <View style={s.countPill}>
              <Text style={s.countText}>
                {section.groups.reduce((sum, group) => sum + group.insights.length, 0)}
              </Text>
            </View>
          </View>
          {section.groups.map((group) => (
            <View key={group.key} style={s.group}>
              <Text style={s.groupTitle}>{GROUP_LABELS[group.key]}</Text>
              {group.insights.map((insight) => (
                <CoachInsightRow
                  key={insight.id}
                  insight={insight}
                  practiceRole={practiceByInsight.get(insight.id)}
                />
              ))}
            </View>
          ))}
        </View>
      )) : (
        <Text style={s.empty}>No coach insights yet. Play more rounds to build a clearer pattern.</Text>
      )}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    section: {
      paddingTop: theme.spacing.lg,
      marginTop: theme.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
      gap: theme.spacing.md,
    },
    sectionFirst: {
      paddingTop: theme.spacing.xs,
      marginTop: 0,
      borderTopWidth: 0,
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      backgroundColor: theme.isDark ? theme.bg.elevated : theme.bg.card,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      ...(theme.isDark ? {} : { shadowColor: '#00553c', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 1 }),
    },
    sectionCopy: { flex: 1, gap: 2 },
    sectionTitle: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    sectionDescription: { ...theme.typography.caption, color: theme.text.secondary },
    countPill: {
      minWidth: 28,
      height: 28,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
    },
    countText: { ...theme.typography.caption, color: theme.text.primary, fontWeight: '800' },
    group: { gap: 0 },
    groupTitle: { ...theme.typography.overline, color: theme.text.muted },
    empty: { ...theme.typography.body, color: theme.text.secondary, paddingVertical: theme.spacing.sm },
  });
}

export { GROUP_ORDER };
