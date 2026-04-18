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
  const routeCount = state.routes.length;
  const prevCount = React.useRef(routeCount);

  React.useEffect(() => {
    if (prevCount.current !== routeCount) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      prevCount.current = routeCount;
    }
  }, [routeCount, fade]);

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          backgroundColor: theme.bg.card,
          borderTopColor: theme.border.default,
          paddingBottom: insets.bottom,
          opacity: fade,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const iconName = options.tabBarIconName;
        const label = options.tabBarLabel ?? route.name;
        const color = focused ? theme.accent.primary : theme.text.muted;

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
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View
              style={[
                styles.iconPill,
                focused && { backgroundColor: theme.accent.light },
              ]}
            >
              <Feather name={iconName} size={20} color={color} />
            </View>
            <Text style={[styles.label, typography.caption, { color }]}>{label}</Text>
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
      {showTournament && (
        <Tab.Screen
          name="Tournament"
          component={HomeTournamentTab}
          options={{ tabBarLabel: 'Tournament', tabBarIconName: 'flag' }}
        />
      )}
      {showScorecard && (
        <Tab.Screen
          name="Scorecard"
          component={ScorecardScreen}
          options={{ tabBarLabel: 'Scorecard', tabBarIconName: 'edit-3' }}
        />
      )}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: spacing.xs,
    ...Platform.select({
      ios: {},
      android: { elevation: 0 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  iconPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  label: {
    textAlign: 'center',
  },
});
