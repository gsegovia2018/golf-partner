import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration, ease } from '../../theme/motion';

// One scorecard cell's Strokes | Points switch, as the motion demo showed it:
// the figure on show rolls up and out of the cell as the other mode's figure
// rolls up into it from below, and the result mark behind it (a score chip, a
// heat tile) swaps a beat later, the new one popping in from small.
// `index` is the hole's place in the round, so a card's cells roll as a wave
// from hole 1 on. `leaving` / `underLeaving` are the other mode's figure and
// mark, i.e. what was on show before the switch; `under` is this mode's mark.
// The first render never rolls; reduced motion swaps in place.
export const WAVE_STEP_MS = 28;
// The mark turns over once the figure is half way.
const MARK_DELAY_MS = 120;
// The arrival runs a touch longer than the exit, so the new figure settles.
const IN_MS = duration.state + 60;

export default function CellRoll({ mode, index = 0, leaving, under = null, underLeaving = null, style, children }) {
  const reduced = useReducedMotion();
  const last = useRef(mode);
  const [out, setOut] = useState(null); // { face, mark } on show before the switch
  const [h, setH] = useState(0);
  const pOut = useSharedValue(1);
  const pIn = useSharedValue(1);
  const pMark = useSharedValue(1);

  useEffect(() => {
    if (last.current === mode) return undefined;
    last.current = mode;
    if (reduced) return undefined;
    const delay = index * WAVE_STEP_MS;
    setOut({ face: leaving, mark: underLeaving });
    pOut.value = 0;
    pIn.value = 0;
    pMark.value = 0;
    pOut.value = withDelay(delay, withTiming(1, { duration: duration.state, easing: ease.out }));
    pIn.value = withDelay(delay, withTiming(1, { duration: IN_MS, easing: ease.out }));
    pMark.value = withDelay(delay + MARK_DELAY_MS, withTiming(1, { duration: IN_MS, easing: ease.out }));
    const id = setTimeout(() => setOut(null), delay + MARK_DELAY_MS + IN_MS + 40);
    return () => clearTimeout(id);
    // `leaving` / `underLeaving` are read at the switch only: what was on show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduced, index, pOut, pIn, pMark]);

  // A full cell of travel: the old figure leaves through the top edge.
  const inStyle = useAnimatedStyle(() => ({
    opacity: pIn.value,
    transform: [{ translateY: (1 - pIn.value) * h }],
  }));
  const outStyle = useAnimatedStyle(() => ({
    opacity: 1 - pOut.value,
    transform: [{ translateY: -pOut.value * h }],
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: pMark.value,
    transform: [{ scale: 0.4 + 0.6 * pMark.value }],
  }));
  const markOutStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, pMark.value * 2) }));

  return (
    // Clipped only while rolling, so a current-hole glow isn't cut at rest.
    <View style={[styles.box, style, out && styles.clip]} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {out?.mark ? (
        <Animated.View style={[styles.layer, markOutStyle]} pointerEvents="none">{out.mark}</Animated.View>
      ) : null}
      {/* Always attached: on the web a detached animated style keeps its last
          inline value (see RollingNumber). */}
      {under ? <Animated.View style={[styles.layer, markStyle]} pointerEvents="none">{under}</Animated.View> : null}
      <Animated.View style={[styles.in, inStyle]}>{children}</Animated.View>
      {out ? (
        <Animated.View style={[styles.layer, outStyle]} pointerEvents="none">
          <View style={styles.in} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
            {out.face}
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
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'stretch', justifyContent: 'center' },
});
