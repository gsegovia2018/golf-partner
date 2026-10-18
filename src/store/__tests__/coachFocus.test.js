import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  makeFocusCommit, focusVerdict, focusLevel, roundsSinceCommit, isV1Focus, isV2Focus, isSgFocus, needsRebase, rebaseFocus,
  loadFocus, saveFocus, clearFocus, loadFocusHistory, archiveFocus, loadFocusNotice, dismissFocusNotice,
  FOCUS_VERSION, MIN_VERDICT_ROUNDS, EARLY_ROUNDS, MIN_CHANGE,
} from '../coachFocus';
import { buildDiagnosis } from '../coachDiagnosis';
import { SG_CATEGORIES } from '../coachMetrics';
import { SG_BASELINE_VERSION } from '../strokesGainedBaseline';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
    __store: store,
  };
});

// Stats slice read by both the diagnosis and the metric registry: putting
// per round (`rounds`, 18 holes each), the season putting SG (`putting`),
// the 6 m+ bucket (per-putt SG list + three-putt rate) and the drive lies.
function makeStats({
  roundCount = 6, rounds = [-1.6, -2.0, -1.4, -2.2, -1.8, -1.8], putting,
  sixPlus = Array.from({ length: 18 }, (_, i) => (i % 2 ? -0.4 : -0.2)), sixPlusSgPerPutt, threePuttRate = 30,
  troubleRate = 0.25, drives = 30,
} = {}) {
  const perRound = rounds.map((v, i) => {
    const byCategory = Object.fromEntries(SG_CATEGORIES.map((c) => [c, 0]));
    const sampleHolesByCategory = Object.fromEntries(SG_CATEGORIES.map((c) => [c, 0]));
    byCategory.putting = v;
    sampleHolesByCategory.putting = 18;
    return { index: i, byCategory, sampleHolesByCategory };
  });
  const season = putting ?? (rounds.length ? rounds.reduce((a, x) => a + x, 0) / rounds.length : 0);
  const mean = sixPlus.length ? sixPlus.reduce((a, x) => a + x, 0) / sixPlus.length : 0;
  return {
    roundCount,
    targetHandicap: 15,
    strokesGained: {
      perRound,
      byCategory: { offTheTee: 0, approach: 0, aroundGreen: 0, putting: season, penalties: 0 },
      roundsByCategory: { offTheTee: 0, approach: 0, aroundGreen: 0, putting: rounds.length, penalties: 0 },
      sampleHolesByCategory: { putting: rounds.length * 18 },
    },
    puttingTarget: {
      buckets: {
        '6+': {
          attempts: sixPlus.length,
          sgPerPutt: sixPlusSgPerPutt ?? mean,
          threePuttRate,
          breakdown: sixPlus.map((sg) => ({ sg })),
        },
      },
    },
    approachTarget: { buckets: {} },
    driveLies: { drives, troubleRate },
  };
}

const COMMITTED_AT = '2026-10-01T09:00:00.000Z';
const baseStats = makeStats();
const leak = buildDiagnosis(baseStats).top;

// The insight-based record stored before coach v2, incl. the SG rebase
// fields from the per-handicap baseline PR (#215).
const v1Focus = {
  insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting', title: 'Putting',
  metric: '-1.8 SG / round', basis: 'vs target hcp', baselineImpact: -1.8,
  baselineVersion: 1, rebasedAt: '2026-10-16T08:00:00Z',
  committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
};

describe('fixture', () => {
  test('the diagnosis ranks putting with its 6 m+ child', () => {
    expect(leak.id).toBe('leak:putting:6+');
    expect(leak.metricKey).toBe('sg.putting');
    expect(leak.sample.rounds).toBe(6);
    expect(leak.se).toBeGreaterThan(0);
  });
});

