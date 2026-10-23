import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing, interpolate, Extrapolation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { useT } from '../i18n';
import TabBarSurface from './TabBarSurface';

// The live round above the tab bar: hole, course and my points, one tap to
// the scorecard. `collapse` (0 → 1) folds it into one line between the
// shrunk bar's two circles; the parent animates its frame.
export default function LiveRoundStrip({ live, collapse, reduced, theme, onPress, style }) {
  const t = useT();
  const s = makeStyles(theme);
  const holeText = live.hole != null ? t('nav.live.hole', { n: live.hole }) : null;
  const full = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0, 0.35], [1, 0], Extrapolation.CLAMP),
  }));
  const compact = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0.55, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const points = live.points != null ? (
    <Text style={s.points}>{live.points}<Text style={s.pts}> {t('home.live.pts')}</Text></Text>
  ) : null;

  return (
    <Animated.View style={[s.frame, style]}>
      <TabBarSurface theme={theme} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[t('nav.live.resume', { course: live.courseName }), holeText].filter(Boolean).join(', ')}
        testID="tabbar-live-strip"
      >
        <Animated.View style={[s.full, full]}>
          <LiveDot color={theme.destructive} reduced={reduced} />
          <View style={s.text}>
            <Text style={s.kicker} numberOfLines={1}>
              {[t('shared.live'), holeText?.toUpperCase()].filter(Boolean).join(' · ')}
            </Text>
            <Text style={s.course} numberOfLines={1}>{live.courseName}</Text>
          </View>
          {points}
          <View style={s.go}>
            <Feather name="chevron-right" size={18} color={theme.text.inverse} />
          </View>
        </Animated.View>
        <Animated.View style={[s.compact, compact]} pointerEvents="none">
          <LiveDot color={theme.destructive} reduced={reduced} />
          <Text style={s.compactText} numberOfLines={1}>
            {[holeText ?? t('shared.live'), live.points != null ? `${live.points} ${t('home.live.pts')}` : null].filter(Boolean).join(' · ')}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// A red dot with a ring that keeps rippling out while the round is live.
function LiveDot({ color, reduced }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    p.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
  }, [p, reduced]);
  const ring = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - p.value),
    transform: [{ scale: 1 + p.value * 1.6 }],
  }));
  return (
    <View style={dot.wrap}>
      <Animated.View style={[dot.ring, { backgroundColor: color }, ring]} />
      <View style={[dot.core, { backgroundColor: color }]} />
    </View>
  );
}

const dot = StyleSheet.create({
  wrap: { width: 8, height: 8 },
  ring: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  core: { width: 8, height: 8, borderRadius: 4 },
});

function makeStyles(theme) {
  return StyleSheet.create({
    frame: {
      position: 'absolute',
      overflow: 'hidden',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border ?? theme.border.default : 'rgba(0,0,0,0.06)',
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.4 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    full: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 16,
      paddingRight: 6,
    },
    text: { flex: 1, minWidth: 0 },
    kicker: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 0.6,
      color: theme.destructive,
    },
    course: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
      lineHeight: 17,
      color: theme.text.primary,
    },
    points: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 15,
      color: theme.text.primary,
    },
    pts: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
      color: theme.text.secondary,
    },
    go: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.accent.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compact: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 12,
    },
    compactText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 13,
      color: theme.text.primary,
      flexShrink: 1,
    },
  });
}
