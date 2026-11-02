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

  describe('pace', () => {
    const tenHoles = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 4]));
    const at = (h, m) => new Date(2026, 10, 2, h, m).getTime();
    const round = { holes, scores: { p1: tenHoles, p2: tenHoles } };

    test('with light to spare: holes played and the finish time, no dusk mark', async () => {
      const pace = { level: 'ok', finishAt: at(15, 40), dusk: at(18, 40), darkHole: null, darkAfter: null };
      const { getByText, queryByTestId } = render(wrap(
        <RoundScoreboard round={round} players={players} meId="p1" pace={pace} />,
      ));
      await flush();
      expect(getByText(/10\/18 · done ≈ 15:40/)).toBeTruthy();
      expect(queryByTestId('round-progress-dusk')).toBeNull();
    });

    test('at risk: the hole where light runs out, and the dusk mark on the bar', async () => {
      const pace = { level: 'risk', finishAt: at(19, 6), dusk: at(18, 40), darkHole: 17, darkAfter: 6 };
      const { getByText, getByTestId, getByLabelText } = render(wrap(
        <RoundScoreboard round={round} players={players} meId="p1" pace={pace} />,
      ));
      await flush();
      expect(getByText(/dark by hole 17/)).toBeTruthy();
      expect(getByLabelText('Daylight runs out on hole 17, at 18:40')).toBeTruthy();
      // 10 played + 6 more in daylight = 16 of 18
      expect(getByTestId('round-progress-dusk').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ left: '89%' })]),
      );
    });

    test('tight: the finish time and until when there is light', async () => {
      const pace = { level: 'tight', finishAt: at(18, 32), dusk: at(18, 40), darkHole: null, darkAfter: null };
      const { getByText, queryByTestId } = render(wrap(
        <RoundScoreboard round={round} players={players} meId="p1" pace={pace} />,
      ));
      await flush();
      expect(getByText(/done 18:32 · /)).toBeTruthy();
      expect(getByText(/light until 18:40/)).toBeTruthy();
      expect(queryByTestId('round-progress-dusk')).toBeNull();
    });

    test('without pace: the plain holes-played count', async () => {
      const { getByText } = render(wrap(<RoundScoreboard round={round} players={players} meId="p1" />));
      await flush();
      expect(getByText('10 / 18')).toBeTruthy();
    });
  });
});
