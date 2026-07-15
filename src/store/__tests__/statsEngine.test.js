import { teeShotImpact, lagPuttingQuality, sandSaveRate, upAndDownRate, bunkerVisits, sgPutting, sgAroundGreen, sgApproach, sgPenalties, sgOffTheTee, sgTotal, sgSeason, driveScoreImpact, puttDeepDive, approachScoreImpact, puttingTargetGaps, approachTargetGaps, pairPerformance, shotStats, playersWithShotData, tournamentHighlights, withoutScrambleScores, playerAvgStableford, pickupChampion, hallOfShame, chaosHoles, skinsLeaderboard, playerStreaks, bounceBackRate, strokeIndexAccuracy, bestWorstHoles, holeDifficultyMap, collectiveExtremes, pairConfigMatrix, matchPlayResults, pairHoleWins, anchor, par3Heartbreak, playingToHandicap, hotStretch, nemesisEncore, pairCoverage, girByDriveResult, courseDNA, warmupVsClosing, driveLieFromDetail } from '../statsEngine';
import { mixedModeTournament, buildTournament } from './statsFixtures';

// 18 par-4 holes, strokeIndex = hole number.
function holes18() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}

describe('teeShotImpact', () => {
  test('reports no data when no shot detail exists', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(teeShotImpact(t, 'p1').hasData).toBe(false);
  });

  test('separates fairway-hit holes from missed holes by average points', () => {
    const h = holes18();
    // holes 1-2 fairway scoring 4 (par, 2 pts); holes 3-4 missed scoring 6 (0 pts)
    const shotDetails = {
      p1: {
        1: { drive: 'fairway' }, 2: { drive: 'super' },
        3: { drive: 'left' }, 4: { drive: 'right' },
      },
    };
    const scores = { ...evenScores(h, 4) };
    scores[3] = 6; scores[4] = 6;
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.fairway.holes).toBe(2);
    expect(r.fairway.avgPoints).toBe(2);
    expect(r.missed.holes).toBe(2);
    expect(r.missed.avgPoints).toBe(0);
    expect(r.byDirection.left.holes).toBe(1);
    expect(r.byDirection.right.holes).toBe(1);
  });

  test('ignores par 3 holes', () => {
    const h = holes18().map((hole, i) => (i === 0 ? { ...hole, par: 3 } : hole));
    const shotDetails = { p1: { 1: { drive: 'fairway' } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    expect(teeShotImpact(t, 'p1').fairway.holes).toBe(0);
  });

  test('measures tee-penalty holes against tracked penalty-free holes', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[1] = 6; // penalty hole scores worse
    // Every hole has shot detail: hole 1 took a tee penalty, the rest are clean.
    const shotDetails = { p1: {} };
    h.forEach((hole) => {
      shotDetails.p1[hole.number] = hole.number === 1
        ? { teePenalties: 1 }
        : { drive: 'fairway' };
    });
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.teePenalty.holes).toBe(1);
    expect(r.teePenalty.penaltyCount).toBe(1);
    expect(r.teePenalty.avgPoints).toBe(0);     // hole 1: 6 on par 4 → 0 pts
    expect(r.withoutPenalty.holes).toBe(17);    // holes 2-18, tracked, no penalty
    expect(r.withoutPenalty.avgPoints).toBe(2); // par → 2 pts each
    expect(r.penaltyDrag).toBe(2);              // 2 - 0
  });

  test('untracked holes do not pad the penalty-free baseline', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[1] = 6;
    // Only hole 1 has shot detail (a tee penalty); holes 2-18 are untracked.
    const shotDetails = { p1: { 1: { teePenalties: 1 } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.withoutPenalty.holes).toBe(0); // untracked holes are not counted
    expect(r.penaltyDrag).toBe(0);          // no clean baseline → no drag figure
  });
});

describe('shotStats', () => {
  test('putts-per-round divides by rounds with putt data, not any shot detail', () => {
    const h = holes18();
    // Round 1: putts logged on every hole (36 total). Round 2: drive-only.
    const puttRound = {
      courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) },
      shotDetails: { p1: Object.fromEntries(h.map((hole) => [hole.number, { putts: 2 }])) },
    };
    const driveOnlyRound = {
      courseName: 'D', holes: h, scores: { p1: evenScores(h, 4) },
      shotDetails: { p1: { 1: { drive: 'fairway' } } },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [puttRound, driveOnlyRound],
    };
    const r = shotStats(t, 'p1');
    expect(r.roundsWithData).toBe(2);
    expect(r.roundsWithPuttData).toBe(1);
    expect(r.putts.perRound).toBe(36); // not deflated to 18 by the drive-only round
  });

  test('roundsWithPuttData is 0 when no putts are logged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{
        courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) },
        shotDetails: { p1: { 1: { drive: 'fairway' } } },
      }],
    };
    const r = shotStats(t, 'p1');
    expect(r.roundsWithPuttData).toBe(0);
    expect(r.putts.perRound).toBe(0);
  });

  test('a tee penalty on a par-3 (no drive logged) does not move penalties.teeOnDriveHoles', () => {
    const h = holes18().map((hole, i) => (i === 0 ? { ...hole, par: 3 } : hole));
    const scores = { ...evenScores(h, 4) };
    scores[1] = 5;
    const shotDetails = {
      p1: {
        1: { teePenalties: 1 }, // par 3, no drive direction logged
        2: { drive: 'fairway', teePenalties: 1 }, // drive-logged hole with a penalty
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = shotStats(t, 'p1');
    expect(r.penalties.tee).toBe(2); // raw total is unchanged
    expect(r.penalties.teeOnDriveHoles).toBe(1); // only the drive-logged hole counts
  });

  test('putts.per18 normalizes a 9-logged-hole round to an 18-hole rate', () => {
    const h = holes18();
    const nineHoles = h.slice(0, 9);
    const shotDetails = {
      p1: Object.fromEntries(nineHoles.map((hole) => [hole.number, { putts: 2 }])),
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    const r = shotStats(t, 'p1');
    expect(r.putts.holes).toBe(9);
    expect(r.putts.per18).toBe(36); // 2 per hole × 18
  });

  test('putts.per18 is null when no putts are logged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{
        courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) },
        shotDetails: { p1: { 1: { drive: 'fairway' } } },
      }],
    };
    const r = shotStats(t, 'p1');
    expect(r.putts.per18).toBeNull();
  });

  test('an approach-only logger counts as hasData and appears in playersWithShotData', () => {
    const h = holes18();
    const shotDetails = {
      p1: Object.fromEntries(h.map((hole) => [hole.number, {
        approachBucket: '100-150', approachResult: 'green',
      }])),
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }, { id: 'p2', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    expect(shotStats(t, 'p1').hasData).toBe(true);
    const withData = playersWithShotData(t);
    expect(withData.map((p) => p.id)).toEqual(['p1']);
  });
});

// ── lagPuttingQuality helpers ──
const makeRound = (holes, details, playerId = 'me') => ({
  holes: holes.map((h, i) => ({
    number: i + 1, par: h.par, strokeIndex: i + 1, ...(h.distance != null ? { distance: h.distance } : {}),
  })),
  scores: { [playerId]: Object.fromEntries(holes.map((h, i) => [i + 1, h.strokes])) },
  shotDetails: { [playerId]: Object.fromEntries(details.map((d, i) => [i + 1, d])) },
});

describe('lagPuttingQuality', () => {
  test('returns null per bucket below 12-putt threshold', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['2-3']).toBeNull();
  });

  test('aggregates putts per bucket above threshold', () => {
    const holes = Array.from({ length: 12 }, () => ({ par: 4, strokes: 4 }));
    const details = Array.from({ length: 12 }, () => ({ putts: 2, firstPuttBucket: '2-3' }));
    const round = makeRound(holes, details);
    const result = lagPuttingQuality([round], 'me');
    expect(result.avgPuttsByBucket['2-3']).toBeCloseTo(2.0);
    expect(result.sample.perBucket['2-3']).toBe(12);
  });
});

describe('sandSaveRate', () => {
  test('returns null below 4-attempt threshold', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: 'sand-save' }],
    );
    expect(sandSaveRate([round], 'me').rate).toBeNull();
  });

  test('counts saves over sand-shot attempts on missed-GIR holes', () => {
    const rounds = Array.from({ length: 5 }, (_, i) => makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: i < 3 ? 'sand-save' : 'none' }],
    ));
    const r = sandSaveRate(rounds, 'me');
    expect(r.attempts).toBe(5);
    expect(r.saves).toBe(3);
    expect(r.rate).toBeCloseTo(0.6);
  });

  test('auto-derives saves when recoveryOutcome was never stored', () => {
    // Par saved with 1 putt after a bunker shot: the scorecard shows the
    // chip as lit without persisting it — the stat must still count it.
    const rounds = Array.from({ length: 4 }, () => makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 1, sandShots: 1 }],
    ));
    const r = sandSaveRate(rounds, 'me');
    expect(r.attempts).toBe(4);
    expect(r.saves).toBe(4);
    expect(r.rate).toBeCloseTo(1);
  });

  test('stored none overrides the auto-derived save', () => {
    const rounds = Array.from({ length: 4 }, () => makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: 'none' }],
    ));
    const r = sandSaveRate(rounds, 'me');
    expect(r.attempts).toBe(4);
    expect(r.saves).toBe(0);
  });

  test('a stored up-and-down on a sand hole counts as a save', () => {
    const rounds = Array.from({ length: 4 }, () => makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 1, sandShots: 1, recoveryOutcome: 'up-and-down' }],
    ));
    const r = sandSaveRate(rounds, 'me');
    expect(r.saves).toBe(4);
  });
});

describe('bunkerVisits', () => {
  test('counts sand shots and holes-with-sand per round', () => {
    const round = makeRound(
      [
        { par: 4, strokes: 5 },
        { par: 4, strokes: 4 },
        { par: 5, strokes: 7 },
      ],
      [
        { putts: 1, sandShots: 2 },
        { putts: 2, sandShots: 0 },
        { putts: 2, sandShots: 1 },
      ],
    );
    const r = bunkerVisits([round, round], 'me');
    expect(r.totalShots).toBe(6);
    expect(r.holesWithSand).toBe(4);
    expect(r.avgPerRound).toBeCloseTo(3.0);          // 6 sand shots / 2 rounds
  });
});

describe('upAndDownRate', () => {
  test('returns null below 6 missed-GIR holes', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 0, recoveryOutcome: 'up-and-down' }],
    );
    expect(upAndDownRate([round], 'me').rate).toBeNull();
  });

  test('splits conversions by sand vs non-sand', () => {
    const rounds = Array.from({ length: 8 }, (_, i) => makeRound(
      [{ par: 4, strokes: 5 }],
      [{
        putts: 1,
        sandShots: i % 2,                  // alternate
        recoveryOutcome: i < 4 ? (i % 2 ? 'sand-save' : 'up-and-down') : 'none',
      }],
    ));
    const r = upAndDownRate(rounds, 'me');
    expect(r.attempts).toBe(8);
    expect(r.conversions).toBe(4);
    expect(r.rate).toBeCloseTo(0.5);
    expect(r.byLie.sand.attempts).toBe(4);
    expect(r.byLie.sand.conversions).toBe(2);
    expect(r.byLie.nonSand.attempts).toBe(4);
    expect(r.byLie.nonSand.conversions).toBe(2);
  });

  test('auto-derives conversions when recoveryOutcome was never stored', () => {
    // Missed GIR, chipped on, holed the putt for par — the scorecard chip
    // lights automatically but nothing is persisted. Must count.
    const rounds = Array.from({ length: 6 }, () => makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 1, sandShots: 0 }],
    ));
    const r = upAndDownRate(rounds, 'me');
    expect(r.attempts).toBe(6);
    expect(r.conversions).toBe(6);
    expect(r.rate).toBeCloseTo(1);
  });

  test('stored none overrides the auto-derived conversion', () => {
    const rounds = Array.from({ length: 6 }, () => makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 1, sandShots: 0, recoveryOutcome: 'none' }],
    ));
    const r = upAndDownRate(rounds, 'me');
    expect(r.attempts).toBe(6);
    expect(r.conversions).toBe(0);
    expect(r.rate).toBeCloseTo(0);
  });

  test('does not auto-credit 1-putts that fail to save par', () => {
    const rounds = Array.from({ length: 6 }, () => makeRound(
      [{ par: 4, strokes: 6 }],
      [{ putts: 1, sandShots: 0 }],
    ));
    const r = upAndDownRate(rounds, 'me');
    expect(r.attempts).toBe(6);
    expect(r.conversions).toBe(0);
  });
});

