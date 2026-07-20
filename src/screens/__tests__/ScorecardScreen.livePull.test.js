import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { refreshTournamentFromRemote } from '../../store/tournamentStore';
import { isOnline } from '../../lib/connectivity';

// Fix 4 — cross-device live pull. The scorecard must re-fetch peers' scores
// on focus and on a periodic interval while focused + online, guarding against
// overlapping refreshes and cleaning up on blur/unmount. Official mode uses the
// RPC data layer, not the tournament blob, so it must NOT pull.

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

let mockOfficialRoundState = {
  loading: true,
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

// Run the focus effect on mount and its cleanup on unmount — this models a
// screen gaining focus then blurring/unmounting for the interval-teardown test.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => cb(), [cb]);
  },
}));

jest.mock('../../lib/connectivity', () => ({
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(() => jest.fn()),
}));

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

jest.mock('../../components/scorecard/HoleView', () => ({ HoleView: () => null }));
jest.mock('../../components/scorecard/GridView', () => ({
  ...jest.requireActual('../../components/scorecard/GridView'),
  GridView: () => null,
}));
jest.mock('../../components/MediaLightbox', () => () => null);
jest.mock('../../components/AttachMediaSheet', () => () => null);
jest.mock('../../components/CaptureMenuSheet', () => () => null);
jest.mock('../../components/SyncStatusSheet', () => () => null);
jest.mock('../../components/ScoringModeChangeSheet', () => () => null);

jest.mock('../../hooks/useRoundMedia', () => ({ useRoundMedia: () => ({ items: [] }) }));
jest.mock('../../hooks/useOfficialRound', () => ({
  useOfficialRound: () => mockOfficialRoundState,
}));

jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

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
  refreshTournamentFromRemote: jest.fn(() => Promise.resolve(mockTournament)),
}));

jest.mock('../../store/mutate', () => ({ mutate: jest.fn((t) => Promise.resolve(t)) }));
jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(),
  syncNow: jest.fn(() => Promise.resolve()),
  syncSettled: jest.fn(() => Promise.resolve()),
  retrySync: jest.fn(),
}));
jest.mock('../../store/libraryStore', () => ({ fetchPlayers: jest.fn(() => Promise.resolve([])) }));
jest.mock('../../store/notificationStore', () => ({ notifyRoundFinished: jest.fn(() => Promise.resolve()) }));
jest.mock('../../store/officialScoring', () => ({
  cardDiscrepancyHoles: jest.fn(() => []),
  officialHolesFromCourse: jest.fn(() => []),
}));
jest.mock('../../store/officialLeaderboard', () => ({ buildLeaderboard: jest.fn(() => []) }));
jest.mock('../../store/officialStore', () => ({ attestCard: jest.fn(() => Promise.resolve()) }));
jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(() => Promise.resolve(null)),
  attachMedia: jest.fn(() => Promise.resolve()),
}));

const navigation = {
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  navigate: jest.fn(),
};
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// Flush pending microtasks so an in-flight refresh's `finally` clears the guard.
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('ScorecardScreen live pull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isOnline.mockReturnValue(true);
    refreshTournamentFromRemote.mockResolvedValue(mockTournament);
    mockOfficialRoundState = {
      loading: true,
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
    jest.useRealTimers();
  });

  test('pulls remote on focus and again on the interval, using the route tournament id', async () => {
    jest.useFakeTimers();
    const route = { params: { roundIndex: 0, tournamentId: 't1' } };

    render(wrap(<ScorecardScreen navigation={navigation} route={route} />));

    // Focus fires an immediate pull.
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(1);
    expect(refreshTournamentFromRemote).toHaveBeenCalledWith('t1');

    await flush();
    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(2);

    await flush();
    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(3);
  });

  test('does not overlap refreshes while one is in flight', async () => {
    jest.useFakeTimers();
    let resolvePull;
    refreshTournamentFromRemote.mockImplementation(
      () => new Promise((res) => { resolvePull = res; }),
    );
    const route = { params: { roundIndex: 0, tournamentId: 't1' } };

    render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(1);

    // Interval ticks while the first pull is still unresolved → no second call.
    await act(async () => { jest.advanceTimersByTime(20000); });
    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(1);

    // Once it resolves, the next tick is allowed to pull again.
    await act(async () => { resolvePull(mockTournament); });
    await flush();
    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(2);
  });

  test('skips the pull when offline', async () => {
    jest.useFakeTimers();
    isOnline.mockReturnValue(false);
    const route = { params: { roundIndex: 0, tournamentId: 't1' } };

    render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    expect(refreshTournamentFromRemote).not.toHaveBeenCalled();

    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(refreshTournamentFromRemote).not.toHaveBeenCalled();
  });

  test('clears the interval on unmount (blur)', async () => {
    jest.useFakeTimers();
    const route = { params: { roundIndex: 0, tournamentId: 't1' } };

    const { unmount } = render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(1);

    await flush();
    unmount();
    await act(async () => { jest.advanceTimersByTime(60000); });
    expect(refreshTournamentFromRemote).toHaveBeenCalledTimes(1);
  });

  test('does not pull in official mode', async () => {
    jest.useFakeTimers();
    const route = { params: { official: true, token: 'tok', roundId: 'or1' } };

    render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    await act(async () => { jest.advanceTimersByTime(20000); });

    expect(refreshTournamentFromRemote).not.toHaveBeenCalled();
  });
});
