import {
  METRICS, readMetric, SG_CATEGORIES, PUTT_BUCKETS, APPROACH_BUCKETS, TEE_CLUBS,
} from '../coachMetrics';
import { collectMyRounds, computeMyStats } from '../personalStats';

// Hand-built slice of computeMyStats output: only the fields the registry reads.
function fixture() {
  const putt = (attempts, sgPerPutt, threePuttRate) => ({ attempts, sgPerPutt, threePuttRate });
  const appr = (holes, avgSg) => ({ holes, avgSg });
  const miss = (misses, directionKnown, shortRate, leftRate, rightRate, bunkerRate) => ({
    attempts: misses + 5, misses, directionKnown, shortRate, leftRate, rightRate, bunkerRate,
  });
  return {
    strokesGained: {
      byCategory: { offTheTee: -0.4, approach: -1.1, aroundGreen: 0.2, putting: -1.4, penalties: 0 },
      roundsByCategory: { offTheTee: 6, approach: 7, aroundGreen: 5, putting: 8, penalties: 0 },
      sampleHolesByCategory: { offTheTee: 80, approach: 90, aroundGreen: 30, putting: 140, penalties: 0 },
    },
    puttingTarget: {
      buckets: {
        '0-1': putt(20, 0.01, 0), '1-2': putt(24, -0.1, 0), '2-3': putt(18, -0.05, 6),
        '3-6': putt(30, -0.12, 10), '6+': putt(58, -0.3, 31),
      },
    },
    approachTarget: {
      buckets: {
        '0-50': appr(6, 0.1), '50-100': appr(12, 0.08), '100-150': appr(20, -0.2),
        '150-200': appr(14, -0.6), '200+': appr(0, null),
      },
    },
    approachMissByDistance: {
      buckets: {
        '0-50': miss(2, 2, 50, 50, 0, 0), '50-100': miss(4, 3, 33, 33, 33, 25),
        '100-150': miss(10, 10, 70, 10, 20, 30), '150-200': miss(9, 8, 50, 0, 50, 11),
        '200+': miss(0, 0, null, null, null, null),
      },
    },
    teeClubAccuracy: {
      byClub: {
        driver: { holes: 32, penaltyPct: 13 }, wood: { holes: 8, penaltyPct: 0 },
        hybrid: { holes: 0, penaltyPct: null }, iron: { holes: 3, penaltyPct: 33 },
      },
    },
    driveLies: { drives: 32, troubleRate: 0.28125 },
    driveImpact: { buckets: { left: { holes: 11 }, right: { holes: 3 }, short: { holes: 1 } } },
    driveDistance: { drives: 20, avgDistance: 205 },
    upAndDown: {
      attempts: 40,
      rate: 0.45,
      byLie: { sand: { attempts: 14, rate: 0.2857 }, nonSand: { attempts: 26, rate: 0.5192 } },
    },
    shots: {
      roundsWithData: 8,
      putts: { holes: 144, per18: 33.4, threePuttPer18: 3.9 },
      penalties: { tee: 9, other: 3 },
    },
  };
}