describe('tournamentHighlights', () => {
  // p1 plays all 18 (par golf, 72 strokes); p2 scores only the front 9 (45).
  function mixedCompletionTournament() {
    const h = holes18();
    const partial = {};
    h.slice(0, 9).forEach((hole) => { partial[hole.number] = 5; });
    return {
      players: [
        { id: 'p1', name: 'Full', handicap: 0 },
        { id: 'p2', name: 'Partial', handicap: 0 },
      ],
      rounds: [{
        courseName: 'C', holes: h,
        scores: { p1: evenScores(h, 4), p2: partial },
      }],
    };
  }

  test('strokes best round only ranks fully-scored rounds', () => {
    const r = tournamentHighlights(mixedCompletionTournament(), { metric: 'strokes' });
    // p2's 9-hole 45 must not beat p1's complete 72.
    expect(r.bestRound.entries.map((e) => e.player.id)).toEqual(['p1']);
    expect(r.bestRound.value).toBe(72);
  });

  test('points best round still counts partial rounds', () => {
    const t = mixedCompletionTournament();
    // Make the full round score badly: double bogeys → 0 pts; p2's partial
    // round (9 bogeys → 9 pts) should win on points.
    t.rounds[0].scores.p1 = evenScores(t.rounds[0].holes, 6);
    const r = tournamentHighlights(t, { metric: 'points' });
    expect(r.bestRound.entries.map((e) => e.player.id)).toEqual(['p2']);
    expect(r.bestRound.value).toBe(9);
  });
});

describe('pairPerformance', () => {
  test('skips singleton pairs from odd rosters instead of crashing', () => {
    const players = [
      { id: 'a', name: 'A', handicap: 0 },
      { id: 'b', name: 'B', handicap: 0 },
      { id: 'c', name: 'C', handicap: 0 },
    ];
    const tournament = {
      players,
      rounds: [{
        courseName: 'Test',
        holes: [{ number: 1, par: 4, strokeIndex: 1 }],
        pairs: [[players[0], players[1]], [players[2]]],
        scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
      }],
    };
    const result = pairPerformance(tournament);
    expect(result).toHaveLength(1);
    expect(result[0].players.map(p => p.id).sort()).toEqual(['a', 'b']);
  });

  test('a round only counts toward a pair when at least one member of THAT pair has a score', () => {
    // R1 has real scores for pair A/B only — pair C/D never touched a
    // scorecard this round, but round.scores is non-empty (A/B's entries),
    // so the round-level guard alone would let C/D through as a phantom
    // 0-point round via roundPairLeaderboard (roundTotals reports 0 for
    // every unscored player rather than omitting them).
    const players = [
      { id: 'a', name: 'A', handicap: 0 },
      { id: 'b', name: 'B', handicap: 0 },
      { id: 'c', name: 'C', handicap: 0 },
      { id: 'd', name: 'D', handicap: 0 },
    ];
    const [A, B, C, D] = players;
    const hole = [{ number: 1, par: 4, strokeIndex: 1 }];
    const tournament = {
      players,
      rounds: [{
        courseName: 'R1',
        holes: hole,
        pairs: [[A, B], [C, D]],
        scores: { a: { 1: 4 }, b: { 1: 4 } }, // C/D untouched this round
      }],
    };

    const result = pairPerformance(tournament);
    const cd = result.find(p => p.players.map(x => x.id).sort().join(',') === 'c,d');
    expect(cd).toBeUndefined();

    const ab = result.find(p => p.players.map(x => x.id).sort().join(',') === 'a,b');
    expect(ab.rounds).toBe(1);
  });
});

describe('pairCoverage', () => {
  // handicap 0 for both partners → no extra shots, points = 2 + par - strokes
  // (floored at 0). Hole 1: A birdies (3 pts) while B blanks (0 pts) — the
  // pair is "covered" because at least one partner cleared 2 pts. Hole 2:
  // both partners blank — a double-blank.
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
  ];
  const [A, B] = players;
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  test('reports coverage% (>=1 partner scored >=2 pts) and the both-blanked count', () => {
    const tournament = {
      players,
      rounds: [{
        courseName: 'R1',
        holes,
        pairs: [[A, B]],
        scores: {
          a: { 1: 3, 2: 6 }, // hole1: 3 pts (covers) · hole2: 0 pts (blanked)
          b: { 1: 6, 2: 6 }, // hole1: 0 pts · hole2: 0 pts (blanked)
        },
      }],
    };

    const result = pairCoverage(tournament);
    expect(result).toHaveLength(1);
    expect(result[0].pair.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(result[0].holes).toBe(2);
    expect(result[0].coveragePct).toBe(50);
    expect(result[0].bothBlanked).toBe(1);
  });

  test('only counts a hole when BOTH partners have a recorded score', () => {
    const tournament = {
      players,
      rounds: [{
        courseName: 'R1',
        holes,
        pairs: [[A, B]],
        scores: {
          a: { 1: 3 }, // hole2 unscored for A — hole2 must not count at all
          b: { 1: 6, 2: 6 },
        },
      }],
    };

    const result = pairCoverage(tournament);
    expect(result[0].holes).toBe(1);
    expect(result[0].coveragePct).toBe(100);
    expect(result[0].bothBlanked).toBe(0);
  });

  test('skips rounds with no pairs or no scores (scramble rounds already blanked by withoutScrambleScores)', () => {
    const t = mixedModeTournament();
    const clean = withoutScrambleScores(t);
    // R2 is the scramblepairs round — its pairs/scores are nulled by
    // withoutScrambleScores, so it must not contribute any holes. Only R1
    // (18 holes) and R3 (front 9) count: pair p1/p2 loses R3 hole 5 to p2's
    // gap (18+8=26), pair p3/p4 has no gap (18+9=27). If R2 leaked in, both
    // totals would be 18 holes higher.
    const result = pairCoverage(clean);
    const ab = result.find(p => p.pair.map(x => x.id).sort().join(',') === 'p1,p2');
    const cd = result.find(p => p.pair.map(x => x.id).sort().join(',') === 'p3,p4');
    expect(ab.holes).toBe(26);
    expect(cd.holes).toBe(27);
  });

  test('skips singleton pairs from odd rosters instead of crashing', () => {
    const three = [
      { id: 'a', name: 'A', handicap: 0 },
      { id: 'b', name: 'B', handicap: 0 },
      { id: 'c', name: 'C', handicap: 0 },
    ];
    const tournament = {
      players: three,
      rounds: [{
        courseName: 'Test',
        holes: [{ number: 1, par: 4, strokeIndex: 1 }],
        pairs: [[three[0], three[1]], [three[2]]],
        scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
      }],
    };
    expect(() => pairCoverage(tournament)).not.toThrow();
    expect(pairCoverage(tournament)).toHaveLength(1);
  });
});

describe('pairConfigMatrix — orients each round onto the config\'s canonical sides', () => {
  test('a rematch with pair1/pair2 flipped still credits the same side, not the opponent', () => {
    // A/B is the dominant team in BOTH rounds. R3 stores the pairing with
    // sides flipped (pair1 = C/D, pair2 = A/B) — same two teams, same
    // rematch, just recorded in the other order. The aggregate must still
    // show A/B winning both holes, not a 1-1 split from mislabeling R3's
    // pair1/pair2 as "side A"/"side B" verbatim.
    const players = [
      { id: 'a', name: 'A', handicap: 0 },
      { id: 'b', name: 'B', handicap: 0 },
      { id: 'c', name: 'C', handicap: 0 },
      { id: 'd', name: 'D', handicap: 0 },
    ];
    const [A, B, C, D] = players;
    const hole = [{ number: 1, par: 4, strokeIndex: 1 }];
    const round1 = {
      courseName: 'R1',
      holes: hole,
      pairs: [[A, B], [C, D]],
      scores: { a: { 1: 3 }, b: { 1: 3 }, c: { 1: 6 }, d: { 1: 6 } }, // AB pts 6, CD pts 0
    };
    const round3 = {
      courseName: 'R3',
      holes: hole,
      pairs: [[C, D], [A, B]], // same teams, sides flipped in storage order
      scores: { a: { 1: 3 }, b: { 1: 3 }, c: { 1: 6 }, d: { 1: 6 } }, // AB pts 6, CD pts 0
    };
    const tournament = { players, rounds: [round1, round3] };

    const configs = pairConfigMatrix(tournament);
    expect(configs).toHaveLength(1);
    const [config] = configs;
    expect(config.holeWins).toEqual({ A: 2, B: 0, T: 0 });
    expect(config.pointsA).toBe(12);
    expect(config.pointsB).toBe(0);
  });
});

describe('matchPlayResults / pairConfigMatrix — skip rounds with no scores recorded at all', () => {
  test('an empty scores object produces no phantom match-play card or config round', () => {
    const players = [
      { id: 'a', name: 'A', handicap: 0 },
      { id: 'b', name: 'B', handicap: 0 },
      { id: 'c', name: 'C', handicap: 0 },
      { id: 'd', name: 'D', handicap: 0 },
    ];
    const [A, B, C, D] = players;
    const hole = [{ number: 1, par: 4, strokeIndex: 1 }];
    const round1 = {
      courseName: 'Real',
      holes: hole,
      pairs: [[A, B], [C, D]],
      scores: { a: { 1: 3 }, b: { 1: 3 }, c: { 1: 6 }, d: { 1: 6 } },
    };
    const phantomRound = {
      courseName: 'Phantom',
      holes: hole,
      pairs: [[A, B], [C, D]],
      scores: {}, // round exists (e.g. created, never scored) — no scores at all
    };
    const tournament = { players, rounds: [round1, phantomRound] };

    const mp = matchPlayResults(tournament);
    expect(mp[0].available).toBe(true);
    expect(mp[1].available).toBe(false);

    const configs = pairConfigMatrix(tournament);
    expect(configs).toHaveLength(1);
    expect(configs[0].rounds).toHaveLength(1);
    expect(configs[0].rounds[0].roundIndex).toBe(0);
  });
});

describe('pairHoleWins — tournament-wide aggregation (roundIndex: null)', () => {
  test('aggregates across every round instead of only the first completed one', () => {
    const players = [
      { id: 'a', name: 'A', handicap: 0 },
      { id: 'b', name: 'B', handicap: 0 },
      { id: 'c', name: 'C', handicap: 0 },
      { id: 'd', name: 'D', handicap: 0 },
    ];
    const [A, B, C, D] = players;
    const hole = [{ number: 1, par: 4, strokeIndex: 1 }];
    const round1 = {
      courseName: 'R1',
      holes: hole,
      pairs: [[A, B], [C, D]],
      scores: { a: { 1: 3 }, b: { 1: 3 }, c: { 1: 6 }, d: { 1: 6 } }, // AB best ball wins hole1
    };
    const round2 = {
      courseName: 'R2',
      holes: hole,
      pairs: [[A, B], [C, D]],
      scores: { a: { 1: 3 }, b: { 1: 3 }, c: { 1: 6 }, d: { 1: 6 } }, // AB best ball wins again
    };
    const tournament = { players, rounds: [round1, round2] };

    const totalWins = pairHoleWins(tournament, { metric: 'points', roundIndex: null });
    const aRec = totalWins.find(r => r.player.id === 'a');
    // A is MB (best ball) in both rounds and wins both — total.W should
    // reflect both rounds, not just the first one.
    expect(aRec.best.W).toBe(2);
    expect(aRec.breakdown.map(b => b.roundIndex)).toEqual([0, 1]);
  });
});

