// 9-hole rounds. A nine-hole course's stroke indices run 1-9, so strokes are
// allocated over nine holes and the WHS course handicap is computed off HALF
// the handicap index against the tee's 9-hole rating/slope/par. Everything
// here is the Golfpark Waldkirch case (four rated 9-hole loops).
import {
  calcExtraShots,
  calcStablefordPoints,
  pickupStrokes,
  calcPlayingHandicap,
  deriveRoundPlayingHandicap,
  holeCountOf,
  roundTotals,
} from '../scoring';
import {
  collectMyRounds, buildSyntheticTournament, computeMetrics, computeFormSeries,
  courseMastery, careerMilestones, CANON_ID,
} from '../personalStats';
import { playerScoreDistribution } from '../statsEngine';

// Golfpark Waldkirch — Grün (9): par 35, SIs as published by the club.
const GRUEN_NINE = [
  { number: 1, par: 4, strokeIndex: 4 },
  { number: 2, par: 4, strokeIndex: 5 },
  { number: 3, par: 3, strokeIndex: 6 },
  { number: 4, par: 5, strokeIndex: 2 },
  { number: 5, par: 3, strokeIndex: 8 },
  { number: 6, par: 4, strokeIndex: 3 },
  { number: 7, par: 5, strokeIndex: 7 },
  { number: 8, par: 4, strokeIndex: 1 },
  { number: 9, par: 3, strokeIndex: 9 },
];

describe('holeCountOf', () => {
  it('reports 9 only for a nine-hole card', () => {
    expect(holeCountOf(GRUEN_NINE)).toBe(9);
    expect(holeCountOf({ holes: GRUEN_NINE })).toBe(9);
  });

  it('treats everything else — including a missing hole list — as 18', () => {
    expect(holeCountOf({ holes: Array(18).fill({ par: 4 }) })).toBe(18);
    expect(holeCountOf({ holes: Array(12).fill({ par: 4 }) })).toBe(18);
    expect(holeCountOf(undefined)).toBe(18);
  });
});

describe('calcExtraShots over nine holes', () => {
  it('wraps at 9, not 18 — a 12 handicap gets a second shot on SI 1-3', () => {
    expect(calcExtraShots(12, 1, 9)).toBe(2);
    expect(calcExtraShots(12, 3, 9)).toBe(2);
    expect(calcExtraShots(12, 4, 9)).toBe(1);
    expect(calcExtraShots(12, 9, 9)).toBe(1);
  });

  it('gives every hole exactly one shot at a 9 handicap', () => {
    for (let si = 1; si <= 9; si += 1) expect(calcExtraShots(9, si, 9)).toBe(1);
  });

  it('agrees with the 18-hole allocation while the handicap fits in one pass', () => {
    for (let si = 1; si <= 9; si += 1) {
      expect(calcExtraShots(5, si, 9)).toBe(calcExtraShots(5, si, 18));
    }
  });

  it('gives shots back from the easiest hole for a plus handicap', () => {
    expect(calcExtraShots(-2, 9, 9)).toBe(-1);
    expect(calcExtraShots(-2, 8, 9)).toBe(-1);
    expect(calcExtraShots(-2, 7, 9)).toBe(0);
  });

  it('defaults to 18 when no hole count is passed', () => {
    expect(calcExtraShots(12, 3)).toBe(1);
  });
});

describe('calcStablefordPoints over nine holes', () => {
  it('counts the second stroke a 12 handicap receives on the hardest hole', () => {
    // SI 1, par 4, 5 strokes. Over nine holes a 12 handicap gets 2 shots
    // here (net 3 — a net birdie, 3 points); over eighteen it gets only 1.
    expect(calcStablefordPoints(4, 5, 12, 1, 9)).toBe(3);
    expect(calcStablefordPoints(4, 5, 12, 1, 18)).toBe(2);
  });
});

describe('pickupStrokes over nine holes', () => {
  it('tracks the nine-hole shot allocation', () => {
    expect(pickupStrokes(4, 12, 1, 9)).toBe(8);   // par + 2 + 2 shots
    expect(pickupStrokes(4, 12, 4, 9)).toBe(7);   // par + 2 + 1 shot
  });
});

