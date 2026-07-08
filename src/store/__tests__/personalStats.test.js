import {
  collectMyRounds, buildSyntheticTournament, CANON_ID,
  holeDifficultySplit, computeMetrics, computeRecentVsHistory, FORM_METRICS,
  rankStrengths, resolveSelection, computeMyStats, computeFormSeries, buildActionPlan,
} from '../personalStats';

// ── Fixture helpers ───────────────────────────────────────────────
// hcp default 0; SI defaults to hole number; par defaults to 4.
function mkRound({ courseName = 'Course', holes, scores = {}, shotDetails = {}, playerHandicaps = {} }) {
  return { courseName, holes, scores, shotDetails, playerHandicaps };
}
// 18 holes, par 4, strokeIndex = hole number.
function holes18() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
// scores object for one player: every hole = `strokes`.
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}

describe('collectMyRounds', () => {
  test('returns one record per round the user has a score in', () => {
    const h = holes18();
    const tournaments = [{
      id: 10, name: 'Spring Cup',
      players: [{ id: 'p1', name: 'Me', handicap: 12, user_id: 'u1' }],
      rounds: [
        mkRound({ courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 5) } }),
        mkRound({ courseName: 'Oak', holes: h, scores: { p1: evenScores(h, 4) } }),
      ],
    }];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('10:0');
    expect(result[0].tournamentName).toBe('Spring Cup');
    expect(result[0].courseName).toBe('Pine');
    expect(result[0].playerId).toBe('p1');
  });

  test('marks a round completed only when every hole has a score', () => {
    const h = holes18();
    const partial = evenScores(h, 5);
    delete partial[18];
    const tournaments = [{
      id: 7, name: 'T', players: [{ id: 'p1', user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) } }),
        mkRound({ holes: h, scores: { p1: partial } }),
      ],
    }];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result[0].completed).toBe(true);
    expect(result[1].completed).toBe(false);
  });

  test('marks a scored partial round completed when the tournament was explicitly finished', () => {
    const h = holes18();
    const partial = evenScores(h, 5);
    delete partial[18];
    const tournaments = [{
      id: 22,
      name: 'May 22 Game',
      kind: 'game',
      finishedAt: '2026-05-22T18:00:00.000Z',
      players: [{ id: 'p1', user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: partial } }),
      ],
    }];

    const result = collectMyRounds(tournaments, 'u1');

    expect(result[0].completed).toBe(true);
  });

  test('excludes rounds where the user has no score, and tournaments without the user', () => {
    const h = holes18();
    const tournaments = [
      { id: 1, name: 'Mine', players: [{ id: 'p1', user_id: 'u1' }],
        rounds: [
          mkRound({ holes: h, scores: { p1: evenScores(h, 4) } }),
          mkRound({ holes: h, scores: {} }),
        ] },
      { id: 2, name: 'Theirs', players: [{ id: 'pX', user_id: 'other' }],
        rounds: [mkRound({ holes: h, scores: { pX: evenScores(h, 4) } })] },
    ];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('1:0');
  });

  test('excludes scramble tournaments from personal stats', () => {
    const me = { id: 'p1', name: 'Ann Lee', user_id: 'u1' };
    const mkT = (scoringMode) => ({
      id: `t-${scoringMode}`,
      kind: 'game',
      players: [me],
      settings: { scoringMode },
      rounds: [{
        holes: [{ number: 1, par: 4, strokeIndex: 1 }],
        scores: { p1: { 1: 4 } },
        playerHandicaps: {},
      }],
    });
    const rounds = collectMyRounds(
      [mkT('scramblepairs'), mkT('scramble4'), mkT('individual')], 'u1', 'Ann Lee',
    );
    expect(rounds).toHaveLength(1);
    expect(rounds[0].tournamentId).toBe('t-individual');
  });

  test('orders rounds chronologically — oldest tournament first', () => {
    const h = holes18();
    // loaders return newest-first (id desc); collectMyRounds reverses.
    const tournaments = [
      { id: 20, name: 'Newer', players: [{ id: 'p1', user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) } })] },
      { id: 10, name: 'Older', players: [{ id: 'p1', user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) } })] },
    ];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result.map((r) => r.tournamentName)).toEqual(['Older', 'Newer']);
  });

  test('captures the tournament createdAt date on each round', () => {
    const h = holes18();
    const result = collectMyRounds([{
      id: 1, name: 'T', createdAt: '2026-05-12T10:00:00.000Z',
      players: [{ id: 'p1', user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) } })],
    }], 'u1');
    expect(result[0].tournamentDate).toBe('2026-05-12T10:00:00.000Z');
  });

  test('computes each round total Stableford points for the user', () => {
    const h = holes18(); // 18 par-4 holes
    const result = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } })],
    }], 'u1');
    // gross par on every hole, scratch handicap → 2 pts each × 18 = 36
    expect(result[0].points).toBe(36);
  });

  test('includes a single-player game when the lone player has no user_id', () => {
    const h = holes18();
    const tournaments = [{
      id: 30, name: 'Solo Round', kind: 'game',
      players: [{ id: 'g1', name: 'Me', handicap: 0 }],
      rounds: [mkRound({ holes: h, scores: { g1: evenScores(h, 4) } })],
    }];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('30:0');
    expect(result[0].playerId).toBe('g1');
  });

  test('matches a game player by display name when user_id is absent', () => {
    const h = holes18();
    const tournaments = [{
      id: 31, name: 'Casual Game', kind: 'game',
      players: [{ id: 'g1', name: 'Marcos' }, { id: 'g2', name: 'Friend' }],
      rounds: [mkRound({ holes: h, scores: {
        g1: evenScores(h, 4), g2: evenScores(h, 5),
      } })],
    }];
    const result = collectMyRounds(tournaments, 'u1', 'marcos');
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('g1');
  });

  test('prefers a user_id match over the display-name fallback', () => {
    const h = holes18();
    const tournaments = [{
      id: 32, name: 'Cup',
      players: [
        { id: 'p1', name: 'Marcos', user_id: 'u1' },
        { id: 'p2', name: 'Marcos' },
      ],
      rounds: [mkRound({ holes: h, scores: {
        p1: evenScores(h, 4), p2: evenScores(h, 5),
      } })],
    }];
    const result = collectMyRounds(tournaments, 'u1', 'Marcos');
    expect(result[0].playerId).toBe('p1');
  });

  test('does not claim a multi-player game when nothing identifies the user', () => {
    const h = holes18();
    const tournaments = [{
      id: 33, name: 'Their Game', kind: 'game',
      players: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }],
      rounds: [mkRound({ holes: h, scores: { a: evenScores(h, 4) } })],
    }];
    expect(collectMyRounds(tournaments, 'u1', 'Marcos')).toHaveLength(0);
  });
});

