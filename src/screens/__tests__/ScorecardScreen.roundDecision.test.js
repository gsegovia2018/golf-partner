import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { roundPairClinched } from '../../store/tournamentStore';

let mockOfficialRoundState;

const mockPlayers = [
  { id: 'p1', name: 'Noé' },
  { id: 'p2', name: 'Alex' },
];

const mockTournament = {
  id: 't1',
  kind: 'game',
  currentRound: 0,
  meId: 'p1',
  settings: { scoringMode: 'stableford' },
  players: mockPlayers,
  rounds: [{
    id: 'r1',
    courseName: 'Neguri',
    holes: [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ],
    scores: {},
    shotDetails: {},
    notes: {},
    pairs: [[mockPlayers[0]], [mockPlayers[1]]],
  }],
};

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: {
    PORTRAIT_UP: 'PORTRAIT_UP',
  },
}));

jest.mock('../../components/scorecard/HoleView', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    HoleView: ({ onSetScore, onNext }) => (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Enter clinching score"
          onPress={() => onSetScore('p1', 1, '4')}
        >
          <Text>Enter clinching score</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Next hole"
          onPress={onNext}
        >
          <Text>Next hole</Text>
        </TouchableOpacity>
      </View>
    ),
  };
});

jest.mock('../../components/scorecard/GridView', () => ({
  GridView: () => null,
}));

jest.mock('../../components/MediaLightbox', () => () => null);
jest.mock('../../components/AttachMediaSheet', () => () => null);
jest.mock('../../components/CaptureMenuSheet', () => () => null);
jest.mock('../../components/SyncStatusSheet', () => () => null);
jest.mock('../../components/ScoringModeChangeSheet', () => () => null);

jest.mock('../../hooks/useRoundMedia', () => ({
  useRoundMedia: () => ({ items: [] }),
}));

jest.mock('../../hooks/useOfficialRound', () => ({
  useOfficialRound: () => mockOfficialRoundState,
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('../../lib/prefs', () => ({
  getShowRunningScore: jest.fn(() => Promise.resolve(true)),
  setShowRunningScore: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: jest.fn(() => Promise.resolve(mockTournament)),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  calcBestWorstBall: jest.fn(() => null),
  DEFAULT_SETTINGS: { scoringMode: 'stableford' },
  roundPairClinched: jest.fn(),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  isRoundComplete: jest.fn(() => false),
  isTournamentFinished: jest.fn(() => false),
  subscribeSyncStatus: jest.fn(() => jest.fn()),
  getActiveTournamentSnapshot: jest.fn(() => mockTournament),
}));

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((t) => Promise.resolve(t)),
}));

jest.mock('../../store/libraryStore', () => ({
  fetchPlayers: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../store/notificationStore', () => ({
  notifyRoundFinished: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/officialScoring', () => ({
  cardDiscrepancyHoles: jest.fn(() => []),
}));

jest.mock('../../store/officialLeaderboard', () => ({
  buildLeaderboard: jest.fn(() => []),
}));

jest.mock('../../store/officialStore', () => ({
  attestCard: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(() => Promise.resolve(null)),
  attachMedia: jest.fn(() => Promise.resolve()),
}));

describe('ScorecardScreen round decision notice', () => {
  const originalWindow = global.window;
  const originalPlatformOS = Platform.OS;
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOfficialRoundState = {
      loading: false,
      error: null,
      round: null,
      members: [],
      scores: [],
      myRosterId: null,
      refresh: jest.fn(),
      setScore: jest.fn(),
      hasAttested: false,
      editableSource: jest.fn(() => null),
    };
    roundPairClinched
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(0);
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'web',
    });
    global.window = { ...(originalWindow ?? {}), alert: jest.fn() };
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => originalPlatformOS,
    });
    global.window = originalWindow;
  });

  test('shows an in-app explanation instead of a browser alert when a round is decided', async () => {
    const { findByLabelText, findByText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => {
      expect(roundPairClinched).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(await findByLabelText('Enter clinching score'));
    fireEvent.press(await findByLabelText('Next hole'));

    expect(global.window.alert).not.toHaveBeenCalled();
    expect(await findByText('Round decided')).toBeTruthy();
    expect(await findByText('Noé has already won this round. You can keep scoring, but the round result will not change.')).toBeTruthy();
  });

  test('does not show notes controls on official scorecards', async () => {
    mockOfficialRoundState = {
      ...mockOfficialRoundState,
      round: {
        id: 'official-round-1',
        tournament_id: 'official-tournament-1',
        course_name: 'Official Course',
        course: {
          holes: [
            { number: 1, par: 4, strokeIndex: 1 },
            { number: 2, par: 4, strokeIndex: 2 },
          ],
        },
      },
      members: [
        {
          roster_id: 'p1',
          display_name: 'Noé',
          handicap: 0,
          marks_roster_id: null,
          withdrawn: false,
        },
      ],
      myRosterId: 'p1',
      editableSource: jest.fn((playerId) => (playerId === 'p1' ? 'self' : null)),
    };
    const officialRoute = {
      params: { official: true, token: 'token-1', roundId: 'official-round-1' },
    };

    const { findByText, queryByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={officialRoute} />
    ));

    expect(await findByText('Scorecard')).toBeTruthy();
    expect(queryByLabelText('Add notes')).toBeNull();
    expect(queryByLabelText('Open notes')).toBeNull();
  });
});
