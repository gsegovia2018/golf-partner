import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export const ROUND_SUMMARY_TABS = [
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'photos', label: 'Photos' },
  { key: 'comments', label: 'Comments' },
];

// Top-of-page underline tabs: active tab gets accent text and a rounded
// indicator bar; inactive tabs stay muted on a transparent ground.
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
            style={s.tab}
            onPress={() => onChange?.(tab.key)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
          >
            <Text style={[s.tabText, selected && s.tabTextSelected]} numberOfLines={1}>
              {tab.label}
            </Text>
            <View style={[s.indicator, selected && s.indicatorSelected]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tabs: {
      borderBottomColor: theme.border.default,
      borderBottomWidth: 1,
      flexDirection: 'row',
    },
    tab: {
      alignItems: 'center',
      flex: 1,
      gap: 7,
      minWidth: 0,
      paddingHorizontal: 4,
      paddingTop: 8,
    },
    tabText: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13,
    },
    tabTextSelected: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
    indicator: {
      backgroundColor: 'transparent',
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      height: 3,
      width: '64%',
    },
    indicatorSelected: {
      backgroundColor: theme.accent.primary,
    },
  });
}
