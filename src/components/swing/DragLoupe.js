import React, {
  useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import {
  LOUPE_SIZE, LOUPE_FLASH_MS, loupePlacement, loupeImage,
} from '../../swing/loupe';

const FADE_MS = 90;
const GAP = 7; // crosshair: the centre stays open so the marked pixel itself is visible

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

function LoupeView({
  state, rect, uri, size, label, color, testID,
}) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) opacity.value = withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const at = loupePlacement(state.finger, rect, size);
  const img = loupeImage(state.mark, rect, size);
  const ring = (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={[styles.ring, {
        left: at.left, top: at.top, width: size, height: size, borderRadius: size / 2,
      }, fade]}
    >
      {uri ? <Image source={{ uri }} style={[styles.img, img]} resizeMode="stretch" /> : null}
      <Cross size={size} />
    </Animated.View>
  );
  if (!label) return ring;
  // The canvas names what is being placed (D26): a chip just above the ring, below it near the top.
  const top = at.top >= 24 ? at.top - 24 : at.top + size + 4;
  return (
    <>
      {ring}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.chip, { left: at.left, top, backgroundColor: color }]} testID={`${testID}-label`}>
        <Text style={styles.chipText}>{label}</Text>
      </View>
    </>
  );
}

/**
 * The drag loupe (D20): the still at 3x around the mark being moved, a crosshair at the exact
 * mark, above the finger (below it near the top edge), decorative for screen readers.
 * Sits inside the touch layer's parent, so its coordinates are the picture's (rect px).
 *
 * Imperative on purpose: a drag fires on every move and must not re-render the editor.
 * ref.show / ref.update({ finger: [x, y], mark: [nx, ny] }), ref.hide(),
 * ref.flash({ mark }) for an arrow nudge (no finger: it is placed off the mark itself).
 */
export default function DragLoupe({
  rect, uri, ref, size = LOUPE_SIZE, flashMs = LOUPE_FLASH_MS, label = null, color = '#ffffff', testID = 'edit-loupe',
}) {
  const [state, setState] = useState(null);
  const timer = useRef(null);
  const stop = () => { clearTimeout(timer.current); timer.current = null; };

  useImperativeHandle(ref, () => ({
    show: (s) => { stop(); setState(s); },
    update: (s) => setState(s),
    hide: () => { stop(); setState(null); },
    flash: ({ mark }) => {
      stop();
      setState({ finger: [mark[0] * rect.w, mark[1] * rect.h], mark });
      timer.current = setTimeout(() => { timer.current = null; setState(null); }, flashMs);
    },
  }), [rect.w, rect.h, flashMs]);
  useEffect(() => stop, []);

  if (!state || !rect?.w) return null;
  return <LoupeView state={state} rect={rect} uri={uri} size={size} label={label} color={color} testID={testID} />;
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute', overflow: 'hidden', backgroundColor: '#0a0d10',
    borderWidth: 2, borderColor: '#ffffff',
  },
  img: { position: 'absolute' },
  line: { position: 'absolute', backgroundColor: '#ffd98a' },
  chip: { position: 'absolute', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 9, letterSpacing: 0.6, color: '#0a0d10' },
});
