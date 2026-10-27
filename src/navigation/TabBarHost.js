// Draws the floating tab bar over the whole root stack, so it stays put on
// the browse screens opened over the tabs (BAR_ROUTE_NAMES) instead of
// sliding away with them, and fades out over the focused tasks.
//
// The tab navigator still owns the bar's state: its tabBar renders a
// TabBarPublisher, which hands this host the tabs' state and navigation.
import React, { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { StackActions } from '@react-navigation/native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import FloatingTabBar from './FloatingTabBar';
import { showsTabBar } from './tabBarModel';
import { setTabBarCollapsed } from './tabBarChrome';
import { duration } from '../theme/motion';

let published = null;
const listeners = new Set();

function publish(next) {
  published = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getPublished() {
  return published;
}

// The tab navigator's tabBar: draws nothing, publishes { state, navigation }.
export function TabBarPublisher({ state, navigation }) {
  useLayoutEffect(() => { publish({ state, navigation }); }, [state, navigation]);
  useEffect(() => () => publish(null), []);
  return null;
}

function rootTop(navigationRef) {
  if (!navigationRef.isReady()) return 'Main';
  const root = navigationRef.getRootState();
  return root?.routes?.[root.index]?.name ?? 'Main';
}

export default function TabBarHost({ navigationRef }) {
  const tabs = useSyncExternalStore(subscribe, getPublished, getPublished);
  const [top, setTop] = useState(() => rootTop(navigationRef));
  const reduced = useReducedMotion();

  useEffect(() => {
    setTop(rootTop(navigationRef));
    return navigationRef.addListener('state', () => setTop(rootTop(navigationRef)));
  }, [navigationRef]);

  // Every screen starts with the bar open.
  useEffect(() => { setTabBarCollapsed(false); }, [top]);

  const visible = showsTabBar(top);
  const shown = useSharedValue(visible ? 1 : 0);
  // On the web pointerEvents is CSS, where a child's own `auto` (Play's disc,
  // the tabs under box-none) still takes clicks under a `none` parent: the
  // faded-out disc ate taps meant for the screen below (the course picker's
  // Add button went Home). Once faded out, the bar is hidden there outright.
  const [gone, setGone] = useState(!visible);
  useEffect(() => {
    const to = visible ? 1 : 0;
    if (visible) setGone(false);
    else if (reduced) setGone(true);
    shown.value = reduced ? to : withTiming(to, { duration: visible ? duration.state : duration.touch }, (finished) => {
      if (finished && !visible) runOnJS(setGone)(true);
    });
  }, [visible, reduced, shown]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: shown.value }));

  if (!tabs) return null;

  const leaveScreen = () => {
    const root = navigationRef.getRootState();
    navigationRef.dispatch({ ...StackActions.popToTop(), target: root.key });
  };

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, fadeStyle, Platform.OS === 'web' && gone && !visible ? s.gone : null]}
      testID="tab-bar-host"
    >
      <FloatingTabBar
        state={tabs.state}
        navigation={tabs.navigation}
        overScreen={top !== 'Main'}
        leaveScreen={leaveScreen}
      />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  gone: { visibility: 'hidden' },
});
