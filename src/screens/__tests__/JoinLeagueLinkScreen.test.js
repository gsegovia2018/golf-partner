import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import JoinLeagueLinkScreen from '../JoinLeagueLinkScreen';

jest.mock('../../store/leagueStore', () => ({
  getLeagueInvitePreview: jest.fn(),
  getLeagueInvitee: jest.fn(),
  joinLeague: jest.fn(),
}));
jest.mock('../../lib/oauth', () => ({
  signInAnonymously: jest.fn(),
}));
jest.mock('../../lib/guestAccount', () => {
  const actual = jest.requireActual('../../lib/guestAccount');
  return { ...actual, attachEmailToGuest: jest.fn() };
});
jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: jest.fn(() => Promise.resolve({ error: null })) } },
}));
// The account tab's form is AuthScreen's; its own behaviour is tested there.
jest.mock('../../components/AuthForm', () => {
  const { Text } = require('react-native');
  return function AuthFormStub({ mode }) { return <Text>{`AuthForm:${mode}`}</Text>; };
});
jest.mock('../AuthScreen', () => {
  const { Text } = require('react-native');
  return function AuthScreenStub() { return <Text>AuthScreen</Text>; };
});

const store = require('../../store/leagueStore');
const { signInAnonymously } = require('../../lib/oauth');
const { attachEmailToGuest } = require('../../lib/guestAccount');
const { supabase } = require('../../lib/supabase');
const handoff = require('../../lib/leagueJoinHandoff');