describe('makeFocusCommit', () => {
  test('a leak: v2 shape, baseline read through the registry, the leak\'s se', () => {
    const focus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
    expect(focus).toEqual({
      v: 2,
      leakId: 'leak:putting:6+',
      category: 'putting',
      bucket: '6+',
      causeId: null,
      metricKey: 'sg.putting',
      baselineValue: -1.8,
      baselineSample: { rounds: 6, holes: 108 },
      baselineSe: leak.se,
      minChange: MIN_CHANGE.sgPerRound,
      baselineVersion: SG_BASELINE_VERSION,
      targetHandicap: 15,
      committedAt: COMMITTED_AT,
      roundCountAtCommit: 6,
      measuredSince: 'commit',
    });
    expect(FOCUS_VERSION).toBe(2);
    expect(isV2Focus(focus)).toBe(true);
    expect(isV1Focus(focus)).toBe(false);
  });

  test('{ leak } and a bare leak commit the same focus', () => {
    expect(makeFocusCommit({ leak }, baseStats, COMMITTED_AT)).toEqual(makeFocusCommit(leak, baseStats, COMMITTED_AT));
  });

  test('a child bucket: its sg metric, se and minimum change per shot', () => {
    const focus = makeFocusCommit({ leak, bucket: '6+' }, baseStats, COMMITTED_AT);
    const child = leak.children.find((c) => c.bucket === '6+');
    const shotsPerRound = 18 / 6;
    expect(focus.leakId).toBe('leak:putting:6+');
    expect(focus.metricKey).toBe('sg.putting.bucket.6+');
    expect(focus.baselineValue).toBeCloseTo(-0.3, 10);
    expect(focus.baselineSample).toEqual({ shots: 18 });
    expect(focus.baselineSe).toBeCloseTo(child.se / shotsPerRound, 10);
    expect(focus.minChange).toBeCloseTo(0.25 / shotsPerRound, 10);
  });

  test('a cause that names a metric is verified by it; swingId is kept', () => {
    const focus = makeFocusCommit({
      leak, cause: { id: 'cause:putting:lag', metricKey: 'putting.threePuttRate.6+' }, swingId: 's1',
    }, baseStats, COMMITTED_AT);
    expect(focus).toMatchObject({
      leakId: 'leak:putting:6+',
      causeId: 'cause:putting:lag',
      metricKey: 'putting.threePuttRate.6+',
      baselineValue: 30,
      baselineSe: null,
      minChange: 10,
      swingId: 's1',
    });
  });

  test('a cause without a metric keeps the leak\'s', () => {
    const focus = makeFocusCommit({ leak, cause: { id: 'cause:putting:general' } }, baseStats, COMMITTED_AT);
    expect(focus.metricKey).toBe('sg.putting');
    expect(focus.causeId).toBe('cause:putting:general');
  });

  test('nothing to verify against → null', () => {
    expect(makeFocusCommit(null, baseStats)).toBeNull();
    // a v1 insight is not a leak
    expect(makeFocusCommit({ id: 'putting:putting', area: 'putting', impact: -1.8 }, baseStats)).toBeNull();
    expect(makeFocusCommit({ leak, bucket: '0-1' }, baseStats)).toBeNull();
    expect(makeFocusCommit({ leak, cause: { id: 'x', metricKey: 'no.such.metric' } }, baseStats)).toBeNull();
    // the metric has no sample right now
    expect(makeFocusCommit({ leak, cause: { id: 'x', metricKey: 'tee.distance' } }, baseStats)).toBeNull();
  });

  test('committedAt defaults to now', () => {
    expect(typeof makeFocusCommit(leak, baseStats).committedAt).toBe('string');
  });

  describe('approach lie cause', () => {
    const row = (lies, tagged) => ({
      misses: tagged, tagged, untagged: 0, blocked: 0, families: { forced: 0, lie: tagged, decision: 0, swing: 0 },
      subs: {}, lies, encounters: {},
    });
    const withRows = (all, byBucket = {}) => ({
      ...baseStats, missReasons: { approach: { all, byBucket }, tee: row({}, 0), short: row({}, 0) },
    });
    const lieCause = (metricKey = 'approach.why.lieRate.all') => ({ id: 'cause:approach:why:lie', metricKey });

    test('stores the dominant lie; the metric is not swapped', () => {
      const stats = withRows(row({ 'below-feet': 3, uphill: 1 }, 4));
      const focus = makeFocusCommit({ leak, cause: lieCause() }, stats, COMMITTED_AT);
      expect(focus).toMatchObject({
        causeId: 'cause:approach:why:lie',
        metricKey: 'approach.why.lieRate.all',
        focusLie: 'below-feet',
        baselineValue: 100,
        measuredSince: 'commit',
      });
    });

    test('a tie picks the OPTIONS.approachSituation order', () => {
      const stats = withRows(row({ wind: 2, uphill: 2, 'bad-lie': 2 }, 6));
      expect(makeFocusCommit({ leak, cause: lieCause() }, stats, COMMITTED_AT).focusLie).toBe('uphill');
    });

    test('reads the scope the metric names', () => {
      const stats = withRows(row({ wind: 3 }, 3), { '100-150': row({ downhill: 2 }, 2) });
      expect(makeFocusCommit({ leak, cause: lieCause('approach.why.lieRate.100-150') }, stats, COMMITTED_AT).focusLie)
        .toBe('downhill');
    });

    test('no lie counts → no focusLie; other causes never get one', () => {
      const stats = withRows(row({}, 2));
      expect(makeFocusCommit({ leak, cause: lieCause() }, stats, COMMITTED_AT)).not.toHaveProperty('focusLie');
      const focus = makeFocusCommit({ leak, cause: { id: 'cause:putting:lag', metricKey: 'putting.threePuttRate.6+' } },
        withRows(row({ wind: 3 }, 3)), COMMITTED_AT);
      expect(focus).not.toHaveProperty('focusLie');
    });
  });
});

