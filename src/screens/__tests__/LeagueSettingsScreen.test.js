import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueSettingsScreen from '../LeagueSettingsScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../components/PullToRefresh', () => {
  const { ScrollView } = require('react-native');
  return function PullToRefresh({ children }) { return <ScrollView>{children}</ScrollView>; };
});
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
  updateLeagueRules: jest.fn(() => Promise.resolve()),
  setLeagueFeePaid: jest.fn(() => Promise.resolve()),
  setLeagueRole: jest.fn(() => Promise.resolve()),
  archiveLeague: jest.fn(() => Promise.resolve()),
  leaveLeague: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../store/settingsStore', () => ({
  updateAppSettings: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../hooks/useAppSettings', () => ({ useAppSettings: () => ({ notifications: {} }) }));

const store = require('../../store/leagueStore');
const { updateAppSettings } = require('../../store/settingsStore');

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 20, ...extra,
});

function snapshot({ admin = true } = {}) {
  return {
    league: {
      id: 'L1', name: 'El Club', handicapCap: 30, entryFeeCents: 3000, archivedAt: null, inviteCode: 'MULL',
      pointsTable: [500, 300, 190], seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
    },
    members: [
      member('me', 'Marcos', { role: admin ? 'admin' : 'member' }),
      member('javi', 'Javi'),
    ],
    cards: [], cardsByMonth: {}, votes: [], handicapEvents: [], final: null,
  };
}

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// Alert.alert with buttons: press the one with this text.
function pressAlertButton(spy, text) {
  const buttons = spy.mock.calls[spy.mock.calls.length - 1][2];
  buttons.find((b) => b.text === text).onPress();
}

describe('LeagueSettingsScreen', () => {
  let alertSpy;
  beforeEach(() => {
    jest.clearAllMocks();
    store.getLeagueCached.mockResolvedValue(null);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alertSpy.mockRestore());

  test('an admin edits the rules and saves them through updateLeagueRules', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByDisplayValue, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByDisplayValue('El Club'));
    fireEvent.changeText(getByDisplayValue('El Club'), 'El Club 2');
    fireEvent.changeText(getByDisplayValue('500, 300, 190'), '400, 250, 100');
    fireEvent.changeText(getByLabelText('Handicap cap'), '28');
    fireEvent.press(getByText('Save rules'));
    await waitFor(() => expect(store.updateLeagueRules).toHaveBeenCalledWith('L1', {
      name: 'El Club 2', seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
      pointsTable: [400, 250, 100], cap: 28, feeCents: 3000,
    }));
  });

  test('a plain member sees the rules read-only and no admin controls', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText, queryByText, queryByDisplayValue } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('One card a month · net Stableford'));
    expect(queryByDisplayValue('El Club')).toBeNull();
    expect(queryByText('Save rules')).toBeNull();
    expect(queryByText('Archive the league')).toBeNull();
    expect(getByText('Leave league')).toBeTruthy();
  });

  test('fee and admin switches call the store', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('MEMBERS'));
    fireEvent(getByLabelText('Javi paid'), 'valueChange', true);
    await waitFor(() => expect(store.setLeagueFeePaid).toHaveBeenCalledWith('L1', 'javi', true));
    fireEvent(getByLabelText('Javi admin'), 'valueChange', true);
    await waitFor(() => expect(store.setLeagueRole).toHaveBeenCalledWith('L1', 'javi', 'admin'));
  });

  test('notification switches save the whole league prefs object with defaults', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('NOTIFICATIONS'));
    fireEvent(getByLabelText('Someone tees off (email)'), 'valueChange', true);
    const patch = updateAppSettings.mock.calls[0][0];
    expect(patch.notifications.league.email.league_tee_off).toBe(true);
    expect(patch.notifications.league.push.league_tee_off).toBe(true);
  });

  test('archive asks first and only then archives', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Archive the league'));
    fireEvent.press(getByText('Archive the league'));
    expect(store.archiveLeague).not.toHaveBeenCalled();
    pressAlertButton(alertSpy, 'Archive');
    await waitFor(() => expect(store.archiveLeague).toHaveBeenCalledWith('L1'));
  });

  test('leave asks first, leaves and goes back to the main tabs', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText } = render(wrap(<LeagueSettingsScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Leave league'));
    fireEvent.press(getByText('Leave league'));
    expect(store.leaveLeague).not.toHaveBeenCalled();
    pressAlertButton(alertSpy, 'Leave');
    await waitFor(() => expect(store.leaveLeague).toHaveBeenCalledWith('L1'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Main'));
  });
});
