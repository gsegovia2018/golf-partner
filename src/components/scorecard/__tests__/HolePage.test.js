import { holePagePropsEqual } from '../HolePage';

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
