import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { useTheme } from '../../theme/ThemeContext';

export default function IconButton({
  icon, onPress, color, size = 21, dot = false, dotColor, disabled, style, children, ...rest
}) {
  const { theme } = useTheme();
  const s = styles(theme);
  return (
    <PressableScale
      {...rest}
      onPress={onPress}
      disabled={disabled}
      activeScale={0.94}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      style={[s.btn, style]}
    >
      {children ?? <Feather name={icon} size={size} color={color ?? theme.text.primary} />}
      {dot ? (
        <View testID="icon-button-dot" style={[s.dot, { backgroundColor: dotColor ?? theme.accent.primary }]} />
      ) : null}
    </PressableScale>
  );
}

const styles = (t) => StyleSheet.create({
  btn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute', top: 5, right: 5, width: 7, height: 7,
    borderRadius: 999, borderWidth: 1.5, borderColor: t.bg.primary,
  },
});
