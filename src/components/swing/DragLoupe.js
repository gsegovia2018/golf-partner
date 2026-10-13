import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { hud } from '../../theme/tokens';
import {
  LOUPE_SIZE, LOUPE_FLASH_MS, loupePlacement, loupeImage, loupeCorner, loupeSide,
} from '../../swing/loupe';
import { MARK_COLOR, HANDS_FILL } from './MarkCanvasParts';

export const LOUPE_FADE_MS = 90;
const GAP = 7; // crosshair: the centre stays open so the marked pixel itself is visible
export const LOUPE_KIND = { hands: 1, head: 2, ball: 3 }; // the dragged mark in `kind`; 0 = none
export const KIND_NAMES = [null, 'hands', 'head', 'ball'];

/**
 * The loupe's shared values, for a parent that drives it from a UI-thread gesture (D28): the finger
 * (fx, fy, rect px), the mark (mx, my, normalised), the ring's opacity and the dragged mark's kind.
 */
export function useLoupeValues() {
  return {
    fx: useSharedValue(0),
    fy: useSharedValue(0),
    mx: useSharedValue(0.5),
    my: useSharedValue(0.5),
    opacity: useSharedValue(0),
    kind: useSharedValue(0),
    side: useSharedValue(-1), // placement 'corner': 0 top-right, 1 bottom-right, -1 not chosen yet
  };
}

/** Where the ring is: above the finger (D20), or in the corner opposite the mark (D28). */
function ringAt(corner, side, finger, rect, size) {
  'worklet';
  return corner ? loupeCorner(side, rect, size) : loupePlacement(finger, rect, size);
}

function Cross({ size }) {
  const arm = size / 2 - GAP;
  const lines = [
    { left: 0, top: size / 2 - 0.5, width: arm, height: 1 },
    { left: size / 2 + GAP, top: size / 2 - 0.5, width: arm, height: 1 },
    { left: size / 2 - 0.5, top: 0, width: 1, height: arm },
    { left: size / 2 - 0.5, top: size / 2 + GAP, width: 1, height: arm },
  ];
  return lines.map((l, i) => (
    <View key={i} style={[styles.line, l]} />
  ));
}

/**
 * The drag loupe (D20): the still at 3x around the mark being moved, a crosshair at the exact
 * mark, above the finger (below it near the top edge), decorative for screen readers.
 * Sits inside the touch layer's parent, so its coordinates are the picture's (rect px).
 *
 * Imperative and outside React on purpose: a drag fires on every move, and each move only writes
 * shared values, which the UI thread turns into the loupe's position, its image offset, the label
 * and the mark being dragged (drawn here on top while the SVG layer hides it). It is mounted once
 * and shown or hidden by opacity, so a move is zero React renders.
 * ref.show({ finger: [x, y], mark: [nx, ny], kind }) (`kind` = 'hands' | 'head' | 'ball' also draws
 * that mark under the loupe), ref.update({ finger, mark }), ref.hide() (the loupe goes, the dragged
 * mark stays until ref.clearMark(), so it never vanishes before the committed one is drawn),
 * ref.flash({ mark }) for an arrow nudge (no finger: it is placed off the mark itself).
 * `values` (useLoupeValues()) hands the shared values to a parent whose gesture writes them on the
 * UI thread (the marking canvas); without it the loupe keeps its own. `placement` 'corner' (D28)
 * puts the ring in the right-hand corner away from the mark instead of above the finger.
 *
 * The image is the canvas's own still, at the same uri and the same resizeMethod ("scale"), so the
 * image cache serves the one decoded bitmap to both: the 3x picture is that bitmap drawn larger and
 * moved by a transform, never a second decode or a crop per drag.
 */
