import React from 'react';
import { View, StyleSheet, Pressable, Text, Animated, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import ScorecardScreen from '../screens/ScorecardScreen';
import { useTheme } from '../theme/ThemeContext';
import { useActiveTournament } from '../store/useActiveTournament';
import { isRoundInProgress } from '../store/tournamentStore';
import { typography, spacing, radius } from '../theme/tokens';

const Tab = createBottomTabNavigator();

function HomeListTab(props) {
  return <HomeScreen {...props} viewMode="list" />;
}
function HomeTournamentTab(props) {
  return <HomeScreen {...props} viewMode="tournament" />;
}

function TabBar({ state, descriptors, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const fade = React.useRef(new Animated.Value(1)).current;
  const visibleCount = state.routes.filter((r) => !descriptors[r.key].options.tabBarHidden).length;
  const prevCount = React.useRef(visibleCount);

  React.useEffect(() => {
    if (prevCount.current !== visibleCount) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      prevCount.current = visibleCount;
    }
  }, [visibleCount, fade]);

  const s = makeBarStyles(theme);

  return (
    <Animated.View
      style={[
        s.bar,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          opacity: fade,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        if (options.tabBarHidden) return null;
        const focused = state.index === index;
        const iconName = options.tabBarIconName;
        const label = options.tabBarLabel ?? route.name;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityLabel={`${label} tab`}
            accessibilityState={focused ? { selected: true } : {}}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={({ pressed }) => [s.tab, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[s.iconWrap, focused && s.iconWrapActive]}>
              <Feather name={iconName} size={18} color={focused ? (theme.isDark ? theme.accent.primary : '#ffffff') : theme.text.muted} />
            </View>
            <Text style={[s.label, focused && s.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

export default function MainTabs() {
  const { tournament } = useActiveTournament();
  const showTournament = !!tournament;
  const showScorecard = isRoundInProgress(tournament);

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen
        name="Home"
        component={HomeListTab}
        options={{ tabBarLabel: 'Home', tabBarIconName: 'home' }}
      />
      <Tab.Screen
        name="Tournament"
        component={HomeTournamentTab}
        options={{ tabBarLabel: 'Tournament', tabBarIconName: 'flag', tabBarHidden: !showTournament }}
      />
      <Tab.Screen
        name="ScorecardTab"
        component={ScorecardScreen}
        options={{ tabBarLabel: 'Scorecard', tabBarIconName: 'edit-3', tabBarHidden: !showScorecard }}
      />
    </Tab.Navigator>
  );
}

const makeBarStyles = (t) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: t.isDark ? t.bg.primary : '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.isDark ? t.border.default : '#ece8e1',
    paddingTop: 8,
    ...(t.isDark ? {} : {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowOffset: { width: 0, height: -2 },
      shadowRadius: 8,
      elevation: 8,
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    minHeight: 48,
  },
  iconWrap: {
    width: 40,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  iconWrapActive: {
    backgroundColor: t.isDark ? t.accent.light : t.accent.primary,
  },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
    letterSpacing: 0.3,
    color: t.text.muted,
    textAlign: 'center',
  },
  labelActive: {
    color: t.accent.primary,
  },
});
