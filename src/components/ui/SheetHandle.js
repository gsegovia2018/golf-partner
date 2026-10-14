// The small drag handle at the top of a bottom sheet (36 x 4).
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export default function SheetHandle({ style }) {
  const { theme } = useTheme();
  return <View style={[styles.handle, { backgroundColor: theme.border.default }, style]} />;
}

const styles = StyleSheet.create({
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
});
