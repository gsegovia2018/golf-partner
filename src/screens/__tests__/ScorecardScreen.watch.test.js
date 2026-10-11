// Wear OS companion, end to end through the scorecard: a watch command goes
// through useWatchBridge into the screen's draft chain. Harness copied from
// ScorecardScreen.publish.test.js (card engine and children mocked).
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
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

jest.mock('../../lib/watchBridge', () => ({
  setWatchState: jest.fn(),
  addWatchCommandListener: jest.fn(() => ({ remove: jest.fn() })),
}));
// eslint-disable-next-line import/first
import { setWatchState, addWatchCommandListener } from '../../lib/watchBridge';

const EMPTY_CARDS = {
  myAuthorId: 'dev-me',
  cardsByAuthor: {},
  resolutions: {},
  draft: {},
  pending: { cards: false, resolutions: false },
  lastPulledAt: null,
  loaded: true,
};

// The draft writers update the store getRoundState reads, like the engine
// does — but nothing re-renders the screen, so anything the screen derives
// from its last render (shotDetailsRef) stays behind, as on a busy phone.
const writeDraft = (hole, fn) => {
  const h = String(hole);
  const cur = mockCardState.draft[h] ?? { entries: {} };
  mockCardState = { ...mockCardState, draft: { ...mockCardState.draft, [h]: fn({ ...cur }) } };
};
const lastState = () => setWatchState.mock.calls.at(-1)[0];
let nextId = 0;
const watch = (cmd) => {
  const cb = addWatchCommandListener.mock.calls.at(-1)[0];
  return cb(JSON.stringify({
    v: 1, id: `w${++nextId}`, roundId: 'r1', baseRev: lastState().rev, ...cmd,
  }));
};

