import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import MyStatsScreen, { getTabScrollTarget } from '../MyStatsScreen';

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
  loadProfile: jest.fn(() => Promise.resolve({ displayName: 'Marco', targetHandicap: 14, handicap: 12, gender: null })),
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/personalStats', () => ({
  collectMyRounds: jest.fn(() => [{ key: 'round-1', label: 'Round 1', tournamentId: 't-1', round: { id: 'r-1' } }]),
  resolveSelection: jest.fn((rounds) => rounds),
  computeMyStats: jest.fn(() => ({
    metrics: { rounds: 1, avgPoints: 30, bestRoundPoints: 30 },
    form: { hasHistory: false, metrics: [{ key: 'avgPoints', direction: 'flat', delta: null }] },
    formSeries: { metrics: { avgPoints: [] } },
    ranking: { baseline: null, strengths: [], weaknesses: [] },
    coach: { hero: null, board: {}, practicePlan: [] },
  })),
}));

jest.mock('../../store/roundReportCard', () => ({
  buildRoundReportCard: jest.fn(() => ({ title: 'Round 1' })),
}));

jest.mock('../../components/RoundReportCard', () => function MockRoundReportCard({ selectedKey, onOpenRound }) {
  const { Text, TouchableOpacity } = require('react-native');
  return (
    <>
      <Text>Report card content</Text>
      <Text>{`Selected round ${selectedKey}`}</Text>
      {onOpenRound ? (
        <TouchableOpacity onPress={onOpenRound}>
          <Text>Open round stats</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
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

jest.mock('../../components/mystats/tabs/CoachTab', () => function MockCoachTab() {
  const { Text } = require('react-native');
  return <Text>Coach content</Text>;
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
  return <Text>Strokes Gained content</Text>;
});

jest.mock('../../components/mystats/tabs/HandicapTab', () => function MockHandicapTab({ myRounds, profileHandicap }) {
  const { Text } = require('react-native');
  return <Text>{`Handicap tab: ${myRounds.length} rounds, profile ${profileHandicap}`}</Text>;
});

beforeEach(() => {
  AsyncStorage.getItem.mockResolvedValue(null);
});

function screenElement(route = {}, navigation = { goBack: jest.fn() }) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <MyStatsScreen
          navigation={navigation}
          route={route}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function renderScreen(route = {}, navigation = undefined) {
  return render(navigation ? screenElement(route, navigation) : screenElement(route));
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

describe('MyStatsScreen target handicap', () => {
  test('reloads the profile target handicap when the screen regains focus', async () => {
    const { loadProfile } = require('../../store/profileStore');
    const { computeMyStats } = require('../../store/personalStats');
    const listeners = {};
    const navigation = {
      goBack: jest.fn(),
      addListener: jest.fn((event, cb) => {
        listeners[event] = cb;
        return () => { delete listeners[event]; };
      }),
    };

    const { findByText } = renderScreen({ params: {} }, navigation);
    expect(await findByText('Report card content')).toBeTruthy();
    await waitFor(() => {
      expect(computeMyStats).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ targetHandicap: 14 }),
      );
    });

    // The target was edited on the Profile screen while this tab stayed
    // mounted; regaining focus must pick up the new value.
    loadProfile.mockResolvedValueOnce({ displayName: 'Marco', targetHandicap: 5 });
    expect(typeof listeners.focus).toBe('function');
    await act(async () => { await listeners.focus(); });

    await waitFor(() => {
      expect(computeMyStats).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ targetHandicap: 5 }),
      );
    });
  });
});

