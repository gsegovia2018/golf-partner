// Reset Round / Undo / Restore now straddle two layers: the notes + snapshot
// log ride the setup blob mutation (round.resetContent), while the SCORES are
// the cards engine's — the snapshot comes from the engine's `shownScores` and
// the wipe/replay go through engine/store's resetRound / restoreRound. These
// tests pin that split: the blob mutation must never carry a `scores` key, and
// the snapshot must come from the engine even when the blob's round.scores is
// empty (which it is until the server projection has landed).
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import HomeScreen from '../HomeScreen';
import { useAuth } from '../../context/AuthContext';
import { fetchMyPlayers, loadQuickStartCourses } from '../../store/libraryStore';
import {
  getTournament,
  getTournamentSnapshot,
  loadAllTournamentsWithFallback,
  loadTournament,
  subscribeTournamentChanges,
} from '../../store/tournamentStore';
import { mutate } from '../../store/mutate';
import { getRoundState, resetRound, restoreRound } from '../../engine/store';

const mockTheme = {
  bg: {
    primary: '#ffffff',
    secondary: '#f3f4f6',
    card: '#ffffff',
    elevated: '#ffffff',
    deep: '#f9fafb',
  },
  border: { default: '#d1d5db', subtle: '#e5e7eb' },
  text: {
    primary: '#111827',
    secondary: '#374151',
    muted: '#6b7280',
    inverse: '#ffffff',
  },
  accent: {
    primary: '#006747',
    light: '#e6f4ee',
    danger: '#dc2626',
  },
  destructive: '#dc2626',
  shadow: {
    card: {},
    accent: {},
    elevated: {},
  },
  glass: { border: '#e5e7eb' },
  isDark: false,
  scoreColor: () => '#111827',
  // Read by the scorecard table styles in the finished-game card.
  semantic: { masters: '#006747' },
  typography: { caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 } },
};

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn((payload) => ({ type: 'RESET', payload })),
  },
  useIsFocused: () => true,
}));

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../components/ScreenContainer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockScreenContainer({ children }) {
    return <View>{children}</View>;
  };
});

jest.mock('../../components/PullToRefresh', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockPullToRefresh({ children }) {
    return <View>{children}</View>;
  };
});

jest.mock('../../components/LoadingSplash', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockLoadingSplash() {
    return <Text>Loading splash</Text>;
  };
});

jest.mock('../../components/ShareableCard', () => ({
  ShareableLeaderboard: () => null,
  shareLeaderboard: jest.fn(),
}));

jest.mock('../../components/ScoringModePicker', () => ({
  __esModule: true,
  ScoringModeSheet: () => null,
  TeamsSettingsFields: () => null,
  BestBallValueFields: () => null,
}));

jest.mock('react-native-qrcode-svg', () => () => null);

jest.mock('../../components/QuickStartCourses', () => () => null);

jest.mock('../../components/PostCreateInviteModal', () => {
  return function MockPostCreateInviteModal() {
    return null;
  };
});

jest.mock('../../store/libraryStore', () => ({
  fetchMyPlayers: jest.fn(),
  loadQuickStartCourses: jest.fn(),
}));

jest.mock('../../store/tournamentStore', () => ({
  // Real scoring helpers underneath so the finished-game ScorecardTable
  // renders; the stubs below override what these tests steer.
  ...jest.requireActual('../../store/tournamentStore'),
  DEFAULT_SETTINGS: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
  buildJoinLink: jest.fn(() => 'https://example.test/join'),
  deleteTournament: jest.fn(),
  generateInviteCode: jest.fn(),
  getActiveTournamentSnapshot: jest.fn(),
  getTournament: jest.fn(),
  getTournamentSnapshot: jest.fn(),
  isRoundComplete: jest.fn((round, players) => {
    if (!round?.scores || !round.holes?.length || !players?.length) return false;
    return players.every((p) => {
      const ps = round.scores[p.id];
      return ps && round.holes.every((h) => ps[h.number] != null);
    });
  }),
  isTournamentFinished: jest.fn(() => false),
  lastTeeForPlayerOnCourse: jest.fn(),
  loadAllTournaments: jest.fn(() => Promise.resolve([])),
  loadAllTournamentsWithFallback: jest.fn(),
  loadTournament: jest.fn(),
  matchPlayRoundTally: jest.fn(),
  pairsMatchRoundTally: jest.fn(),
  tournamentPairsMatchStandings: jest.fn(() => ({ board: [] })),
  scrambleRoundTally: jest.fn(),
  tournamentScrambleLeaderboard: jest.fn(() => []),
  playerRoundBestWorstPoints: jest.fn(),
  randomPairs: jest.fn((players) => players.map((player) => [player])),
  roundLeaderboard: jest.fn(() => ({ mode: 'stableford', unit: 'pts', entries: [] })),
  roundTotals: jest.fn(() => []),
  setActiveTournament: jest.fn(),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  sindicatoRoundTally: jest.fn(),
  tournamentBestWorstLeaderboard: jest.fn(() => []),
  tournamentClinched: jest.fn(),
  tournamentLeaderboard: jest.fn(() => []),
  tournamentLeaderboardResolved: jest.fn(() => ({ mode: 'stableford', unit: 'pts', entries: [] })),
  tournamentMatchPlayStandings: jest.fn(() => ({ board: [] })),
  tournamentNoun: jest.fn(() => 'tournament'),
  tournamentNounCapitalized: jest.fn(() => 'Tournament'),
  tournamentPlayerClinched: jest.fn(),
  tournamentSindicatoLeaderboard: jest.fn(() => []),
}));