// Every key and the value + sample it must read off the fixture.
const EXPECTED = {
  'sg.offTheTee': [-0.4, { rounds: 6, holes: 80 }],
  'sg.approach': [-1.1, { rounds: 7, holes: 90 }],
  'sg.aroundGreen': [0.2, { rounds: 5, holes: 30 }],
  'sg.putting': [-1.4, { rounds: 8, holes: 140 }],
  'sg.penalties': [null, { rounds: 0, holes: 0 }],
  'sg.putting.bucket.0-1': [0.01, { shots: 20 }],
  'sg.putting.bucket.1-2': [-0.1, { shots: 24 }],
  'sg.putting.bucket.2-3': [-0.05, { shots: 18 }],
  'sg.putting.bucket.3-6': [-0.12, { shots: 30 }],
  'sg.putting.bucket.6+': [-0.3, { shots: 58 }],
  'putting.threePuttRate.0-1': [0, { shots: 20 }],
  'putting.threePuttRate.1-2': [0, { shots: 24 }],
  'putting.threePuttRate.2-3': [6, { shots: 18 }],
  'putting.threePuttRate.3-6': [10, { shots: 30 }],
  'putting.threePuttRate.6+': [31, { shots: 58 }],
  'sg.approach.bucket.0-50': [0.1, { shots: 6 }],
  'sg.approach.bucket.50-100': [0.08, { shots: 12 }],
  'sg.approach.bucket.100-150': [-0.2, { shots: 20 }],
  'sg.approach.bucket.150-200': [-0.6, { shots: 14 }],
  'sg.approach.bucket.200+': [null, { shots: 0 }],
  'approach.shortRate.0-50': [50, { shots: 2 }],
  'approach.shortRate.50-100': [33, { shots: 3 }],
  'approach.shortRate.100-150': [70, { shots: 10 }],
  'approach.shortRate.150-200': [50, { shots: 8 }],
  'approach.shortRate.200+': [null, { shots: 0 }],
  'approach.leftRate.0-50': [50, { shots: 2 }],
  'approach.leftRate.50-100': [33, { shots: 3 }],
  'approach.leftRate.100-150': [10, { shots: 10 }],
  'approach.leftRate.150-200': [0, { shots: 8 }],
  'approach.leftRate.200+': [null, { shots: 0 }],
  'approach.rightRate.0-50': [0, { shots: 2 }],
  'approach.rightRate.50-100': [33, { shots: 3 }],
  'approach.rightRate.100-150': [20, { shots: 10 }],
  'approach.rightRate.150-200': [50, { shots: 8 }],
  'approach.rightRate.200+': [null, { shots: 0 }],
  'approach.bunkerRate.0-50': [0, { shots: 2 }],
  'approach.bunkerRate.50-100': [25, { shots: 4 }],
  'approach.bunkerRate.100-150': [30, { shots: 10 }],
  'approach.bunkerRate.150-200': [11, { shots: 9 }],
  'approach.bunkerRate.200+': [null, { shots: 0 }],
  'tee.penaltyPct.driver': [13, { shots: 32 }],
  'tee.penaltyPct.wood': [0, { shots: 8 }],
  'tee.penaltyPct.hybrid': [null, { shots: 0 }],
  'tee.penaltyPct.iron': [33, { shots: 3 }],
  'tee.troubleRate': [28, { shots: 32 }],
  'tee.missSideShare.left': [73, { shots: 15 }],
  'tee.missSideShare.right': [20, { shots: 15 }],
  'tee.distance': [205, { shots: 20 }],
  'short.upDownRate': [45, { shots: 40 }],
  'short.upDownRate.sand': [29, { shots: 14 }],
  'short.upDownRate.nonSand': [52, { shots: 26 }],
  'putting.per18': [33.4, { holes: 144 }],
  'putting.threePuttsPer18': [3.9, { holes: 144 }],
  'penalties.perRound.tee': [9 / 8, { rounds: 8 }],
  'penalties.perRound.other': [3 / 8, { rounds: 8 }],
};

