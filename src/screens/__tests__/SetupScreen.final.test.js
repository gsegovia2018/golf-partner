import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';
import { calcPlayingHandicap } from '../../store/scoring';

// League Final (plan P12): the review lists the extra strokes, Start raises
// round 0's playing handicaps, tags the tournament and records the Final.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));
jest.mock('../../components/PostCreateInviteModal', () => () => null);
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));
jest.mock('../../store/leagueStore', () => ({
  getMyLeagues: jest.fn(),
  getMyCardsForMonth: jest.fn(),
  announceLeagueCard: jest.fn(),
  recordLeagueFinal: jest.fn(),
}));

const store = require('../../store/leagueStore');
const { mutate } = require('../../store/mutate');

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const yellow = { label: 'Yellow', slope: 125, rating: 72 };
const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const finalParams = () => ({
  kind: 'tournament',
  initialStep: 'review',
  leagueFinal: { leagueId: 'L1', strokes: { u1: 0, u2: 3 } },
  prefill: {
    players: [
      { id: 'p1', name: 'Marcos', handicap: 4, user_id: 'u1' },
      { id: 'p2', name: 'Javi', handicap: 20, user_id: 'u2' },
    ],
    settings: { scoringMode: 'individual' },
    rounds: [{
      id: 'r1', courseName: 'Centro Nacional', holes, tees: [yellow], playerHandicaps: null, playerTees: null,
    }],
  },
});

describe('SetupScreen league Final', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getMyLeagues.mockResolvedValue([]);
    store.getMyCardsForMonth.mockResolvedValue([]);
    store.recordLeagueFinal.mockResolvedValue();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => { Alert.alert.mockRestore(); });

  test('lists the strokes; Start raises round 0, tags the tournament and records the Final', async () => {
    const { getByText, queryByText } = render(wrap(
      <SetupScreen navigation={navigation} route={{ params: finalParams() }} />,
    ));
    expect(getByText('League Final · extra strokes applied')).toBeTruthy();
    expect(getByText('Javi +3')).toBeTruthy();
    expect(queryByText('Marcos +0')).toBeNull();

    fireEvent.press(getByText('Start Tournament'));
    await waitFor(() => expect(store.recordLeagueFinal).toHaveBeenCalled());

    const t = mutate.mock.calls.find(([, m]) => m.type === 'tournament.create')[1].tournament;
    expect(t.leagueFinal).toEqual({ leagueId: 'L1' });
    const base = calcPlayingHandicap(20, 125, 72, 72, 18);
    expect(t.rounds[0].playerHandicaps.p2).toBe(base + 3);
    expect(t.rounds[0].manualHandicaps.p2).toBe(true);
    expect(t.rounds[0].manualHandicaps.p1).toBeUndefined();
    expect(store.recordLeagueFinal).toHaveBeenCalledWith('L1', t.id, { u1: 0, u2: 3 });
  });

  test('without leagueFinal there is no note', () => {
    const p = finalParams();
    delete p.leagueFinal;
    const { queryByText } = render(wrap(<SetupScreen navigation={navigation} route={{ params: p }} />));
    expect(queryByText('League Final · extra strokes applied')).toBeNull();
  });
});
