import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import FloatingTabBar from '../FloatingTabBar';
import { light } from '../../theme/tokens';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');

  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
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
    addListener: jest.fn(() => jest.fn()),
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

  test('uses secondary text color for inactive secondary icons', () => {
    const { UNSAFE_getAllByType } = renderTabBar({ index: 2 });

    const icons = UNSAFE_getAllByType('Feather');
    expect(icons[0].props.color).toBe(light.text.secondary);
  });

  test('reveals a compact label for the selected secondary tab', () => {
    const { getByTestId, getByText, queryByText } = renderTabBar({ index: 1 });
    const activeSurface = StyleSheet.flatten(getByTestId('MyStats-tab-surface').props.style);

    expect(getByText('Stats')).toBeTruthy();
    expect(queryByText('Feed')).toBeNull();
    expect(activeSurface.transform).toEqual([{ translateY: -8 }]);
    expect(activeSurface.height).toBeGreaterThan(46);
  });

  test('routes the center action to Home when no round is live', () => {
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    fireEvent.press(getByLabelText('Play'));

    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  test('changes the center action to Score and routes to Scorecard with round summary as its back target when a round is live', async () => {
    mockLoadTournament.mockResolvedValue({ id: 'tournament-1' });
    mockIsRoundInProgress.mockReturnValue(true);
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    await waitFor(() => expect(getByLabelText('Score')).toBeTruthy());
    fireEvent.press(getByLabelText('Score'));

    expect(navigation.navigate).toHaveBeenCalledWith('Scorecard', { backTarget: 'tournament' });
  });

  test('refreshes the Score action when Play regains focus after being mounted under round summary', async () => {
    let focused = false;
    let focusHandler = null;
    const navigation = makeNavigation();
    navigation.isFocused.mockImplementation(() => focused);
    navigation.addListener.mockImplementation((event, handler) => {
      if (event === 'focus') focusHandler = handler;
      return jest.fn();
    });
    mockLoadTournament.mockResolvedValue({ id: 'tournament-1' });
    mockIsRoundInProgress.mockReturnValue(true);

    const { getByLabelText, queryByLabelText } = renderTabBar({ index: 2, navigation });

    expect(getByLabelText('Play')).toBeTruthy();
    expect(queryByLabelText('Score')).toBeNull();
    expect(mockLoadTournament).not.toHaveBeenCalled();

    focused = true;
    focusHandler();

    await waitFor(() => expect(getByLabelText('Score')).toBeTruthy());
  });

  test('uses the same center colors for Play and Score', async () => {
    const play = renderTabBar({ index: 0 });
    const playSurface = StyleSheet.flatten(play.getByTestId('Home-tab-surface').props.style);
    const playIcon = play.UNSAFE_getAllByType('Feather')
      .find((icon) => icon.props.name === 'flag');
    const playLabel = StyleSheet.flatten(play.getByText('Play').props.style);

    expect(playSurface.backgroundColor).toBe(light.accent.primary);
    expect(playIcon.props.color).toBe(light.text.inverse);
    expect(playLabel.color).toBe(light.text.inverse);
    play.unmount();

    mockLoadTournament.mockResolvedValue({ id: 'tournament-1' });
    mockIsRoundInProgress.mockReturnValue(true);
    const score = renderTabBar({ index: 0 });

    await waitFor(() => expect(score.getByLabelText('Score')).toBeTruthy());
    const scoreSurface = StyleSheet.flatten(score.getByTestId('Home-tab-surface').props.style);
    const scoreIcon = score.UNSAFE_getAllByType('Feather')
      .find((icon) => icon.props.name === 'clipboard');
    const scoreLabel = StyleSheet.flatten(score.getByText('Score').props.style);

    expect(scoreSurface.backgroundColor).toBe(light.accent.primary);
    expect(scoreIcon.props.color).toBe(light.text.inverse);
    expect(scoreLabel.color).toBe(light.text.inverse);
  });
});
