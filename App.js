import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AuthScreen from './src/screens/AuthScreen';

import HomeScreen from './src/screens/HomeScreen';
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
import JoinTournamentScreen from './src/screens/JoinTournamentScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MembersScreen from './src/screens/MembersScreen';

const Stack = createStackNavigator();

function AppNavigator() {
  const { theme, mode } = useTheme();
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
      <Stack.Navigator
        initialRouteName="Home"
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
        <Stack.Screen name="Home" component={HomeScreen} initialParams={{ viewMode: 'list' }} />
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
        <Stack.Screen name="JoinTournament" component={JoinTournamentScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Members" component={MembersScreen} />
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

  if (!fontsLoaded) {
    return <LoadingSplash />;
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
