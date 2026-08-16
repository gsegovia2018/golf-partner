import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import HomeScreen from '../HomeScreen';
import { useAuth } from '../../context/AuthContext';
import { fetchMyPlayers, loadQuickStartCourses } from '../../store/libraryStore';
import {
  buildBoardLink,
  enableBoardSharing,
  generateInviteCode,
  getTournament,
  getTournamentSnapshot,
  loadAllTournamentsWithFallback,
  loadTournament,
} from '../../store/tournamentStore';
import { isOnline } from '../../lib/connectivity';

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
  DEFAULT_SETTINGS: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
  buildJoinLink: jest.fn(() => 'https://example.test/join'),
  buildBoardLink: jest.fn((origin, token) => `https://example.test/board/${token}`),
  enableBoardSharing: jest.fn(),
  rotateBoardToken: jest.fn(),
  disableBoardSharing: jest.fn(),
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
  isOnline: jest.fn(() => true),
}));

jest.mock('../../store/notificationStore', () => ({
  unreadCount: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../../lib/navigationFocus', () => ({
  shouldHandleStoreChange: jest.fn(() => false),
}));

function makeTournament(overrides = {}) {
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];
  return {
    id: 't1',
    kind: 'tournament',
    name: 'Weekend Cup',
    meId: 'p1',
    _role: 'owner',
    shareToken: null,
    players: [
      { id: 'p1', name: 'Ana' },
      { id: 'p2', name: 'Ben' },
    ],
    settings: {},
    currentRound: 0,
    createdAt: '2026-06-01T10:00:00.000Z',
    rounds: [
      { id: 'r0', courseName: 'Old Course', holes, scores: {}, pairs: [['p1', 'p2']], revealed: true },
    ],
    ...overrides,
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

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockImplementation(() => ({ user: { id: 'u-one' } }));
  isOnline.mockReturnValue(true);
  loadQuickStartCourses.mockResolvedValue({ courses: [], usingCachedData: false });
  fetchMyPlayers.mockResolvedValue([]);
  loadAllTournamentsWithFallback.mockResolvedValue({
    list: [],
    stale: false,
    openableIds: null,
  });
  generateInviteCode.mockResolvedValue({ editorCode: 'EDIT01', viewerCode: 'VIEW01' });
  jest.spyOn(Share, 'share').mockImplementation(() => Promise.resolve());
});

async function openShareSheet(tournament) {
  getTournamentSnapshot.mockReturnValue(tournament);
  getTournament.mockResolvedValue(tournament);
  loadTournament.mockResolvedValue(tournament);

  const view = renderTournamentHome();
  await waitFor(() => expect(view.getByTestId('share-hub-button')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('share-hub-button'));
  });
  await waitFor(() => expect(generateInviteCode).toHaveBeenCalledWith('t1'));
  await waitFor(() => expect(view.queryByText('Editor')).toBeTruthy());
  return view;
}

test('viewer mode with an existing shareToken renders the board link share row', async () => {
  // Non-owner editor guest: the header share button (and thus this sheet)
  // is only hidden for the read-only `_role: 'viewer'` role — an editor
  // guest should still see the board link once the owner has shared one.
  const tournament = makeTournament({ _role: 'editor', shareToken: 'tok-abc' });
  const view = await openShareSheet(tournament);

  await act(async () => {
    fireEvent.press(view.getByText('Viewer'));
  });

  await waitFor(() => expect(buildBoardLink).toHaveBeenCalledWith(expect.anything(), 'tok-abc'));
  expect(view.getByText(
    'Anyone with this link can watch the live board — no account needed.',
  )).toBeTruthy();
  expect(view.getByText('Share link')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByText('Share link'));
  });
  expect(Share.share).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('https://example.test/board/tok-abc') }),
  );
});

test('owner switch-to-viewer with no token calls enableBoardSharing', async () => {
  const tournament = makeTournament({ _role: 'owner', shareToken: null });
  enableBoardSharing.mockResolvedValue('tok-new');
  const view = await openShareSheet(tournament);

  await act(async () => {
    fireEvent.press(view.getByText('Viewer'));
  });

  await waitFor(() => expect(enableBoardSharing).toHaveBeenCalledWith('t1'));
});
