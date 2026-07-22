import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
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
import OnboardingScreen from './src/screens/OnboardingScreen';
import { loadProfile } from './src/store/profileStore';
import { isBootRevealed, subscribeBootReveal, markBootReady } from './src/store/bootReveal';
import SetNewPasswordScreen from './src/screens/SetNewPasswordScreen';
import JoinTournamentLinkScreen from './src/screens/JoinTournamentLinkScreen';

import FloatingTabBar from './src/navigation/FloatingTabBar';
import { TAB_ROUTE_NAMES } from './src/navigation/tabBarModel';
import HomeScreen from './src/screens/HomeScreen';
import FeedScreen from './src/screens/FeedScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import RoundSummaryScreen from './src/screens/RoundSummaryScreen';
import SetupScreen from './src/screens/SetupScreen';
import ScorecardScreen from './src/screens/ScorecardScreen';
import NextRoundScreen from './src/screens/NextRoundScreen';
import CourseEditorScreen from './src/screens/CourseEditorScreen';
import EditTournamentScreen from './src/screens/EditTournamentScreen';
import OfficialCreateScreen from './src/screens/OfficialCreateScreen';
import OfficialSetupScreen from './src/screens/OfficialSetupScreen';
import PartyBoardScreen from './src/screens/PartyBoardScreen';
import OfficialAdminScreen from './src/screens/OfficialAdminScreen';
import JoinOfficialScreen from './src/screens/JoinOfficialScreen';
import PlayersLibraryScreen from './src/screens/PlayersLibraryScreen';
import CoursesLibraryScreen from './src/screens/CoursesLibraryScreen';
import CourseLibraryDetailScreen from './src/screens/CourseLibraryDetailScreen';
import PlayerPickerScreen from './src/screens/PlayerPickerScreen';
import CoursePickerScreen from './src/screens/CoursePickerScreen';
import StatsScreen from './src/screens/StatsScreen';
import MyStatsScreen from './src/screens/MyStatsScreen';
import CourseStatsScreen from './src/screens/CourseStatsScreen';
import EditTeamsScreen from './src/screens/EditTeamsScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import JoinTournamentScreen from './src/screens/JoinTournamentScreen';
import ClaimPlayerScreen from './src/screens/ClaimPlayerScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BagScreen from './src/screens/BagScreen';
import PlayersScreen from './src/screens/PlayersScreen';
import FinishedScreen from './src/screens/FinishedScreen';
import { startUploadWorker } from './src/lib/uploadWorker';
import { initDeviceAuthorId } from './src/store/deviceId';
import { hydrateCourseGeometry } from './src/store/courseGeometryStore';
import { hydrateShots } from './src/store/shotStore';
import { hydrateAppSettings } from './src/store/settingsStore';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';
import { registerPushToken, configureNotificationHandler } from './src/lib/pushNotifications';
import { normalizeDeepLink } from './src/lib/notificationContent';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const navigationRef = createNavigationContainerRef();

// Set the foreground notification handler once, at module load.
configureNotificationHandler();

const TAB_SCREENS = {
  Feed: { component: FeedScreen },
  MyStats: { component: MyStatsScreen, initialParams: { presentation: 'tab' } },
  Home: { component: HomeScreen, initialParams: { viewMode: 'list' } },
  History: { component: HistoryScreen },
  Profile: { component: ProfileScreen, initialParams: { presentation: 'tab' } },
};

// Primary navigation: Feed, personal Stats, the raised Play action, History,
// and Profile. The center route keeps the name "Home" so existing
// navigate('Home') targets still resolve; it always lands on Home — the
// live-round banner there is the way back into an in-progress scorecard.
function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      {TAB_ROUTE_NAMES.map((routeName) => {
        const screen = TAB_SCREENS[routeName];
        return (
          <Tab.Screen
            key={routeName}
            name={routeName}
            component={screen.component}
            initialParams={screen.initialParams}
          />
        );
      })}
    </Tab.Navigator>
  );
}

