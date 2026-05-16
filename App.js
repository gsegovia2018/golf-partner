import React, { useEffect } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_900Black,
} from '@expo-google-fonts/playfair-display';

import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import LoadingSplash from './src/components/LoadingSplash';
import ErrorBoundary from './src/components/ErrorBoundary';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AuthScreen from './src/screens/AuthScreen';
import SyncStatusIcon from './src/components/SyncStatusIcon';

import { loadTournament, isRoundInProgress, subscribeTournamentChanges } from './src/store/tournamentStore';
import HomeScreen from './src/screens/HomeScreen';
import FeedScreen from './src/screens/FeedScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import RoundSummaryScreen from './src/screens/RoundSummaryScreen';
import SetupScreen from './src/screens/SetupScreen';
import ScorecardScreen from './src/screens/ScorecardScreen';
import NextRoundScreen from './src/screens/NextRoundScreen';
import CourseEditorScreen from './src/screens/CourseEditorScreen';
import EditTournamentScreen from './src/screens/EditTournamentScreen';
import PlayersLibraryScreen from './src/screens/PlayersLibraryScreen';
import CoursesLibraryScreen from './src/screens/CoursesLibraryScreen';
import CourseLibraryDetailScreen from './src/screens/CourseLibraryDetailScreen';
import PlayerPickerScreen from './src/screens/PlayerPickerScreen';
import CoursePickerScreen from './src/screens/CoursePickerScreen';
import StatsScreen from './src/screens/StatsScreen';
import EditTeamsScreen from './src/screens/EditTeamsScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import JoinTournamentScreen from './src/screens/JoinTournamentScreen';
import ClaimPlayerScreen from './src/screens/ClaimPlayerScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MembersScreen from './src/screens/MembersScreen';
import FinishedScreen from './src/screens/FinishedScreen';
import { startUploadWorker } from './src/lib/uploadWorker';
import * as ScreenOrientation from 'expo-screen-orientation';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_META = {
  Feed: { icon: 'rss', label: 'Feed' },
  Home: { icon: 'flag', label: 'Play' },
  History: { icon: 'clock', label: 'History' },
};

// A floating pill-shaped tab bar. It sits in its own layout slot (so it
// never hides screen content) but reads as floating: side margins, a soft
// shadow and a rounded card. The active tab expands into a coloured pill
// that reveals its label; inactive tabs are icon-only.
function FloatingTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = tabBarStyles(theme);

  // Live-round indicator: surface a small dot on the "Play" tab whenever the
  // active tournament has a round in progress, so users on Feed/History know
  // a game is still going. Re-checked on store changes (score entry, etc.).
  const [roundLive, setRoundLive] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      loadTournament()
        .then((t) => { if (!cancelled) setRoundLive(isRoundInProgress(t)); })
        .catch(() => {});
    };
    check();
    const unsub = subscribeTournamentChanges(check);
    return () => { cancelled = true; unsub(); };
  }, []);

  return (
    <View style={[s.slot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={s.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta = TAB_META[route.name] ?? { icon: 'circle', label: route.name };
          const showLiveDot = route.name === 'Home' && roundLive && !focused;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={meta.label}
              onPress={onPress}
              activeOpacity={0.8}
              style={s.tab}
            >
              <View style={[s.pill, focused && s.pillActive]}>
                <View>
                  <Feather
                    name={meta.icon}
                    size={19}
                    color={focused ? theme.text.inverse : theme.text.muted}
                  />
                  {showLiveDot && <View style={s.liveDot} />}
                </View>
                {focused && <Text style={s.pillLabel}>{meta.label}</Text>}
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
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 62,
      paddingHorizontal: 8,
      borderRadius: 30,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark
        ? theme.glass?.border ?? theme.border.default
        : theme.border.default,
      shadowColor: '#000',
      shadowOpacity: theme.isDark ? 0.45 : 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 14,
    },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: 22,
    },
    pillActive: {
      backgroundColor: theme.accent.primary,
      paddingHorizontal: 16,
    },
    pillLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
      color: theme.text.inverse,
    },
    liveDot: {
      position: 'absolute',
      top: -3,
      right: -4,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.accent.primary,
      borderWidth: 1.5,
      borderColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    },
  });
}

