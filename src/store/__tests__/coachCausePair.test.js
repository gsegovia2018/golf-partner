import fs from 'fs';
import path from 'path';
import en from '../../i18n/locales/en';
import es from '../../i18n/locales/es';
import {
  CAUSE_IDS, issueKey, issueMsg, causePair,
} from '../coachCausePair';

const cause = (id, evidence, benchmark = null) => ({ id, evidence, benchmark });
const target = (extra = {}) => ({ source: 'target', targetHandicap: 15, ...extra });
const rows = (p) => p.rows.map((r) => [r.label.kind, r.value.n, r.value.unit]);

describe('issue names', () => {
  test('CAUSE_IDS is every id coachCauses can emit', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'coachCauses.js'), 'utf8');
    const emitted = new Set();
    [...src.matchAll(/'(cause:[a-z:]+?)'/g)].forEach((m) => emitted.add(m[1]));
    // the two side rules build their id from the side
    ['approach', 'tee'].forEach((area) => ['left', 'right'].forEach((s) => emitted.add(`cause:${area}:side:${s}`)));
    emitted.add('cause:penalty:tee');
    emitted.add('cause:penalty:other');
    // the why rules build theirs from the reason: swing subs x sides, lie, decision (R5)
    const swing = ['start', 'curve', 'strike'].flatMap((sub) => ['left', 'right'].map((side) => `swing:${sub}:${side}`));
    ['approach', 'tee'].forEach((area) => [...swing, 'swing:lowPoint', 'lie', 'decision']
      .forEach((r) => emitted.add(`cause:${area}:why:${r}`)));
    ['swing:lowPoint', 'lie', 'decision'].forEach((r) => emitted.add(`cause:short:why:${r}`));
    expect([...emitted].filter((id) => !/:side$/.test(id)).sort()).toEqual([...CAUSE_IDS].sort());
  });

  test.each(CAUSE_IDS)('%s has an English and a Spanish name, with the bucket when it has one', (id) => {
    const key = issueKey(id);
    [en, es].forEach((cat) => {
      expect(typeof cat[key]).toBe('string');
      expect(cat[key].length).toBeGreaterThan(0);
    });
    expect(/\{bucket\}/.test(en[key])).toBe(/\{bucket\}/.test(es[key]));
    expect(issueMsg({ category: 'putting', bucket: '2-3' }, { id })).toEqual({ key, params: { bucket: '2-3' } });
  });

  test('why ids: 9 approach, 9 tee, 3 short', () => {
    const why = CAUSE_IDS.filter((id) => id.includes(':why:'));
    expect(why.filter((id) => id.startsWith('cause:approach')).length).toBe(9);
    expect(why.filter((id) => id.startsWith('cause:tee')).length).toBe(9);
    expect(why.filter((id) => id.startsWith('cause:short')).length).toBe(3);
  });

  test('English names are short noun phrases', () => {
    CAUSE_IDS.forEach((id) => expect(en[issueKey(id)].split(/\s+/).length).toBeLessThanOrEqual(6));
  });

  test('without a cause the name is the area and the bucket', () => {
    expect(issueMsg({ category: 'putting', bucket: '2-3' }, null)).toEqual({
      key: 'stats.my.coach.ui.kicker.bucket', params: { area: { key: 'stats.my.coach.plan.area.putting', params: undefined }, bucket: '2-3' },
    });
    expect(issueMsg({ category: 'offTheTee', bucket: null }, null).key).toBe('stats.my.coach.ui.kicker');
  });

  test('an id the table does not know falls back to the area', () => {
    expect(issueMsg({ category: 'approach', bucket: '100-150' }, { id: 'cause:made:up' }).key).toBe('stats.my.coach.ui.kicker.bucket');
  });
});

