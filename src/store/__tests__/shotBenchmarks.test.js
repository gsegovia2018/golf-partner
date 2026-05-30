import {
  shotBenchmarkForHandicap,
  shotMetricTone,
} from '../shotBenchmarks';

describe('shot handicap benchmarks', () => {
  test('interpolates shot metric targets from handicap benchmark tables', () => {
    expect(shotBenchmarkForHandicap(10)).toEqual(expect.objectContaining({
      handicap: 10,
      girPct: 32,
      puttsPerRound: 31.2,
      threePuttsPerRound: 2.4,
      driverDistance: 259,
      fairwayPct: 49,
      leftMissPct: 24,
      rightMissPct: 25,
      teePenaltyPct: 2,
      avgScoreVsPar: 13,
      birdiesPerRound: 0.7,
      parsPerRound: 7.2,
      bogeysPerRound: 7.2,
      doublesOrWorsePerRound: 2.9,
      par3AvgScore: 3.7,
      par4AvgScore: 4.8,
      par5AvgScore: 5.6,
    }));

    expect(shotBenchmarkForHandicap(12.5)).toEqual(expect.objectContaining({
      handicap: 12.5,
      girPct: 27.5,
      puttsPerRound: 31.7,
      threePuttsPerRound: 3.1,
      fairwayPct: 48,
      avgScoreVsPar: 15.7,
      parsPerRound: 6,
    }));
  });

  test('grades metrics against the target handicap with a neutral band', () => {
    const benchmark = shotBenchmarkForHandicap(15);

    expect(shotMetricTone({ value: 26, target: benchmark.girPct, polarity: 'higher', tolerance: 2 })).toBe('good');
    expect(shotMetricTone({ value: 23, target: benchmark.girPct, polarity: 'higher', tolerance: 2 })).toBe('neutral');
    expect(shotMetricTone({ value: 20, target: benchmark.girPct, polarity: 'higher', tolerance: 2 })).toBe('bad');

    expect(shotMetricTone({ value: 31.4, target: benchmark.puttsPerRound, polarity: 'lower', tolerance: 0.5 })).toBe('good');
    expect(shotMetricTone({ value: 32.4, target: benchmark.puttsPerRound, polarity: 'lower', tolerance: 0.5 })).toBe('neutral');
    expect(shotMetricTone({ value: 33, target: benchmark.puttsPerRound, polarity: 'lower', tolerance: 0.5 })).toBe('bad');
  });
});
