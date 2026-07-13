import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundLeaderboard from '../RoundLeaderboard';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));

const players = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Bea' },
];

function makeRound(playedByPlayer) {
  return {
    holes,
    scores: Object.fromEntries(Object.entries(playedByPlayer).map(([id, count]) => [
      id,
      Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, 4])),
    ])),
  };
}

const entries = [
  { player: players[0], points: 19, strokes: 37, handicap: 3 },
  { player: players[1], points: 12, strokes: 41, handicap: NaN },
];

describe('RoundLeaderboard', () => {
  test('renders both players ranked with points and strokes', () => {
    const round = makeRound({ p1: 9, p2: 9 });
    const { getByText } = render(wrap(
      <RoundLeaderboard entries={entries} round={round} live={false} />,
    ));
    expect(getByText('LEADERBOARD')).toBeTruthy();
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Bea')).toBeTruthy();
    expect(getByText('19 pts')).toBeTruthy();
    expect(getByText('37 str')).toBeTruthy();
  });

  test('renders nothing with fewer than 2 entries', () => {
    const round = makeRound({ p1: 9 });
    const { toJSON } = render(wrap(
      <RoundLeaderboard entries={[entries[0]]} round={round} live={false} />,
    ));
    expect(toJSON()).toBeNull();
  });

  test('shows the glowing HOLE badge for a player mid-round while live', () => {
    const round = makeRound({ p1: 9, p2: 5 });
    const { getByLabelText } = render(wrap(
      <RoundLeaderboard entries={entries} round={round} live totalHoles={18} />,
    ));
    expect(getByLabelText('On hole 10')).toBeTruthy();
  });

  test('hides the HOLE badge when the round is not live, even with the same scores', () => {
    const round = makeRound({ p1: 9, p2: 9 });
    const { queryByLabelText } = render(wrap(
      <RoundLeaderboard entries={entries} round={round} live={false} />,
    ));
    expect(queryByLabelText('On hole 10')).toBeNull();
  });

  test('renders the HCP sub-label when the handicap is a finite number', () => {
    const round = makeRound({ p1: 9, p2: 9 });
    const { getByText, queryByText } = render(wrap(
      <RoundLeaderboard entries={entries} round={round} live={false} />,
    ));
    expect(getByText('HCP 3')).toBeTruthy();
    expect(queryByText(/HCP NaN/)).toBeNull();
  });

  test('renders points with a non-default unit label (e.g. matchplay holes)', () => {
    const round = makeRound({ p1: 9, p2: 9 });
    const matchPlayEntries = [
      { player: players[0], points: 5, strokes: 37 },
      { player: players[1], points: 3, strokes: 41 },
    ];
    const { getByText } = render(wrap(
      <RoundLeaderboard entries={matchPlayEntries} unit="holes" round={round} live={false} />,
    ));
    expect(getByText('5 holes')).toBeTruthy();
    expect(getByText('3 holes')).toBeTruthy();
  });

  test('omits the strokes column for team entries that carry no strokes', () => {
    const round = makeRound({ p1: 9, p2: 9 });
    const teamEntries = [
      { player: players[0], points: 4 },
      { player: players[1], points: 0 },
    ];
    const { queryByText } = render(wrap(
      <RoundLeaderboard entries={teamEntries} round={round} live={false} />,
    ));
    expect(queryByText(/str$/)).toBeNull();
  });
});
