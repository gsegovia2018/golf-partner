import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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
import { shouldHandleStoreChange } from '../../lib/navigationFocus';

const mockTheme = {
  bg: {
    primary: '#ffffff',
    secondary: '#f3f4f6',
    card: '#ffffff',
    elevated: '#ffffff',
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
};

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: jest.fn((payload) => ({ type: 'RESET', payload })),
  },
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
  DEFAULT_SETTINGS: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
  buildJoinLink: jest.fn(() => 'https://example.test/join'),
  deleteTournament: jest.fn(),
  generateInviteCode: jest.fn(),
  getActiveTournamentSnapshot: jest.fn(),
  getTournament: jest.fn(),
  getTournamentSnapshot: jest.fn(),
  isRoundComplete: jest.fn(() => false),
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
  roundTotals: jest.fn(() => []),
  saveTournament: jest.fn(),
  setActiveTournament: jest.fn(),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  sindicatoRoundTally: jest.fn(),
  tournamentBestWorstLeaderboard: jest.fn(() => []),
  tournamentClinched: jest.fn(),
  tournamentLeaderboard: jest.fn(() => []),
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

jest.mock('../../lib/prefs', () => ({
  getShowRunningScore: jest.fn(() => Promise.resolve(true)),
  setShowRunningScore: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/notificationStore', () => ({
  unreadCount: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../../lib/navigationFocus', () => ({
  shouldHandleStoreChange: jest.fn(() => false),
}));

// Three-round tournament where round 1 is fully scored: chooseInitialRound
// picks round 2 (index 1) as the smart default landing page.
function makeTournament() {
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
    rounds: [
      {
        id: 'r0',
        courseName: 'Old Course',
        holes,
        scores: { p1: { 1: 4, 2: 4 }, p2: { 1: 4, 2: 4 } },
        pairs: [['p1', 'p2']],
        revealed: true,
      },
      { id: 'r1', courseName: 'Old Course', holes, scores: {}, pairs: [['p1', 'p2']], revealed: true },
      { id: 'r2', courseName: 'Old Course', holes, scores: {}, pairs: [], revealed: false },
    ],
  };
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
  const screen = render(
    <HomeScreen
      navigation={navigation}
      route={{ params: { viewMode: 'tournament', tournamentId: 't1' } }}
    />,
  );
  return { ...screen, navigation };
}

function activeTabLabel(view) {
  for (const label of ['R1', 'R2', 'R3']) {
    const node = view.getByText(label);
    const style = StyleSheet.flatten(node.props.style);
    if (style.color === mockTheme.text.inverse) return label;
  }
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockImplementation(() => ({ user: { id: 'u-one' } }));
  const tournament = makeTournament();
  getTournamentSnapshot.mockReturnValue(tournament);
  getTournament.mockResolvedValue(makeTournament());
  loadTournament.mockResolvedValue(makeTournament());
  loadAllTournamentsWithFallback.mockResolvedValue({
    list: [tournament],
    stale: false,
    openableIds: null,
  });
  loadQuickStartCourses.mockResolvedValue({ courses: [], usingCachedData: false });
  fetchMyPlayers.mockResolvedValue([]);
});

test('background store-change reload keeps the round the user selected', async () => {
  shouldHandleStoreChange.mockReturnValue(true);
  let storeChangeCallback = null;
  subscribeTournamentChanges.mockImplementation((cb) => {
    storeChangeCallback = cb;
    return jest.fn();
  });

  const view = renderTournamentHome();

  // Lands on round 2: round 1 is fully scored, so the smart default advances.
  await waitFor(() => expect(activeTabLabel(view)).toBe('R2'));

  // User explicitly opens round 1.
  fireEvent.press(view.getByText('R1'));
  expect(activeTabLabel(view)).toBe('R1');

  // A background sync emits a store change → HomeScreen reloads. The reload
  // must not yank the pager off the user's manual selection.
  expect(storeChangeCallback).toBeTruthy();
  await act(async () => {
    await storeChangeCallback();
  });

  expect(activeTabLabel(view)).toBe('R1');
});

test('pager still follows play when currentRound advances after a manual pick', async () => {
  shouldHandleStoreChange.mockReturnValue(true);
  let storeChangeCallback = null;
  subscribeTournamentChanges.mockImplementation((cb) => {
    storeChangeCallback = cb;
    return jest.fn();
  });

  const view = renderTournamentHome();
  await waitFor(() => expect(activeTabLabel(view)).toBe('R2'));

  fireEvent.press(view.getByText('R1'));
  expect(activeTabLabel(view)).toBe('R1');

  // Another device starts round 2: the synced tournament advances
  // currentRound. The manual pick is stale — follow play to round 2.
  const advanced = makeTournament();
  advanced.currentRound = 1;
  advanced.rounds[1].scores = { p1: { 1: 4 } };
  getTournament.mockResolvedValue(advanced);
  await act(async () => {
    await storeChangeCallback();
  });

  expect(activeTabLabel(view)).toBe('R2');
});
