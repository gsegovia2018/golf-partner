import { useEffect } from 'react';
import { isBootRevealed, subscribeBootReveal } from '../store/bootReveal';

const START_MS = 800;
const GAP_MS = 400;

// Builds the tabs not yet opened once the first screen is showing, one at a
// time, so a first visit doesn't mount a whole screen (~800 views, 70-120 ms
// on a Pixel 8 Pro) in the middle of the bar's slide. A preloaded screen gets
// no focus event, so its focus-driven loads still run on the first visit.
export function usePreloadTabs(state, navigation) {
  useEffect(() => {
    if (typeof navigation.preload !== 'function') return undefined;
    const names = state.routes.filter((_, i) => i !== state.index).map((r) => r.name);
    const timers = [];
    const start = () => {
      names.forEach((name, i) => {
        timers.push(setTimeout(() => navigation.preload(name), START_MS + i * GAP_MS));
      });
    };
    const unsubscribe = isBootRevealed() ? null : subscribeBootReveal(start);
    if (!unsubscribe) start();
    return () => {
      unsubscribe?.();
      timers.forEach(clearTimeout);
    };
    // Once per app start: later tab changes have nothing left to build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
