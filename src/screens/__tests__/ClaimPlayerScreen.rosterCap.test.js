import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ClaimPlayerScreen from '../ClaimPlayerScreen';

// Task 3 (audit-tier3): "roster full" must be kind-aware, same as the setup
// wizard — a tournament isn't full at 4 players (rosterCap('tournament') =
// 24), only a casual game is (rosterCap('game') = 4).

function fourUnclaimedPlayers() {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: 10, user_id: null,
  }));
}

function mockTournament(kind) {
  return {
    id: 't1',
    kind,
    players: fourUnclaimedPlayers(),
  };
}

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ userId: 'me-1', displayName: 'Me', handicap: 9 })),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me-1', is_anonymous: false } }),
}));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn() }));

let mockCurrentTournament;
jest.mock('../../store/tournamentStore', () => ({
  getTournament: jest.fn(() => Promise.resolve(mockCurrentTournament)),
  addPlayerRoundPatches: jest.fn(),
  claimTournamentPlayer: jest.fn(),
  refreshTournamentFromRemote: jest.fn(),
  tournamentNoun: (t) => (t?.kind === 'game' ? 'game' : 'tournament'),
  rosterCap: (kind) => (kind === 'game' ? 4 : 24),
}));

const navigation = { goBack: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('ClaimPlayerScreen roster-full is kind-aware (Task 3)', () => {
  test('a tournament with 4 players is NOT full — joiner can still add themselves', async () => {
    mockCurrentTournament = mockTournament('tournament');
    const route = { params: { tournamentId: 't1' } };
    const { getByText, queryByText } = render(wrap(<ClaimPlayerScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText("I'm not listed — add me")).toBeTruthy();
    });
    expect(queryByText(/already has 4 players/)).toBeNull();
  });

  test('a casual game with 4 players IS full — add-yourself is blocked', async () => {
    mockCurrentTournament = mockTournament('game');
    const route = { params: { tournamentId: 't1' } };
    const { getByText, queryByText } = render(wrap(<ClaimPlayerScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText(/already has 4 players/)).toBeTruthy();
    });
    expect(queryByText("I'm not listed — add me")).toBeNull();
  });
});
