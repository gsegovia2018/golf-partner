import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CardHoleGrid from '../CardHoleGrid';

const perHole = Array.from({ length: 18 }, (_, i) => ({
  n: i + 1, strokes: i === 0 ? 9 : 5, points: i === 0 ? 0 : 2, extra: 0, counted: i === 0 ? 40 : 5, capped: i === 0,
}));
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('CardHoleGrid', () => {
  test('Stableford: strokes, points underneath and the legend (a capped hole is explained)', () => {
    const { getByText, getByLabelText } = render(wrap(<CardHoleGrid perHole={perHole} />));
    expect(getByText(/small number = points/)).toBeTruthy();
    expect(getByLabelText('Hole 1, 9 strokes, 0 points, counts as 40')).toBeTruthy();
  });

  test('medal: strokes only, no points, caps or legend', () => {
    const { queryByText, getByLabelText, queryByLabelText } = render(wrap(<CardHoleGrid perHole={perHole} medal />));
    expect(queryByText(/small number = points/)).toBeNull();
    expect(getByLabelText('Hole 1, 9 strokes')).toBeTruthy();
    expect(queryByLabelText(/points/)).toBeNull();
    // The capped badge ("counts as 40") is not drawn: every stroke counts.
    expect(queryByText('40')).toBeNull();
  });
});