describe('METRICS registry', () => {
  test('the expected table covers exactly the registry keys', () => {
    // the why metrics have their own describe below
    expect(Object.keys(METRICS).filter((k) => !k.includes('.why.')).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test.each(Object.keys(EXPECTED))('%s reads the fixture value and sample', (key) => {
    const [value, sample] = EXPECTED[key];
    expect(readMetric(key, fixture())).toEqual({ value, sample });
  });

  test('every metric declares a polarity and a unit', () => {
    Object.values(METRICS).forEach((m) => {
      expect(['higher', 'lower']).toContain(m.polarity);
      expect(['sgPerRound', 'sgPerShot', 'percent', 'perRound', 'metres']).toContain(m.unit);
    });
  });

  test('polarity: SG and make rates are higher-better, miss rates lower-better', () => {
    expect(METRICS['sg.putting'].polarity).toBe('higher');
    expect(METRICS['sg.approach.bucket.150-200'].polarity).toBe('higher');
    expect(METRICS['short.upDownRate.sand'].polarity).toBe('higher');
    expect(METRICS['putting.threePuttRate.6+'].polarity).toBe('lower');
    expect(METRICS['approach.shortRate.100-150'].polarity).toBe('lower');
    expect(METRICS['tee.troubleRate'].polarity).toBe('lower');
  });

  test('the bucket and category lists match the engine vocabulary', () => {
    expect(SG_CATEGORIES).toEqual(['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties']);
    expect(PUTT_BUCKETS).toEqual(['0-1', '1-2', '2-3', '3-6', '6+']);
    expect(APPROACH_BUCKETS).toEqual(['0-50', '50-100', '100-150', '150-200', '200+']);
    expect(TEE_CLUBS).toEqual(['driver', 'wood', 'hybrid', 'iron']);
  });
});

describe('readMetric', () => {
  test('unknown key → null', () => {
    expect(readMetric('sg.nope', fixture())).toBeNull();
    expect(readMetric('constructor', fixture())).toBeNull();
    expect(readMetric(undefined, fixture())).toBeNull();
  });

  test('known key on empty stats reads no value and a zero sample', () => {
    expect(readMetric('sg.putting', {})).toEqual({ value: null, sample: { rounds: 0, holes: 0 } });
    expect(readMetric('sg.putting.bucket.6+', null)).toEqual({ value: null, sample: { shots: 0 } });
    expect(readMetric('tee.missSideShare.left', {})).toEqual({ value: null, sample: { shots: 0 } });
    expect(readMetric('penalties.perRound.tee', {})).toEqual({ value: null, sample: { rounds: 0 } });
  });

  test('an unsampled SG category reads null, not the 0 sgSeason reports', () => {
    expect(readMetric('sg.penalties', fixture()).value).toBeNull();
  });

  test('SG categories read null while the season gate keeps byCategory null', () => {
    const stats = fixture();
    stats.strokesGained.byCategory = null;
    expect(readMetric('sg.putting', stats)).toEqual({ value: null, sample: { rounds: 8, holes: 140 } });
  });
});

describe('readMetric on real computeMyStats output', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const scores = Object.fromEntries(holes.map((h) => [h.number, 5]));
  const detail = {
    putts: 2, firstPuttBucket: '6+',
    drive: 'left', driveLie: 'rough', driveDistBucket: '210-240', teePenalties: 0,
    approachBucket: '150-200', approachResult: 'miss', approachMiss: 'short',
    sandShots: 0,
  };
  const shotDetails = { p1: Object.fromEntries(holes.map((h) => [h.number, { ...detail }])) };
  const round = () => ({
    courseName: 'Pine', holes, scores: { p1: scores }, shotDetails, playerHandicaps: {}, slope: 113, courseRating: 72,
  });
  const tournaments = [{
    id: 1, name: 'T', players: [{ id: 'p1', handicap: 15, user_id: 'u1' }],
    rounds: [round(), round(), round()],
  }];
  const stats = computeMyStats(collectMyRounds(tournaments, 'u1'), { targetHandicap: 15 });

  test.each([
    ['sg.putting', { rounds: 3, holes: 54 }],
    ['sg.approach', { rounds: 3, holes: 54 }],
    ['sg.offTheTee', { rounds: 3, holes: 54 }],
    ['sg.putting.bucket.6+', { shots: 54 }],
    ['putting.threePuttRate.6+', { shots: 54 }],
    ['sg.approach.bucket.150-200', { shots: 54 }],
    ['approach.shortRate.150-200', { shots: 54 }],
    ['approach.bunkerRate.150-200', { shots: 54 }],
    ['tee.penaltyPct.driver', { shots: 54 }],
    ['tee.troubleRate', { shots: 54 }],
    ['tee.missSideShare.left', { shots: 54 }],
    ['tee.distance', { shots: 54 }],
    ['short.upDownRate', { shots: 54 }],
    ['short.upDownRate.nonSand', { shots: 54 }],
    ['putting.per18', { holes: 54 }],
    ['putting.threePuttsPer18', { holes: 54 }],
    ['penalties.perRound.tee', { rounds: 3 }],
  ])('%s finds its fields', (key, sample) => {
    const m = readMetric(key, stats);
    expect(m.sample).toEqual(sample);
    expect(Number.isFinite(m.value)).toBe(true);
  });

  test('values match the engine fields they read', () => {
    expect(readMetric('approach.shortRate.150-200', stats).value).toBe(100);
    expect(readMetric('tee.missSideShare.left', stats).value).toBe(100);
    expect(readMetric('tee.distance', stats).value).toBe(225);
    expect(readMetric('sg.putting', stats).value).toBeCloseTo(stats.strokesGained.byCategory.putting, 10);
  });
});

describe('why metrics (stats.missReasons)', () => {
  const row = (o = {}) => ({
    misses: 14, tagged: 10, untagged: 4, blocked: 1,
    families: { forced: 1, lie: 2, decision: 1, swing: 6 },
    subs: {
      start: { left: 0, right: 3 }, curve: { left: 1, right: 0 }, strike: { left: 0, right: 0 }, lowPoint: 2,
    },
    ...o,
  });
  const stats = {
    missReasons: {
      approach: { byBucket: { '100-150': row(), '0-50': row({ tagged: 0 }) }, all: row({ tagged: 20, families: { forced: 0, lie: 10, decision: 2, swing: 8 } }) },
      tee: row(),
      short: row({ tagged: 5, families: { forced: 0, lie: 0, decision: 5, swing: 0 } }),
    },
  };

  test.each([
    ['approach.why.swing.start.rightRate.100-150', 30, 10],
    ['approach.why.swing.curve.leftRate.100-150', 10, 10],
    ['approach.why.swing.lowPointRate.100-150', 20, 10],
    ['approach.why.lieRate.100-150', 20, 10],
    ['approach.why.decisionRate.100-150', 10, 10],
    ['approach.why.lieRate.all', 50, 20],
    ['approach.why.decisionRate.all', 10, 20],
    ['tee.why.swing.start.rightRate', 30, 10],
    ['tee.why.swing.strike.leftRate', 0, 10],
    ['tee.why.swing.lowPointRate', 20, 10],
    ['tee.why.lieRate', 20, 10],
    ['tee.why.decisionRate', 10, 10],
    ['short.why.decisionRate', 100, 5],
    ['short.why.swing.lowPointRate', 40, 5],
    ['short.why.lieRate', 0, 5],
  ])('%s is a percent of tagged misses', (key, value, tagged) => {
    expect(readMetric(key, stats)).toEqual({ value, sample: { shots: tagged } });
    expect(METRICS[key]).toMatchObject({ polarity: 'lower', unit: 'percent' });
  });

  test('every bucket and the pooled scope has the approach keys; short has no start/curve/strike', () => {
    [...APPROACH_BUCKETS, 'all'].forEach((b) => {
      ['swing.start.left', 'swing.start.right', 'swing.curve.left', 'swing.curve.right', 'swing.strike.left',
        'swing.strike.right', 'swing.lowPoint', 'lie', 'decision'].forEach((k) => {
        expect(METRICS).toHaveProperty([`approach.why.${k}Rate.${b}`]);
      });
    });
    expect(METRICS).not.toHaveProperty(['short.why.swing.start.leftRate']);
  });

  test('no tagged misses reads null with a zero sample; no stats at all too', () => {
    expect(readMetric('approach.why.lieRate.0-50', stats)).toEqual({ value: null, sample: { shots: 0 } });
    expect(readMetric('tee.why.lieRate', {})).toEqual({ value: null, sample: { shots: 0 } });
  });
});