describe('buildSyntheticTournament', () => {
  test('returns an empty single-player tournament for no rounds', () => {
    const t = buildSyntheticTournament([]);
    expect(t.players).toEqual([]);
    expect(t.rounds).toEqual([]);
  });

  test('re-keys scores, shotDetails and playerHandicaps to the canonical id', () => {
    const h = holes18();
    const myRounds = collectMyRounds([{
      id: 5, name: 'T', players: [{ id: 'origA', name: 'Me', handicap: 9, user_id: 'u1' }],
      rounds: [mkRound({
        holes: h,
        scores: { origA: evenScores(h, 4) },
        shotDetails: { origA: { 1: { putts: 2 } } },
        playerHandicaps: { origA: 9 },
      })],
    }], 'u1');
    const t = buildSyntheticTournament(myRounds);
    expect(t.players).toHaveLength(1);
    expect(t.players[0].id).toBe(CANON_ID);
    expect(t.rounds[0].scores[CANON_ID][1]).toBe(4);
    expect(t.rounds[0].scores.origA).toBeUndefined();
    expect(t.rounds[0].shotDetails[CANON_ID][1].putts).toBe(2);
    expect(t.rounds[0].playerHandicaps[CANON_ID]).toBe(9);
  });

  test('keeps each round under its own original player id (different per tournament)', () => {
    const h = holes18();
    const myRounds = collectMyRounds([
      { id: 2, name: 'B', players: [{ id: 'pB', handicap: 10, user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { pB: evenScores(h, 5) }, playerHandicaps: { pB: 10 } })] },
      { id: 1, name: 'A', players: [{ id: 'pA', handicap: 14, user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { pA: evenScores(h, 6) }, playerHandicaps: { pA: 14 } })] },
    ], 'u1');
    const t = buildSyntheticTournament(myRounds);
    // chronological: A (id 1) first, B second
    expect(t.rounds[0].scores[CANON_ID][1]).toBe(6);
    expect(t.rounds[0].playerHandicaps[CANON_ID]).toBe(14);
    expect(t.rounds[1].scores[CANON_ID][1]).toBe(5);
    expect(t.rounds[1].playerHandicaps[CANON_ID]).toBe(10);
  });
});