describe('sgAroundGreen', () => {
  test('null on GIR-hit holes', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, sandShots: 0, firstPuttBucket: '2-3' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0]).toBeNull();
  });
  test('SG = expected(start lie, ~20m) - expected(green, putt bucket) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    // start: sand @18.3m=2.55, @27.4m=2.70; t=(20-18.3)/(27.4-18.3)≈0.187 → 2.578
    // end: green @0.5m clamp → 1.05. SG = 2.578 - 1.05 - 1 ≈ 0.53
    const r = sgAroundGreen(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.53, 1);
  });
  test('does not infer a recovery shot when explicit approach result reached the green', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{
        putts: 2,
        sandShots: 0,
        approachBucket: '50-100',
        approachResult: 'green',
        firstPuttBucket: '3-6',
      }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0]).toBeNull();
  });
  test('a non-sand greenside recovery starts from the greenside node', () => {
    // Chaining check: the around-green START must equal the approach-miss END,
    // so re-anchoring the missed-green node to a realistic greenside value
    // flows through here too. greenside@20m (scratch) ≈ 2.41; end green@2.5m
    // ≈ 1.61; one recovery shot → SG = 2.41 − 1.61 − 1 ≈ −0.20. The old
    // recovery node (~2.85) made this a falsely positive ≈ +0.24.
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 2, sandShots: 0, firstPuttBucket: '2-3' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0]).toBeCloseTo(-0.20, 1);
  });
  test('charges every recorded sand shot on missed-GIR sand recoveries', () => {
    const oneSand = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    const twoSand = makeRound(
      [{ par: 4, strokes: 6 }],
      [{ putts: 1, sandShots: 2, firstPuttBucket: '0-1', recoveryOutcome: 'none' }],
    );

    expect(sgAroundGreen(twoSand, 'me').perHole[0])
      .toBeCloseTo(sgAroundGreen(oneSand, 'me').perHole[0] - 1, 5);
  });
});

describe('sgApproach', () => {
  test('par-3 tee shot uses the logged hole-distance bucket as approach SG', () => {
    const round = makeRound(
      [{ par: 3, strokes: 3 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    const r = sgApproach(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.05, 1);
    expect(r.sampleHoles).toBe(1);
  });
  test('par-3 does not use stored course distance without a logged bucket', () => {
    const round = makeRound(
      [{ par: 3, strokes: 3, distance: 150 }],
      [{ putts: 2, firstPuttBucket: '3-6' }],
    );
    expect(sgApproach(round, 'me').perHole[0]).toBeNull();
  });
  test('GIR hit from 100-150 bucket → SG = expected(fairway, 125) - expected(green, putt midpoint) - 1', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    // fairway@125: interp between 91.4(2.80) and 137.2(2.92): t≈0.734 → 2.888
    // green@4.5m: interp between 3.05(1.70) and 4.57(1.83): t≈0.954 → 1.824
    // SG = 2.888 - 1.824 - 1 ≈ 0.064
    const r = sgApproach(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(0.06, 1);
  });
  test('explicit green result can score a non-GIR recovery-hole approach', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{
        putts: 2,
        approachBucket: '50-100',
        approachResult: 'green',
        firstPuttBucket: '3-6',
      }],
    );
    const r = sgApproach(round, 'me');
    // fairway@75m ≈ 2.71, green@4.5m ≈ 1.82. SG = 2.71 - 1.82 - 1 ≈ -0.11
    expect(r.perHole[0]).toBeCloseTo(-0.11, 1);
  });
  test('explicit missed result does not use first putt as the approach end state', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{
        putts: 2,
        approachBucket: '100-150',
        approachResult: 'miss',
        firstPuttBucket: '0-1',
      }],
    );
    const r = sgApproach(round, 'me');
    expect(r.perHole[0]).toBeLessThan(0);
  });
  test('a missed green lands on the greenside node, not a recovery-from-trouble node', () => {
    // A routine missed green must NOT be scored as if the player is now in a
    // recovery lie (trees). fairway@125 (scratch) ≈ 2.888; greenside@20m
    // (scratch) ≈ 2.41; SG = 2.888 − 2.41 − 1 ≈ −0.52. The old recovery node
    // (~2.85) produced ≈ −0.96, over-penalising every miss by ~0.45 strokes.
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 2, sandShots: 0, approachBucket: '100-150', approachResult: 'miss', firstPuttBucket: '2-3' }],
    );
    expect(sgApproach(round, 'me').perHole[0]).toBeCloseTo(-0.52, 1);
  });
});

describe('sgPutting', () => {
  test('returns null per hole when firstPuttBucket missing', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2 }],
    );
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeNull();
    expect(r.sampleHoles).toBe(0);
  });
  test('SG = expectedStrokes(green, midpoint) - putts on a 2-putt from 2-3', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    // midpoint 2.5m: interp between 1.83(1.50) and 3.05(1.70): t≈0.548 → 1.61 → SG = 1.61 − 2 = −0.39
    const r = sgPutting(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(-0.39, 1);
    expect(r.sampleHoles).toBe(1);
  });
});

describe('sgPenalties', () => {
  test('subtracts all logged penalties now that off-the-tee SG is not tracked', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: { me: { 1: 6 } },
      shotDetails: { me: { 1: { teePenalties: 1, otherPenalties: 2 } } },
    };

    const r = sgPenalties(round, 'me');

    expect(r.perHole[0]).toBe(-3);
    expect(r.total).toBe(-3);
    expect(r.sampleHoles).toBe(1);
  });

  test('counts penalty-free tracked holes in the sample with 0', () => {
    const round = {
      holes: [
        { number: 1, par: 4, strokeIndex: 1 },
        { number: 2, par: 4, strokeIndex: 2 },
        { number: 3, par: 4, strokeIndex: 3 },
      ],
      scores: { me: { 1: 6, 2: 4, 3: 4 } },
      shotDetails: { me: {
        1: { teePenalties: 1 },
        2: { putts: 2 },        // tracked, clean → 0, in sample
        // hole 3 untracked → excluded from sample
      } },
    };

    const r = sgPenalties(round, 'me');

    expect(r.perHole).toEqual([-1, 0, null]);
    expect(r.total).toBe(-1);
    expect(r.sampleHoles).toBe(2);
  });
});

describe('sgTotal', () => {
  test('sums only tracked SG categories and excludes off-the-tee', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6',
        sandShots: 0,
      } } },
    };
    const r = sgTotal(round, 'me');
    expect(r.byCategory).not.toHaveProperty('tee');
    expect(r.byCategory).toHaveProperty('penalties');
    expect(r.total).toBeCloseTo(
      r.byCategory.approach + r.byCategory.aroundGreen + r.byCategory.putting
        + r.byCategory.penalties,
      5,
    );
    expect(r.sampleHoles).toBeGreaterThan(0);
  });

  test('includes logged other penalties in SG total', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 5 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0, otherPenalties: 1,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6',
        sandShots: 0,
      } } },
    };
    const withoutPenalty = sgTotal({
      ...round,
      shotDetails: { me: { 1: { ...round.shotDetails.me[1], otherPenalties: 0 } } },
    }, 'me');
    const withPenalty = sgTotal(round, 'me');

    expect(withPenalty.byCategory.penalties).toBe(-1);
    expect(withPenalty.total).toBeCloseTo(withoutPenalty.total - 1, 5);
  });
});

describe('sgPutting with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    expect(sgPutting(round, 'me').perHole[0])
      .toBeCloseTo(sgPutting(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap → less-negative SG (bar is lower)', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    const scratchSG = sgPutting(round, 'me', 0).perHole[0];
    const amateurSG = sgPutting(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgAroundGreen with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0])
      .toBeCloseTo(sgAroundGreen(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG toward less-negative', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    const scratchSG = sgAroundGreen(round, 'me', 0).perHole[0];
    const amateurSG = sgAroundGreen(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgApproach with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    expect(sgApproach(round, 'me').perHole[0])
      .toBeCloseTo(sgApproach(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG toward zero or positive', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    const scratchSG = sgApproach(round, 'me', 0).perHole[0];
    const amateurSG = sgApproach(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});

describe('sgTotal with targetHandicap', () => {
  test('threads targetHandicap into all tracked SG categories', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      } } },
    };
    const r0 = sgTotal(round, 'me', 0);
    const r14 = sgTotal(round, 'me', 14);
    expect(r14.total).toBeGreaterThan(r0.total);
    expect(r14.total).toBeCloseTo(
      r14.byCategory.approach + r14.byCategory.aroundGreen
        + r14.byCategory.putting + r14.byCategory.penalties,
      5,
    );
    expect(r14.byCategory).not.toHaveProperty('tee');
  });
});

describe('sgSeason with targetHandicap', () => {
  test('threads targetHandicap through sgTotal', () => {
    const mkRound = () => ({
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      }])) },
    });
    const r0 = sgSeason([mkRound(), mkRound()], 'me', 0);
    const r14 = sgSeason([mkRound(), mkRound()], 'me', 14);
    expect(r14.total).toBeGreaterThan(r0.total);
  });
});

