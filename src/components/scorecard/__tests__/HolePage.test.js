import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';
import { holePagePropsEqual, HolePage } from '../HolePage';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        pairA: semantic.pair.a.light,
        pairB: semantic.pair.b.light,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

// Minimal HolePage prop set. baseProps() returns a fresh object each call;
// tests build `next` by spreading `prev` so every unchanged prop keeps its
// reference — exactly what the real pager does on a score edit.
function baseProps() {
  return {
    isActive: false,
    pageHole: { number: 3, par: 4, strokeIndex: 6 },
    width: 360,
    height: 600,
    courseName: 'Pebble',
    roundIndex: 0,
    round: { id: 'r1', holes: [], playerHandicaps: {} },
    players: [{ id: 'a' }, { id: 'b' }],
    scores: { a: { 3: 4 }, b: { 3: 5 } },
    shotDetails: {},
    meId: 'a',
    onSetShot: () => {},
    theme: { name: 'light' },
    s: {},
    onStep: () => {},
    onSetScore: () => {},
    editable: null,
    getScoreAnim: () => {},
    showRunning: true,
    mode: 'stableford',
    official: false,
    officialDiscrepancy: null,
    onOpenDiscrepancy: () => {},
    onOpenConflict: () => {},
    shotCollapsed: false,
    onToggleShotDetail: () => {},
    totalsMap: new Map(),
  };
}

// Renders a real HolePage for a 1v1 match play round so full-handicap vs
// relative-handicap values can be pinned end to end (through PlayerCard).
// Alice hcp 25, Bob hcp 5 → duel-relative: Alice 20, Bob 0 (Bob is the
// duel's better player). At SI 5, Alice's full handicap (25, base 1) and
// Bob's full handicap (5, base 0) also give distinct pickup values (8 vs 7)
// so each card's pickup button can be pinned unambiguously by its label,
// while the relative-based bug would give Bob 6 instead of 7.
function renderMatchPlayHole(overrides = {}) {
  const players = [
    { id: 'a', name: 'Alice', handicap: 25 },
    { id: 'b', name: 'Bob', handicap: 5 },
  ];
  const round = {
    id: 'r1',
    holes: [],
    playerHandicaps: { a: 25, b: 5 },
  };
  const props = {
    pageHole: { number: 1, par: 4, strokeIndex: 5 },
    width: 360,
    height: 600,
    courseName: 'Pebble',
    roundIndex: 0,
    round,
    players,
    scores: { a: {}, b: {} },
    shotDetails: {},
    meId: 'a',
    onSetShot: () => {},
    theme: { name: 'light' },
    s: {},
    onStep: () => {},
    onSetScore: () => {},
    editable: null,
    getScoreAnim: () => new Animated.Value(1),
    showRunning: false,
    mode: 'matchplay',
    official: false,
    officialDiscrepancy: null,
    onOpenDiscrepancy: () => {},
    onOpenConflict: () => {},
    shotCollapsed: false,
    onToggleShotDetail: () => {},
    totalsMap: new Map(),
    ...overrides,
  };

  return render(<HolePage {...props} />);
}

describe('HolePage match play: full vs relative handicap', () => {
  test('HCP label shows the FULL handicap for both players, not the relative one', () => {
    const { getByText, queryByText } = renderMatchPlayHole();

    // Alice (hcp 25, relative 20) still has a relative extra shot at SI 5.
    expect(getByText('HCP 25  ·  +1 on this hole')).toBeTruthy();
    // Bob (hcp 5, relative 0) must show his FULL handicap, not "HCP 0".
    expect(getByText('HCP 5')).toBeTruthy();
    expect(queryByText('HCP 0')).toBeNull();
  });

  test('pickup button records the FULL-handicap pickup value for Bob, not the relative one', () => {
    const { getByLabelText, queryByLabelText } = renderMatchPlayHole();

    // Full handicap: pickupStrokes(par 4, hcp 5, SI 5) = 7.
    expect(getByLabelText('Pickup at 7 strokes')).toBeTruthy();
    // Relative-handicap bug would compute pickupStrokes(4, 0, 5) = 6.
    expect(queryByLabelText('Pickup at 6 strokes')).toBeNull();
  });
});

describe('holePagePropsEqual', () => {
  test('identical props → skip re-render', () => {
    const prev = baseProps();
    expect(holePagePropsEqual(prev, { ...prev })).toBe(true);
  });

  test('score changed on a DIFFERENT hole → inactive page skips re-render', () => {
    // This is the lag fix: editing hole 5 must not re-render hole 3's page.
    const prev = baseProps();
    const next = { ...prev, scores: { a: { 3: 4, 5: 9 }, b: { 3: 5 } } };
    expect(holePagePropsEqual(prev, next)).toBe(true);
  });

  test('score changed on THIS page hole → re-render', () => {
    const prev = baseProps();
    const next = { ...prev, scores: { a: { 3: 5 }, b: { 3: 5 } } };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  test('isActive flips false→true → re-render (refreshes round totals on swipe)', () => {
    const prev = baseProps();
    const next = { ...prev, isActive: true };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  test('new totalsMap reference alone → inactive page skips re-render', () => {
    const prev = baseProps();
    const next = { ...prev, totalsMap: new Map([['a', { pts: 1, str: 4, parPlayed: 4 }]]) };
    expect(holePagePropsEqual(prev, next)).toBe(true);
  });

  test('structural prop changed (round) → re-render', () => {
    const prev = baseProps();
    const next = { ...prev, round: { ...prev.round } };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  test('shot detail changed on this page hole → re-render', () => {
    const prev = baseProps();
    const next = { ...prev, shotDetails: { a: { 3: { putts: 2 } } } };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  test('shot detail changed on a different hole → inactive page skips re-render', () => {
    // setShot updates immutably: editing hole 7 keeps hole 3's detail object
    // referentially identical, so the comparator must skip hole 3's page.
    const hole3 = { putts: 2 };
    const prev = { ...baseProps(), shotDetails: { a: { 3: hole3 } } };
    const next = { ...prev, shotDetails: { a: { 3: hole3, 7: { putts: 1 } } } };
    expect(holePagePropsEqual(prev, next)).toBe(true);
  });

  test('structural prop changed (onOpenConflict) → re-render', () => {
    const prev = baseProps();
    const next = { ...prev, onOpenConflict: () => {} };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });
});
