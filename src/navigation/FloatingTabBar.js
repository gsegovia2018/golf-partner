import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';
import { getTabBarItem, isCenterTab } from './tabBarModel';
import {
  BAR_COLLAPSED, BAR_HEIGHT, BAR_SIDE, STRIP_GAP, STRIP_HEIGHT, barBottom, setTabBarCollapsed, shrunkLayout, useTabBarCollapsed,
} from './tabBarChrome';
import { markTabSwitch } from './tabSettle';
import TabBarSurface from './TabBarSurface';
import LiveRoundStrip from './LiveRoundStrip';
import PlayQuickMenu, { playMenuHeight } from './PlayQuickMenu';
import { openLiveScorecard } from './openScorecard';
import { usePlayCue } from '../store/playCue';
import { haptic } from '../lib/haptics';
import { useTourTarget } from '../components/tour/tourTargets';
import { useT } from '../i18n';

// Route name → tour target key; History deliberately has no stop.
const TOUR_TARGET_KEYS = {
  Home: 'tab-play', MyStats: 'tab-stats', Feed: 'tab-feed', Profile: 'tab-profile',
};

const DISC = 48;
const TRACK_PAD = 6;
const DROP_INSET = 2;
const DROP_TOP = 8;
const DROP_H = BAR_HEIGHT - DROP_TOP * 2;
const BALL = 8;
// Every spring names its mass: Reanimated 4 defaults it to 4, which halves
// the damping ratio these were tuned with (the drop's trailing edge whipped
// past the leading one and the bar wobbled for a second).
const COLLAPSE_SPRING = { damping: 17, stiffness: 190, mass: 0.9 };
const MENU_SPRING = { damping: 19, stiffness: 210, mass: 1 };
const DROP_LEAD = { damping: 14, stiffness: 320, mass: 0.6 };
const DROP_TRAIL = { damping: 16, stiffness: 170, mass: 1 };
const HOP_MS = 460;