describe('sgSeason', () => {
  test('returns null total below 18-hole sample', () => {
    expect(sgSeason([], 'me').total).toBeNull();
  });
  test('does not dilute approach SG with rounds that have no approach samples', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
    }));
    const scores = { me: Object.fromEntries(holes.map((hole) => [hole.number, 4])) };
    const approachRound = {
      holes,
      scores,
      shotDetails: { me: Object.fromEntries(holes.map((hole) => [hole.number, {
        approachBucket: '100-150',
        putts: 2,
        firstPuttBucket: '3-6',
        sandShots: 0,
      }])) },
    };
    const puttingOnlyRound = {
      holes,
      scores,
      shotDetails: { me: Object.fromEntries(holes.map((hole) => [hole.number, {
        putts: 2,
        firstPuttBucket: '3-6',
        sandShots: 0,
      }])) },
    };

    const before = sgSeason([approachRound], 'me');
    const after = sgSeason([approachRound, puttingOnlyRound], 'me');

    expect(after.byCategory.approach).toBeCloseTo(before.byCategory.approach, 5);
  });
  test('averages penalties over every tracked round, not just rounds with penalties', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
    }));
    const scores = { me: Object.fromEntries(holes.map((hole) => [hole.number, 4])) };
    const clean = Object.fromEntries(holes.map((hole) => [hole.number, {
      putts: 2, firstPuttBucket: '3-6', sandShots: 0,
    }]));
    const mkTracked = (details) => ({ holes, scores, shotDetails: { me: details } });
    // 1 penalty across 10 tracked rounds → −0.1/round, not −1.0.
    const rounds = [
      mkTracked({ ...clean, 1: { ...clean[1], teePenalties: 1 } }),
      ...Array.from({ length: 9 }, () => mkTracked(clean)),
    ];

    const r = sgSeason(rounds, 'me');

    expect(r.byCategory.penalties).toBeCloseTo(-0.1, 5);
  });
  test('aggregates across rounds when enough sample holes exist', () => {
    const mkRound = () => ({
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0,
        approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6',
        sandShots: 0,
      }])) },
    });
    const r = sgSeason([mkRound(), mkRound()], 'me');
    expect(r.perRound.length).toBe(2);
    expect(r.sampleHoles).toBeGreaterThanOrEqual(18);
    expect(r.total).not.toBeNull();
  });

  test('headline total need not equal the sum of the reported per-category averages', () => {
    // Round A has approach + putting + penalties data; round B is putting-only
    // (no approachBucket) — the per-category round counts diverge (approach
    // denom=1, putting/penalties denom=2). Summing per-category averages over
    // mismatched denominators produces a number no real round could produce,
    // so the headline total is now a mean of each round's own total instead
    // (see the "single consistent denominator" test below for the precise
    // contract). This test just guards against re-introducing the old
    // sum-of-mismatched-averages identity as an invariant.
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
    }));
    const scores = { me: Object.fromEntries(holes.map((hole) => [hole.number, 4])) };
    const approachRound = {
      holes,
      scores,
      shotDetails: { me: Object.fromEntries(holes.map((hole) => [hole.number, {
        approachBucket: '100-150', putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      }])) },
    };
    const puttingOnlyRound = {
      holes,
      scores,
      shotDetails: { me: Object.fromEntries(holes.map((hole) => [hole.number, {
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      }])) },
    };
    const r = sgSeason([approachRound, puttingOnlyRound], 'me');
    const categorySum = r.byCategory.approach + r.byCategory.aroundGreen
      + r.byCategory.putting + r.byCategory.penalties;
    // approach.total is nonzero here (approachRound has approachBucket data),
    // so summing per-category averages over mismatched denominators diverges
    // from the coherent per-round mean headline.
    expect(r.total).not.toBeCloseTo(categorySum, 5);
  });

  test('headline total uses ONE consistent denominator (rounds with any SG sample) across categories', () => {
    // 5 rounds: putting tracked in only 2 of them, penalties tracked in all 5
    // (every tracked hole counts as a penalties sample, clean holes included —
    // see sgPenalties). Before the fix, the headline total summed
    // (puttingSum / 2) + (penaltiesSum / 5), mismatched denominators that no
    // single round could have produced. After the fix, the headline is the
    // mean of each round's own total — one shared denominator throughout.
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
    }));
    const scores = { me: Object.fromEntries(holes.map((hole) => [hole.number, 4])) };
    const puttingRound = {
      holes,
      scores,
      shotDetails: { me: Object.fromEntries(holes.map((hole) => [hole.number, {
        putts: 2, firstPuttBucket: '3-6', sandShots: 0, teePenalties: 0,
      }])) },
    };
    const penaltyOnlyRound = (teePenalties) => ({
      holes,
      scores,
      shotDetails: { me: Object.fromEntries(holes.map((hole, i) => [hole.number, {
        sandShots: 0, teePenalties: i === 0 ? teePenalties : 0,
      }])) },
    });
    const rounds = [
      puttingRound, puttingRound,
      penaltyOnlyRound(1), penaltyOnlyRound(0), penaltyOnlyRound(2),
    ];

    const r = sgSeason(rounds, 'me');

    // The coherent contract: headline total = mean of each round's own total
    // (rounds with ANY SG sample), independent of which categories each
    // round happened to track.
    const perRoundTotals = rounds.map((round) => sgTotal(round, 'me').total);
    const expectedTotal = perRoundTotals.reduce((a, b) => a + b, 0) / perRoundTotals.length;
    expect(r.total).toBeCloseTo(expectedTotal, 5);

    // Guard against regressing to the old, broken sum-of-mismatched-averages:
    // putting divided by 2 tracked rounds, penalties divided by 5 tracked
    // rounds, summed together — a figure no actual round produced.
    const brokenSumOfAverages = r.byCategory.approach + r.byCategory.aroundGreen
      + r.byCategory.putting + r.byCategory.penalties;
    expect(r.total).not.toBeCloseTo(brokenSumOfAverages, 5);

    // Per-category detail values remain their own (sensible) per-category
    // averages, each over its own denominator (2 rounds of putting data,
    // not all 5) — only the headline total changes to a single shared
    // denominator.
    expect(r.byCategory.putting).toBeCloseTo(sgPutting(puttingRound, 'me').total, 5);
  });
});

describe('driveScoreImpact', () => {
  test('reports no data when no drives are logged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    const r = driveScoreImpact(t, 'p1');
    expect(r.hasData).toBe(false);
    expect(r.totalHoles).toBe(0);
  });

  test('aggregates points, strokes-vs-par and penalty rate per bucket', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[5] = 5; scores[6] = 5;   // left: bogey
    scores[7] = 6; scores[8] = 6;   // right: double
    scores[9] = 5; scores[10] = 5;  // short: bogey
    const shotDetails = {
      p1: {
        1: { drive: 'super' }, 2: { drive: 'super' },
        3: { drive: 'fairway' }, 4: { drive: 'fairway' },
        5: { drive: 'left', teePenalties: 1 }, 6: { drive: 'left' },
        7: { drive: 'right' }, 8: { drive: 'right' },
        9: { drive: 'short' }, 10: { drive: 'short' },
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = driveScoreImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.totalHoles).toBe(10);
    expect(r.buckets.super).toMatchObject({ holes: 2, avgPoints: 2, avgVsPar: 0, penaltyRate: 0 });
    expect(r.buckets.fairway).toMatchObject({ holes: 2, avgPoints: 2, avgVsPar: 0, penaltyRate: 0 });
    expect(r.buckets.left).toMatchObject({ holes: 2, avgPoints: 1, avgVsPar: 1, penaltyRate: 50 });
    expect(r.buckets.right).toMatchObject({ holes: 2, avgPoints: 0, avgVsPar: 2, penaltyRate: 0 });
    expect(r.buckets.short).toMatchObject({ holes: 2, avgPoints: 1, avgVsPar: 1, penaltyRate: 0 });
  });

  test('ignores par-3 holes (no driver off the tee)', () => {
    const h = holes18().map((hole, i) => (i === 0 ? { ...hole, par: 3 } : hole));
    const shotDetails = { p1: { 1: { drive: 'fairway' } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    expect(driveScoreImpact(t, 'p1').buckets.fairway.holes).toBe(0);
  });
});

describe('girByDriveResult', () => {
  // Non-par-3 holes only (drive isn't logged on a par 3) — 1,3,4 fairway +
  // 10 super count as hits, 6,7,9 as misses. GIR = strokes - putts <= par - 2.
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 3, strokeIndex: 2 },
    { number: 3, par: 5, strokeIndex: 3 },
    { number: 4, par: 4, strokeIndex: 4 },
    { number: 6, par: 5, strokeIndex: 6 },
    { number: 7, par: 4, strokeIndex: 7 },
    { number: 9, par: 5, strokeIndex: 9 },
    { number: 10, par: 4, strokeIndex: 10 },
  ];

  test('splits GIR% by fairway hit vs a miss (super is a hit; left/right/short are misses)', () => {
    const scores = {
      1: 4,  // fairway, par4, putts 2 → 4-2=2 <= 2 → GIR
      3: 6,  // fairway, par5, putts 3 → 6-3=3 <= 3 → GIR
      4: 5,  // fairway, par4, putts 2 → 5-2=3 <= 2 → NOT GIR
      6: 7,  // left, par5, putts 2 → 7-2=5 <= 3 → NOT GIR
      7: 4,  // right, par4, putts 2 → 4-2=2 <= 2 → GIR
      9: 5,  // short, par5, putts 2 → 5-2=3 <= 3 → GIR
      10: 6, // super, par4, putts 2 → 6-2=4 <= 2 → NOT GIR
    };
    const shotDetails = {
      p1: {
        1: { drive: 'fairway', putts: 2 },
        3: { drive: 'fairway', putts: 3 },
        4: { drive: 'fairway', putts: 2 },
        6: { drive: 'left', putts: 2 },
        7: { drive: 'right', putts: 2 },
        9: { drive: 'short', putts: 2 },
        10: { drive: 'super', putts: 2 },
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes, scores: { p1: scores }, shotDetails }],
    };

    const r = girByDriveResult(t, 'p1');
    expect(r.fairway.holes).toBe(4); // holes 1, 3, 4 + the super drive on 10
    expect(r.fairway.girPct).toBe(50); // 2/4
    expect(r.miss.holes).toBe(3);
    expect(r.miss.girPct).toBe(67); // 2/3
  });

  test('a super drive lands in the fairway bucket, not the miss bucket (hit-equivalent, as in shotStats/teeShotImpact)', () => {
    const h = [{ number: 1, par: 4, strokeIndex: 1 }];
    const shotDetails = { p1: { 1: { drive: 'super', putts: 2 } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: { 1: 4 } }, shotDetails }],
    };

    const r = girByDriveResult(t, 'p1');
    expect(r.fairway.holes).toBe(1);
    expect(r.fairway.girPct).toBe(100);
    expect(r.miss.holes).toBe(0);
  });

  test('skips holes where drive or putts is missing, and excludes par-3s even if a drive is logged there', () => {
    const h = [
      { number: 1, par: 4, strokeIndex: 1 }, // drive only, no putts → skip
      { number: 2, par: 4, strokeIndex: 2 }, // putts only, no drive → skip
      { number: 3, par: 3, strokeIndex: 3 }, // par 3 with a (bogus) drive logged → skip
    ];
    const shotDetails = {
      p1: {
        1: { drive: 'fairway' },
        2: { putts: 2 },
        3: { drive: 'fairway', putts: 1 },
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: { 1: 4, 2: 4, 3: 3 } }, shotDetails }],
    };

    const r = girByDriveResult(t, 'p1');
    expect(r.fairway.holes).toBe(0);
    expect(r.miss.holes).toBe(0);
  });

  test('skips scramble rounds (shotDetails blanked by withoutScrambleScores)', () => {
    const t = mixedModeTournament();
    const clean = withoutScrambleScores(t);
    // mixedModeTournament's fixtures never log shotDetails at all, so both
    // buckets stay empty — the point is this must not throw when a round's
    // shotDetails is null (R2, the scramble round).
    expect(() => girByDriveResult(clean, 'p1')).not.toThrow();
    const r = girByDriveResult(clean, 'p1');
    expect(r.fairway.holes).toBe(0);
    expect(r.miss.holes).toBe(0);
  });
});

