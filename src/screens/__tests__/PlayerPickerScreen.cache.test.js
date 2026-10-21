import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import PlayerPickerScreen from '../PlayerPickerScreen';
import { fetchMyPlayers } from '../../store/libraryStore';

// The picker opens from the cache instead of waiting on the network, and a
// failed refresh does not replace a list that is already on screen.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, []);
  }),
}));

jest.mock('../../store/libraryStore', () => ({
  getCachedMyPlayers: jest.fn(() => Promise.resolve([
    { id: 'p1', name: 'Guille', handicap: 14 },
  ])),
  fetchMyPlayers: jest.fn(),
}));

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn(() => Promise.resolve()) }));

jest.mock('../../store/tournamentsIndex', () => ({
  tournamentsIndex: { readIndex: jest.fn(() => Promise.resolve([])) },
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { alreadySelectedIds: [], kind: 'game' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

test('shows cached players while the fetch is still in flight', async () => {
  fetchMyPlayers.mockReturnValue(new Promise(() => {}));
  const { getByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));
  await waitFor(() => expect(getByText('Guille')).toBeTruthy());
  // The signed-in id comes from AuthContext, never a supabase.auth round trip.
  expect(require('../../store/libraryStore').getCachedMyPlayers).toHaveBeenCalledWith('u1');
});

test('a failed refresh keeps the cached list instead of showing an error', async () => {
  let fail;
  fetchMyPlayers.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const { getByText, queryByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));
  await waitFor(() => expect(getByText('Guille')).toBeTruthy());
  fail(new Error('offline'));
  await waitFor(() => expect(fetchMyPlayers).toHaveBeenCalled());
  expect(queryByText('offline')).toBeNull();
  expect(getByText('Guille')).toBeTruthy();
});

test('the fresh list replaces the cached one', async () => {
  fetchMyPlayers.mockResolvedValue([{ id: 'p2', name: 'Marcos', handicap: 9 }]);
  const { getByText, queryByText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));
  await waitFor(() => expect(getByText('Marcos')).toBeTruthy());
  expect(queryByText('Guille')).toBeNull();
});

test('a player added on the cached list stays picked when the fresh list lands without them', async () => {
  let land;
  fetchMyPlayers.mockReturnValue(new Promise((resolve) => { land = resolve; }));
  const { getByText, getByPlaceholderText } = render(wrap(<PlayerPickerScreen navigation={navigation} route={route} />));
  await waitFor(() => expect(getByText('Guille')).toBeTruthy());
  fireEvent.changeText(getByPlaceholderText('Name'), 'Lucía');
  fireEvent.press(getByText('Add'));
  await waitFor(() => expect(getByText('Lucía')).toBeTruthy());
  // Fetched before the add reached the server.
  land([{ id: 'p1', name: 'Guille', handicap: 14 }]);
  await waitFor(() => expect(getByText('Add 1 Player')).toBeTruthy());
  expect(getByText('Lucía')).toBeTruthy();
});
