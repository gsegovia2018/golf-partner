import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Wizard header: back chevron, "STEP X OF N" label, and a segmented progress
// bar. Purely presentational — all behaviour comes from props.
//
// Props:
//   step       0-based index of the active step
//   totalSteps total number of steps
//   onBack     called when the chevron is tapped
export default function WizardProgress({ step, totalSteps, onBack }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} accessibilityLabel="Go back">
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.label}>{`STEP ${step + 1} OF ${totalSteps}`}</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={s.bar}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[s.seg, i <= step ? s.segOn : s.segOff]} />
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    label: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 11, letterSpacing: 1.6,
    },
    bar: { flexDirection: 'row', gap: 5, marginTop: 12 },
    seg: { flex: 1, height: 4, borderRadius: 2 },
    segOn: { backgroundColor: theme.accent.primary },
    segOff: { backgroundColor: theme.border.default },
  });
}
