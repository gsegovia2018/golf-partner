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

// A saved round stamps every player's index into round.playerIndexes, so the
// tee editor used to keep recomputing the playing handicap from the OLD index
// after the base handicap was edited. Editing the base must carry through to
// the round's index and playing handicap — unless the round index was a
// deliberate per-round override.
describe('PlayersScreen base-handicap edit updates the game\'s playing handicap', () => {
  const tee = { label: 'White', slope: 113, rating: 72 };
  function tournamentWithRound(playerIndexes) {
    return {
      ...mockTournament(),
      currentRound: 0,
      rounds: [{
        id: 'r1',
        courseName: 'Test Course',
        holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
        tees: [tee],
        playerTees: { p1: tee },
        playerHandicaps: { p1: 10 },
        manualHandicaps: {},
        playerIndexes,
        scores: { p1: { 1: 5 } },
      }],
    };
  }

  beforeEach(() => mutate.mockClear());

  test('a round index tracking the base follows the new base', async () => {
    mockCurrentTournament = tournamentWithRound({ p1: 10 });
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByLabelText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByLabelText('Handicap for Player One')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Handicap for Player One'), '14');

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'handicap.set', roundId: 'r1', playerId: 'p1', handicap: 14 }),
      );
    }, { timeout: 2000 });
    expect(mutate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'index.set', roundId: 'r1', playerId: 'p1', index: 14 }),
    );
  });

  test('a deliberate per-round index override is kept', async () => {
    mockCurrentTournament = tournamentWithRound({ p1: 8 });
    const route = { params: { tournamentId: 't1', tournamentName: 'Test' } };
    const { getByLabelText } = render(wrap(<PlayersScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByLabelText('Handicap for Player One')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Handicap for Player One'), '14');

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'tournament.updatePlayer', patch: expect.objectContaining({ handicap: 14 }) }),
      );
    }, { timeout: 2000 });
    expect(mutate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'index.set', index: 14 }),
    );
  });
});