describe('causePair: two bars against a benchmark', () => {
  test('short putts: your putts per try against the handicap', () => {
    const p = causePair({ cause: cause('cause:putting:short', { avgPutts: 2.0, attempts: 31 }, target({ expectedPutts: 1.4 })) });
    expect(p.kind).toBe('pair');
    expect(rows(p)).toEqual([['you', 2.0, 'putts'], ['target', 1.4, 'putts']]);
    expect(p.rows[1].label.hcp).toBe(15);
    expect(p.caption.key).toBe('stats.my.coach.ui.pair.caption.puttsTry');
    expect(p.rows[0].fraction).toBe(1);
    expect(p.rows[1].fraction).toBeCloseTo(0.7, 5);
  });

  test('lag, general putting, drive distance, chip and penalties each draw their own two numbers', () => {
    expect(rows(causePair({ cause: cause('cause:putting:lag', { avgPutts: 2.5 }, target({ expectedPutts: 2.2 })) })))
      .toEqual([['you', 2.5, 'putts'], ['target', 2.2, 'putts']]);
    expect(rows(causePair({ cause: cause('cause:putting:general', { per18: 36.2 }, target({ puttsPerRound: 33.1 })) })))
      .toEqual([['you', 36.2, 'putts'], ['target', 33.1, 'putts']]);
    expect(rows(causePair({ cause: cause('cause:tee:distance', { distance: 190 }, target({ driveDistance: 225 })) })))
      .toEqual([['you', 190, 'metres'], ['target', 225, 'metres']]);
    expect(rows(causePair({ cause: cause('cause:short:chip', { rate: 30, expectedRate: 48 }, target({ upAndDownRate: 48 })) })))
      .toEqual([['you', 30, 'percent'], ['target', 48, 'percent']]);
    expect(rows(causePair({ cause: cause('cause:penalty:tee', { perRound: 1.4, tee: 8, total: 10 }, target({ penaltiesPerRound: 0.9 })) })))
      .toEqual([['you', 1.4, 'penalties'], ['target', 0.9, 'penalties']]);
    expect(rows(causePair({ cause: cause('cause:penalty:other', { perRound: 1.2, other: 6, total: 8 }, target({ penaltiesPerRound: 0.9 })) })))
      .toEqual([['you', 1.2, 'penalties'], ['target', 0.9, 'penalties']]);
  });

  test('a drive side miss and a penalty-driven trouble cause compare percentages', () => {
    const side = causePair({ cause: cause('cause:tee:side:left', { side: 'left', sidePct: 42, count: 11, drives: 26 }, target({ sidePct: 23 })) });
    expect(rows(side)).toEqual([['you', 42, 'percent'], ['target', 23, 'percent']]);
    expect(side.caption.params.side.key).toBe('stats.my.fan.left');
    expect(rows(causePair({ cause: cause('cause:tee:trouble:driver', { driverPenaltyPct: 18 }, target({ teePenaltyPct: 8 })) })))
      .toEqual([['you', 18, 'percent'], ['target', 8, 'percent']]);
  });

  test('sand saves compare with your own other lies', () => {
    const p = causePair({ cause: cause('cause:short:sand', { sandRate: 25, nonSandRate: 60 }, { source: 'own', nonSandRate: 60 }) });
    expect(rows(p)).toEqual([['you', 25, 'percent'], ['otherLies', 60, 'percent']]);
    expect(p.caption.key).toBe('stats.my.coach.ui.pair.caption.upDownSand');
  });

  test('at target 0 the reference is Scratch', () => {
    const p = causePair({ cause: cause('cause:putting:short', { avgPutts: 1.6 }, { source: 'target', targetHandicap: 0, expectedPutts: 1.2 }) });
    expect(p.rows[1].label).toEqual({ kind: 'scratch' });
  });
});

