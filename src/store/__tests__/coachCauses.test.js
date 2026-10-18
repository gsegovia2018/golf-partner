import { causesForLeak, expectedUpAndDown, CAUSE_MIN } from '../coachCauses';
import { benchmarkDriveDistance } from '../strokesGainedBaseline';

const leak = (category, bucket = null, extra = {}) => ({
  id: bucket ? `leak:${category}:${bucket}` : `leak:${category}`,
  category,
  bucket,
  children: [],
  benchmark: { targetHandicap: null },
  ...extra,
});

const base = (over = {}) => ({ targetHandicap: 15, ...over });
const primaryId = (l, s) => causesForLeak(l, s).primary?.id ?? null;

const puttStats = (b, row, over = {}) => base({ puttingTarget: { buckets: { [b]: row } }, ...over });
const missRow = (o) => ({
  attempts: 30, misses: 12, directionKnown: 12, missRate: 40,
  shortRate: 0, leftRate: 0, rightRate: 0, longRate: 0, bunkerRate: 0, ...o,
});
const apprStats = (b, row, over = {}) => base({ approachMissByDistance: { buckets: { [b]: row } }, ...over });
const drives = (o) => ({
  fairway: { holes: 20, avgPoints: 2 }, super: { holes: 0 }, left: { holes: 0 }, right: { holes: 0 }, short: { holes: 0 }, ...o,
});

describe('putting', () => {
  const lagRow = { attempts: 58, avgPutts: 2.5, expectedPutts: 2.2, sgPerPutt: -0.3, threePuttRate: 31 };

  test('lag fires on 6+ with a high three-putt rate and negative SG', () => {
    const { primary } = causesForLeak(leak('putting', '6+'), puttStats('6+', lagRow));
    expect(primary).toMatchObject({
      id: 'cause:putting:lag', leakId: 'leak:putting:6+', strength: 'consistent', metricKey: 'putting.threePuttRate.6+',
    });
    expect(primary.evidence).toMatchObject({ attempts: 58, threePutts: 18, threePuttRate: 31 });
  });

  test('lag is likely at 35 % three-putts', () => {
    const s = puttStats('3-6', { ...lagRow, threePuttRate: 36 });
    expect(causesForLeak(leak('putting', '3-6'), s).primary.strength).toBe('likely');
  });

  test('lag is suppressed under the sample, the rate or a non-negative SG', () => {
    expect(primaryId(leak('putting', '6+'), puttStats('6+', { ...lagRow, attempts: CAUSE_MIN.puttBucketShots - 1 }))).toBeNull();
    expect(primaryId(leak('putting', '6+'), puttStats('6+', { ...lagRow, threePuttRate: 24 }))).toBeNull();
    expect(primaryId(leak('putting', '6+'), puttStats('6+', { ...lagRow, sgPerPutt: 0.1 }))).toBeNull();
  });

  const shortRow = { attempts: 24, avgPutts: 1.4, expectedPutts: 1.25, sgPerPutt: -0.1, threePuttRate: 0 };

  test('short fires on a near bucket losing strokes; likely when the loss is large', () => {
    const c = causesForLeak(leak('putting', '1-2'), puttStats('1-2', shortRow)).primary;
    expect(c).toMatchObject({ id: 'cause:putting:short', strength: 'consistent', metricKey: 'sg.putting.bucket.1-2' });
    const big = causesForLeak(leak('putting', '1-2'), puttStats('1-2', { ...shortRow, sgPerPutt: -0.2 })).primary;
    expect(big.strength).toBe('likely');
  });

  test('short is suppressed under the sample or when the bucket is a lag bucket', () => {
    expect(primaryId(leak('putting', '1-2'), puttStats('1-2', { ...shortRow, attempts: 9 }))).toBeNull();
    expect(primaryId(leak('putting', '6+'), puttStats('6+', shortRow))).toBeNull();
  });

  const generalShots = (per18, three) => ({
    shots: { putts: { holes: 54, per18, threePuttPer18: three } },
  });

  test('at target 0 the benchmark sentence says scratch: a .scratch key without the hcp param', () => {
    const c = causesForLeak(leak('putting'), base({ ...generalShots(34, 3), targetHandicap: 0 })).primary;
    expect(c.msg.key).toBe('stats.my.coach.cause.putting.general.bench.scratch');
    expect(c.msg.params).not.toHaveProperty('hcp');
    expect(causesForLeak(leak('putting'), base(generalShots(34, 3))).primary.msg.params).toHaveProperty('hcp');
  });

  test('general fires against the benchmark row, possible, and never without a row', () => {
    const l = leak('putting');
    const c = causesForLeak(l, base(generalShots(34, 3))).primary;
    expect(c).toMatchObject({ id: 'cause:putting:general', strength: 'possible', metricKey: 'putting.per18' });
    expect(c.msg.key).toBe('stats.my.coach.cause.putting.general.bench');
    expect(primaryId(l, base(generalShots(32.5, 3.8)))).toBeNull();
    expect(primaryId(l, base({ ...generalShots(34, 3), targetHandicap: null }))).toBeNull();
    expect(primaryId(l, base({ ...generalShots(34, 3), targetHandicap: 40 }))).toBeNull();
    const thin = { shots: { putts: { holes: 20, per18: 34, threePuttPer18: 3 } } };
    expect(primaryId(l, base(thin))).toBeNull();
  });
});

