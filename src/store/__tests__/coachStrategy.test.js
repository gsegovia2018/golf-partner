import { buildStrategyTips } from '../coachStrategy';

describe('buildStrategyTips', () => {
  test('empty stats produce no tips', () => {
    expect(buildStrategyTips({})).toEqual([]);
    expect(buildStrategyTips(null)).toEqual([]);
  });

  test('lay-up rule fires when long approaches leak and short ones hold', () => {
    const stats = {
      approachTarget: { buckets: {
        '150-200': { holes: 10, avgSg: -0.4 },
        '50-100': { holes: 9, avgSg: 0.0 },
      } },
      strokesGained: { roundsByCategory: { approach: 5 } },
    };
    const tips = buildStrategyTips(stats);
    const tip = tips.find((t) => t.id === 'layup-150-200');
    expect(tip).toBeDefined();
    // (0.0 - (-0.4)) * (10 holes / 5 rounds) = 0.8 pts/round
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.8, 2);
    expect(tip.sample).toBe(19);
  });
  test('lay-up rule suppressed under sample thresholds', () => {
    const stats = {
      approachTarget: { buckets: {
        '150-200': { holes: 7, avgSg: -0.4 },
        '50-100': { holes: 9, avgSg: 0.0 },
      } },
      strokesGained: { roundsByCategory: { approach: 5 } },
    };
    expect(buildStrategyTips(stats).find((t) => t.id === 'layup-150-200')).toBeUndefined();
  });

  test('club-down rule fires on high trouble rate + tee SG leak', () => {
    const stats = {
      driveLies: { drives: 20, byLie: { fairway: 8, rough: 6, sand: 3, trouble: 3 }, troubleRate: 0.3 },
      strokesGained: { byCategory: { offTheTee: -0.6 }, roundsByCategory: {} },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'tee-club-down');
    expect(tip).toBeDefined();
    // |−0.6| × 0.5 = 0.3
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.3, 2);
  });

  test('3-putt rule fires on lag trouble', () => {
    const stats = {
      puttingTarget: { buckets: { '6+': { attempts: 12, sgPerPutt: -0.3, threePuttRate: 33 } } },
      strokesGained: { roundsByCategory: { putting: 6 } },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'lag-first-6plus');
    expect(tip).toBeDefined();
    // 0.3 × 12 / 6 = 0.6
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.6, 2);
  });

  test('trouble-side rule fires on a dominant miss side', () => {
    const stats = {
      roundCount: 5,
      driveImpact: { buckets: {
        left: { holes: 12, avgPoints: 1.2 },
        right: { holes: 3, avgPoints: 1.8 },
        fairway: { holes: 20, avgPoints: 2.1 },
      } },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'tee-miss-side');
    expect(tip).toBeDefined();
    expect(tip.title).toContain('left');
    // (2.1 − 1.2) × (12 / 5) = 2.16
    expect(tip.payoffPointsPerRound).toBeCloseTo(2.16, 2);
  });

  test('bunker rule fires when sand conversion trails non-sand', () => {
    const stats = {
      upAndDown: { byLie: {
        sand: { attempts: 8, conversions: 1, rate: 0.125 },
        nonSand: { attempts: 12, conversions: 6, rate: 0.5 },
      } },
      bunkerVisits: { avgPerRound: 2.4 },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'avoid-short-side-sand');
    expect(tip).toBeDefined();
    // (0.5 − 0.125) × 2.4 = 0.9
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.9, 2);
  });

  test('tips sorted by payoff descending, max 5', () => {
    const stats = {
      roundCount: 5,
      approachTarget: { buckets: { '150-200': { holes: 10, avgSg: -0.4 }, '50-100': { holes: 9, avgSg: 0.0 } } },
      driveLies: { drives: 20, byLie: { fairway: 8, rough: 6, sand: 3, trouble: 3 }, troubleRate: 0.3 },
      puttingTarget: { buckets: { '6+': { attempts: 12, sgPerPutt: -0.3, threePuttRate: 33 } } },
      driveImpact: { buckets: { left: { holes: 12, avgPoints: 1.2 }, right: { holes: 3, avgPoints: 1.8 }, fairway: { holes: 20, avgPoints: 2.1 } } },
      upAndDown: { byLie: { sand: { attempts: 8, conversions: 1, rate: 0.125 }, nonSand: { attempts: 12, conversions: 6, rate: 0.5 } } },
      strokesGained: { byCategory: { offTheTee: -0.6 }, roundsByCategory: { approach: 5, putting: 6 } },
      bunkerVisits: { avgPerRound: 2.4 },
    };
    const tips = buildStrategyTips(stats);
    expect(tips).toHaveLength(5);
    for (let i = 1; i < tips.length; i += 1) {
      expect(tips[i - 1].payoffPointsPerRound).toBeGreaterThanOrEqual(tips[i].payoffPointsPerRound);
    }
  });
});

