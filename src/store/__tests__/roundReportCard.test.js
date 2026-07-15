import { buildRoundReportCard } from '../roundReportCard';
import * as personalStats from '../personalStats';

// ── Fixture helpers ───────────────────────────────────────────────
// 18 holes, par 4, strokeIndex = hole number.
function mkHoles(n = 18, par = 4) {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par, strokeIndex: i + 1 }));
}
// scores object: every hole = `strokes`.
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}
// Build a MyRound record (matches collectMyRounds output shape). isComplete
// and holesPlayed are derived from `scores` the same way collectMyRounds
// derives them, so fixtures stay honest about what was actually scored.
function mkMyRound({
  key, courseName = 'Course', holes, scores, shotDetails = {},
  completed = true, tournamentName = 'Cup', tournamentDate = '2026-05-01',
}) {
  const isComplete = holes.length > 0 && holes.every((h) => scores[h.number] != null);
  const holesPlayed = holes.filter((h) => scores[h.number] != null).length;
  return {
    key, courseName, tournamentName, tournamentDate, roundIndex: 0,
    playerId: 'p1',
    player: { id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' },
    round: {
      courseName, holes,
      scores: { p1: scores },
      shotDetails: { p1: shotDetails },
      playerHandicaps: { p1: 0 },
    },
    completed,
    isComplete,
    holesPlayed,
    points: 0,
  };
}

describe('buildRoundReportCard — meta & headline', () => {
  test('returns null when the round key is not found', () => {
    const h = mkHoles();
    const rounds = [mkMyRound({ key: 'a', holes: h, scores: evenScores(h, 4) })];
    expect(buildRoundReportCard(rounds, 'missing')).toBeNull();
  });

  test('headline reports points, per-hole and round meta', () => {
    const h = mkHoles();
    // One round, all par (strokes 4 on par 4) → 2 pts/hole → 36 pts.
    const rounds = [mkMyRound({
      key: 't1:0', courseName: 'Pine', holes: h, scores: evenScores(h, 4),
    })];
    const card = buildRoundReportCard(rounds, 't1:0');
    expect(card.round).toMatchObject({
      key: 't1:0', courseName: 'Pine', tournamentName: 'Cup',
      holesPlayed: 18, complete: true,
    });
    expect(card.headline.points).toBe(36);
    expect(card.headline.perHole).toBe(2);
    expect(card.headline.clearedBenchmark).toBe(true);
    expect(card.hasHistory).toBe(false);
  });

  test('no history → verdict from per-hole vs the 2.0 benchmark', () => {
    const h = mkHoles();
    // Single round, strokes 3 on par 4 → 3 pts/hole → "Strong round".
    const rounds = [mkMyRound({ key: 'x', holes: h, scores: evenScores(h, 3) })];
    const card = buildRoundReportCard(rounds, 'x');
    expect(card.hasHistory).toBe(false);
    expect(card.headline.vsAvg).toBeNull();
    expect(card.headline.verdict).toBe('Strong round');
  });

  test('with history → verdict from points vs career average', () => {
    const h = mkHoles();
    // History: two 2-pt/hole rounds (36 pts each). Target: 3 pts/hole (54 pts).
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'h2', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 3) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    expect(card.hasHistory).toBe(true);
    // (3.0 - 2.0) * 18 = +18 vs average.
    expect(card.headline.vsAvg).toBe(18);
    expect(card.headline.verdict).toBe('Standout round');
  });

  test('verdict bands: a round near the career average is "Solid round"', () => {
    const h = mkHoles();
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 4) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    expect(card.headline.vsAvg).toBe(0);
    expect(card.headline.verdict).toBe('Solid round');
  });

  test('verdict bands with history: Strong / Off day / Tough day', () => {
    const h = mkHoles();
    // History baseline: one all-par round → 2.0 pts/hole.
    const base = mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) });

    // Strong: 3 birdies + 15 pars → 39 pts → perHole 2.17 → vsAvg ~+3.1.
    const strongScores = evenScores(h, 4);
    [1, 2, 3].forEach((n) => { strongScores[n] = 3; });
    const strong = buildRoundReportCard(
      [base, mkMyRound({ key: 'strong', holes: h, scores: strongScores })], 'strong');
    expect(strong.headline.verdict).toBe('Strong round');

    // Off day: 4 bogeys + 14 pars → 32 pts → perHole 1.78 → vsAvg ~-4.0.
    const offScores = evenScores(h, 4);
    [1, 2, 3, 4].forEach((n) => { offScores[n] = 5; });
    const off = buildRoundReportCard(
      [base, mkMyRound({ key: 'off', holes: h, scores: offScores })], 'off');
    expect(off.headline.verdict).toBe('Off day');

    // Tough day: 8 bogeys + 10 pars → 28 pts → perHole 1.56 → vsAvg ~-7.9.
    const toughScores = evenScores(h, 4);
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => { toughScores[n] = 5; });
    const tough = buildRoundReportCard(
      [base, mkMyRound({ key: 'tough', holes: h, scores: toughScores })], 'tough');
    expect(tough.headline.verdict).toBe('Tough day');
    expect(tough.headline.tone).toBe('bad');
  });

  test('headline tone maps strong, solid and tough verdicts to semantic states', () => {
    const h = mkHoles();
    const base = mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) });

    const strongScores = evenScores(h, 4);
    [1, 2, 3].forEach((n) => { strongScores[n] = 3; });
    const strong = buildRoundReportCard(
      [base, mkMyRound({ key: 'strong', holes: h, scores: strongScores })], 'strong');

    const solid = buildRoundReportCard(
      [base, mkMyRound({ key: 'solid', holes: h, scores: evenScores(h, 4) })], 'solid');

    const toughScores = evenScores(h, 4);
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => { toughScores[n] = 5; });
    const tough = buildRoundReportCard(
      [base, mkMyRound({ key: 'tough', holes: h, scores: toughScores })], 'tough');

    expect(strong.headline.tone).toBe('good');
    expect(solid.headline.tone).toBe('neutral');
    expect(tough.headline.tone).toBe('bad');
  });

  test('verdict bands without history: Solid / Off day / Tough day', () => {
    const h = mkHoles();
    // Solid: all par → 2.0 pts/hole.
    const solid = buildRoundReportCard(
      [mkMyRound({ key: 'solid', holes: h, scores: evenScores(h, 4) })], 'solid');
    expect(solid.headline.verdict).toBe('Solid round');

    // Off day: 4 bogeys + 14 pars → perHole 1.78.
    const offScores = evenScores(h, 4);
    [1, 2, 3, 4].forEach((n) => { offScores[n] = 5; });
    const off = buildRoundReportCard(
      [mkMyRound({ key: 'off', holes: h, scores: offScores })], 'off');
    expect(off.headline.verdict).toBe('Off day');

    // Tough day: all bogeys (strokes 5 on par 4) → 1.0 pts/hole.
    const tough = buildRoundReportCard(
      [mkMyRound({ key: 'tough', holes: h, scores: evenScores(h, 5) })], 'tough');
    expect(tough.headline.verdict).toBe('Tough day');
  });

  test('incomplete round: per-hole and holesPlayed reflect holes actually scored', () => {
    const h = mkHoles();
    const partial = {};
    h.slice(0, 9).forEach((hole) => { partial[hole.number] = 4; });
    // No explicit `completed` override: like a real early-finished game
    // (tournament finishedAt set), the loose flag stays true while
    // isComplete is derived false from the 9 unscored holes. The card's
    // `complete` field — which drives the "through N holes" caveat — must
    // key off isComplete, or an early-finished round masquerades as full.
    const rounds = [mkMyRound({ key: 'p', holes: h, scores: partial })];
    expect(rounds[0].completed).toBe(true);
    const card = buildRoundReportCard(rounds, 'p');
    expect(card.round.holesPlayed).toBe(9);
    expect(card.round.complete).toBe(false);
    expect(card.headline.points).toBe(18);
    expect(card.headline.perHole).toBe(2);
  });

  test('career baseline excludes an early-finished partial round from the history average', () => {
    const h = mkHoles();
    // Partial history round: only 6 of 18 holes scored, at birdie pace
    // (3 pts/hole) — a very different rate than the full round below, so
    // wrongly including it would visibly move the baseline.
    const partialScores = {};
    h.slice(0, 6).forEach((hole) => { partialScores[hole.number] = 3; });
    const partial = mkMyRound({ key: 'partial', holes: h, scores: partialScores });
    const full = mkMyRound({ key: 'full', holes: h, scores: evenScores(h, 4) }); // 2 pts/hole
    const target = mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 3) }); // 3 pts/hole

    const card = buildRoundReportCard([partial, full, target], 'target');
    expect(card.hasHistory).toBe(true);
    // Baseline is the full round's 2.0 pts/hole only: (3.0 - 2.0) * 18 = +18.
    // If the partial round leaked in, the baseline would blend toward 2.25
    // and vsAvg would read +13.5 instead.
    expect(card.headline.vsAvg).toBe(18);
  });

  test('distribution baseline (Birdies+) excludes an early-finished partial round from the per-round rate', () => {
    const h = mkHoles();
    // Partial history round: 6 of 18 holes scored, birdied at the SAME rate
    // (1-in-6) as the full round below (3-in-18) — a typical partial round,
    // not birdie-heavy.
    const partialScores = {};
    h.slice(0, 6).forEach((hole) => { partialScores[hole.number] = hole.par; });
    partialScores[1] = 3; // one birdie
    const partial = mkMyRound({ key: 'partial', holes: h, scores: partialScores });

    // Full history round: 3 birdies (holes 1-3), rest par.
    const fullScores = evenScores(h, 4);
    [1, 2, 3].forEach((n) => { fullScores[n] = 3; });
    const full = mkMyRound({ key: 'full', holes: h, scores: fullScores });

    // Target round: identical birdie pattern to the full history round —
    // an ordinary round that should read as exactly average.
    const targetScores = evenScores(h, 4);
    [1, 2, 3].forEach((n) => { targetScores[n] = 3; });
    const target = mkMyRound({ key: 'target', holes: h, scores: targetScores });

    const card = buildRoundReportCard([partial, full, target], 'target');
    const dist = card.groups.find((g) => g.key === 'distribution');
    const birdies = dist.cells.find((c) => c.label === 'Birdies+');

    // Baseline must be the full (complete) round's own birdie count, 3 —
    // NOT diluted by averaging in the 6-hole partial round: the old buggy
    // math was (3 full + 1 partial) / 2 rounds = 2.0, which would falsely
    // flag this target's 3 birdies as +1.0 above average (a false "bright
    // spot"). With only complete rounds counted, baseline = 3 / 1 = 3, and
    // the target's matching 3 birdies reads as exactly average.
    expect(birdies.baseline).toBe(3);
    expect(birdies.value).toBe(3);
    expect(birdies.deltaVsAvg).toBe(0);
  });
});

