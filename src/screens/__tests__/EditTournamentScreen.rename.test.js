import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import EditTournamentScreen from '../EditTournamentScreen';

// Spec: docs/superpowers/specs/2026-07-16-rename-tournament-design.md
// The tournament/game name is editable on this screen at any time —
// including after finish — and rides the existing debounced
// tournament.updateProfile autosave. Two guards: never emit an
// empty/whitespace name (name is never-clearable server-side; an empty
// string would be written verbatim), and dedup against the last-emitted
// value so unrelated edits don't re-push an unchanged name.

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

// Per-test tournament overrides (e.g. finishedAt) — reset in beforeEach.
let tournamentOverrides = {};

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
    ...tournamentOverrides,
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

const updateProfileCalls = (mutate) =>
  mutate.mock.calls.filter(([, m]) => m.type === 'tournament.updateProfile');

describe('EditTournamentScreen rename', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tournamentOverrides = {};
  });

  test('editing the name emits tournament.updateProfile with the trimmed name', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    mutate.mockClear();
    fireEvent.changeText(nameInput, '  Ryder Cup 2026  ');

    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) =>
        m.type === 'tournament.updateProfile' && m.patch?.name === 'Ryder Cup 2026')).toBe(true);
    }, { timeout: 2000 });
  });

  test('clearing the name to whitespace never emits a name patch (settings still save)', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    mutate.mockClear();
    fireEvent.changeText(nameInput, '   ');

    await waitFor(() => {
      expect(updateProfileCalls(mutate).length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    expect(updateProfileCalls(mutate).every(([, m]) => !('name' in (m.patch ?? {})))).toBe(true);
  });

  test('an unrelated edit after the name is saved does not re-emit the name (dedup)', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    mutate.mockClear();
    fireEvent.changeText(nameInput, 'Ryder Cup 2026');
    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) =>
        m.type === 'tournament.updateProfile' && m.patch?.name === 'Ryder Cup 2026')).toBe(true);
    }, { timeout: 2000 });

    // Unrelated edit: course name. Autosave fires (round.upsert +
    // updateProfile-with-settings) but must NOT carry the unchanged name.
    mutate.mockClear();
    const courseInput = await findByPlaceholderText('Course name');
    fireEvent.changeText(courseInput, 'Nuevo Course');
    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) => m.type === 'round.upsert' && m.roundId === 'r1')).toBe(true);
    }, { timeout: 2000 });

    expect(updateProfileCalls(mutate).every(([, m]) => !('name' in (m.patch ?? {})))).toBe(true);
  });

  test('a finished tournament still shows the name pre-filled and saves a rename', async () => {
    tournamentOverrides = { finishedAt: '2026-07-01T10:00:00.000Z' };
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText, getByDisplayValue } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    expect(getByDisplayValue('Weekend Match')).toBeTruthy();

    mutate.mockClear();
    fireEvent.changeText(nameInput, 'The 2026 Classic');
    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) =>
        m.type === 'tournament.updateProfile' && m.patch?.name === 'The 2026 Classic')).toBe(true);
    }, { timeout: 2000 });
  });
});
