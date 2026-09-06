import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';

// Regression test (audit fix): `setScore`/`stepScore`/`setShot` used to
// depend on `visibleScores` / `shotDetails`, both of which are freshly
// derived objects on every card-state change. That made all three a new
// function on every draft write, which defeats `holePagePropsEqual`
// (src/components/scorecard/HolePage.js) — it bails out early whenever
// `onSetScore`/`onStep`/`onSetShot` changes identity, re-rendering all 18
// HolePage instances (and every PlayerCard inside them) for one tap.
//
// The fix reads those churning values through refs instead, so the three
// callbacks stay referentially stable across a card-state change. This test
// forces exactly that kind of change (a new `cardState` object, as a real
// draft write would produce) and asserts the callback identities the screen
// hands to HoleView survive it.

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

const mockCardActions = {
  setDraftEntry: jest.fn(() => Promise.resolve()),
  setDraftShot: jest.fn(() => Promise.resolve()),
  publishHole: jest.fn(() => Promise.resolve(true)),
  resolve: jest.fn(() => Promise.resolve()),
  identify: jest.fn(() => Promise.resolve()),
};

const EMPTY_CARDS = {
  myAuthorId: 'dev-me',
  cardsByAuthor: {},
  resolutions: {},
  draft: {},
  pending: { cards: false, resolutions: false },
  lastPulledAt: null,
  loaded: true,
};

let mockCardState = EMPTY_CARDS;

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

// Captures the exact callback props the screen hands to HoleView, each time
// it renders — the test inspects these instead of a full HolePage render
// count, per the fallback the task description allows.
let mockLastHoleViewProps = null;
jest.mock('../../components/scorecard/HoleView', () => {
  const { View } = require('react-native');
  return {
    HoleView: (props) => {
      mockLastHoleViewProps = props;
      return <View />;
    },
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

describe('ScorecardScreen callback stability across a card-state change (HolePage memo)', () => {
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
    dispatch: jest.fn(),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCardState = EMPTY_CARDS;
    mockLastHoleViewProps = null;
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

  test('onSetScore/onStep/onSetShot keep their identity when a draft write changes card state', async () => {
    const { rerender } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />,
    ));

    await waitFor(() => expect(mockLastHoleViewProps).not.toBeNull());
    const before = {
      scores: mockLastHoleViewProps.scores,
      shotDetails: mockLastHoleViewProps.shotDetails,
      onSetScore: mockLastHoleViewProps.onSetScore,
      onStep: mockLastHoleViewProps.onStep,
      onSetShot: mockLastHoleViewProps.onSetShot,
    };
    expect(before.onSetScore).toEqual(expect.any(Function));
    expect(before.onStep).toEqual(expect.any(Function));
    expect(before.onSetShot).toEqual(expect.any(Function));

    // Stand in for what a draft write actually does: the engine hands back a
    // brand-new `cardState` object (never the same reference twice).
    mockCardState = {
      ...EMPTY_CARDS,
      draft: { 1: { entries: { p1: 4 } } },
    };
    rerender(wrap(<ScorecardScreen navigation={navigation} route={route} />));

    // Sanity: the rerender actually picked up the new card state — scores
    // and shot details ARE expected to churn on every draft write.
    await waitFor(() => {
      expect(mockLastHoleViewProps.scores).not.toBe(before.scores);
    });

    // The callbacks themselves must not churn along with them.
    expect(mockLastHoleViewProps.onSetScore).toBe(before.onSetScore);
    expect(mockLastHoleViewProps.onStep).toBe(before.onStep);
    expect(mockLastHoleViewProps.onSetShot).toBe(before.onSetShot);
  });
});
