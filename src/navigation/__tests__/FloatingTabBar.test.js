import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import FloatingTabBar from '../FloatingTabBar';
import { light } from '../../theme/tokens';
import { setLanguagePref } from '../../i18n';
import { __getRegisteredTourKeysForTests, __resetTourTargetsForTests } from '../../components/tour/tourTargets';
import { setPlayCue } from '../../store/playCue';
import { isTabBarCollapsed, setTabBarCollapsed } from '../tabBarChrome';
import { openLiveScorecard } from '../openScorecard';

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

jest.mock('../openScorecard', () => ({
  openLiveScorecard: jest.fn(),
}));

const LIVE = { tournamentId: 't1', roundIndex: 0, courseName: 'Club de Campo', hole: 11, points: 22 };

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
  setPlayCue(null);
  setTabBarCollapsed(false);
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

  test('always shows labels under every secondary tab, tinting the selected one', () => {
    const { getByText } = renderTabBar({ index: 1 });

    expect(getByText('Feed')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
    expect(getByText('Profile')).toBeTruthy();
    const activeLabel = StyleSheet.flatten(getByText('Stats').props.style);
    const inactiveLabel = StyleSheet.flatten(getByText('Feed').props.style);
    expect(activeLabel.color).toBe(light.accent.primary);
    // Secondary, not muted: muted fails AA for 10px labels on the frosted bar.
    expect(inactiveLabel.color).toBe(light.text.secondary);
  });

  test('renders Play as an icon-only accent disc', () => {
    const { queryByText, UNSAFE_getAllByType } = renderTabBar({ index: 0 });
    const flag = UNSAFE_getAllByType('Feather').find((i) => i.props.name === 'flag');

    expect(queryByText('Play')).toBeNull();
    expect(flag.props.color).toBe(light.text.inverse);
  });

  test('a tap on Play routes to Home, even while a round is live', () => {
    act(() => setPlayCue({ live: LIVE, quickStart: [] }));
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    fireEvent.press(getByLabelText('Play'));

    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });
});

describe('live round strip', () => {
  test('is hidden without a live round', () => {
    const { queryByTestId } = renderTabBar();
    expect(queryByTestId('tabbar-live-strip')).toBeNull();
  });

  test('shows the hole and my points and opens that scorecard straight away', () => {
    act(() => setPlayCue({ live: LIVE, quickStart: [] }));
    const { getByTestId, getByText, navigation } = renderTabBar({ index: 0 });

    expect(getByText('Club de Campo')).toBeTruthy();
    expect(getByText('Hole 11 · 22 pts')).toBeTruthy();
    fireEvent.press(getByTestId('tabbar-live-strip'));

    expect(openLiveScorecard).toHaveBeenCalledWith(navigation, LIVE);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

describe('collapsed bar', () => {
  test('its current-tab circle opens the bar again', () => {
    const { getByTestId } = renderTabBar({ index: 1 });
    act(() => setTabBarCollapsed(true));

    fireEvent.press(getByTestId('tabbar-show-all'));

    expect(isTabBarCollapsed()).toBe(false);
  });

  test('switching tabs opens the bar', () => {
    const { rerender } = renderTabBar({ index: 1 });
    act(() => setTabBarCollapsed(true));

    rerender(
      <SafeAreaProvider>
        <ThemeProvider>
          <FloatingTabBar state={makeState(3)} navigation={makeNavigation()} />
        </ThemeProvider>
      </SafeAreaProvider>
    );

    expect(isTabBarCollapsed()).toBe(false);
  });
});

describe('Play hold menu', () => {
  const holdPlay = (utils) => {
    act(() => { fireEvent(utils.getByLabelText('Play'), 'longPress'); });
  };

  test('holding Play opens the quick actions; New game starts the setup', () => {
    const utils = renderTabBar({ index: 0 });
    expect(utils.queryByTestId('play-menu-new-game')).toBeNull();

    holdPlay(utils);
    fireEvent.press(utils.getByTestId('play-menu-new-game'));

    expect(utils.navigation.navigate).toHaveBeenCalledWith('Setup', { kind: 'game' });
  });

  test('offers the live round and the quick-start courses', () => {
    act(() => setPlayCue({ live: LIVE, quickStart: [{ id: 'c1', name: 'La Herrería' }] }));
    const utils = renderTabBar({ index: 0 });

    holdPlay(utils);
    fireEvent.press(utils.getByText('La Herrería'));
    expect(utils.navigation.navigate).toHaveBeenCalledWith('Home', { quickStartCourseId: 'c1' });

    holdPlay(utils);
    fireEvent.press(utils.getByTestId('play-menu-resume'));
    expect(openLiveScorecard).toHaveBeenCalledWith(utils.navigation, LIVE);
  });

  test('screen readers reach it through an action on Play', () => {
    const utils = renderTabBar({ index: 0 });

    act(() => {
      fireEvent(utils.getByLabelText('Play'), 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    });

    expect(utils.getByTestId('play-menu-new-game')).toBeTruthy();
  });
});

describe('tour target registration', () => {
  beforeEach(() => __resetTourTargetsForTests());

  it('registers spotlight targets for play, stats, feed and profile — not history', () => {
    renderTabBar();
    const keys = __getRegisteredTourKeysForTests();
    expect(keys).toEqual(expect.arrayContaining(['tab-play', 'tab-stats', 'tab-feed', 'tab-profile']));
    expect(keys).not.toContain('tab-history');
  });
});

describe('FloatingTabBar language', () => {
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('labels are Spanish in Spanish and switch live', async () => {
    const { getByLabelText, getByText, rerender } = renderTabBar();
    expect(getByLabelText('Play')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();

    await act(async () => { await setLanguagePref('es'); });
    rerender(
      <SafeAreaProvider>
        <ThemeProvider>
          <FloatingTabBar state={makeState(2)} navigation={makeNavigation()} />
        </ThemeProvider>
      </SafeAreaProvider>
    );
    expect(getByLabelText('Jugar')).toBeTruthy();
    expect(getByLabelText('Estadísticas')).toBeTruthy();
    expect(getByLabelText('Perfil')).toBeTruthy();
    expect(getByText('Historial')).toBeTruthy();
    expect(getByText('Feed')).toBeTruthy();
  });
});