describe('approach', () => {
  const l = leak('approach', '100-150');

  test('short fires when half the known misses are short', () => {
    const c = causesForLeak(l, apprStats('100-150', missRow({ shortRate: 70 }))).primary;
    expect(c).toMatchObject({ id: 'cause:approach:short', strength: 'likely', metricKey: 'approach.shortRate.100-150' });
    expect(c.evidence).toMatchObject({ shortCount: 8, directionKnown: 12 });
    expect(causesForLeak(l, apprStats('100-150', missRow({ shortRate: 55 }))).primary.strength).toBe('consistent');
  });

  test('short is suppressed under 8 misses or under 50 %', () => {
    expect(primaryId(l, apprStats('100-150', missRow({ shortRate: 70, misses: 7 })))).toBeNull();
    expect(primaryId(l, apprStats('100-150', missRow({ shortRate: 49 })))).toBeNull();
  });

  test('side fires with the cost key when green and side points are known, without it otherwise', () => {
    const row = missRow({ leftRate: 75 });
    const withCost = apprStats('100-150', row, {
      approachMissCost: { byFinish: { green: { holes: 10, avgPoints: 2.4 }, left: { holes: 8, avgPoints: 1.4 } } },
    });
    const c = causesForLeak(l, withCost).primary;
    expect(c).toMatchObject({ id: 'cause:approach:side:left', strength: 'likely' });
    expect(c.msg.key).toBe('stats.my.coach.cause.approach.side.cost');
    expect(c.msg.params.cost).toMatchObject({ n: 1, noMinus: true });
    expect(c.benchmark).toEqual({ source: 'own', greenPoints: 2.4, sidePoints: 1.4 });
    const plain = causesForLeak(l, apprStats('100-150', row)).primary;
    expect(plain.msg.key).toBe('stats.my.coach.cause.approach.side');
    expect(plain.benchmark).toBeNull();
  });

  test('side picks the right side and is suppressed under the sample', () => {
    expect(primaryId(l, apprStats('100-150', missRow({ rightRate: 60 })))).toBe('cause:approach:side:right');
    expect(primaryId(l, apprStats('100-150', missRow({ rightRate: 60, misses: 7 })))).toBeNull();
  });

  const sandLow = { upAndDown: { byLie: { sand: { attempts: 6, rate: 0.33 }, nonSand: { attempts: 6, rate: 0.5 } } } };

  test('bunker fires on many bunker misses with a low sand rate', () => {
    const c = causesForLeak(l, apprStats('100-150', missRow({ bunkerRate: 33 }), sandLow)).primary;
    expect(c).toMatchObject({ id: 'cause:approach:bunker', strength: 'consistent', metricKey: 'approach.bunkerRate.100-150' });
    expect(c.evidence.bunkerCount).toBe(4);
  });

  test('bunker is suppressed under the sample, the rate or with a fine sand game', () => {
    expect(primaryId(l, apprStats('100-150', missRow({ bunkerRate: 33, misses: 7 }), sandLow))).toBeNull();
    expect(primaryId(l, apprStats('100-150', missRow({ bunkerRate: 29 }), sandLow))).toBeNull();
    const fine = { upAndDown: { byLie: { sand: { attempts: 6, rate: 0.6 }, nonSand: { attempts: 6, rate: 0.5 } } } };
    expect(primaryId(l, apprStats('100-150', missRow({ bunkerRate: 33 }), fine))).toBeNull();
  });

  const dist = (over = {}) => leak('approach', '150-200', {
    children: [
      { bucket: '150-200', perShot: -0.6, confidence: 'high', sample: { shots: 14 }, ...over },
      { bucket: '50-100', perShot: 0.1, confidence: 'medium', sample: { shots: 12 } },
    ],
  });

  test('distance is the fallback: fires only when no miss pattern does, and carries a benchmark', () => {
    const c = causesForLeak(dist(), base()).primary;
    expect(c).toMatchObject({ id: 'cause:approach:distance', strength: 'consistent', metricKey: 'sg.approach.bucket.150-200' });
    expect(c.evidence).toMatchObject({ bestBucket: '50-100', bestPerShot: 0.1 });
    expect(c.msg.key).toBe('stats.my.coach.cause.approach.distance.bench');
    const scratch = causesForLeak(dist(), base({ targetHandicap: 0 })).primary;
    expect(scratch.msg.key).toBe('stats.my.coach.cause.approach.distance.bench.scratch');
    expect(scratch.msg.params).not.toHaveProperty('hcp');
    const withShort = apprStats('150-200', missRow({ shortRate: 70 }));
    expect(primaryId(dist(), withShort)).toBe('cause:approach:short');
    expect(causesForLeak(dist(), withShort).alsoPossible).toEqual([]);
  });

  test('distance is suppressed for an insufficient or non-negative bucket, and without a bucket', () => {
    expect(primaryId(dist({ confidence: 'insufficient' }), base())).toBeNull();
    expect(primaryId(dist({ perShot: 0.1 }), base())).toBeNull();
    expect(primaryId(leak('approach'), apprStats('100-150', missRow({ shortRate: 70 })))).toBeNull();
  });
});

