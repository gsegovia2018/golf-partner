import { useSyncExternalStore } from 'react';

// Whether a root-stack screen is sliding in or out right now. The tab bar's
// blur (TabBarSurface) pauses while it is: on Android the blur re-draws the
// whole window in software before every frame, and with two screens moving
// that cost ~36 ms a frame (History → game, game → Tarjeta ran at ~25 fps).
//
// Each moving screen reports start and end by route key. A screen removed
// mid-slide may never report its end, so a slide also clears by itself.
const SAFETY_MS = 1500;

const moving = new Map(); // route key → safety timer
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

export function beginStackTransition(key) {
  const wasMoving = moving.size > 0;
  clearTimeout(moving.get(key));
  moving.set(key, setTimeout(() => endStackTransition(key), SAFETY_MS));
  if (!wasMoving) emit();
}

export function endStackTransition(key) {
  if (!moving.has(key)) return;
  clearTimeout(moving.get(key));
  moving.delete(key);
  if (moving.size === 0) emit();
}

export function isStackTransitioning() {
  return moving.size > 0;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useStackTransitioning() {
  return useSyncExternalStore(subscribe, isStackTransitioning, isStackTransitioning);
}

// Root Stack.Navigator `screenListeners`.
export const stackTransitionListeners = {
  transitionStart: (e) => beginStackTransition(e.target),
  transitionEnd: (e) => endStackTransition(e.target),
};
