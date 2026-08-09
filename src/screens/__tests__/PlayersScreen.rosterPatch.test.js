import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersScreen from '../PlayersScreen';
import { mutate } from '../../store/mutate';

// The roster autosave used to push EVERY player's whole editPlayers row
// through tournament.updatePlayer on every debounced save. Because that
// snapshot can be stale (another device renamed a player or claimed a slot
// since this screen loaded), each save re-asserted old names and wiped
// user_id claims roster-wide. The autosave must now emit a patch only for
// players whose screen-owned fields (handicap, friend-link user_id) actually
// changed, and the patch must carry only those fields.

function twoPlayers() {
  return [
    { id: 'p1', name: 'Player One', handicap: 10 },
    { id: 'p2', name: 'Player Two', handicap: 18, user_id: 'u-2' },
  ];
}

function mockTournament() {
  return {
    id: 't1',
    kind: 'tournament',
    name: 'Test',
    players: twoPlayers(),
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

describe('PlayersScreen roster autosave patches only owned, changed fields', () => {
  beforeEach(() => {
    mutate.mockClear();
    mockCurrentTournament = mockTournament();
  });

  test('editing one handicap emits one minimal patch — never the whole roster', async () => {
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByLabelText, getByText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Player One')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Handicap for Player One'), '12.5');

    await waitFor(() => {
      const calls = mutate.mock.calls.filter(([, m]) => m.type === 'tournament.updatePlayer');
      expect(calls).toHaveLength(1);
      // The patch carries ONLY the changed owned field: no name, no user_id —
      // a stale copy of either would revert a concurrent device's rename/claim.
      expect(calls[0][1]).toEqual({
        type: 'tournament.updatePlayer',
        playerId: 'p1',
        patch: { handicap: 12.5 },
      });
    }, { timeout: 2000 });
  });
});