describe('calcPlayingHandicap over nine holes', () => {
  // Waldkirch Grün (9), tee Gr28: CR 35.3 / slope 132, par 35.
  it('halves the index and uses the tee\'s 9-hole rating', () => {
    // 18/2 = 9 → 9 × 132/113 + (35.3 − 35) = 10.51 + 0.3 → 11
    expect(calcPlayingHandicap(18, 132, 35.3, 35, 9)).toBe(11);
    // The same index over 18 holes on the same numbers would double it.
    expect(calcPlayingHandicap(18, 132, 35.3, 35, 18)).toBe(21);
  });

  it('halves the index even with no slope to work from', () => {
    expect(calcPlayingHandicap(15, null, null, 35, 9)).toBe(8);
  });
});

describe('deriveRoundPlayingHandicap on a 9-hole round', () => {
  const round = {
    holes: GRUEN_NINE,
    playerTees: { p1: { label: 'Gr28', slope: 132, rating: 35.3 } },
  };

  it('derives the 9-hole course handicap from the round\'s own hole list', () => {
    expect(deriveRoundPlayingHandicap(18, round, 'p1')).toBe(11);
  });
});

describe('roundTotals on a 9-hole round', () => {
  it('scores every hole off the nine-hole allocation', () => {
    const player = { id: 'p1', name: 'A', handicap: 18 };
    const round = {
      holes: GRUEN_NINE,
      playerHandicaps: { p1: 12 },
      // Par on every hole.
      scores: { p1: Object.fromEntries(GRUEN_NINE.map((h) => [h.number, h.par])) },
    };
    // 12 shots over 9 holes: 1 everywhere, 2 on SI 1-3. Par with n shots is
    // 2 + n points, so 6 holes × 3 + 3 holes × 4 = 30.
    const [row] = roundTotals(round, [player]);
    expect(row.totalPoints).toBe(30);
    expect(row.totalStrokes).toBe(35);
  });
});

