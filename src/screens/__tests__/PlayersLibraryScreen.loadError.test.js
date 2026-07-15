import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersLibraryScreen from '../PlayersLibraryScreen';
import { fetchMyGuestPlayers } from '../../store/libraryStore';

// Task 6 (audit-tier3): load() previously had a try/finally with no catch,
// so a rejected fetchMyGuestPlayers() left `players` at its initial [] and
// rendered the "No players yet" empty state instead of surfacing the
// failure — a false-empty state indistinguishable from a genuinely empty
// library, plus an unhandled promise rejection.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn(() => Promise.resolve()) }));
jest.mock('../../store/tournamentStore', () => ({ propagatePlayerToTournaments: jest.fn() }));
jest.mock('../../store/libraryStore', () => ({
  fetchMyGuestPlayers: jest.fn(),
  deletePlayer: jest.fn(),
  upsertPlayer: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('PlayersLibraryScreen load error + retry (Task 6)', () => {
  beforeEach(() => {
    fetchMyGuestPlayers.mockReset();
  });

  test('a rejected fetchMyGuestPlayers() shows the error/retry state, not the empty state', async () => {
    fetchMyGuestPlayers.mockRejectedValueOnce(new Error('network down'));
    const { getByText, queryByText } = render(wrap(<PlayersLibraryScreen />));

    await waitFor(() => expect(getByText("Couldn't load players")).toBeTruthy());
    expect(queryByText('No players yet')).toBeNull();
  });

  test('pressing Retry re-fetches and clears the error state on success', async () => {
    fetchMyGuestPlayers.mockRejectedValueOnce(new Error('network down'));
    const { getByText, queryByText } = render(wrap(<PlayersLibraryScreen />));

    await waitFor(() => expect(getByText("Couldn't load players")).toBeTruthy());

    fetchMyGuestPlayers.mockResolvedValueOnce([]);
    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(getByText('No players yet')).toBeTruthy());
    expect(queryByText("Couldn't load players")).toBeNull();
  });
});