describe('MyStatsScreen tab strip', () => {
  test('renders the personal stats tabs in a horizontal scroller', async () => {
    const { findByTestId, getAllByRole, getByText } = renderScreen({ params: {} });

    const tabs = await findByTestId('my-stats-tab-scroller');
    const labels = getAllByRole('tab').map((tab) => tab.props.accessibilityLabel);

    expect(tabs.props.horizontal).toBe(true);
    expect(tabs.props.showsHorizontalScrollIndicator).toBe(false);
    expect(labels).toEqual(['Report Card', 'Coach', 'Strokes Gained', 'Form', 'Breakdown', 'Handicap']);
    expect(getByText('Coach')).toBeTruthy();
    expect(getByText('Report Card')).toBeTruthy();
    expect(getByText('Form')).toBeTruthy();
    expect(getByText('Breakdown')).toBeTruthy();
    expect(getByText('Strokes Gained')).toBeTruthy();
    expect(getByText('Handicap')).toBeTruthy();
    expect(() => getByText('Overview')).toThrow();
    expect(getByText('Report card content')).toBeTruthy();
  });

  test('maps legacy overview route param to the Coach tab', async () => {
    const { findByText, getByLabelText } = renderScreen({ params: { tab: 'overview' } });

    expect(await findByText('Coach content')).toBeTruthy();
    expect(getByLabelText('Coach').props.accessibilityState?.selected).toBe(true);
  });

  test('defaults invalid route tab params to the Report Card tab', async () => {
    const { findByText, getByLabelText } = renderScreen({ params: { tab: 'bogus' } });

    expect(await findByText('Report card content')).toBeTruthy();
    expect(getByLabelText('Report Card').props.accessibilityState?.selected).toBe(true);
  });

  test('syncs route params when a mounted screen receives report card navigation', async () => {
    const { findByText, getByLabelText, rerender } = renderScreen({ params: {} });

    expect(await findByText('Report card content')).toBeTruthy();

    rerender(screenElement({ params: { tab: 'reportCard', roundKey: 'round-1' } }));

    expect(await findByText('Report card content')).toBeTruthy();
    expect(getByLabelText('Report Card').props.accessibilityState?.selected).toBe(true);
    expect(await findByText('Selected round round-1')).toBeTruthy();
  });

  test('keeps the active Strokes Gained tab inside an unclipped tab strip', async () => {
    const { findByTestId, getByLabelText } = renderScreen({ params: { tab: 'shots' } });

    const tabs = await findByTestId('my-stats-tab-scroller');
    const tabStripStyle = StyleSheet.flatten(tabs.props.style);
    const shotsChip = getByLabelText('Strokes Gained');

    expect(tabStripStyle.minHeight).toBeGreaterThanOrEqual(48);
    expect(tabStripStyle.width).toBe('100%');
    expect(tabStripStyle.maxWidth).toBe('100%');
    expect(shotsChip.props.accessibilityState?.selected).toBe(true);
  });

  test('does not scroll visible chips out of view', () => {
    expect(getTabScrollTarget({
      layout: { x: 90, width: 103 },
      viewportWidth: 390,
      currentX: 0,
      edgePadding: 16,
    })).toBeNull();
  });

  test('keeps the first tab group pinned when selecting Report Card', () => {
    expect(getTabScrollTarget({
      layout: { x: 90, width: 103 },
      viewportWidth: 390,
      currentX: 60,
      edgePadding: 16,
      pinToStart: true,
    })).toBe(0);
  });

  test('scrolls trailing chips only enough to reveal them', () => {
    expect(getTabScrollTarget({
      layout: { x: 369, width: 65 },
      viewportWidth: 390,
      currentX: 0,
      edgePadding: 16,
    })).toBe(60);
  });

  test('scrolls back left when the active chip is hidden before the viewport', () => {
    expect(getTabScrollTarget({
      layout: { x: 16, width: 68 },
      viewportWidth: 390,
      currentX: 120,
      edgePadding: 16,
    })).toBe(0);
  });
});

describe('MyStatsScreen report card round link', () => {
  test('navigates to the round statistics for the selected round', async () => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { findByText } = render(screenElement({ params: { tab: 'reportCard' } }, navigation));

    fireEvent.press(await findByText('Open round stats'));

    expect(navigation.navigate).toHaveBeenCalledWith('Stats', {
      tournamentId: 't-1',
      roundId: 'r-1',
    });
  });

  test('omits the link when the selected round has no id', async () => {
    const { collectMyRounds } = require('../../store/personalStats');
    collectMyRounds.mockReturnValueOnce([
      { key: 'round-1', label: 'Round 1', tournamentId: 't-1', round: {} },
    ]);
    const { findByText, queryByText } = render(screenElement({ params: { tab: 'reportCard' } }));

    expect(await findByText('Report card content')).toBeTruthy();
    expect(queryByText('Open round stats')).toBeNull();
  });
});

describe('MyStatsScreen handicap tab', () => {
  it('shows the Handicap tab and passes all rounds plus the profile handicap', async () => {
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    expect(await view.findByText(/Handicap tab: 1 rounds, profile 12/)).toBeTruthy();
  });
});
