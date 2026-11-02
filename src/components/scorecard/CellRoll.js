import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration, ease } from '../../theme/motion';

// One figure's Strokes | Points switch (option A of the 2026-11-02 motion
// review): the figure on show rolls up and out of its cell as the other
// mode's figure rolls up into it from below. The result mark behind a figure
// (a score chip, a heat tile) travels with it, so figure and colour change as
// one. Cells and totals all use this, so every number on a card moves alike.
// `index` is the figure's place in the round (a nine's total comes after its
// last hole), so a card rolls as a short wave from hole 1 on. `leaving` /
// `underLeaving` are the other mode's figure and mark, i.e. what was on show
// before the switch; `under` is this mode's mark. The first render never
// rolls; reduced motion swaps in place.
export const WAVE_STEP_MS = 14;
// Travel is 70% of the cell: far enough to read as a roll, short enough that
// both figures stay legible inside the clip.
const TRAVEL = 0.7;

// The browser draws a moving element on its own layer with different text
// anti-aliasing; dropping that layer when the roll ends redraws the figure
// sharper (it "re-focuses"). Keeping the layer at rest draws it one way only.
const steadyLayer = Platform.OS === 'web' ? { willChange: 'transform, opacity' } : null;

export default function CellRoll({ mode, index = 0, leaving, under = null, underLeaving = null, style, children }) {
  const reduced = useReducedMotion();
  const last = useRef(mode);
  const timer = useRef(null);
  const [out, setOut] = useState(null); // { face, mark } on show before the switch
  const [h, setH] = useState(0);
  const p = useSharedValue(1);

  // A layout effect, so the new figure is already parked below the cell when
  // the frame is painted: with a plain effect it showed at rest for a frame
  // and then jumped down to start its roll.
  useLayoutEffect(() => {
    if (last.current === mode) return;
    last.current = mode;
    clearTimeout(timer.current);
    if (reduced) {
      setOut(null);
      return;
    }
    const delay = index * WAVE_STEP_MS;
    setOut({ face: leaving, mark: underLeaving });
    p.value = 0;
    p.value = withDelay(delay, withTiming(1, { duration: duration.state, easing: ease.out }));
    timer.current = setTimeout(() => setOut(null), delay + duration.state + 40);
    // `leaving` / `underLeaving` are read at the switch only: what was on show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduced, index, p]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Whole pixels, so the last frame lands exactly where the figure rests.
  const travel = Math.round(h * TRAVEL);
  const inStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * travel }],
  }));
  const outStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: -p.value * travel }],
  }));

  return (
    // Clipped only while rolling, so a current-hole glow isn't cut at rest.
    <View style={[styles.box, style, out && styles.clip]} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {/* Always attached: on the web a detached animated style keeps its last
          inline value (see RollingNumber). */}
      <Animated.View style={[styles.in, steadyLayer, inStyle]}>
        {under ? <View style={styles.layer} pointerEvents="none">{under}</View> : null}
        {children}
      </Animated.View>
      {out ? (
        <Animated.View style={[styles.layer, steadyLayer, outStyle]} pointerEvents="none">
          <View style={styles.face} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
            {out.mark ? <View style={styles.layer}>{out.mark}</View> : null}
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
  face: { flexGrow: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'stretch', justifyContent: 'center' },
});
