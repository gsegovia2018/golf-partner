// Shared fixtures for the Coach v2 component tests. Everything the cards show
// goes through the real stores (buildCoachWeek and the plan, swing link and
// check builders under it); only the diagnosis and the cause descriptors are
// written by hand, the shape coachDiagnosis / coachCauses return.
import { msg, n, lower } from '../../../store/statsMsg';
import { buildCoachWeek } from '../../../store/coachWeek';

export const TODAY = '2026-10-16';
const CATEGORIES = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];

export function mkLeak(category, bucket, strokesPerRound, over = {}) {
  return {
    id: bucket ? `leak:${category}:${bucket}` : `leak:${category}`,
    category,
    bucket,
    strokesPerRound,
    se: 0.3,
    sample: { rounds: 12, holes: 216 },
    confidence: 'high',
    needs: null,
    metricKey: `sg.${category}`,
    children: bucket
      ? [{ bucket, strokesPerRound, perShot: -0.1, se: 0.2, sample: { shots: 58 }, confidence: 'high', metricKey: `sg.${category}.bucket.${bucket}`, evidence: {} }]
      : [],
    evidence: {},
    benchmark: { targetHandicap: 15 },
    ...over,
  };
}

export function mkDiagnosis({ leaks = [], tie = null, candidate = null, insufficient = [], strong = {} } = {}) {
  const byCategory = new Map(leaks.map((l) => [l.category, l]));
  insufficient.forEach((l) => byCategory.set(l.category, l));
  const categories = CATEGORIES.map((c) => byCategory.get(c) ?? mkLeak(c, null, strong[c] ?? 0.4, { confidence: 'medium' }));
  return {
    leaks, top: leaks[0] ?? null, tie, candidate, insufficient, categories, targetHandicap: 15,
  };
}

// ── Causes (descriptors the way coachCauses builds them) ──────────────────
const lead = (strength) => msg(`stats.my.coach.cause.lead.${strength}`);

export const lagCause = {
  id: 'cause:putting:lag',
  leakId: 'leak:putting:6+',
  strength: 'likely',
  lead: lead('likely'),
  metricKey: 'putting.threePuttRate.6+',
  evidence: {
    bucket: '6+', attempts: 58, threePuttRate: 31, threePutts: 18, avgPutts: 2.5, sgPerPutt: -0.3,
  },
  benchmark: { source: 'target', targetHandicap: 15, expectedPutts: 2.2 },
  sample: 58,
  msg: msg('stats.my.coach.cause.putting.lag.bench', {
    bucket: '6+', avgPutts: n(2.5), pct: 31, count: 18, total: 58, expected: n(2.2), hcp: n(15),
  }),
};
export const shortPuttCause = {
  id: 'cause:putting:short',
  leakId: 'leak:putting:6+',
  strength: 'possible',
  lead: lead('possible'),
  metricKey: 'sg.putting.bucket.1-2',
  evidence: {
    bucket: '1-2', attempts: 24, sgPerPutt: -0.1, avgPutts: 1.3,
  },
  benchmark: null,
  sample: 24,
  msg: msg('stats.my.coach.cause.putting.short', { bucket: '1-2', avgPutts: n(1.3), total: 24 }),
};
export const approachShortCause = {
  id: 'cause:approach:short',
  leakId: 'leak:approach:100-150',
  strength: 'likely',
  lead: lead('likely'),
  metricKey: 'approach.shortRate.100-150',
  evidence: {
    bucket: '100-150', misses: 31, directionKnown: 31, shortRate: 71, shortCount: 22, missRate: 64,
  },
  benchmark: null,
  sample: 22,
  msg: msg('stats.my.coach.cause.approach.short', { bucket: '100-150', missPct: 64, pct: 71, count: 22, total: 31 }),
};
export const teeLeftCause = {
  id: 'cause:tee:side:left',
  leakId: 'leak:offTheTee',
  strength: 'likely',
  lead: lead('likely'),
  metricKey: 'tee.missSideShare.left',
  evidence: {
    side: 'left', count: 11, other: 3, misses: 15, drives: 32, sidePct: 34, share: 73, costPts: null,
  },
  benchmark: { source: 'target', targetHandicap: 15, sidePct: 23 },
  sample: 15,
  msg: msg('stats.my.coach.cause.tee.side.bench', {
    side: lower(msg('stats.my.fan.left')), count: 11, misses: 15, pct: 34, benchPct: 23, hcp: n(15),
  }),
};
export const approachDistanceCause = {
  id: 'cause:approach:distance',
  leakId: 'leak:approach:150-200',
  strength: 'likely',
  lead: lead('likely'),
  metricKey: 'sg.approach.bucket.150-200',
  evidence: {
    bucket: '150-200', perShot: -0.6, shots: 31, bestBucket: null, bestPerShot: null,
  },
  benchmark: null,
  sample: 31,
  msg: msg('stats.my.coach.cause.approach.distance', { bucket: '150-200', cost: n(0.6), shots: 31 }),
};