describe('holeDifficultySplit', () => {
  test('buckets holes into hard (SI 1-6), mid (7-12), easy (13-18)', () => {
    const h = holes18(); // par 4, SI = hole number
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } })],
    }], 'u1');
    const split = holeDifficultySplit(buildSyntheticTournament(myRounds), CANON_ID);
    expect(split.hard.holes).toBe(6);
    expect(split.mid.holes).toBe(6);
    expect(split.easy.holes).toBe(6);
    expect(split.hard.avgPoints).toBe(2); // gross par, scratch → 2 pts
  });
});

describe('computeMetrics', () => {
  test('averages points and strokes-vs-par per round', () => {
    const h = holes18(); // par 4 × 18 → par total 72
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 } }),
      ],
    }], 'u1');
    const m = computeMetrics(buildSyntheticTournament(myRounds));
    expect(m.rounds).toBe(2);
    expect(m.avgPoints).toBe(27);    // round1: 36 pts, round2: 18 pts → avg 27
    expect(m.avgVsPar).toBe(9);      // round1: 0, round2: +18 → avg 9
    expect(m.hasShotData).toBe(false);
  });

  test('reports shot metrics when shot detail exists', () => {
    const h = holes18();
    const shotDetails = {};
    h.forEach((hole) => { shotDetails[hole.number] = { putts: 2, drive: 'fairway' }; });
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({
        holes: h, scores: { p1: evenScores(h, 4) },
        playerHandicaps: { p1: 0 }, shotDetails: { p1: shotDetails },
      })],
    }], 'u1');
    const m = computeMetrics(buildSyntheticTournament(myRounds));
    expect(m.hasShotData).toBe(true);
    expect(m.fairwayPct).toBe(100);
    expect(m.puttsPerRound).toBe(36);
  });
});