// Matches both the App Link URL (https://golf-partner.vercel.app/join-tournament/CODE)
// and the custom-scheme deep link (golf://join-tournament/CODE) used when the app
// catches an invite. Web reads it sync from window.location; native reads it
// async from Linking.getInitialURL so the auth gate can route logged-out
// scanners to the guest/login choice instead of the bare sign-up wall.
function matchesJoinLink(url) {
  if (!url) return false;
  if (/^golf:\/\/join-tournament\/[^/?#]+/i.test(url)) return true;
  try {
    return /^\/join-tournament\/[^/]+/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function AppNavigator() {
  const { theme, mode } = useTheme();
  const { session, loading, passwordRecovery } = useAuth();
  // null = "not resolved yet" (native cold-start); avoids a flash of AuthScreen
  // before getInitialURL settles. On web we read it synchronously up front.
  const [isJoinLink, setIsJoinLink] = useState(() => {
    if (typeof window !== 'undefined' && window.location) {
      return /^\/join-tournament\/[^/]+/.test(window.location.pathname);
    }
    return null;
  });

  useEffect(() => {
    if (isJoinLink !== null) return;
    let cancelled = false;
    Linking.getInitialURL().then((url) => {
      if (!cancelled) setIsJoinLink(matchesJoinLink(url));
    }).catch(() => { if (!cancelled) setIsJoinLink(false); });
    return () => { cancelled = true; };
  }, [isJoinLink]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (matchesJoinLink(url)) setIsJoinLink(true);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Local mirror loads even signed-out; server reconcile happens once a
    // session exists (hydrateAppSettings no-ops server-side without a user).
    hydrateAppSettings();
    if (session) registerPushToken();
  }, [session]);

  // First-run gate for FRESH SIGN-UPS only: the signup trigger creates the
  // profile row with just display_name, so a missing username means the
  // account never went through onboarding. Legacy accounts all had usernames
  // backfilled (20260419120005), so they sign in straight through even if
  // gender is unset — ProfileScreen still enforces gender on save. Anonymous
  // guests (join links) never onboard. null = still checking, false = clear,
  // a profile object = onboarding needed. Keyed on the user id, not the
  // session object, so token refreshes don't re-trigger the check. A failed
  // load (offline cold start) skips the gate rather than locking the user out.
  const userId = session?.user?.id ?? null;
  const isAnonUser = !!session?.user?.is_anonymous;
  const [onboarding, setOnboarding] = useState(null);
  useEffect(() => {
    if (!userId || isAnonUser) { setOnboarding(userId ? false : null); return undefined; }
    let cancelled = false;
    loadProfile()
      .then((p) => { if (!cancelled) setOnboarding(p?.username ? false : (p ?? {})); })
      .catch(() => { if (!cancelled) setOnboarding(false); });
    return () => { cancelled = true; };
  }, [userId, isAnonUser]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.screen && navigationRef.isReady()) {
        // Legacy pushes carry a bare 'Home' target the root navigator can't
        // resolve — normalize to the nested form before navigating.
        const link = normalizeDeepLink(data);
        navigationRef.navigate(link.screen, link.params);
      }
    });
    return () => sub.remove();
  }, []);

  if (loading || isJoinLink === null) {
    return <LoadingSplash />;
  }

  // A password-recovery link takes priority over both the signed-out and
  // signed-in screens — it can arrive on a device that's already logged in
  // (a different session than the one being reset) as easily as a fresh
  // cold start. See AuthContext's PASSWORD_RECOVERY / deep-link handling.
  if (passwordRecovery) return <SetNewPasswordScreen />;

  if (!session) {
    // A logged-out scanner of a /join-tournament/<code> link gets the
    // guest/login choice instead of the bare sign-up wall. Once a session
    // (anonymous or otherwise) is established, the Stack mounts and the
    // linking config routes the same URL to the JoinTournament screen.
    if (isJoinLink) return <JoinTournamentLinkScreen />;
    return <AuthScreen />;
  }

  if (onboarding === null) {
    return <LoadingSplash />;
  }
  if (onboarding) {
    return (
      <OnboardingScreen
        profile={onboarding}
        onDone={() => setOnboarding(false)}
      />
    );
  }

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
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
        <Stack.Screen name="ResetPassword" component={SetNewPasswordScreen} />{/* also short-circuited to directly above AppNavigator's session gate — registered here too so an in-app navigate('ResetPassword') still resolves */}
        <Stack.Screen name="Tournament" component={HomeScreen} initialParams={{ viewMode: 'tournament' }} />
        <Stack.Screen name="Setup" component={SetupScreen} />
        <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS }} />
        <Stack.Screen name="NextRound" component={NextRoundScreen} options={{ transitionSpec: { open: { animation: 'timing', config: { duration: 400 } }, close: { animation: 'timing', config: { duration: 300 } } } }} />
        <Stack.Screen name="CourseEditor" component={CourseEditorScreen} />
        <Stack.Screen name="EditTournament" component={EditTournamentScreen} />
        <Stack.Screen name="OfficialCreate" component={OfficialCreateScreen} />{/* stepped wizard — creates an official tournament, then navigates to OfficialSetup */}
        <Stack.Screen name="OfficialSetup" component={OfficialSetupScreen} />{/* management screen — reached with { tournamentId } param after wizard creates */}
        <Stack.Screen name="PartyBoard" component={PartyBoardScreen} />
        <Stack.Screen name="OfficialAdmin" component={OfficialAdminScreen} />
        <Stack.Screen name="JoinOfficial" component={JoinOfficialScreen} />
        <Stack.Screen name="PlayersLibrary" component={PlayersLibraryScreen} />
        <Stack.Screen name="CoursesLibrary" component={CoursesLibraryScreen} />
        <Stack.Screen name="CourseLibraryDetail" component={CourseLibraryDetailScreen} />
        <Stack.Screen name="PlayerPicker" component={PlayerPickerScreen} />
        <Stack.Screen name="CoursePicker" component={CoursePickerScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="MyStats" component={MyStatsScreen} />
        <Stack.Screen name="CourseStats" component={CourseStatsScreen} />
        <Stack.Screen name="EditTeams" component={EditTeamsScreen} />
        <Stack.Screen name="Gallery" component={GalleryScreen} />
        <Stack.Screen name="JoinTournament" component={JoinTournamentScreen} />
        <Stack.Screen name="ClaimPlayer" component={ClaimPlayerScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Bag" component={BagScreen} />
        <Stack.Screen name="Players" component={PlayersScreen} />
        <Stack.Screen name="Finished" component={FinishedScreen} />
        <Stack.Screen name="Friends" component={FriendsScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="RoundSummary" component={RoundSummaryScreen} />
      </Stack.Navigator>
      <BootSplashOverlay />
    </>
  );
}

// Keeps the boot splash covering the freshly-mounted app shell (tab bar
// included) until the first meaningful screen has content, then fades it out
// once. Without this the splash drops the moment the navigator mounts, and
// cold start reads as splash → empty shell → content. HomeScreen fires
// markBootReady() when its initial load lands; the failsafe guarantees the
// splash can never strand the user on a green screen.
function BootSplashOverlay() {
  const [visible, setVisible] = useState(() => !isBootRevealed());
  const [interactive, setInteractive] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return undefined;
    const reveal = () => {
      setInteractive(false);
      Animated.timing(opacity, {
        toValue: 0, duration: 250, useNativeDriver: true,
        easing: Easing.bezier(0.23, 1, 0.32, 1),
      }).start(() => setVisible(false));
    };
    const unsubscribe = subscribeBootReveal(reveal);
    const failsafe = setTimeout(markBootReady, 6000);
    return () => { unsubscribe(); clearTimeout(failsafe); };
  }, [visible, opacity]);

  if (!visible) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity, zIndex: 999, elevation: 999 }]}
      pointerEvents={interactive ? 'auto' : 'none'}
    >
      <LoadingSplash />
    </Animated.View>
  );
}

