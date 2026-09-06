import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { getLastError, reconnect } from '../../engine/store/replicator';

// publishHole resolves async, and its rejection opens the ConflictWizardSheet
// (which itself mounts a BottomSheet and resets several bits of state in a
// useEffect keyed on `visible`); flush those chained promises (inside act)
// so the follow-up setState calls don't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

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

// Publication on leaving the hole (plan §1: R1, R2, R7, R9). A tap writes
// only the private draft; the hole goes out as one packet when the scorer
// walks off it — never on unmount, never on background.
const EMPTY_CARDS = {
  myAuthorId: 'dev-me',
  cardsByAuthor: {},
  resolutions: {},
  draft: {},
  pending: { cards: false, resolutions: false },
  lastPulledAt: null,
  loaded: true,
};

// Hole 1: I published 5 for p1, another phone published 4.
const DISAGREEING_CARDS = {
  ...EMPTY_CARDS,
  cardsByAuthor: {
    'dev-me': {
      scorer: { playerId: 'p1', userId: null },
      holes: { 1: { v: 1, ts: 1000, entries: { p1: 5 } } },
    },
    'dev-peer': {
      scorer: { playerId: 'p2', userId: null },
      holes: { 1: { v: 1, ts: 2000, entries: { p1: 4 } } },
    },
  },
};

// Hole 1: my card marks p1 as 4 — a resolve that lost the server race — but
// a valid resolution (basis anchored to both cards' current versions) names
// 5 as the agreed value. Re-opening the hole must seed 5, the value the cell
// actually SHOWS, never the raw losing entry (audit fix).
const RESOLVED_AGAINST_ME_CARDS = {
  ...EMPTY_CARDS,
  cardsByAuthor: {
    'dev-me': {
      scorer: { playerId: 'p1', userId: null },
      holes: { 1: { v: 1, ts: 1000, entries: { p1: 4 } } },
    },
    'dev-peer': {
      scorer: { playerId: 'p2', userId: null },
      holes: { 1: { v: 1, ts: 2000, entries: { p1: 5 } } },
    },
  },
  resolutions: {
    p1: {
      1: {
        playerId: 'p1', hole: '1', value: 5, by: 'dev-peer', ts: 3000,
        basis: { 'dev-me': 1, 'dev-peer': 1 },
      },
    },
  },
};

