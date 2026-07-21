import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SGTrendCard from '../SGTrendCard';

const trendChartProps = [];
jest.mock('../TrendLineChart', () => {
  const mockReact = require('react');
  return function MockTrendLineChart(props) {
    trendChartProps.push(props);
    return mockReact.createElement(require('react-native').View, { testID: 'trend-chart' });
  };
});

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      spacing: {
        xs: 8,
        sm: 12,
        md: 16,
        lg: 24,
      },
      radius: {
        pill: 20,
      },
      border: {
        default: '#E0E0E0',
      },
      bg: {
        primary: '#FFFFFF',
        secondary: '#F5F5F5',
        card: '#FFFFFF',
      },
      text: {
        primary: '#000000',
        secondary: '#666666',
        muted: '#888888',
        inverse: '#FFFFFF',
      },
      accent: {
        primary: '#007AFF',
      },
      typography: {
        caption: {
          fontSize: 12,
          lineHeight: 16,
        },
      },
    },
  }),
}));

const perRound = [
  { index: 0, total: -2.1, sampleHoles: 18, byCategory: { offTheTee: -0.5, approach: -1, aroundGreen: 0, putting: -0.6, penalties: 0 } },
  { index: 1, total: 0.4, sampleHoles: 18, byCategory: { offTheTee: 0.2, approach: 0.1, aroundGreen: 0, putting: 0.1, penalties: 0 } },
];

describe('SGTrendCard', () => {
  beforeEach(() => {
    trendChartProps.length = 0;
  });

  test('renders a chip per category plus Total and defaults to Total', () => {
    const r = render(<SGTrendCard strokesGained={{ perRound }} />);
    expect(r.getByText('Total')).toBeTruthy();
    expect(r.getByText('Off the tee')).toBeTruthy();
    expect(r.getByText('Putting')).toBeTruthy();
    expect(r.getByLabelText('SG trend Total').props.accessibilityState.selected).toBe(true);
  });
  test('switching chips switches the plotted series', () => {
    const r = render(<SGTrendCard strokesGained={{ perRound }} />);
    expect(trendChartProps[trendChartProps.length - 1].series).toEqual([
      { label: 'R1', value: -2.1 },
      { label: 'R2', value: 0.4 },
    ]);

    fireEvent.press(r.getByLabelText('SG trend Putting'));

    expect(r.getByLabelText('SG trend Putting').props.accessibilityState.selected).toBe(true);
    expect(trendChartProps[trendChartProps.length - 1].series).toEqual([
      { label: 'R1', value: -0.6 },
      { label: 'R2', value: 0.1 },
    ]);
  });
  test('chips use the tab-pill pattern: filled accent when active, bordered card pill when not', () => {
    const { StyleSheet } = require('react-native');
    const r = render(<SGTrendCard strokesGained={{ perRound }} />);
    const active = StyleSheet.flatten(r.getByLabelText('SG trend Total').props.style);
    const idle = StyleSheet.flatten(r.getByLabelText('SG trend Putting').props.style);
    expect(active.backgroundColor).toBe('#007AFF');
    expect(active.borderColor).toBe('#007AFF');
    expect(idle.backgroundColor).toBe('#FFFFFF');
    expect(idle.borderColor).toBe('#E0E0E0');
    expect(idle.borderWidth).toBe(1);
    expect(idle.borderRadius).toBe(20);
  });

  test('renders nothing with fewer than 2 sampled rounds', () => {
    const r = render(<SGTrendCard strokesGained={{ perRound: [perRound[0]] }} />);
    expect(r.toJSON()).toBeNull();
  });
});
