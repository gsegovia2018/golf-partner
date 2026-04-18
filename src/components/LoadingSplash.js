import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

function Ring({ delay }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    run.start();
    return () => run.stop();
  }, [delay, v]);

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
          opacity: v.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 0.55, 0] }),
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
          toValue: 1, duration: 1400, useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(breathe, {
          toValue: 0, duration: 1400, useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
      ]),
    );
    breatheLoop.start();
    Animated.timing(wordmark, {
      toValue: 1, duration: 800, delay: 200, useNativeDriver: true,
    }).start();
    return () => breatheLoop.stop();
  }, [breathe, wordmark]);

  const ballScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] });

  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        <Ring delay={0} />
        <Ring delay={900} />
        <Animated.View style={[styles.ball, { transform: [{ scale: ballScale }] }]}>
          <View style={[styles.dimple, styles.d1]} />
          <View style={[styles.dimple, styles.d2]} />
          <View style={[styles.dimple, styles.d3]} />
        </Animated.View>
      </View>
      <Animated.Text style={[styles.wordmark, { opacity: wordmark }]}>
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
    backgroundColor: '#006747',
  },
  stack: {
    width: 120, height: 120,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 1.5, borderColor: '#ffd700',
  },
  ball: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fefefe',
    shadowColor: '#ffd700',
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
    color: '#ffd700',
    fontSize: 12,
    letterSpacing: 5,
    fontWeight: '700',
  },
});