describe('focusLevel', () => {
  test('1 + one level per two rounds, capped at 3', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((r) => focusLevel(r, 'flat'))).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });
  test('worse withholds the latest step and never drops below 1', () => {
    expect([0, 1, 2, 4, 9].map((r) => focusLevel(r, 'worse'))).toEqual([1, 1, 1, 2, 2]);
  });
});

describe('focusVerdict', () => {
  const sgFocus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
  // se from the fixture: ±0.2 / ±0.4 around −1.8 → about 0.13; the 0.25
  // stroke floor rules.
  const afterRounds = (n, overrides = {}) => makeStats({ roundCount: 6 + n, ...overrides });

  test('null without a v2 focus', () => {
    expect(focusVerdict(null, baseStats)).toBeNull();
    expect(focusVerdict(v1Focus, baseStats)).toBeNull();
  });

  test('needs-more-rounds under 2 rounds since the commit', () => {
    const v = focusVerdict(sgFocus, afterRounds(1, { putting: -0.5 }));
    expect(v).toMatchObject({ state: 'needs-more-rounds', roundsSince: 1, roundsNeeded: 1, early: true, level: 1, delta: null });
    expect(MIN_VERDICT_ROUNDS).toBe(2);
  });

  test('higher-is-better: improving / flat / worse around max(0.25, se)', () => {
    expect(sgFocus.baselineSe).toBeLessThan(0.25);
    const at = (putting) => focusVerdict(sgFocus, afterRounds(2, { putting }));
    const up = at(-1.5);
    expect(up).toMatchObject({ state: 'improving', metricKey: 'sg.putting', unit: 'sgPerRound', polarity: 'higher', baseline: -1.8, current: -1.5, threshold: 0.25 });
    expect(up.delta).toBeCloseTo(0.3, 10);
    expect(at(-1.6).state).toBe('flat');
    expect(at(-2.0).state).toBe('flat');
    expect(at(-2.1).state).toBe('worse');
  });

  test('a baseline se larger than 0.25 raises the bar', () => {
    const noisy = { ...sgFocus, baselineSe: 0.5 };
    expect(focusVerdict(noisy, afterRounds(2, { putting: -1.5 })).state).toBe('flat');
    expect(focusVerdict(noisy, afterRounds(2, { putting: -1.2 })).state).toBe('improving');
    const worse = focusVerdict(noisy, afterRounds(2, { putting: -2.4 }));
    expect(worse.state).toBe('worse');
    expect(worse.threshold).toBe(0.5);
    expect(worse.delta).toBeCloseTo(-0.6, 10);
  });

  test('lower-is-better: a falling rate is improving, 10 points on rates', () => {
    const lag = makeFocusCommit({ leak, cause: { id: 'cause:putting:lag', metricKey: 'putting.threePuttRate.6+' } }, baseStats, COMMITTED_AT);
    const at = (threePuttRate) => focusVerdict(lag, afterRounds(2, { threePuttRate }));
    expect(at(18)).toMatchObject({ state: 'improving', polarity: 'lower', unit: 'percent', delta: 12, threshold: 10 });
    expect(at(22).state).toBe('flat');
    expect(at(40)).toMatchObject({ state: 'worse', delta: -10 });
    const trouble = makeFocusCommit({ leak, cause: { id: 'cause:tee:trouble:driver', metricKey: 'tee.troubleRate' } }, baseStats, COMMITTED_AT);
    expect(focusVerdict(trouble, afterRounds(2, { troubleRate: 0.1 })).state).toBe('improving');
    expect(focusVerdict(trouble, afterRounds(2, { troubleRate: 0.4 })).state).toBe('worse');
  });

  test('per-shot bucket metric: 0.25 strokes a round through shots per round', () => {
    const child = makeFocusCommit({ leak, bucket: '6+' }, baseStats, COMMITTED_AT);
    // 3 putts from 6 m+ a round → 0.0833 per putt
    expect(focusVerdict(child, afterRounds(2, { sixPlusSgPerPutt: -0.2 })).state).toBe('improving');
    expect(focusVerdict(child, afterRounds(2, { sixPlusSgPerPutt: -0.25 })).state).toBe('flat');
    expect(focusVerdict(child, afterRounds(2, { sixPlusSgPerPutt: -0.4 })).state).toBe('worse');
  });

  test('early until 4 rounds since the commit', () => {
    expect(EARLY_ROUNDS).toBe(4);
    [[2, true], [3, true], [4, false], [7, false]].forEach(([n, early]) => {
      const v = focusVerdict(sgFocus, afterRounds(n, { putting: -1.5 }));
      expect(v.state).toBe('improving');
      expect(v.early).toBe(early);
    });
  });

  test('level follows rounds since the commit; worse holds it', () => {
    expect(focusVerdict(sgFocus, afterRounds(3, { putting: -1.8 })).level).toBe(2);
    expect(focusVerdict(sgFocus, afterRounds(5, { putting: -1.8 })).level).toBe(3);
    expect(focusVerdict(sgFocus, afterRounds(5, { putting: -2.5 })).level).toBe(2);
  });

  test('resolved when the metric no longer has a sample', () => {
    const gone = makeStats({ roundCount: 9, rounds: [], sixPlus: [] });
    expect(focusVerdict(sgFocus, gone)).toMatchObject({ state: 'resolved', current: null, delta: null });
    const child = makeFocusCommit({ leak, bucket: '6+' }, baseStats, COMMITTED_AT);
    expect(focusVerdict(child, gone).state).toBe('resolved');
    expect(focusVerdict({ ...sgFocus, metricKey: 'retired.metric' }, afterRounds(2)).state).toBe('resolved');
  });

  test('roundsSince clamps at 0 when rounds were deselected', () => {
    expect(focusVerdict(sgFocus, makeStats({ roundCount: 3 })).roundsSince).toBe(0);
  });
});

