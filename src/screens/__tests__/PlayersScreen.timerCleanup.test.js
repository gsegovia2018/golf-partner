import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersScreen from '../PlayersScreen';
import { mutate } from '../../store/mutate';

// Task 6 (audit-tier3): the debounced autosave setTimeout was never cleared
// on unmount. Navigating away within the 400ms debounce window used to let
// the timer fire anyway, running setState/Alert against an unmounted
// screen (React "state update on an unmounted component" warning) and
// persisting a save the user had already navigated away from.

function onePlayer() {
  return [{ id: 'p1', name: 'Player One', handicap: 10 }];
}

function mockTournament() {
  return {
    id: 't1',
    kind: 'tournament',
    name: 'Test',
    players: onePlayer(),
    rounds: [],
    settings: { scoringMode: 'stableford' },
  };
}

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me-1' } }),
}));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn((t) => Promise.resolve(t)) }));
jest.mock('../../store/friendStore', () => ({
  listFriends: jest.fn(() => Promise.resolve([])),
  getCachedFriends: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}) } }));

let mockCurrentTournament;
jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    getTournament: jest.fn(() => Promise.resolve(mockCurrentTournament)),
    getTournamentSnapshot: jest.fn(() => mockCurrentTournament),
    loadTournamentMembers: jest.fn(() => Promise.resolve([])),
    subscribeTournamentChanges: jest.fn(() => () => {}),
    removeTournamentMember: jest.fn(),
    generateInviteCode: jest.fn(),
    releaseTournamentPlayer: jest.fn(),
    addPlayerRoundPatches: jest.fn(),
    removePlayerRoundPatches: jest.fn(),
    findClaimedSlot: jest.fn(() => null),
    buildJoinLink: jest.fn(() => ''),
  };
});

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => {}) };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('PlayersScreen autosave timer cleanup on unmount (Task 6)', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    mutate.mockClear();
    mockCurrentTournament = mockTournament();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('unmounting before the debounce fires cancels the pending autosave', async () => {
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByLabelText, getByText, unmount } = render(
      wrap(<PlayersScreen navigation={navigation} route={route} />),
    );
    await waitFor(() => expect(getByText('Player One')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Handicap for Player One'), '15');

    // Unmount well within the 400ms debounce window, before the timer fires.
    unmount();

    // Give the (cleared) timer's window plenty of time to elapse. If the
    // timeout weren't cleared on unmount, its callback would fire here and
    // call mutate()/setState against the unmounted tree.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(mutate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'tournament.updatePlayer' }),
    );
    const stateUpdateWarnings = consoleErrorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("Can't perform a React state update on an unmounted component"),
    );
    expect(stateUpdateWarnings).toHaveLength(0);
  });
});