// ── 9-hole rounds in personal stats ──
// Round-TOTAL figures (points in the round, strokes vs par, putts, damage,
// SG/round) scale with hole count. A nine's ~18-point total plotted against
// 18-hole rounds reads as a collapse in form, so every round-total aggregate
// leaves nines out — the same treatment handicapIndex and frontBackSplit
// already give them. Per-hole metrics keep seeing every round.
describe('9-hole rounds and round-total personal stats', () => {
  const holes18 = () => Array.from({ length: 18 }, (_, i) => ({
    number: i + 1, par: 4, strokeIndex: i + 1,
  }));
  // Score every hole at its own par + `vsPar` — GRUEN_NINE mixes par 3/4/5,
  // so a flat stroke count would not be a flat scoreline.
  const parScores = (holes, vsPar) => Object.fromEntries(
    holes.map((h) => [h.number, h.par + vsPar]),
  );
  const mkTournament = (id, name, roundHoles, vsPar) => ({
    id,
    name,
    createdAt: `2026-0${id}-01T10:00:00.000Z`,
    players: [{ id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' }],
    rounds: [{
      courseName: name,
      holes: roundHoles,
      scores: { p1: parScores(roundHoles, vsPar) },
      shotDetails: {},
      playerHandicaps: { p1: 0 },
    }],
  });

  // collectMyRounds walks tournaments newest-first, so pass them in that
  // order to get an oldest-first selection (three 18s, then the nine).
  const selection = () => collectMyRounds([
    mkTournament(4, 'Waldkirch Grün', GRUEN_NINE, 0),
    mkTournament(3, 'Oak', holes18(), 0),
    mkTournament(2, 'Elm', holes18(), 0),
    mkTournament(1, 'Pine', holes18(), 0),
  ], 'u1', 'Me');

  it('keeps the nine in the selection — it is a round the user played', () => {
    const rounds = selection();
    expect(rounds).toHaveLength(4);
    expect(rounds[3].courseName).toBe('Waldkirch Grün');
    expect(rounds[3].isComplete).toBe(true);
    expect(rounds[3].holesPlayed).toBe(9);
  });

  it('leaves the nine out of avgPoints / bestRoundPoints / avgVsPar', () => {
    const synthetic = buildSyntheticTournament(selection());
    const metrics = computeMetrics(synthetic);
    // Every 18-hole round is par on all 18 holes off scratch: 36 points, 0
    // vs par. The nine (par on 9 holes off scratch) totals 18 points — if it
    // were averaged in, avgPoints would drop to 31.5 and avgVsPar would stay
    // 0 only by luck. rounds still counts all four.
    expect(metrics.rounds).toBe(4);
    expect(metrics.avgPoints).toBe(36);
    expect(metrics.bestRoundPoints).toBe(36);
    expect(metrics.avgVsPar).toBe(0);
  });

  it('plots the nine as a gap in the round-total form series, not a low point', () => {
    const series = computeFormSeries(selection());
    expect(series.metrics.avgPoints.map((p) => p.value)).toEqual([36, 36, 36, null]);
    expect(series.metrics.avgVsPar.map((p) => p.value)).toEqual([0, 0, 0, null]);
    expect(series.damage.map((p) => p.value)).toEqual([0, 0, 0, null]);
    // Rate-based series are hole-count-neutral, so the nine still plots.
    expect(series.steadyPct.map((p) => p.value)).toEqual([100, 100, 100, 100]);
    // As does the score mix, which each column normalises to its own total.
    expect(series.scoreMix[3]).toMatchObject({ par: 9, bogey: 0 });
  });

  it('keeps the nine in per-hole metrics', () => {
    const synthetic = buildSyntheticTournament(selection());
    // 3 × 18 + 9 = 63 scored holes, every one of them a par.
    const dist = playerScoreDistribution(synthetic, CANON_ID);
    expect(dist.total).toBe(63);
    expect(dist.pars).toBe(63);
  });

  it('never lets a nine win "best round"', () => {
    // A blinding nine — birdies everywhere, 27 points — still cannot
    // out-total a par round of 36, so it must not be ranked against one.
    const hot = mkTournament(4, 'Waldkirch Grün', GRUEN_NINE, -1);
    const rounds = collectMyRounds([hot, mkTournament(1, 'Pine', holes18(), 0)], 'u1', 'Me');
    const synthetic = buildSyntheticTournament(rounds);
    expect(careerMilestones(synthetic).bestRound).toBe(36);
    // The nine's birdies still count as career feats — a birdie is a birdie.
    expect(careerMilestones(synthetic).birdies).toBe(9);
  });

  it('keeps 9-hole courses in course mastery and breaks ties per hole', () => {
    // Course Mastery is the exception: each row compares one course's rounds
    // with each other, all on that course's own layout. The nine must stay
    // (its Course Stats drill-down is only reachable from this row). Both
    // courses have one round, so the rounds-played ranking ties and the
    // per-hole tiebreak decides — the nine must not lose it just for being
    // half the golf: 3 pts/hole beats 2.
    const hot = mkTournament(4, 'Waldkirch Grün', GRUEN_NINE, -1);
    const rounds = collectMyRounds([hot, mkTournament(1, 'Pine', holes18(), 0)], 'u1', 'Me');
    const mastery = courseMastery(buildSyntheticTournament(rounds));
    expect(mastery.map((c) => c.courseName)).toEqual(['Waldkirch Grün', 'Pine']);
    expect(mastery[0]).toMatchObject({ avgPoints: 27, avgPointsPerHole: 3, holeCount: 9 });
    expect(mastery[1]).toMatchObject({ avgPoints: 36, avgPointsPerHole: 2, holeCount: 18 });
  });

  it('reports no round-total figures when every round is a nine', () => {
    const rounds = collectMyRounds([mkTournament(1, 'Waldkirch Grün', GRUEN_NINE, 4)], 'u1', 'Me');
    const metrics = computeMetrics(buildSyntheticTournament(rounds));
    expect(metrics.rounds).toBe(1);
    expect(metrics.avgPoints).toBeNull();
    expect(metrics.bestRoundPoints).toBeNull();
    expect(metrics.avgVsPar).toBeNull();
  });
});