describe('buildRoundReportCard — callouts', () => {
  // A round that is par everywhere EXCEPT par-3 holes are birdied and
  // SI 1-6 holes are double-bogeyed, against a flat 2-pt/hole history.
  function scoresWithStandoutAndWeak(holes) {
    const o = {};
    holes.forEach((h) => {
      if (h.par === 3) o[h.number] = h.par - 1;        // birdie → 3 pts
      else if (h.strokeIndex <= 6) o[h.number] = h.par + 2; // double → 0 pts
      else o[h.number] = h.par;                        // par → 2 pts
    });
    return o;
  }

  test('bright spots and cost cells rank by delta vs career average', () => {
    // 18 holes: holes 1-3 are par 3, rest par 4. SI = hole number.
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i < 3 ? 3 : 4, strokeIndex: i + 1,
    }));
    const flat = {};
    holes.forEach((h) => { flat[h.number] = h.par; }); // 2 pts everywhere
    const rounds = [
      mkMyRound({ key: 'h1', holes, scores: flat }),
      mkMyRound({ key: 'h2', holes, scores: flat }),
      mkMyRound({ key: 'target', holes, scores: scoresWithStandoutAndWeak(holes) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    const brightLabels = card.callouts.bright.map((c) => c.label);
    const costLabels = card.callouts.cost.map((c) => c.label);
    expect(brightLabels).toContain('Par 3s');
    expect(costLabels).toContain('Hard holes (SI 1-6)');
    // The strongest bright spot / worst cost cell must rank first.
    expect(brightLabels[0]).toBe('Par 3s');
    expect(costLabels[0]).toBe('Hard holes (SI 1-6)');
    expect(card.callouts.bright.length).toBeLessThanOrEqual(2);
    expect(card.callouts.cost.length).toBeLessThanOrEqual(2);
  });

  test('a cell with fewer than 3 holes this round is not callout-eligible', () => {
    // Only ONE par-3 hole — Par 3s has a 1-hole sample and must be excluded
    // even though it is birdied (a large delta).
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i === 0 ? 3 : 4, strokeIndex: i + 1,
    }));
    const flat = {};
    holes.forEach((h) => { flat[h.number] = h.par; });
    const target = { ...flat, 1: 2 }; // birdie the single par 3
    const rounds = [
      mkMyRound({ key: 'h1', holes, scores: flat }),
      mkMyRound({ key: 'target', holes, scores: target }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    expect(card.callouts.bright.map((c) => c.label)).not.toContain('Par 3s');
  });

  test('no history → callouts rank on delta vs the 2.0 benchmark', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i < 3 ? 3 : 4, strokeIndex: i + 1,
    }));
    const rounds = [mkMyRound({
      key: 'solo', holes, scores: scoresWithStandoutAndWeak(holes),
    })];
    const card = buildRoundReportCard(rounds, 'solo');
    expect(card.hasHistory).toBe(false);
    expect(card.callouts.bright.map((c) => c.label)).toContain('Par 3s');
    expect(card.callouts.cost.map((c) => c.label)).toContain('Hard holes (SI 1-6)');
  });
});