describe('SG baseline recalibration (v2)', () => {
  const focus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
  const stale = { ...focus, baselineVersion: SG_BASELINE_VERSION - 1 };

  test('only SG metrics go stale; v1 records are not rebased (they are archived)', () => {
    expect(isSgFocus(focus)).toBe(true);
    expect(needsRebase(focus)).toBe(false);
    expect(needsRebase(stale)).toBe(true);
    const rate = { ...makeFocusCommit({ leak, cause: { id: 'c', metricKey: 'putting.threePuttRate.6+' } }, baseStats), baselineVersion: 1 };
    expect(isSgFocus(rate)).toBe(false);
    expect(needsRebase(rate)).toBe(false);
    expect(needsRebase(v1Focus)).toBe(false);
  });

  test('a stale focus never reads improving / worse', () => {
    [-0.2, -5].forEach((putting) => {
      expect(focusVerdict(stale, makeStats({ roundCount: 20, putting })).state).toBe('needs-more-rounds');
    });
  });

  test('rebase re-anchors the baseline and restarts the verdict window, not the level', () => {
    const now = makeStats({ roundCount: 12, putting: -1.1 });
    const next = rebaseFocus(stale, now, '2026-10-16T08:00:00Z');
    expect(next).toMatchObject({
      baselineValue: -1.1, baselineVersion: SG_BASELINE_VERSION, rebasedAt: '2026-10-16T08:00:00Z',
      roundCountAtCommit: 6, roundCountAtBaseline: 12, committedAt: COMMITTED_AT,
    });
    expect(needsRebase(next)).toBe(false);
    const v = focusVerdict(next, makeStats({ roundCount: 13, putting: -0.5 }));
    expect(v).toMatchObject({ state: 'needs-more-rounds', roundsNeeded: 1, roundsSince: 7, level: 3 });
    const later = focusVerdict(next, makeStats({ roundCount: 14, putting: -0.8 }));
    expect(later).toMatchObject({ state: 'improving', early: true, baseline: -1.1 });
  });

  test('rebase keeps the baseline when the metric has no sample now', () => {
    const next = rebaseFocus(stale, makeStats({ roundCount: 12, rounds: [] }), '2026-10-16T08:00:00Z');
    expect(next.baselineValue).toBe(-1.8);
    expect(next.baselineVersion).toBe(SG_BASELINE_VERSION);
  });
});

