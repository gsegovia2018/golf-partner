import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import HomeScreen from '../HomeScreen';
import { useAuth } from '../../context/AuthContext';
import { fetchMyPlayers, loadQuickStartCourses } from '../../store/libraryStore';
import {
  buildJoinLink,
  generateInviteCode,
  getActiveTournamentSnapshot,
  lastTeeForPlayerOnCourse,
  loadAllTournamentsWithFallback,
  loadTournament,
} from '../../store/tournamentStore';
import { mutate } from '../../store/mutate';

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

let mockUserId = 'u-one';
const mockCreatedTournament = {
  id: 'created-1',
  kind: 'game',
  name: 'Quick Game',
  players: [{ id: 'p-one', name: 'Player One', user_id: 'u-one' }],
  rounds: [{ id: 'r0', holes: [], scores: {} }],
  currentRound: 0,
  createdAt: '2026-06-01T10:00:00.000Z',
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
  BestBallValueFields: () => null,
}));

jest.mock('react-native-qrcode-svg', () => () => null);

jest.mock('../../components/QuickStartCourses', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return function MockQuickStartCourses(props) {
    const course = props.courses?.[0] ?? {
      id: 'fallback-course',
      name: 'Fallback Course',
      holes: [],
      tees: [],
    };
    const player = props.players?.[0] ?? {
      id: 'fallback-player',
      name: 'Fallback Player',
      user_id: 'u-one',
    };
    return (
      <View testID="quick-start">
        <Text testID="quick-start-courses">
          {(props.courses ?? []).map((item) => item.name).join(',')}
        </Text>
        <Text testID="quick-start-players">
          {(props.players ?? []).map((item) => item.name).join(',')}
        </Text>
        <Text testID="quick-start-courses-loading">
          {props.coursesLoading ? 'loading' : 'ready'}
        </Text>
        <TouchableOpacity
          testID="quick-start-start"
          onPress={() => props.onStart?.({ course, players: [player] })}
        >
          <Text>Start quick game</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="quick-start-double-start"
          onPress={() => {
            props.onStart?.({ course, players: [player] });
            props.onStart?.({ course, players: [player] });
          }}
        >
          <Text>Start twice</Text>
        </TouchableOpacity>
      </View>
    );
  };
});

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
  playerRoundBestWorstPoints: jest.fn(),
  randomPairs: jest.fn((players) => players.map((player) => [player])),
  roundTotals: jest.fn(() => []),
  setActiveTournament: jest.fn(),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  sindicatoRoundTally: jest.fn(),
  tournamentBestWorstLeaderboard: jest.fn(() => []),
  tournamentClinched: jest.fn(),
  tournamentLeaderboard: jest.fn(() => []),
  tournamentMatchPlayStandings: jest.fn(() => ({ board: [] })),
  tournamentNoun: jest.fn(() => 'game'),
  tournamentNounCapitalized: jest.fn(() => 'Game'),
  tournamentPlayerClinched: jest.fn(),
  tournamentSindicatoLeaderboard: jest.fn(() => []),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn(),
}));