function DragLoupe({
  rect, uri, ref, values = null, placement = 'finger', size = LOUPE_SIZE, flashMs = LOUPE_FLASH_MS, label = null, color = hud.text, testID = 'edit-loupe',
}) {
  const reduced = useReducedMotion();
  const own = useLoupeValues();
  const {
    fx, fy, mx, my, opacity, kind, side,
  } = values ?? own;
  const corner = placement === 'corner';
  const timer = useRef(null);
  const geo = useRef(rect);
  geo.current = rect;
  const stop = () => { clearTimeout(timer.current); timer.current = null; };

  const fadeIn = () => {
    if (reduced) { opacity.value = 1; return; }
    if (opacity.value < 1) opacity.value = withTiming(1, { duration: LOUPE_FADE_MS, easing: Easing.out(Easing.quad) });
  };
  const put = ({ finger, mark }, fresh = false) => {
    fx.value = finger[0]; fy.value = finger[1];
    mx.value = mark[0]; my.value = mark[1];
    if (corner) side.value = loupeSide([mark[0] * geo.current.w, mark[1] * geo.current.h], geo.current, size, fresh ? -1 : side.value);
  };

  useImperativeHandle(ref, () => ({
    show: (s) => { stop(); put(s, true); kind.value = LOUPE_KIND[s.kind] ?? 0; fadeIn(); },
    update: (s) => put(s),
    hide: () => { stop(); opacity.value = 0; },
    clearMark: () => { kind.value = 0; },
    flash: ({ mark }) => {
      stop();
      const g = geo.current;
      put({ finger: [mark[0] * g.w, mark[1] * g.h], mark }, true);
      fadeIn();
      timer.current = setTimeout(() => { timer.current = null; opacity.value = 0; }, flashMs);
    },
  }), [flashMs, reduced, corner]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  const rw = rect?.w ?? 0;
  const rh = rect?.h ?? 0;
  const ring = useAnimatedStyle(() => {
    const at = ringAt(corner, side.value, [fx.value, fy.value], { w: rw, h: rh }, size);
    return { opacity: opacity.value, transform: [{ translateX: at.left }, { translateY: at.top }] };
  });
  const photo = useAnimatedStyle(() => {
    const img = loupeImage([mx.value, my.value], { w: rw, h: rh }, size);
    return { transform: [{ translateX: img.left }, { translateY: img.top }] };
  });
  const chip = useAnimatedStyle(() => {
    const at = ringAt(corner, side.value, [fx.value, fy.value], { w: rw, h: rh }, size);
    // a chip just above the ring, below it near the top
    const top = at.top >= 24 ? at.top - 24 : at.top + size + 4;
    return { opacity: opacity.value, transform: [{ translateX: at.left }, { translateY: top }] };
  });
  const dragged = useAnimatedStyle(() => ({
    opacity: kind.value ? 1 : 0, transform: [{ translateX: mx.value * rw }, { translateY: my.value * rh }],
  }));
  const asHands = useAnimatedStyle(() => ({ opacity: kind.value === 1 ? 1 : 0 }));
  const asHead = useAnimatedStyle(() => ({ opacity: kind.value === 2 ? 1 : 0 }));
  const asBall = useAnimatedStyle(() => ({ opacity: kind.value === 3 ? 1 : 0 }));

  if (!rw) return null;
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.dragged, dragged]} testID={`${testID}-mark`}>
        <View style={styles.halo} />
        <Animated.View style={[styles.hands, asHands]} />
        <Animated.View style={[styles.head, asHead]} />
        <Animated.View style={[styles.ball, asBall]} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={testID}
        style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, ring]}
      >
        <Animated.View style={[styles.photo, { width: rw * 3, height: rh * 3 }, photo]}>
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" resizeMethod="scale" /> : null}
        </Animated.View>
        <Cross size={size} />
      </Animated.View>
      {label ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.chip, { backgroundColor: color }, chip]}
          testID={`${testID}-label`}
        >
          <Text style={styles.chipText}>{label}</Text>
        </Animated.View>
      ) : null}
    </>
  );
}

export default React.memo(DragLoupe);

const styles = StyleSheet.create({
  ring: {
    position: 'absolute', left: 0, top: 0, overflow: 'hidden', backgroundColor: '#0a0d10',
    borderWidth: 2, borderColor: '#ffffff',
  },
  photo: { position: 'absolute', left: 0, top: 0 },
  line: { position: 'absolute', backgroundColor: '#ffd98a' },
  chip: { position: 'absolute', left: 0, top: 0, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, letterSpacing: 0.6, color: hud.onAccent },
  // The mark under the finger, drawn like the SVG layer draws the active one (MarkLayer), around its centre.
  dragged: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  halo: {
    position: 'absolute', left: -24, top: -24, width: 48, height: 48, borderRadius: 24,
    borderWidth: 1.5, borderColor: hud.text, borderStyle: 'dashed',
  },
  hands: {
    position: 'absolute', left: -14, top: -14, width: 28, height: 28,
    backgroundColor: HANDS_FILL, borderWidth: 3, borderColor: MARK_COLOR.hands,
  },
  head: {
    position: 'absolute', left: -10, top: -10, width: 20, height: 20, borderRadius: 10,
    backgroundColor: hud.text, borderWidth: 2.5, borderColor: hud.onAccent,
  },
  ball: {
    position: 'absolute', left: -12, top: -12, width: 24, height: 24, borderRadius: 12,
    borderWidth: 3, borderColor: MARK_COLOR.ball,
  },
});
