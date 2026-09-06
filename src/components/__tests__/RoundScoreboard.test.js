import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundScoreboard from '../RoundScoreboard';

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

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
  test('renders a stat card per player, me first', async () => {
    const { getByText, getAllByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p2"
      />,
    ));
    await flush();
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Bea')).toBeTruthy();
    // "Points" / "vs Par" labels appear once per player card — two players
    // means two matches, so assert presence via getAllByText rather than
    // the single-match getByText.
    expect(getAllByText('Points').length).toBe(2);
    expect(getAllByText('vs Par').length).toBe(2);
  });

  test('ranked mode orders by points and shows rank badges', async () => {
    const { getByLabelText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p1"
        ranked
      />,
    ));
    await flush();
    // Bea has 40 pts (mock) -> rank 1
    expect(getByLabelText('Rank 1: Bea')).toBeTruthy();
    expect(getByLabelText('Rank 2: Ana')).toBeTruthy();
  });

  test('shows glowing HOLE badge only mid-round', async () => {
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
    await flush();
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

  test('shows tee badge when teeLabels provided', async () => {
    const { getByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p1"
        teeLabels={{ p1: { label: 'Yellow' } }}
      />,
    ));
    await flush();
    expect(getByText('Yellow')).toBeTruthy();
  });

  test('scramble round: both teammates show the team ball, not just the captain', async () => {
    // Team ball is stored under the captain (pair[0]). The non-captain teammate
    // must still show scores (strokes/vs Par), not a blank card.
    const capScores = Object.fromEntries(
      Array.from({ length: 18 }, (_, i) => [i + 1, 4]),
    );
    const scramblePlayers = [
      { id: 'cap', name: 'Captain' },
      { id: 'mate', name: 'Teammate' },
    ];
    const { getAllByText, queryAllByText } = render(wrap(
      <RoundScoreboard
        round={{
          holes,
          pairs: [[scramblePlayers[0], scramblePlayers[1]]],
          scores: { cap: capScores }, // only the captain holds the ball
        }}
        players={scramblePlayers}
        meId="cap"
        scoringMode="scramblepairs"
      />,
    ));
    await flush();
    // 18 pars → 72 strokes, E vs par — both cards show the team's strokes.
    expect(getAllByText('72').length).toBe(2);
    // Neither card is blank: no "—" strokes placeholder for the teammate.
    expect(queryAllByText('—').length).toBe(0);
  });

  test('suppresses HOLE badge when showHoleBadges={false}', async () => {
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
    await flush();
    expect(queryByLabelText(/On hole/)).toBeNull();
    expect(getByText('Points')).toBeTruthy();
  });
});