// The floating tab bar (DESIGN.md, Navigation): a frosted pill over the
// content with Play as a disc in the middle. A mint drop slides behind the
// selected tab and a ball hops to it, dropping into the disc on Play.
// Scrolling down shrinks the bar to the current tab's circle and Play's,
// with the live round's strip between them. Holding Play opens its menu.
export default function FloatingTabBar({ state, navigation }) {
  const t = useT(); // also re-renders on a language change; labels resolve in getTabBarItem
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const reduced = useReducedMotion();
  const { live, quickStart } = usePlayCue();
  const collapsed = useTabBarCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  // The tab just tapped, until the navigator catches up (see pressTab).
  const [pressed, setPressed] = useState(null);
  const s = React.useMemo(() => makeStyles(theme), [theme]);

  const barWidth = Math.min(windowWidth - BAR_SIDE * 2, CONTENT_MAX_WIDTH);
  const left = (windowWidth - barWidth) / 2;
  const bottom = barBottom(insets.bottom);
  const trackWidth = barWidth - TRACK_PAD * 2;
  const count = state.routes.length;
  const slot = trackWidth / count;
  const active = pressed ?? state.index;
  const centerIndex = state.routes.findIndex((r) => isCenterTab(r.name));
  const activeItem = getTabBarItem(state.routes[active]?.name);
  const shrunk = shrunkLayout({ windowWidth, left, barWidth, hasLive: !!live });
  const menuHeight = playMenuHeight({ hasLive: !!live, hasQuickStart: quickStart.length > 0 });

  // A new tab starts with the bar open.
  useEffect(() => { setTabBarCollapsed(false); }, [active]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const collapse = useSharedValue(collapsed ? 1 : 0);
  useEffect(() => {
    const to = collapsed && !menuOpen ? 1 : 0;
    collapse.value = reduced ? to : withSpring(to, COLLAPSE_SPRING);
  }, [collapsed, menuOpen, reduced, collapse]);

  const open = useSharedValue(0);
  useEffect(() => {
    open.value = reduced ? (menuOpen ? 1 : 0) : withSpring(menuOpen ? 1 : 0, MENU_SPRING);
    if (menuOpen) { setMenuMounted(true); return undefined; }
    const id = setTimeout(() => setMenuMounted(false), reduced ? 0 : 380);
    return () => clearTimeout(id);
  }, [menuOpen, reduced, open]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setMenuOpen(false); return true; });
    return () => sub.remove();
  }, [menuOpen]);

  const indicator = useIndicator({ active, count, slot, centerIndex, reduced, fadeWith: [collapse, open] });
  const cup = useCupOnFocus(active === centerIndex, reduced);

  const pressTab = (route, index) => {
    const item = getTabBarItem(route.name);
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented && index !== active) {
      haptic('selection');
      // The bar moves on this frame and the screen follows on the next: a
      // tab's first visit mounts its whole screen, and the drop and ball
      // used to wait for that render before they set off.
      setPressed(index);
      markTabSwitch();
      requestAnimationFrame(() => {
        navigation.navigate(item.targetRouteName);
        setPressed(null);
      });
    }
  };
  const goHome = (params) => {
    setMenuOpen(false);
    navigation.navigate('Home', params);
  };
  const resume = () => {
    if (!live) return;
    setMenuOpen(false);
    haptic('light');
    openLiveScorecard(navigation, live);
  };
  const openMenu = () => {
    haptic('medium');
    setMenuOpen(true);
  };

  const pillStyle = useAnimatedStyle(() => ({
    left: interpolate(collapse.value, [0, 1], [left, shrunk.tab]),
    width: interpolate(collapse.value, [0, 1], [barWidth, BAR_COLLAPSED], Extrapolation.EXTEND),
    height: interpolate(collapse.value, [0, 1], [BAR_HEIGHT, BAR_COLLAPSED], Extrapolation.EXTEND),
    bottom: interpolate(collapse.value, [0, 1], [bottom, bottom + (BAR_HEIGHT - BAR_COLLAPSED) / 2]),
    opacity: 1 - Math.min(open.value * 2, 1),
  }));
  const trackStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(collapse.value, [0, 1], [1, 0.6], Extrapolation.CLAMP) }],
  }));
  const miniStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapse.value, [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(collapse.value, [0.5, 1], [0.5, 1], Extrapolation.CLAMP) }],
  }));
  const stripStyle = useAnimatedStyle(() => ({
    left: interpolate(collapse.value, [0, 1], [left, left + BAR_COLLAPSED + 8]),
    width: interpolate(collapse.value, [0, 1], [barWidth, barWidth - (BAR_COLLAPSED + 8) * 2]),
    height: interpolate(collapse.value, [0, 1], [STRIP_HEIGHT, BAR_COLLAPSED]),
    bottom: interpolate(collapse.value, [0, 1], [bottom + BAR_HEIGHT + STRIP_GAP, bottom + (BAR_HEIGHT - BAR_COLLAPSED) / 2]),
    opacity: 1 - Math.min(open.value * 2, 1),
  }));
  // Play's disc: in the bar's middle, beside the tab circle when shrunk
  // (shrunkLayout), and the whole menu card when held open.
  const discStyle = useAnimatedStyle(() => {
    const c = collapse.value;
    // The card never overshoots its frame; the spring only shows near rest.
    const k = Math.min(Math.max(open.value, 0), 1);
    const size = interpolate(c, [0, 1], [DISC, BAR_COLLAPSED]);
    const x = interpolate(c, [0, 1], [left + barWidth / 2 - DISC / 2, shrunk.play]);
    const y = interpolate(c, [0, 1], [bottom + (BAR_HEIGHT - DISC) / 2, bottom + (BAR_HEIGHT - BAR_COLLAPSED) / 2]);
    return {
      left: x + (left - x) * k,
      bottom: y + (bottom - y) * k,
      width: size + (barWidth - size) * k,
      height: size + (menuHeight - size) * k,
      borderRadius: size / 2 + (28 - size / 2) * k,
      transform: [{ scale: cup.value }],
    };
  });
  const discFaceStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(Math.max(open.value, 0) * 2.5, 1) }));
  const menuFaceStyle = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(open.value, 0) * 2, 1) }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(open.value, 0), 1) * 0.64 }));

  if (keyboard) return null;

  const centerRoute = state.routes[centerIndex];
  const playItem = centerRoute ? getTabBarItem(centerRoute.name) : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="floating-tab-bar">
      <Animated.View
        pointerEvents={menuOpen ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, s.scrim, scrimStyle]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel={t('nav.menu.close')} />
      </Animated.View>

      {live ? (
        <LiveRoundStrip live={live} collapse={collapse} reduced={reduced} theme={theme} onPress={resume} style={stripStyle} />
      ) : null}

      <Animated.View style={[s.pill, pillStyle]} pointerEvents={menuOpen ? 'none' : 'box-none'}>
        <TabBarSurface theme={theme} />
        <Animated.View style={[s.track, { width: trackWidth }, trackStyle]} pointerEvents={collapsed ? 'none' : 'box-none'}>
          <View pointerEvents="none" style={s.dropLayer} needsOffscreenAlphaCompositing>
            <Animated.View style={[s.dropPart, { width: indicator.bodyWidth }, indicator.bodyStyle]} />
            <Animated.View style={[s.dropPart, s.dropCap, indicator.capLStyle]} />
            <Animated.View style={[s.dropPart, s.dropCap, indicator.capRStyle]} />
          </View>
          {state.routes.map((route, index) => (isCenterTab(route.name) ? (
            <View key={route.key} style={s.tab} pointerEvents="none" />
          ) : (
            <TabItem
              key={route.key}
              route={route}
              item={getTabBarItem(route.name)}
              focused={active === index}
              reduced={reduced}
              onPress={() => pressTab(route, index)}
              theme={theme}
              s={s}
            />
          )))}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, miniStyle]} pointerEvents={collapsed ? 'auto' : 'none'}>
          <Pressable
            style={s.mini}
            onPress={() => setTabBarCollapsed(false)}
            accessibilityRole="button"
            accessibilityLabel={t('nav.tab.showAll', { tab: activeItem.label })}
            testID="tabbar-show-all"
          >
            <Feather name={active === centerIndex ? 'more-horizontal' : activeItem.icon} size={22} color={theme.accent.primary} />
          </Pressable>
        </Animated.View>
      </Animated.View>

      {/* Outside the pill, which clips: the ball's hop arcs above the bar. */}
      <Animated.View
        pointerEvents="none"
        style={[s.ball, { left: left + TRACK_PAD, bottom: bottom + BAR_HEIGHT - BALL - 4 }, indicator.ballStyle]}
      />

      {centerRoute ? (
        <PlayDisc
          route={centerRoute}
          item={playItem}
          focused={active === centerIndex}
          menuOpen={menuOpen}
          menuMounted={menuMounted}
          style={discStyle}
          faceStyle={discFaceStyle}
          menuStyle={menuFaceStyle}
          onPress={() => pressTab(centerRoute, centerIndex)}
          onLongPress={openMenu}
          theme={theme}
          s={s}
        >
          <PlayQuickMenu
            open={open}
            width={barWidth}
            height={menuHeight}
            live={live}
            quickStart={quickStart}
            theme={theme}
            onClose={() => setMenuOpen(false)}
            onResume={resume}
            onNewGame={() => { setMenuOpen(false); navigation.navigate('Setup', { kind: 'game' }); }}
            onQuickStart={(course) => goHome({ quickStartCourseId: course.id })}
            onOpenPlay={() => goHome()}
          />
        </PlayDisc>
      ) : null}
    </View>
  );
}

