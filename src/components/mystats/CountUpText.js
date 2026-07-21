import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

// Count-up: 0 → value over `duration` ms with cubic ease-out, starting
// after `delay` ms. Plain JS + requestAnimationFrame so web and native
// behave identically (no Reanimated worklets/ReText). Pass `disabled`
// (e.g. from useReducedMotion) to skip the animation and show the final
// value immediately. Every frame rounds to `decimals` precision (default 0,
// i.e. whole numbers), so integer stats never flash decimals mid-count and
// decimal stats never flash extra precision.
export function useCountUp(value, {
  duration = 500, delay = 0, disabled = false, decimals = 0,
} = {}) {
  const factor = 10 ** decimals;
  const target = Number.isFinite(value) ? Math.round(value * factor) / factor : 0;
  const [display, setDisplay] = useState(disabled ? target : 0);

  useEffect(() => {
    if (disabled) {
      setDisplay(target);
      return undefined;
    }
    let raf = null;
    let start = null;
    const tick = (ts) => {
      // React Native's jest polyfill (and some environments) may not hand a
      // usable timestamp to the callback — fall back to wall-clock time.
      const now = typeof ts === 'number' && !Number.isNaN(ts) ? ts : Date.now();
      if (start == null) start = now;
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(target * eased * factor) / factor);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => {
      clearTimeout(timer);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [target, duration, delay, disabled, factor]);

  return display;
}

// Renders a bare nested <Text> so a parent <Text> supplies all styling via
// React Native text-style inheritance (font, size, color). With `decimals`
// set, the value is fixed-formatted (e.g. 94 → "94.0") so the width and
// precision stay stable through the count; without it, output is the plain
// integer exactly as before.
export default function CountUpText({ value, duration, delay, disabled, decimals = 0 }) {
  const display = useCountUp(value, { duration, delay, disabled, decimals });
  return <Text>{decimals > 0 ? display.toFixed(decimals) : display}</Text>;
}
