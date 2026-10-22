import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// - value + control: two 44 px buttons around a bold value.
//   valueLabel     what to show between the buttons
//   valueA11y      spoken value ("Points for playing, 10")
//   onStep         (direction: -1 | 1) => void
//   canDecrease / canIncrease   disable a button at its limit
export default function Stepper({
  valueLabel, valueA11y, onStep, canDecrease = true, canIncrease = true,
  decreaseLabel, increaseLabel, valueMinWidth = 56,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.stepper}>
      <TouchableOpacity
        style={[s.button, !canDecrease && s.buttonOff]}
        onPress={() => onStep(-1)}
        disabled={!canDecrease}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={decreaseLabel}
        accessibilityState={{ disabled: !canDecrease }}
      >
        <Text style={s.buttonText}>−</Text>
      </TouchableOpacity>
      <Text
        style={[s.value, { minWidth: valueMinWidth }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={valueA11y}
      >{valueLabel}</Text>
      <TouchableOpacity
        style={[s.button, !canIncrease && s.buttonOff]}
        onPress={() => onStep(1)}
        disabled={!canIncrease}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={increaseLabel}
        accessibilityState={{ disabled: !canIncrease }}
      >
        <Text style={s.buttonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme) {
  const line = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    stepper: {
      flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
      borderWidth: 1, borderColor: line, borderRadius: 12, overflow: 'hidden',
    },
    button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary },
    buttonOff: { opacity: 0.4 },
    buttonText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 20, textAlign: 'center' },
    value: {
      textAlign: 'center', paddingHorizontal: 6, fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary, fontSize: 16,
    },
  });
}
