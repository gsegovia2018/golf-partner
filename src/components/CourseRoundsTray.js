import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useT } from '../i18n';

// The course picker's rounds tray (tournaments only): one slot per picked
// course, in round order, starting at the round the picker was opened from.
// Order is changed with up/down buttons rather than dragging, so it works
// one-handed and with a screen reader.
//
// `names` are the picked courses' display names, in order.
export default function CourseRoundsTray({ names, startRound, onMove, onRemove, onConfirm }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const count = names.length;

  return (
    <View style={s.tray} accessibilityLabel={t('courses.picker.rounds')}>
      <Text style={s.title}>{t('courses.picker.rounds')}</Text>
      <ScrollView style={s.slots} contentContainerStyle={s.slotsContent}>
        {names.map((name, i) => {
          const n = startRound + i;
          return (
            <View key={`${i}-${name}`} style={s.slot} accessible={false}>
              <Text style={s.roundNo}>{t('courses.picker.roundShort', { n })}</Text>
              <Text
                style={s.name}
                numberOfLines={1}
                accessibilityLabel={t('courses.picker.roundSlot', { n, name })}
              >
                {name}
              </Text>
              <SlotButton
                icon="chevron-up"
                label={t('courses.picker.moveEarlier', { n })}
                disabled={i === 0}
                onPress={() => onMove(i, i - 1)}
                theme={theme}
              />
              <SlotButton
                icon="chevron-down"
                label={t('courses.picker.moveLater', { n })}
                disabled={i === count - 1}
                onPress={() => onMove(i, i + 1)}
                theme={theme}
              />
              <SlotButton
                icon="x"
                label={t('courses.picker.removeRound', { n })}
                onPress={() => onRemove(i)}
                theme={theme}
              />
            </View>
          );
        })}
        <View style={[s.slot, s.nextSlot]}>
          <Text style={s.nextText}>{t('courses.picker.nextRound', { n: startRound + count })}</Text>
        </View>
      </ScrollView>
      {count > 0 ? (
        <TouchableOpacity style={s.confirmBtn} onPress={onConfirm} accessibilityRole="button">
          <Text style={s.confirmBtnText}>{t('courses.picker.addRounds', { count })}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SlotButton({ icon, label, disabled, onPress, theme }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[slotBtn.btn, disabled && slotBtn.disabled]}
    >
      <Feather name={icon} size={16} color={theme.text.secondary} />
    </TouchableOpacity>
  );
}

const slotBtn = StyleSheet.create({
  btn: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
});

const makeStyles = (theme) => StyleSheet.create({
  tray: {
    backgroundColor: theme.bg.card,
    borderTopWidth: 1,
    borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 12,
    color: theme.text.secondary,
  },
  // Three slots stay visible; a longer tournament scrolls inside the tray.
  slots: { maxHeight: 172, flexGrow: 0 },
  slotsContent: { gap: 6 },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.border.default,
    borderRadius: 12,
    paddingLeft: 10,
    backgroundColor: theme.bg.primary,
  },
  roundNo: {
    width: 30,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 12,
    color: theme.accent.primary,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 14,
    color: theme.text.primary,
  },
  nextSlot: { borderStyle: 'dashed', paddingHorizontal: 10 },
  nextText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13,
    color: theme.text.secondary,
  },
  confirmBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  confirmBtnText: {
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 16,
  },
});
