import React from 'react';
import { Animated } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { holePagePropsEqual, HolePage } from '../HolePage';
import { __resetTourTargetsForTests, __getRegisteredTourKeysForTests } from '../../tour/tourTargets';

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

// All 18 HolePage instances mount at once in the pager and would otherwise
// all call useTourTarget('score-entry') — last-write-wins would let an
// off-screen page's unmeasurable card win the registry. Only the active
// hole may claim the key.
describe('HolePage tour target: score-entry registers only when active', () => {
  beforeEach(() => __resetTourTargetsForTests());

  test('isActive=false does not register score-entry', () => {
    renderMatchPlayHole({ isActive: false });
    expect(__getRegisteredTourKeysForTests()).not.toContain('score-entry');
  });

  test('isActive=true registers score-entry', () => {
    renderMatchPlayHole({ isActive: true });
    expect(__getRegisteredTourKeysForTests()).toContain('score-entry');
  });
});

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

// Scramble rounds score one ball per team under the captain (`unit.id`).
// The shot-detail write path keys off `player.id`, which in a scramble
// round IS the captain's id — not the signed-in member's personal `meId`.
// A non-captain member's logged shots would vanish (written under the
// captain's id, read under their own); a captain's would silently pollute
// their own detail with whichever member is "me". The honest fix is to
// not render shot logging in scramble rounds at all.
function renderScrambleHole(overrides = {}) {
  const players = [
    { id: 'a', name: 'Alice', handicap: 10 },
    { id: 'b', name: 'Bob', handicap: 15 },
  ];
  const round = {
    id: 'r1',
    holes: [],
    pairs: [[{ id: 'a', name: 'Alice', handicap: 10 }, { id: 'b', name: 'Bob', handicap: 15 }]],
    playerHandicaps: { a: 10, b: 15 },
  };
  const props = {
    pageHole: { number: 1, par: 4, strokeIndex: 5 },
    width: 360,
    height: 600,
    courseName: 'Pebble',
    roundIndex: 0,
    round,
    players,
    scores: { a: {} },
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
    mode: 'scramblepairs',
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

describe('HolePage scramble rounds: no shot-detail section', () => {
  test('does not render the shot-detail section for the captain (unit id === meId)', () => {
    const { queryByText } = renderScrambleHole();
    expect(queryByText('Shot detail')).toBeNull();
  });

  test('does not render the shot-detail section for a non-captain member', () => {
    // meId is Bob, a team member but not the captain — the unit still
    // renders as "me" (effectiveMeId resolves to the team), so this is the
    // clearest case of the write/read id mismatch the gate prevents.
    const { queryByText } = renderScrambleHole({ meId: 'b' });
    expect(queryByText('Shot detail')).toBeNull();
  });

  test('a non-scramble round for the same players still renders shot detail for "me"', () => {
    const { getByText } = renderMatchPlayHole({ mode: 'stableford' });
    expect(getByText('Shot detail')).toBeTruthy();
  });
});

// Two authors submitted different values for the same cell — deriveCell
// reports 'conflict' regardless of presence. The hero-card flag must only
// light up once the hole is in the presence-gated `conflictHoles` set (the
// same set HoleView's go-to-hole dots use), matching the "everyone off the
// hole" surfacing rule elsewhere in the conflict-sync overhaul.
function renderConflictHole(overrides = {}) {
  const players = [{ id: 'a', name: 'Alice', handicap: 10 }];
  const round = {
    id: 'r1',
    holes: [],
    playerHandicaps: { a: 10 },
    scoreEntries: { a: { 1: { m1: { value: 4, ts: 1 }, m2: { value: 5, ts: 2 } } } },
  };
  const props = {
    pageHole: { number: 1, par: 4, strokeIndex: 5 },
    width: 360,
    height: 600,
    courseName: 'Pebble',
    roundIndex: 0,
    round,
    players,
    scores: { a: {} },
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
    mode: 'stableford',
    official: false,
    officialDiscrepancy: null,
    onOpenDiscrepancy: () => {},
    onOpenConflict: () => {},
    shotCollapsed: false,
    onToggleShotDetail: () => {},
    totalsMap: new Map(),
    conflictHoles: new Set(),
    ...overrides,
  };

  return render(<HolePage {...props} />);
}

describe('HolePage hero-card conflict flag: gated by presence (conflictHoles)', () => {
  test('conflicting cell on a NOT-yet-surfaceable hole → score controls stay visible, no resolve state', () => {
    const { getByLabelText, queryByLabelText } = renderConflictHole();

    expect(getByLabelText('Decrease strokes on hole 1')).toBeTruthy();
    expect(queryByLabelText("Resolve Alice's conflicting score on hole 1")).toBeNull();
  });

  test('conflicting cell on a surfaceable hole (in conflictHoles) → resolve state shown, score controls hidden', () => {
    const { getByLabelText, queryByLabelText } = renderConflictHole({ conflictHoles: new Set([1]) });

    expect(getByLabelText("Resolve Alice's conflicting score on hole 1")).toBeTruthy();
    expect(queryByLabelText('Decrease strokes on hole 1')).toBeNull();
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

  test('new conflictHoles reference → re-render (gates the hero-card conflict flag)', () => {
    const prev = baseProps();
    const next = { ...prev, conflictHoles: new Set([3]) };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  test('same conflictHoles reference (memoized upstream) → skip re-render', () => {
    const conflictHoles = new Set([3]);
    const prev = { ...baseProps(), conflictHoles };
    const next = { ...prev, conflictHoles };
    expect(holePagePropsEqual(prev, next)).toBe(true);
  });
});

describe('header distance block wiring', () => {
  const gps = (center) => ({
    available: true, accuracy: 5, position: [1, 2],
    distances: { front: center - 14, center, back: center + 13, pin: null, kind: 'hole', hazards: [] },
  });

  it('propsEqual re-renders the ACTIVE page when gps changes', () => {
    const prev = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: () => {} };
    const next = { ...prev, gps: gps(320) };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  it('propsEqual skips INACTIVE pages on gps churn', () => {
    const prev = { ...baseProps(), isActive: false, gps: gps(326), onOpenFlyover: () => {} };
    const next = { ...prev, gps: gps(320) };
    expect(holePagePropsEqual(prev, next)).toBe(true);
  });

  it('propsEqual re-renders when onOpenFlyover identity changes', () => {
    const prev = { ...baseProps(), gps: gps(326), onOpenFlyover: () => {} };
    const next = { ...prev, onOpenFlyover: () => {} };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  it('renders PAR and SI beside the hole number and the distance block on the right', () => {
    const props = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: jest.fn() };
    const { getByText, getByLabelText } = render(<HolePage {...props} />);
    getByText('PAR');
    getByText('SI');
    getByText('326');
    fireEvent.press(getByLabelText('Open hole map'));
    expect(props.onOpenFlyover).toHaveBeenCalledTimes(1);
  });

  it('renders the plain header when gps is unavailable', () => {
    const props = { ...baseProps(), gps: { available: false, distances: null, accuracy: null, position: null }, onOpenFlyover: () => {} };
    const { getByText, queryByLabelText } = render(<HolePage {...props} />);
    getByText('PAR');
    expect(queryByLabelText('Open hole map')).toBeNull();
  });
});
