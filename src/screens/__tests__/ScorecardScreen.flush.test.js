import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { mutate } from '../../store/mutate';
import { syncNow } from '../../store/syncWorker';

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
    HoleView: ({ onSetScore, onNext, onFinish }) => (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Score plus"
          onPress={() => onSetScore('p1', 1, '4')}
        >
          <Text>Score plus</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Next hole"
          onPress={onNext}
        >
          <Text>Next hole</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Finish round"
          onPress={onFinish}
        >
          <Text>Finish round</Text>
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

describe('ScorecardScreen batched score sync', () => {
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

  test('a score tap saves with deferSync and does not kick syncNow', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    // Let the mount-time flush effect (and any initial load) settle before
    // snapshotting the call count — the mount effect may legitimately fire
    // syncNow once on an empty queue.
    await waitFor(() => {
      expect(mockOfficialRoundState.editableSource).toBeDefined();
    });
    const callsBeforeTap = syncNow.mock.calls.length;

    fireEvent.press(await findByLabelText('Score plus'));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'score.set' }),
        expect.objectContaining({ deferSync: true }),
      );
    });

    expect(syncNow.mock.calls.length).toBe(callsBeforeTap);
  });

  test('navigating to the next hole kicks syncNow', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'score.set' }),
        expect.objectContaining({ deferSync: true }),
      );
    });

    syncNow.mockClear();

    fireEvent.press(await findByLabelText('Next hole'));

    await waitFor(() => {
      expect(syncNow).toHaveBeenCalled();
    });
  });

  test('a failing save at finish time surfaces the finish-failed alert and aborts', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    // Dirty a cell. In this fixture the real mutate rejects (the
    // tournamentStore mock has no saveLocal), so the tap's own autoSave fails
    // and the score stays uncommitted — exactly the dirty state the
    // finish-time flush has to re-push (and fail on again).
    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });

    syncNow.mockClear();
    navigation.navigate.mockClear();

    fireEvent.press(await findByLabelText('Finish round'));

    // The flush's catch must surface the failure (web branch: window.alert)…
    await waitFor(() => {
      expect(global.window.alert).toHaveBeenCalled();
    });
    // …and abort the finish: no sync kick, no navigation.
    expect(syncNow).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('unmounting the screen kicks syncNow', async () => {
    const { unmount } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => {
      expect(mockOfficialRoundState.editableSource).toBeDefined();
    });

    syncNow.mockClear();

    act(() => {
      unmount();
    });

    expect(syncNow).toHaveBeenCalled();
  });
});
