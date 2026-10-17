// Coach metric registry (coach v2 spec §3.4). Every number a leak or a cause
// can be verified by has one key here, so a focus verdict re-reads the exact
// number that triggered it. Pure: each reader takes computeMyStats output.
//
// METRICS[key] = { polarity, unit, read(stats) → { value, sample } }
//   polarity  'higher' | 'lower' — which direction is better
//   unit      'sgPerRound' | 'sgPerShot' | 'percent' (0-100) | 'perRound' | 'metres'
//   value     null when the stats carry no sample for it
//   sample    { rounds?, holes?, shots? } — the denominator behind the value

export const SG_CATEGORIES = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];
export const PUTT_BUCKETS = ['0-1', '1-2', '2-3', '3-6', '6+'];
export const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
export const TEE_CLUBS = ['driver', 'wood', 'hybrid', 'iron'];

const num = (v) => (Number.isFinite(v) ? v : null);
// Some engine rates are fractions (0-1); the registry speaks percent.
const pct = (fraction) => (Number.isFinite(fraction) ? Math.round(fraction * 100) : null);

function sgCategory(category) {
  return {
    polarity: 'higher',
    unit: 'sgPerRound',
    read(stats) {
      const sg = stats?.strokesGained;
      const rounds = sg?.roundsByCategory?.[category] ?? 0;
      const holes = sg?.sampleHolesByCategory?.[category] ?? 0;
      // sgSeason reports 0 for a category no round sampled; that is "unknown".
      const value = rounds > 0 ? num(sg?.byCategory?.[category]) : null;
      return { value, sample: { rounds, holes } };
    },
  };
}

function puttBucket(bucket, field, polarity, unit) {
  return {
    polarity,
    unit,
    read(stats) {
      const b = stats?.puttingTarget?.buckets?.[bucket];
      const shots = b?.attempts ?? 0;
      return { value: shots > 0 ? num(b[field]) : null, sample: { shots } };
    },
  };
}

function approachSgBucket(bucket) {
  return {
    polarity: 'higher',
    unit: 'sgPerShot',
    read(stats) {
      const b = stats?.approachTarget?.buckets?.[bucket];
      const shots = b?.holes ?? 0;
      return { value: shots > 0 ? num(b.avgSg) : null, sample: { shots } };
    },
  };
}

// Miss-direction shares are over misses with a known direction; the bunker
// rate is over all misses (approachMissByDistance).
function approachMissBucket(bucket, field, denominator) {
  return {
    polarity: 'lower',
    unit: 'percent',
    read(stats) {
      const b = stats?.approachMissByDistance?.buckets?.[bucket];
      const shots = b?.[denominator] ?? 0;
      return { value: shots > 0 ? num(b[field]) : null, sample: { shots } };
    },
  };
}

function teePenaltyPct(club) {
  return {
    polarity: 'lower',
    unit: 'percent',
    read(stats) {
      const c = stats?.teeClubAccuracy?.byClub?.[club];
      const shots = c?.holes ?? 0;
      return { value: shots > 0 ? num(c.penaltyPct) : null, sample: { shots } };
    },
  };
}

// Share of all missed drives (left + right + short) that went this side.
function teeMissSideShare(side) {
  return {
    polarity: 'lower',
    unit: 'percent',
    read(stats) {
      const b = stats?.driveImpact?.buckets;
      const misses = (b?.left?.holes ?? 0) + (b?.right?.holes ?? 0) + (b?.short?.holes ?? 0);
      const value = misses > 0 ? Math.round(((b?.[side]?.holes ?? 0) / misses) * 100) : null;
      return { value, sample: { shots: misses } };
    },
  };
}

function upDownRate(lie) {
  return {
    polarity: 'higher',
    unit: 'percent',
    read(stats) {
      const u = lie ? stats?.upAndDown?.byLie?.[lie] : stats?.upAndDown;
      const shots = u?.attempts ?? 0;
      return { value: shots > 0 ? pct(u.rate) : null, sample: { shots } };
    },
  };
}

function puttsPer18(field) {
  return {
    polarity: 'lower',
    unit: 'perRound',
    read(stats) {
      const p = stats?.shots?.putts;
      const holes = p?.holes ?? 0;
      return { value: holes > 0 ? num(p[field]) : null, sample: { holes } };
    },
  };
}

function penaltiesPerRound(side) {
  return {
    polarity: 'lower',
    unit: 'perRound',
    read(stats) {
      const rounds = stats?.shots?.roundsWithData ?? 0;
      const count = stats?.shots?.penalties?.[side];
      const value = rounds > 0 && Number.isFinite(count) ? count / rounds : null;
      return { value, sample: { rounds } };
    },
  };
}

// ── Why metrics (miss reasons, spec §5.3 / plan decision 15) ─────────────
// Share of TAGGED misses that carry one reason, read from stats.missReasons
// (missReasons.js rows). sample.shots is the tagged count: the cause gate reads it.
// Scope: approach rows come per bucket and pooled ('all'); tee and short are one row.

