import React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration, ease } from '../../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function PressableScale({
  children, style, activeScale = 0.97, disabled, ...rest
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const to = (v) => {
    scale.value = withTiming(v, { duration: duration.touch, easing: ease.out });
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => { if (!reduced && !disabled) to(activeScale); rest.onPressIn?.(e); }}
      onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