// Deep-link config: maps web URL paths to routes so invite links open the
// right flow directly. `join/:token` → official magic-token redeem;
// `join-tournament/:code` → casual shared-invite redeem + claim;
// `reset-password` → the set-new-password screen (also short-circuited in
// AppNavigator via the passwordRecovery flag, which is the primary path —
// this mapping just makes the deep link literally resolvable).
const linking = {
  prefixes: [
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://golf-partner.vercel.app',
    // Native custom scheme so `golf://reset-password` resolves through the
    // navigator too, not only the manual recovery routing in AuthContext.
    'golf://',
  ],
  config: {
    // Anchor deep-linked screens on top of Main so they always have a screen
    // to return to. Without this, opening /join-tournament/:code builds a
    // single-entry stack — and the post-join navigation.goBack() (e.g. after
    // claiming a player on ClaimPlayer) silently fails, leaving the screen
    // mounted with its spinner stuck forever.
    initialRouteName: 'Main',
    screens: {
      JoinOfficial: 'join/:token',
      JoinTournament: 'join-tournament/:code',
      ResetPassword: 'reset-password',
    },
  },
};

export default function App() {
  // Hydrate the persisted, stable device author id BEFORE any scoring UI can
  // mount. getDeviceAuthorId() (used for score stamping on unclaimed
  // devices) returns null until this resolves — awaiting it here, alongside
  // the fonts gate, guarantees the sync getter is always safe by the time
  // ScorecardScreen renders. See src/store/deviceId.js.
  const [deviceIdReady, setDeviceIdReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    initDeviceAuthorId().finally(() => { if (!cancelled) setDeviceIdReady(true); });
    // Non-blocking: GPS geometry starts from the bundled seed and upgrades to
    // live table data whenever this resolves. Not part of the render gate.
    hydrateCourseGeometry();
    // Personal GPS shot log — cache-first, upgrades to Supabase. Non-blocking.
    hydrateShots();
    return () => { cancelled = true; };
  }, []);

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

  if (!fontsLoaded || !deviceIdReady) {
    return <LoadingSplash />;
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ErrorBoundary>
        <ThemeProvider>
          <AuthProvider>
            <NavigationContainer
              linking={linking}
              ref={navigationRef}
              documentTitle={{ formatter: () => 'Golf Partner' }}
            >
              <AppNavigator />
            </NavigationContainer>
          </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
