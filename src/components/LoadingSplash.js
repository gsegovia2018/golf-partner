import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { semantic } from '../theme/tokens';
import PuttScene from './splash/PuttScene';
import GreenScene from './splash/GreenScene';
import SwingScene from './splash/SwingScene';
import WaterScene from './splash/WaterScene';
import useSplashClock from './splash/useSplashClock';
import {
  pickScene, PUTT_STILL, GREEN_STILL, SWING_STILL, WATER_STILL,
} from './splash/splashMath';

const SCENE = {
  putt: { Component: PuttScene, still: PUTT_STILL },
  green: { Component: GreenScene, still: GREEN_STILL },
  swing: { Component: SwingScene, still: SWING_STILL },
  water: { Component: WaterScene, still: WATER_STILL },
};

// Boot passes through several gates that each mount this splash back to back
// (fonts/device → auth → onboarding). The scene is picked once per launch and the
// wordmark entrance reads once per cold start, so a hand-off never swaps or replays them.
let launchScene = null;
let wordmarkPlayed = false;

// `scene` pins one scene ('putt' | 'green' | 'swing' | 'water'); otherwise one is drawn at random.
export default function LoadingSplash({ scene }) {
  const [name] = useState(() => {
    if (scene) return scene;
    if (!launchScene) launchScene = pickScene();
    return launchScene;
  });
  const { Component, still } = SCENE[name] ?? SCENE.putt;
  const clock = useSplashClock(still);
  const reduced = useReducedMotion();
  const wordmark = useRef(new Animated.Value(wordmarkPlayed || reduced ? 1 : 0)).current;

  useEffect(() => {
    if (wordmarkPlayed) return;
    wordmarkPlayed = true;
    if (reduced) return;
    Animated.timing(wordmark, {
      toValue: 1, duration: 800, delay: 200, useNativeDriver: true,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
    }).start();
  }, [wordmark, reduced]);

  const wordmarkRise = wordmark.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <View style={styles.container}>
      <Component clock={clock} />
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
  // System font on purpose: the first splash renders before the app's fonts have loaded.
  wordmark: {
    marginTop: 24,
    paddingLeft: 6,
    color: semantic.winner.soft,
    fontSize: 12,
    letterSpacing: 6,
    fontWeight: '600',
  },
});
