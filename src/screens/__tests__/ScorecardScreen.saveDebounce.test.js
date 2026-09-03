import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { mutate } from '../../store/mutate';
import { syncNow } from '../../store/syncWorker';

// Score entry persists through mutate() → saveLocal() → syncQueue.enqueue(),
// which deep-clones and rewrites the whole tournament blob. Undebounced, a
// burst of +/- taps ran that chain once per tap. These tests pin the debounce:
// a burst collapses to ONE local save carrying the final value, and every
// point that leaves the hole flushes a pending save rather than dropping it.

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

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

// Expose the stepper so each press is a distinct edit (+1), the way a real
// burst of "+" taps behaves — repeating one fixed value would diff to nothing
// after the first save and hide the very thing under test.
jest.mock('../../components/scorecard/HoleView', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    HoleView: ({ onStep, onNext }) => (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Score plus"
          onPress={() => onStep('p1', 1, 1)}
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
}));

// A mutate() that actually applies the write, so each save's diff sees the
// previously committed value — otherwise every save would re-send the cell.
jest.mock('../../store/mutate', () => {
  const actual = jest.requireActual('../../store/mutate');
  return {
    ...actual,
    mutate: jest.fn(async (tournament, m) => {
      if (m.type !== 'score.set') return tournament;
      const next = JSON.parse(JSON.stringify(tournament));
      const round = next.rounds.find((r) => r.id === m.roundId);
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      if (m.value == null) delete round.scores[m.playerId][m.hole];
      else round.scores[m.playerId][m.hole] = m.value;
      return next;
    }),
  };
});

jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(),
  syncNow: jest.fn(() => Promise.resolve()),
  syncSettled: jest.fn(() => Promise.resolve()),
  retrySync: jest.fn(),
}));

jest.mock('../../store/libraryStore', () => ({ getCachedPlayers: jest.fn(() => Promise.resolve([])), fetchPlayers: jest.fn(() => Promise.resolve([])) }));
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

const scoreSets = () => mutate.mock.calls.filter(([, m]) => m?.type === 'score.set');
const settle = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('ScorecardScreen debounced score saves', () => {
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
    // These tests are about persistence, not motion. The score-bump spring and
    // the celebration sequence are real Animated animations that outlive the
    // test and throw once Jest tears the environment down — stub them to
    // never start.
    const { Animated } = require('react-native');
    const inert = () => ({ start: () => {}, stop: () => {}, reset: () => {} });
    for (const fn of ['spring', 'timing', 'sequence', 'delay', 'parallel']) {
      jest.spyOn(Animated, fn).mockImplementation(inert);
    }
    mockOfficialRoundState = {
      loading: false, error: null, round: null, members: [], scores: [],
      myRosterId: null, refresh: jest.fn(), setScore: jest.fn(),
      hasAttested: false, editableSource: jest.fn(() => null),
    };
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
    global.window = { ...(originalWindow ?? {}), alert: jest.fn() };
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
    global.window = originalWindow;
  });

  test('a burst of taps collapses into one local save carrying the final value', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    const plus = await findByLabelText('Score plus');

    // Five taps well inside the debounce window: 4 (par) → 5 → 6 → 7 → 8,
    // within the recordable ceiling (pickup + headroom).
    for (let i = 0; i < 5; i++) fireEvent.press(plus);

    await settle(600);

    expect(scoreSets()).toHaveLength(1);
    const [, mutation] = scoreSets()[0];
    expect(mutation).toMatchObject({ type: 'score.set', playerId: 'p1', hole: 1 });
    // The single save must carry the value after ALL five taps, not the first.
    expect(mutation.value).toBeGreaterThan(4);
  });

  test('leaving the hole flushes a pending save instead of dropping it', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));
    fireEvent.press(await findByLabelText('Next hole'));

    // Shorter than the debounce: if the save only landed because the timer
    // fired, it could not have happened yet. This proves the flush ran.
    await waitFor(() => {
      expect(scoreSets()).toHaveLength(1);
    }, { timeout: 250, interval: 10 });

    await waitFor(() => {
      expect(syncNow).toHaveBeenCalled();
    });

    // …and the flush must not leave a stray timer that saves a second time.
    await settle(600);
    expect(scoreSets()).toHaveLength(1);
  });

  test('unmounting flushes a pending save', async () => {
    const { findByLabelText, unmount } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Score plus'));
    act(() => { unmount(); });

    await waitFor(() => {
      expect(scoreSets()).toHaveLength(1);
    }, { timeout: 250, interval: 10 });
  });
});
