import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import NextRoundScreen from '../NextRoundScreen';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

const mockPlayers = [
  { id: 'p1', name: 'Noé' },
  { id: 'p2', name: 'Alex' },
  { id: 'p3', name: 'Sam' },
  { id: 'p4', name: 'Jo' },
];

const mockPairs = [[mockPlayers[0], mockPlayers[1]], [mockPlayers[2], mockPlayers[3]]];

function makeTournament(overrides = {}) {
  return {
    id: 't1',
    currentRound: 0,
    settings: {},
    players: mockPlayers,
    rounds: [
      {
        id: 'r0',
        courseName: 'Neguri',
        pairs: mockPairs,
        revealed: true,
      },
      {
        id: 'r1',
        courseName: 'Zarautz',
        pairs: null,
        revealed: false,
      },
    ],
    ...overrides,
  };
}

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: jest.fn(),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  roundScoringMode: jest.fn(() => 'bestball'),
  pairsForNextRound: jest.fn(),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn(),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

let mockRoundLeague = { mode: 'hidden' };
jest.mock('../../hooks/useRoundLeague', () => ({
  useRoundLeague: () => mockRoundLeague,
}));

jest.mock('../../lib/leagueOptIn', () => ({
  announceRoundCard: jest.fn(),
  confirmStartWithoutLeague: jest.fn(() => Promise.resolve(false)),
  dismissLeagueOptIn: jest.fn(() => Promise.resolve()),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const navigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  replace: jest.fn(),
};

describe('NextRoundScreen confirm/reshuffle error handling (Task 3.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { loadTournament, pairsForNextRound } = require('../../store/tournamentStore');
    loadTournament.mockImplementation(() => Promise.resolve(makeTournament()));
    pairsForNextRound.mockImplementation(() => mockPairs);
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('handleConfirm success path opens the scorecard (revealOnly)', async () => {
    const { mutate } = require('../../store/mutate');
    mutate.mockImplementation((current) => Promise.resolve(current));

    const route = { params: { revealOnly: true, roundIndex: 0 } };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));

    await waitFor(() => expect(getByText('Reveal Teams')).toBeTruthy());
    fireEvent.press(getByLabelText('Skip the reveal animation'));

    await waitFor(() => expect(getByText("Let's Play!")).toBeTruthy());
    fireEvent.press(getByText("Let's Play!"));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Scorecard', expect.objectContaining({ tournamentId: 't1' })));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('handleConfirm rejection shows an alert, does not navigate, and allows retry', async () => {
    const { mutate } = require('../../store/mutate');
    mutate.mockRejectedValueOnce(new Error('network down'));

    const route = { params: { revealOnly: true, roundIndex: 0 } };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));

    await waitFor(() => expect(getByText('Reveal Teams')).toBeTruthy());
    fireEvent.press(getByLabelText('Skip the reveal animation'));
    await waitFor(() => expect(getByText("Let's Play!")).toBeTruthy());

    fireEvent.press(getByText("Let's Play!"));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(navigation.replace).not.toHaveBeenCalled();

    // Retry: mutate now succeeds — the busy flag must have been reset so the
    // button is pressable again and the success path still works.
    mutate.mockImplementation((current) => Promise.resolve(current));
    fireEvent.press(getByText("Let's Play!"));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Scorecard', expect.objectContaining({ tournamentId: 't1' })));
  });

  test('handleConfirm calls advanceRound when not revealOnly; a rejected advanceRound alerts and does not navigate', async () => {
    const { mutate } = require('../../store/mutate');
    const { loadTournament } = require('../../store/tournamentStore');
    loadTournament.mockImplementation(() => Promise.resolve(makeTournament({ currentRound: -1 })));

    mutate.mockImplementationOnce((current) => Promise.resolve(current)); // round.reveal succeeds
    mutate.mockRejectedValueOnce(new Error('advance failed')); // tournament.advanceRound fails

    const route = { params: {} };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));

    await waitFor(() => expect(getByText('Reveal Teams')).toBeTruthy());
    fireEvent.press(getByLabelText('Skip the reveal animation'));
    await waitFor(() => expect(getByText('Start Round 1')).toBeTruthy());

    fireEvent.press(getByText('Start Round 1'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  test('reshuffle rejection shows an alert and does not crash; retry succeeds', async () => {
    const { mutate } = require('../../store/mutate');
    mutate.mockRejectedValueOnce(new Error('reshuffle failed'));

    const route = { params: { revealOnly: true, roundIndex: 0 } };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));

    await waitFor(() => expect(getByText('Reveal Teams')).toBeTruthy());
    fireEvent.press(getByLabelText('Skip the reveal animation'));
    await waitFor(() => expect(getByText('Re-shuffle')).toBeTruthy());

    fireEvent.press(getByText('Re-shuffle'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    // Screen must remain usable — the reveal actions are still on screen.
    expect(getByText('Re-shuffle')).toBeTruthy();
    expect(getByText("Let's Play!")).toBeTruthy();

    // Retry succeeds once the mutation stops rejecting.
    mutate.mockImplementation((current) => Promise.resolve(current));
    fireEvent.press(getByText('Re-shuffle'));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  });
});