jest.mock('../../lib/quickStartGame', () => ({
  buildQuickStartRound: jest.fn(() => ({ id: 'r0' })),
  buildQuickStartTournamentDraft: jest.fn(() => ({})),
  resolveQuickStartPlayerTees: jest.fn(() => ({})),
}));

jest.mock('../setupWizard', () => ({
  shouldOfferPostCreateEditorInvite: jest.fn(() => false),
}));

jest.mock('../../lib/connectivity', () => ({
  subscribeConnectivity: jest.fn(() => jest.fn()),
}));

jest.mock('../../store/notificationStore', () => ({
  unreadCount: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../../lib/navigationFocus', () => ({
  shouldHandleStoreChange: jest.fn(() => false),
}));


jest.mock('../../store/mutate', () => ({
  mutate: jest.fn(async (t) => t),
}));

// The engine store is mocked; src/engine/cards.js is NOT, so `shownScores`
// really derives the snapshot from the ctx below.
jest.mock('../../engine/store', () => ({
  loadRound: jest.fn(async () => {}),
  getRoundState: jest.fn(),
  resetRound: jest.fn(async () => {}),
  restoreRound: jest.fn(async () => {}),
}));

// One published card of mine: p1 4/5 and p2 3 on the two holes. The blob's
// round.scores is deliberately EMPTY, so anything the snapshot contains can
// only have come from the engine.
const MY_CARD = {
  scorer: { playerId: 'p1', userId: null },
  holes: {
    1: { v: 1, entries: { p1: 4, p2: 3 }, ts: 1000 },
    2: { v: 1, entries: { p1: 5 }, ts: 2000 },
  },
};
const ENGINE_SCORES = { p1: { 1: 4, 2: 5 }, p2: { 1: 3 } };

// A single-round tournament: the gear sheet then hosts the round actions
// directly (multi-round tournaments hide them behind the per-round sheet).
function makeTournament({ resetHistory } = {}) {
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];
  return {
    id: 't1',
    kind: 'tournament',
    name: 'Weekend Cup',
    meId: 'p1',
    players: [
      { id: 'p1', name: 'Ana' },
      { id: 'p2', name: 'Ben' },
    ],
    settings: {},
    currentRound: 0,
    createdAt: '2026-06-01T10:00:00.000Z',
    rounds: [{
      id: 'r0',
      courseName: 'Old Course',
      holes,
      scores: {},
      notes: { round: 'Windy' },
      pairs: [['p1', 'p2']],
      revealed: true,
      ...(resetHistory ? { resetHistory } : {}),
    }],
  };
}

function installTournament(overrides) {
  const tournament = makeTournament(overrides);
  getTournamentSnapshot.mockReturnValue(tournament);
  getTournament.mockResolvedValue(makeTournament(overrides));
  loadTournament.mockResolvedValue(makeTournament(overrides));
  loadAllTournamentsWithFallback.mockResolvedValue({
    list: [tournament], stale: false, openableIds: null,
  });
}

function renderTournamentHome() {
  const navigation = {
    addListener: jest.fn(() => jest.fn()),
    canGoBack: jest.fn(() => false),
    dispatch: jest.fn(),
    getParent: jest.fn(),
    getState: jest.fn(() => ({
      routeNames: ['Home', 'Tournament', 'Scorecard'],
      routes: [{ name: 'Home' }],
      index: 0,
    })),
    isFocused: jest.fn(() => true),
    navigate: jest.fn(),
  };
  return render(
    <HomeScreen
      navigation={navigation}
      route={{ params: { viewMode: 'tournament', tournamentId: 't1' } }}
    />,
  );
}

