import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import SectionCard from './SectionCard';
import CoachInsightRow from './CoachInsightRow';
import { GROUP_LABELS } from './CoachHero';
import PressableScale from '../ui/PressableScale';

const GROUP_ORDER = ['fixFirst', 'keepDoing', 'gettingBetter', 'gettingWorse', 'nextGains', 'watch'];
const BOARD_SECTIONS = [
  { key: 'improve', groups: ['fixFirst', 'nextGains'] },
  { key: 'protect', groups: ['keepDoing'] },
  { key: 'trends', groups: ['gettingBetter', 'gettingWorse'] },
  { key: 'monitor', groups: ['watch'] },
];

// `weekPills` maps insight id → { kind, minutes } from the weekly plan (the
// "this week" pill). `collapsible` folds the board behind a "More findings" row
// with the counts visible; the row reports its state through accessibilityState.
export default function CoachBoard({ board, weekPills = {}, excludeInsightIds = [], collapsible = false }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);
  const excluded = useMemo(() => new Set(excludeInsightIds), [excludeInsightIds]);
  const pillText = (id) => {
    const pill = weekPills?.[id];
    return pill
      ? t('stats.my.coach.ui.week.pill', { kind: t(`stats.my.coach.ui.kind.${pill.kind}`), minutes: pill.minutes })
      : undefined;
  };
  const sections = BOARD_SECTIONS.map((section) => ({
    ...section,
    groups: section.groups
      .map((key) => ({
        key,
        insights: (board?.[key] ?? []).filter((insight) => !excluded.has(insight.id)),
      }))
      .filter((group) => group.insights.length > 0),
  })).filter((section) => section.groups.length > 0);

  const showSections = !collapsible || expanded;
  const counts = sections.map((section) => (
    `${t(`stats.my.coach.board.${section.key}.title`)} ${section.groups.reduce((sum, g) => sum + g.insights.length, 0)}`
  )).join(' · ');

  return (
    <SectionCard title={t('stats.my.coach.board.title')} testID="coach-board">
      {collapsible && sections.length ? (
        <PressableScale
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${t('stats.my.coach.ui.more.title')}, ${counts}`}
          style={s.moreRow}
          testID="more-findings"
        >
          <View style={s.moreCopy}>
            <Text style={s.moreTitle}>{t('stats.my.coach.ui.more.title')}</Text>
            <Text style={s.moreCounts}>{counts}</Text>
          </View>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.text.secondary} />
        </PressableScale>
      ) : null}
      {showSections && sections.length ? sections.map((section, index) => (
        <View key={section.key} style={[s.section, index === 0 && !collapsible && s.sectionFirst]}>
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
                  weekPill={pillText(insight.id)}
                />
              ))}
            </View>
          ))}
        </View>
      )) : (sections.length ? null : <Text style={s.empty}>{t('stats.my.coach.board.empty')}</Text>)}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    moreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      minHeight: 44,
    },
    moreCopy: { flex: 1, minWidth: 0, gap: 2 },
    moreTitle: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    moreCounts: { ...theme.typography.caption, color: theme.text.secondary },
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