describe('ScorecardScreen publication on leaving the hole', () => {
  const originalWindow = global.window;
  const originalPlatformOS = Platform.OS;
  let beforeRemoveListener;
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
    dispatch: jest.fn(),
    addListener: jest.fn((event, cb) => {
      if (event === 'beforeRemove') beforeRemoveListener = cb;
      return jest.fn();
    }),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    beforeRemoveListener = null;
    mockCardState = EMPTY_CARDS;
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

  test('a score tap writes the draft and publishes nothing (R1, R2)', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));

    await waitFor(() => {
      expect(mockCardActions.setDraftEntry).toHaveBeenCalledWith(1, 'p1', 4);
    });
    expect(mockCardActions.publishHole).not.toHaveBeenCalled();
  });

  test("the sync sheet's lastError is scoped to this game's tid, not global", async () => {
    render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    await waitFor(() => expect(getLastError).toHaveBeenCalled());
    // A stuck OTHER game's error must never surface on this scorecard —
    // getLastError(tid) scopes the lookup to this tournament.
    expect(getLastError).toHaveBeenCalledWith('t1');
  });

  test('tapping Next publishes the hole being left, then advances (R7)', async () => {
    const { findByLabelText, getByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => expect(mockCardActions.setDraftEntry).toHaveBeenCalled());

    fireEvent.press(getByLabelText('Next hole'));

    await waitFor(() => {
      expect(mockCardActions.publishHole).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(getByLabelText('Current hole').props.children).toBe('2');
    });
  });

  test('a swipe to another hole publishes the one being left too', async () => {
    const { findByLabelText, getByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Swipe to hole 2'));

    await waitFor(() => {
      expect(mockCardActions.publishHole).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(getByLabelText('Current hole').props.children).toBe('2');
    });
  });

  test('a disagreement on the hole just left holds the move and opens the sheet', async () => {
    mockCardState = DISAGREEING_CARDS;
    const { findByLabelText, getByLabelText, getByText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    // My card ends on hole 1, so the round resumes on hole 2. Go back to the
    // disputed hole, then walk off it again.
    fireEvent.press(await findByLabelText('Swipe to hole 1'));
    await waitFor(() => {
      expect(getByLabelText('Current hole').props.children).toBe('1');
    });

    fireEvent.press(getByLabelText('Next hole'));

    await waitFor(() => {
      expect(mockCardActions.publishHole).toHaveBeenCalledWith(1);
    });
    // The sheet names the hole, and the pager has not moved off it.
    await waitFor(() => expect(getByText(/^Hole 1 ·/)).toBeTruthy());
    expect(getByLabelText('Current hole').props.children).toBe('1');
  });

  test('seeding a hole uses the agreed value, not a raw card entry that lost a resolution', async () => {
    mockCardState = RESOLVED_AGAINST_ME_CARDS;
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    // Tap p2's cell — untouched by this tap, p1's own draft entry is written
    // only by the seed, so its value is unambiguous: the resolution's 5, not
    // my card's raw (losing) 4.
    fireEvent.press(await findByLabelText('Score plus p2'));

    await waitFor(() => {
      expect(mockCardActions.setDraftEntry).toHaveBeenCalledWith(1, 'p1', 5);
    });
    expect(mockCardActions.setDraftEntry).not.toHaveBeenCalledWith(1, 'p1', 4);
    expect(mockCardActions.setDraftEntry).toHaveBeenCalledWith(1, 'p2', 4);
  });

  test('Finish publishes the hole in hand and reconnects once (R9)', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Finish round'));

    await waitFor(() => {
      expect(mockCardActions.publishHole).toHaveBeenCalledWith(1);
    });
    expect(reconnect).toHaveBeenCalled();
  });

  test('Finish stays blocked while two cards disagree', async () => {
    mockCardState = DISAGREEING_CARDS;
    const { findByLabelText, getByText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Finish round'));

    await waitFor(() => expect(getByText(/^Hole 1 ·/)).toBeTruthy());
    await flush();
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  test('unmounting never publishes (the hole was not left)', async () => {
    const { findByLabelText, unmount } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => expect(mockCardActions.setDraftEntry).toHaveBeenCalled());

    act(() => { unmount(); });

    expect(mockCardActions.publishHole).not.toHaveBeenCalled();
  });

  test('hardware back / swipe-back publishes the hole in hand before leaving', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));
    await waitFor(() => expect(mockCardActions.setDraftEntry).toHaveBeenCalled());

    expect(navigation.addListener).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
    expect(beforeRemoveListener).toBeInstanceOf(Function);

    const preventDefault = jest.fn();
    const action = { type: 'GO_BACK' };
    await act(async () => {
      beforeRemoveListener({ preventDefault, data: { action } });
      // Let the queued publish (and the finally that re-dispatches) settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(mockCardActions.publishHole).toHaveBeenCalledWith(1);
    expect(navigation.dispatch).toHaveBeenCalledWith(action);
  });

  test('a re-dispatched removal after back-publish is not intercepted again', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    await findByLabelText('Score plus');

    const action = { type: 'GO_BACK' };
    const firstPreventDefault = jest.fn();
    await act(async () => {
      beforeRemoveListener({ preventDefault: firstPreventDefault, data: { action } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(navigation.dispatch).toHaveBeenCalledWith(action);

    // navigation.dispatch(action) above stands in for react-navigation
    // replaying the same removal — the listener must let it through.
    const secondPreventDefault = jest.fn();
    beforeRemoveListener({ preventDefault: secondPreventDefault, data: { action } });
    expect(secondPreventDefault).not.toHaveBeenCalled();
  });

  test('Finish is not double-intercepted by the back listener', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Finish round'));

    await waitFor(() => {
      expect(mockCardActions.publishHole).toHaveBeenCalledWith(1);
    });
    // A single publish for the finish flow — the beforeRemove listener must
    // not have fired a second, competing publish/dispatch.
    expect(mockCardActions.publishHole).toHaveBeenCalledTimes(1);
  });
});
