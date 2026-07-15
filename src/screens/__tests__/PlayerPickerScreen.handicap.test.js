import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayerPickerScreen from '../PlayerPickerScreen';
import { mutate } from '../../store/mutate';

// Task 5 (audit-tier3): the "New Player" HCP field uses keyboardType
// "decimal-pad", which on comma-locale Android devices yields "12,5". The
// old parseHandicapIndex only accepted a period decimal, so this silently
// saved the player with a handicap of 0. Assert the comma case now parses
// correctly, and that a genuinely invalid value blocks the add instead of
// silently defaulting to 0.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

jest.mock('../../store/libraryStore', () => ({
  fetchMyPlayers: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    loadAllTournaments: jest.fn(() => Promise.resolve([])),
  };
});

jest.mock('../../store/mutate', () => ({ mutate: jest.fn(() => Promise.resolve()) }));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('PlayerPickerScreen new-player handicap (Task 5)', () => {
  beforeEach(() => {
    mutate.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  test('a comma-decimal handicap ("12,5") is saved as 12.5, not 0', async () => {
    const route = { params: { alreadySelectedIds: [] } };
    const { getByPlaceholderText, getByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Library')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Name'), 'Ana');
    fireEvent.changeText(getByPlaceholderText('HCP'), '12,5');
    fireEvent.press(getByText('Add'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(null, expect.objectContaining({ handicap: 12.5 }));
    });
  });

  test('a genuinely invalid handicap blocks the add instead of silently saving 0', async () => {
    const route = { params: { alreadySelectedIds: [] } };
    const { getByPlaceholderText, getByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Library')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Name'), 'Ana');
    fireEvent.changeText(getByPlaceholderText('HCP'), 'abc');
    fireEvent.press(getByText('Add'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Invalid handicap', expect.any(String)));
    expect(mutate).not.toHaveBeenCalled();
  });
});
