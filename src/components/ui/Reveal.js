import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { ease } from '../../theme/motion';

// Mount-reveal wrapper: fades in and rises `dy` px over `duration` ms.
// Remount (e.g. via a changing `key`) to replay, or change `replay` to replay
// without remounting the children (their state survives). Uses shared values rather
// than Layout/entering animations, which are unreliable on react-native-web.
// Reduced motion ⇒ renders the final state statically.
export default function Reveal({ delay = 0, dy = 6, duration = 180, replay, style, children }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration, easing: ease.out }));
  }, [reduced, delay, dy, duration, progress, replay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * dy }],
  }));

  if (reduced) {
    return <View style={style}>{children}</View>;
  }
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
