import React from 'react';
import { Animated } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { HoleView } from '../HoleView';
import { ThemeProvider } from '../../../theme/ThemeContext';

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

const PLAYERS = [{ id: 'a', name: 'Marcos', handicap: 12 }];
const HOLES = [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }];
const ROUND = {
  id: 'r1', courseName: 'Test GC', holes: HOLES,
  scores: { a: {} }, shotDetails: { a: {} },
  playerHandicaps: { a: 12 }, pairs: [['a']], notes: {},
};
const CONFLICT_HOLES = new Set();
const noop = () => {};

function renderWithCelebration(celebration) {
  const props = {
    round: ROUND, roundIndex: 0, players: PLAYERS, scores: ROUND.scores,
    shotDetails: ROUND.shotDetails, meId: 'a',
    onSetShot: noop, onPickMe: noop, notes: {},
    currentHole: 1, hole: HOLES[0], isBestBall: false, bbResult: null,
    settings: { scoringMode: 'stableford' },
    onStep: noop, onSetScore: noop, editable: () => true,
    onNext: noop, onGoToHole: noop, onFinish: noop,
    holeCount: 2, showQuickFinish: false, finishBusy: false, showRunning: false,
    getScoreAnim: () => new Animated.Value(1),
    celebration, celebrationAnim: new Animated.Value(1),
    refreshing: false, onRefresh: noop, official: false,
    conflictHoles: CONFLICT_HOLES,
  };
  const r = render(<ThemeProvider><HoleView {...props} /></ThemeProvider>);
  const wrap = r.UNSAFE_root.findAll((n) => typeof n.props?.onLayout === 'function')[0];
  act(() => {
    wrap.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } });
  });
  return r;
}

describe('HoleView celebration presentation', () => {
  it('a birdie shows the toast, with its delta, and no takeover scrim', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'BIRDIE', delta: -1 });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    expect(r.queryByText('−1')).toBeTruthy();
    // The takeover renders the tier eyebrow; the toast does not.
    expect(r.queryByText('A BIRDIE')).toBeNull();
  });

  it('a noelada shows the toast', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'NOELADA', delta: 3 });
    expect(r.queryByText('NOELADA')).toBeTruthy();
    expect(r.queryByText('+3')).toBeTruthy();
    // The takeover would render the eyebrow; the toast never does.
    expect(r.queryByText('WHAT A NOELADA!')).toBeNull();
  });

  it('an eagle still takes over the screen', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'EAGLE', delta: -2 });
    // The takeover's eyebrow proves it is the overlay, not the toast.
    expect(r.queryByText('AN EAGLE')).toBeTruthy();
    expect(r.queryByText('EAGLE')).toBeTruthy();
  });

  it('a hole in one still takes over the screen', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'HOLE IN ONE', delta: -3 });
    expect(r.queryByText('A HOLE IN ONE')).toBeTruthy();
  });

  it('renders neither when there is no celebration', () => {
    const r = renderWithCelebration({ playerId: null, holeNumber: null, label: null });
    expect(r.queryByText('BIRDIE')).toBeNull();
    expect(r.queryByText('AN EAGLE')).toBeNull();
  });
});