describe('off the tee', () => {
  const l = leak('offTheTee');

  test('trouble fires on the lie trouble rate; likely with the driver penalty rate too', () => {
    const lies = { driveLies: { drives: 32, byLie: { fairway: 10, rough: 13, sand: 4, trouble: 5 }, troubleRate: 0.28 } };
    const c = causesForLeak(l, base(lies)).primary;
    expect(c).toMatchObject({ id: 'cause:tee:trouble:driver', strength: 'consistent', metricKey: 'tee.troubleRate' });
    expect(c.msg).toEqual({ key: 'stats.my.coach.cause.tee.trouble.driver', params: { pct: 28, count: 9, total: 32 } });
    const both = base({ ...lies, teeClubAccuracy: { byClub: { driver: { holes: 32, penaltyPct: 13 } } } });
    expect(causesForLeak(l, both).primary.strength).toBe('likely');
  });

  test('trouble by driver penalties uses the benchmark key when a row exists', () => {
    const pen = { teeClubAccuracy: { byClub: { driver: { holes: 20, penaltyPct: 15 } } } };
    const c = causesForLeak(l, base(pen)).primary;
    expect(c.msg.key).toBe('stats.my.coach.cause.tee.penalty.driver.bench');
    expect(c.benchmark).toMatchObject({ source: 'target', teePenaltyPct: 2 });
    const none = causesForLeak(l, base({ ...pen, targetHandicap: null })).primary;
    expect(none.msg.key).toBe('stats.my.coach.cause.tee.penalty.driver');
    expect(none.benchmark).toBeNull();
  });

  test('trouble is suppressed under 15 drives', () => {
    const lies = { driveLies: { drives: 14, byLie: { sand: 4, trouble: 2 }, troubleRate: 0.43 } };
    const pen = { teeClubAccuracy: { byClub: { driver: { holes: 14, penaltyPct: 20 } } } };
    expect(primaryId(l, base({ ...lies, ...pen }))).toBeNull();
  });

  test('side fires on a dominant miss side with the benchmark row', () => {
    const s = base({ driveImpact: { buckets: drives({ left: { holes: 11, avgPoints: 1.2 }, right: { holes: 4, avgPoints: 1 } }) } });
    const c = causesForLeak(l, s).primary;
    expect(c).toMatchObject({ id: 'cause:tee:side:left', strength: 'consistent', metricKey: 'tee.missSideShare.left' });
    expect(c.evidence).toMatchObject({ count: 11, other: 4, misses: 15, costPts: 0.8 });
    expect(c.msg.key).toBe('stats.my.coach.cause.tee.side.bench');
    expect(c.msg.params).toMatchObject({ count: 11, misses: 15, benchPct: 23 });
    const bare = causesForLeak(l, { ...s, targetHandicap: null, strokesGained: undefined }).primary;
    expect(bare.msg.key).toBe('stats.my.coach.cause.tee.side');
    expect(bare.benchmark).toBeNull();
  });

  test('side picks right, is likely at 3x, and is suppressed when balanced or under 10 misses', () => {
    const right = base({ driveImpact: { buckets: drives({ left: { holes: 3 }, right: { holes: 10 } }) } });
    expect(causesForLeak(l, right).primary).toMatchObject({ id: 'cause:tee:side:right', strength: 'likely' });
    const even = base({ driveImpact: { buckets: drives({ left: { holes: 7 }, right: { holes: 5 } }) } });
    expect(primaryId(l, even)).toBeNull();
    const few = base({ driveImpact: { buckets: drives({ left: { holes: 6 }, right: { holes: 2 } }) } });
    expect(primaryId(l, few)).toBeNull();
  });

  test('distance fires 20 m under the benchmark with fine lies, and is suppressed otherwise', () => {
    const bench = benchmarkDriveDistance(15);
    const mk = (avg, drives_ = 20) => base({ driveDistance: { drives: drives_, avgDistance: avg } });
    const c = causesForLeak(l, mk(bench - 25)).primary;
    expect(c).toMatchObject({ id: 'cause:tee:distance', strength: 'possible', metricKey: 'tee.distance' });
    expect(causesForLeak(l, mk(bench - 40)).primary.strength).toBe('consistent');
    expect(primaryId(l, mk(bench - 10))).toBeNull();
    expect(primaryId(l, mk(bench - 25, 14))).toBeNull();
    expect(primaryId(l, { ...mk(bench - 25), targetHandicap: null })).toBeNull();
    const trouble = { ...mk(bench - 25), driveLies: { drives: 20, byLie: { sand: 3, trouble: 3 }, troubleRate: 0.3 } };
    expect(primaryId(l, trouble)).toBe('cause:tee:trouble:driver');
  });
});

