import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { CONTENT_MAX_WIDTH } from '../theme/responsive';
import { loadTournament, isRoundInProgress, subscribeTournamentChanges } from '../store/tournamentStore';
import { shouldHandleStoreChange } from '../lib/navigationFocus';
import { getTabBarItem, isCenterTab } from './tabBarModel';
import PressableScale from '../components/ui/PressableScale';
import TabBarFade from './TabBarFade';

export default function FloatingTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => tabBarStyles(theme), [theme]);
  const [roundLive, setRoundLive] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (!shouldHandleStoreChange(navigation)) return;
      loadTournament({ refreshRemote: false, resolveIdentity: false })
        .then((t) => {
          if (!cancelled) setRoundLive(isRoundInProgress(t));
        })
        .catch(() => {});
    };

    check();
    const unsub = subscribeTournamentChanges(check);
    const unsubFocus = typeof navigation.addListener === 'function'
      ? navigation.addListener('focus', check)
      : () => {};
    return () => {
      cancelled = true;
      unsub();
      unsubFocus();
    };
  }, [navigation]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.slot, { paddingBottom: Math.max(insets.bottom, 12) }]}
    >
      <TabBarFade />
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const item = getTabBarItem(route.name, { roundLive });
          const center = isCenterTab(route.name);
          const selected = focused && (!center || !item.live);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!event.defaultPrevented && (!focused || item.targetRouteName !== route.name)) {
              if (item.live && item.targetRouteName === 'Scorecard') {
                navigation.navigate(item.targetRouteName, { backTarget: 'tournament' });
                return;
              }
              navigation.navigate(item.targetRouteName);
            }
          };

          const iconColor = center
            ? theme.text.inverse
            : focused
              ? theme.accent.primary
              : theme.text.muted;

          return (
            <PressableScale
              key={route.key}
              accessibilityRole="button"
              accessibilityState={selected ? { selected: true } : {}}
              accessibilityLabel={item.label}
              onPress={onPress}
              activeScale={0.97}
              style={[styles.tab, center && styles.centerTab]}
            >
              <View
                testID={`${route.name}-tab-surface`}
                style={center ? styles.centerButton : styles.secondaryButton}
              >
                <Feather name={item.icon} size={center ? 24 : 21} color={iconColor} />
                {!center && (
                  <Text style={[styles.secondaryLabel, focused && styles.secondaryLabelActive]}>
                    {item.label}
                  </Text>
                )}
              </View>
            </PressableScale>
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
      gap: 3,
      paddingVertical: 2,
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
