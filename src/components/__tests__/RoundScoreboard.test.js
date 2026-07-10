import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundScoreboard from '../RoundScoreboard';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../store/tournamentStore', () => ({
  roundTotals: jest.fn((round, players) => players.map((p, i) => ({
    player: p,
    totalPoints: p.id === 'p2' ? 40 : 30,
    totalStrokes: 80 + i,
    handicap: 12,
  }))),
}));

const players = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Bea' },
];
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4 }));
const fullScores = Object.fromEntries(
  Array.from({ length: 18 }, (_, i) => [i + 1, 4]),
);

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundScoreboard', () => {
  test('renders a stat card per player, me first', () => {
    const { getByText, getAllByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p2"
      />,
    ));
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Bea')).toBeTruthy();
    // "Points" / "vs Par" labels appear once per player card — two players
    // means two matches, so assert presence via getAllByText rather than
    // the single-match getByText.
    expect(getAllByText('Points').length).toBe(2);
    expect(getAllByText('vs Par').length).toBe(2);
  });

  test('ranked mode orders by points and shows rank badges', () => {
    const { getByLabelText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p1"
        ranked
      />,
    ));
    // Bea has 40 pts (mock) -> rank 1
    expect(getByLabelText('Rank 1: Bea')).toBeTruthy();
    expect(getByLabelText('Rank 2: Ana')).toBeTruthy();
  });

  test('shows glowing HOLE badge only mid-round', () => {
    const partial = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [i + 1, 4]),
    );
    const { getByLabelText, rerender, queryByLabelText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: partial } }}
        players={[players[0]]}
        meId="p1"
      />,
    ));
    expect(getByLabelText('On hole 6')).toBeTruthy();

    rerender(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores } }}
        players={[players[0]]}
        meId="p1"
      />,
    ));
    expect(queryByLabelText(/On hole/)).toBeNull();
  });

  test('shows tee badge when teeLabels provided', () => {
    const { getByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p1"
        teeLabels={{ p1: { label: 'Yellow' } }}
      />,
    ));
    expect(getByText('Yellow')).toBeTruthy();
  });

  test('suppresses HOLE badge when showHoleBadges={false}', () => {
    const partial = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [i + 1, 4]),
    );
    const { queryByLabelText, getByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: partial } }}
        players={[players[0]]}
        meId="p1"
        showHoleBadges={false}
      />,
    ));
    expect(queryByLabelText(/On hole/)).toBeNull();
    expect(getByText('Points')).toBeTruthy();
  });
});
