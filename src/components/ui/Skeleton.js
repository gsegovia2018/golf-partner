import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';

// The loading standard (DESIGN.md "Loading states"): a screen with nothing to
// show yet draws the shape of its content instead of a spinner. `Skeleton` is
// one placeholder block, hidden from screen readers; `SkeletonRegion` wraps a
// loading screen (or part of one) and is the single "Loading…" announcement.
// Static on purpose: no pulse, so nothing to turn off for reduced motion.
export function Skeleton({ width = '100%', height = 12, radius = 6, style }) {
  const { theme } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.bg.skeleton }, style]}
    />
  );
}

// Real controls inside the region (Profile's links, History's filters) stay
// reachable, so the region itself isn't one accessible node: the announcement
// is its own 1 px element ahead of the content, and only the blocks are hidden.
export function SkeletonRegion({ style, children, testID }) {
  const t = useT();
  return (
    <View style={style} testID={testID}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('common.loading')}
        accessibilityState={{ busy: true }}
        accessibilityLiveRegion="polite"
        style={{ width: 1, height: 1 }}
      />
      {children}
    </View>
  );
}

export default Skeleton;
