import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { notifyLeagueTeeOff } from '../../store/leagueStore';
import { resetLeagueTeeOffForTests } from '../../lib/leagueTeeOff';

// publishHole resolves async, and its rejection opens the ConflictWizardSheet
// (which itself mounts a BottomSheet and resets several bits of state in a
// useEffect keyed on `visible`); flush those chained promises (inside act)
// so the follow-up setState calls don't land outside act().
// League play in the app (plan §4.3 Scorecard, P6): tee-off on the first
// tap and Finish → LeagueValidate, only for the card owner's phone.
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

// The screen uses useFocusEffect for its cross-device live pull; run the effect
// on mount (and its cleanup on unmount) without needing a NavigationContainer.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => cb(), [cb]);
  },
  useIsFocused: () => true,
  CommonActions: { reset: (x) => x },
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
  league: { leagueId: 'L1', cardId: 'card-1', playerId: 'p1' },
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

// The card engine is exercised in src/engine/**; here it is mocked so the
// screen's own wiring is what the test observes.
const mockCardActions = {
  setDraftEntry: jest.fn(() => Promise.resolve()),
  setDraftShot: jest.fn(() => Promise.resolve()),
  publishHole: jest.fn(() => Promise.resolve(true)),
  resolve: jest.fn(() => Promise.resolve()),
  identify: jest.fn(() => Promise.resolve()),
};

let mockCardState = {
  myAuthorId: 'dev-me',
  cardsByAuthor: {},
  resolutions: {},
  draft: {},
  pending: { cards: false, resolutions: false },
  lastPulledAt: null,
  loaded: true,
};

jest.mock('../../hooks/useRoundCards', () => ({
  useRoundCards: () => ({ state: mockCardState, actions: mockCardActions }),
  useSyncStatus: () => 'idle',
}));

jest.mock('../../engine/store/roundState', () => ({
  getRoundState: () => mockCardState,
}));

jest.mock('../../engine/store/replicator', () => ({
  closeLive: jest.fn(),
  getLastError: jest.fn(() => null),
  onSynced: jest.fn(() => jest.fn()),
  openLive: jest.fn(),
  pull: jest.fn(() => Promise.resolve(true)),
  reconnect: jest.fn(() => Promise.resolve('t1')),
  schedulePush: jest.fn(),
}));

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
    HoleView: ({ onSetScore, onNext, onGoToHole, onFinish, currentHole }) => (
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
          accessibilityLabel="Score plus p2"
          onPress={() => onSetScore('p2', 1, '4')}
        >
          <Text>Score plus p2</Text>
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
          accessibilityLabel="Swipe to hole 2"
          onPress={() => onGoToHole(2)}
        >
          <Text>Swipe to hole 2</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Swipe to hole 1"
          onPress={() => onGoToHole(1)}
        >
          <Text>Swipe to hole 1</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Finish round"
          onPress={onFinish}
        >
          <Text>Finish round</Text>
        </TouchableOpacity>
        <Text accessibilityLabel="Current hole">{String(currentHole)}</Text>
      </View>
    ),
  };
});

jest.mock('../../components/scorecard/GridView', () => ({
  ...jest.requireActual('../../components/scorecard/GridView'),
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

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((t) => Promise.resolve(t)),
}));

jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(),
  syncNow: jest.fn(() => Promise.resolve()),
  syncSettled: jest.fn(() => Promise.resolve()),
  retrySync: jest.fn(),
}));

jest.mock('../../store/libraryStore', () => ({
  getCachedPlayers: jest.fn(() => Promise.resolve([])),
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

jest.mock('../../store/leagueStore', () => ({
  notifyLeagueTeeOff: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(() => Promise.resolve(null)),
  attachMedia: jest.fn(() => Promise.resolve()),
}));


describe('ScorecardScreen on a league round', () => {
  const originalPlatformOS = Platform.OS;
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
    dispatch: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetLeagueTeeOffForTests();
    require('@react-native-async-storage/async-storage').clear();
    mockTournament.league = { leagueId: 'L1', cardId: 'card-1', playerId: 'p1' };
    mockOfficialRoundState = {
      loading: false, error: null, round: null, members: [], scores: [], myRosterId: null,
      refresh: jest.fn(), setScore: jest.fn(), hasAttested: false, editableSource: jest.fn(() => null),
    };
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  test('the first score tap notifies the league once, however many taps follow', async () => {
    const { findByLabelText, getByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => expect(notifyLeagueTeeOff).toHaveBeenCalledWith('card-1'));
    fireEvent.press(getByLabelText('Score plus p2'));
    fireEvent.press(getByLabelText('Score plus'));
    await flush();
    expect(notifyLeagueTeeOff).toHaveBeenCalledTimes(1);
  });

  test("a partner's phone (not the card's player) never calls it", async () => {
    mockTournament.league = { leagueId: 'L1', cardId: 'card-1', playerId: 'p2' };
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => expect(mockCardActions.setDraftEntry).toHaveBeenCalled());
    await flush();
    expect(notifyLeagueTeeOff).not.toHaveBeenCalled();
  });

  test('Finish goes on to LeagueValidate with the card and round', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByLabelText('Finish round'));
    await waitFor(() => {
      const reset = navigation.dispatch.mock.calls.map(([a]) => a).find((a) => a?.routes);
      expect(reset?.routes?.[1]).toEqual({
        name: 'LeagueValidate',
        params: { leagueId: 'L1', cardId: 'card-1', tournamentId: 't1', roundId: 'r1' },
      });
    }, { timeout: 3000 });
  });
});