describe('puttDeepDive', () => {
  test('reports no data when no putts are logged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(puttDeepDive(t, 'p1').hasData).toBe(false);
  });

  test('breaks down 2-putt rate, GIR vs non-GIR averages, and 1-putt save rate', () => {
    const h = holes18();
    // 1-6:  4 strokes / 2 putts (GIR, 2-putt)
    // 7-9:  5 strokes / 1 putt  (non-GIR, 1-putt save)
    // 10-12: 5 strokes / 2 putts (non-GIR, 2-putt)
    // 13-15: 4 strokes / 3 putts (GIR, 3-putt)
    // 16-18: untracked
    const scores = { ...evenScores(h, 4) };
    [7, 8, 9, 10, 11, 12].forEach((n) => { scores[n] = 5; });
    const shotDetails = { p1: {} };
    [1, 2, 3, 4, 5, 6].forEach((n) => { shotDetails.p1[n] = { putts: 2 }; });
    [7, 8, 9].forEach((n) => { shotDetails.p1[n] = { putts: 1 }; });
    [10, 11, 12].forEach((n) => { shotDetails.p1[n] = { putts: 2 }; });
    [13, 14, 15].forEach((n) => { shotDetails.p1[n] = { putts: 3 }; });
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = puttDeepDive(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.holes).toBe(15);
    // 9 two-putt holes (1-6 and 10-12) / 15 = 60%
    expect(r.twoPuttPct).toBe(60);
    // GIR holes: 1-6 (2 putts × 6) + 13-15 (3 putts × 3) = 21 putts / 9 holes ≈ 2.3
    expect(r.girHoles).toBe(9);
    expect(r.girPuttsAvg).toBe(2.3);
    // Non-GIR: 7-9 (1 × 3) + 10-12 (2 × 3) = 9 putts / 6 holes = 1.5
    expect(r.nonGirHoles).toBe(6);
    expect(r.nonGirPuttsAvg).toBe(1.5);
    // 1-putt save rate: 3 non-GIR 1-putts / 6 non-GIR = 50%
    expect(r.onePuttSave).toMatchObject({ attempts: 6, saves: 3, pct: 50 });
    // All tracked holes are par 4
    expect(r.byPar[3]).toBeNull();
    expect(r.byPar[4]).toMatchObject({ holes: 15, avg: 2 });
    expect(r.byPar[5]).toBeNull();
  });

  test('splits avg putts by par when the round mixes par 3 / 4 / 5', () => {
    const h = holes18().map((hole, i) => {
      if (i === 0) return { ...hole, par: 3 };
      if (i === 1) return { ...hole, par: 5 };
      return hole;
    });
    const scores = { ...evenScores(h, 4) };
    scores[1] = 3; scores[2] = 5;
    const shotDetails = {
      p1: {
        1: { putts: 1 },        // par 3
        2: { putts: 2 },        // par 5
        3: { putts: 2 },        // par 4
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = puttDeepDive(t, 'p1');
    expect(r.byPar[3]).toMatchObject({ holes: 1, avg: 1 });
    expect(r.byPar[4]).toMatchObject({ holes: 1, avg: 2 });
    expect(r.byPar[5]).toMatchObject({ holes: 1, avg: 2 });
  });
});

describe('approachScoreImpact', () => {
  test('reports no data when no approach buckets are tagged', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(approachScoreImpact(t, 'p1').hasData).toBe(false);
  });

  test('aggregates points, strokes-vs-par and GIR rate per bucket', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[4] = 5; scores[5] = 5;   // 100-150 bogeys (non-GIR with 2 putts)
    scores[8] = 6;                  // 200+ double (non-GIR with 2 putts)
    const shotDetails = {
      p1: {
        1: { approachBucket: '100-150', putts: 2 },  // par with 2 putts → GIR
        2: { approachBucket: '100-150', putts: 2 },
        3: { approachBucket: '100-150', putts: 2 },
        4: { approachBucket: '100-150', putts: 2 },  // bogey, non-GIR
        5: { approachBucket: '100-150', putts: 2 },
        6: { approachBucket: '0-50',    putts: 2 },  // par, GIR
        7: { approachBucket: '0-50',    putts: 2 },
        8: { approachBucket: '200+',    putts: 2 },  // double, non-GIR
        9: { approachBucket: '150-200' },            // no putts → GIR not computable
      },
    };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = approachScoreImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.totalHoles).toBe(9);

    // 100-150: 5 holes; 3 pars + 2 bogeys → avg pts 1.6, avg vs par 0.4, GIR 3/5 = 60%
    expect(r.buckets['100-150']).toMatchObject({
      holes: 5, avgPoints: 1.6, avgVsPar: 0.4, girRate: 60, girEligible: 5,
    });
    expect(r.buckets['0-50']).toMatchObject({
      holes: 2, avgPoints: 2, avgVsPar: 0, girRate: 100,
    });
    expect(r.buckets['200+']).toMatchObject({
      holes: 1, avgPoints: 0, avgVsPar: 2, girRate: 0,
    });
    // 150-200 has the hole counted, but GIR not computable without putts.
    expect(r.buckets['150-200']).toMatchObject({
      holes: 1, avgPoints: 2, avgVsPar: 0, girRate: null, girEligible: 0,
    });
    expect(r.buckets['50-100'].holes).toBe(0);
  });
});

describe('puttingTargetGaps', () => {
  test('compares average putts by first-putt distance against the target handicap baseline', () => {
    const h = holes18();
    const shotDetails = { p1: {} };
    h.forEach((hole) => {
      shotDetails.p1[hole.number] = {
        putts: hole.number <= 12 ? 2 : 3,
        firstPuttBucket: hole.number <= 12 ? '3-6' : '6+',
      };
    });
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };

    const r = puttingTargetGaps(t.rounds, 'p1', 14);

    expect(r.hasData).toBe(true);
    expect(r.buckets['3-6']).toMatchObject({
      attempts: 12,
      avgPutts: 2,
      expectedPutts: 1.95,
      sgPerPutt: -0.05,
      threePuttRate: 0,
    });
    expect(r.buckets['6+']).toMatchObject({
      attempts: 6,
      avgPutts: 3,
      expectedPutts: 2.19,
      sgPerPutt: -0.81,
      threePuttRate: 100,
    });
  });
});

describe('approachTargetGaps', () => {
  test('uses tee baseline for par-3 hole-distance buckets', () => {
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{
        courseName: 'C',
        holes: [{ number: 1, par: 3, strokeIndex: 1 }],
        scores: { p1: { 1: 3 } },
        shotDetails: {
          p1: {
            1: { approachBucket: '100-150', putts: 2, firstPuttBucket: '3-6', sandShots: 0 },
          },
        },
      }],
    };

    const r = approachTargetGaps(t.rounds, 'p1', 0);

    expect(r.buckets['100-150']).toMatchObject({
      holes: 1,
      avgSg: 0.05,
      greenRate: 100,
    });
  });

  test('compares approach buckets against the target handicap baseline', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[7] = 5; scores[8] = 5; scores[9] = 5;
    const shotDetails = { p1: {} };
    [1, 2, 3, 4, 5, 6].forEach((n) => {
      shotDetails.p1[n] = { approachBucket: '100-150', putts: 2, firstPuttBucket: '3-6', sandShots: 0 };
    });
    [7, 8, 9].forEach((n) => {
      shotDetails.p1[n] = { approachBucket: '200+', approachResult: 'miss', putts: 2, firstPuttBucket: '3-6', sandShots: 0 };
    });
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };

    const r = approachTargetGaps(t.rounds, 'p1', 14);

    expect(r.hasData).toBe(true);
    expect(r.buckets['100-150']).toMatchObject({
      holes: 6,
      avgSg: 0.31,
      girRate: 100,
    });
    // Missing the green from 200+ but advancing to a greenside lie is a good
    // outcome for a 14-hcp (baseline ~4.11 from 230m): 4.11 − 2.69 − 1 ≈ +0.43.
    // (Was −0.09 when a miss was scored as a recovery-from-trouble node.)
    expect(r.buckets['200+']).toMatchObject({
      holes: 3,
      avgSg: 0.43,
      greenRate: 0,
    });
  });

  test('uses explicit approach result instead of GIR for green rate and SG end state', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4), 1: 5 };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{
        courseName: 'C',
        holes: h,
        scores: { p1: scores },
        shotDetails: {
          p1: {
            1: {
              approachBucket: '50-100',
              approachResult: 'green',
              putts: 2,
              firstPuttBucket: '3-6',
              sandShots: 0,
            },
          },
        },
      }],
    };

    const r = approachTargetGaps(t.rounds, 'p1', 0);

    expect(r.buckets['50-100']).toMatchObject({
      holes: 1,
      avgSg: -0.11,
      greenRate: 100,
    });
  });
});

describe('withoutScrambleScores', () => {
  it('blanks scores, shotDetails and pairs on scramble rounds only', () => {
    const t = mixedModeTournament();
    const clean = withoutScrambleScores(t);
    expect(clean.rounds).toHaveLength(3);
    expect(clean.rounds[1].scores).toBeNull();
    expect(clean.rounds[1].shotDetails).toBeNull();
    expect(clean.rounds[1].pairs).toBeNull();
    expect(clean.rounds[0].scores).toBe(t.rounds[0].scores);
  });
  it('keeps captain team-ball points out of personal aggregates', () => {
    const t = mixedModeTournament();
    const dirty = playerAvgStableford(t, 'p1');
    const clean = playerAvgStableford(withoutScrambleScores(t), 'p1');
    expect(clean).not.toEqual(dirty); // R2 team ball no longer credited to p1
  });
});

// ── RC2: unified pickup detection ──
// pickupStrokes(par, handicap, strokeIndex) = par + 2 + extraShots. These
// fixtures pick handicaps/holes that land the pickup value exactly where
// each scenario needs it — see per-test comments for the arithmetic.

describe('pickupChampion — uses isPickupScore (>=) not === ', () => {
  it('still counts a hole recorded one stroke OVER the pickup value', () => {
    // par 4, SI 1, handicap 0 → extraShots 0 → pickupStrokes === 6.
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 7 } }, // pickup value is 6 — this is an over-pickup 7
    };
    const t = buildTournament({ players, rounds: [round] });

    const champ = pickupChampion(t);

    expect(champ).not.toBeNull();
    expect(champ.value).toBe(1);
    expect(champ.entries[0].player.id).toBe('p1');
  });
});

describe('hallOfShame.blowup — ignores pickup-valued scores, requires gross vsPar >= 3', () => {
  it('skips a pickup-valued 9 but keeps a real gross +4', () => {
    const holes = [
      { number: 1, par: 5, strokeIndex: 1 }, // p1's hole
      { number: 2, par: 4, strokeIndex: 2 }, // p2's hole
    ];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 36 }, // extraShots 2 → pickup = 5+2+2 = 9
      { id: 'p2', name: 'Bob', handicap: 54 },   // extraShots 3 → pickup = 4+2+3 = 9
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 36, p2: 54 },
      scores: {
        p1: { 1: 9 },  // exactly the pickup value on hole 1 — must be excluded
        p2: { 2: 8 },  // real gross +4 (8 - par 4), below its own pickup value (9)
      },
    };
    const t = buildTournament({ players, rounds: [round] });

    const shame = hallOfShame(t, { metric: 'points' });

    expect(shame.blowup).not.toBeNull();
    expect(shame.blowup.value).toBe(8);
    expect(shame.blowup.entries).toHaveLength(1);
    expect(shame.blowup.entries[0].player.id).toBe('p2');
  });

  it('does not award blowup when the only strokes are pickups', () => {
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }]; // pickup = 6
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 6 } },
    };
    const t = buildTournament({ players, rounds: [round] });

    const shame = hallOfShame(t, { metric: 'points' });

    expect(shame.blowup).toBeNull();
  });
});

describe('chaosHoles — pickups do not distort the stroke range', () => {
  it('needs at least 2 non-pickup scores to emit a hole', () => {
    // Both scores on hole 1 are pickups (handicap 0 → pickup 6, handicap 36
    // → pickup 9), so despite a wide raw-stroke range the hole must not
    // appear in the output.
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },  // pickup 6
      { id: 'p2', name: 'Bob', handicap: 36 },   // pickup 8
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0, p2: 36 },
      scores: { p1: { 1: 6 }, p2: { 1: 8 } },
    };
    const t = buildTournament({ players, rounds: [round] });

    expect(chaosHoles(t)).toEqual([]);
  });

  it('ranks strokes using only non-pickup scores', () => {
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },  // pickup 6
      { id: 'p2', name: 'Bob', handicap: 0 },
      { id: 'p3', name: 'Cara', handicap: 0 },
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0, p2: 0, p3: 0 },
      scores: { p1: { 1: 9 }, p2: { 1: 3 }, p3: { 1: 5 } }, // p1 is a pickup (>= 6)
    };
    const t = buildTournament({ players, rounds: [round] });

    const [hole] = chaosHoles(t);

    expect(hole.minStrokes).toBe(3);
    expect(hole.maxStrokes).toBe(5);
    expect(hole.range).toBe(2); // NOT 6 (which the pickup's 9 would produce)
  });
});

describe('skinsLeaderboard strokes mode — a pickup can tie/lose a hole but never win it', () => {
  it('awards no skin when the lowest strokes on the hole is a pickup', () => {
    // par 4, SI 1: scratch player's pickup value is 6, hcp-18 player's is 7.
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 18 },
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0, p2: 18 },
      scores: { p1: { 1: 6 }, p2: { 1: 7 } }, // both pickup-valued
    };
    const t = buildTournament({ players, rounds: [round] });

    const skins = skinsLeaderboard(t, { metric: 'strokes' });

    expect(skins.totalSkins).toBe(0);
    expect(skins.leaderboard.every((r) => r.skins === 0)).toBe(true);
  });
});

// ── RC3: streaks and bounce-back respect hole adjacency and round
// boundaries — a run may not bridge an unscored hole or cross into a new
// round, even though such holes are simply absent from the per-player
// entries array. ──