describe('around the green', () => {
  const l = leak('aroundGreen');
  const ud = (sand, grass, rate = null) => ({ upAndDown: { attempts: 20, rate, byLie: { sand, nonSand: grass } } });

  test('sand fires when sand trails grass by 20 points', () => {
    const c = causesForLeak(l, base(ud({ attempts: 7, rate: 0.28 }, { attempts: 13, rate: 0.52 }))).primary;
    expect(c).toMatchObject({ id: 'cause:short:sand', strength: 'consistent', metricKey: 'short.upDownRate.sand' });
    expect(c.msg.params).toMatchObject({ sandPct: 28, nonSandPct: 52 });
    expect(c.benchmark).toEqual({ source: 'own', nonSandRate: 52 });
    const big = causesForLeak(l, base(ud({ attempts: 7, rate: 0.2 }, { attempts: 13, rate: 0.55 }))).primary;
    expect(big.strength).toBe('likely');
  });

  test('sand is suppressed under 6 each or with a small gap', () => {
    expect(primaryId(l, base(ud({ attempts: 5, rate: 0.2 }, { attempts: 13, rate: 0.6 })))).toBeNull();
    expect(primaryId(l, base(ud({ attempts: 7, rate: 0.4 }, { attempts: 6, rate: 0.55 })))).toBeNull();
  });

  test('chip fires when the up-and-down rate trails the target expectation, and needs a target', () => {
    const expected = expectedUpAndDown(15);
    expect(expected).toBeGreaterThan(0.3);
    const rate = Math.max(0, expected - 0.15);
    const s = base(ud({ attempts: 2, rate: 0 }, { attempts: 2, rate: 0 }, rate));
    const c = causesForLeak(l, s).primary;
    expect(c).toMatchObject({ id: 'cause:short:chip', strength: 'possible', metricKey: 'short.upDownRate' });
    expect(c.msg.key).toBe('stats.my.coach.cause.short.chip.bench');
    expect(primaryId(l, { ...s, targetHandicap: null, strokesGained: undefined })).toBeNull();
    expect(primaryId(l, base(ud({ attempts: 2 }, { attempts: 2 }, expected)))).toBeNull();
    const thin = { upAndDown: { attempts: 5, rate: null, byLie: {} } };
    expect(primaryId(l, base(thin))).toBeNull();
  });
});

