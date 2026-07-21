import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Polyline, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { ThemeProvider } from '../../../theme/ThemeContext';
import SparklineRow from '../SparklineRow';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// one test can assert the static (no-animation) render path.
let mockReducedMotion = false;
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => mockReducedMotion,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => {
  mockReducedMotion = false;
});

const series = [
  { label: 'R1', value: 36 },
  { label: 'R2', value: 33 },
  { label: 'R3', value: 30 },
];

// Lower-is-better metric that improved: raw delta is negative but
// personalStats already resolved direction to 'up' (improvement).
const puttsMetric = {
  key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', shot: true,
  recent: 30, history: 33, delta: -3, direction: 'up',
};

const layOut = (view, key) => {
  fireEvent(view.getByTestId(`sparkline-slot-${key}`), 'layout', {
    nativeEvent: { layout: { width: 200 } },
  });
};

describe('SparklineRow', () => {
  test('renders label, comparison sub, and the latest formatted value', () => {
    const { getByText } = render(wrap(
      <SparklineRow metric={puttsMetric} series={series} color="#f00" formatValue={(v) => `${v}`} />
    ));

    expect(getByText('Putts / round')).toBeTruthy();
    expect(getByText('vs 33 previous')).toBeTruthy();
    expect(getByText('30')).toBeTruthy(); // latest non-null point
  });

  test('an improvement on a lower-is-better metric gets a GREEN down-arrow chip', () => {
    const view = render(wrap(
      <SparklineRow metric={puttsMetric} series={series} color="#f00" />
    ));

    const chip = view.getByTestId('sparkline-chip-puttsPerRound');
    expect(chip.props.accessibilityLabel).toBe('Putts / round: improved 3 vs your history');
    const icon = view.UNSAFE_getAllByType(Feather).find((i) => i.props.name === 'trending-down');
    expect(icon).toBeTruthy();
    expect(icon.props.color).toBe('#2a7d56'); // scoreColor('good'), not destructive
    expect(view.getByText('-3')).toBeTruthy();
  });

  test('a decline on a higher-is-better metric gets a declined label', () => {
    const girMetric = {
      key: 'girPct', label: 'Greens in reg %', polarity: 'higher', shot: true,
      recent: 40, history: 45, delta: -5, direction: 'down',
    };
    const view = render(wrap(
      <SparklineRow metric={girMetric} series={series} color="#0f0" />
    ));

    const chip = view.getByTestId('sparkline-chip-girPct');
    expect(chip.props.accessibilityLabel).toBe('Greens in reg %: declined 5 vs your history');
    const icon = view.UNSAFE_getAllByType(Feather).find((i) => i.props.name === 'trending-down');
    expect(icon.props.color).not.toBe('#2a7d56');
  });

  test('a null gap splits the sparkline into segments by default', () => {
    const gapped = [
      { label: 'R1', value: 10 },
      { label: 'R2', value: null },
      { label: 'R3', value: 20 },
    ];
    const view = render(wrap(
      <SparklineRow metric={puttsMetric} series={gapped} color="#f00" />
    ));
    layOut(view, 'puttsPerRound');

    expect(view.UNSAFE_getAllByType(Polyline)).toHaveLength(2);
    expect(view.UNSAFE_getAllByType(Circle)).toHaveLength(1); // end dot only
  });

  test('dropGaps connects the line across null rounds', () => {
    const gapped = [
      { label: 'R1', value: 10 },
      { label: 'R2', value: null },
      { label: 'R3', value: 20 },
    ];
    const view = render(wrap(
      <SparklineRow metric={puttsMetric} series={gapped} color="#f00" dropGaps />
    ));
    layOut(view, 'puttsPerRound');

    const polylines = view.UNSAFE_getAllByType(Polyline);
    expect(polylines).toHaveLength(1);
    expect(polylines[0].props.points.split(' ')).toHaveLength(2);
  });

  test('no history → no delta chip, and the sub says so', () => {
    const noHistory = { ...puttsMetric, history: null, delta: null, direction: 'flat' };
    const { queryByTestId, getByText } = render(wrap(
      <SparklineRow metric={noHistory} series={series} color="#f00" />
    ));

    expect(queryByTestId('sparkline-chip-puttsPerRound')).toBeNull();
    expect(getByText('No history to compare')).toBeTruthy();
  });

  test('a zero delta renders the muted level chip', () => {
    const flat = { ...puttsMetric, delta: 0, direction: 'flat' };
    const view = render(wrap(
      <SparklineRow metric={flat} series={series} color="#f00" />
    ));

    const chip = view.getByTestId('sparkline-chip-puttsPerRound');
    expect(chip.props.accessibilityLabel).toBe('Putts / round: level with your history');
    expect(view.getByText('level')).toBeTruthy();
  });

  test('keeps the metric infoKey wired to the row info button', () => {
    const onInfo = jest.fn();
    const { getByLabelText } = render(wrap(
      <SparklineRow metric={puttsMetric} series={series} color="#f00" infoKey="putts" onInfo={onInfo} />
    ));

    fireEvent.press(getByLabelText('What is Putts / round'));
    expect(onInfo).toHaveBeenCalledWith('putts');
  });

  test('reduced motion still renders the sparkline and chip statically', () => {
    mockReducedMotion = true;
    const view = render(wrap(
      <SparklineRow metric={puttsMetric} series={series} color="#f00" />
    ));
    layOut(view, 'puttsPerRound');

    expect(view.getByTestId('sparkline-canvas-puttsPerRound')).toBeTruthy();
    expect(view.getByTestId('sparkline-chip-puttsPerRound')).toBeTruthy();
  });
});
