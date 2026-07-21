import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { semantic } from '../../../theme/tokens';
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

  test('tone-colors the vs-par value: red well over par, green under par', () => {
    const { getByText } = render(wrap(
      <HoleBreakdownTable holes={[
        hole(), // +1.33 over par → bad
        hole({
          holeNumber: 2, strokeIndex: 3, avgStrokes: 3.8, avgVsPar: -0.2,
          avgPoints: 2.2, bestStrokes: 3,
        }), // under par → good
        hole({
          holeNumber: 3, strokeIndex: 5, avgStrokes: 4.3, avgVsPar: 0.3,
          avgPoints: 1.7, bestStrokes: 2,
        }), // within half a stroke over → neutral
      ]} />
    ));

    // Light theme (ThemeProvider default): bad = destructive, good = score
    // green, neutral = secondary text.
    expect(StyleSheet.flatten(getByText('+1.33').props.style).color)
      .toBe(semantic.destructive.light);
    expect(StyleSheet.flatten(getByText('-0.2').props.style).color)
      .toBe(semantic.score.good.light);
    expect(StyleSheet.flatten(getByText('+0.3').props.style).color)
      .toBe('#6b7280');
  });

  test('marks nemesis and best holes with red/gold dots when highlights are passed', () => {
    const { getByTestId } = render(wrap(
      <HoleBreakdownTable
        holes={[hole(), hole({ holeNumber: 2, avgVsPar: -0.2, avgStrokes: 3.8, avgPoints: 2.2, bestStrokes: 3 })]}
        highlights={{
          nemesis: { holeNumber: 1, avgVsPar: 1.33, timesPlayed: 3 },
          best: { holeNumber: 2, avgVsPar: -0.2, timesPlayed: 3 },
        }}
      />
    ));

    const nemesisDot = StyleSheet.flatten(getByTestId('hole-dot-nemesis').props.style);
    expect(nemesisDot.backgroundColor).toBe(semantic.destructive.light);
    const bestDot = StyleSheet.flatten(getByTestId('hole-dot-best').props.style);
    expect(bestDot.backgroundColor).toBe(semantic.winner.light);
  });

  test('renders no highlight dots without the highlights prop', () => {
    const { queryByTestId } = render(wrap(<HoleBreakdownTable holes={[hole()]} />));
    expect(queryByTestId('hole-dot-nemesis')).toBeNull();
    expect(queryByTestId('hole-dot-best')).toBeNull();
  });
});
