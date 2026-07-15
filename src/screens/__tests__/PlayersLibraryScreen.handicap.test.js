import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersLibraryScreen from '../PlayersLibraryScreen';
import { mutate } from '../../store/mutate';
import { fetchMyGuestPlayers } from '../../store/libraryStore';

// Task 5 (audit-tier3): the "HCP" field here uses keyboardType "decimal-pad"
// (comma-locale Android → "12,5"), and the create path (mutate) used to
// silently coerce an unparseable handicap to 0 instead of blocking the save.

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
  fetchMyGuestPlayers: jest.fn(() => Promise.resolve([])),
  deletePlayer: jest.fn(),
  upsertPlayer: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('PlayersLibraryScreen handicap validation (Task 5)', () => {
  beforeEach(() => {
    mutate.mockClear();
    fetchMyGuestPlayers.mockResolvedValue([]);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  test('a comma-decimal handicap ("12,5") is saved as 12.5, not 0', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = render(wrap(<PlayersLibraryScreen />));
    await waitFor(() => expect(getByText('List')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Name'), 'Ana');
    fireEvent.changeText(getByPlaceholderText('HCP'), '12,5');
    fireEvent.press(getByLabelText('Add player'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(null, expect.objectContaining({ handicap: 12.5 }));
    });
  });

  test('a genuinely invalid handicap blocks the save instead of silently saving 0', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = render(wrap(<PlayersLibraryScreen />));
    await waitFor(() => expect(getByText('List')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Name'), 'Ana');
    fireEvent.changeText(getByPlaceholderText('HCP'), 'abc');
    fireEvent.press(getByLabelText('Add player'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Invalid handicap', expect.any(String)));
    expect(mutate).not.toHaveBeenCalled();
  });
});
