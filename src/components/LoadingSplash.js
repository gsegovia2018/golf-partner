import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { semantic } from '../theme/tokens';

// One shared cycle keeps the breath and the ring cadence in sync; rings run
// on a seamless 1/3-cycle stagger so the pulse never goes still.
const CYCLE = 2800;
const RING_EASE = Easing.bezier(0.23, 1, 0.32, 1);

function Ring({ delay }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: CYCLE,
          useNativeDriver: true,
          easing: RING_EASE,
        }),
      ),
    ]);
    run.start();
    return () => run.stop();
  }, [delay, v]);

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 2.35] }) }],
          opacity: v.interpolate({ inputRange: [0, 0.14, 1], outputRange: [0, 0.5, 0] }),
        },
      ]}
    />
  );
}

export default function LoadingSplash() {
  const breathe = useRef(new Animated.Value(0)).current;
  const wordmark = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1, duration: CYCLE / 2, useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(breathe, {
          toValue: 0, duration: CYCLE / 2, useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
      ]),
    );
    breatheLoop.start();
    Animated.timing(wordmark, {
      toValue: 1, duration: 800, delay: 200, useNativeDriver: true,
      easing: RING_EASE,
    }).start();
    return () => breatheLoop.stop();
  }, [breathe, wordmark]);

  const ballScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });
  const wordmarkRise = wordmark.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        <Ring delay={0} />
        <Ring delay={CYCLE / 3} />
        <Ring delay={(CYCLE / 3) * 2} />
        <Animated.View style={[styles.ball, { transform: [{ scale: ballScale }] }]}>
          <View style={[styles.dimple, styles.d1]} />
          <View style={[styles.dimple, styles.d2]} />
          <View style={[styles.dimple, styles.d3]} />
        </Animated.View>
      </View>
      <Animated.Text
        style={[styles.wordmark, { opacity: wordmark, transform: [{ translateY: wordmarkRise }] }]}
      >
        GOLF PARTNER
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f3d2c',
  },
  stack: {
    width: 130, height: 130,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 1.5, borderColor: semantic.winner.dark,
  },
  ball: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fefefe',
    shadowColor: semantic.winner.dark,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  dimple: {
    position: 'absolute',
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  d1: { top: 10, left: 13 },
  d2: { top: 13, right: 11 },
  d3: { bottom: 11, left: 18 },
  wordmark: {
    marginTop: 36,
    color: semantic.winner.dark,
    fontSize: 12,
    letterSpacing: 5,
    fontWeight: '700',
  },
});
