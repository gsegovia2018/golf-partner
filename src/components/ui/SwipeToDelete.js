import React, { useCallback, useMemo, useRef } from 'react';
import {
  View, Animated, PanResponder, StyleSheet, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

const ACTION_WIDTH = 72;
const FLICK_VELOCITY = 0.2;

// Swipe-left reveal for a destructive action: the child slides to expose a
// red delete button underneath. The button only triggers the caller's
// onDelete (which should confirm) — the swipe itself never deletes.
// Disabled rows render the child untouched, with no action in the tree.
export default function SwipeToDelete({
  enabled = true, onDelete, borderRadius = 18, accessibilityLabel, children,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme, borderRadius), [theme, borderRadius]);
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);

  const snapTo = useCallback((to) => {
    offsetRef.current = to;
    Animated.spring(translateX, {
      toValue: to, useNativeDriver: true, bounciness: 0, speed: 20,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    // Claim only clearly horizontal drags so list scrolling stays untouched.
    onMoveShouldSetPanResponder: (_e, g) => (
      Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5
    ),
    onPanResponderMove: (_e, g) => {
      let x = offsetRef.current + g.dx;
      if (x > 0) x = 0;
      // Damping past the action width instead of a hard stop.
      if (x < -ACTION_WIDTH) x = -ACTION_WIDTH + (x + ACTION_WIDTH) / 3;
      translateX.setValue(x);
    },
    onPanResponderRelease: (_e, g) => {
      const x = offsetRef.current + g.dx;
      const flickLeft = g.vx < -FLICK_VELOCITY;
      const flickRight = g.vx > FLICK_VELOCITY;
      if (!flickRight && (flickLeft || x < -ACTION_WIDTH / 2)) snapTo(-ACTION_WIDTH);
      else snapTo(0);
    },
    onPanResponderTerminate: () => snapTo(offsetRef.current),
  }), [translateX, snapTo]);

  if (!enabled) return children;

  return (
    <View style={s.wrap}>
      <View style={s.under}>
        <Pressable
          style={s.deleteBtn}
          onPress={() => { snapTo(0); onDelete?.(); }}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? 'Delete'}
          testID="swipe-delete-action"
        >
          <Feather name="trash-2" size={20} color="#ffffff" />
        </Pressable>
      </View>
      <Animated.View
        style={[s.content, { transform: [{ translateX }] }]}
        testID="swipe-content"
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function makeStyles(theme, borderRadius) {
  return StyleSheet.create({
    wrap: { position: 'relative' },
    // Opaque screen-colored backing behind the child: translucent card
    // backgrounds (dark theme) composite over this instead of the red
    // underlay, so the delete action only shows once the row is swiped.
    content: { backgroundColor: theme.bg.primary, borderRadius },
    under: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.destructive,
      borderRadius,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    deleteBtn: {
      width: ACTION_WIDTH,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