describe('playerStreaks — adjacency-aware runs', () => {
  it('does not bridge the unscored hole 5 gap in R3: par streak is 2, not 4', () => {
    // mixedModeTournament R3: p2 plays holes 1-4,6-9 at gross strokes 4 on
    // pars [4,3,5,4,3,5,4,3,5] — vsPar<=0 ("par or better") holds at holes
    // 1,3,4,6,7,9 and fails at 2,8. Holes 3,4 are physically adjacent (a
    // real 2-hole run); holes 4 and 6 are NOT (hole 5 is missing), so a
    // correct implementation must not chain 3,4,6,7 into a run of 4.
    const t = mixedModeTournament();

    const streaks = playerStreaks(t, 'p2', { metric: 'strokes', roundIndex: 2 });

    expect(streaks.bestParStreak).toBe(2);
    expect(streaks.parStreakHoles.map((h) => h.holeNumber)).toEqual([3, 4]);
  });

  it('does not chain the last hole of one round into the first hole of the next', () => {
    // Round A: hole 1 bogey (breaks any streak), hole 2 par. Round B: hole 1
    // par, hole 2 bogey. A's par (hole 2) and B's par (hole 1) sit back to
    // back in the flat per-player entries array with no gap between them —
    // an implementation that ignores round boundaries would chain them into
    // a streak of 2 despite them belonging to different rounds/courses.
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const roundA = {
      courseName: 'Course A',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 5, 2: 4 } }, // bogey, par
    };
    const roundB = {
      courseName: 'Course B',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 4, 2: 5 } }, // par, bogey
    };
    const t = buildTournament({ players, rounds: [roundA, roundB] });

    const streaks = playerStreaks(t, 'p1', { metric: 'strokes' });

    expect(streaks.bestParStreak).toBe(1);
  });
});

describe('hallOfShame.bogeyStreak — adjacency-aware runs', () => {
  it('does not bridge an unscored hole between two bogeys', () => {
    // Bogey on hole 1, hole 2 unscored, bogey on hole 3 — physically
    // non-adjacent, so this must not register as a 2-hole bogey streak
    // (hallOfShame requires >= 2 to report a streak at all).
    const holes = [1, 2, 3].map((n) => ({ number: n, par: 4, strokeIndex: n }));
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 5, 3: 5 } }, // bogey, (2 unscored), bogey
    };
    const t = buildTournament({ players, rounds: [round] });

    const shame = hallOfShame(t, { metric: 'strokes' });

    expect(shame.bogeyStreak).toBeNull();
  });
});

describe('bounceBackRate — recovery must land on the very next hole', () => {
  it('counts the opportunity after a bogey but does not count a birdie 2 holes later as a bounce-back', () => {
    // Par, par, par, bogey (hole 4), hole 5 unscored, birdie (hole 6). The
    // bogey on hole 4 is still a bounce-back opportunity, but since hole 5
    // was never scored there is no result on the hole immediately after —
    // the birdie on hole 6 must NOT count as the recovery.
    const holes = [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, par: 4, strokeIndex: n }));
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 4, 2: 4, 3: 4, 4: 5, 6: 3 } }, // par, par, par, bogey, (5 unscored), birdie
    };
    const t = buildTournament({ players, rounds: [round] });

    const results = bounceBackRate(t);

    expect(results).toHaveLength(1);
    const [p1Result] = results;
    expect(p1Result.opportunities).toBe(1);
    expect(p1Result.bounceBacks).toBe(0);
    expect(p1Result.rate).toBe(0);
    expect(p1Result.breakdown).toHaveLength(1);
    expect(p1Result.breakdown[0]).toMatchObject({ holeNumber: 6, afterHole: 4, recovered: false });
  });
});

describe('strokeIndexAccuracy — pooled per course+hole, average-rank ties, round scope', () => {
  it('pools a course played twice into one row per hole instead of one row per round per hole', () => {
    const holes = holes18().slice(0, 3); // SI 1, 2, 3 — par 4 each
    const players = [{ id: 'p1', handicap: 0 }, { id: 'p2', handicap: 0 }];
    const round1 = {
      courseName: 'Sunset Ridge',
      holes,
      scores: { p1: { 1: 5, 2: 4, 3: 4 }, p2: { 1: 5, 2: 4, 3: 4 } }, // hole1 +1/+1, hole2/3 even
    };
    const round2 = {
      courseName: 'Sunset Ridge',
      holes,
      scores: { p1: { 1: 4, 2: 4, 3: 6 }, p2: { 1: 4, 2: 4, 3: 6 } }, // hole1/2 even, hole3 +2/+2
    };
    const t = buildTournament({ players, rounds: [round1, round2] });

    const results = strokeIndexAccuracy(t);

    // One row per physical hole (3), not one row per round per hole (6).
    expect(results).toHaveLength(3);
    expect(new Set(results.map(r => r.holeNumber))).toEqual(new Set([1, 2, 3]));

    const hole1 = results.find(r => r.holeNumber === 1);
    const hole2 = results.find(r => r.holeNumber === 2);
    const hole3 = results.find(r => r.holeNumber === 3);
    // hole1: (1+1+0+0)/4 = 0.5, hole2: 0, hole3: (0+0+2+2)/4 = 1
    expect(hole1.avgVsPar).toBeCloseTo(0.5);
    expect(hole2.avgVsPar).toBeCloseTo(0);
    expect(hole3.avgVsPar).toBeCloseTo(1);
  });

  it('gives tied holes the average of the ranks they span instead of an arbitrary order', () => {
    const holes = holes18().slice(0, 3); // printed SI 1, 2, 3 — par 4 each
    const players = [{ id: 'p1', handicap: 0 }];
    const round = {
      courseName: 'Course C',
      holes,
      scores: { p1: { 1: 5, 2: 5, 3: 4 } }, // hole1 & hole2 tied at +1 vs par, hole3 at 0
    };
    const t = buildTournament({ players, rounds: [round] });

    const results = strokeIndexAccuracy(t);

    const hole1 = results.find(r => r.holeNumber === 1);
    const hole2 = results.find(r => r.holeNumber === 2);
    const hole3 = results.find(r => r.holeNumber === 3);
    // hole1 and hole2 tie for the hardest two ranks (1 and 2) — average rank 1.5 each.
    expect(hole1.actualSi).toBe(1.5);
    expect(hole2.actualSi).toBe(1.5);
    // hole3 is clearly easiest — rank 3, no tie.
    expect(hole3.actualSi).toBe(3);
    // siGap = printedSi - actualSi stays consistent with the tie-adjusted rank.
    expect(hole1.siGap).toBeCloseTo(1 - 1.5);
    expect(hole2.siGap).toBeCloseTo(2 - 1.5);
    expect(hole3.siGap).toBeCloseTo(3 - 3);
  });

  it('honors the roundIndex option, pooling only the selected round even when another round shares its course name', () => {
    const holes = holes18().slice(0, 3);
    const players = [{ id: 'p1', handicap: 0 }];
    const round0 = {
      courseName: 'Shared Course',
      holes,
      scores: { p1: { 1: 6, 2: 6, 3: 6 } }, // +2 vs par on every hole
    };
    const round1 = {
      courseName: 'Other Course',
      holes,
      scores: { p1: { 1: 5, 2: 5, 3: 5 } },
    };
    const round2 = {
      courseName: 'Shared Course', // same course name as round0
      holes,
      scores: { p1: { 1: 4, 2: 4, 3: 4 } }, // even par on every hole
    };
    const t = buildTournament({ players, rounds: [round0, round1, round2] });

    const results = strokeIndexAccuracy(t, { roundIndex: 2 });

    // Only round index 2's data should be pooled — round0's data on the same
    // course name must not leak in.
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.avgVsPar).toBeCloseTo(0));
  });
});

describe('nemesisEncore — same physical hole zeroing the same player across ≥2 rounds', () => {
  it('returns null when a player is only zeroed on a hole once', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } }; // 0 pts
    const t = buildTournament({ players, rounds: [round] });

    expect(nemesisEncore(t)).toBeNull();
  });

  it('awards an entry when the same hole on the same course zeroes the player in 2 different rounds', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round0 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } }; // 0 pts
    const round1 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 7 } } }; // 0 pts
    const t = buildTournament({ players, rounds: [round0, round1] });

    const result = nemesisEncore(t);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result[0].player.id).toBe('p1');
    expect(result[0].holeNumber).toBe(5);
    expect(result[0].courseName).toBe('Sunset Ridge');
    expect(result[0].rounds).toEqual([0, 1]);
  });

  it('does not award when the zeroed hole number differs between rounds', () => {
    const holes = [
      { number: 5, par: 4, strokeIndex: 5 },
      { number: 6, par: 4, strokeIndex: 6 },
    ];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round0 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6, 6: 4 } } }; // hole 5 zeroed
    const round1 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 4, 6: 6 } } }; // hole 6 zeroed
    const t = buildTournament({ players, rounds: [round0, round1] });

    expect(nemesisEncore(t)).toBeNull();
  });

  it('does not award when the course differs (no shared courseId, different courseName)', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round0 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } };
    const round1 = { courseName: 'Northwood', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } };
    const t = buildTournament({ players, rounds: [round0, round1] });

    expect(nemesisEncore(t)).toBeNull();
  });

  it('pools by courseId (not courseName) so a renamed course still counts as the same physical hole', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round0 = { courseId: 'c1', courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } };
    const round1 = { courseId: 'c1', courseName: 'Sunset Ridge Resort', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } };
    const t = buildTournament({ players, rounds: [round0, round1] });

    const result = nemesisEncore(t);

    expect(result).not.toBeNull();
    expect(result[0].rounds).toEqual([0, 1]);
  });

  it('does not pool across different courseIds even when courseName happens to match', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round0 = { courseId: 'c1', courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } };
    const round1 = { courseId: 'c2', courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } };
    const t = buildTournament({ players, rounds: [round0, round1] });

    expect(nemesisEncore(t)).toBeNull();
  });

  it('does not award when the player scores nonzero on repeat visits', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round0 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6 } } }; // 0 pts
    const round1 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 4 } } }; // 2 pts — not a repeat zero
    const t = buildTournament({ players, rounds: [round0, round1] });

    expect(nemesisEncore(t)).toBeNull();
  });

  it('sorts the worst repeat offender first (most rounds)', () => {
    const holes = [
      { number: 5, par: 4, strokeIndex: 5 },
      { number: 9, par: 4, strokeIndex: 9 },
    ];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    // Hole 5 zeroed in all 3 rounds; hole 9 zeroed in only 2.
    const round0 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6, 9: 6 } } };
    const round1 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6, 9: 6 } } };
    const round2 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0 }, scores: { p1: { 5: 6, 9: 4 } } }; // hole 9 not zeroed here
    const t = buildTournament({ players, rounds: [round0, round1, round2] });

    const result = nemesisEncore(t);

    expect(result).toHaveLength(2);
    expect(result[0].holeNumber).toBe(5);
    expect(result[0].rounds).toEqual([0, 1, 2]);
    expect(result[1].holeNumber).toBe(9);
    expect(result[1].rounds).toEqual([0, 1]);
  });

  it('isolates the offending player — a teammate zeroed once on the same hole does not count', () => {
    const holes = [{ number: 5, par: 4, strokeIndex: 5 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 0 },
    ];
    const round0 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0, p2: 0 }, scores: { p1: { 5: 6 }, p2: { 5: 6 } } };
    const round1 = { courseName: 'Sunset Ridge', holes, playerHandicaps: { p1: 0, p2: 0 }, scores: { p1: { 5: 6 }, p2: { 5: 4 } } }; // p2 not zeroed this time
    const t = buildTournament({ players, rounds: [round0, round1] });

    const result = nemesisEncore(t);

    expect(result).toHaveLength(1);
    expect(result[0].player.id).toBe('p1');
  });
});

