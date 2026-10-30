import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration, ease } from '../../theme/motion';

// One scorecard cell's Strokes | Points switch: the figure on show rolls out
// as the other mode's figure rolls in (up into points, down back to strokes).
// `index` is the hole's place in the round, so a card's cells roll as a wave
// from hole 1 to the total. `leaving` is the other mode's face (a node), i.e.
// what was on show before the switch. The first render never rolls; reduced
// motion swaps in place.
export const WAVE_STEP_MS = 12;

export default function CellRoll({ mode, index = 0, leaving, style, children }) {
  const reduced = useReducedMotion();
  const last = useRef(mode);
  const [out, setOut] = useState(null); // the leaving face
  const [h, setH] = useState(0);
  const p = useSharedValue(1);
  const dir = useSharedValue(1);

  useEffect(() => {
    if (last.current === mode) return undefined;
    last.current = mode;
    if (reduced) return undefined;
    const delay = index * WAVE_STEP_MS;
    dir.value = mode === 'points' ? 1 : -1;
    setOut(leaving);
    p.value = 0;
    p.value = withDelay(delay, withTiming(1, { duration: duration.state, easing: ease.out }));
    const id = setTimeout(() => setOut(null), delay + duration.state + 40);
    return () => clearTimeout(id);
    // `leaving` is read at the switch only: it is what was on show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduced, index, p, dir]);

  // Travel is 60% of the cell, as RollingNumber: a roll, both figures legible.
  const inStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * dir.value * h * 0.6 }],
  }));
  const outStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: -p.value * dir.value * h * 0.6 }],
  }));

  return (
    // Clipped only while rolling, so a current-hole glow isn't cut at rest.
    <View style={[styles.box, style, out && styles.clip]} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {/* Always attached: on the web a detached animated style keeps its last
          inline value (see RollingNumber). */}
      <Animated.View style={[styles.in, inStyle]}>{children}</Animated.View>
      {out ? (
        <Animated.View style={[styles.leaving, outStyle]} pointerEvents="none">
          <View style={styles.in} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
            {out}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch' },
  in: { flexGrow: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  leaving: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