export const tips = {
  lag: {
    id: 'lag-first-6plus',
    causeId: 'cause:putting:lag',
    titleMsg: msg('stats.my.tip.lagFirst.title'),
    reasonMsg: msg('stats.my.tip.lagFirst.reason', { pct: 31 }),
    payoffPointsPerRound: 0.7,
    sample: 58,
    basisMsg: msg('stats.my.tip.lagFirst.basis'),
  },
  clubDown: {
    id: 'tee-club-down',
    causeId: 'cause:tee:trouble:driver',
    titleMsg: msg('stats.my.tip.clubDown.title'),
    reasonMsg: msg('stats.my.tip.clubDown.reason', { pct: 28, sg: n(-0.8) }),
    payoffPointsPerRound: 0.5,
    sample: 32,
    basisMsg: msg('stats.my.tip.clubDown.basis'),
  },
};

// ── Stats ─────────────────────────────────────────────────────────────────
export function mkStats(diagnosis, over = {}) {
  const { board: boardOver, ...rest } = over;
  const board = boardOver ?? {
    fixFirst: diagnosis.top ? [{ id: diagnosis.top.id, group: 'fixFirst', category: diagnosis.top.category }] : [],
    keepDoing: [],
    gettingBetter: [],
    gettingWorse: [],
    nextGains: [],
    watch: [],
  };
  return {
    roundCount: 12,
    targetHandicap: 15,
    metrics: { avgPoints: 30, avgDifferential: 16.4 },
    form: { metrics: [], hasHistory: false },
    formSeries: { metrics: { avgPoints: [], avgDifferential: [] } },
    coach: { hero: null, board },
    coachDiagnosis: diagnosis,
    coachStrategy: [],
    puttingTarget: { buckets: { '6+': { attempts: 58, threePuttRate: 31, sgPerPutt: -0.2 } } },
    approachMissByDistance: { buckets: { '100-150': { misses: 31, directionKnown: 31, shortRate: 71 } } },
    driveImpact: { buckets: { left: { holes: 11 }, right: { holes: 3 }, short: { holes: 1 } } },
    ...rest,
  };
}

export const leaksWith = (leak, causes) => ({ ...leak, causes });

// putting 6+ m, high confidence, lag cause (state 3)
export function onePutting() {
  const top = leaksWith(mkLeak('putting', '6+', -1.4), { primary: lagCause, alsoPossible: [shortPuttCause] });
  const second = mkLeak('approach', '150-200', -0.7, { confidence: 'medium' });
  const diagnosis = mkDiagnosis({ leaks: [top, second], strong: { offTheTee: 0.5 } });
  return mkStats(diagnosis, {
    coachStrategy: [tips.lag],
    board: {
      fixFirst: [{ id: top.id, group: 'fixFirst', category: 'putting' }],
      keepDoing: [{
        id: 'strength:offTheTee', group: 'keepDoing', area: 'offTheTee', title: 'Off the tee', reason: 'Off the tee gains strokes.', metric: '+0.5', tone: 'good',
      }],
      gettingBetter: [], gettingWorse: [],
      nextGains: [{
        id: second.id, group: 'nextGain', category: 'approach', area: 'approach', title: 'Approach', reason: 'Approach costs strokes.', metric: '-0.7', tone: 'bad',
      }],
      watch: [],
    },
  });
}