describe('collectiveExtremes — qualifies on round participants, not the whole tournament roster', () => {
  it('counts a hole as a disaster when every player who actually played the round tanked it, even if a non-participating tournament player is never scored', () => {
    // 3 tournament players, but p3 never appears anywhere in round.scores —
    // they didn't play this round at all (e.g. a sub joined for one round
    // only). p1 and p2 both score 6 on a par-4 SI-1 hole at handicap 0 →
    // 2 + (4 - 6) = 0 points each, a collective disaster among the two who
    // actually played.
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 0 },
      { id: 'p3', name: 'Cara', handicap: 0 },
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0, p2: 0, p3: 0 },
      scores: { p1: { 1: 6 }, p2: { 1: 6 } }, // p3 absent entirely
    };
    const t = buildTournament({ players, rounds: [round] });

    const { disasters } = collectiveExtremes(t);

    expect(disasters).toHaveLength(1);
    expect(disasters[0].holeNumber).toBe(1);
    expect(disasters[0].scores.map(s => s.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('does not qualify a hole when a round participant played the round but missed that specific hole', () => {
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 0 },
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0, p2: 0 },
      // p2 is a round participant (has a score on hole 2) but has no score
      // on hole 1 — hole 1 must not qualify even though the only score
      // present (p1's) is a disaster-level 0.
      scores: { p1: { 1: 6, 2: 6 }, p2: { 2: 6 } },
    };
    const t = buildTournament({ players, rounds: [round] });

    const { disasters } = collectiveExtremes(t);

    expect(disasters.find(d => d.holeNumber === 1)).toBeUndefined();
    expect(disasters.find(d => d.holeNumber === 2)).toBeDefined();
  });
});

describe('holeDifficultyMap — honest averages', () => {
  it('reports null (not 0) avgPoints/avgStrokes for a hole nobody scored', () => {
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 4 } }, // hole 2 never scored by anyone
    };
    const t = buildTournament({ players, rounds: [round] });

    const map = holeDifficultyMap(t, 0);
    const hole1 = map.find(h => h.holeNumber === 1);
    const hole2 = map.find(h => h.holeNumber === 2);

    expect(hole1.avgPoints).toBe(2); // par → 2 + (4-4) = 2
    expect(hole1.avgStrokes).toBe(4);
    expect(hole2.avgPoints).toBeNull();
    expect(hole2.avgStrokes).toBeNull();
  });
});

describe('bestWorstHoles — sample guards, overlap-free split, round scope', () => {
  // Helper: one hole scored identically by two players at handicap 0, so
  // avgPoints = 2 + (par - strokes).
  function scoredHole(number, strokes, par = 4) {
    return {
      hole: { number, par, strokeIndex: number },
      scores: { p1: { [number]: strokes }, p2: { [number]: strokes } },
    };
  }

  it('excludes holes with fewer than minScores(2 default) scores', () => {
    const specs = [scoredHole(1, 2), scoredHole(2, 3), scoredHole(3, 5)]; // avgPoints 4, 3, 1
    const underScored = { number: 4, par: 4, strokeIndex: 4 }; // only p1 scores it
    const holes = [...specs.map(s => s.hole), underScored];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }, { id: 'p2', name: 'Bob', handicap: 0 }];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0, p2: 0 },
      scores: {
        p1: { ...specs.reduce((o, s) => ({ ...o, ...s.scores.p1 }), {}), 4: 4 },
        p2: specs.reduce((o, s) => ({ ...o, ...s.scores.p2 }), {}),
      },
    };
    const t = buildTournament({ players, rounds: [round] });

    const defaultResult = bestWorstHoles(t, { metric: 'points' });
    const allHoleNumbers = [...defaultResult.best, ...defaultResult.worst].map(h => h.holeNumber);
    expect(allHoleNumbers).not.toContain(4);
    expect(allHoleNumbers.sort()).toEqual([1, 2, 3]);

    const permissiveResult = bestWorstHoles(t, { metric: 'points', minScores: 1 });
    const permissiveHoleNumbers = [...permissiveResult.best, ...permissiveResult.worst].map(h => h.holeNumber);
    expect(permissiveHoleNumbers).toContain(4);
  });

  it('splits 4 entries 2/2 with no hole in both best and worst', () => {
    const specs = [scoredHole(1, 2), scoredHole(2, 3), scoredHole(3, 5), scoredHole(4, 6)]; // avgPoints 4, 3, 1, 0
    const holes = specs.map(s => s.hole);
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }, { id: 'p2', name: 'Bob', handicap: 0 }];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0, p2: 0 },
      scores: {
        p1: specs.reduce((o, s) => ({ ...o, ...s.scores.p1 }), {}),
        p2: specs.reduce((o, s) => ({ ...o, ...s.scores.p2 }), {}),
      },
    };
    const t = buildTournament({ players, rounds: [round] });

    const { best, worst } = bestWorstHoles(t, { metric: 'points' });

    expect(best).toHaveLength(2);
    expect(worst).toHaveLength(2);
    const bestNums = best.map(h => h.holeNumber);
    const worstNums = worst.map(h => h.holeNumber);
    expect(bestNums).toEqual([1, 2]);
    expect(worstNums).toEqual([4, 3]); // hardest first
    expect(bestNums.filter(n => worstNums.includes(n))).toEqual([]);
  });

  it('honors roundIndex, and every returned entry carries its own roundIndex', () => {
    const specs0 = [scoredHole(1, 4)]; // avgPoints 2 (par)
    const specs1 = [scoredHole(1, 2)]; // avgPoints 4 (eagle-ish)
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }, { id: 'p2', name: 'Bob', handicap: 0 }];
    const round0 = {
      courseName: 'Course A', holes: specs0.map(s => s.hole), playerHandicaps: { p1: 0, p2: 0 },
      scores: { p1: specs0[0].scores.p1, p2: specs0[0].scores.p2 },
    };
    const round1 = {
      courseName: 'Course B', holes: specs1.map(s => s.hole), playerHandicaps: { p1: 0, p2: 0 },
      scores: { p1: specs1[0].scores.p1, p2: specs1[0].scores.p2 },
    };
    const t = buildTournament({ players, rounds: [round0, round1] });

    const scoped = bestWorstHoles(t, { metric: 'points', roundIndex: 1 });

    const all = [...scoped.best, ...scoped.worst];
    expect(all).toHaveLength(1);
    expect(all[0].roundIndex).toBe(1);
    expect(all[0].avgPoints).toBe(4);
  });
});

describe('anchor — tied holes must not count toward either MB or PB', () => {
  it('excludes genuine partner ties from anchor scoring, so a real 6-2 outright split (not the 10 tie-broken holes) decides the anchor', () => {
    // p1 (hcp 0) and p2 (hcp 10) are partners. Stroke indices are all > 10
    // so p2 never receives a handicap stroke here — extra shots stay 0 for
    // both players on every hole, keeping the points math simple.
    //   Holes 1-2 (2 holes):  p1 outright better  → p1 MB, p2 PB
    //   Holes 3-8 (6 holes):  p2 outright better  → p2 MB, p1 PB
    //   Holes 9-18 (10 holes): a genuine tie — pickMBTiebreak always
    //     resolves to the lower handicap (p1) as MB, since the two partners
    //     really did score the same. The old implementation counted these
    //     10 tie-broken holes as real MB/PB roles, which incorrectly made
    //     p2 (the higher handicapper) look like the anchor (+6) even though
    //     p2 actually outplayed p1 outright 6 times to 2.
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: 4, strokeIndex: i + 11,
    }));
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 10 },
      { id: 'p3', name: 'Cara', handicap: 0 },
      { id: 'p4', name: 'Dan', handicap: 0 },
    ];
    const playerHandicaps = { p1: 0, p2: 10, p3: 0, p4: 0 };
    const pairs = [[players[0], players[1]], [players[2], players[3]]];

    const p1Scores = {}, p2Scores = {}, p3Scores = {}, p4Scores = {};
    holes.forEach(h => {
      if (h.number <= 2) { p1Scores[h.number] = 3; p2Scores[h.number] = 5; } // p1 outright MB
      else if (h.number <= 8) { p1Scores[h.number] = 5; p2Scores[h.number] = 3; } // p2 outright MB
      else { p1Scores[h.number] = 4; p2Scores[h.number] = 4; } // genuine tie
      p3Scores[h.number] = 4;
      p4Scores[h.number] = 4;
    });

    const round = {
      courseName: 'Test Course', holes, playerHandicaps, pairs,
      scores: { p1: p1Scores, p2: p2Scores, p3: p3Scores, p4: p4Scores },
    };
    const t = buildTournament({ players, rounds: [round] });

    const result = anchor(t);

    expect(result).not.toBeNull();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].player.id).toBe('p1');
    expect(result.value).toBe(4);

    const p1All = result.all.find(r => r.player.id === 'p1');
    const p2All = result.all.find(r => r.player.id === 'p2');
    expect(p1All.mbCount).toBe(2);
    expect(p1All.pbCount).toBe(6);
    expect(p1All.anchorScore).toBe(4);
    expect(p2All.mbCount).toBe(6);
    expect(p2All.pbCount).toBe(2);
    expect(p2All.anchorScore).toBe(-4);
  });
});

describe('par3Heartbreak — minimum sample and ties', () => {
  it('requires at least 3 par-3 holes played and returns every tied leader', () => {
    const holes = [1, 2, 3, 4, 5].map((n) => ({ number: n, par: 3, strokeIndex: n }));
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 }, // 2 par-3 holes — below the sample floor
      { id: 'p2', name: 'Bob', handicap: 0 },   // 3 holes, tied worst avg among eligible players
      { id: 'p3', name: 'Cara', handicap: 0 },  // 3 holes, tied worst avg among eligible players
      { id: 'p4', name: 'Dan', handicap: 0 },   // 3 holes, better avg
    ];
    const playerHandicaps = { p1: 0, p2: 0, p3: 0, p4: 0 };
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps,
      scores: {
        p1: { 1: 6, 2: 6 },
        p2: { 1: 5, 2: 5, 3: 5 },
        p3: { 1: 5, 2: 5, 3: 5 },
        p4: { 1: 3, 2: 3, 3: 3 },
      },
    };
    const t = buildTournament({ players, rounds: [round] });

    const result = par3Heartbreak(t);

    expect(result).not.toBeNull();
    expect(result.value).toBe(5);
    expect(result.entries.map((e) => e.player.id).sort()).toEqual(['p2', 'p3']);
    // p1's 6.00 avg would win outright, but 2 holes is below the 3-hole
    // minimum sample — it must not appear among the leaders.
    expect(result.entries.some((e) => e.player.id === 'p1')).toBe(false);
  });

  it('returns null when nobody has played 3+ par-3 holes', () => {
    const holes = [1, 2].map((n) => ({ number: n, par: 3, strokeIndex: n }));
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 5, 2: 5 } },
    };
    const t = buildTournament({ players, rounds: [round] });

    expect(par3Heartbreak(t)).toBeNull();
  });
});

describe('hallOfShame.gift — fires with as few as 3 players', () => {
  it('awards the gift on a hole with exactly 3 scored players', () => {
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 0 },
      { id: 'p3', name: 'Cara', handicap: 0 },
    ];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0, p2: 0, p3: 0 },
      scores: { p1: { 1: 4 }, p2: { 1: 4 }, p3: { 1: 8 } }, // p3 tanks while the other two par
    };
    const t = buildTournament({ players, rounds: [round] });

    const shame = hallOfShame(t, { metric: 'points' });

    expect(shame.gift).not.toBeNull();
    expect(shame.gift.entries).toHaveLength(1);
    expect(shame.gift.entries[0].player.id).toBe('p3');
  });

  it('still does not fire on a hole with only 2 scored players', () => {
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 0 },
    ];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0, p2: 0 },
      scores: { p1: { 1: 4 }, p2: { 1: 8 } },
    };
    const t = buildTournament({ players, rounds: [round] });

    const shame = hallOfShame(t, { metric: 'points' });

    expect(shame.gift).toBeNull();
  });
});

// ── Task 16: Overview metrics — Playing to Handicap, Hot Stretch ──

