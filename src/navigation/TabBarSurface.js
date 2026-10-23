import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

// The frosted material of the floating tab bar, the live strip and the Play
// menu: a blur of whatever scrolls underneath under a tint that keeps the
// labels readable over any content. Fills its parent, which clips it.
export default function TabBarSurface({ theme, strong = false }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BlurView
        intensity={theme.isDark ? 40 : 50}
        tint={theme.isDark ? 'dark' : 'light'}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: strong ? theme.bg.frostedStrong : theme.bg.frosted }]} />
    </View>
  );
}
