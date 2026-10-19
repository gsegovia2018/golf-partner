// The score celebration (birdie and better) and the per-player stepper pulse.
// `celebration` + `celebrationAnim` drive CelebrationToast/Overlay in the hole
// view; `triggerCelebration` plays one tier; `getScoreAnim` hands each player
// a lazily created scale value.
import { useCallback, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { CELEBRATION_TIERS } from '../components/scorecard/constants';

export function useScoreCelebration() {
  const scoreAnims = useRef({});
  const [celebration, setCelebration] = useState({
    playerId: null, holeNumber: null, label: null, delta: null,
  });
  const celebrationAnim = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();

  // Hold time and haptic come from the tier, not from a chain here. The old
  // chain ended in `else 1800 // HOLE IN ONE`, which silently gave NOELADA the
  // longest hold of any tier, and it fired haptic('success') for every result
  // including a double bogey.
  // `toPar`, not `delta`: `stepScore` already has a `delta` in scope that means
  // the stepper increment (±1), and the two must never be confused. The state
  // field stays `delta` because CelebrationToast reads it under that name.
  const triggerCelebration = useCallback((playerId, holeNumber, label, toPar) => {
    const tier = CELEBRATION_TIERS[label] ?? CELEBRATION_TIERS.BIRDIE;
    haptic(tier.haptic);
    celebrationAnim.stopAnimation();
    celebrationAnim.setValue(0);
    setCelebration({ playerId, holeNumber, label, delta: toPar });
    // Reduced motion: cut to shown, hold, cut away — the spring/scale/ring
    // ride on this value, so zero-duration steps suppress all of them while
    // the overlay (and its live-region announcement) still happens.
    Animated.sequence([
      reducedMotion
        ? Animated.timing(celebrationAnim, { toValue: 1, duration: 0, useNativeDriver: true })
        : Animated.spring(celebrationAnim, {
          toValue: 1, friction: 6, tension: 80, useNativeDriver: true,
        }),
      Animated.delay(tier.holdMs),
      Animated.timing(celebrationAnim, {
        toValue: 0, duration: reducedMotion ? 0 : 420, useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setCelebration({ playerId: null, holeNumber: null, label: null, delta: null });
    });
  }, [celebrationAnim, reducedMotion]);

  const getScoreAnim = useCallback((playerId) => {
    if (!scoreAnims.current[playerId]) scoreAnims.current[playerId] = new Animated.Value(1);
    return scoreAnims.current[playerId];
  }, []);

  return { celebration, celebrationAnim, triggerCelebration, getScoreAnim };
}