// Open the gear sheet, tap Reset Round, and confirm the destructive dialog.
async function pressResetRound(view) {
  fireEvent.press(view.getByLabelText('Tournament settings'));
  await act(async () => { fireEvent.press(view.getByText('Reset Round')); });
  await act(async () => { fireEvent.press(view.getByText('Reset')); });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockImplementation(() => ({ user: { id: 'u-one' } }));
  installTournament();
  loadQuickStartCourses.mockResolvedValue({ courses: [], usingCachedData: false });
  fetchMyPlayers.mockResolvedValue([]);
  getRoundState.mockReturnValue({
    myAuthorId: 'dev-me',
    cardsByAuthor: { 'dev-me': MY_CARD },
    resolutions: {},
    draft: {},
    pending: { cards: false, resolutions: false },
    lastPulledAt: null,
    loaded: true,
  });
});

function resetContentCall() {
  return mutate.mock.calls
    .map(([, m]) => m)
    .find((m) => m?.type === 'round.resetContent');
}

test('Reset Round snapshots the ENGINE scores, wipes the cards, and never puts scores in the blob mutation', async () => {
  const view = renderTournamentHome();
  await waitFor(() => expect(view.getByLabelText('Tournament settings')).toBeTruthy());

  await pressResetRound(view);

  const m = resetContentCall();
  expect(m).toBeTruthy();
  expect(m.roundId).toBe('r0');
  expect(m.notes).toEqual({});
  // Local cache only (mutationWrites never sends it): Home shows the reset at once.
  expect(m.scores).toEqual({});
  // The snapshot came from the cards engine, not from the (empty) blob.
  expect(m.resetHistory).toHaveLength(1);
  expect(m.resetHistory[0].scores).toEqual(ENGINE_SCORES);
  expect(m.resetHistory[0].notes).toEqual({ round: 'Windy' });

  expect(resetRound).toHaveBeenCalledWith('t1', 'r0');
  expect(restoreRound).not.toHaveBeenCalled();
});

test('UNDO republishes the snapshot through the engine and pops the history entry', async () => {
  const view = renderTournamentHome();
  await waitFor(() => expect(view.getByLabelText('Tournament settings')).toBeTruthy());

  await pressResetRound(view);
  await act(async () => { fireEvent.press(view.getByText('UNDO')); });

  expect(restoreRound).toHaveBeenCalledWith('t1', 'r0', ENGINE_SCORES);

  const undo = mutate.mock.calls
    .map(([, m]) => m)
    .filter((m) => m?.type === 'round.resetContent')
    .pop();
  expect(undo.scores).toEqual(ENGINE_SCORES); // restored into the local cache too
  expect(undo.notes).toEqual({ round: 'Windy' });
  expect(undo.resetHistory).toEqual([]); // the entry just pushed is popped again
});

test('Restore from history clears the round on every device, then republishes the snapshot', async () => {
  const snapshot = {
    scores: { p1: { 1: 6 } },
    notes: { round: 'Rain' },
    at: '2026-09-01T10:00:00.000Z',
  };
  installTournament({ resetHistory: [snapshot] });

  const view = renderTournamentHome();
  await waitFor(() => expect(view.getByLabelText('Tournament settings')).toBeTruthy());

  fireEvent.press(view.getByLabelText('Tournament settings'));
  await act(async () => {
    fireEvent.press(view.getByText('Restore previous scores (1)'));
  });
  await act(async () => {
    fireEvent.press(view.getByText(new Date(snapshot.at).toLocaleString()));
  });
  await act(async () => { fireEvent.press(view.getByText('Restore')); });

  // "Current scores will be overwritten": wipe first, then publish.
  expect(resetRound).toHaveBeenCalledWith('t1', 'r0');
  expect(restoreRound).toHaveBeenCalledWith('t1', 'r0', snapshot.scores);
  expect(resetRound.mock.invocationCallOrder[0])
    .toBeLessThan(restoreRound.mock.invocationCallOrder[0]);

  const m = resetContentCall();
  expect(m.scores).toEqual(snapshot.scores);
  expect(m.notes).toEqual({ round: 'Rain' });
  expect(m.resetHistory).toEqual([snapshot]);
});