function PlayDisc({ route, item, focused, menuOpen, menuMounted, style, faceStyle, menuStyle, onPress, onLongPress, theme, s, children }) {
  const t = useT();
  const tourRef = useTourTarget(TOUR_TARGET_KEYS[route.name] ?? null);
  return (
    <Animated.View style={[s.disc, style]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, s.discFace, faceStyle]} pointerEvents={menuOpen ? 'none' : 'auto'}>
        <Pressable
          ref={tourRef}
          testID={`${route.name}-tab-surface`}
          style={s.discPress}
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={380}
          accessibilityRole="button"
          accessibilityState={focused ? { selected: true } : {}}
          accessibilityLabel={item.label}
          accessibilityHint={t('nav.play.holdHint')}
          accessibilityActions={[{ name: 'longpress', label: t('nav.play.quickActions') }]}
          onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') onLongPress(); }}
        >
          <Feather name={item.icon} size={22} color={theme.text.inverse} />
        </Pressable>
      </Animated.View>
      {menuMounted ? (
        <Animated.View style={[StyleSheet.absoluteFill, menuStyle]} pointerEvents={menuOpen ? 'auto' : 'none'}>
          <TabBarSurface theme={theme} strong />
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function TabItem({ route, item, focused, reduced, onPress, theme, s }) {
  const tourRef = useTourTarget(TOUR_TARGET_KEYS[route.name] ?? null);
  const land = useLandOnFocus(focused, reduced);
  const color = focused ? theme.accent.primary : theme.text.secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={item.label}
      onPress={onPress}
      style={s.tab}
      testID={`${route.name}-tab`}
    >
      <View ref={tourRef} testID={`${route.name}-tab-surface`} style={s.tabInner}>
        <Animated.View style={land}>
          <Feather name={item.icon} size={21} color={color} />
        </Animated.View>
        <Text style={[s.label, { color }]} numberOfLines={1}>{item.label}</Text>
      </View>
    </Pressable>
  );
}

// The drop behind the selected tab (its leading edge springs ahead, the
// trailing one follows) and the ball that hops to it, squashing as it lands
// and vanishing into the Play disc. Both move by transforms only: on Android
// a left / width animation re-lays out every frame and stalls while the
// new tab's screen commits, which made the slide stutter. The drop is two
// round caps and a body stretched between them, so its ends stay round.
function useIndicator({ active, count, slot, centerIndex, reduced, fadeWith }) {
  const place = (i) => ({
    left: i * slot + DROP_INSET,
    right: (count - i - 1) * slot + DROP_INSET,
    ball: i * slot + slot / 2 - BALL / 2,
  });
  const at = place(active);
  const dropL = useSharedValue(at.left);
  const dropR = useSharedValue(at.right);
  const ballX = useSharedValue(at.ball);
  const ballY = useSharedValue(0);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const ballO = useSharedValue(active === centerIndex ? 0 : 1);
  const prev = useRef({ active, slot });

  useEffect(() => {
    const was = prev.current;
    prev.current = { active, slot };
    const to = place(active);
    const toPlay = active === centerIndex;
    if (reduced || was.active === active) {
      dropL.value = to.left;
      dropR.value = to.right;
      ballX.value = to.ball;
      ballO.value = toPlay ? 0 : 1;
      return;
    }
    const right = active > was.active;
    dropL.value = right ? withDelay(50, withSpring(to.left, DROP_TRAIL)) : withSpring(to.left, DROP_LEAD);
    dropR.value = right ? withSpring(to.right, DROP_LEAD) : withDelay(50, withSpring(to.right, DROP_TRAIL));
    ballX.value = withTiming(to.ball, { duration: HOP_MS, easing: Easing.inOut(Easing.quad) });
    ballY.value = withSequence(
      withTiming(-24, { duration: HOP_MS / 2, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: HOP_MS / 2 - 30, easing: Easing.in(Easing.quad) }),
    );
    squashX.value = withSequence(withDelay(HOP_MS - 40, withTiming(1.5, { duration: 50 })), withTiming(1, { duration: 140 }));
    squashY.value = withSequence(withDelay(HOP_MS - 40, withTiming(0.55, { duration: 50 })), withTiming(1, { duration: 140 }));
    ballO.value = toPlay ? withDelay(HOP_MS - 50, withTiming(0, { duration: 100 })) : withTiming(1, { duration: 80 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, count, slot, centerIndex, reduced]);

  const trackWidth = count * slot;
  const bodyWidth = Math.max(slot - DROP_INSET * 2 - DROP_H, 1);
  const capLStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dropL.value }] }));
  const capRStyle = useAnimatedStyle(() => ({ transform: [{ translateX: trackWidth - dropR.value - DROP_H }] }));
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dropL.value + DROP_H / 2 },
      { scaleX: Math.max(trackWidth - dropR.value - dropL.value - DROP_H, 0) / bodyWidth },
    ],
  }));
  const [collapse, open] = fadeWith;
  const ballStyle = useAnimatedStyle(() => ({
    opacity: ballO.value
      * interpolate(collapse.value, [0, 0.3], [1, 0], Extrapolation.CLAMP)
      * interpolate(open.value, [0, 0.3], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: ballX.value },
      { translateY: ballY.value },
      { scaleX: squashX.value },
      { scaleY: squashY.value },
    ],
  }));
  return { capLStyle, capRStyle, bodyStyle, bodyWidth, ballStyle };
}