describe('causePair: a single bar with its count', () => {
  test('approach causes carry no benchmark: the count of misses', () => {
    const p = causePair({ cause: cause('cause:approach:short', { shortCount: 10, directionKnown: 21 }) });
    expect(p).toMatchObject({ kind: 'single', text: { key: 'stats.my.coach.ui.pair.single.short', params: { count: 10, total: 21 } } });
    expect(p.fraction).toBeCloseTo(10 / 21, 5);
    expect(causePair({ cause: cause('cause:approach:bunker', { bunkerCount: 5, misses: 20 }) }).text.params).toMatchObject({ count: 5, total: 20 });
    const side = causePair({ cause: cause('cause:approach:side:right', { side: 'right', count: 9, directionKnown: 18 }, { source: 'own', greenPoints: 2, sidePoints: 1 }) });
    expect(side.kind).toBe('single');
    expect(side.text.params.side.key).toBe('stats.my.fan.right');
  });

  test('a cause whose benchmark is missing falls back to its count', () => {
    expect(causePair({ cause: cause('cause:putting:lag', { threePutts: 18, attempts: 58 }) })).toMatchObject({
      kind: 'single', text: { key: 'stats.my.coach.ui.pair.single.threePutt', params: { count: 18, total: 58 } },
    });
    expect(causePair({ cause: cause('cause:tee:trouble:driver', { troubleCount: 6, drives: 30 }) }).kind).toBe('single');
    expect(causePair({ cause: cause('cause:penalty:tee', { tee: 8, total: 10 }) }).fraction).toBeCloseTo(0.8, 5);
    expect(causePair({ cause: cause('cause:tee:side:left', { side: 'left', count: 11, drives: 26 }) }).kind).toBe('single');
  });

  test('a count with no total draws no bar', () => {
    const p = causePair({ cause: cause('cause:putting:short', { avgPutts: 2.0 }) });
    expect(p.kind).toBe('single');
    expect(p.fraction).toBeNull();
    expect(causePair({ cause: cause('cause:approach:distance', { perShot: -0.6 }) }).fraction).toBeNull();
  });

  test('no cause, or one with nothing to draw, gives no pair', () => {
    expect(causePair({})).toBeNull();
    expect(causePair({ cause: cause('cause:putting:general', { per18: 36 }) })).toBeNull();
    expect(causePair({ cause: cause('cause:made:up', {}) })).toBeNull();
    // a rule that did not report its counts draws nothing rather than "{count} of {total}"
    expect(causePair({ cause: cause('cause:approach:short', {}) })).toBeNull();
  });
});

describe('causePair: the focus variant', () => {
  const check = { label: { key: 'stats.my.coach.ui.metric.approachShort', params: { bucket: '100-150' } }, unit: 'percent', value: 48, baseline: 71 };

  test('draws now against the baseline from the check, so it agrees with the focus card', () => {
    const p = causePair({ cause: cause('cause:approach:short', { shortCount: 10, directionKnown: 21 }), check, isFocus: true });
    expect(p.kind).toBe('pair');
    expect(rows(p)).toEqual([['now', 48, 'percent'], ['start', 71, 'percent']]);
    expect(p.caption).toBe(check.label);
    expect(p.rows[0].fraction).toBeCloseTo(48 / 71, 5);
  });

  test('without a baseline or a current reading it keeps the cause pair', () => {
    const c = cause('cause:approach:short', { shortCount: 10, directionKnown: 21 });
    expect(causePair({ cause: c, check: { ...check, baseline: null }, isFocus: true }).kind).toBe('single');
    expect(causePair({ cause: c, check: { ...check, value: null }, isFocus: true }).kind).toBe('single');
    expect(causePair({ cause: c, check, isFocus: false }).kind).toBe('single');
  });

  test('signed metrics draw their size', () => {
    const p = causePair({ check: { ...check, unit: 'sgPerShot', value: -0.2, baseline: -0.4 }, isFocus: true });
    expect(p.rows.map((r) => r.fraction)).toEqual([0.5, 1]);
  });
});

describe('causePair: why causes are a single bar of tagged misses', () => {
  test.each([
    ['cause:approach:why:swing:start:right'], ['cause:tee:why:swing:lowPoint'], ['cause:short:why:lie'], ['cause:approach:why:decision'],
  ])('%s', (id) => {
    const p = causePair({ cause: cause(id, { count: 7, tagged: 10 }) });
    expect(p).toEqual({
      kind: 'single', text: { key: 'stats.my.coach.ui.pair.single.why', params: { count: 7, total: 10 } }, fraction: 0.7,
    });
  });
});
