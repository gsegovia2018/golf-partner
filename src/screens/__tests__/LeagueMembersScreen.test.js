import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueMembersScreen from '../LeagueMembersScreen';

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('../../components/PullToRefresh', () => {
  const { ScrollView } = require('react-native');
  return function PullToRefresh({ children }) { return <ScrollView>{children}</ScrollView>; };
});
jest.mock('../../store/leagueStore', () => ({
  getLeague: jest.fn(),
  getLeagueCached: jest.fn(() => Promise.resolve(null)),
  castHandicapBallot: jest.fn(() => Promise.resolve({ status: 'open' })),
  openHandicapVote: jest.fn(() => Promise.resolve('v2')),
  setLeagueHandicap: jest.fn(() => Promise.resolve(27)),
}));

const store = require('../../store/leagueStore');

const member = (userId, displayName, extra = {}) => ({
  userId, displayName, role: 'member', feePaid: false, leftAt: null, leagueHandicap: 20, ...extra,
});

function snapshot({ admin = true, votes = [] } = {}) {
  return {
    league: {
      id: 'L1', name: 'El Club', handicapCap: 30, entryFeeCents: 3000, archivedAt: null, inviteCode: 'MULL-7Q4',
      pointsTable: [], seasonStart: '2026-01-01', seasonEnd: '2026-12-31',
    },
    members: [
      member('me', 'Marcos', { role: admin ? 'admin' : 'member', feePaid: true, leagueHandicap: 18 }),
      member('alv', 'Álvaro', { leagueHandicap: 30 }),
      member('javi', 'Javi', { feePaid: true }),
    ],
    cards: [], cardsByMonth: {}, votes,
    handicapEvents: [{ id: 'e1', userId: 'alv', old: 33, new: 30, reason: 'set', at: '2026-06-12T10:00:00Z' }],
    final: null,
  };
}

const vote = (ballots = []) => ({
  id: 'v1', subjectUser: 'alv', proposed: 27, openedBy: 'javi', closesAt: '2026-10-07T10:00:00Z', status: 'open', ballots,
});

const navigation = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const route = { params: { leagueId: 'L1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueMembersScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getLeagueCached.mockResolvedValue(null);
  });

  test('lists members with handicap, paid state, admin badge, history and pot', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('You (Marcos)'));
    expect(getByText('3 MEMBERS · POT 60 €')).toBeTruthy();
    expect(getByText('Admin')).toBeTruthy();
    expect(getByText(/League hcp 30\.0 · at the cap/)).toBeTruthy();
    expect(getByText('30 € due')).toBeTruthy();
    expect(getByText('Álvaro 33.0 → 30.0 · set by the admin · 12 Jun')).toBeTruthy();
    expect(getByText('https://golf-partner.vercel.app/league/MULL-7Q4')).toBeTruthy();
  });

  test('the open vote shows its sentence and Yes casts a ballot', async () => {
    store.getLeague.mockResolvedValue(snapshot({ votes: [vote()] }));
    const { getByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText("Lower Álvaro's handicap from 30.0 to 27.0?"));
    expect(getByText(/Proposed by Javi · 0 yes of 3 votes, needs 2/)).toBeTruthy();
    fireEvent.press(getByText('Yes, lower it'));
    await waitFor(() => expect(store.castHandicapBallot).toHaveBeenCalledWith('v1', true));
  });

  test('once I have voted the buttons are replaced by my answer', async () => {
    store.getLeague.mockResolvedValue(snapshot({ votes: [vote([{ voteId: 'v1', voter: 'me', yes: false }])] }));
    const { getByText, queryByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('You voted no.'));
    expect(queryByText('No')).toBeNull();
  });

  test('an admin can set a handicap or open a vote from a member row', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, getByLabelText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Álvaro'));
    fireEvent.press(getByLabelText('Álvaro handicap'));
    fireEvent.changeText(getByLabelText('New league handicap'), '27');
    fireEvent.press(getByText('Set handicap'));
    await waitFor(() => expect(store.setLeagueHandicap).toHaveBeenCalledWith('L1', 'alv', 27));

    fireEvent.press(getByLabelText('Álvaro handicap'));
    fireEvent.changeText(getByLabelText('New league handicap'), '27');
    fireEvent.press(getByText('Open a vote (needs 2 of 3)'));
    await waitFor(() => expect(store.openHandicapVote).toHaveBeenCalledWith('L1', 'alv', 27));
  });

  test('a plain member only gets Open a vote', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText, getByLabelText, queryByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Álvaro'));
    fireEvent.press(getByLabelText('Álvaro handicap'));
    expect(getByText('Open a vote (needs 2 of 3)')).toBeTruthy();
    expect(queryByText('Set handicap')).toBeNull();
  });
});
