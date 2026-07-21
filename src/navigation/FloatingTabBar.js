import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';
import { getTabBarItem, isCenterTab } from './tabBarModel';
import PressableScale from '../components/ui/PressableScale';
import TabBarFade from './TabBarFade';
import { haptic } from '../lib/haptics';
import { useTourTarget } from '../components/tour/tourTargets';

// Route name → tour target key; History deliberately has no stop.
const TOUR_TARGET_KEYS = {
  Home: 'tab-play', MyStats: 'tab-stats', Feed: 'tab-feed', Profile: 'tab-profile',
};

// Springs the tab surface from slightly-shrunk to full size whenever the tab
// becomes the selected one, so switching tabs visibly "pops" the destination.
function usePopOnFocus(focused) {
  const reduced = useReducedMotion();
  const scale = React.useRef(new Animated.Value(1)).current;
  const wasFocused = React.useRef(focused);

  React.useEffect(() => {
    if (focused && !wasFocused.current && !reduced) {
      scale.setValue(0.8);
      Animated.spring(scale, {
        toValue: 1,
        speed: 22,
        bounciness: 9,
        useNativeDriver: true,
      }).start();
    }
    wasFocused.current = focused;
  }, [focused, reduced, scale]);

  return scale;
}

function TabItem({ route, item, center, focused, onPress, theme, styles }) {
  const scale = usePopOnFocus(focused);
  const tourRef = useTourTarget(TOUR_TARGET_KEYS[route.name] ?? null);
  const iconColor = center
    ? theme.text.inverse
    : focused
      ? theme.accent.primary
      : theme.text.muted;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={item.label}
      onPress={onPress}
      activeScale={0.97}
      style={[styles.tab, center && styles.centerTab]}
    >
      <Animated.View
        ref={tourRef}
        testID={`${route.name}-tab-surface`}
        style={[
          center ? styles.centerButton : styles.secondaryButton,
          { transform: [{ scale }] },
        ]}
      >
        {center ? (
          <Feather name={item.icon} size={24} color={iconColor} />
        ) : (
          <>
            <View
              testID={`${route.name}-tab-icon-wrap`}
              style={[styles.iconWrap, focused && styles.iconWrapActive]}
            >
              <Feather name={item.icon} size={21} color={iconColor} />
            </View>
            <Text style={[styles.secondaryLabel, focused && styles.secondaryLabelActive]}>
              {item.label}
            </Text>
          </>
        )}
      </Animated.View>
    </PressableScale>
  );
}

export default function FloatingTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => tabBarStyles(theme), [theme]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.slot, { paddingBottom: Math.max(insets.bottom, 12) }]}
    >
      <TabBarFade />
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const item = getTabBarItem(route.name);
          const center = isCenterTab(route.name);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!event.defaultPrevented && !focused) {
              haptic('selection');
              navigation.navigate(item.targetRouteName);
            }
          };

          return (
            <TabItem
              key={route.key}
              route={route}
              item={item}
              center={center}
              focused={focused}
              onPress={onPress}
              theme={theme}
              styles={styles}
            />
          );
        })}
      </View>
    </View>
  );
}

function tabBarStyles(theme) {
  return StyleSheet.create({
    slot: {
      backgroundColor: theme.bg.primary,
      paddingHorizontal: 20,
      paddingTop: 18,
    },
    bar: {
      flexDirection: 'row',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'space-around',
      minHeight: 64,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.isDark ? theme.bg.elevated : 'rgba(255,255,255,0.96)',
      borderWidth: 1,
      borderColor: theme.isDark
        ? theme.glass?.border ?? theme.border.default
        : theme.border.default,
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.42 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 14,
      overflow: 'visible',
    },
    tab: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerTab: {
      minHeight: 60,
    },
    secondaryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapActive: {
      backgroundColor: theme.accent.light,
    },
    centerButton: {
      width: 62,
      height: 62,
      marginTop: -34,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent.primary,
      borderWidth: 4,
      borderColor: theme.bg.primary,
      shadowColor: theme.accent.primary,
      shadowOpacity: theme.isDark ? 0.25 : 0.35,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 7 },
      elevation: 16,
    },
    secondaryLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 9,
      lineHeight: 11,
      color: theme.text.muted,
    },
    secondaryLabelActive: {
      color: theme.accent.primary,
    },
  });
}
