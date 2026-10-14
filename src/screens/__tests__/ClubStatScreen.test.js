import React from 'react';
import { render, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { setLanguagePref } from '../../i18n';
import ClubStatScreen from '../ClubStatScreen';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 0,
  getShots: () => [],
}));

jest.mock('../../store/shotRounds', () => ({
  loadShotRoundIndex: jest.fn(() => Promise.resolve(null)),
  shotRoundContext: jest.fn(() => null),
}));

const mockDetail = jest.fn();
jest.mock('../../lib/shotStats', () => ({
  clubDetail: (...args) => mockDetail(...args),
}));

jest.mock('../../components/mystats/TrendLineChart', () => function MockTrend({ caption }) {
  const { Text } = require('react-native');
  return <Text>{caption}</Text>;
});

jest.mock('../../components/scorecard/ShotReplaySheet', () => ({ ShotReplaySheet: () => null }));

const DETAIL = {
  club: '7i',
  nominal: 140,
  count: 3,
  avg: 138,
  std: 4,
  min: 132,
  max: 146,
  longest: { roundId: 'r1', roundIndex: 0 },
  byRound: [{ key: 'a', avg: 136, count: 1 }, { key: 'b', avg: 140, count: 2 }],
  recent: [132, 136, 146],
};

const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <ClubStatScreen route={{ params: { club: '7i' } }} navigation={{ goBack: jest.fn() }} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

afterEach(async () => {
  await setLanguagePref('system');
});

describe('ClubStatScreen', () => {
  test('English: club name, hero sub and tiles', async () => {
    mockDetail.mockReturnValue(DETAIL);
    const { getByText } = renderScreen();
    await flush();
    expect(getByText('7 Iron')).toBeTruthy();
    expect(getByText('avg carry · 3 shots · typical 140m')).toBeTruthy();
    expect(getByText('CONSISTENCY')).toBeTruthy();
    expect(getByText('RANGE (m)')).toBeTruthy();
    expect(getByText('RECENT CARRIES')).toBeTruthy();
  });

  test('Spanish: club name, hero sub, tiles and sections', async () => {
    await setLanguagePref('es');
    mockDetail.mockReturnValue(DETAIL);
    const { getByText } = renderScreen();
    await flush();
    expect(getByText('Hierro 7')).toBeTruthy();
    expect(getByText('carry medio · 3 golpes · habitual 140m')).toBeTruthy();
    expect(getByText('REGULARIDAD')).toBeTruthy();
    expect(getByText('RANGO (m)')).toBeTruthy();
    expect(getByText('MÁS LARGO (m)')).toBeTruthy();
    expect(getByText('CARRY POR VUELTA')).toBeTruthy();
    expect(getByText('CARRIES RECIENTES')).toBeTruthy();
  });

  test('Spanish: empty state', async () => {
    await setLanguagePref('es');
    mockDetail.mockReturnValue(null);
    const { getByText } = renderScreen();
    await flush();
    expect(getByText('Aún no hay golpes')).toBeTruthy();
  });
});
