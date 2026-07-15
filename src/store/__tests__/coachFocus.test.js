jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
    __store: store,
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  makeFocusCommit, focusVerdict,
  loadFocus, saveFocus, clearFocus, loadFocusHistory, archiveFocus,
} from '../coachFocus';

const insight = {
  id: 'putting:putting', area: 'putting', areaLabel: 'Putting',
  title: 'Putting', metric: '-1.8 SG / round', impact: -1.8,
};

function statsWith(roundCount, currentImpact) {
  return {
    roundCount,
    coach: {
      hero: null,
      board: {
        fixFirst: currentImpact == null ? [] : [{ ...insight, impact: currentImpact, metric: `${currentImpact} SG / round` }],
        keepDoing: [], gettingBetter: [], gettingWorse: [], nextGains: [], watch: [],
      },
    },
  };
}

describe('makeFocusCommit', () => {
  test('captures baseline and round count', () => {
    const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');
    expect(focus).toEqual({
      insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting',
      title: 'Putting', metric: '-1.8 SG / round', baselineImpact: -1.8,
      committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
    });
    expect(makeFocusCommit(null, { roundCount: 8 })).toBeNull();
  });
});

describe('focusVerdict', () => {
  const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');

  test('needs-more-rounds under 2 post-commit rounds', () => {
    const v = focusVerdict(focus, statsWith(9, -1.8));
    expect(v.state).toBe('needs-more-rounds');
    expect(v.roundsSince).toBe(1);
    expect(v.roundsNeeded).toBe(1);
  });
  test('improving when impact recovers past the threshold', () => {
    const v = focusVerdict(focus, statsWith(10, -1.3));
    expect(v.state).toBe('improving');
    expect(v.delta).toBeCloseTo(0.5, 10);
  });
  test('worse when impact deteriorates past the threshold', () => {
    expect(focusVerdict(focus, statsWith(10, -2.4)).state).toBe('worse');
  });
  test('flat inside the threshold band', () => {
    expect(focusVerdict(focus, statsWith(10, -1.75)).state).toBe('flat');
  });
  test('resolved when the insight left the board', () => {
    expect(focusVerdict(focus, statsWith(10, null)).state).toBe('resolved');
  });
  test('roundsSince clamps at 0 when rounds were deselected', () => {
    expect(focusVerdict(focus, statsWith(5, -1.8)).roundsSince).toBe(0);
  });
  test('null without a focus', () => {
    expect(focusVerdict(null, statsWith(10, -1.8))).toBeNull();
  });
});

describe('persistence', () => {
  beforeEach(() => AsyncStorage.__store.clear());

  test('save/load/clear round-trip per user', async () => {
    const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');
    await saveFocus('u1', focus);
    expect(await loadFocus('u1')).toEqual(focus);
    expect(await loadFocus('u2')).toBeNull();
    await clearFocus('u1');
    expect(await loadFocus('u1')).toBeNull();
  });
  test('archive prepends history, caps at 10, clears active focus', async () => {
    const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveFocus('u1', { ...focus, title: `Focus ${i}` });
      // eslint-disable-next-line no-await-in-loop
      await archiveFocus('u1', { ...focus, title: `Focus ${i}` }, { state: 'improving', current: -1.2 });
    }
    const history = await loadFocusHistory('u1');
    expect(history).toHaveLength(10);
    expect(history[0].title).toBe('Focus 11');
    expect(history[0].finalState).toBe('improving');
    expect(history[0].finalImpact).toBe(-1.2);
    expect(await loadFocus('u1')).toBeNull();
  });
  test('corrupt storage degrades to null/empty', async () => {
    await AsyncStorage.setItem('@mystats_coach_focus:u1', 'not json');
    await AsyncStorage.setItem('@mystats_coach_focus_history:u1', 'not json');
    expect(await loadFocus('u1')).toBeNull();
    expect(await loadFocusHistory('u1')).toEqual([]);
  });
});
