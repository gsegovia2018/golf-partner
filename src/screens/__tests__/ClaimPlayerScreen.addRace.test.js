import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ClaimPlayerScreen from '../ClaimPlayerScreen';
import { mutate } from '../../store/mutate';
import { addTournamentPlayerIfRoom, refreshTournamentFromRemote } from '../../store/tournamentStore';

// Task 9 (audit-tier3): addNewPlayer used to gate only on the
// locally-observed players.length >= rosterCap(kind) and then write straight
// through the offline-first tournament.addPlayer mutation. Two joiners who
// each see room (a stale or simultaneous read) could both add, pushing the
// roster past the cap. addNewPlayer must now go through a server-side,
// cap-enforcing check (addTournamentPlayerIfRoom) BEFORE writing anything
// locally, and must reject cleanly even when the local roster looks like it
// has room.

function threePlayers() {
  return Array.from({ length: 3 }, (_, i) => ({
    id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: 10, user_id: null,
  }));
}

function mockTournament(kind) {
  return {
    id: 't1',
    kind,
    players: threePlayers(), // 3 < rosterCap('game')=4 locally — looks like there's room
  };
}

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ userId: 'me-1', displayName: 'Me', handicap: 9 })),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me-1', is_anonymous: false } }),
}));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn(() => Promise.resolve({})) }));

let mockCurrentTournament;
jest.mock('../../store/tournamentStore', () => ({
  getTournament: jest.fn(() => Promise.resolve(mockCurrentTournament)),
  addPlayerRoundPatches: jest.fn(() => ({ patches: [] })),
  claimTournamentPlayer: jest.fn(),
  refreshTournamentFromRemote: jest.fn(() => Promise.resolve(null)),
  addTournamentPlayerIfRoom: jest.fn(),
  tournamentNoun: (t) => (t?.kind === 'game' ? 'game' : 'tournament'),
  rosterCap: (kind) => (kind === 'game' ? 4 : 24),
}));

const navigation = { goBack: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('ClaimPlayerScreen addNewPlayer server-side roster cap (Task 9)', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mutate.mockClear();
    navigation.goBack.mockClear();
    refreshTournamentFromRemote.mockClear();
    addTournamentPlayerIfRoom.mockReset();
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('rejects the add when the server reports the roster is full, even though the local count looked fine', async () => {
    mockCurrentTournament = mockTournament('game'); // rosterCap=4, local players.length=3 → looks open
    addTournamentPlayerIfRoom.mockRejectedValue(new Error('ROSTER_FULL'));

    const route = { params: { tournamentId: 't1' } };
    const { getByText, getByTestId } = render(wrap(<ClaimPlayerScreen navigation={navigation} route={route} />));

    await waitFor(() => expect(getByText("I'm not listed — add me")).toBeTruthy());
    fireEvent.press(getByText("I'm not listed — add me"));

    await waitFor(() => expect(getByTestId('claim-add-new-player-confirm')).toBeTruthy());
    fireEvent.press(getByTestId('claim-add-new-player-confirm'));

    await waitFor(() => expect(addTournamentPlayerIfRoom).toHaveBeenCalledTimes(1));

    // Rejected server-side → never applies the local/offline-queued add, and
    // never navigates away as if it succeeded.
    expect(mutate).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title] = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
    expect(title.toLowerCase()).toContain('full');
  });

  test('proceeds with the local add when the server confirms there is room', async () => {
    mockCurrentTournament = mockTournament('tournament');
    addTournamentPlayerIfRoom.mockResolvedValue('new-player-id');

    const route = { params: { tournamentId: 't1' } };
    const { getByText, getByTestId } = render(wrap(<ClaimPlayerScreen navigation={navigation} route={route} />));

    await waitFor(() => expect(getByText("I'm not listed — add me")).toBeTruthy());
    fireEvent.press(getByText("I'm not listed — add me"));

    await waitFor(() => expect(getByTestId('claim-add-new-player-confirm')).toBeTruthy());
    fireEvent.press(getByTestId('claim-add-new-player-confirm'));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
