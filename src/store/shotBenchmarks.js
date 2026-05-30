// Shot Scope benchmark tables, via Golf Monthly for GIR and MyGolfSpy for putting,
// scoring, and driving. Arccos scoring data is close enough to validate the scoring
// shape, but Shot Scope gives cleaner handicap rows for the fields we can track.
const SHOT_HANDICAP_BENCHMARKS = [
  {
    handicap: 0,
    girPct: 52,
    puttsPerRound: 29.9,
    threePuttsPerRound: 0.8,
    driverDistance: 285,
    fairwayPct: 48,
    leftMissPct: 25,
    rightMissPct: 25,
    teePenaltyPct: 1,
    avgScoreVsPar: 2.01,
    par3AvgScore: 3.2,
    par4AvgScore: 4.2,
    par5AvgScore: 4.8,
    birdiesPerRound: 2.34,
    bogeysPerRound: 3.87,
    doublesOrWorsePerRound: 0.27,
  },
  {
    handicap: 5,
    girPct: 37,
    puttsPerRound: 30.3,
    threePuttsPerRound: 1.5,
    driverDistance: 261,
    fairwayPct: 49,
    leftMissPct: 23,
    rightMissPct: 24,
    teePenaltyPct: 1,
    avgScoreVsPar: 7.98,
    par3AvgScore: 3.4,
    par4AvgScore: 4.5,
    par5AvgScore: 5.3,
    birdiesPerRound: 1.26,
    bogeysPerRound: 6.12,
    doublesOrWorsePerRound: 1.44,
  },
  {
    handicap: 10,
    girPct: 32,
    puttsPerRound: 31.2,
    threePuttsPerRound: 2.4,
    driverDistance: 259,
    fairwayPct: 49,
    leftMissPct: 24,
    rightMissPct: 25,
    teePenaltyPct: 2,
    avgScoreVsPar: 12.96,
    par3AvgScore: 3.7,
    par4AvgScore: 4.8,
    par5AvgScore: 5.6,
    birdiesPerRound: 0.72,
    bogeysPerRound: 7.2,
    doublesOrWorsePerRound: 2.88,
  },
  {
    handicap: 15,
    girPct: 23,
    puttsPerRound: 32.1,
    threePuttsPerRound: 3.8,
    driverDistance: 236,
    fairwayPct: 47,
    leftMissPct: 23,
    rightMissPct: 26,
    teePenaltyPct: 2,
    avgScoreVsPar: 18.41,
    par3AvgScore: 3.9,
    par4AvgScore: 5.1,
    par5AvgScore: 6,
    birdiesPerRound: 0.36,
    bogeysPerRound: 8.1,
    doublesOrWorsePerRound: 4.68,
  },
  {
    handicap: 20,
    girPct: 19,
    puttsPerRound: 33.4,
    threePuttsPerRound: 4.6,
    driverDistance: 225,
    fairwayPct: 46,
    leftMissPct: 25,
    rightMissPct: 25,
    teePenaltyPct: 3,
    avgScoreVsPar: 23.18,
    par3AvgScore: 4,
    par4AvgScore: 5.4,
    par5AvgScore: 6.3,
    birdiesPerRound: 0.36,
    bogeysPerRound: 7.38,
    doublesOrWorsePerRound: 6.66,
  },
  {
    handicap: 25,
    girPct: 15,
    puttsPerRound: 34.3,
    threePuttsPerRound: 5.8,
    driverDistance: 204,
    fairwayPct: 47,
    leftMissPct: 19,
    rightMissPct: 28,
    teePenaltyPct: 3,
    avgScoreVsPar: 29.87,
    par3AvgScore: 4.2,
    par4AvgScore: 5.9,
    par5AvgScore: 7,
    birdiesPerRound: 0.18,
    bogeysPerRound: 6.12,
    doublesOrWorsePerRound: 9.18,
  },
];

const METRIC_KEYS = [
  'girPct',
  'puttsPerRound',
  'threePuttsPerRound',
  'driverDistance',
  'fairwayPct',
  'leftMissPct',
  'rightMissPct',
  'teePenaltyPct',
  'avgScoreVsPar',
  'par3AvgScore',
  'par4AvgScore',
  'par5AvgScore',
  'birdiesPerRound',
  'bogeysPerRound',
  'doublesOrWorsePerRound',
];

function shotBenchmarkForHandicap(handicap) {
  const first = SHOT_HANDICAP_BENCHMARKS[0];
  const last = SHOT_HANDICAP_BENCHMARKS[SHOT_HANDICAP_BENCHMARKS.length - 1];
  const rawHandicap = Number(handicap);
  const clamped = Number.isFinite(rawHandicap)
    ? Math.max(first.handicap, Math.min(last.handicap, rawHandicap))
    : first.handicap;

  const exact = SHOT_HANDICAP_BENCHMARKS.find((row) => row.handicap === clamped);
  if (exact) return addDerivedMetrics({ ...exact });

  const upperIndex = SHOT_HANDICAP_BENCHMARKS.findIndex((row) => row.handicap > clamped);
  const lower = SHOT_HANDICAP_BENCHMARKS[upperIndex - 1];
  const upper = SHOT_HANDICAP_BENCHMARKS[upperIndex];
  const ratio = (clamped - lower.handicap) / (upper.handicap - lower.handicap);

  return addDerivedMetrics(METRIC_KEYS.reduce((bench, key) => ({
    ...bench,
    [key]: round1(lower[key] + ((upper[key] - lower[key]) * ratio)),
  }), { handicap: round1(clamped) }));
}

function shotMetricTone({
  value, target, polarity, tolerance = 0,
}) {
  if (!isNumber(value) || !isNumber(target)) return 'neutral';
  const advantage = polarity === 'lower'
    ? target - value
    : value - target;
  if (Math.abs(advantage) <= tolerance) return 'neutral';
  return advantage > 0 ? 'good' : 'bad';
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function addDerivedMetrics(benchmark) {
  return {
    ...benchmark,
    avgScoreVsPar: round1(benchmark.avgScoreVsPar),
    birdiesPerRound: round1(benchmark.birdiesPerRound),
    bogeysPerRound: round1(benchmark.bogeysPerRound),
    doublesOrWorsePerRound: round1(benchmark.doublesOrWorsePerRound),
    parsPerRound: round1(
      18 - benchmark.birdiesPerRound - benchmark.bogeysPerRound - benchmark.doublesOrWorsePerRound
    ),
  };
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export {
  SHOT_HANDICAP_BENCHMARKS,
  shotBenchmarkForHandicap,
  shotMetricTone,
};
