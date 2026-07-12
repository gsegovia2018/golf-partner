import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import EditTournamentScreen from '../EditTournamentScreen';

// Task 13.2 regression coverage: round-note edits on this screen must reach
// game_round_notes via a dedicated `note.set` mutation, NOT ride along inside
// round.upsert's owned-field patch — get_game_tournament strips `notes` out
// of game_rounds.body and reassembles it from game_round_notes instead (see
// mutationWrites.js's ROUND_UPSERT_OWNED_FIELDS), so a round.upsert-only note
// edit is a silent no-op for every other device/peer.

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

function mockMakeTournament() {
  return {
    id: 't1',
    name: 'Weekend Match',
    kind: 'game',
    settings: {
      scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1, fixedTeams: false, manualTeams: false,
    },
    players: [
      { id: 'p1', name: 'Marcos', handicap: 10 },
      { id: 'p2', name: 'Pablo', handicap: 12 },
    ],
    rounds: [{
      id: 'r1',
      courseName: 'La Moraleja',
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
      tees: [],
      playerTees: {},
      playerHandicaps: { p1: 10, p2: 12 },
      manualHandicaps: {},
      pairs: [[{ id: 'p1' }, { id: 'p2' }]],
      scores: {},
      notes: { round: '', hole: {} },
    }],
  };
}

jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    getTournamentSnapshot: jest.fn(() => mockMakeTournament()),
    getActiveTournamentSnapshot: jest.fn(() => mockMakeTournament()),
    getTournament: jest.fn(() => Promise.resolve(mockMakeTournament())),
    loadTournament: jest.fn(() => Promise.resolve(mockMakeTournament())),
    subscribeTournamentChanges: jest.fn(() => () => {}),
  };
});

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { tournamentId: 't1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('EditTournamentScreen round notes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('editing a round note emits a note.set mutation with scope "round"', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const notesInput = await findByPlaceholderText('Round notes...');
    // Clear out whatever the initial-load-triggered save cycle already
    // queued (its debounce timer is cancelled by the edit below anyway, but
    // clearing keeps the assertion below unambiguous about which call it's
    // reading).
    mutate.mockClear();

    fireEvent.changeText(notesInput, 'Wet greens today');

    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) => m.type === 'note.set')).toBe(true);
    }, { timeout: 2000 });

    const noteCall = mutate.mock.calls.find(([, m]) => m.type === 'note.set');
    const [, mutation] = noteCall;
    expect(mutation).toMatchObject({
      type: 'note.set',
      scope: 'round',
      roundId: 'r1',
      text: 'Wet greens today',
    });
  });

  test('also still fires round.upsert for the same round (course/holes/tees), but note.set is the one carrying the note', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const notesInput = await findByPlaceholderText('Round notes...');
    mutate.mockClear();
    fireEvent.changeText(notesInput, 'Wet greens today');

    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) => m.type === 'note.set')).toBe(true);
    }, { timeout: 2000 });

    const upsertCall = mutate.mock.calls.find(([, m]) => m.type === 'round.upsert' && m.roundId === 'r1');
    expect(upsertCall).toBeTruthy();
  });
});
