import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import JoinLeagueScreen from '../JoinLeagueScreen';

jest.mock('../../store/leagueStore', () => ({
  getLeagueByCode: jest.fn(),
  joinLeague: jest.fn(),
}));
jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ handicap: 21.8 })),
}));
const mockAuth = { user: null };
jest.mock('../../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../lib/guestAccount', () => {
  const actual = jest.requireActual('../../lib/guestAccount');
  return { ...actual, attachEmailToGuest: jest.fn() };
});
jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: jest.fn(() => Promise.resolve({ error: null })) } },
}));

const store = require('../../store/leagueStore');
const { loadProfile } = require('../../store/profileStore');
const { attachEmailToGuest } = require('../../lib/guestAccount');
const { supabase } = require('../../lib/supabase');
const handoff = require('../../lib/leagueJoinHandoff');

const SUMMARY = {
  id: 'L1', name: 'El Club del Mulligan', handicapCap: 30, entryFeeCents: 3000, archived: false,
  adminName: 'Marcos', memberCount: 7, proposedHandicap: 22.5, isMember: false,
  pointsTable: [500, 300], seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
};
const navigation = { goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
const route = { params: { code: 'MULL-7Q4' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('JoinLeagueScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.user = null;
    store.getLeagueByCode.mockResolvedValue(SUMMARY);
    store.joinLeague.mockResolvedValue({ leagueId: 'L1' });
    attachEmailToGuest.mockResolvedValue('sent');
    handoff.consumeLoginTab();
  });

  test('shows the league, the rules and the proposed handicap, then joins and opens the board', async () => {
    const { getByText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('El Club del Mulligan'));
    expect(getByText('MARCOS INVITED YOU')).toBeTruthy();
    expect(getByText('7 members')).toBeTruthy();
    expect(getByText('Entry 30 €')).toBeTruthy();
    expect(getByText('22.5')).toBeTruthy();
    expect(getByText(/Proposed by Marcos\. Your index is 21\.8\./)).toBeTruthy();

    fireEvent.press(getByText('Join El Club del Mulligan'));
    await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL-7Q4', 22.5));
    expect(navigation.replace).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });

  test('Propose another lets the member send their own handicap, clamped to the cap', async () => {
    const { getByText, getByLabelText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Propose another'));
    fireEvent.press(getByText('Propose another'));
    fireEvent.changeText(getByLabelText('Proposed league handicap'), '40');
    fireEvent.press(getByText('Join El Club del Mulligan'));
    await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL-7Q4', 30));
  });

  test('a second tap while joining does not join twice', async () => {
    let release;
    store.joinLeague.mockReturnValue(new Promise((r) => { release = r; }));
    const { getByText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Join El Club del Mulligan'));
    fireEvent.press(getByText('Join El Club del Mulligan'));
    fireEvent.press(getByText('Join El Club del Mulligan'));
    release({ leagueId: 'L1' });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(store.joinLeague).toHaveBeenCalledTimes(1);
  });

  test('shows the server message when joining fails and stays on the screen', async () => {
    store.joinLeague.mockRejectedValue(new Error('This league is archived.'));
    const { getByText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Join El Club del Mulligan'));
    fireEvent.press(getByText('Join El Club del Mulligan'));
    await waitFor(() => getByText('This league is archived.'));
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('an existing member is sent to the board instead of joining again', async () => {
    store.getLeagueByCode.mockResolvedValue({ ...SUMMARY, isMember: true });
    const { getByText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText("You're in. Open the league"));
    fireEvent.press(getByText("You're in. Open the league"));
    expect(navigation.replace).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
    expect(store.joinLeague).not.toHaveBeenCalled();
  });

  test('an unknown code shows the invalid-code state', async () => {
    store.getLeagueByCode.mockResolvedValue(null);
    const { getByText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText("This invite code isn't valid"));
  });

  test('a real account is not asked for name or email', async () => {
    mockAuth.user = { id: 'u1', is_anonymous: false, email: 'marcos@example.com' };
    const { getByText, queryByLabelText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Join El Club del Mulligan'));
    expect(queryByLabelText('Name')).toBeNull();
    expect(queryByLabelText('Email')).toBeNull();
  });

  describe('a guest (anonymous session)', () => {
    beforeEach(() => {
      mockAuth.user = { id: 'g1', is_anonymous: true, email: null };
      loadProfile.mockResolvedValue({ handicap: null, displayName: '' });
    });

    test('must give a name and an email before joining', async () => {
      const { getByText, getByLabelText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
      await waitFor(() => getByLabelText('Name'));
      fireEvent.press(getByText('Join El Club del Mulligan'));
      await waitFor(() => getByText('Enter your name'));
      expect(getByText('Enter a valid email address')).toBeTruthy();
      expect(store.joinLeague).not.toHaveBeenCalled();
      expect(attachEmailToGuest).not.toHaveBeenCalled();
    });

    test('attaches the email, then joins with the handicap and the name', async () => {
      const { getByText, getByLabelText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
      await waitFor(() => getByLabelText('Name'));
      fireEvent.changeText(getByLabelText('Name'), '  Lucía Pérez ');
      fireEvent.changeText(getByLabelText('Email'), 'lucia@example.com');
      fireEvent.press(getByText('Join El Club del Mulligan'));
      await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL-7Q4', 22.5, 'Lucía Pérez'));
      expect(attachEmailToGuest).toHaveBeenCalledWith({ email: 'lucia@example.com', name: '  Lucía Pérez ' });
      expect(navigation.replace).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
    });

    test('an email already pending confirmation is not sent again', async () => {
      mockAuth.user = { id: 'g1', is_anonymous: true, email: null, new_email: 'lucia@example.com' };
      loadProfile.mockResolvedValue({ handicap: null, displayName: 'Lucía' });
      const { getByText, getByLabelText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
      await waitFor(() => expect(getByLabelText('Name').props.value).toBe('Lucía'));
      expect(getByLabelText('Email').props.value).toBe('lucia@example.com');
      fireEvent.press(getByText('Join El Club del Mulligan'));
      await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL-7Q4', 22.5, 'Lucía'));
      expect(attachEmailToGuest).not.toHaveBeenCalled();
    });

    test('email already registered: shows the log-in error; the link signs the guest out to the account tab', async () => {
      attachEmailToGuest.mockRejectedValue(Object.assign(new Error('already registered'), { code: 'email_exists' }));
      const { getByText, getByLabelText } = render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
      await waitFor(() => getByLabelText('Name'));
      fireEvent.changeText(getByLabelText('Name'), 'Lucía');
      fireEvent.changeText(getByLabelText('Email'), 'taken@example.com');
      fireEvent.press(getByText('Join El Club del Mulligan'));
      await waitFor(() => getByText('Log in instead'));
      expect(store.joinLeague).not.toHaveBeenCalled();
      fireEvent.press(getByText('Log in instead'));
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(handoff.consumeLoginTab()).toBe(true);
    });
  });

  test('right after joining from the invite screen it goes straight to the board', async () => {
    store.getLeagueByCode.mockResolvedValue({ ...SUMMARY, isMember: true });
    handoff.markJustJoined('mull-7q4');
    render(wrap(<JoinLeagueScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' }));
  });
});
