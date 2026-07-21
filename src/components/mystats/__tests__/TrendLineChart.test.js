import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Polyline, Circle, Path, LinearGradient } from 'react-native-svg';
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

describe('TrendLineChart area fill', () => {
  test('draws one gradient-filled area path per segment', () => {
    const view = render(wrap(<TrendLineChart series={gapped} />));
    layOut(view);

    const areas = view.UNSAFE_getAllByType(Path)
      .filter((p) => typeof p.props.fill === 'string' && p.props.fill.startsWith('url(#'));
    expect(areas).toHaveLength(2);
    areas.forEach((a) => expect(a.props.d.endsWith('Z')).toBe(true));
  });

  test('each chart instance uses its own gradient id', () => {
    const view = render(wrap(
      <>
        <TrendLineChart series={gapped} dropGaps />
        <TrendLineChart series={gapped} dropGaps />
      </>,
    ));
    const canvases = view.getAllByTestId('trend-chart-canvas');
    canvases.forEach((c) => fireEvent(c, 'layout', { nativeEvent: { layout: { width: 300 } } }));

    const ids = view.UNSAFE_getAllByType(LinearGradient).map((g) => g.props.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('TrendLineChart last-point emphasis', () => {
  test('the final drawn dot is larger and ringed; earlier dots are not', () => {
    const view = render(wrap(<TrendLineChart series={gapped} />));
    layOut(view);

    const circles = view.UNSAFE_getAllByType(Circle);
    expect(circles).toHaveLength(2);
    const [first, last] = circles;
    expect(first.props.r).toBe(3);
    expect(first.props.stroke).toBeUndefined();
    expect(last.props.r).toBe(4.5);
    expect(last.props.strokeWidth).toBe(2);
    expect(typeof last.props.stroke).toBe('string');
  });

  test('by default the last dot fills with the line color', () => {
    const view = render(wrap(<TrendLineChart series={gapped} color="#123456" />));
    layOut(view);

    const circles = view.UNSAFE_getAllByType(Circle);
    expect(circles[circles.length - 1].props.fill).toBe('#123456');
  });

  test('ringColor and lastDotColor override the emphasis ring and end-dot fill', () => {
    const view = render(wrap(
      <TrendLineChart series={gapped} color="#f3efe6" ringColor="#0f3d2c" lastDotColor="#ffd700" />,
    ));
    layOut(view);

    const circles = view.UNSAFE_getAllByType(Circle);
    const last = circles[circles.length - 1];
    expect(last.props.stroke).toBe('#0f3d2c');
    expect(last.props.fill).toBe('#ffd700');
    // Earlier dots keep the plain line color.
    expect(circles[0].props.fill).toBe('#f3efe6');
  });
});
