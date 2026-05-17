import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Sticky bottom navigation bar for the setup wizard.
//
// Props:
//   isFirstStep  hides the Back button when true
//   isLastStep   shows a play icon and treats Next as the "Start" action
//   nextEnabled  greys out and disables Next when false
//   nextLabel    text on the Next/Start button
//   onBack       called when Back is tapped
//   onNext       called when Next/Start is tapped
export default function WizardNav({
  isFirstStep, isLastStep, nextEnabled, nextLabel, onBack, onNext,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const iconColor = theme.isDark ? theme.accent.primary : theme.text.inverse;
  return (
    <View style={s.bar}>
      {!isFirstStep && (
        <TouchableOpacity style={s.backBtn} onPress={onBack} activeOpacity={0.8}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[s.nextBtn, !nextEnabled && { opacity: 0.5 }]}
        onPress={onNext}
        disabled={!nextEnabled}
        activeOpacity={0.8}
      >
        {isLastStep && (
          <Feather name="play" size={16} color={iconColor} style={{ marginRight: 8 }} />
        )}
        <Text style={s.nextText}>{nextLabel}</Text>
        {!isLastStep && (
          <Feather name="chevron-right" size={18} color={iconColor} style={{ marginLeft: 4 }} />
        )}
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row', gap: 10,
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
      backgroundColor: theme.bg.primary,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    backBtn: {
      minWidth: 92,
      alignItems: 'center', justifyContent: 'center',
      borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 16, paddingHorizontal: 18,
    },
    backText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.secondary, fontSize: 14,
    },
    nextBtn: {
      flex: 1,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
      borderRadius: 14,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
      paddingVertical: 16,
      ...(theme.isDark ? {} : theme.shadow.accent),
    },
    nextText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.isDark ? theme.accent.primary : theme.text.inverse,
      fontSize: 15,
    },
  });
}
