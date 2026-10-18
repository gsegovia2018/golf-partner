import { roundFocusSummary } from '../roundFocus';
import { focusTarget } from '../focusTarget';

const holes = [1, 2, 3, 4, 5, 6, 7].map((number) => ({ number, par: number === 7 ? 3 : 4 }));
const roundOf = (details, scores = {}) => ({
  id: 'r1', holes, scores: { me: scores }, shotDetails: { me: details },
});
const rec = (over) => ({
  v: 2,
  leakId: 'leak:approach:100-150',
  category: 'approach',
  bucket: '100-150',
  causeId: null,
  committedAt: '2026-10-01T00:00:00Z',
  ...over,
});
const summarize = (focus, round, roundStats = null) => roundFocusSummary({
  focus, target: focusTarget(focus), round, playerId: 'me', roundStats,
});

const missRight = { approachBucket: '100-150', approachResult: 'miss', approachMiss: 'right', approachStart: 'right' };
const missLeft = { approachBucket: '100-150', approachResult: 'miss', approachMiss: 'left', approachStart: 'center' };

describe('roundFocusSummary: swing focus', () => {
  const focus = rec({
    causeId: 'cause:approach:why:swing:start:right',
    metricKey: 'approach.why.swing.start.rightRate.100-150',
    baselineValue: 70,
    baselineSample: { shots: 10 },
  });
  const round = roundOf({
    1: missRight, 2: missRight, 3: missLeft, 4: missLeft, 5: { ...missLeft, approachBucket: '50-100' },
  });

  test('counts the tagged misses with the reason, in the focus bucket', () => {
    expect(summarize(focus, round)).toEqual({
      touched: true,
      thisRound: { kind: 'count', count: 2, total: 4 },
      before: { kind: 'count', count: 7, total: 10 },
      nowPct: 50,
      beforePct: 70,
    });
  });

  test('an all-scope metric pools the buckets', () => {
    const all = { ...focus, metricKey: 'approach.why.swing.start.rightRate.all' };
    expect(summarize(all, round).thisRound).toEqual({ kind: 'count', count: 2, total: 5 });
  });

  test('untouched with no approach shot in the round; touched with hits only', () => {
    expect(summarize(focus, roundOf({ 1: { drive: 'left' } })).touched).toBe(false);
    const hits = summarize(focus, roundOf({ 1: { approachBucket: '100-150', approachResult: 'green' } }));
    expect(hits.touched).toBe(true);
    expect(hits.thisRound).toEqual({ kind: 'count', count: 0, total: 0 });
    expect(hits.nowPct).toBeNull();
  });

  test('a par 3 approach does not count', () => {
    expect(summarize(focus, roundOf({ 7: missRight })).touched).toBe(false);
  });
});

describe('roundFocusSummary: decision, tee and short', () => {
  test('decision kind reads the decision family', () => {
    const focus = rec({
      causeId: 'cause:approach:why:decision',
      metricKey: 'approach.why.decisionRate.100-150',
      baselineValue: 40,
      baselineSample: { shots: 5 },
    });
    const round = roundOf({
      1: { ...missLeft, approachSituation: ['decision'] }, 2: missRight, 3: missLeft,
    });
    expect(summarize(focus, round)).toMatchObject({
      thisRound: { kind: 'count', count: 1, total: 3 }, before: { kind: 'count', count: 2, total: 5 },
    });
  });

  test('drive focus is touched by a drive on a par 4', () => {
    const focus = rec({
      category: 'offTheTee',
      bucket: null,
      causeId: 'cause:tee:why:decision',
      metricKey: 'tee.why.decisionRate',
      baselineValue: 20,
      baselineSample: { shots: 5 },
    });
    expect(summarize(focus, roundOf({ 1: { drive: 'left', driveSituation: ['decision'] } })))
      .toMatchObject({ touched: true, thisRound: { kind: 'count', count: 1, total: 1 } });
    expect(summarize(focus, roundOf({ 7: { drive: 'left' } })).touched).toBe(false);
  });

  test('short focus is touched by a missed green that cost a stroke over par', () => {
    const focus = rec({
      category: 'aroundGreen',
      bucket: null,
      causeId: 'cause:short:why:decision',
      metricKey: 'short.why.decisionRate',
      baselineValue: 20,
      baselineSample: { shots: 5 },
    });
    const miss = { approachResult: 'miss', shortSituation: ['wrong-shot'] };
    expect(summarize(focus, roundOf({ 1: miss }, { 1: 6 }))).toMatchObject({
      touched: true, thisRound: { kind: 'count', count: 1, total: 1 },
    });
    expect(summarize(focus, roundOf({ 1: miss }, { 1: 4 })).touched).toBe(false);
  });
});

