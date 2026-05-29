import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import HistoryScreen from '../HistoryScreen';
import { deleteTournament } from '../../store/tournamentStore';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (effect) => {
      React.useEffect(effect, [effect]);
    },
  };
});

jest.mock('../../store/tournamentStore', () => ({
  loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({
    list: [{
      id: '1780001519615',
      name: '28 May game',
      kind: 'game',
      _role: 'owner',
      finishedAt: '2026-05-28T20:54:37.232Z',
      players: [{ id: 'p1', name: 'Marcos' }, { id: 'p2', name: 'Noel' }],
      rounds: [{ id: 'r0', courseName: 'Real Club de Golf Lomas-Bosque' }],
    }],
  })),
  isTournamentFinished: jest.fn(() => true),
  setActiveTournament: jest.fn(() => Promise.resolve()),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  deleteTournament: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ displayName: 'Marcos' })),
  computePersonalStats: jest.fn(() => Promise.resolve(null)),
}));

describe('HistoryScreen', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (Alert.alert.mockRestore) Alert.alert.mockRestore();
  });

  test('shows a delete action for owner-owned finished single-round games', async () => {
    const navigation = { navigate: jest.fn() };

    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={navigation} />
    ));

    expect(await findByText('28 May game')).toBeTruthy();
    expect(await findByLabelText('Delete 28 May game')).toBeTruthy();
  });

  test('positions the history delete action at the top-right of the card', async () => {
    const navigation = { navigate: jest.fn() };

    const { findByLabelText } = render(wrap(
      <HistoryScreen navigation={navigation} />
    ));

    const deleteButton = await findByLabelText('Delete 28 May game');
    const deleteStyle = StyleSheet.flatten(deleteButton.props.style);

    expect(deleteStyle.top).toBe(10);
    expect(deleteStyle.right).toBe(10);
    expect(deleteStyle.bottom).toBeUndefined();
  });

  test('shows the formatted in-app delete confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const navigation = { navigate: jest.fn() };

    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={navigation} />
    ));

    fireEvent.press(await findByLabelText('Delete 28 May game'));

    expect(await findByText('Delete Tournament')).toBeTruthy();
    expect(await findByText('Delete "28 May game"? This cannot be undone.')).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('deletes a history game after formatted confirmation', async () => {
    const navigation = { navigate: jest.fn() };

    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={navigation} />
    ));

    fireEvent.press(await findByLabelText('Delete 28 May game'));
    fireEvent.press(await findByText('Delete'));

    await waitFor(() => {
      expect(deleteTournament).toHaveBeenCalledWith('1780001519615');
    });
  });
});