describe('target handicap change (v2)', () => {
  const focus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
  const scratchStats = (over = {}) => ({ ...makeStats({ roundCount: 12, putting: -1.1, ...over }), targetHandicap: 0 });
  const AT = '2026-10-16T08:00:00Z';

  test('the commit stores the target the baseline was read against', () => {
    expect(focus.targetHandicap).toBe(15);
    expect(makeFocusCommit(leak, { ...baseStats, targetHandicap: undefined }, COMMITTED_AT).targetHandicap).toBeNull();
  });

  test('a different target needs a rebase; the same target, no stored target, or no current target do not', () => {
    expect(needsRebase(focus, baseStats)).toBe(false);
    expect(needsRebase(focus, scratchStats())).toBe(true);
    const { targetHandicap, ...old } = focus;
    expect(needsRebase(old, scratchStats())).toBe(false);
    expect(needsRebase(focus, { ...baseStats, targetHandicap: null })).toBe(false);
  });

  test('never a verdict across targets: needs-more-rounds until the rebase lands', () => {
    [-0.2, -5].forEach((putting) => {
      expect(focusVerdict(focus, scratchStats({ putting })).state).toBe('needs-more-rounds');
    });
  });

  test('rebase re-anchors on the new target, keeps the level and rounds in, and stamps the reason', () => {
    const next = rebaseFocus(focus, scratchStats(), AT);
    expect(next).toMatchObject({
      targetHandicap: 0, baselineValue: -1.1, rebasedAt: AT, roundCountAtCommit: 6, roundCountAtBaseline: 12,
      committedAt: COMMITTED_AT, rebaseReason: { kind: 'target', from: 15, to: 0 },
    });
    expect(needsRebase(next, scratchStats())).toBe(false);
    const v = focusVerdict(next, { ...scratchStats({ roundCount: 13, putting: -0.5 }) });
    expect(v).toMatchObject({ state: 'needs-more-rounds', roundsNeeded: 1, roundsSince: 7, level: 3 });
    expect(focusVerdict(next, scratchStats({ roundCount: 14, putting: -0.8 }))).toMatchObject({ state: 'improving', baseline: -1.1 });
  });

  test('a baseline-version rebase later drops the target reason', () => {
    const next = rebaseFocus(focus, scratchStats(), AT);
    const stale = { ...next, baselineVersion: SG_BASELINE_VERSION - 1 };
    expect(rebaseFocus(stale, scratchStats(), AT).rebaseReason).toBeUndefined();
  });
});

