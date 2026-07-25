import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import MyStatsScreen, { getTabScrollTarget, indexFromOffset } from '../MyStatsScreen';
import { getAppSettings, updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';

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
  __resetAppSettingsForTests();
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

  test('header shows only the My Stats title, no kicker', () => {
    const { getByText, queryByText } = renderScreen();

    expect(getByText('My Stats')).toBeTruthy();
    expect(queryByText('CLUBHOUSE · MEMBER RECORD')).toBeNull();
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

  // The pager must commit the reached page from the scroll stream itself.
  // react-native-web's ScrollView wires only onScroll to the DOM — it never
  // emits onScrollEndDrag or onMomentumScrollEnd — so settling on either of
  // those left web swipes dead: the pill never followed the indicator and
  // pages outside the initial window never mounted (blank page).
  test('a swipe selects the page it lands on', async () => {
    const { findByTestId, findByText, getByLabelText } = renderScreen({ params: {} });
    expect(await findByText('Report card content')).toBeTruthy();
    const pager = await findByTestId('my-stats-pager');

    act(() => {
      fireEvent(pager, 'layout', { nativeEvent: { layout: { width: 400 } } });
    });
    act(() => {
      fireEvent.scroll(pager, { nativeEvent: { contentOffset: { x: 800 } } });
    });

    await waitFor(() => {
      expect(getByLabelText('Strokes Gained').props.accessibilityState?.selected).toBe(true);
    });
  });

  test('a swipe past the halfway point commits before the finger lifts', async () => {
    const { findByTestId, findByText, getByLabelText } = renderScreen({ params: {} });
    expect(await findByText('Report card content')).toBeTruthy();
    const pager = await findByTestId('my-stats-pager');

    act(() => {
      fireEvent(pager, 'layout', { nativeEvent: { layout: { width: 400 } } });
    });
    // Dragged 40% across — still page 0, nothing should change yet.
    act(() => {
      fireEvent.scroll(pager, { nativeEvent: { contentOffset: { x: 160 } } });
    });
    expect(getByLabelText('Report Card').props.accessibilityState?.selected).toBe(true);

    // Past halfway — the label must flip with the indicator, not after it.
    act(() => {
      fireEvent.scroll(pager, { nativeEvent: { contentOffset: { x: 240 } } });
    });
    await waitFor(() => {
      expect(getByLabelText('Coach').props.accessibilityState?.selected).toBe(true);
    });
  });

  test('shows the empty state inside a stats page when no rounds are selected', async () => {
    const { resolveSelection } = require('../../store/personalStats');
    resolveSelection.mockReturnValue([]); // every round deselected
    const { findAllByText, queryByText } = renderScreen({ params: { tab: 'coach' } });

    // All six pages mount at once (lazy mounting is a later task), so every
    // rounds-dependent tab (coach/shots/form/breakdown) shows its own empty
    // state — assert at least one is present rather than a single instance.
    try {
      expect(await findAllByText('No rounds selected.')).not.toHaveLength(0);
      expect(queryByText('Coach content')).toBeNull();
    } finally {
      resolveSelection.mockImplementation((rounds) => rounds); // reset for other tests
    }
  });

  describe('indexFromOffset', () => {
    test('rounds the offset to the nearest page index', () => {
      expect(indexFromOffset(0, 390, 6)).toBe(0);
      expect(indexFromOffset(200, 390, 6)).toBe(1); // past halfway → next page
      expect(indexFromOffset(780, 390, 6)).toBe(2);
    });

    test('clamps to the valid range at both ends', () => {
      expect(indexFromOffset(-50, 390, 6)).toBe(0);
      expect(indexFromOffset(999999, 390, 6)).toBe(5);
    });

    test('returns 0 for a non-positive width', () => {
      expect(indexFromOffset(300, 0, 6)).toBe(0);
      expect(indexFromOffset(300, NaN, 6)).toBe(0);
    });
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
  // Persisted via the app settings store (handicapExcludedRounds), not a
  // one-off AsyncStorage key — so it survives unmount/app restart the same
  // way every other per-user setting does.
  it('toggling an exclusion updates app settings and stays excluded', async () => {
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    fireEvent.press(await view.findByText('Toggle exclusion'));
    await waitFor(() => {
      expect(getAppSettings().handicapExcludedRounds).toEqual(['t-1:0']);
    });
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
  });

  it('toggling the same round again re-includes it', async () => {
    await updateAppSettings({ handicapExcludedRounds: ['t-1:0'] });
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
    fireEvent.press(await view.findByText('Toggle exclusion'));
    await waitFor(() => {
      expect(getAppSettings().handicapExcludedRounds).toEqual([]);
    });
    expect(await view.findByText('Excluded count: 0')).toBeTruthy();
  });

  it('restores a stored exclusion on initial render', async () => {
    await updateAppSettings({ handicapExcludedRounds: ['t-1:0'] });
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
  });
});

describe('handicap exclusion legacy migration', () => {
  // Exclusions used to live in a per-device AsyncStorage key
  // (@handicap_round_exclusions:<userId>) before they moved into the synced
  // app settings store. These tests exercise the real AsyncStorage
  // round-trip, so restore the mock's real per-key read against its
  // in-memory backing store (the file-level beforeEach forces getItem to
  // resolve null).
  beforeEach(async () => {
    await AsyncStorage.clear();
    AsyncStorage.getItem.mockImplementation((key) => (
      Promise.resolve(AsyncStorage.__INTERNAL_MOCK_STORAGE__[key] ?? null)
    ));
  });

  it('adopts a legacy exclusion into settings and deletes the legacy key', async () => {
    await AsyncStorage.setItem('@handicap_round_exclusions:user-1', JSON.stringify(['t-1:0']));
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    await waitFor(() => {
      expect(getAppSettings().handicapExcludedRounds).toEqual(['t-1:0']);
    });
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('@handicap_round_exclusions:user-1')).toBeNull();
    });
  });

  it('keeps existing settings exclusions and discards the legacy key without adopting', async () => {
    await updateAppSettings({ handicapExcludedRounds: ['t-9:9'] });
    await AsyncStorage.setItem('@handicap_round_exclusions:user-1', JSON.stringify(['t-1:0']));
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('@handicap_round_exclusions:user-1')).toBeNull();
    });
    expect(getAppSettings().handicapExcludedRounds).toEqual(['t-9:9']);
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
  });
});
