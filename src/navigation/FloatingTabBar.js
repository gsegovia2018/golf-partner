import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';
import { loadTournament, isRoundInProgress, subscribeTournamentChanges } from '../store/tournamentStore';
import { getTabBarItem, isCenterTab } from './tabBarModel';

export default function FloatingTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => tabBarStyles(theme), [theme]);
  const [roundLive, setRoundLive] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      loadTournament()
        .then((t) => {
          if (!cancelled) setRoundLive(isRoundInProgress(t));
        })
        .catch(() => {});
    };

    check();
    const unsub = subscribeTournamentChanges(check);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigation]);

  return (
    <View style={[styles.slot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const item = getTabBarItem(route.name, { roundLive });
          const center = isCenterTab(route.name);
          const secondaryFocused = !center && focused;
          const selected = focused && (!center || !item.live);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!event.defaultPrevented && (!focused || item.targetRouteName !== route.name)) {
              navigation.navigate(item.targetRouteName);
            }
          };

          const iconColor = center
            ? item.live
              ? theme.masters.yellow
              : theme.text.inverse
            : focused
              ? theme.accent.primary
              : theme.text.secondary;

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={selected ? { selected: true } : {}}
              accessibilityLabel={item.label}
              onPress={onPress}
              activeOpacity={0.82}
              style={[styles.tab, center && styles.centerTab]}
            >
              <View
                testID={`${route.name}-tab-surface`}
                style={[
                  center ? styles.centerButton : styles.secondaryButton,
                  center && item.live && styles.centerButtonLive,
                  secondaryFocused && styles.secondaryButtonActive,
                ]}
              >
                <MaterialCommunityIcons name={item.icon} size={center ? 25 : secondaryFocused ? 20 : 22} color={iconColor} />
                {center && <Text style={[styles.centerLabel, item.live && styles.centerLabelLive]}>{item.label}</Text>}
                {secondaryFocused && <Text style={styles.secondaryLabel}>{item.label}</Text>}
              </View>
            </TouchableOpacity>
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
      minHeight: 68,
      paddingHorizontal: 8,
      borderRadius: 22,
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
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerTab: {
      minHeight: 76,
    },
    secondaryButton: {
      width: 46,
      height: 46,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonActive: {
      width: 58,
      height: 52,
      borderRadius: 18,
      gap: 1,
      backgroundColor: theme.accent.light,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border ?? theme.border.default : 'rgba(0,103,71,0.14)',
      shadowColor: theme.accent.primary,
      shadowOpacity: theme.isDark ? 0.14 : 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
      transform: [{ translateY: -8 }],
    },
    centerButton: {
      width: 68,
      height: 68,
      marginTop: -26,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: theme.accent.primary,
      borderWidth: 3,
      borderColor: theme.bg.primary,
      shadowColor: theme.accent.primary,
      shadowOpacity: theme.isDark ? 0.25 : 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 16,
    },
    centerButtonLive: {
      backgroundColor: theme.isDark ? theme.bg.primary : '#14231d',
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.5 : 0.22,
    },
    centerLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 10,
      lineHeight: 12,
      color: theme.text.inverse,
    },
    centerLabelLive: {
      color: theme.masters.yellow,
    },
    secondaryLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 10,
      lineHeight: 12,
      color: theme.accent.primary,
    },
  });
}