describe('NextRoundScreen league card for the round (D5 B)', () => {
  const league = { id: 'L1', name: 'Mulligan', leagueHandicap: null };
  const cardsState = (on) => ({
    mode: 'cards', state: 'ready', league, meId: 'p1', rated: true, on, setOn: jest.fn(), retry: jest.fn(),
    rows: [{ playerId: 'p1', kind: 'me', name: 'Noé' }, { playerId: 'p2', kind: 'asked', name: 'Alex' }],
  });

  const roundTwo = () => {
    const t = makeTournament();
    t.rounds[1] = { ...t.rounds[1], pairs: mockPairs };
    return t;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { loadTournament, pairsForNextRound } = require('../../store/tournamentStore');
    loadTournament.mockImplementation(() => Promise.resolve(roundTwo()));
    pairsForNextRound.mockImplementation(() => mockPairs);
    const { mutate } = require('../../store/mutate');
    mutate.mockImplementation((current) => Promise.resolve(current));
  });

  afterEach(() => {
    Alert.alert.mockRestore();
    mockRoundLeague = { mode: 'hidden' };
  });

  async function reachPlay(getByText, getByLabelText) {
    await waitFor(() => expect(getByText('Reveal Teams')).toBeTruthy());
    fireEvent.press(getByLabelText('Skip the reveal animation'));
    await waitFor(() => expect(getByText("Let's Play!")).toBeTruthy());
  }

  test('shows the round list; switched on, my card is announced before the reveal', async () => {
    mockRoundLeague = cardsState(true);
    const announced = { ...roundTwo(), announced: true };
    const { announceRoundCard } = require('../../lib/leagueOptIn');
    announceRoundCard.mockResolvedValue({ tournament: announced });
    const { mutate } = require('../../store/mutate');

    const route = { params: { revealOnly: true, roundIndex: 1 } };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));
    await reachPlay(getByText, getByLabelText);
    expect(getByText('Round 2 for Mulligan')).toBeTruthy();
    expect(getByText(/Only round 2 counts\. Round 1 stays a tournament round\./)).toBeTruthy();

    fireEvent.press(getByText("Let's Play!"));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Scorecard', expect.objectContaining({ tournamentId: 't1' })));
    expect(announceRoundCard).toHaveBeenCalledWith(expect.objectContaining({ roundId: 'r1', meId: 'p1', league }));
    expect(mutate.mock.calls[0][0]).toBe(announced);
  });

  test('switched off: the opt-in is dismissed and nothing is announced', async () => {
    mockRoundLeague = cardsState(false);
    const { announceRoundCard, dismissLeagueOptIn } = require('../../lib/leagueOptIn');

    const route = { params: { revealOnly: true, roundIndex: 1 } };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));
    await reachPlay(getByText, getByLabelText);
    fireEvent.press(getByText("Let's Play!"));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Scorecard', expect.objectContaining({ tournamentId: 't1' })));
    expect(dismissLeagueOptIn).toHaveBeenCalledWith('t1', 'r1');
    expect(announceRoundCard).not.toHaveBeenCalled();
  });

  test('announce fails and I cancel: no reveal, no navigation', async () => {
    mockRoundLeague = cardsState(true);
    const { announceRoundCard, confirmStartWithoutLeague } = require('../../lib/leagueOptIn');
    announceRoundCard.mockRejectedValue(new Error('offline'));
    confirmStartWithoutLeague.mockResolvedValue(false);
    const { mutate } = require('../../store/mutate');

    const route = { params: { revealOnly: true, roundIndex: 1 } };
    const { getByText, getByLabelText } = render(wrap(<NextRoundScreen navigation={navigation} route={route} />));
    await reachPlay(getByText, getByLabelText);
    fireEvent.press(getByText("Let's Play!"));
    await waitFor(() => expect(confirmStartWithoutLeague).toHaveBeenCalledWith('Mulligan', 'offline'));
    expect(mutate).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