const SUB_SIDES = ['left', 'right'];
export const WHY_KINDS = [
  ...['start', 'curve', 'strike'].flatMap((sub) => SUB_SIDES.map((side) => ({
    base: `swing.${sub}.${side}`, family: 'swing', sub, side, count: (row) => row?.subs?.[sub]?.[side] ?? 0,
  }))),
  { base: 'swing.lowPoint', family: 'swing', sub: 'lowPoint', side: null, count: (row) => row?.subs?.lowPoint ?? 0 },
  { base: 'lie', family: 'lie', sub: null, side: null, count: (row) => row?.families?.lie ?? 0 },
  { base: 'decision', family: 'decision', sub: null, side: null, count: (row) => row?.families?.decision ?? 0 },
];
// The short game's swing reason is the low point only.
export const SHORT_WHY_KINDS = WHY_KINDS.filter((k) => !['start', 'curve', 'strike'].includes(k.sub));

// The row a why metric reads: area 'approach' with a bucket or 'all', 'tee', 'short'.
export function whyRow(stats, area, bucket = 'all') {
  const mr = stats?.missReasons;
  if (area === 'approach') return bucket === 'all' ? mr?.approach?.all : mr?.approach?.byBucket?.[bucket];
  return mr?.[area];
}

function whyMetric(area, bucket, kind) {
  return {
    polarity: 'lower',
    unit: 'percent',
    read(stats) {
      const row = whyRow(stats, area, bucket);
      const tagged = row?.tagged ?? 0;
      return { value: tagged > 0 ? Math.round((kind.count(row) / tagged) * 100) : null, sample: { shots: tagged } };
    },
  };
}

export const METRICS = {};

SG_CATEGORIES.forEach((c) => { METRICS[`sg.${c}`] = sgCategory(c); });
PUTT_BUCKETS.forEach((b) => {
  METRICS[`sg.putting.bucket.${b}`] = puttBucket(b, 'sgPerPutt', 'higher', 'sgPerShot');
  METRICS[`putting.threePuttRate.${b}`] = puttBucket(b, 'threePuttRate', 'lower', 'percent');
});
APPROACH_BUCKETS.forEach((b) => {
  METRICS[`sg.approach.bucket.${b}`] = approachSgBucket(b);
  METRICS[`approach.shortRate.${b}`] = approachMissBucket(b, 'shortRate', 'directionKnown');
  METRICS[`approach.leftRate.${b}`] = approachMissBucket(b, 'leftRate', 'directionKnown');
  METRICS[`approach.rightRate.${b}`] = approachMissBucket(b, 'rightRate', 'directionKnown');
  METRICS[`approach.bunkerRate.${b}`] = approachMissBucket(b, 'bunkerRate', 'misses');
});
TEE_CLUBS.forEach((c) => { METRICS[`tee.penaltyPct.${c}`] = teePenaltyPct(c); });

METRICS['tee.troubleRate'] = {
  polarity: 'lower',
  unit: 'percent',
  read(stats) {
    const lies = stats?.driveLies;
    const shots = lies?.drives ?? 0;
    return { value: shots > 0 ? pct(lies.troubleRate) : null, sample: { shots } };
  },
};
METRICS['tee.missSideShare.left'] = teeMissSideShare('left');
METRICS['tee.missSideShare.right'] = teeMissSideShare('right');
METRICS['tee.distance'] = {
  polarity: 'higher',
  unit: 'metres',
  read(stats) {
    const d = stats?.driveDistance;
    const shots = d?.drives ?? 0;
    return { value: shots > 0 ? num(d.avgDistance) : null, sample: { shots } };
  },
};
METRICS['short.upDownRate'] = upDownRate(null);
METRICS['short.upDownRate.sand'] = upDownRate('sand');
METRICS['short.upDownRate.nonSand'] = upDownRate('nonSand');
[...APPROACH_BUCKETS, 'all'].forEach((b) => {
  WHY_KINDS.forEach((k) => { METRICS[`approach.why.${k.base}Rate.${b}`] = whyMetric('approach', b, k); });
});
WHY_KINDS.forEach((k) => { METRICS[`tee.why.${k.base}Rate`] = whyMetric('tee', null, k); });
SHORT_WHY_KINDS.forEach((k) => { METRICS[`short.why.${k.base}Rate`] = whyMetric('short', null, k); });
METRICS['putting.per18'] = puttsPer18('per18');
METRICS['putting.threePuttsPer18'] = puttsPer18('threePuttPer18');
METRICS['penalties.perRound.tee'] = penaltiesPerRound('tee');
METRICS['penalties.perRound.other'] = penaltiesPerRound('other');

// The current value of one metric, or null for a key the registry does not
// know. A known key with no sample reads { value: null, sample }.
export function readMetric(key, stats) {
  const metric = Object.prototype.hasOwnProperty.call(METRICS, key) ? METRICS[key] : null;
  if (!metric) return null;
  return metric.read(stats);
}
