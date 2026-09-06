import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundRecapPanel from '../RoundRecapPanel';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const recap = { winnerName: 'Ana', winnerPoints: 38, margin: 4, winnerStrokes: 82, holesPlayed: 18, playerCount: 2 };

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderPanel(ui) {
  const utils = render(wrap(ui));
  await flush();
  return utils;
}

describe('RoundRecapPanel', () => {
  test('shows a "Winner" pill and the finished meta line when the round is over', async () => {
    const { getByText } = await renderPanel(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        live={false}
        totalHoles={18}
      />,
    );
    expect(getByText('Winner: Ana')).toBeTruthy();
    expect(getByText('18 holes')).toBeTruthy();
    expect(getByText('2 players')).toBeTruthy();
  });

  test('shows a "Leading" pill and the in-progress meta line while live', async () => {
    const liveRecap = { ...recap, holesPlayed: 9 };
    const { getByText } = await renderPanel(
      <RoundRecapPanel
        recap={liveRecap}
        roundLabel="Round 1"
        live
        totalHoles={18}
      />,
    );
    expect(getByText('Leading: Ana')).toBeTruthy();
    expect(getByText('9/18 holes')).toBeTruthy();
  });

  test('no longer renders the old stat tiles, highlight chips, or summary sentence', async () => {
    const { queryByText } = await renderPanel(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        live={false}
        totalHoles={18}
      />,
    );
    expect(queryByText('Ana won the round.')).toBeNull();
    expect(queryByText(/Leader pts/i)).toBeNull();
    expect(queryByText(/Margin/i)).toBeNull();
    expect(queryByText(/birdies|pars|bogeys|eagle/i)).toBeNull();
  });

  test('appends the round duration to the meta line when known', async () => {
    const { getByText, queryByTestId, rerender } = await renderPanel(
      <RoundRecapPanel recap={recap} roundLabel="Round 1" live={false} totalHoles={18} durationLabel="3h 52m" />,
    );
    expect(getByText('3h 52m')).toBeTruthy();
    rerender(wrap(<RoundRecapPanel recap={recap} roundLabel="Round 1" live={false} totalHoles={18} />));
    expect(queryByTestId('round-recap-duration')).toBeNull();
  });

  test('omits the winner pill when there is no recap yet', async () => {
    const { queryByText } = await renderPanel(
      <RoundRecapPanel
        recap={null}
        roundLabel="Round 1"
        live={false}
        totalHoles={18}
      />,
    );
    expect(queryByText(/Winner:|Leading:/)).toBeNull();
  });
});