describe('buildStrategyTips causeId', () => {
  test('each rule tip carries the cause it matches', () => {
    const stats = {
      roundCount: 5,
      approachTarget: { buckets: { '150-200': { holes: 10, avgSg: -0.4 }, '50-100': { holes: 9, avgSg: 0.0 } } },
      driveLies: { drives: 20, byLie: { fairway: 8, rough: 6, sand: 3, trouble: 3 }, troubleRate: 0.3 },
      puttingTarget: { buckets: { '6+': { attempts: 12, sgPerPutt: -0.3, threePuttRate: 33 } } },
      driveImpact: { buckets: { left: { holes: 12, avgPoints: 1.2 }, right: { holes: 3, avgPoints: 1.8 }, fairway: { holes: 20, avgPoints: 2.1 } } },
      upAndDown: { byLie: { sand: { attempts: 8, conversions: 1, rate: 0.125 }, nonSand: { attempts: 12, conversions: 6, rate: 0.5 } } },
      strokesGained: { byCategory: { offTheTee: -0.6 }, roundsByCategory: { approach: 5, putting: 6 } },
      bunkerVisits: { avgPerRound: 2.4 },
    };
    const causeOf = (id) => buildStrategyTips(stats).find((t) => t.id === id)?.causeId;
    expect(causeOf('layup-150-200')).toBe('cause:approach:distance');
    expect(causeOf('tee-club-down')).toBe('cause:tee:trouble:driver');
    expect(causeOf('lag-first-6plus')).toBe('cause:putting:lag');
    expect(causeOf('tee-miss-side')).toBe('cause:tee:side:left');
    expect(causeOf('avoid-short-side-sand')).toBe('cause:short:sand');
  });
  test('the miss-side tip names the right side when the misses go right', () => {
    const stats = {
      roundCount: 5,
      driveImpact: { buckets: { left: { holes: 3, avgPoints: 1.8 }, right: { holes: 12, avgPoints: 1.2 }, fairway: { holes: 20, avgPoints: 2.1 } } },
    };
    expect(buildStrategyTips(stats).find((t) => t.id === 'tee-miss-side').causeId).toBe('cause:tee:side:right');
  });
});

