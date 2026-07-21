import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import FloatingTabBar from '../FloatingTabBar';
import { light } from '../../theme/tokens';
import { __getRegisteredTourKeysForTests, __resetTourTargetsForTests } from '../../components/tour/tourTargets';

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

  test('uses muted text color for inactive secondary icons', () => {
    const { UNSAFE_getAllByType } = renderTabBar({ index: 2 });

    const icons = UNSAFE_getAllByType('Feather');
    expect(icons[0].props.color).toBe(light.text.muted);
  });

  test('always shows labels under every secondary tab, tinting the selected one', () => {
    const { getByText } = renderTabBar({ index: 1 });

    expect(getByText('Feed')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
    expect(getByText('Profile')).toBeTruthy();
    const activeLabel = StyleSheet.flatten(getByText('Stats').props.style);
    const inactiveLabel = StyleSheet.flatten(getByText('Feed').props.style);
    expect(activeLabel.color).toBe(light.accent.primary);
    expect(inactiveLabel.color).toBe(light.text.muted);
  });

  test('marks the selected secondary tab with a filled icon bubble', () => {
    const { getByTestId } = renderTabBar({ index: 1 });

    const activeWrap = StyleSheet.flatten(getByTestId('MyStats-tab-icon-wrap').props.style);
    const inactiveWrap = StyleSheet.flatten(getByTestId('Feed-tab-icon-wrap').props.style);
    expect(activeWrap.backgroundColor).toBe(light.accent.light);
    expect(inactiveWrap.backgroundColor).toBeUndefined();
  });

  test('renders the center action as a circular icon-only button', () => {
    const { getByTestId, queryByText } = renderTabBar({ index: 0 });
    const surface = StyleSheet.flatten(getByTestId('Home-tab-surface').props.style);

    expect(queryByText('Play')).toBeNull();
    expect(surface.borderRadius).toBe(999);
    expect(surface.width).toBe(surface.height);
  });

  test('always routes the center action to Home, even while a round is live', () => {
    const { getByLabelText, navigation } = renderTabBar({ index: 0 });

    fireEvent.press(getByLabelText('Play'));

    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });

  test('uses accent colors on the center button', () => {
    const { getByTestId, UNSAFE_getAllByType } = renderTabBar({ index: 0 });
    const surface = StyleSheet.flatten(getByTestId('Home-tab-surface').props.style);
    const icon = UNSAFE_getAllByType('Feather').find((i) => i.props.name === 'flag');

    expect(surface.backgroundColor).toBe(light.accent.primary);
    expect(icon.props.color).toBe(light.text.inverse);
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
