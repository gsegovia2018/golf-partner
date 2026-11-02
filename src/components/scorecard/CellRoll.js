import React, { memo, useLayoutEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, useReducedMotion,
} from 'react-native-reanimated';
import { duration, ease } from '../../theme/motion';

// One figure's Strokes | Points switch (option A of the 2026-11-02 motion
// review): the figure on show rolls up and out of its cell as the other
// mode's figure rolls up into it from below, each with its result mark (a
// score chip, a heat tile) behind it, so figure and colour change as one.
// Cells and totals all use this, so every number on a card moves alike.
//
// Both faces stay mounted and the switch only moves them on the UI thread.
// Mounting the leaving face at the switch and dropping it when its roll ended
// cost two React commits per cell, staggered by the wave: on Android that was
// ~60 view batches per switch landing mid-animation, and the roll stuttered.
//
// Pass `faces` / `marks` built once (memoised by the caller): a switch then
// re-renders only the two face wrappers, never the text inside them, which
// Android would otherwise re-measure across the whole card in one frame.
// `step` is the wave's delay per `index` (a whole-row roll passes its own).
// `faces` / `marks` are { strokes, points }; `index` is the figure's place in
// the round (a nine's total comes after its last hole), so a card rolls as a
// short wave from hole 1 on. `clip={false}` leaves the box unclipped, for a
// cell whose glow must show at rest. The first render never rolls; reduced
// motion swaps in place.
export const WAVE_STEP_MS = 14;
// Travel is 70% of the cell: far enough to read as a roll, short enough that
// both figures stay legible inside the clip.
const TRAVEL = 0.7;
const MODES = ['strokes', 'points'];

// The browser draws a moving element on its own layer with different text
// anti-aliasing; dropping that layer when the roll ends redraws the figure
// sharper (it "re-focuses"). Keeping the layer at rest draws it one way only.
const steadyLayer = Platform.OS === 'web' ? { willChange: 'transform, opacity' } : null;

const Face = memo(function Face({ k, on, active, p, h, mark, children }) {
  // Shown face: fades in from below. Other face: leaves upward and waits,
  // invisible, above the cell (it jumps below unseen when it next enters).
  const st = useAnimatedStyle(() => {
    const travel = Math.round(h.value * TRAVEL); // whole pixels at rest
    return active.value === k
      ? { opacity: p.value, transform: [{ translateY: (1 - p.value) * travel }] }
      : { opacity: 1 - p.value, transform: [{ translateY: -p.value * travel }] };
  });
  return (
    <Animated.View
      style={[k === 0 ? styles.flow : styles.layer, steadyLayer, st]}
      collapsable={false}
      pointerEvents={on ? 'box-none' : 'none'}
    >
      {/* A plain View carries the hiding: Reanimated's web view would pass
          these props straight to the DOM. */}
      <View
        style={styles.face}
        // Never flattened: toggling a flattenable wrapper's pointer / a11y props
        // makes Android remount it and re-measure all the text inside.
        collapsable={false}
        pointerEvents={on ? 'box-none' : 'none'}
        accessibilityElementsHidden={!on}
        importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
        aria-hidden={!on}
      >
        {mark ? <View style={styles.layer} pointerEvents="none">{mark}</View> : null}
        {children}
      </View>
    </Animated.View>
  );
});

const NO_MARKS = {};

function CellRoll({ mode, index = 0, step = WAVE_STEP_MS, faces, marks = NO_MARKS, clip = true, style }) {
  const reduced = useReducedMotion();
  const idx = Math.max(0, MODES.indexOf(mode));
  const last = useRef(idx);
  const active = useSharedValue(idx);
  const p = useSharedValue(1);
  const h = useSharedValue(0);

  useLayoutEffect(() => {
    if (last.current === idx) return;
    last.current = idx;
    active.value = idx;
    p.value = 0;
    p.value = reduced
      ? 1
      : withDelay(index * step, withTiming(1, { duration: duration.state, easing: ease.out }));
  }, [idx, reduced, index, step, active, p]);

  return (
    <View
      style={[styles.box, style, clip && styles.clip]}
      onLayout={(e) => { h.value = e.nativeEvent.layout.height; }}
    >
      {MODES.map((m, k) => (
        <Face key={m} k={k} on={k === idx} active={active} p={p} h={h} mark={marks[m]}>
          {faces[m]}
        </Face>
      ))}
    </View>
  );
}

export default memo(CellRoll);

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch' },
  // The strokes face is in the flow and sizes the box; points sits over it.
  flow: { flexGrow: 1, alignSelf: 'stretch' },
  face: { flexGrow: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'stretch', justifyContent: 'center' },
});
