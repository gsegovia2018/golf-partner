import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SetupScreen from '../SetupScreen';
import { setPendingPlayers } from '../../lib/selectionBridge';

// Task 3 (audit-tier3): the roster cap is kind-aware — a tournament admits a
// 5th+ player (rosterCap('tournament') = 24), a casual game stays capped at
// 4 (rosterCap('game') = 4). This exercises the Players step's merge-in-new-
// players path (the useFocusEffect handler that consumes the PlayerPicker
// selection), which is the same code path the "empty slot" tap uses.

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((effect) => {
    const React = require('react');
    React.useEffect(effect, [effect]);
  }),
  CommonActions: { reset: jest.fn((x) => x) },
}));

jest.mock('../../components/PostCreateInviteModal', () => {
  return function MockPostCreateInviteModal() {
    return null;
  };
});

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

function fourPlayers() {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`, name: `Player ${i + 1}`, handicap: 10,
  }));
}

function twoMorePlayers() {
  return [
    { id: 'p5', name: 'Player 5', handicap: 8 },
    { id: 'p6', name: 'Player 6', handicap: 12 },
  ];
}

function baseParams(kind) {
  return {
    kind,
    initialStep: 'players',
    prefill: {
      players: fourPlayers(),
      rounds: [{
        id: 'r1', courseName: 'Pine Valley', holes: [], tees: [], playerHandicaps: null, playerTees: null,
      }],
    },
  };
}

const navigation = {
  goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dispatch: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('SetupScreen roster cap is kind-aware (Task 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a tournament admits a 5th and 6th player past the old 4-player cap', async () => {
    setPendingPlayers(twoMorePlayers());
    const route = { params: baseParams('tournament') };
    const { getByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));

    await waitFor(() => {
      expect(getByText('Player 5')).toBeTruthy();
    });
    expect(getByText('Player 6')).toBeTruthy();
  });

  test('a casual game still caps the roster at 4 — the 5th/6th are dropped', async () => {
    setPendingPlayers(twoMorePlayers());
    const route = { params: baseParams('game') };
    const { queryByText, getByText } = render(wrap(<SetupScreen navigation={navigation} route={route} />));

    // Give the focus-effect merge a tick to run (mirrors the tournament test).
    await waitFor(() => {
      expect(getByText('Player 4')).toBeTruthy();
    });
    expect(queryByText('Player 5')).toBeNull();
    expect(queryByText('Player 6')).toBeNull();
  });
});
