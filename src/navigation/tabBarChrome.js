// Geometry and scroll state of the floating tab bar, shared by the bar and
// the tab screens that scroll under it.
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { usePlayCue } from '../store/playCue';

export const BAR_HEIGHT = 66;
export const BAR_COLLAPSED = 56;
export const STRIP_HEIGHT = 52;
export const STRIP_GAP = 10;
export const BAR_SIDE = 16;
const BAR_LIFT = 8;
const CONTENT_GAP = 16;

// Below this scroll offset the bar always shows in full.
export const COLLAPSE_AFTER = 24;
const DOWN_SLOP = 4;
const UP_SLOP = 8;

export function barBottom(insetBottom) {
  return Math.max(insetBottom, 12) + BAR_LIFT;
}

// Bottom padding a tab screen's scroll content needs so its last item
// clears the expanded bar (and the live strip, when a round is live).
export function tabBarClearance(insetBottom, hasLive) {
  return barBottom(insetBottom) + BAR_HEIGHT + (hasLive ? STRIP_GAP + STRIP_HEIGHT : 0) + CONTENT_GAP;
}

// Where the shrunk bar's two circles sit (left edges). With a live round
// they bracket the strip at the bar's ends; without one they pair up in the
// middle, so no empty stretch opens between them.
export const SHRUNK_GAP = 8;
export function shrunkLayout({ windowWidth, left, barWidth, hasLive }) {
  if (hasLive) return { tab: left, play: left + barWidth - BAR_COLLAPSED };
  const mid = windowWidth / 2;
  return { tab: mid - BAR_COLLAPSED - SHRUNK_GAP / 2, play: mid + SHRUNK_GAP / 2 };
}

// Scrolling down past COLLAPSE_AFTER collapses the bar, scrolling up (or
// back near the top) expands it.
export function nextCollapsed(collapsed, y, dy) {
  if (y < COLLAPSE_AFTER) return false;
  if (!collapsed && dy > DOWN_SLOP) return true;
  if (collapsed && dy < -UP_SLOP) return false;
  return collapsed;
}

let collapsed = false;
const listeners = new Set();

export function isTabBarCollapsed() {
  return collapsed;
}

export function setTabBarCollapsed(next) {
  if (next === collapsed) return;
  collapsed = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTabBarCollapsed() {
  return useSyncExternalStore(subscribe, isTabBarCollapsed, isTabBarCollapsed);
}

// Spread onto a tab screen's main vertical ScrollView / FlatList.
export function useTabBarScroll() {
  const lastY = useRef(0);
  const onScroll = useCallback((e) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    const dy = y - lastY.current;
    lastY.current = y;
    setTabBarCollapsed(nextCollapsed(collapsed, y, dy));
  }, []);
  return { onScroll, scrollEventThrottle: 16 };
}

// Reads the insets context directly so a screen rendered outside a
// SafeAreaProvider (tests, previews) still lays out.
const NO_INSETS = createContext(null);
export function useTabBarClearance() {
  const insets = useContext(SafeAreaInsetsContext ?? NO_INSETS);
  const { live } = usePlayCue();
  return tabBarClearance(insets?.bottom ?? 0, live != null);
}
