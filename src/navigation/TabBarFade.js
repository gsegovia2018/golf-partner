import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';

// Pointer-transparent gradient that fades screen content out beneath the
// floating tab bar (mockup's `.fadeout`). Mounted as the first child of
// FloatingTabBar's `slot`, positioned to span the area immediately above
// the slot's own top edge so it overlays scrolled content, not the bar.
export default function TabBarFade({ height = 72 }) {
  const { theme } = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: -height, height }]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="tbfade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.bg.primary} stopOpacity="0" />
            <Stop offset="0.85" stopColor={theme.bg.primary} stopOpacity="1" />
            <Stop offset="1" stopColor={theme.bg.primary} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tbfade)" />
      </Svg>
    </View>
  );
}
