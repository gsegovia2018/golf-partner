import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

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

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#070d15',
            shadowColor: 'transparent',
            elevation: 0,
            borderBottomWidth: 1,
            borderBottomColor: '#1c3250',
          },
          headerTintColor: '#4ade80',
          headerTitleStyle: { fontWeight: '700', color: '#f1f5f9', fontSize: 17 },
          cardStyle: { backgroundColor: '#070d15' },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Golf' }} />
        <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'New Tournament' }} />
        <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ title: 'Scorecard' }} />
        <Stack.Screen name="NextRound" component={NextRoundScreen} options={{ title: 'Next Round' }} />
        <Stack.Screen name="CourseEditor" component={CourseEditorScreen} options={{ title: 'Configure Holes' }} />
        <Stack.Screen name="EditTournament" component={EditTournamentScreen} options={{ title: 'Edit Tournament' }} />
        <Stack.Screen name="PlayersLibrary" component={PlayersLibraryScreen} options={{ title: 'Players Library' }} />
        <Stack.Screen name="CoursesLibrary" component={CoursesLibraryScreen} options={{ title: 'Courses Library' }} />
        <Stack.Screen name="CourseLibraryDetail" component={CourseLibraryDetailScreen} options={{ title: 'Edit Course' }} />
        <Stack.Screen name="PlayerPicker" component={PlayerPickerScreen} options={{ title: 'Pick Player' }} />
        <Stack.Screen name="CoursePicker" component={CoursePickerScreen} options={{ title: 'Pick Course' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
