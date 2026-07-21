import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
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

const GAME = {
  id: '1780001519615',
  name: '28 May game',
  kind: 'game',
  _role: 'owner',
  createdAt: '2026-05-28T10:00:00.000Z',
  finishedAt: '2026-05-28T20:54:37.232Z',
  settings: { scoringMode: 'stableford' },
  players: [
    { id: 'p1', name: 'Marcos', user_id: 'u1', handicap: 0 },
    { id: 'p2', name: 'Noel', handicap: 0 },
  ],
  rounds: [{
    id: 'r0',
    courseName: 'Real Club de Golf Lomas-Bosque',
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs: [[{ id: 'p1', name: 'Marcos' }], [{ id: 'p2', name: 'Noel' }]],
    playerHandicaps: {},
    scores: { p1: { 1: 3 }, p2: { 1: 4 } },
  }],
};

const TOURNAMENT = {
  id: '1780001519616',
  name: 'June Cup',
  kind: 'tournament',
  _role: 'member',
  createdAt: '2026-06-01T10:00:00.000Z',
  finishedAt: '2026-06-02T18:00:00.000Z',
  settings: { scoringMode: 'stableford' },
  players: [
    { id: 'p1', name: 'Marcos', user_id: 'u1', handicap: 0 },
    { id: 'p2', name: 'Noel', handicap: 0 },
  ],
  rounds: [{
    id: 'r0',
    courseName: 'Retamares',
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs: [[{ id: 'p1', name: 'Marcos' }], [{ id: 'p2', name: 'Noel' }]],
    playerHandicaps: {},
    scores: { p1: { 1: 3 }, p2: { 1: 4 } },
  }],
  currentRound: 0,
};

jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({ list: [] })),
    isTournamentFinished: jest.fn(() => true),
    subscribeTournamentChanges: jest.fn(() => jest.fn()),
    deleteTournament: jest.fn(() => Promise.resolve()),
  };
});

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ userId: 'u1', displayName: 'Marcos' })),
  computePersonalStats: jest.fn(() => Promise.resolve({
    tournamentsPlayed: 3, roundsPlayed: 12, totalPoints: 360,
    avgPointsPerRound: 30, bestRound: { points: 41 }, wins: 2,
  })),
}));

const { loadAllTournamentsWithFallback } = require('../../store/tournamentStore');

describe('HistoryScreen', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    loadAllTournamentsWithFallback.mockResolvedValue({ list: [GAME, TOURNAMENT] });
  });

  afterEach(() => {
    if (Alert.alert.mockRestore) Alert.alert.mockRestore();
  });

  test('renders month sections newest-first with rows inside', async () => {
    const { findByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    await findByText('JUNE 2026');
    await findByText('MAY 2026');
    await findByText('June Cup');
    await findByText('28 May game');
  });

  test('record strip shows the condensed stats and opens My Stats', async () => {
    const navigation = { navigate: jest.fn() };
    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={navigation} />,
    ));
    await findByText('12'); // rounds
    await findByText('30.0'); // avg
    const strip = await findByLabelText('Your record. Opens My Stats.');
    fireEvent.press(strip);
    expect(navigation.navigate).toHaveBeenCalledWith('MyStats');
  });

  test('filter chips narrow the timeline', async () => {
    const { findByText, queryByText, getByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    await findByText('June Cup');
    fireEvent.press(getByText('Games'));
    expect(queryByText('June Cup')).toBeNull();
    expect(getByText('28 May game')).toBeTruthy();
    fireEvent.press(getByText('Tournaments'));
    expect(queryByText('28 May game')).toBeNull();
    expect(getByText('June Cup')).toBeTruthy();
  });

  test('long-press on an owned row confirms then deletes', async () => {
    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    const row = await findByLabelText('28 May game');
    fireEvent(row, 'longPress');
    const confirmBtn = await findByText('Delete');
    fireEvent.press(confirmBtn);
    await waitFor(() => expect(deleteTournament).toHaveBeenCalledWith('1780001519615'));
  });

  test('long-press on a non-owned row does nothing', async () => {
    const { findByLabelText, queryByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    const row = await findByLabelText('June Cup');
    fireEvent(row, 'longPress');
    expect(queryByText('Delete')).toBeNull();
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  test('tapping a row opens the tournament', async () => {
    const navigation = { navigate: jest.fn() };
    const { findByLabelText } = render(wrap(
      <HistoryScreen navigation={navigation} />,
    ));
    fireEvent.press(await findByLabelText('June Cup'));
    expect(navigation.navigate).toHaveBeenCalledWith('Tournament', {
      tournamentId: '1780001519616', viewMode: 'tournament',
    });
  });

  test('empty archive shows the empty state', async () => {
    loadAllTournamentsWithFallback.mockResolvedValue({ list: [] });
    const { findByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    await findByText('No history yet');
  });
});
