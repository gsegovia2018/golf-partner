import { buildCoachInsights } from '../coachInsights';

function baseStats(overrides = {}) {
  return {
    metrics: { rounds: 8, avgPoints: 31, bestRoundPoints: 38, avgVsPar: 18 },
    form: {
      hasHistory: true,
      metrics: [
        { key: 'avgPoints', label: 'Points / round', polarity: 'higher', recent: 32, history: 29, delta: 3, direction: 'up' },
        { key: 'girPct', label: 'Greens in reg %', polarity: 'higher', recent: 34, history: 45, delta: -11, direction: 'down', shot: true },
        { key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', recent: 34, history: 36, delta: -2, direction: 'up', shot: true },
      ],
    },
    ranking: {
      baseline: 1.72,
      strengths: [
        { label: 'Tee shot on the fairway', avgPoints: 2.45, deviation: 0.73, sample: 22, unit: 'holes' },
      ],
      weaknesses: [
        { label: 'Closing 3 holes', avgPoints: 1.1, deviation: -0.62, sample: 24, unit: 'holes' },
      ],
    },
    actionPlan: {
      keep: { area: 'Driving', label: 'Fairway drives', score: 0.64, sample: 22, unit: 'pts / hole', value: 2.45 },
      improve: { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
      practice: { area: 'Approach', label: '100-150 m approaches', score: -0.36, sample: 14, unit: 'SG / shot', value: -0.36 },
      strengths: [
        { area: 'Driving', label: 'Fairway drives', score: 0.64, sample: 22, unit: 'pts / hole', value: 2.45 },
      ],
      improvements: [
        { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
        { area: 'Approach', label: '100-150 m approaches', score: -0.36, sample: 14, unit: 'SG / shot', value: -0.36 },
      ],
    },
    strokesGained: {
      total: -1.25,
      sampleHoles: 54,
      byCategory: { approach: -0.35, aroundGreen: -0.1, putting: -1.2 },
    },
    warmupClosing: {
      warmup: { avgPoints: 2.1, holes: 24 },
      closing: { avgPoints: 1.1, holes: 24 },
    },
    frontBack: { frontAvg: 16.4, backAvg: 14.2, rounds: [{}, {}, {}] },
    shotBenchmark: {
      handicap: 10,
      avgScoreVsPar: 13,
      doublesOrWorsePerRound: 2.9,
      fairwayPct: 49,
      teePenaltyPct: 2,
      girPct: 32,
      puttsPerRound: 31.2,
      threePuttsPerRound: 2.4,
    },
    distribution: {
      eagles: 0, birdies: 2, pars: 8, bogeys: 6, doubles: 1, worse: 1, total: 18,
    },
    shots: {
      hasData: true,
      roundsWithData: 1,
      drives: { recorded: 18, fairwayPct: 34, distribution: { left: 7, right: 3 } },
      penalties: { tee: 3, total: 3 },
      gir: { eligible: 18, pct: 22 },
      putts: { holes: 18, perRound: 35, threePuttPlus: 5 },
    },
    ...overrides,
  };
}

describe('buildCoachInsights', () => {
  test('chooses a high-confidence point leak as the hero when one exists', () => {
    const coach = buildCoachInsights(baseStats());
    expect(coach.hero).toMatchObject({ group: 'fixFirst', area: 'putting', title: '6+ m putts', tone: 'bad', confidence: 'high' });
    expect(coach.hero.reason).toContain('costing');
  });

  test('can choose an improving trend when there is no strong leak', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: { keep: null, improve: null, practice: null, strengths: [], improvements: [] },
      strokesGained: { total: 0.2, sampleHoles: 54, byCategory: { approach: 0.1, aroundGreen: 0, putting: 0 } },
      shotBenchmark: null,
    }));
    expect(coach.hero).toMatchObject({ group: 'gettingBetter', title: 'Points / round', tone: 'good' });
  });

  test('builds all supported board groups from available stats', () => {
    const coach = buildCoachInsights(baseStats());
    expect(coach.board.fixFirst).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '6+ m putts' }),
    ]));
    expect(coach.board.keepDoing).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Fairway drives' }),
    ]));
    expect(coach.board.gettingBetter.map((i) => i.title)).toContain('Points / round');
    expect(coach.board.gettingWorse.map((i) => i.title)).not.toContain('Greens in reg %');
    expect(coach.board.fixFirst.map((i) => i.title)).toEqual(expect.arrayContaining(['Putting', 'Approach']));
    expect(coach.board.nextGains.map((i) => i.title)).toContain('100-150 m approaches');
    expect(coach.board.watch.map((i) => i.title)).toContain('Closing 3 holes');
  });

  test('adds comparison basis labels to coach insights', () => {
    const coach = buildCoachInsights(baseStats());
    const all = Object.values(coach.board).flat();

    expect(all.length).toBeGreaterThan(0);
    all.forEach((insight) => {
      expect(insight.basis).toMatch(/vs target hcp|vs your avg|recent vs previous|opening vs closing|front vs back/);
    });
  });

  test('adds strokes-gained category signals without raw target benchmarks', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: { keep: null, improve: null, practice: null, strengths: [], improvements: [] },
      ranking: { baseline: null, strengths: [], weaknesses: [] },
      form: {
        hasHistory: true,
        metrics: [
          { key: 'avgPoints', label: 'Points / round', polarity: 'higher', recent: 32, history: 29, delta: 3, direction: 'up' },
          { key: 'fairwayPct', label: 'Fairways hit %', polarity: 'higher', recent: 42, history: 50, delta: -8, direction: 'down', shot: true },
          { key: 'girPct', label: 'Greens in reg %', polarity: 'higher', recent: 34, history: 45, delta: -11, direction: 'down', shot: true },
          { key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', recent: 34, history: 36, delta: -2, direction: 'up', shot: true },
          { key: 'threePuttsPerRound', label: '3-putts / round', polarity: 'lower', recent: 2.4, history: 1.6, delta: 0.8, direction: 'down', shot: true },
        ],
      },
    }));
    const all = Object.values(coach.board).flat();
    const titles = all.map((insight) => insight.title);

    expect(coach.board.fixFirst).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Putting', area: 'putting', tone: 'bad' }),
      expect.objectContaining({ title: 'Approach', area: 'approach', tone: 'bad' }),
    ]));
    expect(titles).not.toContain('Tee shot');
    expect(titles).toContain('Points / round');
    expect(titles).not.toEqual(expect.arrayContaining([
      'Score vs par',
      'Doubles+ / round',
      'Fairways hit',
      'Tee penalty rate',
      'Greens in reg %',
      'Putts / round',
      '3-putts / round',
    ]));
    all.forEach((insight) => {
      expect(insight.metric).toMatch(/SG|pts/);
    });
  });

  test('maps form metric keys and action labels to coach areas', () => {
    const coach = buildCoachInsights(baseStats({
      form: {
        hasHistory: true,
        metrics: [
          { key: 'fairwayPct', label: 'Fairways hit %', polarity: 'higher', recent: 42, history: 50, delta: -8, direction: 'down', shot: true },
          { key: 'girPct', label: 'Greens in reg %', polarity: 'higher', recent: 34, history: 45, delta: -11, direction: 'down', shot: true },
          { key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', recent: 34, history: 36, delta: -2, direction: 'up', shot: true },
          { key: 'threePuttsPerRound', label: '3-putts / round', polarity: 'lower', recent: 2.4, history: 1.6, delta: 0.8, direction: 'down', shot: true },
        ],
      },
      actionPlan: {
        keep: null,
        improve: null,
        practice: null,
        strengths: [
          { area: 'Off the tee', label: 'Fairway drive points', score: 0.3, sample: 18, unit: 'pts / hole', value: 2.1 },
          { area: 'Off the tee', label: 'Stale tee SG', score: 0.3, sample: 18, unit: 'SG / shot', value: 0.3 },
          { area: 'Around the green', label: 'Up-and-down chances', score: 0.2, sample: 16, unit: 'SG / shot', value: 0.2 },
        ],
        improvements: [],
      },
    }));
    expect(coach.board.gettingWorse.map((i) => i.title)).not.toEqual(expect.arrayContaining([
      'Fairways hit %',
      'Greens in reg %',
      '3-putts / round',
    ]));
    expect(coach.board.gettingBetter.map((i) => i.title)).not.toContain('Putts / round');
    expect(coach.board.keepDoing.map((i) => i.title)).not.toContain('Stale tee SG');
    expect(coach.board.keepDoing).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Fairway drive points', area: 'driving', areaLabel: 'Driving' }),
      expect.objectContaining({ title: 'Up-and-down chances', area: 'shortGame', areaLabel: 'Short game' }),
    ]));
  });

  test('deduplicates near-identical insights by area and title', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        ...baseStats().actionPlan,
        improvements: [
          { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
          { area: 'Putting', label: '6+ m putts', score: -0.7, sample: 20, unit: 'SG / putt', value: -0.7 },
        ],
      },
    }));
    const all = Object.values(coach.board).flat();
    expect(all.filter((i) => i.id === 'putting:6-m-putts')).toHaveLength(1);
  });

  test('sends low-sample leaks to Watch instead of Fix first', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: { area: 'Putting', label: '6+ m putts', score: -0.91, sample: 2, unit: 'SG / putt', value: -0.91 },
        practice: null,
        strengths: [],
        improvements: [
          { area: 'Putting', label: '6+ m putts', score: -0.91, sample: 2, unit: 'SG / putt', value: -0.91 },
        ],
      },
    }));
    expect(coach.board.fixFirst.map((insight) => insight.title)).not.toContain('6+ m putts');
    expect(coach.board.watch).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '6+ m putts', confidence: 'low' }),
    ]));
  });

  test('prioritizes higher-confidence fix-first insights before noisier gaps', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: null,
        practice: null,
        strengths: [],
        improvements: [
          { area: 'Putting', label: '6+ m putts', score: -0.9, sample: 6, unit: 'SG / putt', value: -0.9 },
          { area: 'Approach', label: '100-150 m approaches', score: -0.7, sample: 18, unit: 'SG / shot', value: -0.7 },
        ],
      },
      strokesGained: null,
      ranking: { baseline: null, strengths: [], weaknesses: [] },
      form: { hasHistory: false, metrics: [] },
      warmupClosing: null,
      frontBack: null,
    }));

    expect(coach.board.fixFirst.map((i) => i.title).slice(0, 2)).toEqual([
      '100-150 m approaches',
      '6+ m putts',
    ]);
  });

  test('routes standalone weak improve leaks to Next gains', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: { area: 'Putting', label: 'Lag putt distance control', score: -0.3, sample: 18, unit: 'SG / putt', value: -0.3 },
        practice: null,
        strengths: [],
        improvements: [],
      },
    }));
    expect(coach.board.fixFirst.map((i) => i.title)).not.toContain('Lag putt distance control');
    expect(coach.board.nextGains).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Lag putt distance control', area: 'putting', confidence: 'high' }),
    ]));
  });

  test('maps Strokes Gained action items from their label area', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: null,
        practice: null,
        strengths: [],
        improvements: [
          { area: 'Strokes Gained', label: 'Putting', score: -0.7, sample: 18, unit: 'SG / round', value: -0.7 },
        ],
      },
    }));
    expect(coach.board.fixFirst).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Putting', area: 'putting', areaLabel: 'Putting' }),
    ]));
  });

  test('uses explicit sample units in Strokes Gained reasons', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: null,
        practice: null,
        strengths: [],
        improvements: [
          { area: 'Strokes Gained', label: 'Approach', score: -0.7, sample: 54, sampleUnit: 'holes', unit: 'SG / round', value: -0.7 },
        ],
      },
    }));

    const insight = coach.board.fixFirst.find((item) => item.title === 'Approach');
    expect(insight.reason).toContain('across 54 holes');
    expect(insight.reason).not.toContain('shots');
  });

  test('uses Strokes Gained category-specific samples in category insights', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: { keep: null, improve: null, practice: null, strengths: [], improvements: [] },
      strokesGained: {
        total: -0.4,
        sampleHoles: 54,
        sampleHolesByCategory: { approach: 18, putting: 54 },
        byCategory: { approach: -0.7, putting: 0 },
      },
    }));

    const insight = coach.board.fixFirst.find((item) => item.title === 'Approach');
    expect(insight.reason).toContain('across 18 holes');
  });

  test('uses neutral reason copy when action item sample is missing', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: { area: 'Putting', label: 'Lag putt distance control', score: -0.8, unit: 'SG / putt', value: -0.8 },
        practice: null,
        strengths: [],
        improvements: [],
      },
    }));
    const insight = coach.board.fixFirst.find((item) => item.title === 'Lag putt distance control');
    expect(insight.reason).toContain('in the tracked sample');
    expect(insight.reason).not.toContain('0 tracked reps');
  });

  test('sends low-sample practice leaks to Watch instead of Next gains', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: null,
        practice: { area: 'Approach', label: '100-150 m approaches', score: -0.5, sample: 2, unit: 'SG / shot', value: -0.5 },
        strengths: [],
        improvements: [],
      },
    }));
    expect(coach.board.nextGains.map((i) => i.title)).not.toContain('100-150 m approaches');
    expect(coach.board.watch).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '100-150 m approaches', confidence: 'low' }),
    ]));
  });

  test('creates a three-item practice plan with distinct roles', () => {
    const coach = buildCoachInsights(baseStats());
    expect(coach.practicePlan.map((item) => item.role)).toEqual(['practiceFirst', 'secondaryFocus', 'onCourseCue']);
    expect(coach.practicePlan[0].title).toContain('6+ m putts');
    expect(coach.practicePlan[1].title).toContain('100-150 m approaches');
    expect(coach.practicePlan[2].title).toContain('Closing 3 holes');
  });

  test('uses a different-area Keep doing insight as secondary focus when available', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: { area: 'Driving', label: 'Fairway drives', score: 0.64, sample: 22, unit: 'pts / hole', value: 2.45 },
        improve: { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
        practice: null,
        strengths: [
          { area: 'Driving', label: 'Fairway drives', score: 0.64, sample: 22, unit: 'pts / hole', value: 2.45 },
        ],
        improvements: [
          { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
        ],
      },
      form: { hasHistory: false, metrics: [] },
      ranking: { baseline: null, strengths: [], weaknesses: [] },
      warmupClosing: null,
      frontBack: null,
    }));
    expect(coach.practicePlan[0]).toMatchObject({ role: 'practiceFirst', sourceInsightId: 'putting:6-m-putts' });
    expect(coach.practicePlan[1]).toMatchObject({ role: 'secondaryFocus', sourceInsightId: 'driving:fairway-drives' });
  });

  test('falls back to form and data-collection guidance without shot data', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: { keep: null, improve: null, practice: null, strengths: [], improvements: [] },
      ranking: { baseline: null, strengths: [], weaknesses: [] },
      strokesGained: null,
      warmupClosing: null,
      frontBack: null,
      shotBenchmark: null,
      shots: null,
    }));
    expect(coach.hero).toMatchObject({ group: 'gettingBetter' });
    expect(coach.practicePlan).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'onCourseCue' }),
    ]));
  });
});
