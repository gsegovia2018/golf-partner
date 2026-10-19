import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SettleUpCard from '../SettleUpCard';

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      isDark: false,
      accent: { primary: '#006747', light: '#e6f0eb' },
      bg: { secondary: '#ece8e1' },
      border: { subtle: '#f0ede8' },
      text: { primary: '#1a1a1a', secondary: '#6b7280', muted: '#8a8a7a' },
    },
  }),
}));

// Scratch players on par-4 holes; Ben wins on points.
function game(names) {
  const players = names.map((name, i) => ({ id: `p${i}`, name, handicap: 0 }));
  const holes = [1, 2, 3].map((n) => ({ number: n, par: 4, strokeIndex: n }));
  const strokes = [[3, 4, 4], [4, 4, 5], [4, 5, 5]];
  return {
    id: 't1', name: 'Sábado', currentRound: 0, players,
    settings: { scoringMode: 'individual', stakes: { pot: 500, perPoint: 100, skin: 200 } },
    rounds: [{
      id: 't1-r0', holes,
      playerHandicaps: Object.fromEntries(players.map((p) => [p.id, 0])),
      scores: Object.fromEntries(players.map((p, i) => [p.id, { 1: strokes[i][0], 2: strokes[i][1], 3: strokes[i][2] }])),
    }],
  };
}

describe('SettleUpCard names', () => {
  test('players sharing a first word keep their full names', () => {
    const { getByText, queryByText } = render(<SettleUpCard tournament={game(['QA Ben', 'QA Carla', 'QA Ana'])} />);
    expect(getByText('QA Ana pays QA Ben')).toBeTruthy();
    expect(getByText('QA Carla')).toBeTruthy(); // money chip
    expect(queryByText(/pays QA$/)).toBeNull();
  });

  test('distinct first names stay short', () => {
    const { getByText } = render(<SettleUpCard tournament={game(['Ben Ruiz', 'Carla Gómez', 'Ana Arteta'])} />);
    expect(getByText('Ana pays Ben')).toBeTruthy();
  });

  test('a breakdown amount never splits from its sign', () => {
    const { getByText, getByLabelText } = render(<SettleUpCard tournament={game(['QA Ben', 'QA Carla', 'QA Ana'])} />);
    fireEvent.press(getByLabelText(/^QA Ana pays QA Ben/));
    const line = getByText(/^Pot/).props.children;
    expect(line).toMatch(/Skins −⁠€/);
    expect(line).not.toMatch(/(Pot|Points|Skins) [−+]/);
  });
});