describe('buildRoundReportCard — breakdown groups', () => {
  test('groups cover course, timing and distribution for an 18-hole round', () => {
    const h = mkHoles();
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 4) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    const keys = card.groups.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(['course', 'timing', 'distribution']));
    const course = card.groups.find((g) => g.key === 'course');
    expect(course.cells.map((c) => c.label)).toContain('Par 4s');
    const timing = card.groups.find((g) => g.key === 'timing');
    expect(timing.cells.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Front 9', 'Back 9']),
    );
  });

  test('distribution group reports blow-ups (double bogey or worse)', () => {
    const h = mkHoles();
    // Target round: holes 1-2 are triple bogey (par+3) → blow-ups; rest par.
    const target = evenScores(h, 4);
    target[1] = 7; target[2] = 7;
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: target }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    const dist = card.groups.find((g) => g.key === 'distribution');
    const blowups = dist.cells.find((c) => c.label === 'Blow-ups');
    expect(blowups.value).toBe(2);
    expect(blowups.polarity).toBe('lower');
  });

  test('9-hole round omits the front/back nine cells', () => {
    const h = mkHoles(9);
    const rounds = [mkMyRound({ key: 'nine', holes: h, scores: evenScores(h, 4) })];
    const card = buildRoundReportCard(rounds, 'nine');
    const timing = card.groups.find((g) => g.key === 'timing');
    expect(timing.cells.map((c) => c.label)).not.toContain('Front 9');
    expect(timing.cells.map((c) => c.label)).toContain('Opening 3');
  });

  test('round without shot detail → hasShotData false, no shots group', () => {
    const h = mkHoles();
    const rounds = [mkMyRound({ key: 'noshots', holes: h, scores: evenScores(h, 4) })];
    const card = buildRoundReportCard(rounds, 'noshots');
    expect(card.hasShotData).toBe(false);
    expect(card.groups.map((g) => g.key)).not.toContain('shots');
  });

  test('round with shot detail → shots group with putts and GIR', () => {
    const h = mkHoles();
    const shot = {};
    h.forEach((hole) => { shot[hole.number] = { putts: 2, drive: 'fairway', teePenalties: 0, otherPenalties: 0 }; });
    const rounds = [mkMyRound({
      key: 'shots', holes: h, scores: evenScores(h, 4), shotDetails: shot,
    })];
    const card = buildRoundReportCard(rounds, 'shots');
    expect(card.hasShotData).toBe(true);
    const shots = card.groups.find((g) => g.key === 'shots');
    expect(shots.cells.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Putts', 'Fairways hit %', 'Greens in reg %']),
    );
  });

  test('first-ever round with shot detail → shots group, null baselines', () => {
    const h = mkHoles();
    const shot = {};
    h.forEach((hole) => { shot[hole.number] = { putts: 2, drive: 'fairway', teePenalties: 0, otherPenalties: 0 }; });
    const rounds = [mkMyRound({
      key: 'first', holes: h, scores: evenScores(h, 4), shotDetails: shot,
    })];
    const card = buildRoundReportCard(rounds, 'first');
    expect(card.hasHistory).toBe(false);
    expect(card.hasShotData).toBe(true);
    const shots = card.groups.find((g) => g.key === 'shots');
    expect(shots).toBeTruthy();
    shots.cells.forEach((c) => {
      expect(c.baseline).toBeNull();
      expect(c.deltaVsAvg).toBeNull();
    });
  });
});

