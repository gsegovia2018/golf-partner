import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export const ROUND_SUMMARY_TABS = [
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'photos', label: 'Photos' },
  { key: 'comments', label: 'Comments' },
];

export default function RoundSummaryTabs({ active, onChange }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.tabs}>
      {ROUND_SUMMARY_TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, selected && s.tabSelected]}
            onPress={() => onChange?.(tab.key)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[s.tabText, selected && s.tabTextSelected]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tabs: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 4,
      padding: 4,
    },
    tab: {
      alignItems: 'center',
      borderRadius: 6,
      flex: 1,
      justifyContent: 'center',
      minHeight: 34,
      minWidth: 0,
      paddingHorizontal: 8,
    },
    tabSelected: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderWidth: 1,
    },
    tabText: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 12,
    },
    tabTextSelected: {
      color: theme.text.primary,
    },
  });
}
