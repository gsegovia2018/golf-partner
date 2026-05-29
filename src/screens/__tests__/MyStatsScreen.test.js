import React from 'react';
import { render } from '@testing-library/react-native';
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
  loadAllTournamentsWithFallback: jest.fn(() => new Promise(() => {})),
}));

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ displayName: 'Marco' })),
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../components/StatDetailSheet', () => 'StatDetailSheet');
jest.mock('../../components/RoundReportCard', () => 'RoundReportCard');
jest.mock('../../components/MyStatsRoundSelector', () => 'MyStatsRoundSelector');
jest.mock('../../components/mystats/TargetHandicapPicker', () => ({
  TargetHandicapPicker: 'TargetHandicapPicker',
}));
jest.mock('../../components/mystats/tabs/OverviewTab', () => 'OverviewTab');
jest.mock('../../components/mystats/tabs/FormTab', () => 'FormTab');
jest.mock('../../components/mystats/tabs/BreakdownTab', () => 'BreakdownTab');
jest.mock('../../components/mystats/tabs/ShotsTab', () => 'ShotsTab');

beforeEach(() => {
  AsyncStorage.getItem.mockReturnValue(new Promise(() => {}));
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
