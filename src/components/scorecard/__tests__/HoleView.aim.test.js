import React from 'react';
import { render, act } from '@testing-library/react-native';
import { HoleView } from '../HoleView';
import { updateAppSettings } from '../../../store/settingsStore';
import { ThemeProvider } from '../../../theme/ThemeContext';

// The pager used to mount all 18 holes at once — ~5,300 native views for the
// ~300 that are on screen, paid again on every layout pass. It now mounts only
// the current hole and its immediate neighbours, while every other hole keeps
// a fixed-size placeholder so the pager's index × width offset maths, its
// contentOffset and web scroll-snap all behave exactly as before.

jest.mock('../../../hooks/useGpsDistances', () => ({
  useGpsDistances: () => ({
    available: false, distances: null, source: 'gps', fixState: 'disabled',
    accuracy: null, position: null, offTee: false,
  }),
}));
jest.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: () => Promise.resolve({ type: 'cellular', isConnected: true }),
    addEventListener: () => () => {},
  },
  fetch: () => Promise.resolve({ type: 'cellular', isConnected: true }),
  addEventListener: () => () => {},
}));
jest.mock('../../../store/tileCache', () => ({ prefetchCourseTiles: () => Promise.resolve() }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

jest.mock('../HoleBriefingCard', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <Text testID="briefing">briefing</Text> };
});

const PLAYERS = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: `P${i}`, handicap: 12 + i }));
const HOLES = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1, par: 4, strokeIndex: i + 1, distance: 350 + i,
}));
const scores = {};
const shotDetails = {};
for (const p of PLAYERS) {
  scores[p.id] = {};
  shotDetails[p.id] = {};
  for (let h = 1; h <= 18; h++) scores[p.id][h] = 5;
}
const ROUND = {
  id: 'r1', courseName: 'Test GC', holes: HOLES, scores, shotDetails,
  playerHandicaps: Object.fromEntries(PLAYERS.map((p) => [p.id, 14])),
  pairs: [['a', 'b'], ['c', 'd']], notes: {},
};
const CONFLICT_HOLES = new Set();

// HolePage's slim collapsed bar renders exactly this string, so its presence
// is a faithful "is this page's content mounted?" probe with no test-only hooks.
const noop = () => {};
const props = (currentHole) => ({
  round: ROUND, roundIndex: 0, players: PLAYERS, scores, shotDetails, meId: 'a',
  onSetShot: noop, onPickMe: noop, notes: {},
  currentHole, hole: HOLES[currentHole - 1],
  isBestBall: false, bbResult: null, settings: { scoringMode: 'stableford' },
  onStep: noop, onSetScore: noop, editable: () => true,
  onNext: noop, onGoToHole: noop, onFinish: noop,
  holeCount: 18, showQuickFinish: false, finishBusy: false, showRunning: true,
  getScoreAnim: () => new (require('react-native').Animated.Value)(1),
  celebration: { playerId: null },
  celebrationAnim: new (require('react-native').Animated.Value)(0),
  refreshing: false, onRefresh: noop, official: false,
  conflictHoles: CONFLICT_HOLES,
});

// ThemeProvider and every ShotDetailExplainer row icon read their persisted
// state from AsyncStorage in a useEffect; flush that pending promise (inside
// act) after every render/update so those follow-up setStates don't land
// outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

describe('HoleView aim briefing: Settings -> Aim tips', () => {
  const stats = { approachTendency: {} };
  const mountWith = async (extra) => {
    const r = render(<ThemeProvider><HoleView {...props(1)} {...extra} /></ThemeProvider>);
    await flush();
    const wrap = r.UNSAFE_root.findAll((n) => typeof n.props?.onLayout === 'function')[0];
    act(() => { wrap.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } }); });
    await flush();
    return r;
  };
  afterEach(() => act(() => updateAppSettings({ aimTips: true })));

  test('the briefing mounts with the setting on and stats loaded', async () => {
    const r = await mountWith({ aimStats: stats });
    expect(r.queryAllByTestId('briefing').length).toBeGreaterThan(0);
  });

  test('no briefing with the setting off', async () => {
    await act(() => updateAppSettings({ aimTips: false }));
    const r = await mountWith({ aimStats: stats });
    expect(r.queryAllByTestId('briefing')).toHaveLength(0);
  });

  test('no briefing before the stats load', async () => {
    const r = await mountWith({});
    expect(r.queryAllByTestId('briefing')).toHaveLength(0);
  });
});