const PREVIEW = {
  name: 'El Club del Mulligan', adminFirstName: 'Javi', memberCount: 7,
  entryFeeCents: 3000, handicapCap: 30, archived: false,
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const renderScreen = () => render(wrap(<JoinLeagueLinkScreen code="MULL7Q4K" />));

async function fillForm(utils, { name = 'Lucía Pérez', email = 'lucia@example.com', hcp = '24' } = {}) {
  fireEvent.changeText(utils.getByLabelText('Name'), name);
  fireEvent.changeText(utils.getByLabelText('Email'), email);
  fireEvent.changeText(utils.getByLabelText('Handicap'), hcp);
}

describe('JoinLeagueLinkScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getLeagueInvitePreview.mockResolvedValue(PREVIEW);
    store.joinLeague.mockResolvedValue({ leagueId: 'L1' });
    signInAnonymously.mockResolvedValue({});
    attachEmailToGuest.mockResolvedValue('sent');
    handoff.releaseLeagueJoin();
    handoff.consumeJustJoined('MULL7Q4K');
    handoff.consumeLoginTab();
  });

  test('shows the invite hero from the anon preview', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => getByText('El Club del Mulligan'));
    expect(getByText('JAVI INVITED YOU')).toBeTruthy();
    expect(getByText(/^7 members · \w+ open · entry 30 €$/)).toBeTruthy();
    expect(getByText("I'm new")).toBeTruthy();
    expect(getByText('I have an account')).toBeTruthy();
    expect(getByText(/League cap 30\.0\. Javi confirms it/)).toBeTruthy();
  });

  test('the account tab shows the sign-in form, and back', async () => {
    const utils = renderScreen();
    await waitFor(() => utils.getByText('I have an account'));
    expect(utils.queryByText('AuthForm:signin')).toBeNull();
    fireEvent.press(utils.getByText('I have an account'));
    await waitFor(() => utils.getByText('AuthForm:signin'));
    expect(utils.queryByLabelText('Name')).toBeNull();
    fireEvent.press(utils.getByText("I'm new"));
    await waitFor(() => utils.getByLabelText('Name'));
  });

  test('name, email and handicap are all required', async () => {
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join El Club del Mulligan'));
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    await waitFor(() => utils.getByText('Enter your name'));
    expect(utils.getByText('Enter a valid email address')).toBeTruthy();
    expect(utils.getByText('Enter your handicap')).toBeTruthy();
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(store.joinLeague).not.toHaveBeenCalled();

    fireEvent.changeText(utils.getByLabelText('Name'), 'Lucía');
    fireEvent.changeText(utils.getByLabelText('Email'), 'not-an-email');
    fireEvent.changeText(utils.getByLabelText('Handicap'), '24');
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    expect(utils.getByText('Enter a valid email address')).toBeTruthy();
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  test('success: guest session, email attached, join with handicap and name, gate held then released', async () => {
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join El Club del Mulligan'));
    await fillForm(utils, { hcp: '24.5' });

    let heldDuringJoin = null;
    store.joinLeague.mockImplementation(async () => {
      heldDuringJoin = handoff.isLeagueJoinHeld();
      return { leagueId: 'L1' };
    });
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));

    await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL7Q4K', 24.5, 'Lucía Pérez'));
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(attachEmailToGuest).toHaveBeenCalledWith({ email: 'lucia@example.com', name: 'Lucía Pérez' });
    expect(heldDuringJoin).toBe(true);
    await waitFor(() => expect(handoff.isLeagueJoinHeld()).toBe(false));
    expect(handoff.consumeJustJoined('MULL7Q4K')).toBe(true);
  });

  test('a handicap above the cap is clamped to it', async () => {
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join El Club del Mulligan'));
    await fillForm(utils, { hcp: '36' });
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL7Q4K', 30, 'Lucía Pérez'));
  });

  test('email already registered: signs the guest out, shows the log-in error, link switches tab', async () => {
    attachEmailToGuest.mockRejectedValue(Object.assign(new Error('A user with this email address has already been registered'), { code: 'email_exists', status: 422 }));
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join El Club del Mulligan'));
    await fillForm(utils);
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));

    await waitFor(() => utils.getByText('Log in instead'));
    expect(utils.getByText(/That email already has a Golf Partner account\./)).toBeTruthy();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(store.joinLeague).not.toHaveBeenCalled();
    expect(handoff.isLeagueJoinHeld()).toBe(false);

    const alertSpy = jest.spyOn(Alert, 'alert');
    fireEvent.press(utils.getByText('Log in instead'));
    await waitFor(() => utils.getByText('AuthForm:signin'));
    // Signed out again, no guest to leave behind: no confirmation.
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('a throttled confirmation email does not block joining', async () => {
    attachEmailToGuest.mockResolvedValue('throttled');
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join El Club del Mulligan'));
    await fillForm(utils);
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    await waitFor(() => expect(store.joinLeague).toHaveBeenCalled());
  });

  test('a failed join keeps the guest and the hold; retry reuses them', async () => {
    store.joinLeague.mockRejectedValueOnce(new Error('You need a connection to do this.'));
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join El Club del Mulligan'));
    await fillForm(utils);
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    await waitFor(() => utils.getByText('You need a connection to do this.'));
    expect(handoff.isLeagueJoinHeld()).toBe(true);

    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    await waitFor(() => expect(store.joinLeague).toHaveBeenCalledTimes(2));
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(attachEmailToGuest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(handoff.isLeagueJoinHeld()).toBe(false));
  });

  test('opens on the account tab after "Log in instead" from the signed-in screen', async () => {
    handoff.requestLoginTab();
    const utils = renderScreen();
    await waitFor(() => utils.getByText('AuthForm:signin'));
  });

  test('an archived league cannot be joined', async () => {
    store.getLeagueInvitePreview.mockResolvedValue({ ...PREVIEW, archived: true });
    const utils = renderScreen();
    await waitFor(() => utils.getByText("This league is archived and can't be joined."));
    await fillForm(utils);
    fireEvent.press(utils.getByText('Join El Club del Mulligan'));
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  test('an unknown code shows the invalid-code state', async () => {
    store.getLeagueInvitePreview.mockResolvedValue(null);
    const utils = renderScreen();
    await waitFor(() => utils.getByText("This invite code isn't valid"));
    fireEvent.press(utils.getByText('Sign in'));
    await waitFor(() => utils.getByText('AuthScreen'));
  });

  test('a failed preview still lets a new person join', async () => {
    store.getLeagueInvitePreview.mockRejectedValue(new Error('offline'));
    const utils = renderScreen();
    await waitFor(() => utils.getByText('Join the league'));
    await fillForm(utils);
    fireEvent.press(utils.getByText('Join the league'));
    await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL7Q4K', 24, 'Lucía Pérez'));
  });

  describe('with reserved spots', () => {
    const WITH_SPOTS = {
      ...PREVIEW,
      invitees: [{ id: 'I1', name: 'Javi Ortega' }, { id: 'I2', name: 'Pilar Sanz' }],
    };
    beforeEach(() => { store.getLeagueInvitePreview.mockResolvedValue(WITH_SPOTS); });

    test('opens on "Who are you?" and "I\'m not on the list" shows the plain form', async () => {
      const utils = renderScreen();
      await waitFor(() => utils.getByText('Who are you?'));
      expect(utils.getByText('Javi Ortega')).toBeTruthy();
      expect(utils.queryByLabelText('Name')).toBeNull();
      fireEvent.press(utils.getByText("I'm not on the list"));
      await waitFor(() => utils.getByLabelText('Handicap'));
      expect(utils.getByLabelText('Name').props.value).toBe('');
    });

    test('picking a spot greets, keeps its handicap and joins with the spot id', async () => {
      store.getLeagueInvitee.mockResolvedValue({ id: 'I1', name: 'Javi Ortega', handicap: 18.4, claimed: false });
      const utils = renderScreen();
      await waitFor(() => utils.getByText('Javi Ortega'));
      fireEvent.press(utils.getByText('Javi Ortega'));
      await waitFor(() => utils.getByText('Hi Javi, your spot is ready'));
      expect(utils.getByText('18.4')).toBeTruthy();
      expect(utils.queryByLabelText('Handicap')).toBeNull();
      expect(utils.getByLabelText('Name').props.value).toBe('Javi Ortega');
      fireEvent.changeText(utils.getByLabelText('Email'), 'javi@example.com');
      fireEvent.press(utils.getByText('Join El Club del Mulligan'));
      await waitFor(() => expect(store.joinLeague).toHaveBeenCalledWith('MULL7Q4K', 18.4, 'Javi Ortega', 'I1'));
    });

    test('a spot taken meanwhile shows the status card, and Pick again drops it', async () => {
      store.getLeagueInvitee.mockResolvedValue({ id: 'I1', name: 'Javi Ortega', handicap: 18.4, claimed: true });
      const utils = renderScreen();
      await waitFor(() => utils.getByText('Javi Ortega'));
      fireEvent.press(utils.getByText('Javi Ortega'));
      await waitFor(() => utils.getByText('Someone just joined as Javi Ortega'));
      fireEvent.press(utils.getByText('Pick again'));
      await waitFor(() => utils.getByText('Pilar Sanz'));
      expect(utils.queryByText('Javi Ortega')).toBeNull();
    });
  });
});