describe('computeRecentVsHistory', () => {
  // Build N rounds where round i scores `strokesByRound[i]` on every hole.
  function roundsTournament(strokesByRound) {
    const h = holes18();
    return [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: strokesByRound.map((str) => mkRound({
        holes: h, scores: { p1: evenScores(h, str) }, playerHandicaps: { p1: 0 },
      })),
    }];
  }

  test('keeps FORM_METRICS in sync — 6 metrics produced', () => {
    const my = collectMyRounds(roundsTournament([5, 5]), 'u1');
    expect(computeRecentVsHistory(my, 5).metrics).toHaveLength(FORM_METRICS.length);
  });

  test('splits into recent (last N) and history (earlier), disjoint', () => {
    // 7 rounds; N=5 → history = first 2, recent = last 5
    const my = collectMyRounds(roundsTournament([6, 6, 5, 5, 5, 4, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.recentCount).toBe(5);
    expect(r.historyCount).toBe(2);
    expect(r.hasHistory).toBe(true);
    const points = r.metrics.find((m) => m.key === 'avgPoints');
    expect(points.recent).toBeGreaterThan(points.history); // recent rounds lower strokes → more points
    expect(points.direction).toBe('up');
  });

  test('marks no history when total rounds <= N', () => {
    const my = collectMyRounds(roundsTournament([5, 5, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.hasHistory).toBe(false);
    expect(r.recentCount).toBe(3);
    const points = r.metrics.find((m) => m.key === 'avgPoints');
    expect(points.history).toBeNull();
    expect(points.delta).toBeNull();
  });

  test('direction respects polarity — fewer strokes-vs-par is an improvement', () => {
    // earlier rounds score 6 (worse), recent score 4 (better)
    const my = collectMyRounds(roundsTournament([6, 6, 6, 4, 4, 4, 4, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    const vsPar = r.metrics.find((m) => m.key === 'avgVsPar');
    expect(vsPar.recent).toBeLessThan(vsPar.history);
    expect(vsPar.direction).toBe('up'); // lower vsPar = green up
  });
});

describe('rankStrengths', () => {
  // Build a tournament where par-3 holes score badly and par-5 holes score
  // well, so par type becomes a clear strength/weakness.
  function skewedTournament() {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: i < 9 ? 3 : 5,             // 9 par-3, 9 par-5
      strokeIndex: i + 1,
    }));
    const scores = {};
    holes.forEach((h) => { scores[h.number] = h.par === 3 ? h.par + 2 : h.par; });
    // Three identical rounds → 27 holes per par bucket (above the 12 guard).
    const round = mkRound({ holes, scores: { p1: scores }, playerHandicaps: { p1: 0 } });
    return [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [round, round, round],
    }];
  }

  test('ranks par 5s as a strength and par 3s as a pain point', () => {
    const my = collectMyRounds(skewedTournament(), 'u1');
    const r = rankStrengths(buildSyntheticTournament(my));
    expect(r.strengths[0].label).toBe('Par 5s');
    expect(r.strengths[0].deviation).toBeGreaterThan(0);
    expect(r.weaknesses[0].label).toBe('Par 3s');
    expect(r.weaknesses[0].deviation).toBeLessThan(0);
  });

  test('excludes cells below the sample-size guard', () => {
    // Single round → each par bucket has only 9 holes (< 12 guard).
    const one = skewedTournament();
    one[0].rounds = [one[0].rounds[0]];
    const my = collectMyRounds(one, 'u1');
    const r = rankStrengths(buildSyntheticTournament(my));
    const labels = [...r.strengths, ...r.weaknesses].map((c) => c.label);
    expect(labels).not.toContain('Par 3s');
    expect(labels).not.toContain('Par 5s');
  });

  test('returns empty lists when there are no rounds', () => {
    const r = rankStrengths(buildSyntheticTournament([]));
    expect(r.strengths).toEqual([]);
    expect(r.weaknesses).toEqual([]);
  });
});

describe('resolveSelection', () => {
  function threeRounds() {
    const h = holes18();
    const partial = evenScores(h, 5);
    delete partial[18]; // round 3 incomplete
    return collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) } }),
        mkRound({ holes: h, scores: { p1: partial } }),
      ],
    }], 'u1');
  }

  test('defaults to completed rounds when there are no overrides', () => {
    const selected = resolveSelection(threeRounds(), {});
    expect(selected.map((r) => r.key)).toEqual(['1:0', '1:1']);
  });

  test('an override can add an incomplete round or remove a completed one', () => {
    const selected = resolveSelection(threeRounds(), { '1:2': true, '1:0': false });
    expect(selected.map((r) => r.key)).toEqual(['1:1', '1:2']);
  });
});