// Primary navigation: a bottom bar with the three things the app is for —
// the social Feed, starting/resuming games (Play), and the History archive.
// The "Play" tab keeps the route name "Home" so existing navigate('Home')
// targets still resolve. Detail screens live in the Stack that wraps this.
function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        initialParams={{ viewMode: 'list' }}
      />
      <Tab.Screen name="History" component={HistoryScreen} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { theme, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#006747' }}>
        <ActivityIndicator size="large" color="#ffd700" />
      </View>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + 60,
          right: insets.right + 6,
          zIndex: 1000,
        }}
      >
        <SyncStatusIcon />
      </View>
      <Stack.Navigator
        initialRouteName="Main"
        screenOptions={{
          headerShown: false,
          cardStyle: { flex: 1, backgroundColor: theme.bg.primary },
          cardStyleInterpolator: CardStyleInterpolators.forFadeFromBottomAndroid,
          transitionSpec: {
            open: { animation: 'timing', config: { duration: 250 } },
            close: { animation: 'timing', config: { duration: 200 } },
          },
        }}
      >
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Tournament" component={HomeScreen} initialParams={{ viewMode: 'tournament' }} />
        <Stack.Screen name="Setup" component={SetupScreen} />
        <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS }} />
        <Stack.Screen name="NextRound" component={NextRoundScreen} options={{ transitionSpec: { open: { animation: 'timing', config: { duration: 400 } }, close: { animation: 'timing', config: { duration: 300 } } } }} />
        <Stack.Screen name="CourseEditor" component={CourseEditorScreen} />
        <Stack.Screen name="EditTournament" component={EditTournamentScreen} />
        <Stack.Screen name="PlayersLibrary" component={PlayersLibraryScreen} />
        <Stack.Screen name="CoursesLibrary" component={CoursesLibraryScreen} />
        <Stack.Screen name="CourseLibraryDetail" component={CourseLibraryDetailScreen} />
        <Stack.Screen name="PlayerPicker" component={PlayerPickerScreen} />
        <Stack.Screen name="CoursePicker" component={CoursePickerScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="EditTeams" component={EditTeamsScreen} />
        <Stack.Screen name="Gallery" component={GalleryScreen} />
        <Stack.Screen name="JoinTournament" component={JoinTournamentScreen} />
        <Stack.Screen name="ClaimPlayer" component={ClaimPlayerScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Members" component={MembersScreen} />
        <Stack.Screen name="Finished" component={FinishedScreen} />
        <Stack.Screen name="Friends" component={FriendsScreen} />
        <Stack.Screen name="RoundSummary" component={RoundSummaryScreen} />
      </Stack.Navigator>
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    'PlusJakartaSans-Light': PlusJakartaSans_300Light,
    'PlusJakartaSans-Regular': PlusJakartaSans_400Regular,
    'PlusJakartaSans-Medium': PlusJakartaSans_500Medium,
    'PlusJakartaSans-SemiBold': PlusJakartaSans_600SemiBold,
    'PlusJakartaSans-Bold': PlusJakartaSans_700Bold,
    'PlusJakartaSans-ExtraBold': PlusJakartaSans_800ExtraBold,
    'PlayfairDisplay-Regular': PlayfairDisplay_400Regular,
    'PlayfairDisplay-Bold': PlayfairDisplay_700Bold,
    'PlayfairDisplay-Black': PlayfairDisplay_900Black,
  });

  useEffect(() => { startUploadWorker(); }, []);

  // The app is portrait-first; only the scorecard grid view opts into
  // landscape. Lock portrait at startup so every other screen stays put.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  if (!fontsLoaded) {
    return <LoadingSplash />;
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <ThemeProvider>
          <AuthProvider>
            <NavigationContainer>
              <AppNavigator />
            </NavigationContainer>
          </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