describe('buildRoundReportCard — baseline-only compute path', () => {
  test('computes thisStats, baseStats and completeBaseStats via computeMyStats({ baselineOnly: true })', () => {
    const spy = jest.spyOn(personalStats, 'computeMyStats');
    const h = mkHoles();
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 3) }),
    ];
    buildRoundReportCard(rounds, 'target');
    // 3 calls: the target round, the full history, and the complete-only
    // slice of history (distributionCells' per-round baseline must exclude
    // partial rounds — see the "distribution baseline" test above). Here
    // 'h1' is a complete round, so the third call is a same-sized re-slice.
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mock.calls.forEach((call) => {
      expect(call[1]).toMatchObject({ baselineOnly: true });
    });
    spy.mockRestore();
  });

  test('the report card output is unchanged for a rich fixture (shot data + history)', () => {
    // A fixture that exercises every code path roundReportCard reads off
    // computeMyStats: history (career per-hole baseline), parType,
    // difficulty, warmupClosing, frontBack (18 holes → Front/Back 9),
    // distribution (blow-ups), and shots (putts/fairways/GIR). Locking this
    // down in a snapshot means any regression in the baselineOnly path —
    // wrong field, stale value, wrong synthetic — shows up as a diff here.
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i < 3 ? 3 : i < 15 ? 4 : 5, strokeIndex: i + 1,
    }));
    const shotDetail = {};
    holes.forEach((hole) => {
      shotDetail[hole.number] = {
        putts: 2, drive: hole.strokeIndex <= 9 ? 'fairway' : 'right', teePenalties: 0, otherPenalties: 0,
      };
    });
    const flatScores = () => {
      const o = {};
      holes.forEach((h) => { o[h.number] = h.par; });
      return o;
    };
    const targetScores = flatScores();
    targetScores[1] = holes[0].par - 1; // birdie a par 3
    targetScores[16] = holes[15].par + 3; // blow-up a par 5

    const rounds = [
      mkMyRound({ key: 'h1', holes, scores: flatScores(), tournamentDate: '2026-04-01' }),
      mkMyRound({
        key: 'h2', holes, scores: flatScores(), shotDetails: shotDetail, tournamentDate: '2026-04-08',
      }),
      mkMyRound({
        key: 'target', holes, scores: targetScores, shotDetails: shotDetail, tournamentDate: '2026-04-15',
      }),
    ];

    const card = buildRoundReportCard(rounds, 'target');
    expect(card).toMatchSnapshot();
  });
});
