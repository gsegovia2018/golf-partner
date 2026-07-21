import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

// Integer count-up: 0 → value over `duration` ms with cubic ease-out,
// starting after `delay` ms. Plain JS + requestAnimationFrame so web and
// native behave identically (no Reanimated worklets/ReText). Pass `disabled`
// (e.g. from useReducedMotion) to skip the animation and show the final
// value immediately. Every frame rounds to a whole number, so integer stats
// never flash decimals mid-count.
export function useCountUp(value, { duration = 500, delay = 0, disabled = false } = {}) {
  const target = Number.isFinite(value) ? Math.round(value) : 0;
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
      setDisplay(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => {
      clearTimeout(timer);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [target, duration, delay, disabled]);

  return display;
}

// Renders a bare nested <Text> so a parent <Text> supplies all styling via
// React Native text-style inheritance (font, size, color).
export default function CountUpText({ value, duration, delay, disabled }) {
  const display = useCountUp(value, { duration, delay, disabled });
  return <Text>{display}</Text>;
}