describe('penalties', () => {
  const l = leak('penalties');
  const pen = (tee, other, rounds = 6) => base({ shots: { roundsWithData: rounds, penalties: { tee, other } } });

  test('tee fires when tee penalties are twice the others; likely at 3x', () => {
    const c = causesForLeak(l, pen(9, 3)).primary;
    expect(c).toMatchObject({ id: 'cause:penalty:tee', strength: 'likely', metricKey: 'penalties.perRound.tee' });
    expect(c.msg.key).toBe('stats.my.coach.cause.penalty.tee.bench');
    expect(c.msg.params).toMatchObject({ count: 9, total: 12 });
    expect(causesForLeak(l, pen(8, 4)).primary.strength).toBe('consistent');
  });

  test('other fires otherwise; the no-benchmark key without a target', () => {
    const c = causesForLeak(l, { ...pen(3, 5), targetHandicap: null }).primary;
    expect(c).toMatchObject({ id: 'cause:penalty:other', strength: 'possible' });
    expect(c.msg.key).toBe('stats.my.coach.cause.penalty.other');
    expect(c.benchmark).toBeNull();
    expect(causesForLeak(l, pen(2, 6)).primary.strength).toBe('consistent');
  });

  test('both are suppressed under four penalties', () => {
    expect(primaryId(l, pen(3, 0))).toBeNull();
    expect(primaryId(l, pen(1, 2))).toBeNull();
  });
});

