import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundRecapPanel from '../RoundRecapPanel';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const recap = { winnerName: 'Ana', winnerPoints: 38, margin: 4, winnerStrokes: 82, holesPlayed: 18, playerCount: 2 };

describe('RoundRecapPanel', () => {
  test('shows a "Winner" pill and the finished meta line when the round is over', () => {
    const { getByText } = render(wrap(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        live={false}
        totalHoles={18}
      />,
    ));
    expect(getByText('Winner: Ana')).toBeTruthy();
    expect(getByText('18 holes')).toBeTruthy();
    expect(getByText('2 players')).toBeTruthy();
  });

  test('shows a "Leading" pill and the in-progress meta line while live', () => {
    const liveRecap = { ...recap, holesPlayed: 9 };
    const { getByText } = render(wrap(
      <RoundRecapPanel
        recap={liveRecap}
        roundLabel="Round 1"
        live
        totalHoles={18}
      />,
    ));
    expect(getByText('Leading: Ana')).toBeTruthy();
    expect(getByText('9/18 holes')).toBeTruthy();
  });

  test('no longer renders the old stat tiles, highlight chips, or summary sentence', () => {
    const { queryByText } = render(wrap(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        live={false}
        totalHoles={18}
      />,
    ));
    expect(queryByText('Ana won the round.')).toBeNull();
    expect(queryByText(/Leader pts/i)).toBeNull();
    expect(queryByText(/Margin/i)).toBeNull();
    expect(queryByText(/birdies|pars|bogeys|eagle/i)).toBeNull();
  });

  test('omits the winner pill when there is no recap yet', () => {
    const { queryByText } = render(wrap(
      <RoundRecapPanel
        recap={null}
        roundLabel="Round 1"
        live={false}
        totalHoles={18}
      />,
    ));
    expect(queryByText(/Winner:|Leading:/)).toBeNull();
  });
});
