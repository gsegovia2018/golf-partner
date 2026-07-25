import React from 'react';
import { render, act } from '@testing-library/react-native';
import { HoleView } from '../HoleView';
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
const holeBar = (n) => `HOLE ${n} · PAR 4 · SI ${n}`;

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

function mount(currentHole) {
  const r = render(<ThemeProvider><HoleView {...props(currentHole)} /></ThemeProvider>);
  // The pager only renders its pages once it has measured a non-zero size.
  const wrap = r.UNSAFE_root.findAll((n) => typeof n.props?.onLayout === 'function')[0];
  act(() => {
    wrap.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } });
  });
  return r;
}

const pagerOf = (r) => r.UNSAFE_root.findAll((n) => n.props?.horizontal === true)[0];

describe('HoleView pager windowing', () => {
  test('mounts only the current hole and its neighbours', () => {
    const r = mount(1);
    expect(r.queryByText(holeBar(1))).toBeTruthy();
    expect(r.queryByText(holeBar(2))).toBeTruthy();
    expect(r.queryByText(holeBar(3))).toBeNull();
    expect(r.queryByText(holeBar(10))).toBeNull();
    expect(r.queryByText(holeBar(18))).toBeNull();
  });

  test('keeps both neighbours mounted mid-round so a swipe never lands on a blank page', () => {
    const r = mount(10);
    for (const n of [9, 10, 11]) expect(r.queryByText(holeBar(n))).toBeTruthy();
    for (const n of [1, 8, 12, 18]) expect(r.queryByText(holeBar(n))).toBeNull();
  });

  test('every hole keeps its slot, so scroll offsets are unchanged', () => {
    const r = mount(1);
    // 18 children at index × width is what the scrollTo/contentOffset maths in
    // HoleView assumes; dropping the off-window pages entirely would shift
    // every subsequent hole's position.
    expect(React.Children.count(pagerOf(r).props.children)).toBe(18);
  });

  test('the window follows the current hole', () => {
    const r = mount(1);
    expect(r.queryByText(holeBar(1))).toBeTruthy();
    expect(r.queryByText(holeBar(6))).toBeNull();

    act(() => {
      r.update(<ThemeProvider><HoleView {...props(6)} /></ThemeProvider>);
    });

    expect(r.queryByText(holeBar(6))).toBeTruthy();
    expect(r.queryByText(holeBar(5))).toBeTruthy();
    expect(r.queryByText(holeBar(7))).toBeTruthy();
    expect(r.queryByText(holeBar(1))).toBeNull();
    expect(React.Children.count(pagerOf(r).props.children)).toBe(18);
  });

  test('the last hole still renders with only one neighbour', () => {
    const r = mount(18);
    expect(r.queryByText(holeBar(18))).toBeTruthy();
    expect(r.queryByText(holeBar(17))).toBeTruthy();
    expect(r.queryByText(holeBar(16))).toBeNull();
    expect(React.Children.count(pagerOf(r).props.children)).toBe(18);
  });
});
