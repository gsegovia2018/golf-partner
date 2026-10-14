import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import SectionCard from './SectionCard';
import CoachInsightRow from './CoachInsightRow';
import { GROUP_LABELS } from './CoachHero';
import { ROLE_LABELS } from './PracticePlanCard';

const GROUP_ORDER = ['fixFirst', 'keepDoing', 'gettingBetter', 'gettingWorse', 'nextGains', 'watch'];
const BOARD_SECTIONS = [
  { key: 'improve', groups: ['fixFirst', 'nextGains'] },
  { key: 'protect', groups: ['keepDoing'] },
  { key: 'trends', groups: ['gettingBetter', 'gettingWorse'] },
  { key: 'monitor', groups: ['watch'] },
];

export default function CoachBoard({ board, practicePlan = [], excludeInsightIds = [] }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const excluded = useMemo(() => new Set(excludeInsightIds), [excludeInsightIds]);
  const practiceByInsight = useMemo(() => new Map(
    (practicePlan ?? [])
      .filter((item) => item.sourceInsightId)
      .map((item) => [item.sourceInsightId, ROLE_LABELS[item.role] ?? 'stats.my.practice.role.default'])
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
    <SectionCard title={t('stats.my.coach.board.title')}>
      {sections.length ? sections.map((section, index) => (
        <View key={section.key} style={[s.section, index === 0 && s.sectionFirst]}>
          <View style={s.sectionHead}>
            <View style={s.sectionCopy}>
              <Text style={s.sectionTitle}>{t(`stats.my.coach.board.${section.key}.title`)}</Text>
              <Text style={s.sectionDescription}>{t(`stats.my.coach.board.${section.key}.description`)}</Text>
            </View>
            <View style={s.countPill}>
              <Text style={s.countText}>
                {section.groups.reduce((sum, group) => sum + group.insights.length, 0)}
              </Text>
            </View>
          </View>
          {section.groups.map((group) => (
            <View key={group.key} style={s.group}>
              <Text style={s.groupTitle}>{t(GROUP_LABELS[group.key])}</Text>
              {group.insights.map((insight) => (
                <CoachInsightRow
                  key={insight.id}
                  insight={insight}
                  practiceRole={practiceByInsight.has(insight.id) ? t(practiceByInsight.get(insight.id)) : undefined}
                />
              ))}
            </View>
          ))}
        </View>
      )) : (
        <Text style={s.empty}>{t('stats.my.coach.board.empty')}</Text>
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
