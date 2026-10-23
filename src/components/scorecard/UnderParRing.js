import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring, useReducedMotion,
} from 'react-native-reanimated';
import { semantic } from '../../theme/tokens';
import { duration, ease, spring } from '../../theme/motion';

const SIZE = 68;

// The gold ring behind a birdie-or-better score on the live card. It pops in
// once when the score turns under par (a short overshoot, then rest) and
// simply sits there when the card opens on a hole already under par. The
// CelebrationToast names the result; this only marks the number.
export default function UnderParRing({ show }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(show ? 1 : 0);
  const scale = useSharedValue(1);
  const was = useRef(show);

  useEffect(() => {
    if (was.current === show) return;
    was.current = show;
    if (reduced) { p.value = show ? 1 : 0; return; }
    p.value = withTiming(show ? 1 : 0, { duration: duration.state, easing: ease.out });
    if (show) {
      scale.value = 0.7;
      scale.value = withSequence(
        withTiming(1.12, { duration: duration.moment * 0.45, easing: ease.out }),
        withSpring(1, spring.snappy),
      );
    }
  }, [show, reduced, p, scale]);

  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: scale.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.ring, style]} />;
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    borderWidth: 2.5, borderColor: semantic.rank.gold,
  },
});
