// Reusable bottom sheet: a full-screen scrim that appears immediately while
// only the sheet slides up from the bottom.
//
// The app's older sheets used `<Modal animationType="slide">` with the dark
// backdrop placed *inside* the sliding container, so the scrim rose together
// with the sheet — it looked like the shadow was climbing up the screen. Here
// the Modal itself does not animate (`animationType="none"`); we drive both the
// backdrop opacity (fades in at once) and the sheet's translateY (slides up)
// from a single Animated value, keeping the scrim covering the whole screen the
// entire time.
//
// Props:
//   visible     - boolean, parent-controlled
//   onClose     - called when the backdrop is tapped or a back gesture fires
//   children    - the sheet content
//   sheetStyle  - style(s) applied to the sliding sheet container (bg, radius,
//                 padding). Defaults to a rounded card on theme.bg.primary.
//   backdropOpacity - max scrim opacity (default 0.5)
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, Animated, Easing, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';

// Drawer-style curves: a slower, more deliberate ease-out on the way in, a
// quicker snap back on the way out — "exits faster than enters".
const ENTER_DURATION = 320;
const ENTER_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const EXIT_DURATION = 200;
const EXIT_EASING = Easing.bezier(0.23, 1, 0.32, 1);

export default function BottomSheet({
  visible,
  onClose,
  children,
  sheetStyle,
  backdropOpacity = 0.5,
}) {
  // Tolerate a missing ThemeProvider (some render tests mount sheets without
  // one) — fall back to no explicit background, matching the app's other
  // theme-defensive components.
  const { theme } = useTheme() || {};
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  // Measured sheet height drives the slide distance so any sheet size slides
  // fully off-screen; a generous default covers the first frame before layout.
  const sheetH = useRef(new Animated.Value(600)).current;
  const sheetHValue = useRef(600);
  // Mirrors `visible` but stays true through the exit animation, so the sheet
  // can slide/fade out before unmounting instead of vanishing instantly.
  const [mounted, setMounted] = useState(visible);
  const exitTimerRef = useRef(null);
  // Guards the exit animation's completion callback (and its fallback timer)
  // against firing setState after the component itself has really unmounted
  // — both run on a real timer, well after a test's synchronous assertions
  // (or a fast prop flip elsewhere) may have already torn the tree down.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (exitTimerRef.current) { clearTimeout(exitTimerRef.current); exitTimerRef.current = null; }
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: ENTER_DURATION,
        easing: ENTER_EASING,
        useNativeDriver: true,
      }).start();
      return undefined;
    }
    if (!mounted) return undefined;
    // finished === false means the exit tween was interrupted (e.g. reopened
    // mid-exit) — unmounting then would wedge the sheet at mounted=false.
    const finish = ({ finished } = {}) => {
      if (finished !== false && isMountedRef.current) setMounted(false);
    };
    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_DURATION,
      easing: EXIT_EASING,
      useNativeDriver: true,
    }).start(finish);
    // Safety net: the native-driver completion callback doesn't fire in
    // every environment (test renderers, some reduced-motion paths) — a
    // fallback timer guarantees the sheet still unmounts and stops
    // swallowing taps even if the animation callback above never runs.
    exitTimerRef.current = setTimeout(finish, EXIT_DURATION + 50);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
  }, []);

  if (!mounted) return null;

  const backdropStyle = {
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, backdropOpacity],
    }),
  };
  // translateY = sheetHeight × (1 − progress): fully off-screen when closed,
  // 0 when open. Driven off the Animated height so a post-layout measurement
  // reactively corrects the slide distance. Reduced motion suppresses the
  // slide (pinned at rest) while the backdrop's opacity fade still plays.
  const translateY = reduced ? 0 : Animated.multiply(sheetH, Animated.subtract(1, progress));

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      hardwareAccelerated
      animationType="none"
      onRequestClose={onClose}
    >
      {/* Scrim: full-screen from the first frame, only its opacity animates. */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      {/* box-none lets taps above the sheet fall through to the scrim, while
          the keyboard lifts the sheet when a field inside it is focused. */}
      <KeyboardAvoidingView
        style={styles.root}
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme?.bg?.primary },
            sheetStyle,
            { transform: [{ translateY }] },
          ]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && Math.abs(h - sheetHValue.current) > 1) {
              sheetHValue.current = h;
              sheetH.setValue(h);
            }
          }}
        >
          {/* Content stays mounted through the exit tween — tied to the same
              `mounted` state as the sheet itself — so the sheet visually
              carries its content down instead of leaving an empty shell to
              animate out on its own. */}
          {mounted ? children : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
  },
});
