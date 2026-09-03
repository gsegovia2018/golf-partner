import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { haptic } from '../../lib/haptics';

jest.mock('../../lib/haptics', () => ({ haptic: jest.fn() }));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => cb(), [cb]);
  },
  useIsFocused: () => true,
}));

let mockOfficialRoundState;

const mockPlayers = [{ id: 'p1', name: 'Noé' }];
const mockTournament = {
  id: 't1', kind: 'game', currentRound: 0, meId: 'p1',
  settings: { scoringMode: 'stableford' },
  players: mockPlayers,
  rounds: [{
    id: 'r1', courseName: 'Neguri',
    // Par 3 so a birdie is 2 and a double bogey is 5 — both reachable with a
    // single direct setScore, independent of stepper arithmetic.
    holes: [{ number: 1, par: 3, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }],
    scores: {}, shotDetails: {}, notes: {}, pairs: [[mockPlayers[0]]],
  }],
};

// The strokes each button enters, shared by the HoleView mock below and by the
// delta assertions, so the expected numbers are derived from the fixture in one
// place rather than restated as literals.
const mockBirdieStrokes = 2;
const mockNoeladaStrokes = 5;
const mockHoleOnePar = mockTournament.rounds[0].holes[0].par;

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

jest.mock('../../components/scorecard/HoleView', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    // `celebration` is passed straight through by ScorecardScreen; surfacing
    // its delta here is what lets the tests pin the number the toast would
    // render, which is otherwise invisible with the real HoleView mocked out.
    HoleView: ({ onSetScore, onStep, celebration }) => (
      <View>
        <Text testID="celebration-delta">{String(celebration?.delta)}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Step up"
          onPress={() => onStep('p1', 1, 1)}
        >
          <Text>Step up</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Set birdie"
          onPress={() => onSetScore('p1', 1, String(mockBirdieStrokes))}
        >
          <Text>Set birdie</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Set noelada"
          onPress={() => onSetScore('p1', 1, String(mockNoeladaStrokes))}
        >
          <Text>Set noelada</Text>
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
jest.mock('../../hooks/useOfficialRound', () => ({ useOfficialRound: () => mockOfficialRoundState }));
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
jest.mock('../../store/mutate', () => {
  const actual = jest.requireActual('../../store/mutate');
  return { ...actual, mutate: jest.fn(async (t) => t) };
});
jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(), syncNow: jest.fn(() => Promise.resolve()),
  syncSettled: jest.fn(() => Promise.resolve()), retrySync: jest.fn(),
}));
jest.mock('../../store/libraryStore', () => ({ getCachedPlayers: jest.fn(() => Promise.resolve([])), fetchPlayers: jest.fn(() => Promise.resolve([])) }));
jest.mock('../../store/notificationStore', () => ({ notifyRoundFinished: jest.fn(() => Promise.resolve()) }));
jest.mock('../../store/officialScoring', () => ({
  cardDiscrepancyHoles: jest.fn(() => []), officialHolesFromCourse: jest.fn(() => []),
}));
jest.mock('../../store/officialLeaderboard', () => ({ buildLeaderboard: jest.fn(() => []) }));
jest.mock('../../store/officialStore', () => ({ attestCard: jest.fn(() => Promise.resolve()) }));
jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(() => Promise.resolve(null)), attachMedia: jest.fn(() => Promise.resolve()),
}));

describe('ScorecardScreen celebration haptics', () => {
  const navigation = { canGoBack: jest.fn(() => true), goBack: jest.fn(), navigate: jest.fn() };
  const route = { params: { roundIndex: 0 } };
  const originalPlatformOS = Platform.OS;
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  // The celebration animation outlives the assertion it is checked by: its hold
  // delay is followed by an Animated.timing whose easing reaches for
  // Easing.bezier. Left on real timers that fires after the module registry is
  // torn down and takes the whole worker down with it, so each test drives the
  // sequence to completion on fake timers instead.
  const flushCelebration = async () => {
    await act(async () => { jest.advanceTimersByTime(4000); });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockOfficialRoundState = {
      loading: false, error: null, round: null, members: [], scores: [],
      myRosterId: null, refresh: jest.fn(), setScore: jest.fn(),
      hasAttested: false, editableSource: jest.fn(() => null),
    };
    // Native, so the real haptic() would not be short-circuited by its web
    // guard — the mock records the style either way, but this keeps the fixture
    // honest about the platform the behaviour matters on.
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  });

  afterEach(async () => {
    // Drain any pending celebration animation before switching timers, so a
    // test that fails its assertion before reaching flushCelebration() can't
    // leave one dangling. Safe to run when nothing is pending.
    await flushCelebration();
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  it('a birdie fires the light haptic, not success', async () => {
    const { findByLabelText, getByTestId } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    fireEvent.press(await findByLabelText('Set birdie'));
    await waitFor(() => {
      expect(haptic).toHaveBeenCalledWith('light');
    });
    expect(haptic).not.toHaveBeenCalledWith('success');
    // Strokes relative to par, the number the toast renders: 2 on a par 3 is -1.
    expect(getByTestId('celebration-delta').props.children)
      .toBe(String(mockBirdieStrokes - mockHoleOnePar));
  });

  // Regression: NOELADA used to fire haptic('success') — the same celebratory
  // buzz as an albatross — for a double bogey.
  it('a noelada never fires the success haptic', async () => {
    const { findByLabelText, getByTestId } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    fireEvent.press(await findByLabelText('Set noelada'));
    await waitFor(() => {
      expect(haptic).toHaveBeenCalledWith('selection');
    });
    expect(haptic).not.toHaveBeenCalledWith('success');
    // 5 on a par 3 is +2 — and never the ±1 stepper increment.
    expect(getByTestId('celebration-delta').props.children)
      .toBe(String(mockNoeladaStrokes - mockHoleOnePar));
  });

  // The delta must be strokes-to-par, never the stepper increment. stepScore
  // has its own `delta` parameter (±1) in scope at the call site, so this is
  // the one path where the two can be confused. Stepping up to a noelada
  // discriminates between them: strokes-to-par is +2 while the increment that
  // got there is +1. A birdie would not — both are -1.
  it('a noelada reached with the stepper reports strokes to par, not the increment', async () => {
    const { findByLabelText, getByTestId } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    const stepUp = await findByLabelText('Step up');
    // Un-scored hole: the first + lands on par, then each + adds a stroke.
    fireEvent.press(stepUp); // par 3
    fireEvent.press(stepUp); // 4, bogey — no tier
    fireEvent.press(stepUp); // 5, noelada
    await waitFor(() => {
      expect(haptic).toHaveBeenCalledWith('selection');
    });
    expect(getByTestId('celebration-delta').props.children)
      .toBe(String(mockNoeladaStrokes - mockHoleOnePar));
  });
});
