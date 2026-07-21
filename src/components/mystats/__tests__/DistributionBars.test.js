import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import DistributionBars from '../DistributionBars';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('DistributionBars', () => {
  test('renders displayValue in place of count when provided', () => {
    const { getByText, queryByText } = render(wrap(
      <DistributionBars bars={[
        { label: 'Fairway', count: 37, displayValue: '45%' },
        { label: 'Left', count: 16, displayValue: '20%' },
      ]} />
    ));
    expect(getByText('45%')).toBeTruthy();
    expect(getByText('20%')).toBeTruthy();
    expect(queryByText('37')).toBeNull();
    expect(queryByText('16')).toBeNull();
  });

  test('falls back to count when displayValue is absent (existing callers)', () => {
    const { getByText } = render(wrap(
      <DistributionBars bars={[
        { label: 'Par', count: 12 },
        { label: 'Bogey', count: 7 },
      ]} />
    ));
    expect(getByText('12')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
  });

  test('handles empty bars and all-zero counts without crashing', () => {
    const empty = render(wrap(<DistributionBars bars={[]} />));
    expect(empty.toJSON()).toBeTruthy();

    const zeros = render(wrap(
      <DistributionBars bars={[
        { label: 'Eagle', count: 0 },
        { label: 'Birdie', count: 0 },
      ]} />
    ));
    expect(zeros.getByText('Eagle')).toBeTruthy();
    expect(zeros.getByText('Birdie')).toBeTruthy();
  });
});
