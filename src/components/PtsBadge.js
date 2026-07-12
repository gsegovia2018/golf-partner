import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

// Small "pts" chip for section titles whose numbers are always Stableford
// points, even when the screen-wide Strokes/Points toggle is set to Strokes
// (Momentum, Clutch, Consistency, Course DNA). Without it the toggle reads
// as if it silently stopped working on those sections; the badge makes the
// metric explicit instead. Reused by later stats-audit tasks (Task 16/20),
// so it lives in its own file rather than inside StatsScreen.
export default function PtsBadge() {
  const { theme } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.accent.light }]}>
      <Text style={[styles.label, { color: theme.accent.primary }]}>pts</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  label: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
