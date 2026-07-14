import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersScreen from '../PlayersScreen';

// Task 3 (audit-tier3): the "Add" button on the post-creation Players/roster
// screen must respect the kind-aware rosterCap too — a tournament with 4
// players already on the roster can still grow (cap 24), a casual game
// cannot (cap 4). Without this fix, lifting the wizard's cap would be
// pointless: you could never add a 5th player to a tournament afterwards.

function fourPlayers() {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: 10,
  }));
}

function mockTournament(kind) {
  return {
    id: 't1',
    kind,
    name: 'Test',
    players: fourPlayers(),
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

jest.mock('../../store/mutate', () => ({ mutate: jest.fn() }));
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

describe('PlayersScreen roster Add button respects kind-aware cap (Task 3)', () => {
  test('a tournament at 4 players still shows Add (cap is 24, not 4)', async () => {
    mockCurrentTournament = mockTournament('tournament');
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText('Player 4')).toBeTruthy();
    });
    expect(getByText('Add')).toBeTruthy();
  });

  test('a casual game at 4 players hides Add (cap is 4)', async () => {
    mockCurrentTournament = mockTournament('game');
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByText, queryByText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText('Player 4')).toBeTruthy();
    });
    expect(queryByText('Add')).toBeNull();
  });
});
