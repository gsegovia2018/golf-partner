import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueFinalScreen from '../LeagueFinalScreen';

let mockUserId = 'me';
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../store/libraryStore', () => ({ fetchPlayers: jest.fn() }));

const store = require('../../store/leagueStore');
const { fetchPlayers } = require('../../store/libraryStore');

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, role: 'member', leftAt: null, leagueHandicap: 20, ...extra,
});
const card = (userId, points) => ({
  id: `c-${userId}`, userId, status: 'confirmed', points, month: '2026-09-01', monthKey: '2026-09',
});

const snapshot = {
  league: { id: 'L1', name: 'El Club', pointsTable: [500, 300, 190], seasonStart: '2026-01-01', seasonEnd: '2026-12-31' },
  members: [
    member('me', 'Marcos', { role: 'admin' }),
    member('javi', 'Javi'),
    member('nacho', 'Nacho'),
  ],
  cardsByMonth: { '2026-09': [card('javi', 40), card('me', 36), card('nacho', 30)] },
  final: null,
};

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueFinalScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'me';
    store.getLeague.mockResolvedValue(snapshot);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => Alert.alert.mockRestore());

  test('prefills the suggestion, lets the admin edit, and continues to Setup with the strokes', async () => {
    fetchPlayers.mockResolvedValue([
      { id: 'p-me', name: 'Marcos', handicap: 12, user_id: 'me' },
      { id: 'p-javi', name: 'Javi', handicap: 8, user_id: 'javi' },
      { id: 'p-nacho', name: 'Nacho', handicap: 20, user_id: 'nacho' },
    ]);
    const { findByText, getByLabelText, getByText } = render(wrap(<LeagueFinalScreen navigation={navigation} route={route} />));
    await findByText(/Extra strokes are added to each player's playing handicap for the Final\./);

    expect(getByLabelText('Extra strokes for Javi').props.children).toBe(0);
    expect(getByLabelText('Extra strokes for You').props.children).toBe(1);
    expect(getByLabelText('Extra strokes for Nacho').props.children).toBe(2);

    fireEvent.press(getByLabelText('More extra strokes for Nacho'));
    fireEvent.press(getByLabelText('Fewer extra strokes for You'));
    fireEvent.press(getByLabelText('Fewer extra strokes for You'));
    expect(getByLabelText('Extra strokes for You').props.children).toBe(0);
    expect(getByLabelText('Extra strokes for Nacho').props.children).toBe(3);

    fireEvent.press(getByText('Continue to setup'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalled());
    const [screen, params] = navigation.navigate.mock.calls[0];
    expect(screen).toBe('Setup');
    expect(params.kind).toBe('tournament');
    expect(params.leagueFinal).toEqual({ leagueId: 'L1', strokes: { javi: 0, me: 0, nacho: 3 } });
    expect(params.prefill.players.map((p) => p.id).sort()).toEqual(['p-javi', 'p-me', 'p-nacho']);
    expect(params.prefill.settings).toEqual({ scoringMode: 'individual' });
  });

  test('a member without a player profile is named and left out', async () => {
    fetchPlayers.mockResolvedValue([{ id: 'p-me', name: 'Marcos', handicap: 12, user_id: 'me' }]);
    const { findByText, getByText } = render(wrap(<LeagueFinalScreen navigation={navigation} route={route} />));
    await findByText('Continue to setup');
    fireEvent.press(getByText('Continue to setup'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalled());
    expect(Alert.alert.mock.calls[0][1]).toMatch(/Javi, Nacho have no player profile/);
    expect(navigation.navigate.mock.calls[0][1].prefill.players).toHaveLength(1);
  });

  test('a plain member cannot set up the Final', async () => {
    mockUserId = 'javi';
    const { findByText, queryByText } = render(wrap(<LeagueFinalScreen navigation={navigation} route={route} />));
    await findByText('Only the league admin can set up the Final.');
    expect(queryByText('Continue to setup')).toBeNull();
  });
});
