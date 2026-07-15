import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersScreen from '../PlayersScreen';
import { mutate } from '../../store/mutate';

// Task 5 (audit-tier3): the roster's base-handicap TextInput used to build
// `builtPlayers` with an unconditional `r.ok ? r.value : 0` fallback, so an
// unparseable value (or, before the handicap.js fix, a comma decimal on a
// comma-locale Android keyboard) got silently autosaved as a handicap of 0.
// The debounced autosave must now block the write (keeping the prior
// synced value) and flip the save pill to its error state instead.

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

describe('PlayersScreen base-handicap autosave (Task 5)', () => {
  beforeEach(() => {
    mutate.mockClear();
    mockCurrentTournament = mockTournament();
  });

  test('a comma-decimal handicap ("12,5") autosaves as 12.5, not 0', async () => {
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByLabelText, getByText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Player One')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Handicap for Player One'), '12,5');

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'tournament.updatePlayer',
          playerId: 'p1',
          patch: expect.objectContaining({ handicap: 12.5 }),
        }),
      );
    }, { timeout: 2000 });
  });

  test('a genuinely invalid handicap blocks the autosave and shows the error pill', async () => {
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByLabelText, getByText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Player One')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Handicap for Player One'), 'abc');

    await waitFor(() => expect(getByText('Save failed')).toBeTruthy(), { timeout: 2000 });
    expect(mutate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'tournament.updatePlayer' }),
    );
  });
});
