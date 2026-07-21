import { useCallback, useEffect } from 'react';

// Registry of spotlight-able UI nodes, keyed by tour-step key. Deep
// components (tab bar items, scorecard widgets) register a ref here; the
// CoachMarks overlay measures them at runtime — no coordinates are ever
// hardcoded, so layout changes degrade to a skipped stop, not a mis-aimed
// ring.

const targets = new Map();

export function __resetTourTargetsForTests() { targets.clear(); }

// Test-only visibility into what is currently registered — jsdom nodes lack
// measureInWindow, so registration itself is what tests assert on.
export function __getRegisteredTourKeysForTests() { return [...targets.keys()]; }

export function registerTourTarget(key, node) {
  if (!key) return;
  if (node) targets.set(key, node);
  else targets.delete(key);
}

// Resolves {x, y, width, height} in window coordinates, or null when the
// target is missing, unmeasurable, zero-sized, or doesn't answer within
// 300ms (native measure can go silent on detached nodes).
export function measureTourTarget(key) {
  return new Promise((resolve) => {
    const node = targets.get(key);
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let settled = false;
    const settle = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => settle(null), 300);
    try {
      node.measureInWindow((x, y, width, height) => {
        settle(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch { settle(null); }
  });
}

// Ref callback that keeps `key` registered while the component is mounted.
// A null key produces an inert callback so callers can register
// conditionally without breaking the rules of hooks.
export function useTourTarget(key) {
  const refCb = useCallback((node) => registerTourTarget(key, node), [key]);
  useEffect(() => () => registerTourTarget(key, null), [key]);
  return refCb;
}
