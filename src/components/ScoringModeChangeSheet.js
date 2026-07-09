// Bottom-sheet modal for picking a scoring mode after the player count
// makes the current mode invalid. Lists only the modes valid for the
// supplied count, with `defaultMode` pre-selected. Parent controls the
// `visible` state and receives the user's choice via `onConfirm(modeKey)`,
// or `onCancel()` if dismissed.
import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { SCORING_MODES, isScoringModeAllowed } from './scoringModes';

export default function ScoringModeChangeSheet({
  visible,
  playerCount,
  defaultMode,
  onConfirm,
  onCancel,
  title = 'Choose a scoring mode',
  subtitle,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [selected, setSelected] = useState(defaultMode);

  useEffect(() => {
    if (visible) setSelected(defaultMode);
  }, [visible, defaultMode]);

  const allowed = SCORING_MODES.filter((m) => isScoringModeAllowed(m.key, playerCount));

  return (
    <Modal statusBarTranslucent hardwareAccelerated visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <SafeAreaView style={s.sheet}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          <View style={s.list}>
            {allowed.map((mode) => {
              const isSelected = mode.key === selected;
              return (
                <TouchableOpacity
                  key={mode.key}
                  style={[s.row, isSelected && s.rowSelected]}
                  onPress={() => setSelected(mode.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Feather name={mode.icon} size={20} color={theme.accent.primary} />
                  <View style={s.rowText}>
                    <Text style={s.rowLabel}>{mode.label}</Text>
                    <Text style={s.rowSubtitle}>{mode.subtitle}</Text>
                  </View>
                  {isSelected ? (
                    <Feather name="check" size={20} color={theme.accent.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={s.actions}>
            <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmBtn, !selected && s.confirmBtnDisabled]}
              onPress={() => selected && onConfirm(selected)}
              disabled={!selected}
            >
              <Text style={s.confirmText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 32,
    },
    title: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 20,
      color: theme.text.primary,
      marginBottom: 4,
    },
    subtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 13,
      color: theme.text.muted,
      marginBottom: 12,
    },
    list: { marginBottom: 16 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.border.subtle,
    },
    rowSelected: { backgroundColor: theme.accent.light, borderRadius: 8 },
    rowText: { flex: 1 },
    rowLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 15,
      color: theme.text.primary,
    },
    rowSubtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 12,
      color: theme.text.muted,
      marginTop: 2,
    },
    actions: { flexDirection: 'row', gap: 12 },
    cancelBtn: {
      flex: 1,
      padding: 12,
      alignItems: 'center',
      borderRadius: 8,
      backgroundColor: theme.bg.secondary,
    },
    cancelText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
    },
    confirmBtn: {
      flex: 1,
      padding: 12,
      alignItems: 'center',
      borderRadius: 8,
      backgroundColor: theme.accent.primary,
    },
    confirmBtnDisabled: { opacity: 0.5 },
    confirmText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: '#fff',
    },
  });
}
