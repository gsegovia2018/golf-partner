import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, interpolateColor, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { duration, ease, spring } from '../../theme/motion';
import { haptic } from '../../lib/haptics';

const W = 46;
const H = 28;
const KNOB = 22;
const PAD = 3;
const STRETCH = 6;

// Drop-in for react-native's Switch: same value / onValueChange / disabled /
// trackColor props. The knob stretches while pressed and springs across with
// a small overshoot; the track fades between its two colours. `thumbColor`
// and `ios_backgroundColor` are accepted and ignored: the knob is always white.
export default function Switch({
  value, onValueChange, disabled, trackColor, testID, accessibilityLabel, style,
  thumbColor: _thumbColor, ios_backgroundColor: _iosBg, ...rest
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);
  const press = useSharedValue(0);
  const offColor = trackColor?.false ?? theme.border.default;
  const onColor = trackColor?.true ?? theme.accent.primary;

  useEffect(() => {
    const to = value ? 1 : 0;
    on.value = reduced ? to : withSpring(to, spring.snappy);
  }, [value, reduced, on]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.min(1, Math.max(0, on.value)), [0, 1], [offColor, onColor]),
  }));
  const knobStyle = useAnimatedStyle(() => {
    const stretch = press.value * STRETCH;
    // Grows toward the middle: rightward when off, leftward when on.
    const x = PAD + on.value * (W - KNOB - 2 * PAD) - on.value * stretch;
    return { width: KNOB + stretch, transform: [{ translateX: x }] };
  });

  const setPress = (v) => {
    if (reduced) return;
    press.value = withTiming(v, { duration: duration.touch, easing: ease.out });
  };

  return (
    <Pressable
      {...rest}
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
      aria-checked={!!value}
      disabled={disabled}
      hitSlop={8}
      onPressIn={() => setPress(1)}
      onPressOut={() => setPress(0)}
      onPress={() => { haptic('selection'); onValueChange?.(!value); }}
      style={[disabled && styles.off, style]}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, justifyContent: 'center' },
  knob: {
    position: 'absolute', left: 0, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  off: { opacity: 0.45 },
});
