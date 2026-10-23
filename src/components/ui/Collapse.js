import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration, ease } from '../../theme/motion';

// Unfolds its children below a control (a switch that unlocks more options)
// instead of popping them in and shoving the list down. The children are
// mounted only while open, so a closed Collapse renders nothing and screen
// readers and tests see exactly what they did before; closing folds the
// height away and lets the content go at once. Shared values rather than
// layout animations, which are unreliable on react-native-web.
export default function Collapse({ open, style, children }) {
  const reduced = useReducedMotion();
  const [height, setHeight] = useState(0);
  const p = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    p.value = reduced ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: duration.place, easing: ease.out });
  }, [open, reduced, p]);

  const boxStyle = useAnimatedStyle(() => ({ height: height * p.value }));
  const innerStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * -6 }],
  }));

  if (!open) return null;
  if (reduced) return <View style={style}>{children}</View>;
  return (
    <Animated.View style={[styles.clip, boxStyle]}>
      <Animated.View
        style={[styles.measured, style, innerStyle]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h && Math.abs(h - height) > 0.5) setHeight(h);
        }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // The content sits absolutely at its natural height, so the clip's animated
  // height (not the content) sets the layout while it unfolds.
  measured: { position: 'absolute', left: 0, right: 0, top: 0 },
});
