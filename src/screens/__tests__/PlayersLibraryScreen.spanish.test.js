import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayersLibraryScreen from '../PlayersLibraryScreen';
import { fetchMyGuestPlayers } from '../../store/libraryStore';
import { setLanguagePref } from '../../i18n';

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

describe('PlayersLibraryScreen in Spanish', () => {
  beforeEach(async () => {
    fetchMyGuestPlayers.mockReset();
    await act(async () => { await setLanguagePref('es'); });
  });

  afterEach(async () => {
    await act(async () => { await setLanguagePref('en'); });
  });

  test('renders Spanish labels and a comma decimal handicap', async () => {
    fetchMyGuestPlayers.mockResolvedValueOnce([
      { id: 'p1', name: 'Ana', handicap: 12.5, gender: 'female' },
    ]);
    const { getByText, queryByText } = render(wrap(<PlayersLibraryScreen />));

    await waitFor(() => expect(getByText('Ana')).toBeTruthy());
    expect(getByText('Jugadores')).toBeTruthy();
    expect(getByText('Nuevo jugador')).toBeTruthy();
    expect(getByText('Hombre')).toBeTruthy();
    expect(getByText('Mujer')).toBeTruthy();
    expect(getByText('HCP 12,5')).toBeTruthy();
    expect(queryByText('New player')).toBeNull();
    expect(queryByText('HCP 12.5')).toBeNull();
  });
});