describe('persistence', () => {
  beforeEach(() => {
    AsyncStorage.__store.clear();
    jest.clearAllMocks();
  });
  const focus = makeFocusCommit(leak, baseStats, COMMITTED_AT);

  test('save / load / clear round-trip per user; keys unchanged', async () => {
    await saveFocus('u1', focus);
    expect(AsyncStorage.__store.has('@mystats_coach_focus:u1')).toBe(true);
    expect(await loadFocus('u1')).toEqual(focus);
    expect(await loadFocus('u2')).toBeNull();
    await clearFocus('u1');
    expect(await loadFocus('u1')).toBeNull();
    await saveFocus(undefined, focus);
    expect(AsyncStorage.__store.has('@mystats_coach_focus:anon')).toBe(true);
  });

  test('archive prepends history, caps at 10, clears the active focus', async () => {
    for (let i = 0; i < 12; i += 1) {
      await saveFocus('u1', { ...focus, causeId: `c${i}` });
      await archiveFocus('u1', { ...focus, causeId: `c${i}` }, { state: 'improving', current: -1.2 });
    }
    const history = await loadFocusHistory('u1');
    expect(history).toHaveLength(10);
    expect(history[0]).toMatchObject({ v: 2, causeId: 'c11', finalState: 'improving', finalValue: -1.2 });
    expect(history[0].finalImpact).toBeUndefined();
    expect(typeof history[0].endedAt).toBe('string');
    expect(await loadFocus('u1')).toBeNull();
  });

  test('corrupt or unknown storage degrades to null / empty and is left alone', async () => {
    await AsyncStorage.setItem('@mystats_coach_focus:u1', 'not json');
    await AsyncStorage.setItem('@mystats_coach_focus_history:u1', 'not json');
    expect(await loadFocus('u1')).toBeNull();
    expect(await loadFocusHistory('u1')).toEqual([]);
    await AsyncStorage.setItem('@mystats_coach_focus:u1', JSON.stringify({ something: 'else' }));
    expect(await loadFocus('u1')).toBeNull();
    expect(AsyncStorage.__store.get('@mystats_coach_focus:u1')).toBe(JSON.stringify({ something: 'else' }));
    expect(await loadFocusNotice('u1')).toBeNull();
  });
});

describe('v1 → v2 migration', () => {
  beforeEach(() => {
    AsyncStorage.__store.clear();
    jest.clearAllMocks();
  });
  const NOW = '2026-10-16T10:00:00.000Z';

  test('a v1 focus is archived as resolved on load, with a one-time notice', async () => {
    await saveFocus('u1', v1Focus);
    expect(isV1Focus(v1Focus)).toBe(true);
    expect(await loadFocus('u1', NOW)).toBeNull();
    expect(AsyncStorage.__store.has('@mystats_coach_focus:u1')).toBe(false);
    const history = await loadFocusHistory('u1');
    expect(history).toEqual([{
      ...v1Focus, v: 1, endedAt: NOW, endedBy: 'upgrade', finalState: 'resolved', finalImpact: null,
    }]);
    expect(await loadFocusNotice('u1')).toEqual({ kind: 'v1-closed', closedAt: NOW });
    await dismissFocusNotice('u1');
    expect(await loadFocusNotice('u1')).toBeNull();
  });

  test('archived once: repeated and concurrent loads add one entry', async () => {
    await saveFocus('u1', v1Focus);
    await Promise.all([loadFocus('u1', NOW), loadFocus('u1', NOW)]);
    await loadFocus('u1', NOW);
    expect(await loadFocusHistory('u1')).toHaveLength(1);
    await dismissFocusNotice('u1');
    await loadFocus('u1', NOW);
    expect(await loadFocusNotice('u1')).toBeNull();
  });

  test('an interrupted archive (slot not cleared) is finished without a duplicate', async () => {
    await saveFocus('u1', v1Focus);
    await loadFocus('u1', NOW);
    await saveFocus('u1', v1Focus); // as if removeItem never ran
    expect(await loadFocus('u1', '2026-10-17T10:00:00.000Z')).toBeNull();
    const history = await loadFocusHistory('u1');
    expect(history).toHaveLength(1);
    expect(history[0].endedAt).toBe(NOW);
    expect(AsyncStorage.__store.has('@mystats_coach_focus:u1')).toBe(false);
  });

  test('a v2 focus loads untouched: no archive, no notice', async () => {
    const focus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
    await saveFocus('u1', focus);
    expect(await loadFocus('u1', NOW)).toEqual(focus);
    expect(await loadFocusHistory('u1')).toEqual([]);
    expect(await loadFocusNotice('u1')).toBeNull();
  });

  test('a storage failure still never returns the v1 record', async () => {
    await saveFocus('u1', v1Focus);
    AsyncStorage.setItem.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
    expect(await loadFocus('u1', NOW)).toBeNull();
  });

  test('history keeps both shapes, newest first; pre-v2 entries read as v: 1', async () => {
    const legacyEntry = { ...v1Focus, endedAt: '2026-08-01T00:00:00Z', finalState: 'improving', finalImpact: -1.2 };
    await AsyncStorage.setItem('@mystats_coach_focus_history:u1', JSON.stringify([legacyEntry]));
    await saveFocus('u1', { ...v1Focus, insightId: 'approach:approach', committedAt: '2026-09-01T00:00:00Z' });
    await loadFocus('u1', NOW);
    const focus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
    await saveFocus('u1', focus);
    await archiveFocus('u1', focus, focusVerdict(focus, makeStats({ roundCount: 8, putting: -1.4 })));
    const history = await loadFocusHistory('u1');
    expect(history.map((e) => e.v)).toEqual([2, 1, 1]);
    expect(history[0]).toMatchObject({ leakId: 'leak:putting:6+', metricKey: 'sg.putting', finalState: 'improving', finalValue: -1.4 });
    expect(history[1]).toMatchObject({ insightId: 'approach:approach', endedBy: 'upgrade', finalState: 'resolved' });
    expect(history[2]).toEqual({ ...legacyEntry, v: 1 });
    // the stored legacy entry itself is not rewritten
    const raw = JSON.parse(AsyncStorage.__store.get('@mystats_coach_focus_history:u1'));
    expect(raw[2].v).toBeUndefined();
  });
});