describe('playingToHandicap', () => {
  it('computes points, holesPlayed and delta = points − 2×holesPlayed, sorted best-first', () => {
    // handicap 0 for both players → extra shots are always 0, so points on
    // each hole are simply 2 + par − strokes. 4 holes, all par 4.
    const holes = [1, 2, 3, 4].map((n) => ({ number: n, par: 4, strokeIndex: n }));
    const players = [
      { id: 'p1', name: 'Alice', handicap: 0 },
      { id: 'p2', name: 'Bob', handicap: 0 },
      { id: 'p3', name: 'Cara', handicap: 0 }, // never plays — must be skipped
    ];
    const round = {
      courseName: 'Test Course',
      holes,
      playerHandicaps: { p1: 0, p2: 0, p3: 0 },
      scores: {
        // p1 strokes 4,4,3,5 → points 2,2,3,1 → total 8 over 4 holes → delta 8-8=0
        p1: { 1: 4, 2: 4, 3: 3, 4: 5 },
        // p2 strokes 3,3,3,3 → points 3,3,3,3 → total 12 over 4 holes → delta 12-8=4
        p2: { 1: 3, 2: 3, 3: 3, 4: 3 },
      },
    };
    const t = buildTournament({ players, rounds: [round] });

    const result = playingToHandicap(t);

    expect(result.map((r) => r.player.id)).toEqual(['p2', 'p1']);
    expect(result[0]).toMatchObject({ points: 12, holesPlayed: 4, delta: 4 });
    expect(result[1]).toMatchObject({ points: 8, holesPlayed: 4, delta: 0 });
    // p3 never played a hole — must not appear at all.
    expect(result.some((r) => r.player.id === 'p3')).toBe(false);
  });

  it('sums points/holesPlayed/delta across multiple rounds and exposes a per-round breakdown', () => {
    const holes = [1, 2].map((n) => ({ number: n, par: 4, strokeIndex: n }));
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const roundA = {
      courseName: 'Course A', holes, playerHandicaps: { p1: 0 },
      // strokes 4,4 → points 2,2 → 4 pts over 2 holes → round delta 4-4=0
      scores: { p1: { 1: 4, 2: 4 } },
    };
    const roundB = {
      courseName: 'Course B', holes, playerHandicaps: { p1: 0 },
      // strokes 3,3 → points 3,3 → 6 pts over 2 holes → round delta 6-4=2
      scores: { p1: { 1: 3, 2: 3 } },
    };
    const t = buildTournament({ players, rounds: [roundA, roundB] });

    const result = playingToHandicap(t);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ points: 10, holesPlayed: 4, delta: 2 });
    expect(result[0].rounds.map((r) => ({ roundIndex: r.roundIndex, points: r.points, holesPlayed: r.holesPlayed, delta: r.delta })))
      .toEqual([
        { roundIndex: 0, points: 4, holesPlayed: 2, delta: 0 },
        { roundIndex: 1, points: 6, holesPlayed: 2, delta: 2 },
      ]);
  });
});

describe('hotStretch', () => {
  it('finds the best rolling windowSize-hole sum, ties keep the earliest window', () => {
    // handicap 0 → points = 2 + par − strokes. 5 holes, windowSize override 3.
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 3, strokeIndex: 2 },
      { number: 3, par: 5, strokeIndex: 3 },
      { number: 4, par: 4, strokeIndex: 4 },
      { number: 5, par: 3, strokeIndex: 5 },
    ];
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0 },
      // strokes 5,2,5,3,2 → points 1,3,2,3,3
      // windows: [1,2,3]=6 (h1-3), [2,3,4]=8 (h2-4), [3,4,5]=8 (h3-5) — tie, first wins
      scores: { p1: { 1: 5, 2: 2, 3: 5, 4: 3, 5: 2 } },
    };
    const t = buildTournament({ players, rounds: [round] });

    const result = hotStretch(t, { windowSize: 3 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ points: 8, roundIndex: 0, startHole: 2, endHole: 4 });
    expect(result[0].breakdown.map((b) => b.holeNumber)).toEqual([2, 3, 4]);
  });

  it('omits a player who never has windowSize adjacent holes scored', () => {
    const holes = [1, 2].map((n) => ({ number: n, par: 4, strokeIndex: n }));
    const players = [{ id: 'p1', name: 'Alice', handicap: 0 }];
    const round = {
      courseName: 'Test Course', holes, playerHandicaps: { p1: 0 },
      scores: { p1: { 1: 4, 2: 4 } }, // only 2 holes played, default windowSize 6
    };
    const t = buildTournament({ players, rounds: [round] });

    expect(hotStretch(t)).toEqual([]);
  });

  it('does not bridge R3\'s unscored hole 5 gap: best window for p2 comes from R1, not a stitched R3 window', () => {
    // mixedModeTournament R3 (front nine only) skips p2's hole 5, splitting
    // p2's R3 entries into two runs of 4 holes each (1-4, 6-9) — neither
    // reaches the default windowSize of 6, so R3 cannot contribute a window
    // at all. An implementation that slides over the flat per-player entries
    // array without checking real hole adjacency would wrongly treat holes
    // [1,2,3,4,6,7] as 6 "consecutive" entries (points 3+2+4+3+4+3=19),
    // beating every legitimate R1 window (best legitimate window is R1
    // holes 1-6, worked out below at 18 points) — so 19 must never appear.
    const t = withoutScrambleScores(mixedModeTournament());

    const result = hotStretch(t);
    const p2 = result.find((r) => r.player.id === 'p2');

    expect(p2).toMatchObject({ points: 18, roundIndex: 0, startHole: 1, endHole: 6 });
  });
});

describe('courseDNA — pools by courseId ?? courseName, keeps per-round totals', () => {
  test('a renamed course label with the same courseId stays one course, shown under its latest name', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [
        { courseId: 'c9', courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 4) } },
        { courseId: 'c9', courseName: 'Pine GC', holes: h, scores: { p1: evenScores(h, 5) } },
      ],
    };
    const dna = courseDNA(t)[0];
    expect(dna.courses).toHaveLength(1);
    const c = dna.courses[0];
    expect(c.courseName).toBe('Pine GC');       // latest label wins for display
    expect(c.rounds).toBe(2);
    expect(c.roundPoints).toBe(27);             // (36 + 18) / 2
    // Chronological per-round totals so consumers (courseMastery) can take
    // best/trend without re-deriving courseDNA's keying.
    expect(c.roundTotals.map((r) => r.points)).toEqual([36, 18]);
    expect(c.roundTotals.map((r) => r.roundIndex)).toEqual([0, 1]);
  });

  test('rounds with no courseId and an empty name each keep their own R{n} identity', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [
        { courseName: '', holes: h, scores: { p1: evenScores(h, 4) } },
        { courseName: '', holes: h, scores: { p1: evenScores(h, 5) } },
      ],
    };
    const dna = courseDNA(t)[0];
    expect(dna.courses.map((c) => c.courseName).sort()).toEqual(['R1', 'R2']);
    expect(dna.courses.every((c) => c.rounds === 1)).toBe(true);
  });
});

describe('warmupVsClosing — breakdown roundIndex', () => {
  test('breakdown entries carry roundIndex so same-course rows from different rounds are distinguishable', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [
        { courseName: 'Course A', holes: h, scores: { p1: evenScores(h, 4) } },
        { courseName: 'Course A', holes: h, scores: { p1: evenScores(h, 4) } },
      ],
    };
    const wc = warmupVsClosing(t, 'p1');
    // 3 warm-up holes (H1-3) and 3 closing holes (H16-18), doubled across 2 rounds.
    expect(wc.warmup.breakdown).toHaveLength(6);
    expect(wc.closing.breakdown).toHaveLength(6);
    expect(wc.warmup.breakdown.map((b) => b.roundIndex)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(wc.closing.breakdown.map((b) => b.roundIndex)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  // Regression lock: a back-nine-only round (holes numbered 10-18, played
  // in that order) must NOT produce zero warmup holes just because
  // hole.number never dips to 1-3. Warmup/closing are derived from the
  // round's actual hole ORDER (first-N / last-N as played), not the
  // 1-based printed hole.number.
  test('a back-nine-only round (holes 10-18) treats its first/last played holes as warmup/closing', () => {
    const h = Array.from({ length: 9 }, (_, i) => ({ number: i + 10, par: 4, strokeIndex: i + 1 }));
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'Back Nine', holes: h, scores: { p1: evenScores(h, 4) } }],
    };
    const wc = warmupVsClosing(t, 'p1');
    expect(wc.warmup.holes).toBe(3);
    expect(wc.warmup.breakdown.map((b) => b.holeNumber)).toEqual([10, 11, 12]);
    expect(wc.closing.holes).toBe(3);
    expect(wc.closing.breakdown.map((b) => b.holeNumber)).toEqual([16, 17, 18]);
  });
});

describe('driveLieFromDetail', () => {
  test('explicit driveLie wins over direction', () => {
    expect(driveLieFromDetail({ drive: 'fairway', driveLie: 'sand' })).toBe('sand');
  });
  test('fairway/super direction implies fairway lie', () => {
    expect(driveLieFromDetail({ drive: 'fairway' })).toBe('fairway');
    expect(driveLieFromDetail({ drive: 'super' })).toBe('fairway');
  });
  test('miss directions default to rough', () => {
    expect(driveLieFromDetail({ drive: 'left' })).toBe('rough');
    expect(driveLieFromDetail({ drive: 'right' })).toBe('rough');
    expect(driveLieFromDetail({ drive: 'short' })).toBe('rough');
  });
  test('null without any drive info', () => {
    expect(driveLieFromDetail({})).toBeNull();
    expect(driveLieFromDetail(null)).toBeNull();
  });
});

describe('sgOffTheTee', () => {
  // Scratch benchmark on a par 4: E(fairway, 340-230=110) = 2.84873
  test('fairway drive slightly shorter than scratch benchmark ≈ 0', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ drive: 'fairway', driveDistBucket: '210-240' }],
    );
    // actual: E(fairway, 340-225=115) = 2.86183 → 2.84873 - 2.86183
    const r = sgOffTheTee(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(-0.01, 2);
    expect(r.sampleHoles).toBe(1);
  });
  test('rough drive at 180-210 costs about a third of a stroke vs scratch', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ drive: 'left', driveLie: 'rough', driveDistBucket: '180-210' }],
    );
    // actual: E(rough, 340-195=145) = 3.16827 → 2.84873 - 3.16827
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(-0.32, 2);
  });
  test('trouble maps to the recovery table', () => {
    const round = makeRound(
      [{ par: 4, strokes: 6 }],
      [{ drive: 'right', driveLie: 'trouble', driveDistBucket: '150-180' }],
    );
    // actual: E(recovery, 340-165=175) = 3.53085 → 2.84873 - 3.53085
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(-0.68, 2);
  });
  test('par 5 uses the 470 m anchor', () => {
    const round = makeRound(
      [{ par: 5, strokes: 5 }],
      [{ drive: 'fairway', driveDistBucket: '240+' }],
    );
    // bench: E(fairway, 470-230=240) = 3.78481; actual: E(fairway, 470-255=215) = 3.58692
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(0.20, 2);
  });
  test('same drive is positive against a 14-handicap benchmark', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ drive: 'fairway', driveDistBucket: '210-240' }],
    );
    // bench(14): E_blend(fairway, 340-200=140) = 3.34328; actual: E_blend(fairway, 115) = 3.21336
    expect(sgOffTheTee(round, 'me', 14).perHole[0]).toBeCloseTo(0.13, 2);
  });
  test('derived rough lie from a miss direction without explicit driveLie', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ drive: 'left', driveDistBucket: '180-210' }],
    );
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(-0.32, 2);
  });
  test('null on par 3s, legacy holes without a distance bucket, and untracked holes', () => {
    const round = makeRound(
      [{ par: 3, strokes: 3 }, { par: 4, strokes: 4 }, { par: 4, strokes: 4 }],
      [
        { drive: 'fairway', driveDistBucket: '180-210' }, // par 3 → null
        { drive: 'fairway' },                              // no bucket → null
        {},                                                // no drive info → null
      ],
    );
    const r = sgOffTheTee(round, 'me');
    expect(r.perHole).toEqual([null, null, null]);
    expect(r.sampleHoles).toBe(0);
    expect(r.total).toBe(0);
  });
});
