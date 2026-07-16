import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { mutate } from '../../store/mutate';

// The screen uses useFocusEffect for its cross-device live pull; run the effect
// on mount (and its cleanup on unmount) without needing a NavigationContainer.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => cb(), [cb]);
  },
}));

let mockOfficialRoundState;

const mockPlayers = [
  { id: 'p1', name: 'Noé' },
  { id: 'p2', name: 'Alex' },
];

// Hole 1 starts scored (5 strokes) WITH a logged shot detail for "me" (p1) —
// the exact state a long-press-to-clear acts on.
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
    scores: { p1: { 1: 5 } },
    shotDetails: { p1: { 1: { putts: 2, sandShots: 1 } } },
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

// Surface the screen's live shotDetails state and a "clear score" trigger —
// the same onSetScore(playerId, hole, '') call PlayerCard's long-press makes.
jest.mock('../../components/scorecard/HoleView', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    HoleView: ({ onSetScore, shotDetails }) => (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Clear score"
          onPress={() => onSetScore('p1', 1, '')}
        >
          <Text>Clear score</Text>
        </TouchableOpacity>
        <Text accessibilityLabel="Shot details dump">
          {JSON.stringify(shotDetails)}
        </Text>
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
  roundPairClinched: jest.fn(() => null),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  isRoundComplete: jest.fn(() => false),
  isTournamentFinished: jest.fn(() => false),
  subscribeSyncStatus: jest.fn(() => jest.fn()),
  getActiveTournamentSnapshot: jest.fn(() => mockTournament),
  getTournament: jest.fn(() => Promise.resolve(mockTournament)),
  getTournamentSnapshot: jest.fn(() => mockTournament),
  readLocal: jest.fn(() => Promise.resolve(mockTournament)),
}));

jest.mock('../../store/mutate', () => {
  const actual = jest.requireActual('../../store/mutate');
  return { ...actual, mutate: jest.fn(actual.mutate) };
});

jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(),
  syncNow: jest.fn(() => Promise.resolve()),
  syncSettled: jest.fn(() => Promise.resolve()),
  retrySync: jest.fn(),
}));

jest.mock('../../store/libraryStore', () => ({
  fetchPlayers: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../store/notificationStore', () => ({
  notifyRoundFinished: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../store/officialScoring', () => ({
  cardDiscrepancyHoles: jest.fn(() => []),
  officialHolesFromCourse: jest.fn(() => []),
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

describe('ScorecardScreen — clearing a score also clears its shot detail', () => {
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
  });

  test('hold-to-clear removes the hole shot detail locally and persists the deletion', async () => {
    const { findByLabelText, getByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    // Sanity: the seeded detail is on screen before the clear.
    const dumpBefore = (await findByLabelText('Shot details dump')).props.children;
    expect(JSON.parse(dumpBefore)).toEqual({ p1: { 1: { putts: 2, sandShots: 1 } } });

    fireEvent.press(getByLabelText('Clear score'));

    // Local state: hole 1's detail is gone.
    await waitFor(() => {
      const dump = getByLabelText('Shot details dump').props.children;
      expect(JSON.parse(dump)?.p1?.[1]).toBeUndefined();
    });

    // Persistence: a shot.set with a null detail (delete/tombstone) went
    // through the mutate chain alongside the score.set clear.
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'shot.set', roundId: 'r1', playerId: 'p1', hole: 1, detail: null,
        }),
      );
    });
  });
});
