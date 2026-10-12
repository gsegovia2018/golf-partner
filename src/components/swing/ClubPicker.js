import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { CLUBS, normClub } from '../../swing/checks';
import { SWING_STRINGS } from '../../swing/strings';

const T = SWING_STRINGS.club;

/**
 * "Iron · Driver" segmented chip (D19). Two options, one selected. `onDark` draws it for the
 * green verdict card on Results; the default is for the light/dark app surface (Home).
 */
export default function ClubPicker({
  value, onChange, disabled = false, onDark = false, compact = false, testID,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme, onDark, compact), [theme, onDark, compact]);
  const current = normClub(value);
  return (
    <View
      style={[s.group, disabled && s.disabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={T.label}
      testID={testID}
    >
      {CLUBS.map((k) => {
        const on = current === k;
        return (
          <Pressable
            key={k}
            style={[s.seg, on && s.segOn]}
            onPress={() => { if (!on) onChange?.(k); }}
            disabled={disabled}
            hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
            accessibilityRole="radio"
            accessibilityLabel={T[k]}
            accessibilityState={{ selected: on, disabled }}
          >
            <Text style={[s.text, on && s.textOn]}>{T[k]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (theme, onDark, compact) => {
  const ink = onDark ? '#ffffff' : theme.text.secondary;
  return StyleSheet.create({
    group: {
      flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: 999,
      backgroundColor: onDark ? 'rgba(255,255,255,0.16)' : theme.bg.secondary,
      borderWidth: onDark ? 0 : 1, borderColor: theme.border.default,
    },
    seg: {
      minHeight: compact ? 26 : 38, minWidth: compact ? 56 : 84, paddingHorizontal: compact ? 12 : 16, borderRadius: 999,
      alignItems: 'center', justifyContent: 'center',
    },
    segOn: { backgroundColor: onDark ? '#ffffff' : theme.accent.primary },
    text: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: compact ? 11.5 : 14, color: ink },
    textOn: { fontFamily: 'PlusJakartaSans-Bold', color: onDark ? theme.bg.deep : theme.text.inverse },
    disabled: { opacity: 0.5 },
  });
};