describe('computeFormSeries', () => {
  // collectMyRounds output shape: each MyRound has { round, courseName, player, playerId }
  function myRound(courseName, holes, strokes) {
    return {
      key: `${courseName}:0`,
      round: mkRound({ courseName, holes, scores: { p1: evenScores(holes, strokes) }, playerHandicaps: { p1: 0 } }),
      courseName,
      roundIndex: 0,
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' },
      completed: true,
    };
  }

  test('returns one points-series entry per selected round', () => {
    const h = holes18();
    const rounds = [myRound('Pine', h, 4), myRound('Oak', h, 5)];
    const { metrics } = computeFormSeries(rounds);
    expect(metrics.avgPoints).toHaveLength(2);
    expect(metrics.avgPoints[0]).toEqual({ label: 'Pine', value: 36 }); // par on every hole = 2 pts x 18
    expect(metrics.avgPoints[1].value).toBe(18); // bogey on every hole = 1 pt x 18
  });

  test('computes strokes vs par per round', () => {
    const h = holes18(); // 18 par-4 holes -> par 72
    const { metrics } = computeFormSeries([myRound('Pine', h, 5)]);
    expect(metrics.avgVsPar[0]).toEqual({ label: 'Pine', value: 18 }); // 90 strokes - 72 par
  });

  test('shot metrics are null when the round has no shot data', () => {
    const h = holes18();
    const { metrics, hasShotData } = computeFormSeries([myRound('Pine', h, 4)]);
    expect(hasShotData).toBe(false);
    expect(metrics.fairwayPct[0].value).toBeNull();
    expect(metrics.girPct[0].value).toBeNull();
    expect(metrics.puttsPerRound[0].value).toBeNull();
    expect(metrics.threePuttsPerRound[0].value).toBeNull();
  });

  test('builds a birdie/par/bogey score-mix entry per round', () => {
    const h = holes18();
    const { scoreMix } = computeFormSeries([myRound('Pine', h, 4)]);
    expect(scoreMix[0]).toEqual({ label: 'Pine', birdie: 0, par: 18, bogey: 0 });
  });

  test('empty selection returns empty series', () => {
    const r = computeFormSeries([]);
    expect(r.metrics.avgPoints).toEqual([]);
    expect(r.scoreMix).toEqual([]);
    expect(r.hasShotData).toBe(false);
  });

  test('populates shot metrics and hasShotData when the round has shot detail', () => {
    const h = holes18();
    const mr = myRound('Pine', h, 4);
    // Log a putt + a fairway drive on every hole so shotStats reports data.
    mr.round.shotDetails = {
      p1: Object.fromEntries(h.map((hole) => [hole.number, { putts: 2, drive: 'fairway' }])),
    };
    const { metrics, hasShotData } = computeFormSeries([mr]);
    expect(hasShotData).toBe(true);
    expect(metrics.puttsPerRound[0].value).not.toBeNull();
    expect(metrics.fairwayPct[0].value).not.toBeNull();
  });
});

describe('computeMyStats targetHandicap', () => {
  test('computeMyStats accepts targetHandicap and threads it to sgSeason', () => {
    const mkMyRound = () => ({
      key: 't1#0',
      courseName: 'Test',
      tournamentName: 'T',
      tournamentDate: '2026-05-20',
      completed: true,
      playerId: 'me',
      player: { id: 'me', name: 'Me' },
      round: {
        holes: Array.from({ length: 18 }, (_, i) => ({
          number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
        })),
        scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
        shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
          drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
          putts: 2, firstPuttBucket: '3-6', sandShots: 0,
        }])) },
        playerHandicaps: { me: 18 },
      },
    });
    const rounds = [mkMyRound(), mkMyRound()];
    const s0 = computeMyStats(rounds, { targetHandicap: 0 });
    const s14 = computeMyStats(rounds, { targetHandicap: 14 });
    expect(s14.strokesGained.total).toBeGreaterThan(s0.strokesGained.total);
  });

  test('computeMyStats default targetHandicap=0 matches no-arg call', () => {
    const round = {
      key: 't1#0',
      courseName: 'Test',
      tournamentName: 'T',
      tournamentDate: '2026-05-20',
      completed: true,
      playerId: 'me',
      player: { id: 'me', name: 'Me' },
      round: {
        holes: [{ number: 1, par: 4, strokeIndex: 1 }],
        scores: { me: { 1: 4 } },
        shotDetails: { me: { 1: { putts: 2 } } },
        playerHandicaps: { me: 18 },
      },
    };
    const sNoArg = computeMyStats([round]);
    const sZero = computeMyStats([round], { targetHandicap: 0 });
    expect(sNoArg.strokesGained).toEqual(sZero.strokesGained);
  });
});

