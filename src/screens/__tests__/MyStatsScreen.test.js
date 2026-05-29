import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import MyStatsScreen from '../MyStatsScreen';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');

  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/tournamentStore', () => ({
  loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({ list: [{}] })),
}));

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ displayName: 'Marco', targetHandicap: 14 })),
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/personalStats', () => ({
  collectMyRounds: jest.fn(() => [{ key: 'round-1', label: 'Round 1' }]),
  resolveSelection: jest.fn((rounds) => rounds),
  computeMyStats: jest.fn(() => ({ rounds: [] })),
}));

jest.mock('../../store/roundReportCard', () => ({
  buildRoundReportCard: jest.fn(() => ({ title: 'Round 1' })),
}));

jest.mock('../../components/RoundReportCard', () => function MockRoundReportCard() {
  const { Text } = require('react-native');
  return <Text>Report card content</Text>;
});

jest.mock('../../components/MyStatsRoundSelector', () => function MockMyStatsRoundSelector() {
  return null;
});

jest.mock('../../components/StatDetailSheet', () => function MockStatDetailSheet() {
  return null;
});

jest.mock('../../components/mystats/TargetHandicapPicker', () => ({
  TargetHandicapPicker: function MockTargetHandicapPicker() {
    return null;
  },
}));

jest.mock('../../components/mystats/tabs/OverviewTab', () => function MockOverviewTab() {
  const { Text } = require('react-native');
  return <Text>Overview content</Text>;
});

jest.mock('../../components/mystats/tabs/FormTab', () => function MockFormTab() {
  const { Text } = require('react-native');
  return <Text>Form content</Text>;
});

jest.mock('../../components/mystats/tabs/BreakdownTab', () => function MockBreakdownTab() {
  const { Text } = require('react-native');
  return <Text>Breakdown content</Text>;
});

jest.mock('../../components/mystats/tabs/ShotsTab', () => function MockShotsTab() {
  const { Text } = require('react-native');
  return <Text>Shots content</Text>;
});

beforeEach(() => {
  AsyncStorage.getItem.mockResolvedValue(null);
});

function renderScreen(route = {}) {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <MyStatsScreen
          navigation={{ goBack: jest.fn() }}
          route={route}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('MyStatsScreen navigation chrome', () => {
  test('shows Back when presented from the root stack', () => {
    const { getByLabelText } = renderScreen();

    expect(getByLabelText('Back')).toBeTruthy();
  });

  test('hides Back when mounted as a primary tab', () => {
    const { queryByLabelText } = renderScreen({ params: { presentation: 'tab' } });

    expect(queryByLabelText('Back')).toBeNull();
  });
});

describe('MyStatsScreen tab strip', () => {
  test('renders the personal stats tabs in a horizontal scroller', async () => {
    const { findByTestId, getByText } = renderScreen({ params: {} });

    const tabs = await findByTestId('my-stats-tab-scroller');

    expect(tabs.props.horizontal).toBe(true);
    expect(tabs.props.showsHorizontalScrollIndicator).toBe(false);
    expect(getByText('Report Card')).toBeTruthy();
    expect(getByText('Overview')).toBeTruthy();
    expect(getByText('Breakdown')).toBeTruthy();
    expect(getByText('Shots')).toBeTruthy();
  });

  test('keeps the active Shots tab inside an unclipped tab strip', async () => {
    const { findByTestId, getByLabelText } = renderScreen({ params: { tab: 'shots' } });

    const tabs = await findByTestId('my-stats-tab-scroller');
    const tabStripStyle = StyleSheet.flatten(tabs.props.style);
    const shotsChip = getByLabelText('Shots');

    expect(tabStripStyle.minHeight).toBeGreaterThanOrEqual(48);
    expect(shotsChip.props.accessibilityState?.selected).toBe(true);
  });
});
