import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  removeLeagueMember: jest.fn(() => Promise.resolve()),
  rotateLeagueInviteCode: jest.fn(() => Promise.resolve({ inviteCode: 'NEWCODE2' })),
  releaseLeagueInvitee: jest.fn(() => Promise.resolve()),
  getLeagueMemberEvents: jest.fn(() => Promise.resolve([])),
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
    store.getLeagueMemberEvents.mockResolvedValue([]);
    return AsyncStorage.clear();
  });

  test('lists members with handicap, paid state, admin badge, history and pot', async () => {
    store.getLeague.mockResolvedValue(snapshot());
    const { getByText, queryByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('You (Marcos)'));
    expect(getByText('3 MEMBERS · POT 60 €')).toBeTruthy();
    expect(getByText('Admin')).toBeTruthy();
    // The role is the badge only; the stats line no longer repeats it.
    expect(getByText(/League hcp 30\.0 · at the cap/)).toBeTruthy();
    expect(queryByText(/· admin$/)).toBeNull();
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

  test('with another admin, my own sheet has no Set handicap, only the vote (R10)', async () => {
    const snap = snapshot();
    snap.members = snap.members.map((m) => (m.userId === 'javi' ? { ...m, role: 'admin' } : m));
    store.getLeague.mockResolvedValue(snap);
    const { getByText, getByLabelText, queryByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('You (Marcos)'));
    fireEvent.press(getByText('You (Marcos)'));
    await waitFor(() => getByText('Open a vote (needs 2 of 3)'));
    expect(queryByText('Set handicap')).toBeNull();
    // Someone else's sheet keeps it.
    fireEvent.press(getByLabelText('Álvaro handicap'));
    expect(getByText('Set handicap')).toBeTruthy();
  });

  test('a plain member only gets Open a vote', async () => {
    store.getLeague.mockResolvedValue(snapshot({ admin: false }));
    const { getByText, getByLabelText, queryByText } = render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Álvaro'));
    fireEvent.press(getByLabelText('Álvaro handicap'));
    expect(getByText('Open a vote (needs 2 of 3)')).toBeTruthy();
    expect(queryByText('Set handicap')).toBeNull();
  });

  describe('members admin', () => {
    const claim = (id, inviteeId, userId, spot, account, handicap = 22.1) => ({
      id, kind: 'spot_claimed', userId, inviteeId, actorUserId: userId, at: '2026-10-11T18:22:00Z',
      data: { spot_name: spot, name: account, handicap },
    });
    const withKike = (admin = true) => {
      const snap = snapshot({ admin });
      snap.members.push(member('kike', 'Enrique M.', { leagueHandicap: 22.1 }));
      snap.cards = [
        { id: 'c1', userId: 'alv', status: 'confirmed' }, { id: 'c2', userId: 'alv', status: 'void' },
        { id: 'c3', userId: 'alv', status: 'confirmed' },
      ];
      return snap;
    };
    const renderScreen = () => render(wrap(<LeagueMembersScreen navigation={navigation} route={route} />));
    const pressLast = (getAllByText, text) => {
      const all = getAllByText(text);
      fireEvent.press(all[all.length - 1]);
    };

    test('remove from the handicap sheet states the consequence and removes', async () => {
      store.getLeague.mockResolvedValue(withKike());
      const { getByText, getByLabelText } = renderScreen();
      await waitFor(() => getByText('Álvaro'));
      fireEvent.press(getByLabelText('Álvaro handicap'));
      fireEvent.press(getByText('Remove from league'));
      await waitFor(() => getByText('Remove Álvaro?'));
      expect(getByText('Their 2 past cards stay in the standings, marked as removed.')).toBeTruthy();
      expect(getByText(/rejoin from the invite link unless you make a new code/)).toBeTruthy();
      fireEvent.press(getByText('Remove Álvaro'));
      await waitFor(() => expect(store.removeLeagueMember).toHaveBeenCalledWith('L1', 'alv'));
      expect(store.rotateLeagueInviteCode).not.toHaveBeenCalled();
      await waitFor(() => getByText('Álvaro removed. Members told.'));
    });

    test('the second option also makes a new invite code, and the link follows', async () => {
      store.getLeague.mockResolvedValue(withKike());
      const { getByText, getByLabelText } = renderScreen();
      await waitFor(() => getByText('Álvaro'));
      fireEvent.press(getByLabelText('Álvaro handicap'));
      fireEvent.press(getByText('Remove from league'));
      await waitFor(() => getByText('Remove Álvaro?'));
      fireEvent.press(getByText('Also make a new invite code'));
      fireEvent.press(getByText('Remove Álvaro'));
      await waitFor(() => expect(store.rotateLeagueInviteCode).toHaveBeenCalledWith('L1'));
      expect(store.removeLeagueMember.mock.invocationCallOrder[0])
        .toBeLessThan(store.rotateLeagueInviteCode.mock.invocationCallOrder[0]);
      await waitFor(() => getByText('https://golf-partner.vercel.app/league/NEWCODE2'));
    });

    test('last_admin shows its copy in the sheet and keeps it open', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.removeLeagueMember.mockRejectedValueOnce(Object.assign(new Error('x is the only admin'), { hint: 'last_admin' }));
      const { getByText, getByLabelText } = renderScreen();
      await waitFor(() => getByText('Álvaro'));
      fireEvent.press(getByLabelText('Álvaro handicap'));
      fireEvent.press(getByText('Remove from league'));
      await waitFor(() => getByText('Remove Álvaro?'));
      fireEvent.press(getByText('Remove Álvaro'));
      await waitFor(() => getByText('Álvaro is the only other admin. Make someone else an admin first, or remove their admin role.'));
      expect(getByText('Remove Álvaro?')).toBeTruthy();
    });

    test('you cannot remove yourself from your own sheet', async () => {
      store.getLeague.mockResolvedValue(withKike());
      const { getByText, queryByText } = renderScreen();
      await waitFor(() => getByText('You (Marcos)'));
      fireEvent.press(getByText('You (Marcos)'));
      await waitFor(() => getByText('Set handicap'));
      expect(queryByText('Remove from league')).toBeNull();
    });

    test('a new invite code asks first, then the card shows the new link', async () => {
      store.getLeague.mockResolvedValue(withKike());
      const { getByText } = renderScreen();
      await waitFor(() => getByText('Make a new invite code'));
      fireEvent.press(getByText('Make a new invite code'));
      await waitFor(() => getByText('Make a new invite code?'));
      expect(getByText('The current link stops working straight away.')).toBeTruthy();
      expect(store.rotateLeagueInviteCode).not.toHaveBeenCalled();
      fireEvent.press(getByText('Make new code'));
      await waitFor(() => expect(store.rotateLeagueInviteCode).toHaveBeenCalledWith('L1'));
      await waitFor(() => getByText('https://golf-partner.vercel.app/league/NEWCODE2'));
      expect(getByText('New invite code ready. The old link no longer works.')).toBeTruthy();
    });

    test('a claim shows a card; Looks right dismisses it for good', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.getLeagueMemberEvents.mockResolvedValue([claim(7, 'i1', 'kike', 'Kike Moreno', 'Enrique M.')]);
      const first = renderScreen();
      await waitFor(() => first.getByText("Kike Moreno's spot was claimed"));
      expect(first.getByText(/By the account "Enrique M\." on .*Handicap 22\.1 came with the spot\./)).toBeTruthy();
      fireEvent.press(first.getByText('Looks right'));
      await waitFor(() => expect(first.queryByText("Kike Moreno's spot was claimed")).toBeNull());
      first.unmount();
      const again = renderScreen();
      await waitFor(() => again.getByLabelText('Release the spot of Enrique M.'));
      expect(again.queryByText("Kike Moreno's spot was claimed")).toBeNull();
    });

    test('Release spot confirms with the consequence, then releases the spot', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.getLeagueMemberEvents.mockResolvedValue([claim(7, 'i1', 'kike', 'Kike Moreno', 'Enrique M.')]);
      const { getByText, getAllByText } = renderScreen();
      await waitFor(() => getByText('Release spot'));
      fireEvent.press(getByText('Release spot'));
      await waitFor(() => getByText("Release Kike Moreno's spot?"));
      expect(getByText('The spot goes back to Invited, with handicap 22.1.')).toBeTruthy();
      expect(store.releaseLeagueInvitee).not.toHaveBeenCalled();
      pressLast(getAllByText, 'Release spot');
      await waitFor(() => expect(store.releaseLeagueInvitee).toHaveBeenCalledWith('L1', 'i1'));
      await waitFor(() => getByText('Spot released. Kike Moreno is back on Invited.'));
    });

    test('the Release chip on the claimed row opens the same sheet', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.getLeagueMemberEvents.mockResolvedValue([claim(7, 'i1', 'kike', 'Kike Moreno', 'Enrique M.')]);
      const { getByText, getByLabelText } = renderScreen();
      await waitFor(() => getByLabelText('Release the spot of Enrique M.'));
      fireEvent.press(getByLabelText('Release the spot of Enrique M.'));
      await waitFor(() => getByText("Release Kike Moreno's spot?"));
    });

    test('several claims make one card listing them, with a Release chip each', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.getLeagueMemberEvents.mockResolvedValue([
        claim(7, 'i1', 'kike', 'Kike Moreno', 'Enrique M.'),
        claim(8, 'i2', 'alv', 'Tomás Varela', 'Tomás V.', 14),
      ]);
      const { getByText, getAllByLabelText } = renderScreen();
      await waitFor(() => getByText('2 spots claimed'));
      expect(getByText('All look right')).toBeTruthy();
      expect(getAllByLabelText('Release the spot of Kike Moreno')).toHaveLength(1);
      expect(getAllByLabelText('Release the spot of Tomás Varela')).toHaveLength(1);
    });

    test('a not_claimed error reads as already released', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.getLeagueMemberEvents.mockResolvedValue([claim(7, 'i1', 'kike', 'Kike Moreno', 'Enrique M.')]);
      store.releaseLeagueInvitee.mockRejectedValueOnce(Object.assign(new Error('nope'), { hint: 'not_claimed' }));
      const { getByText, getAllByText } = renderScreen();
      await waitFor(() => getByText('Release spot'));
      fireEvent.press(getByText('Release spot'));
      await waitFor(() => getByText("Release Kike Moreno's spot?"));
      pressLast(getAllByText, 'Release spot');
      await waitFor(() => getByText('Someone already released this spot. Pull down to refresh.'));
    });

    test('plain members see none of it', async () => {
      store.getLeague.mockResolvedValue(withKike(false));
      store.getLeagueMemberEvents.mockResolvedValue([claim(7, 'i1', 'kike', 'Kike Moreno', 'Enrique M.')]);
      const { getByText, getByLabelText, queryByText } = renderScreen();
      await waitFor(() => getByText('Álvaro'));
      expect(store.getLeagueMemberEvents).not.toHaveBeenCalled();
      expect(queryByText('Make a new invite code')).toBeNull();
      expect(queryByText("Kike Moreno's spot was claimed")).toBeNull();
      fireEvent.press(getByLabelText('Álvaro handicap'));
      expect(queryByText('Remove from league')).toBeNull();
    });

    test('the membership log shows as a short history for admins', async () => {
      store.getLeague.mockResolvedValue(withKike());
      store.getLeagueMemberEvents.mockResolvedValue([
        { id: 1, kind: 'invite_code_rotated', userId: null, inviteeId: null, actorUserId: 'me', data: {}, at: '2026-10-12T10:00:00Z' },
      ]);
      const { getByText } = renderScreen();
      await waitFor(() => getByText('MEMBERSHIP HISTORY'));
      expect(getByText(/You made a new invite code · /)).toBeTruthy();
    });
  });
});
