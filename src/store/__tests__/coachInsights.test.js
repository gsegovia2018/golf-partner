import { buildCoachInsights } from '../coachInsights';
import { buildDiagnosis } from '../coachDiagnosis';

const CATS = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];

// A strokesGained block the diagnosis accepts: one entry per round, every
// category sampled over 18 holes unless `sampled` says otherwise.
function sg(rounds, sampled = {}) {
  return {
    perRound: rounds.map((byCategory) => ({
      byCategory: Object.fromEntries(CATS.map((c) => [c, byCategory[c] ?? 0])),
      sampleHolesByCategory: Object.fromEntries(CATS.map((c) => [c, sampled[c] ?? 18])),
    })),
  };
}
const flat = (board) => Object.values(board).flat();


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
    strokesGained: sg([
      { putting: -1.0, approach: -0.5, aroundGreen: 0.3 },
      { putting: -1.4, approach: -0.5, aroundGreen: 0.3 },
      { putting: -1.2, approach: -0.4, aroundGreen: 0.3 },
      { putting: -1.2, approach: -0.6, aroundGreen: 0.3 },
    ]),
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

describe('buildCoachInsights (adapter over the diagnosis)', () => {
  test('hero is the diagnosis top leak and its id is the leak id', () => {
    const stats = baseStats();
    const { hero } = buildCoachInsights(stats);
    const { top } = buildDiagnosis(stats);

    expect(top.id).toBe('leak:putting');
    expect(hero).toMatchObject({
      id: top.id, group: 'fixFirst', area: 'putting', title: 'Putting', tone: 'bad', confidence: 'high', category: 'putting',
    });
    expect(hero.reason).toContain('costing 1.2 SG / round');
    expect(hero.reasonMsg).toMatchObject({ key: 'stats.my.coach.reason.sgCosting' });
    expect(hero.strokesPerRound).toBeCloseTo(-1.2, 2);
    expect(hero.pointsPerRound).toBeCloseTo(-1.2, 2);
  });

  test('has no practicePlan any more', () => {
    expect(buildCoachInsights(baseStats())).not.toHaveProperty('practicePlan');
    expect(buildCoachInsights({})).not.toHaveProperty('practicePlan');
  });

  test('board groups come from the leaks: top -> fixFirst, rest -> nextGains, positives -> keepDoing', () => {
    const { board } = buildCoachInsights(baseStats());

    expect(board.fixFirst.map((i) => i.id)).toEqual(['leak:putting']);
    expect(board.nextGains.map((i) => i.id)).toEqual(['leak:approach']);
    expect(board.keepDoing.map((i) => i.id)).toEqual(['strength:aroundGreen']);
    expect(board.keepDoing[0]).toMatchObject({ tone: 'good', area: 'shortGame', areaLabel: 'Short game' });
    expect(board.gettingBetter.map((i) => i.title)).toContain('Points / round');
    expect(board.gettingWorse.map((i) => i.title)).not.toContain('Greens in reg %');
    expect(board.watch.map((i) => i.title)).toContain('Closing 3 holes');
  });

  test('leak insights use the leak ids, including the bucket the diagnosis names', () => {
    const stats = baseStats({
      puttingTarget: { buckets: { '6+': { attempts: 40, sgPerPutt: -0.1, avgPutts: 2.2, expectedPutts: 2 } } },
    });
    const { top } = buildDiagnosis(stats);
    const { hero, board } = buildCoachInsights(stats);

    expect(top.id).toBe('leak:putting:6+');
    expect(hero.id).toBe('leak:putting:6+');
    expect(hero.bucket).toBe('6+');
    const ids = flat(board).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['leak:putting:6+', 'leak:approach', 'strength:aroundGreen']));
  });

  test('a tie puts both leaks in fixFirst; the hero is still the top', () => {
    const stats = baseStats({
      strokesGained: sg([
        { putting: -1.0, approach: -0.9 }, { putting: -1.2, approach: -1.1 },
        { putting: -1.1, approach: -1.0 }, { putting: -1.1, approach: -1.0 },
      ]),
    });
    const d = buildDiagnosis(stats);
    const { hero, board } = buildCoachInsights(stats);

    expect(d.tie).toBeTruthy();
    expect(board.fixFirst.map((i) => i.id)).toEqual([d.top.id, d.tie.id]);
    expect(hero.id).toBe(d.top.id);
  });

  test('a low-confidence leak that is not on top goes to watch, not nextGains', () => {
    const stats = baseStats({
      strokesGained: sg([
        { putting: -2.5, approach: -3 }, { putting: -2.5, approach: 1.5 },
        { putting: -2.5, approach: -2 }, { putting: -2.5, approach: 0.5 },
      ]),
    });
    const approach = buildDiagnosis(stats).leaks.find((l) => l.category === 'approach');
    const { board } = buildCoachInsights(stats);

    expect(approach.confidence).toBe('low');
    expect(board.nextGains.map((i) => i.id)).not.toContain(approach.id);
    expect(board.watch).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: approach.id, group: 'watch', tone: 'watch', confidence: 'low' }),
    ]));
  });

  test('an under-sampled category lands in watch with what it needs, never ranked', () => {
    const stats = baseStats({
      strokesGained: {
        perRound: [
          { byCategory: { aroundGreen: -2 }, sampleHolesByCategory: { aroundGreen: 4 } },
          ...sg([{ putting: -1.2 }, { putting: -1.2 }, { putting: -1.2 }]).perRound,
        ].map((r) => ({
          ...r,
          sampleHolesByCategory: { ...(r.sampleHolesByCategory ?? {}), ...(r.byCategory.aroundGreen === -2 ? { aroundGreen: 4 } : { aroundGreen: 0 }) },
        })),
      },
    });
    const { board } = buildCoachInsights(stats);
    const insight = board.watch.find((i) => i.id === 'leak:aroundGreen');

    expect(insight).toMatchObject({ category: 'aroundGreen', group: 'watch', needs: { holes: 6, rounds: 2 } });
    expect(insight.reasonMsg).toMatchObject({ key: 'stats.my.coach.reason.insufficient' });
    expect(board.fixFirst.map((i) => i.id)).not.toContain('leak:aroundGreen');
  });

  test('with no leak the candidate goes to nextGains and the hero falls back to a trend', () => {
    const stats = baseStats({
      strokesGained: sg([{ putting: -0.2 }, { putting: -0.2 }, { putting: -0.2 }, { putting: -0.2 }]),
    });
    const d = buildDiagnosis(stats);
    const { hero, board } = buildCoachInsights(stats);

    expect(d.top).toBeNull();
    expect(board.fixFirst).toEqual([]);
    expect(board.nextGains.map((i) => i.id)).toEqual([d.candidate.id]);
    expect(hero).toMatchObject({ group: 'gettingBetter', title: 'Points / round' });
  });

  test('uses the diagnosis it is given instead of rebuilding one', () => {
    const stats = baseStats();
    const diagnosis = { ...buildDiagnosis(stats), leaks: [], top: null, tie: null, candidate: null };
    const { hero, board } = buildCoachInsights(stats, diagnosis);

    expect(board.fixFirst).toEqual([]);
    expect(hero.group).not.toBe('fixFirst');
  });

  test('adds comparison basis labels to coach insights', () => {
    const all = flat(buildCoachInsights(baseStats()).board);

    expect(all.length).toBeGreaterThan(0);
    all.forEach((insight) => {
      expect(insight.basis).toMatch(/vs target hcp|vs your avg|recent vs previous|opening vs closing|front vs back/);
    });
  });

  test('keeps form trends: only value metrics become gettingBetter / gettingWorse', () => {
    const { board } = buildCoachInsights(baseStats({
      form: {
        hasHistory: true,
        metrics: [
          { key: 'avgPoints', label: 'Points / round', polarity: 'higher', recent: 27, history: 31, delta: -4, direction: 'down' },
          { key: 'fairwayPct', label: 'Fairways hit %', polarity: 'higher', recent: 42, history: 50, delta: -8, direction: 'down', shot: true },
          { key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', recent: 34, history: 36, delta: -2, direction: 'up', shot: true },
        ],
      },
    }));

    expect(board.gettingWorse.map((i) => i.title)).toEqual(['Points / round']);
    expect(board.gettingBetter).toEqual([]);
  });

  test('every insight id is unique across the board', () => {
    const ids = flat(buildCoachInsights(baseStats()).board).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('empty stats give an empty board and no hero', () => {
    const coach = buildCoachInsights({});
    expect(coach.hero).toBeNull();
    expect(coach.board.fixFirst).toEqual([]);
    expect(coach.board.nextGains).toEqual([]);
  });

  test('an offTheTee leak lands in fixFirst with a Driving area', () => {
    const { board } = buildCoachInsights({ strokesGained: sg([{ offTheTee: -1.2 }, { offTheTee: -1.3 }, { offTheTee: -1.1 }]) });
    const insight = board.fixFirst.find((i) => i.title === 'Off the tee');
    expect(insight).toMatchObject({ id: 'leak:offTheTee', area: 'driving' });
  });

  test('a small persistent penalties cost is below the leak floor, so it never crowds out a real leak', () => {
    const { hero, board } = buildCoachInsights({
      strokesGained: sg([
        { approach: -0.7, penalties: -0.15 }, { approach: -0.8, penalties: -0.15 }, { approach: -0.6, penalties: -0.15 },
      ]),
    });
    expect(hero).toMatchObject({ id: 'leak:approach' });
    expect(flat(board).map((i) => i.id)).not.toContain('leak:penalties');
  });
});
