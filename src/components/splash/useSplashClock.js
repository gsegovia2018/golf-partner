import { useState } from 'react';
import { useSharedValue, useFrameCallback, useReducedMotion } from 'react-native-reanimated';

// Boot mounts the splash several times back to back (fonts/device → auth → onboarding).
// One clock per launch keeps the scene playing across those hand-offs instead of restarting it.
let bootStartedAt = null;

// Seconds since the first splash of this launch, ticking on the UI thread. Under reduced
// motion it never ticks and rests on the scene's still frame.
export default function useSplashClock(stillAt) {
  const reduced = useReducedMotion();
  const [offset] = useState(() => {
    if (bootStartedAt === null) bootStartedAt = Date.now();
    return (Date.now() - bootStartedAt) / 1000;
  });
  const clock = useSharedValue(reduced ? stillAt : offset);
  const firstFrame = useSharedValue(-1);
  useFrameCallback((info) => {
    'worklet';
    if (firstFrame.value < 0) firstFrame.value = info.timestamp;
    clock.value = offset + (info.timestamp - firstFrame.value) / 1000;
  }, !reduced);
  return clock;
}