describe('computeMyStats', () => {
  test('includes shot impact blocks, target comparisons, and actionable insight rankings', () => {
    const holes = holes18();
    const scores = {};
    const shotDetails = { p1: {} };
    holes.forEach((hole) => {
      if (hole.number <= 6) {
        scores[hole.number] = 4;
        shotDetails.p1[hole.number] = {
          drive: 'super', approachBucket: '100-150',
          putts: 2, firstPuttBucket: '3-6', sandShots: 0,
        };
      } else if (hole.number <= 12) {
        scores[hole.number] = 4;
        shotDetails.p1[hole.number] = {
          drive: 'fairway', approachBucket: '100-150',
          putts: 2, firstPuttBucket: '3-6', sandShots: 0,
        };
      } else {
        scores[hole.number] = 6;
        shotDetails.p1[hole.number] = {
          drive: 'right', approachBucket: '200+',
          putts: 3, firstPuttBucket: '6+', sandShots: 0,
        };
      }
    });
    const myRound = {
      key: 'impact:0',
      round: mkRound({
        holes,
        scores: { p1: scores },
        shotDetails,
        playerHandicaps: { p1: 0 },
      }),
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0 },
      courseName: 'Impact',
      tournamentName: 'T',
      tournamentDate: '2026-05-28',
      completed: true,
    };

    const stats = computeMyStats([myRound], { targetHandicap: 14 });

    expect(stats.driveImpact.buckets.super).toMatchObject({ holes: 6, avgPoints: 2 });
    expect(stats.driveImpact.buckets.right).toMatchObject({ holes: 6, avgPoints: 0, avgVsPar: 2 });
    expect(stats.approachImpact.buckets['200+']).toMatchObject({ holes: 6, avgPoints: 0, girRate: 0 });
    expect(stats.puttDive).toMatchObject({ hasData: true, twoPuttPct: 67 });
    expect(stats.puttingTarget.buckets['6+']).toMatchObject({ attempts: 6, sgPerPutt: -0.81 });
    expect(stats.approachTarget.buckets['200+']).toMatchObject({ holes: 6, avgSg: -0.09 });
    expect(stats.actionPlan.strengths).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'Driving', label: 'Super drives' }),
    ]));
    expect(stats.actionPlan.improvements).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'Driving', label: 'Right misses' }),
      expect.objectContaining({ area: 'Putting', label: '6+ m putts' }),
    ]));
  });

  test('keeps Strokes Gained action-plan samples labeled as holes', () => {
    const actionPlan = buildActionPlan({
      strokesGained: {
        sampleHoles: 54,
        byCategory: { approach: -0.7, aroundGreen: 0, putting: 0 },
      },
    });

    expect(actionPlan.improvements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'Strokes Gained',
        label: 'Approach',
        sample: 54,
        sampleUnit: 'holes',
        unit: 'SG / round',
      }),
    ]));
  });

  test('uses Strokes Gained category-specific samples for action-plan items', () => {
    const actionPlan = buildActionPlan({
      strokesGained: {
        sampleHoles: 54,
        sampleHolesByCategory: { approach: 18, aroundGreen: 4, putting: 54 },
        byCategory: { approach: -0.7, aroundGreen: 0, putting: 0 },
      },
    });

    expect(actionPlan.improvements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'Strokes Gained',
        label: 'Approach',
        sample: 18,
        sampleUnit: 'holes',
      }),
    ]));
  });

  test('includes lagPutting, sandSaves, upAndDown, bunkerVisits', () => {
    const rawRound = {
      courseName: 'Test',
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: { p1: { 1: 4 } },
      shotDetails: { p1: { 1: { putts: 2, sandShots: 0, firstPuttBucket: '6-10' } } },
      playerHandicaps: { p1: 18 },
    };
    const myRound = {
      key: 't1#0',
      round: rawRound,
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 18 },
      courseName: 'Test',
      tournamentName: 'T',
      tournamentDate: '2026-05-20',
      completed: true,
    };
    const stats = computeMyStats([myRound]);
    expect(stats.lagPutting).toBeDefined();
    expect(stats.sandSaves).toBeDefined();
    expect(stats.upAndDown).toBeDefined();
    expect(stats.bunkerVisits).toBeDefined();
  });

  test('returns a strokesGained block with total, byCategory, and sampleHoles', () => {
    const rawRound = {
      courseName: 'Test',
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
      scores: { p1: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: {
        p1: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [
          i + 1,
          { putts: 2, drive: 'fairway', approachShots: 1, firstPuttBucket: '6-10' },
        ])),
      },
      playerHandicaps: { p1: 0 },
    };
    const myRound = {
      key: 'sg:0',
      round: rawRound,
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0 },
      courseName: 'Test',
      tournamentName: 'T',
      tournamentDate: '2026-05-20',
      completed: true,
    };
    const stats = computeMyStats([myRound]);
    expect(stats.strokesGained).toBeDefined();
    expect(stats.strokesGained).toHaveProperty('total');
    expect(stats.strokesGained).toHaveProperty('byCategory');
    expect(stats.strokesGained).toHaveProperty('sampleHoles');
  });

  test('bundles round count, metrics, form and ranking', () => {
    const h = holes18();
    const my = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 } }),
      ],
    }], 'u1');
    const stats = computeMyStats(my, { n: 5 });
    expect(stats.roundCount).toBe(2);
    expect(stats.metrics.avgPoints).toBe(27);
    expect(stats.form.metrics.length).toBe(FORM_METRICS.length);
    expect(stats.ranking).toHaveProperty('strengths');
    expect(stats.parType.par4.holes).toBe(36);
    expect(stats).toHaveProperty('scrambling');
    expect(stats).toHaveProperty('bounceBack');
  });

  test('includes a coach block with hero, board groups, and practice plan', () => {
    const holes = holes18();
    const scores = {};
    const shotDetails = { p1: {} };
    holes.forEach((hole) => {
      if (hole.number <= 12) {
        scores[hole.number] = 4;
        shotDetails.p1[hole.number] = {
          drive: 'fairway',
          approachBucket: '100-150',
          putts: 2,
          firstPuttBucket: '3-6',
          sandShots: 0,
        };
      } else {
        scores[hole.number] = 6;
        shotDetails.p1[hole.number] = {
          drive: 'right',
          approachBucket: '200+',
          putts: 3,
          firstPuttBucket: '6+',
          sandShots: 0,
        };
      }
    });
    const myRound = {
      key: 'coach:0',
      round: mkRound({
        holes,
        scores: { p1: scores },
        shotDetails,
        playerHandicaps: { p1: 0 },
      }),
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0 },
      courseName: 'Coach',
      tournamentName: 'T',
      tournamentDate: '2026-05-29',
      completed: true,
    };

    const stats = computeMyStats([myRound], { targetHandicap: 14 });

    expect(stats.coach.hero).toBeTruthy();
    expect(stats.coach.board).toHaveProperty('fixFirst');
    expect(stats.coach.board).toHaveProperty('keepDoing');
    expect(stats.coach.board).toHaveProperty('nextGains');
    expect(stats.coach.practicePlan).toHaveLength(3);
  });
});
