import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Polyline, Circle } from 'react-native-svg';
import { ThemeProvider } from '../../../theme/ThemeContext';
import TrendLineChart from '../TrendLineChart';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// A series with a gap in the middle (e.g. a round not considered for the metric).
const gapped = [
  { label: 'A', value: 10 },
  { label: 'B', value: null },
  { label: 'C', value: 20 },
];

// The chart only draws once it has measured itself; simulate the layout pass.
const layOut = (view) => {
  fireEvent(view.getByTestId('trend-chart-canvas'), 'layout', {
    nativeEvent: { layout: { width: 300 } },
  });
};

describe('TrendLineChart gaps', () => {
  test('a null value splits the line into segments by default', () => {
    const view = render(wrap(<TrendLineChart series={gapped} />));
    layOut(view);

    expect(view.UNSAFE_getAllByType(Polyline)).toHaveLength(2);
    expect(view.UNSAFE_getAllByType(Circle)).toHaveLength(2);
  });

  test('dropGaps removes null points so the line connects', () => {
    const view = render(wrap(<TrendLineChart series={gapped} dropGaps />));
    layOut(view);

    const polylines = view.UNSAFE_getAllByType(Polyline);
    expect(polylines).toHaveLength(1);
    expect(polylines[0].props.points.split(' ')).toHaveLength(2);
    expect(view.UNSAFE_getAllByType(Circle)).toHaveLength(2);
  });

  test('dropGaps still shows the empty state for an all-null series', () => {
    const view = render(wrap(
      <TrendLineChart series={[{ label: 'A', value: null }]} dropGaps />,
    ));

    expect(view.getByText('Not enough rounds yet.')).toBeTruthy();
  });
});
