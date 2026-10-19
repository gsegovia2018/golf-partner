import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';

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

// Hole 1 starts scored (5 strokes) WITH a logged shot detail for "me" (p1) —
// the exact state a long-press-to-clear acts on. Both live on MY published
// card now, not in the tournament blob.
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

// The cards come off disk AFTER the first render, the way useRoundCards
// hydrates on a page reload: first an empty, unloaded state, then the stored
// one, whose hole-1 draft holds strokes and putts not yet published.
const mockEmptyCards = {
  myAuthorId: 'dev-me',
  cardsByAuthor: {},
  resolutions: {},
  draft: {},
  pending: { cards: false, resolutions: false },
  lastPulledAt: null,
  loaded: false,
};
const mockStoredCards = {
  ...mockEmptyCards,
  draft: { 1: { entries: { p1: 5 }, shots: { p1: { putts: 2 } } } },
  loaded: true,
};
let mockCardState = mockEmptyCards;
const mockCardListeners = new Set();
function mockHydrate() {
  mockCardState = mockStoredCards;
  mockCardListeners.forEach((l) => l());
}

jest.mock('../../hooks/useRoundCards', () => ({
  useRoundCards: () => {
    const { useSyncExternalStore } = require('react');
    const state = useSyncExternalStore(
      (l) => { mockCardListeners.add(l); return () => mockCardListeners.delete(l); },
      () => mockCardState,
    );
    return { state, actions: mockCardActions };
  },
  useSyncStatus: () => 'idle',
}));

// loadRound is what a draft write awaits when the cards are not loaded yet:
// it hydrates them from disk.
jest.mock('../../engine/store/roundState', () => ({
  getRoundState: () => mockCardState,
  loadRound: jest.fn(async () => { mockHydrate(); return mockCardState; }),
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

// The real HoleView runs the drive-distance autofill against the screen's
// shotDetails and onSetShot; this stand-in does exactly that and nothing else.
jest.mock('../../components/scorecard/HoleView', () => {
  const { useDriveDistanceAutofill } = jest.requireActual('../../hooks/useDriveDistanceAutofill');
  return {
    HoleView: ({ round, roundIndex, meId, shotDetails, onSetShot }) => {
      useDriveDistanceAutofill({
        roundId: round?.id ?? null, roundIndex, meId, holes: round?.holes, shotDetails, onSetShot,
      });
      return null;
    },
  };
});

// A GPS-marked tee shot on hole 1 that carried 200 m.
jest.mock('../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 1,
  getShots: () => [],
}));
jest.mock('../../lib/shotStats', () => ({
  ...jest.requireActual('../../lib/shotStats'),
  longestCarryByHole: () => new Map([[1, { meters: 200 }]]),
}));

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

describe('ScorecardScreen — a reload keeps the hole draft\'s shot detail', () => {
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCardState = mockEmptyCards;
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

  test('a shot write queued before the cards hydrate keeps the stored putts', async () => {
    // Mount on the unloaded cards: the autofill sees a blank bucket and writes
    // one. The write hydrates the cards before it lands.
    render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    await waitFor(() => expect(mockCardActions.setDraftShot).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    const hole1 = mockCardActions.setDraftShot.mock.calls
      .filter(([hole, playerId]) => hole === 1 && playerId === 'p1');
    expect(hole1.length).toBeGreaterThan(0);
    for (const [, , detail] of hole1) {
      expect(detail).toEqual(expect.objectContaining({ putts: 2, driveDistBucket: '180-210' }));
    }
  });
});