jest.mock('../../lib/quickStartGame', () => ({
  buildQuickStartRound: jest.fn(() => ({ id: 'r0' })),
  buildQuickStartTournamentDraft: jest.fn(() => mockCreatedTournament),
  resolveQuickStartPlayerTees: jest.fn(() => ({ p1: { label: 'White' } })),
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderHome(navigationOverrides = {}) {
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
    ...navigationOverrides,
  };
  const screen = render(
    <HomeScreen
      navigation={navigation}
      route={{ params: { viewMode: 'list' } }}
    />,
  );
  return { ...screen, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'u-one';
  useAuth.mockImplementation(() => ({ user: mockUserId ? { id: mockUserId } : null }));
  getActiveTournamentSnapshot.mockReturnValue({
    id: 'active-1',
    kind: 'game',
    name: 'Active Game',
    players: [],
    rounds: [],
    currentRound: 0,
    settings: {},
    createdAt: '2026-05-31T10:00:00.000Z',
  });
  loadTournament.mockResolvedValue(null);
  loadAllTournamentsWithFallback.mockResolvedValue({
    list: [],
    stale: false,
    openableIds: null,
  });
  loadQuickStartCourses.mockResolvedValue({ courses: [], usingCachedData: false });
  fetchMyPlayers.mockResolvedValue([]);
  lastTeeForPlayerOnCourse.mockResolvedValue(null);
  mutate.mockResolvedValue();
  generateInviteCode.mockResolvedValue({ editorCode: 'EDIT123' });
  buildJoinLink.mockReturnValue('https://example.test/join?invite=EDIT123');
});

test('ignores stale quick-start loads after the signed-in user changes', async () => {
  const firstCourses = deferred();
  const firstPlayers = deferred();
  const secondCourses = deferred();
  const secondPlayers = deferred();
  loadQuickStartCourses
    .mockReturnValueOnce(firstCourses.promise)
    .mockReturnValueOnce(secondCourses.promise);
  fetchMyPlayers
    .mockReturnValueOnce(firstPlayers.promise)
    .mockReturnValueOnce(secondPlayers.promise);

  const view = renderHome();
  await waitFor(() => expect(loadQuickStartCourses).toHaveBeenCalledTimes(1));

  mockUserId = 'u-two';
  view.rerender(
    <HomeScreen
      navigation={view.navigation}
      route={{ params: { viewMode: 'list' } }}
    />,
  );

  await waitFor(() => expect(loadQuickStartCourses).toHaveBeenCalledTimes(2));

  await act(async () => {
    secondCourses.resolve({
      courses: [{ id: 'course-two', name: 'Course Two' }],
      usingCachedData: false,
    });
    secondPlayers.resolve([{ id: 'player-two', name: 'Player Two', user_id: 'u-two' }]);
  });

  await waitFor(() => {
    expect(view.getByTestId('quick-start-courses').props.children).toBe('Course Two');
    expect(view.getByTestId('quick-start-players').props.children).toBe('Player Two');
  });

  await act(async () => {
    firstCourses.resolve({
      courses: [{ id: 'course-one', name: 'Course One' }],
      usingCachedData: false,
    });
    firstPlayers.resolve([{ id: 'player-one', name: 'Player One', user_id: 'u-one' }]);
  });

  await waitFor(() => {
    expect(view.getByTestId('quick-start-courses').props.children).toBe('Course Two');
    expect(view.getByTestId('quick-start-players').props.children).toBe('Player Two');
  });
});

test('prevents duplicate games from rapid quick-start presses', async () => {
  const save = deferred();
  mutate.mockReturnValue(save.promise);
  loadQuickStartCourses.mockResolvedValue({
    courses: [{ id: 'course-one', name: 'Course One' }],
    usingCachedData: false,
  });
  fetchMyPlayers.mockResolvedValue([
    { id: 'player-one', name: 'Player One', user_id: 'u-one' },
  ]);

  const view = renderHome();

  await waitFor(() => {
    expect(view.getByTestId('quick-start-courses').props.children).toBe('Course One');
    expect(view.getByTestId('quick-start-players').props.children).toBe('Player One');
  });

  fireEvent.press(view.getByTestId('quick-start-double-start'));

  await waitFor(() => {
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  await act(async () => {
    save.resolve();
  });
});

test('passes a loading state while quick-start courses are pending', async () => {
  const courseLoad = deferred();
  loadQuickStartCourses.mockReturnValue(courseLoad.promise);
  fetchMyPlayers.mockResolvedValue([
    { id: 'player-one', name: 'Player One', user_id: 'u-one' },
  ]);

  const view = renderHome();

  await waitFor(() => {
    expect(view.getByTestId('quick-start-courses-loading').props.children).toBe('loading');
  });

  await act(async () => {
    courseLoad.resolve({
      courses: [{ id: 'course-one', name: 'Course One' }],
      usingCachedData: false,
    });
  });

  await waitFor(() => {
    expect(view.getByTestId('quick-start-courses-loading').props.children).toBe('ready');
    expect(view.getByTestId('quick-start-courses').props.children).toBe('Course One');
  });
});
