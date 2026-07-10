import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundRecapPanel from '../RoundRecapPanel';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const recap = { winnerName: 'Ana', winnerPoints: 38, margin: 4, winnerStrokes: 82, holesPlayed: 18, playerCount: 2 };

describe('RoundRecapPanel highlights', () => {
  test('renders highlight chips for non-zero counts only', () => {
    const { getByText, queryByText } = render(wrap(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        summary="Ana won the round."
        highlights={{ eagles: 0, birdies: 3, pars: 10, bogeys: 4, doubles: 1 }}
      />,
    ));
    expect(getByText('3 birdies')).toBeTruthy();
    expect(getByText('10 pars')).toBeTruthy();
    expect(getByText('4 bogeys')).toBeTruthy();
    expect(getByText('1 double+')).toBeTruthy();
    expect(queryByText(/eagle/)).toBeNull();
  });

  test('hides the highlights row when all counts are zero', () => {
    const { queryByText } = render(wrap(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        summary="Ana won the round."
        highlights={{ eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 }}
      />,
    ));
    expect(queryByText(/birdies|pars|bogeys/)).toBeNull();
  });
});