// The icon of a tab dips as the ball lands on it.
function useLandOnFocus(focused, reduced) {
  const scale = useSharedValue(1);
  const was = useRef(focused);
  useEffect(() => {
    if (focused && !was.current && !reduced) {
      scale.value = withDelay(HOP_MS - 60, withSequence(
        withTiming(0.86, { duration: 90 }),
        withSpring(1, { damping: 9, stiffness: 260, mass: 1 }),
      ));
    }
    was.current = focused;
  }, [focused, reduced, scale]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

// The Play disc gives like a cup as the ball drops in.
function useCupOnFocus(focused, reduced) {
  const scale = useSharedValue(1);
  const was = useRef(focused);
  useEffect(() => {
    if (focused && !was.current && !reduced) {
      scale.value = withDelay(HOP_MS - 30, withSequence(
        withTiming(0.86, { duration: 110 }),
        withSpring(1, { damping: 8, stiffness: 240, mass: 1 }),
      ));
    }
    was.current = focused;
  }, [focused, reduced, scale]);
  return scale;
}

// The drop's pieces overlap, so they paint opaque and the layer carries the
// colour's alpha once (dark theme's accent.light is translucent).
function splitAlpha(color) {
  const m = /^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(String(color).replace(/\s/g, ''));
  return m ? { color: `rgb(${m[1]},${m[2]},${m[3]})`, alpha: Number(m[4]) } : { color, alpha: 1 };
}

function makeStyles(theme) {
  const drop = splitAlpha(theme.accent.light);
  const border = theme.isDark ? theme.glass?.border ?? theme.border.default : 'rgba(0,0,0,0.06)';
  const shadow = {
    shadowColor: '#000',
    shadowOpacity: theme.isDark ? 0.4 : 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  };
  return StyleSheet.create({
    scrim: { backgroundColor: '#000' },
    pill: {
      position: 'absolute',
      overflow: 'hidden',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: border,
      ...shadow,
    },
    track: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: TRACK_PAD,
      flexDirection: 'row',
      transformOrigin: 'left',
    },
    dropLayer: {
      ...StyleSheet.absoluteFillObject,
      opacity: drop.alpha,
    },
    dropPart: {
      position: 'absolute',
      top: DROP_TOP,
      left: 0,
      height: DROP_H,
      transformOrigin: 'left',
      backgroundColor: drop.color,
    },
    dropCap: {
      width: DROP_H,
      borderRadius: DROP_H / 2,
    },
    ball: {
      position: 'absolute',
      width: BALL,
      height: BALL,
      borderRadius: BALL / 2,
      backgroundColor: theme.accent.primary,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabInner: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      paddingTop: 6,
      minHeight: 48,
    },
    label: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 10,
      lineHeight: 12,
    },
    mini: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disc: {
      position: 'absolute',
      overflow: 'hidden',
      shadowColor: theme.isDark ? '#000' : theme.accent.primary,
      shadowOpacity: theme.isDark ? 0.4 : 0.3,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    discFace: {
      backgroundColor: theme.accent.primary,
    },
    discPress: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
