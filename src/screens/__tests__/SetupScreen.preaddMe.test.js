import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';
import * as libraryStore from '../../store/libraryStore';

// A new game starts with me on the "Who's playing?" list. My row comes from
// the device cache first: the network read hangs on a bad signal, and the
// game used to start without me.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));

jest.mock('../../components/PostCreateInviteModal', () => function MockInvite() { return null; });

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

const me = { id: 'me-row', name: 'Marcos Me', handicap: 12, user_id: 'user-1' };
const friend = { id: 'f1', name: 'A Friend', handicap: 8, user_id: 'user-2' };

const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const route = { params: { kind: 'game', initialStep: 'players' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('SetupScreen pre-adds the signed-in player', () => {
  afterEach(() => jest.restoreAllMocks());

  test('from the cache, while the network read never answers', async () => {
    jest.spyOn(libraryStore, 'getCachedMyPlayers').mockResolvedValue([friend, me]);
    const fetchSpy = jest.spyOn(libraryStore, 'fetchMyPlayers').mockReturnValue(new Promise(() => {}));
    const { getByText, queryByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Marcos Me')).toBeTruthy());
    expect(queryByText('A Friend')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('from the network when nothing is cached', async () => {
    jest.spyOn(libraryStore, 'getCachedMyPlayers').mockResolvedValue(null);
    jest.spyOn(libraryStore, 'fetchMyPlayers').mockResolvedValue([friend, me]);
    const { getByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(getByText('Marcos Me')).toBeTruthy());
  });
});
