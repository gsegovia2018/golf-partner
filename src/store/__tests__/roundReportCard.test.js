import { buildRoundReportCard } from '../roundReportCard';

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
// Build a MyRound record (matches collectMyRounds output shape).
function mkMyRound({
  key, courseName = 'Course', holes, scores, shotDetails = {},
  completed = true, tournamentName = 'Cup', tournamentDate = '2026-05-01',
}) {
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

  test('incomplete round: per-hole and holesPlayed reflect holes actually scored', () => {
    const h = mkHoles();
    const partial = {};
    h.slice(0, 9).forEach((hole) => { partial[hole.number] = 4; });
    const rounds = [mkMyRound({
      key: 'p', holes: h, scores: partial, completed: false,
    })];
    const card = buildRoundReportCard(rounds, 'p');
    expect(card.round.holesPlayed).toBe(9);
    expect(card.round.complete).toBe(false);
    expect(card.headline.points).toBe(18);
    expect(card.headline.perHole).toBe(2);
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