describe('since the commit', () => {
  const sgFocus = makeFocusCommit(leak, baseStats, COMMITTED_AT);
  const at = (iso) => Date.parse(iso);
  const mr = (key, endedAt) => ({ key, endedAt });

  describe('roundsSinceCommit', () => {
    const rounds = [
      mr('before', at('2026-09-20T12:00:00Z')),
      mr('atCommit', at(COMMITTED_AT)),
      mr('unstamped', null),
      mr('after', at('2026-10-05T12:00:00Z')),
      mr('afterRebase', at('2026-10-17T12:00:00Z')),
    ];

    test('rounds that ended after committedAt, in input order; at the instant or unstamped are out', () => {
      const since = roundsSinceCommit(rounds, sgFocus);
      expect(since.committed.map((r) => r.key)).toEqual(['after', 'afterRebase']);
      expect(since.judged.map((r) => r.key)).toEqual(['after', 'afterRebase']);
    });

    test('rebasedAt narrows judged, never committed', () => {
      const rebased = { ...sgFocus, rebasedAt: '2026-10-16T08:00:00Z' };
      const since = roundsSinceCommit(rounds, rebased);
      expect(since.committed.map((r) => r.key)).toEqual(['after', 'afterRebase']);
      expect(since.judged.map((r) => r.key)).toEqual(['afterRebase']);
    });

    test('no focus, no rounds or an unreadable commit date select nothing', () => {
      const none = { committed: [], judged: [] };
      expect(roundsSinceCommit(rounds, null)).toEqual(none);
      expect(roundsSinceCommit(null, sgFocus)).toEqual(none);
      expect(roundsSinceCommit(rounds, { ...sgFocus, committedAt: 'not a date' })).toEqual(none);
    });
  });

  describe('focusVerdict with since', () => {
    // The whole selection says "worse" over 10 rounds by count; the since subset decides.
    const whole = makeStats({ roundCount: 16, putting: -2.5 });

    test('reads the metric from since.stats; roundsSince = since.rounds', () => {
      const v = focusVerdict(sgFocus, whole, { stats: makeStats({ putting: -1.5 }), rounds: 3, judged: 2 });
      expect(v).toMatchObject({
        state: 'improving', roundsSince: 3, level: 2, early: true, baseline: -1.8, current: -1.5, threshold: 0.25,
      });
      expect(v.delta).toBeCloseTo(0.3, 10);
      expect(v.currentSample).toEqual({ rounds: 6, holes: 108 });
    });

    test('needs-more-rounds counts since.judged; the level still counts since.rounds', () => {
      const v = focusVerdict(sgFocus, whole, { stats: makeStats({ putting: -1.5 }), rounds: 5, judged: 1 });
      expect(v).toMatchObject({ state: 'needs-more-rounds', roundsNeeded: 1, roundsSince: 5, level: 3, early: true, delta: null });
    });

    test('early until 4 judged rounds', () => {
      const v = focusVerdict(sgFocus, whole, { stats: makeStats({ putting: -1.5 }), rounds: 4, judged: 4 });
      expect(v).toMatchObject({ state: 'improving', early: false });
    });

    test('since.stats null (no judged rounds) gives no reading', () => {
      const v = focusVerdict(sgFocus, whole, { stats: null, rounds: 0, judged: 0 });
      expect(v).toMatchObject({
        state: 'needs-more-rounds', roundsNeeded: 2, roundsSince: 0, level: 1, current: null, currentSample: null,
      });
    });

    test('judged rounds without any reading ask for another round, never "resolved"', () => {
      const v = focusVerdict(sgFocus, whole, { stats: {}, rounds: 3, judged: 3 });
      expect(v).toMatchObject({ state: 'needs-more-rounds', roundsNeeded: 1, noData: true, current: null });
    });

    test('a stale baseline or a changed target still holds the verdict (read from stats)', () => {
      const since = { stats: makeStats({ putting: -0.5 }), rounds: 6, judged: 6 };
      const stale = { ...sgFocus, baselineVersion: SG_BASELINE_VERSION - 1 };
      expect(focusVerdict(stale, whole, since)).toMatchObject({ state: 'needs-more-rounds', roundsNeeded: 2 });
      expect(focusVerdict(sgFocus, { ...whole, targetHandicap: 0 }, since)).toMatchObject({ state: 'needs-more-rounds', roundsNeeded: 2 });
    });

    test('without since the verdict is the round-count one', () => {
      const stats = makeStats({ roundCount: 9, putting: -1.5 });
      expect(focusVerdict(sgFocus, stats, null)).toEqual(focusVerdict(sgFocus, stats));
      expect(focusVerdict(sgFocus, stats, undefined)).toEqual(focusVerdict(sgFocus, stats));
      expect(focusVerdict(sgFocus, stats).roundsSince).toBe(3);
      expect(focusVerdict(null, stats, { stats, rounds: 3, judged: 3 })).toBeNull();
    });
  });

  describe('loadFocus stamps an old v2 record once', () => {
    beforeEach(() => {
      AsyncStorage.__store.clear();
      jest.clearAllMocks();
    });
    const NOW = '2026-10-18T10:00:00.000Z';
    const { measuredSince, ...old } = sgFocus;

    test('writes the since-commit notice first, then the stamped record', async () => {
      expect(measuredSince).toBe('commit');
      await saveFocus('u1', old);
      jest.clearAllMocks();
      expect(await loadFocus('u1', NOW)).toEqual({ ...old, measuredSince: 'commit' });
      expect(AsyncStorage.setItem.mock.calls.map(([k]) => k)).toEqual([
        '@mystats_coach_focus_notice:u1', '@mystats_coach_focus:u1',
      ]);
      expect(JSON.parse(AsyncStorage.__store.get('@mystats_coach_focus:u1'))).toEqual({ ...old, measuredSince: 'commit' });
      expect(await loadFocusNotice('u1')).toEqual({ kind: 'since-commit', at: NOW });
      expect(await loadFocusHistory('u1')).toEqual([]);
    });

    test('a stamped record loads silently: no notice, no write', async () => {
      await saveFocus('u1', old);
      await loadFocus('u1', NOW);
      await dismissFocusNotice('u1');
      jest.clearAllMocks();
      expect(await loadFocus('u1', NOW)).toEqual(sgFocus);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(await loadFocusNotice('u1')).toBeNull();
    });

    test('a failed notice write leaves the record unstamped, so the next load tries again', async () => {
      await saveFocus('u1', old);
      AsyncStorage.setItem.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
      expect(await loadFocus('u1', NOW)).toEqual(old);
      expect(JSON.parse(AsyncStorage.__store.get('@mystats_coach_focus:u1')).measuredSince).toBeUndefined();
      expect(await loadFocusNotice('u1')).toBeNull();
      expect(await loadFocus('u1', NOW)).toEqual(sgFocus);
      expect(await loadFocusNotice('u1')).toEqual({ kind: 'since-commit', at: NOW });
    });
  });
});
