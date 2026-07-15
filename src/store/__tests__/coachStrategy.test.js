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
