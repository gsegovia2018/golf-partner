import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { light } from '../../theme/tokens';
import RoundTeeAssignments from '../RoundTeeAssignments';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../store/tournamentStore', () => ({
  calcPlayingHandicap: jest.requireActual('../../store/scoring').calcPlayingHandicap,
  lastTeeForPlayerOnCourse: jest.fn(async () => null),
}));

const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const white = { label: 'Blancas', slope: 130, rating: 71 };
const gold = { label: 'Doradas', slope: 120, rating: 66.9 };
const round = { id: 'r0', courseId: null, tees: [white, gold], holes, playerTees: { p1: gold, p2: gold } };
const players = [
  { id: 'p1', name: 'Mario Member', handicap: 3 },
  { id: 'p2', name: 'Javi Friend', handicap: 25 },
];

async function setup(leagueLocks) {
  const onChange = jest.fn();
  const utils = render(
    <RoundTeeAssignments round={round} players={players} theme={light} onChange={onChange} leagueLocks={leagueLocks} />,
  );
  await flush();
  return { ...utils, onChange };
}

describe('RoundTeeAssignments league lock', () => {
  test('a carded player shows the league handicap and the playing handicap from it', async () => {
    const { getByText } = await setup({ p1: { leagueHandicap: 14.5, teeLocked: true } });
    expect(getByText('League handicap 14.5')).toBeTruthy();
    // 14.5 × 120/113 + (66.9 − 72) = 10.3 → 10, not 3's 0.
    expect(getByText('10')).toBeTruthy();
    // The other player is untouched.
    expect(getByText('Index 25')).toBeTruthy();
  });

  test('an announced card offers no tee, index or handicap edits', async () => {
    const { getByLabelText, queryByLabelText, getByText } = await setup({ p1: { leagueHandicap: 14.5, teeLocked: true } });
    fireEvent.press(getByLabelText(/^Mario Member,/));
    expect(getByText(/the league handicap and the tee are fixed/)).toBeTruthy();
    expect(queryByLabelText('Mario Member handicap index for this round')).toBeNull();
    expect(queryByLabelText('Increase Mario Member handicap')).toBeNull();
    expect(queryByLabelText('Blancas tee')).toBeNull();
  });

  test('before Start the tee stays pickable but the handicap is locked', async () => {
    const { getByLabelText, queryByLabelText, getByText } = await setup({ p1: { leagueHandicap: 14.5, teeLocked: false } });
    fireEvent.press(getByLabelText(/^Mario Member,/));
    expect(getByText(/plays off the league handicap/)).toBeTruthy();
    expect(queryByLabelText('Mario Member handicap index for this round')).toBeNull();
    fireEvent.press(getByLabelText('Blancas tee'));
    // 14.5 × 130/113 + (71 − 72) = 15.7 → 16.
    expect(getByText('16')).toBeTruthy();
  });

  test('an unlocked player keeps every editor', async () => {
    const { getByLabelText } = await setup(undefined);
    fireEvent.press(getByLabelText(/^Mario Member,/));
    expect(getByLabelText('Mario Member handicap index for this round')).toBeTruthy();
    expect(getByLabelText('Increase Mario Member handicap')).toBeTruthy();
  });
});
