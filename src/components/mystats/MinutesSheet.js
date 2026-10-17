import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { PRACTICE_MINUTES_OPTIONS } from '../../store/settingsStore';
import BottomSheet from '../BottomSheet';
import IconButton from '../ui/IconButton';
import PressableScale from '../ui/PressableScale';
import SheetHandle from '../ui/SheetHandle';

// The weekly practice time: four radio rows. Picking one reports it and closes.
export default function MinutesSheet({ visible, onClose, minutes, onSelect }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const title = t('stats.my.coach.ui.minutes.title');
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <SheetHandle style={s.handle} />
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        <IconButton icon="x" onPress={onClose} accessibilityLabel={t('stats.my.coach.ui.drill.close')} style={s.close} />
      </View>
      <View style={s.body} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {PRACTICE_MINUTES_OPTIONS.map((m) => {
          const on = m === minutes;
          const label = t('stats.my.coach.ui.week.minutesAWeek', { minutes: m });
          return (
            <PressableScale
              key={m}
              onPress={() => { onSelect(m); onClose(); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={label}
              style={s.row}
              testID={`minutes-${m}`}
            >
              <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.dot} /> : null}</View>
              <Text style={s.rowText}>{label}</Text>
            </PressableScale>
          );
        })}
        <Text style={s.note}>{t('stats.my.coach.ui.minutes.note')}</Text>
      </View>
    </BottomSheet>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 32,
      borderTopWidth: 1,
      borderColor: theme.border.default,
    },
    handle: { marginTop: 10 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md,
      paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4,
      borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    },
    title: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17 },
    close: { width: 44, height: 44 },
    body: { paddingHorizontal: 20, paddingTop: 8 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 48,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle,
    },
    radio: {
      width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    radioOn: { borderColor: theme.accent.primary },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent.primary },
    rowText: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    note: { ...theme.typography.caption, color: theme.text.secondary, marginTop: theme.spacing.sm },
  });
}