describe('ranking', () => {
  // Putting leak on 6+: lag (consistent, 58 putts) plus general (possible).
  const lagRow = { attempts: 58, avgPutts: 2.5, expectedPutts: 2.2, sgPerPutt: -0.3, threePuttRate: 31 };
  const stats = puttStats('6+', lagRow, { shots: { putts: { holes: 54, per18: 34, threePuttPer18: 3 } } });

  test('the strongest rule wins and the rest land in alsoPossible', () => {
    const r = causesForLeak(leak('putting', '6+'), stats);
    expect(r.primary.id).toBe('cause:putting:lag');
    expect(r.alsoPossible.map((c) => c.id)).toEqual(['cause:putting:general']);
  });

  test('an equal strength is decided by the larger sample', () => {
    const s = apprStats('100-150', missRow({ shortRate: 60, leftRate: 55, misses: 12 }));
    const tied = { ...s, approachMissCost: { byFinish: {} } };
    // short and left are both consistent on 12 misses: table order keeps short first.
    const r = causesForLeak(leak('approach', '100-150'), tied);
    expect(r.primary.id).toBe('cause:approach:short');
    expect(r.alsoPossible.map((c) => c.id)).toEqual(['cause:approach:side:left']);
  });

  test('a likely cause beats a consistent one found earlier in the table', () => {
    const lies = { driveLies: { drives: 32, byLie: { sand: 4, trouble: 5 }, troubleRate: 0.28 } };
    const side = { driveImpact: { buckets: drives({ left: { holes: 12 }, right: { holes: 3 } }) } };
    const r = causesForLeak(leak('offTheTee'), base({ ...lies, ...side }));
    expect(r.primary.id).toBe('cause:tee:side:left');
    expect(r.primary.strength).toBe('likely');
    expect(r.alsoPossible.map((c) => c.id)).toEqual(['cause:tee:trouble:driver']);
  });

  test('every cause carries the honest-wording lead for its strength', () => {
    const r = causesForLeak(leak('putting', '6+'), stats);
    expect(r.primary.lead).toEqual({ key: 'stats.my.coach.cause.lead.consistent', params: undefined });
    expect(r.alsoPossible[0].lead.key).toBe('stats.my.coach.cause.lead.possible');
  });

  test('benchmark and no-benchmark variants use sibling keys', () => {
    const l = leak('putting', '6+');
    expect(causesForLeak(l, stats).primary.msg.key).toBe('stats.my.coach.cause.putting.lag.bench');
    const none = causesForLeak(l, { ...stats, targetHandicap: null });
    expect(none.primary.msg.key).toBe('stats.my.coach.cause.putting.lag');
    expect(none.primary.benchmark).toBeNull();
  });

  test('unknown leaks, null leaks and empty stats give no cause; inputs are not mutated', () => {
    expect(causesForLeak(null, stats)).toEqual({ primary: null, alsoPossible: [] });
    expect(causesForLeak(leak('nothing'), stats)).toEqual({ primary: null, alsoPossible: [] });
    ['putting', 'approach', 'offTheTee', 'aroundGreen', 'penalties'].forEach((c) => {
      expect(causesForLeak(leak(c, '6+'), {}).primary).toBeNull();
    });
    const frozen = JSON.parse(JSON.stringify(stats));
    causesForLeak(leak('putting', '6+'), stats);
    expect(stats).toEqual(frozen);
  });
});

