import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import HoleBreakdownTable from '../HoleBreakdownTable';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const hole = (over = {}) => ({
  holeNumber: 1, par: 4, strokeIndex: 7, timesPlayed: 3,
  avgStrokes: 5.33, avgVsPar: 1.33, avgPoints: 0.67, bestStrokes: 4,
  avgPutts: null, penalties: 0,
  ...over,
});

describe('HoleBreakdownTable', () => {
  test('renders a row per hole with par/SI, averages and best score', () => {
    const { getByText } = render(wrap(
      <HoleBreakdownTable holes={[
        hole(),
        // Distinct values on hole 2 — getByText throws on duplicate matches.
        hole({
          holeNumber: 2, strokeIndex: 3, avgStrokes: 3.8, avgVsPar: -0.2,
          avgPoints: 2.2, bestStrokes: 3,
        }),
      ]} />
    ));
    expect(getByText('Par 4 · SI 7 · 3x')).toBeTruthy();
    expect(getByText('Par 4 · SI 3 · 3x')).toBeTruthy();
    expect(getByText('+1.33')).toBeTruthy();  // hole 1 signed vs par
    expect(getByText('-0.2')).toBeTruthy();   // hole 2 signed vs par
    expect(getByText('3')).toBeTruthy();      // best score on hole 2
  });

  test('shows putts/penalty detail only when logged', () => {
    const { getByText, queryByText } = render(wrap(
      <HoleBreakdownTable holes={[hole({ avgPutts: 2.5, penalties: 2 })]} />
    ));
    expect(getByText('2.5 putts avg · 2 pen')).toBeTruthy();
    expect(queryByText('null putts avg')).toBeNull();
  });

  test('renders nothing for empty input', () => {
    const { toJSON } = render(wrap(<HoleBreakdownTable holes={[]} />));
    expect(toJSON()).toBeNull();
  });
});
