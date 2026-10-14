import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import JoinTournamentScreen from '../JoinTournamentScreen';

// "Join with code" also takes a league's invite code: when the tournament
// lookup finds nothing, the code is tried as a league code.

jest.mock('../../store/tournamentStore', () => ({
  joinTournamentByCode: jest.fn(),
  setActiveTournament: jest.fn(),
  getTournament: jest.fn(),
  findClaimedSlot: jest.fn(),
}));
jest.mock('../../store/leagueStore', () => ({ leagueCodeExists: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn() } } }));

const tournaments = require('../../store/tournamentStore');
const leagues = require('../../store/leagueStore');

const nav = () => ({ goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() });
const mount = (navigation, code = 'ABCD2345') => render(
  <ThemeProvider><JoinTournamentScreen navigation={navigation} route={{ params: { code } }} /></ThemeProvider>,
);

describe('JoinTournamentScreen league fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => Alert.alert.mockRestore());

  test('an unknown tournament code that is a league code opens the league join screen', async () => {
    tournaments.joinTournamentByCode.mockRejectedValue(new Error('Invalid code'));
    leagues.leagueCodeExists.mockResolvedValue(true);
    const navigation = nav();
    mount(navigation);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('JoinLeague', { code: 'ABCD2345' }));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('neither a tournament nor a league: the tournament error is shown', async () => {
    tournaments.joinTournamentByCode.mockRejectedValue(new Error('Invalid code'));
    leagues.leagueCodeExists.mockResolvedValue(false);
    const navigation = nav();
    mount(navigation);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Error', 'Invalid code'));
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('a real tournament code with another failure (revoked) never tries the league', async () => {
    tournaments.joinTournamentByCode.mockRejectedValue(new Error('This invite code has been revoked'));
    const navigation = nav();
    mount(navigation);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    await act(async () => {});
    expect(leagues.leagueCodeExists).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
