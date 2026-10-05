import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import DateSheet from './DateSheet';
import { formatLabel } from '../lib/calendar';

// An input-looking button that opens the calendar sheet. Holds only the
// open/closed state; the screen keeps the ISO strings.
//   label        - accessibility label, also the sheet title unless `title` is set
//   value        - 'YYYY-MM-DD' or ''
//   time/onTime  - optional 'HH:MM' tee time edited in the same sheet
export default function DateField({
  label, title, value, onChange, min, max, placeholder = 'Select a date', time, onTimeChange, style,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(false);
  const text = value ? `${formatLabel(value)}${time ? ` · ${time}` : ''}` : '';

  return (
    <>
      <TouchableOpacity
        style={[s.field, style]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: text || placeholder }}
      >
        <Text style={[s.text, !text && s.placeholder]} numberOfLines={1}>{text || placeholder}</Text>
        <Feather name="calendar" size={18} color={theme.accent.primary} />
      </TouchableOpacity>
      <DateSheet
        visible={open}
        title={title || label}
        value={value}
        min={min}
        max={max}
        time={time}
        onChange={(iso, clock) => { onChange(iso); if (onTimeChange && clock != null) onTimeChange(clock); }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  field: {
    height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    paddingHorizontal: 14, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
  },
  text: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.primary, fontSize: 15 },
  placeholder: { color: theme.text.muted },
});
