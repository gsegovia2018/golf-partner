import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';

// Starting a game with a guest offers an invite link. Offline that link can't
// be made and the sheet would spin until the request failed, at the tee, so
// the game opens straight away instead; the invite is offered again later.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));

jest.mock('../../components/PostCreateInviteModal', () => {
  return function MockPostCreateInviteModal({ visible }) {
    const { Text } = require('react-native');
    return visible ? <Text>invite sheet</Text> : null;
  };
});

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

const mockOnline = { value: true };
jest.mock('../../lib/connectivity', () => ({
  ...jest.requireActual('../../lib/connectivity'),
  isOnline: () => mockOnline.value,
}));

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const route = {
  params: {
    kind: 'game',
    initialStep: 'review',
    prefill: {
      players: [
        { id: 'me', name: 'Marcos', handicap: 10, user_id: 'user-1' },
        { id: 'guest', name: 'Guest Pal', handicap: 18 },
      ],
      rounds: [{ id: 'r1', courseName: 'Pine Valley', holes, tees: [], playerHandicaps: null, playerTees: null }],
    },
  },
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const makeNavigation = () => ({ goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn() });

test('offline: Start Game skips the invite sheet and never asks for a link', async () => {
  mockOnline.value = false;
  const store = require('../../store/tournamentStore');
  const invite = jest.spyOn(store, 'generateInviteCode');
  const navigation = makeNavigation();
  const { getByText, queryByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));
  fireEvent.press(getByText('Start Game'));
  await waitFor(() => expect(navigation.dispatch.mock.calls.length + navigation.replace.mock.calls.length
    + navigation.navigate.mock.calls.length).toBeGreaterThan(0));
  expect(invite).not.toHaveBeenCalled();
  expect(queryByText('invite sheet')).toBeNull();
  invite.mockRestore();
});

test('online: Start Game still offers the invite sheet', async () => {
  mockOnline.value = true;
  const store = require('../../store/tournamentStore');
  const invite = jest.spyOn(store, 'generateInviteCode').mockResolvedValue({ editorCode: 'ABCD1234' });
  const navigation = makeNavigation();
  const { getByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));
  fireEvent.press(getByText('Start Game'));
  await waitFor(() => expect(getByText('invite sheet')).toBeTruthy());
  expect(invite).toHaveBeenCalled();
  invite.mockRestore();
});
