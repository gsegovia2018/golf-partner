import { useCallback, useEffect, useRef } from 'react';

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

// Node-guarded unregister: only clears `key` when it currently points at
// `node` (the caller's own node). Two instances can share a key across
// their lifetimes (e.g. all 18 HolePage instances register 'score-entry'
// as the active hole changes) — a plain detach/cleanup from the OLD
// instance must never delete a registration the NEW instance has since
// installed. A `null` node is a no-op: it means the caller never actually
// held the registration (already detached, or never attached), so there
// is nothing of its own to remove.
export function unregisterTourTarget(key, node) {
  if (!key) return;
  if (node != null && targets.get(key) === node) targets.delete(key);
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
  const nodeRef = useRef(null);
  const refCb = useCallback((node) => {
    if (node) {
      nodeRef.current = node;
      registerTourTarget(key, node);
    } else {
      unregisterTourTarget(key, nodeRef.current);
      nodeRef.current = null;
    }
  }, [key]);
  // Belt-and-suspenders passive cleanup: normally the ref callback above
  // already detached (and nulled nodeRef.current) by the time this runs,
  // so this is a no-op. It only does real work if the ref callback was
  // somehow skipped, and even then it's node-guarded — it can only remove
  // a registration this instance's own node still owns.
  useEffect(() => () => unregisterTourTarget(key, nodeRef.current), [key]);
  return refCb;
}
