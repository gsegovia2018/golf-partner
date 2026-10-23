import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration as motion, ease } from '../../theme/motion';

// A number that rolls to its new value: up when it grows, down when it
// shrinks, the old figure leaving as the new one arrives. Only number → number
// changes roll; a dash or any other text simply swaps. `style` is the Text
// style. The leaving figure is hidden from screen readers and dropped once the
// roll ends.
export default function RollingNumber({ value, style, containerStyle }) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(null); // { text, dir }
  const [h, setH] = useState(0);
  const last = useRef(value);
  const p = useSharedValue(1);
  const dir = useSharedValue(1);

  useEffect(() => {
    const prev = last.current;
    last.current = value;
    if (prev === value || reduced) return undefined;
    const a = Number(prev);
    const b = Number(value);
    if (prev == null || value == null || !Number.isFinite(a) || !Number.isFinite(b)) {
      setLeaving(null);
      return undefined;
    }
    const d = b > a ? 1 : -1;
    dir.value = d;
    setLeaving({ text: String(prev), dir: d });
    p.value = 0;
    p.value = withTiming(1, { duration: motion.state, easing: ease.out });
    const id = setTimeout(() => setLeaving(null), motion.state + 40);
    return () => clearTimeout(id);
  }, [value, reduced, p, dir]);

  // Travel is 60% of the line: far enough to read as a roll, short enough
  // that both figures stay legible inside the clip.
  const inStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * dir.value * h * 0.6 }],
  }));
  const outStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: -p.value * dir.value * h * 0.6 }],
  }));

  return (
    <View style={[styles.clip, containerStyle]} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {/* Always attached: on the web a detached animated style keeps its last
          inline value, which could strand the figure half faded. */}
      <Animated.View style={inStyle}>
        <Text style={style}>{value}</Text>
      </Animated.View>
      {leaving ? (
        <Animated.View style={[styles.leaving, outStyle]} pointerEvents="none">
          {/* A plain View carries the hiding: Reanimated's web view would
              pass these props straight to the DOM. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
            <Text style={[style, styles.center]}>{leaving.text}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', alignItems: 'center' },
  leaving: { position: 'absolute', left: 0, right: 0, top: 0 },
  center: { textAlign: 'center' },
});
