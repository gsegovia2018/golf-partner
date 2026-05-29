import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import FloatingTabBar from '../FloatingTabBar';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');

  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const mockLoadTournament = jest.fn();
const mockIsRoundInProgress = jest.fn();
const mockSubscribeTournamentChanges = jest.fn(() => jest.fn());

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: (...args) => mockLoadTournament(...args),
  isRoundInProgress: (...args) => mockIsRoundInProgress(...args),
  subscribeTournamentChanges: (...args) => mockSubscribeTournamentChanges(...args),
}));

function makeState(index = 2) {
  const names = ['Feed', 'MyStats', 'Home', 'History', 'Profile'];
  return {
    index,
    routes: names.map((name) => ({ key: `${name}-key`, name })),
  };
}

function makeNavigation() {
  return {
    emit: jest.fn(() => ({ defaultPrevented: false })),
    navigate: jest.fn(),
    isFocused: jest.fn(() => true),
  };
}

function renderTabBar({ index = 2, navigation = makeNavigation() } = {}) {
  const state = makeState(index);
  const result = render(
    <SafeAreaProvider>
      <ThemeProvider>
        <FloatingTabBar state={state} navigation={navigation} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return { ...result, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.getItem.mockReturnValue(new Promise(() => {}));
  mockLoadTournament.mockResolvedValue({});
  mockIsRoundInProgress.mockReturnValue(false);
});

describe('FloatingTabBar', () => {
  test('renders the five approved navbar destinations as accessible buttons', () => {
    const { getByLabelText } = renderTabBar();

    expect(getByLabelText('Feed')).toBeTruthy();
    expect(getByLabelText('Stats')).toBeTruthy();
    expect(getByLabelText('Play')).toBeTruthy();
    expect(getByLabelText('History')).toBeTruthy();
    expect(getByLabelText('Profile')).toBeTruthy();
  });

  test('routes secondary tabs by their tab route names', () => {
    const { getByLabelText, navigation } = renderTabBar();

    fireEvent.press(getByLabelText('Stats'));
    fireEvent.press(getByLabelText('Profile'));

    expect(navigation.navigate).toHaveBeenCalledWith('MyStats');
    expect(navigation.navigate).toHaveBeenCalledWith('Profile');
  });

  test('routes the center action to Home when no round is live', () => {
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    fireEvent.press(getByLabelText('Play'));

    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  test('changes the center action to Score and routes to Scorecard when a round is live', async () => {
    mockLoadTournament.mockResolvedValue({ id: 'tournament-1' });
    mockIsRoundInProgress.mockReturnValue(true);
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    await waitFor(() => expect(getByLabelText('Score')).toBeTruthy());
    fireEvent.press(getByLabelText('Score'));

    expect(navigation.navigate).toHaveBeenCalledWith('Scorecard');
  });
});
