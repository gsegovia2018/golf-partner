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
  Modal, Animated, Pressable, StyleSheet, View,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function BottomSheet({
  visible,
  onClose,
  children,
  sheetStyle,
  backdropOpacity = 0.5,
}) {
  const { theme } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  // Keep the Modal mounted through the closing animation, then unmount.
  const [rendered, setRendered] = useState(visible);
  // Measured sheet height drives the slide distance so any sheet size slides
  // fully off-screen; a generous default covers the first frame before layout.
  const sheetH = useRef(new Animated.Value(600)).current;
  const sheetHValue = useRef(600);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
    } else if (rendered) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!rendered) return null;

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
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.bg.primary },
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
      </View>
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
