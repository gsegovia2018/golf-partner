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
import React, { useEffect, useRef } from 'react';
import {
  Modal, Animated, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

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
  const progress = useRef(new Animated.Value(0)).current;
  // Measured sheet height drives the slide distance so any sheet size slides
  // fully off-screen; a generous default covers the first frame before layout.
  const sheetH = useRef(new Animated.Value(600)).current;
  const sheetHValue = useRef(600);

  // Only the ENTRANCE animates (scrim appears at once, sheet slides up). Close
  // is immediate: gating unmount on an exit animation is fragile — the
  // native-driver completion callback doesn't fire in every environment (test
  // renderers, reduced motion), and a sheet that never unmounts leaves an
  // invisible full-screen pressable swallowing taps.
  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const backdropStyle = {
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, backdropOpacity],
    }),
  };
  // translateY = sheetHeight × (1 − progress): fully off-screen when closed,
  // 0 when open. Driven off the Animated height so a post-layout measurement
  // reactively corrects the slide distance.
  const translateY = Animated.multiply(sheetH, Animated.subtract(1, progress));

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
          {children}
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
