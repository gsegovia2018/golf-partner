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

// Mutable holder so individual tests can simulate a signed-out session.
let mockUser = { id: 'user-1' };
const setMockUser = (u) => { mockUser = u; };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
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

// Renders one pressable per round when visible, so tests can drive the real
// onChange(next) contract (persistOverrides) without the real BottomSheet /
// grouping logic. accessibilityLabel is index-based ("Round 1", "Round 2", …)
// since the fixture rounds used below don't carry `roundIndex`/`courseName`.
jest.mock('../../components/MyStatsRoundSelector', () => function MockMyStatsRoundSelector({ visible, myRounds, overrides, onChange }) {
  const { View, Text, TouchableOpacity } = require('react-native');
  if (!visible) return null;
  return (
    <View>
      {myRounds.map((r, i) => (
        <TouchableOpacity
          key={r.key}
          accessibilityLabel={`Round ${i + 1}`}
          onPress={() => onChange({ ...overrides, [r.key]: !overrides[r.key] })}
        >
          <Text>{`Round ${i + 1}`}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
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

jest.mock('../../components/mystats/tabs/HandicapTab', () => function MockHandicapTab({ myRounds, profileHandicap, excludedKeys, onToggleExcluded }) {
  const { Text, TouchableOpacity } = require('react-native');
  return (
    <>
      <Text>{`Handicap tab: ${myRounds.length} rounds, profile ${profileHandicap}`}</Text>
      <Text>{`Excluded count: ${excludedKeys ? excludedKeys.size : 'none'}`}</Text>
      <TouchableOpacity onPress={() => onToggleExcluded('t-1:0')}>
        <Text>Toggle exclusion</Text>
      </TouchableOpacity>
    </>
  );
});

beforeEach(() => {
  mockUser = { id: 'user-1' };
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

  test('shows the Clubhouse kicker above the title', () => {
    const { getByText } = renderScreen();

    expect(getByText('CLUBHOUSE · MEMBER RECORD')).toBeTruthy();
    expect(getByText('My Stats')).toBeTruthy();
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

describe('round selection persistence', () => {
  const { collectMyRounds } = require('../../store/personalStats');

  beforeEach(async () => {
    await AsyncStorage.clear();
    // The file-level beforeEach above forces getItem to resolve null so most
    // tests don't need a live storage round-trip. These tests are
    // specifically about storage round-trips, so restore the real per-key
    // read against the mock's in-memory backing store.
    AsyncStorage.getItem.mockImplementation((key) => (
      Promise.resolve(AsyncStorage.__INTERNAL_MOCK_STORAGE__[key] ?? null)
    ));
  });

  it('keeps stored overrides for rounds missing from the current load', async () => {
    // Stored override deselects round t-2:0, but this load only returns
    // t-1:0 (partial load). A toggle during this state must not wipe the
    // override for the round that failed to load.
    await AsyncStorage.setItem('@mystats_round_selection:user-1', JSON.stringify({ 't-2:0': false }));
    collectMyRounds.mockReturnValue([
      { key: 't-1:0', tournamentId: 't-1', completed: true, round: { id: 'r-1' } },
    ]);

    const view = renderScreen();
    await view.findByText(/1 of 1/);
    fireEvent.press(view.getByText(/1 of 1/));
    fireEvent.press(await view.findByLabelText(/Round 1/));

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('@mystats_round_selection:user-1');
      expect(JSON.parse(raw)).toMatchObject({ 't-2:0': false });
    });
  });

  it('persists selection under a device-scoped key when signed out', async () => {
    setMockUser(null);
    collectMyRounds.mockReturnValue([
      { key: 'round-1', tournamentId: 't-1', completed: true, round: { id: 'r-1' } },
    ]);

    const view = renderScreen();
    await view.findByText(/1 of 1/);
    fireEvent.press(view.getByText(/1 of 1/));
    fireEvent.press(await view.findByLabelText(/Round 1/));

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('@mystats_round_selection:local');
      expect(raw).not.toBeNull();
    });
  });
});

describe('handicap exclusion persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    // These tests are about storage round-trips, so restore the real
    // per-key read against the mock's in-memory backing store (the
    // file-level beforeEach forces getItem to resolve null).
    AsyncStorage.getItem.mockImplementation((key) => (
      Promise.resolve(AsyncStorage.__INTERNAL_MOCK_STORAGE__[key] ?? null)
    ));
  });

  it('persists a toggled exclusion under the user-scoped key', async () => {
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    fireEvent.press(await view.findByText('Toggle exclusion'));
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('@handicap_round_exclusions:user-1');
      expect(JSON.parse(raw)).toEqual(['t-1:0']);
    });
  });

  it('restores stored exclusions on load', async () => {
    await AsyncStorage.setItem('@handicap_round_exclusions:user-1', JSON.stringify(['t-1:0']));
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
  });
});