describe('why rules', () => {
  const row = (o = {}) => ({
    misses: 0, tagged: 0, untagged: 0, blocked: 0,
    families: { forced: 0, lie: 0, decision: 0, swing: 0 },
    subs: { start: { left: 0, right: 0 }, curve: { left: 0, right: 0 }, strike: { left: 0, right: 0 }, lowPoint: 0 },
    ...o,
  });
  // A row with `tagged` misses, of which `n` are in the given family/sub.
  const swingRow = (tagged, sub, side, n) => {
    const subs = row().subs;
    if (side) subs[sub][side] = n; else subs[sub] = n;
    return row({ misses: tagged, tagged, families: { forced: 0, lie: 0, decision: 0, swing: n }, subs });
  };
  const familyRow = (tagged, family, n) => row({
    misses: tagged, tagged, families: { forced: 0, lie: 0, decision: 0, swing: 0, [family]: n },
  });
  const why = (parts) => ({ missReasons: { approach: { byBucket: {}, all: row() }, tee: row(), short: row(), ...parts } });
  const withBucket = (bucket, r, all = r) => ({ approach: { byBucket: { [bucket]: r }, all } });
  const A = leak('approach', '100-150');
  const T = leak('offTheTee');
  const S = leak('aroundGreen');
  const pr = (l, s) => causesForLeak(l, base(s)).primary;

  test('thresholds are pinned', () => {
    expect(CAUSE_MIN).toMatchObject({ whyTagged: 6, whyFamilyPct: 50, whyLikelyPct: 70 });
  });

  test('approach start line: fires at 6 tagged and 50 %, side only on start/curve/strike', () => {
    const c = pr(A, why(withBucket('100-150', swingRow(6, 'start', 'right', 3))));
    expect(c).toMatchObject({
      id: 'cause:approach:why:swing:start:right', strength: 'consistent', sample: 6,
      metricKey: 'approach.why.swing.start.rightRate.100-150',
    });
    expect(c.msg.key).toBe('stats.my.coach.cause.approach.why.swing.start');
    expect(c.msg.params).toMatchObject({ count: 3, total: 6 });
    expect(c.msg.params.side.key).toBe('stats.my.fan.right');
    expect(c.msg.params.scope).toEqual({ key: 'stats.my.coach.cause.approach.why.scope.bucket', params: { bucket: '100-150' } });
    expect(c.evidence).toMatchObject({ scope: 'bucket', bucket: '100-150', family: 'swing', sub: 'start', side: 'right', count: 3, tagged: 6 });
  });

  test('curve and strike carry a side; low point does not', () => {
    expect(pr(A, why(withBucket('100-150', swingRow(8, 'curve', 'left', 6)))).id).toBe('cause:approach:why:swing:curve:left');
    expect(pr(A, why(withBucket('100-150', swingRow(8, 'strike', 'right', 6)))).id).toBe('cause:approach:why:swing:strike:right');
    const lp = pr(A, why(withBucket('100-150', swingRow(8, 'lowPoint', null, 6))));
    expect(lp.id).toBe('cause:approach:why:swing:lowPoint');
    expect(lp.metricKey).toBe('approach.why.swing.lowPointRate.100-150');
    expect(lp.msg.params).not.toHaveProperty('side');
  });

  test('lie and decision families', () => {
    expect(pr(A, why(withBucket('100-150', familyRow(8, 'lie', 5)))).id).toBe('cause:approach:why:lie');
    expect(pr(A, why(withBucket('100-150', familyRow(8, 'decision', 5)))).id).toBe('cause:approach:why:decision');
  });

  test('below 6 tagged or below 50 % it does not fire', () => {
    expect(pr(A, why(withBucket('100-150', swingRow(5, 'start', 'right', 5))))).toBeNull();
    expect(pr(A, why(withBucket('100-150', swingRow(10, 'start', 'right', 4))))).toBeNull();
  });

  test('forced shots are never a cause; they only dilute the denominator', () => {
    const forced = row({ misses: 10, tagged: 10, families: { forced: 10, lie: 0, decision: 0, swing: 0 } });
    expect(pr(A, why(withBucket('100-150', forced)))).toBeNull();
  });

  test('a split swing family with no dominant sub does not fire', () => {
    const r = swingRow(10, 'start', 'right', 3);
    r.subs.start.left = 3;
    r.subs.lowPoint = 2;
    r.families.swing = 8;
    expect(pr(A, why(withBucket('100-150', r)))).toBeNull();
  });

  test('likely at 70 %, consistent below', () => {
    expect(pr(A, why(withBucket('100-150', swingRow(10, 'start', 'right', 7)))).strength).toBe('likely');
    expect(pr(A, why(withBucket('100-150', swingRow(10, 'start', 'right', 6)))).strength).toBe('consistent');
  });

  test('the leak bucket wins when it has 6 tagged; otherwise the pooled row is read', () => {
    const bucketRow = swingRow(6, 'start', 'left', 6);
    const allRow = swingRow(20, 'lowPoint', null, 15);
    expect(pr(A, why(withBucket('100-150', bucketRow, allRow))).id).toBe('cause:approach:why:swing:start:left');
    const pooled = pr(A, why(withBucket('100-150', swingRow(5, 'start', 'left', 5), allRow)));
    expect(pooled).toMatchObject({
      id: 'cause:approach:why:swing:lowPoint', metricKey: 'approach.why.swing.lowPointRate.all', sample: 20,
    });
    expect(pooled.evidence.scope).toBe('all');
    expect(pooled.msg.params.scope.key).toBe('stats.my.coach.cause.approach.why.scope.all');
    // no bucket on the leak: pooled too
    expect(pr(leak('approach'), why(withBucket('100-150', bucketRow, allRow))).evidence.scope).toBe('all');
  });

  test('outranks the side rule at equal strength, loses to a stronger one', () => {
    const missStats = apprStats('100-150', missRow({ leftRate: 60, directionKnown: 12 }));
    const r = swingRow(10, 'start', 'left', 6);
    const both = { ...missStats, ...why(withBucket('100-150', r)), approachMissCost: { byFinish: {} } };
    const out = causesForLeak(A, both);
    expect(out.primary.id).toBe('cause:approach:why:swing:start:left');
    expect(out.alsoPossible.map((c) => c.id)).toEqual(['cause:approach:side:left']);
    const likelySide = { ...both, approachMissByDistance: { buckets: { '100-150': missRow({ leftRate: 80, directionKnown: 12 }) } } };
    expect(causesForLeak(A, likelySide).primary.id).toBe('cause:approach:side:left');
  });

  test('causes carry a priority: why 0, the others 1', () => {
    const missStats = apprStats('100-150', missRow({ leftRate: 60 }));
    const out = causesForLeak(A, { ...missStats, ...why(withBucket('100-150', swingRow(10, 'start', 'left', 6))) });
    expect(out.primary.priority).toBe(0);
    expect(out.alsoPossible[0].priority).toBe(1);
  });

  test('under whyTagged the approach cause is today\'s', () => {
    const missStats = apprStats('100-150', missRow({ leftRate: 60 }));
    const out = causesForLeak(A, { ...missStats, ...why(withBucket('100-150', swingRow(5, 'start', 'left', 5))), approachMissCost: { byFinish: {} } });
    expect(out.primary.id).toBe('cause:approach:side:left');
  });

  test('tee: swing subs, wind as lie, decision', () => {
    const t = pr(T, why({ tee: swingRow(8, 'curve', 'right', 6) }));
    expect(t).toMatchObject({ id: 'cause:tee:why:swing:curve:right', metricKey: 'tee.why.swing.curve.rightRate', sample: 8 });
    expect(t.msg.key).toBe('stats.my.coach.cause.tee.why.swing.curve');
    expect(t.evidence).toMatchObject({ scope: 'tee', count: 6, tagged: 8 });
    expect(pr(T, why({ tee: swingRow(8, 'lowPoint', null, 6) })).id).toBe('cause:tee:why:swing:lowPoint');
    expect(pr(T, why({ tee: familyRow(8, 'lie', 5) })).id).toBe('cause:tee:why:lie');
    expect(pr(T, why({ tee: familyRow(8, 'decision', 5) })).id).toBe('cause:tee:why:decision');
    expect(pr(T, why({ tee: swingRow(5, 'curve', 'right', 5) }))).toBeNull();
  });

  test('short game: low point, lie, decision', () => {
    const lp = pr(S, why({ short: swingRow(7, 'lowPoint', null, 5) }));
    expect(lp).toMatchObject({ id: 'cause:short:why:swing:lowPoint', metricKey: 'short.why.swing.lowPointRate', strength: 'likely' });
    expect(lp.msg.key).toBe('stats.my.coach.cause.short.why.swing.lowPoint');
    expect(pr(S, why({ short: familyRow(7, 'lie', 4) })).id).toBe('cause:short:why:lie');
    expect(pr(S, why({ short: familyRow(7, 'decision', 4) })).id).toBe('cause:short:why:decision');
    expect(pr(S, why({ short: swingRow(5, 'lowPoint', null, 5) }))).toBeNull();
  });

  test('no missReasons in the stats changes nothing', () => {
    const s = apprStats('100-150', missRow({ leftRate: 60 }));
    expect(primaryId(A, { ...s, approachMissCost: { byFinish: {} } })).toBe('cause:approach:side:left');
  });
});