// approach 100-150 m coming up short (the focus state)
export function approachShort() {
  const top = leaksWith(mkLeak('approach', '100-150', -1.1), { primary: approachShortCause, alsoPossible: [] });
  const diagnosis = mkDiagnosis({ leaks: [top, mkLeak('putting', '6+', -0.6, { confidence: 'medium' })] });
  return mkStats(diagnosis);
}

// approach 150-200 vs off the tee: two leaks too close to call
export function tieStats() {
  const a = leaksWith(mkLeak('approach', '150-200', -0.9, { confidence: 'medium' }), { primary: approachDistanceCause, alsoPossible: [] });
  const b = leaksWith(mkLeak('offTheTee', null, -0.8, { confidence: 'medium' }), { primary: teeLeftCause, alsoPossible: [] });
  const diagnosis = mkDiagnosis({ leaks: [a, b], tie: b });
  return mkStats(diagnosis, { coachStrategy: [tips.clubDown] });
}

// off the tee, the left miss: the swing-link state fixtures
export function teeLeft() {
  const top = leaksWith(mkLeak('offTheTee', null, -1.2), { primary: teeLeftCause, alsoPossible: [] });
  return mkStats(mkDiagnosis({ leaks: [top] }));
}

export function fewRounds() {
  const insufficient = [
    mkLeak('putting', null, -1.1, { confidence: 'insufficient', needs: { holes: 0, rounds: 1 }, sample: { rounds: 2, holes: 36 } }),
    mkLeak('approach', null, -0.8, { confidence: 'insufficient', needs: { holes: 4, rounds: 1 }, sample: { rounds: 2, holes: 6 } }),
  ];
  return mkStats(mkDiagnosis({ insufficient }), { roundCount: 2 });
}

export function noDetail() {
  const categories = CATEGORIES.map((c) => mkLeak(c, null, 0, { confidence: 'insufficient', sample: { rounds: 0, holes: 0 } }));
  return mkStats({
    leaks: [], top: null, tie: null, candidate: null, insufficient: [], categories, targetHandicap: 15,
  }, { roundCount: 6 });
}

export const driverSwing = (over = {}) => ({
  id: 'sw-driver', status: 'ready', createdAt: '2026-10-04T10:00:00.000Z', club: 'driver', mainFault: 'over_the_top', consequences: [], handedness: 'right', ...over,
});

export const focusRecord = (over = {}) => ({
  v: 2,
  leakId: 'leak:approach:100-150',
  category: 'approach',
  bucket: '100-150',
  causeId: 'cause:approach:short',
  metricKey: 'approach.shortRate.100-150',
  baselineValue: 71,
  baselineSample: { shots: 31 },
  baselineSe: 4,
  minChange: 10,
  baselineVersion: 2,
  committedAt: '2026-10-02T09:00:00.000Z',
  roundCountAtCommit: 9,
  ...over,
});

export const verdictOf = (over = {}) => ({
  state: 'improving',
  early: true,
  roundsSince: 3,
  level: 2,
  metricKey: 'approach.shortRate.100-150',
  unit: 'percent',
  polarity: 'lower',
  baseline: 71,
  current: 48,
  currentSample: { shots: 31 },
  delta: 23,
  threshold: 10,
  ...over,
});

export function week(stats, opts = {}) {
  return buildCoachWeek({
    stats,
    focus: null,
    verdict: null,
    swings: [],
    profile: { handedness: 'right' },
    minutesPerWeek: 60,
    today: TODAY,
    ...opts,
  });
}
