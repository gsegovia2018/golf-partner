import React from 'react';
import { act, render } from '@testing-library/react-native';
import TabBarHost, { TabBarPublisher } from '../TabBarHost';

jest.mock('@react-navigation/native', () => ({
  StackActions: { popToTop: () => ({ type: 'POP_TO_TOP' }) },
}));

jest.mock('../FloatingTabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function FloatingTabBarStub(props) {
    return React.createElement(View, { testID: 'bar', bar: props });
  };
});

function makeRef(routes) {
  const listeners = new Set();
  let state = { key: 'root', index: routes.length - 1, routes: routes.map((name) => ({ name })) };
  return {
    isReady: () => true,
    getRootState: () => state,
    addListener: (_, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    dispatch: jest.fn(),
    go(next) {
      state = { key: 'root', index: next.length - 1, routes: next.map((name) => ({ name })) };
      listeners.forEach((fn) => fn());
    },
  };
}

const TABS = { state: { index: 1, routes: [] }, navigation: { navigate: jest.fn() } };

function renderHost(ref) {
  return render(
    <>
      <TabBarPublisher {...TABS} />
      <TabBarHost navigationRef={ref} />
    </>
  );
}

const hidden = (utils) => utils.getByTestId('tab-bar-host', { includeHiddenElements: true }).props.pointerEvents === 'none';

describe('TabBarHost', () => {
  test('draws the tabs bar on the tabs, not over a screen', () => {
    const utils = renderHost(makeRef(['Main']));
    const bar = utils.getByTestId('bar').props.bar;

    expect(hidden(utils)).toBe(false);
    expect(bar.state).toBe(TABS.state);
    expect(bar.overScreen).toBe(false);
  });

  test('stays over browse screens and steps aside for tasks', () => {
    const ref = makeRef(['Main']);
    const utils = renderHost(ref);

    act(() => ref.go(['Main', 'Stats']));
    expect(hidden(utils)).toBe(false);
    expect(utils.getByTestId('bar').props.bar.overScreen).toBe(true);

    act(() => ref.go(['Main', 'Stats', 'Scorecard']));
    expect(hidden(utils)).toBe(true);
  });

  test('leaving a screen pops the root stack to the tabs', () => {
    const ref = makeRef(['Main', 'Settings']);
    const utils = renderHost(ref);

    act(() => utils.getByTestId('bar').props.bar.leaveScreen());

    expect(ref.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'POP_TO_TOP', target: 'root' }));
  });
});