describe('why strategy cards: lie and decision families', () => {
  const row = (over = {}) => ({
    misses: 14, tagged: 10, untagged: 4, blocked: 0,
    families: { forced: 0, lie: 0, decision: 0, swing: 10 },
    subs: { start: { left: 0, right: 0 }, curve: { left: 0, right: 0 }, strike: { left: 0, right: 0 }, lowPoint: 0 },
    lies: {},
    ...over,
  });
  const withRows = (rows, sg = {}) => ({
    missReasons: { approach: { all: row(), byBucket: {} }, tee: row(), short: row(), ...rows },
    strokesGained: { byCategory: { approach: -1, offTheTee: -0.8, aroundGreen: -0.6, ...sg }, roundsByCategory: {} },
  });
  const lieRow = (lies, over = {}) => row({
    families: { forced: 0, lie: 6, decision: 0, swing: 4 }, lies, ...over,
  });
  const tipOf = (stats, id) => buildStrategyTips(stats).find((t) => t.id === id);

  test('below feet: aim left and grip down for a right-hander, mirrored for a left-hander', () => {
    const stats = withRows({ approach: { all: lieRow({ 'below-feet': 4, uphill: 2 }), byBucket: {} } });
    const tip = tipOf(stats, 'why-lie-below-feet');
    expect(tip).toBeDefined();
    expect(tip.causeId).toBe('cause:approach:why:lie');
    expect(tip.titleMsg.key).toBe('stats.my.tip.lie.approach.below-feet.title');
    expect(tip.reasonMsg.params.aim).toMatchObject({ key: 'stats.my.fan.left' });
    expect(tip.reasonMsg.params).toMatchObject({ count: 6, total: 10 });
    const lefty = buildStrategyTips(stats, { handedness: 'left' }).find((t) => t.id === 'why-lie-below-feet');
    expect(lefty.reasonMsg.params.aim).toMatchObject({ key: 'stats.my.fan.right' });
  });
  test('above feet aims right; the other lies carry no direction', () => {
    const above = tipOf(withRows({ approach: { all: lieRow({ 'above-feet': 5 }), byBucket: {} } }), 'why-lie-above-feet');
    expect(above.reasonMsg.params.aim).toMatchObject({ key: 'stats.my.fan.right' });
    ['uphill', 'downhill', 'wind', 'bad-lie'].forEach((lie) => {
      const tip = tipOf(withRows({ approach: { all: lieRow({ [lie]: 5 }), byBucket: {} } }), `why-lie-${lie}`);
      expect(tip.titleMsg.key).toBe(`stats.my.tip.lie.approach.${lie}.title`);
      expect(tip.reasonMsg.params.aim).toBeUndefined();
    });
  });
  test('only the dominant lie gets a card', () => {
    const tips = buildStrategyTips(withRows({ approach: { all: lieRow({ 'below-feet': 2, downhill: 4 }), byBucket: {} } }));
    expect(tips.filter((t) => t.id.startsWith('why-lie')).map((t) => t.id)).toEqual(['why-lie-downhill']);
  });
  test('tee wind and short-game lies have their own cards', () => {
    const stats = withRows({
      tee: lieRow({ wind: 6 }),
      short: lieRow({ 'short-sided': 5, 'bad-lie': 1 }),
    });
    expect(tipOf(stats, 'why-lie-tee-wind').causeId).toBe('cause:tee:why:lie');
    expect(tipOf(stats, 'why-lie-short-short-sided').causeId).toBe('cause:short:why:lie');
  });
  test('decision family: one card per area, middle of the green', () => {
    const dec = (n) => row({ families: { forced: 0, lie: 0, decision: n, swing: 10 - n } });
    const stats = withRows({ approach: { all: dec(6), byBucket: {} }, tee: dec(5) });
    const tip = tipOf(stats, 'why-decision-approach');
    expect(tip.causeId).toBe('cause:approach:why:decision');
    expect(tip.titleMsg.key).toBe('stats.my.tip.decision.approach.title');
    expect(tipOf(stats, 'why-decision-tee').causeId).toBe('cause:tee:why:decision');
    expect(tipOf(stats, 'why-decision-short')).toBeUndefined();
  });
  test('thresholds: 6 tagged, family at 50 %, and a strokes-gained leak', () => {
    const lies = { 'below-feet': 5 };
    const small = withRows({ approach: { all: lieRow(lies, { tagged: 5, families: { forced: 0, lie: 5, decision: 0, swing: 0 } }), byBucket: {} } });
    expect(tipOf(small, 'why-lie-below-feet')).toBeUndefined();
    const under = withRows({ approach: { all: lieRow(lies, { families: { forced: 0, lie: 4, decision: 0, swing: 6 } }), byBucket: {} } });
    expect(tipOf(under, 'why-lie-below-feet')).toBeUndefined();
    const noLeak = withRows({ approach: { all: lieRow(lies), byBucket: {} } }, { approach: 0.2 });
    expect(tipOf(noLeak, 'why-lie-below-feet')).toBeUndefined();
    expect(tipOf(withRows({ approach: { all: lieRow(lies), byBucket: {} } }), 'why-lie-below-feet')).toBeDefined();
  });
  test('payoff is half the category leak times the family share', () => {
    const stats = withRows({ approach: { all: lieRow({ 'below-feet': 6 }), byBucket: {} } });
    const tip = tipOf(stats, 'why-lie-below-feet');
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.3, 2); // 1 * 0.6 * 0.5
    expect(tip.sample).toBe(10);
  });
  test('stats without miss reasons add nothing', () => {
    expect(buildStrategyTips({ strokesGained: { byCategory: { approach: -1 } } })).toEqual([]);
  });
});
