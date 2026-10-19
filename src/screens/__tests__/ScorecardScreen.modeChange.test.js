import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { mutate } from '../../store/mutate';
import { setScoringModeRoundPatches } from '../../store/tournamentStore';

// The screen uses useFocusEffect for its cross-device live pull; run the effect
// on mount (and its cleanup on unmount) without needing a NavigationContainer.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => cb(), [cb]);
  },
  useIsFocused: () => true,
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
  ...jest.requireActual('../../components/scorecard/GridView'),
  GridView: () => null,
}));

jest.mock('../../components/MediaLightbox', () => () => null);
jest.mock('../../components/AttachMediaSheet', () => () => null);
jest.mock('../../components/CaptureMenuSheet', () => () => null);
jest.mock('../../components/SyncStatusSheet', () => () => null);
// Capture the sheet's props so the test can confirm a mode change directly.
let mockModeSheetProps = null;
jest.mock('../../components/ScoringModeChangeSheet', () => (props) => {
  mockModeSheetProps = props;
  return null;
});

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
  roundPairClinched: jest.fn(),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  isRoundComplete: jest.fn(() => false),
  isTournamentFinished: jest.fn(() => false),
  subscribeSyncStatus: jest.fn(() => jest.fn()),
  getActiveTournamentSnapshot: jest.fn(() => mockTournament),
  getTournament: jest.fn(() => Promise.resolve(mockTournament)),
  getTournamentSnapshot: jest.fn(() => mockTournament),
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

jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(() => Promise.resolve(null)),
  attachMedia: jest.fn(() => Promise.resolve()),
}));

describe('ScorecardScreen scoring-mode change', () => {
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };

  beforeEach(() => {
    jest.clearAllMocks();
    mockModeSheetProps = null;
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
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

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    console.warn.mockRestore();
  });

  test('a rejected save raises the save-error banner and is not left unhandled', async () => {
    mutate.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
    const r = render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    await r.findByText('Scorecard');
    expect(r.queryByLabelText('Retry saving')).toBeNull();

    await act(async () => {
      await expect(mockModeSheetProps.onConfirm('bestball')).resolves.toBeUndefined();
    });

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      expect.objectContaining({ type: 'tournament.setScoringMode', scoringMode: 'bestball' }),
    );
    expect(await r.findByLabelText('Retry saving')).toBeTruthy();
    // Let any stray rejection reach the process before checking.
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    expect(unhandled).toEqual([]);
  });

  test('runs on the serial save chain, after a save already queued', async () => {
    const order = [];
    let releaseFirst;
    mutate
      .mockImplementationOnce((t) => new Promise((resolve) => {
        releaseFirst = () => { order.push('setMe'); resolve(t); };
      }))
      .mockImplementationOnce((t, m) => { order.push(m.type); return Promise.resolve(t); });
    // A roster with no meId and one player: the screen picks "me" through the
    // chain on mount, so that save is in flight when the mode changes.
    const solo = { ...mockTournament, meId: null, players: [mockTournament.players[0]] };
    const store = require('../../store/tournamentStore');
    store.getTournamentSnapshot.mockReturnValue(solo);
    store.getActiveTournamentSnapshot.mockReturnValue(solo);
    store.loadTournament.mockResolvedValue(solo);
    store.getTournament.mockResolvedValue(solo);

    const r = render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    await r.findByText('Scorecard');
    await waitFor(() => expect(releaseFirst).toBeDefined());

    let done;
    act(() => { done = mockModeSheetProps.onConfirm('bestball'); });
    // Queued behind the in-flight save: nothing written yet.
    expect(setScoringModeRoundPatches).not.toHaveBeenCalled();
    await act(async () => { releaseFirst(); await done; });
    expect(order).toEqual(['setMe', 'tournament.setScoringMode']);
    expect(r.queryByLabelText('Retry saving')).toBeNull();
  });

  test('choosing the current mode writes nothing', async () => {
    const r = render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    await r.findByText('Scorecard');
    mutate.mockClear();
    await act(async () => { await mockModeSheetProps.onConfirm('stableford'); });
    expect(mutate).not.toHaveBeenCalled();
  });
});