describe('roundFocusSummary: lie focus', () => {
  const focus = rec({
    causeId: 'cause:approach:why:lie',
    focusLie: 'uphill',
    metricKey: 'approach.why.lieRate.100-150',
    baselineValue: 56,
    baselineSample: { shots: 9 },
  });

  test('miss share from the lie plus the encounters', () => {
    const round = roundOf({
      1: { ...missLeft, approachSituation: ['uphill'] },
      2: { approachBucket: '100-150', approachResult: 'green', approachSituation: ['uphill'] },
      3: { approachBucket: '100-150', approachResult: 'green', approachSituation: ['uphill'] },
      4: { approachBucket: '100-150', approachResult: 'green', approachSituation: ['uphill', 'wind'] },
      5: missRight, 6: missRight,
    });
    expect(summarize(focus, round)).toEqual({
      touched: true,
      thisRound: { kind: 'lie', lie: 'uphill', count: 1, total: 3, shots: 4, greens: 3 },
      before: { kind: 'count', count: 5, total: 9 },
      nowPct: 33,
      beforePct: 56,
    });
  });

  test('a tagged miss with another lie counts in the total only', () => {
    const round = roundOf({
      1: { ...missLeft, approachSituation: ['below-feet'] },
      2: { ...missLeft, approachSituation: ['uphill'] },
    });
    expect(summarize(focus, round).thisRound).toMatchObject({ count: 1, total: 2, shots: 1, greens: 0 });
  });

  test('untouched with no encounter from the lie', () => {
    const round = roundOf({ 1: { ...missLeft, approachSituation: ['below-feet'] }, 2: missRight });
    expect(summarize(focus, round).touched).toBe(false);
  });
});

describe('roundFocusSummary: outcome focus', () => {
  const focus = rec({
    category: 'putting',
    bucket: null,
    causeId: null,
    metricKey: 'putting.threePuttsPer18',
    baselineValue: 2.5,
    baselineSample: { holes: 72 },
  });
  const puttStats = { shots: { putts: { holes: 18, threePuttPer18: 1 } } };

  test('value form this round and before when the unit is not a percent', () => {
    expect(summarize(focus, roundOf({}), puttStats)).toEqual({
      touched: true,
      thisRound: { kind: 'value', value: 1, unit: 'perRound' },
      before: { kind: 'value', value: 2.5, unit: 'perRound' },
      nowPct: null,
      beforePct: null,
    });
  });

  test('percent outcome: bars get percents, before is a count when sampled', () => {
    const pctFocus = rec({
      category: 'aroundGreen', bucket: null, causeId: null,
      metricKey: 'short.upDownRate', baselineValue: 40, baselineSample: { shots: 10 },
    });
    const out = summarize(pctFocus, roundOf({}), { upAndDown: { attempts: 4, rate: 0.5 } });
    expect(out.thisRound).toEqual({ kind: 'value', value: 50, unit: 'percent' });
    expect(out.before).toEqual({ kind: 'count', count: 4, total: 10 });
    expect([out.nowPct, out.beforePct]).toEqual([50, 40]);
  });

  test('untouched without a reading sample', () => {
    expect(summarize(focus, roundOf({}), {}).touched).toBe(false);
    expect(summarize(focus, roundOf({}), null).touched).toBe(false);
  });

  test('no baseline value: before is null', () => {
    expect(summarize({ ...focus, baselineValue: null }, roundOf({}), puttStats).before).toBeNull();
  });
});

describe('roundFocusSummary: guards', () => {
  test('null without a target or focus', () => {
    expect(roundFocusSummary({ focus: null, target: null, round: roundOf({}), playerId: 'me' })).toBeNull();
    expect(roundFocusSummary({ focus: rec({}), target: null, round: roundOf({}), playerId: 'me' })).toBeNull();
  });

  test('a why target with an unparsable metric key is null', () => {
    const focus = rec({ causeId: 'cause:approach:why:decision', metricKey: 'nonsense' });
    expect(summarize(focus, roundOf({ 1: missLeft }))).toBeNull();
  });
});