describe('ScorecardScreen watch commands', () => {
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
    dispatch: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const route = { params: { roundIndex: 0 } };
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCardState = EMPTY_CARDS;
    mockCardActions.setDraftEntry.mockImplementation(async (hole, playerId, value) => {
      writeDraft(hole, (d) => ({ ...d, entries: { ...d.entries, [playerId]: value } }));
    });
    mockCardActions.setDraftShot.mockImplementation(async (hole, playerId, detail) => {
      writeDraft(hole, (d) => {
        const shots = { ...(d.shots ?? {}) };
        if (detail == null) delete shots[playerId];
        else shots[playerId] = detail;
        return { ...d, shots };
      });
    });
    mockOfficialRoundState = {
      loading: false, error: null, round: null, members: [], scores: [], myRosterId: null,
      refresh: jest.fn(), setScore: jest.fn(), hasAttested: false, editableSource: jest.fn(() => null),
    };
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  });

  afterEach(() => {
    mockCardActions.setDraftEntry.mockImplementation(() => Promise.resolve());
    mockCardActions.setDraftShot.mockImplementation(() => Promise.resolve());
    mockCardActions.publishHole.mockImplementation(() => Promise.resolve(true));
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  const mount = async () => {
    const screen = render(wrap(<ScorecardScreen navigation={navigation} route={route} />));
    await screen.findByLabelText('Current hole');
    await waitFor(() => expect(lastState()).toMatchObject({ active: true, hole: { number: 1 } }));
    return screen;
  };
  // Hole 2 is the one my card already holds (hole 1 is where the round resumes).
  const mountOnHole2 = async () => {
    const screen = await mount();
    fireEvent.press(screen.getByLabelText('Swipe to hole 2'));
    await waitFor(() => expect(lastState().hole.number).toBe(2));
    return screen;
  };

  test('a watch write behind the publish of the hole being left is refused', async () => {
    let releasePublish;
    mockCardActions.publishHole.mockImplementation(
      () => new Promise((resolve) => { releasePublish = () => resolve(true); }),
    );
    const { getByLabelText } = await mount();

    fireEvent.press(getByLabelText('Swipe to hole 2')); // publishing hole 1…
    await waitFor(() => expect(mockCardActions.publishHole).toHaveBeenCalledWith(1));
    let pending;
    await act(async () => { pending = watch({ type: 'strokes', hole: 1, value: 5 }); });
    await act(async () => { releasePublish(); await pending; });

    // Hole 1 went out without it, and no new hole-1 draft was opened behind it.
    expect(mockCardActions.setDraftEntry).not.toHaveBeenCalled();
    await waitFor(() => expect(getByLabelText('Current hole').props.children).toBe('2'));
    expect(lastState().hole.number).toBe(2);
    expect(lastState().me.strokes).toBeNull();
  });

  test('a shot builds on the detail the strokes write just trimmed, not on the last render', async () => {
    // I published hole 2: 5 strokes, 3 putts and a tee penalty.
    mockCardState = {
      ...EMPTY_CARDS,
      cardsByAuthor: {
        'dev-me': {
          scorer: { playerId: 'p1', userId: null },
          holes: {
            2: {
              v: 1, ts: 1000, entries: { p1: 5 },
              shots: { p1: { putts: 3, teePenalties: 1, firstPuttBucket: 'short' } },
            },
          },
        },
      },
    };
    await mountOnHole2();

    await act(async () => {
      // As the watch sends a save: strokes, then the stats, back to back.
      await Promise.all([
        watch({ type: 'strokes', hole: 2, value: 3 }),
        watch({ type: 'shot', hole: 2, patch: { driveLie: 'fairway' } }),
      ]);
    });

    const shot = mockCardState.draft['2'].shots.p1;
    expect(mockCardState.draft['2'].entries.p1).toBe(3);
    // 3 putts + 1 tee penalty do not fit in 3 strokes: putts were trimmed to 2
    // by the strokes write, and the shot kept that rather than resurrect 3.
    expect(shot).toMatchObject({ putts: 2, teePenalties: 1, driveLie: 'fairway', drive: null });
  });

  test('a shot after the strokes were cleared does not resurrect the detail', async () => {
    mockCardState = {
      ...EMPTY_CARDS,
      cardsByAuthor: {
        'dev-me': {
          scorer: { playerId: 'p1', userId: null },
          holes: { 2: { v: 1, ts: 1000, entries: { p1: 5 }, shots: { p1: { putts: 2 } } } },
        },
      },
    };
    await mountOnHole2();

    await act(async () => {
      await Promise.all([
        watch({ type: 'strokes', hole: 2, value: null }),
        watch({ type: 'shot', hole: 2, patch: { putts: 1 } }),
      ]);
    });

    expect(mockCardState.draft['2'].entries.p1).toBeNull();
    expect(mockCardState.draft['2'].shots?.p1).toBeUndefined();
  });

  test('watch strokes on the open hole land in the draft and are acked after', async () => {
    await mount();
    const before = setWatchState.mock.calls.length;
    await act(async () => { await watch({ type: 'strokes', hole: 1, value: 4 }); });
    expect(mockCardActions.setDraftEntry).toHaveBeenCalledWith(1, 'p1', 4);
    expect(setWatchState.mock.calls.length).toBeGreaterThan(before);
    expect(mockCardActions.publishHole).not.toHaveBeenCalled();
  });
  test('a watch shot with a drive and an approach finish lands as the panel would store it', async () => {
    await mount();
    await act(async () => {
      await watch({ type: 'strokes', hole: 1, value: 5 });
      await watch({ type: 'shot', hole: 1, patch: { drive: 'left', driveLie: 'trouble', teeClub: 'iron' } });
      await watch({ type: 'shot', hole: 1, patch: { approachBucket: '100-150' } });
      await watch({
        type: 'shot', hole: 1, patch: { approachResult: 'miss', approachMiss: 'left', approachBunker: true, putts: 2 },
      });
    });
    expect(mockCardState.draft['1'].shots.p1).toMatchObject({
      // panel: a direction tap resets the lie, then the lie chip refines it
      drive: 'left', driveLie: 'trouble', teeClub: 'iron',
      approachBucket: '100-150', approachResult: 'miss', approachMiss: 'left', approachBunker: true,
      putts: 2,
    });
    // the pushed state shows my values for the hole
    await waitFor(() => expect(lastState().mine[1].shot).toMatchObject({
      drive: 'left', approachMiss: 'left', approachBunker: true, putts: 2,
    }));

    // On green clears the miss and the bunker; a direction then replaces it.
    await act(async () => {
      await watch({ type: 'shot', hole: 1, patch: { approachResult: 'green' } });
    });
    expect(mockCardState.draft['1'].shots.p1).toMatchObject({
      approachResult: 'green', approachMiss: null, approachBunker: false,
    });
  });

  test('tee penalties from the watch are trimmed against strokes like the rest', async () => {
    await mount();
    await act(async () => {
      await watch({ type: 'strokes', hole: 1, value: 3 });
      await watch({ type: 'shot', hole: 1, patch: { teePenalties: 2, putts: 2 } });
    });
    const shot = mockCardState.draft['1'].shots.p1;
    // 4 > 3: putts are trimmed first, the tee penalties stay.
    expect(shot).toMatchObject({ putts: 1, teePenalties: 2 });
  });
});
