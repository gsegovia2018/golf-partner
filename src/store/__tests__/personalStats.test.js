import {
  collectMyRounds, buildSyntheticTournament, CANON_ID,
  holeDifficultySplit, computeMetrics, computeRecentVsHistory, FORM_METRICS,
  rankStrengths, resolveSelection, computeMyStats, computeFormSeries, buildActionPlan,
  courseMastery, careerMilestones,
} from '../personalStats';
import { getPlayingHandicap } from '../tournamentStore';
import * as statsEngine from '../statsEngine';
import * as coachInsights from '../coachInsights';

// ── Fixture helpers ───────────────────────────────────────────────
// hcp default 0; SI defaults to hole number; par defaults to 4.
function mkRound({ courseName = 'Course', holes, scores = {}, shotDetails = {}, playerHandicaps = {}, playerTees = null }) {
  return { courseName, holes, scores, shotDetails, playerHandicaps, playerTees };
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

  test('excludes only the scramble rounds of a mixed tournament', () => {
    const me = { id: 'p1', name: 'Ann Lee', user_id: 'u1' };
    const t = {
      id: 't-mixed', kind: 'tournament', players: [me],
      settings: { scoringMode: 'individual' },
      rounds: [
        { holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: { p1: { 1: 4 } }, playerHandicaps: {} },
        { scoringMode: 'scramblepairs', holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: { p1: { 1: 4 } }, playerHandicaps: {} },
      ],
    };
    const rounds = collectMyRounds([t], 'u1', 'Ann Lee');
    expect(rounds).toHaveLength(1);
    expect(rounds[0].roundIndex).toBe(0);
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

  test('gains holesPlayed and isComplete — an early-finished 6-hole game is incomplete', () => {
    const h = holes18();
    const sixHoles = evenScores(h, 4);
    h.slice(6).forEach((hole) => { delete sixHoles[hole.number]; }); // only holes 1-6 scored
    const tournaments = [{
      id: 7, name: 'T', kind: 'game', finishedAt: '2026-05-22T18:00:00.000Z',
      players: [{ id: 'p1', user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: sixHoles } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) } }),
      ],
    }];
    const result = collectMyRounds(tournaments, 'u1');
    // Tournament-level finishedAt still marks it `completed` (selection default)...
    expect(result[0].completed).toBe(true);
    // ...but isComplete is the honest "every hole scored" signal.
    expect(result[0].isComplete).toBe(false);
    expect(result[0].holesPlayed).toBe(6);
    expect(result[1].isComplete).toBe(true);
    expect(result[1].holesPlayed).toBe(18);
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

  test('re-keys playerTees so legacy rounds fall back to the right tee', () => {
    const h = holes18();
    // Legacy round: no playerHandicaps, handicap derives from the tee set.
    const myRounds = collectMyRounds([{
      id: 6, name: 'T', players: [{ id: 'origA', name: 'Me', handicap: 9, user_id: 'u1' }],
      rounds: [mkRound({
        holes: h,
        scores: { origA: evenScores(h, 4) },
        playerHandicaps: {},
        playerTees: { origA: { label: 'Yellow', slope: 130, rating: 71.2 } },
      })],
    }], 'u1');
    const t = buildSyntheticTournament(myRounds);
    expect(t.rounds[0].playerTees[CANON_ID]).toEqual({ label: 'Yellow', slope: 130, rating: 71.2 });
    expect(t.rounds[0].playerTees.origA).toBeUndefined();
  });

  test('re-keys playerIndexes so a legacy round without playerHandicaps honors the override', () => {
    const h = holes18();
    // Legacy round: no playerHandicaps, no slope/tee — handicap resolves
    // purely from roundPlayerIndex, which reads round.playerIndexes.
    const myRounds = collectMyRounds([{
      id: 6, name: 'T', players: [{ id: 'origA', name: 'Me', handicap: 20, user_id: 'u1' }],
      rounds: [mkRound({
        holes: h,
        scores: { origA: evenScores(h, 4) },
        playerHandicaps: {},
        playerTees: null,
      })],
    }], 'u1');
    myRounds[0].round.playerIndexes = { origA: '9' };
    const t = buildSyntheticTournament(myRounds);
    expect(t.rounds[0].playerIndexes[CANON_ID]).toBe('9');
    expect(t.rounds[0].playerIndexes.origA).toBeUndefined();
    // No slope on this legacy round → calcPlayingHandicap rounds the index as-is.
    expect(getPlayingHandicap(t.rounds[0], t.players[0])).toBe(9);
  });

  test('derives the fallback player handicap from the most recent collected round', () => {
    const h = holes18();
    // Loaders return newest-first; collectMyRounds reverses to chronological.
    const myRounds = collectMyRounds([
      { id: 2, name: 'Newer', players: [{ id: 'p1', name: 'New Me', handicap: 8, user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 8 } })] },
      { id: 1, name: 'Older', players: [{ id: 'p1', name: 'Old Me', handicap: 20, user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 20 } })] },
    ], 'u1');
    const t = buildSyntheticTournament(myRounds);
    expect(t.players[0].handicap).toBe(8);
    expect(t.players[0].name).toBe('New Me');
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

  // The Players tab (StatsScreen.js) calls this straight off a real,
  // multi-player tournament — not a synthetic single-player one — so the
  // (tournament, playerId) signature must work unmodified against that
  // shape too. This locks in "reuse directly" over adding a thin wrapper.
  test('works against a real multi-player tournament, isolating the selected player', () => {
    const h = holes18();
    const tournament = {
      players: [
        { id: 'p1', name: 'Alice', handicap: 0 },
        { id: 'p2', name: 'Bob', handicap: 0 },
      ],
      rounds: [
        mkRound({
          holes: h,
          scores: { p1: evenScores(h, 4), p2: evenScores(h, 6) },
          playerHandicaps: { p1: 0, p2: 0 },
        }),
      ],
    };
    const split = holeDifficultySplit(tournament, 'p2');
    expect(split.hard.holes).toBe(6);
    // par 4, 6 strokes, handicap 0 → 2 + (4 - 6) = 0 pts on every band.
    expect(split.hard.avgPoints).toBe(0);
    expect(split.mid.avgPoints).toBe(0);
    expect(split.easy.avgPoints).toBe(0);
    // p1's holes must not leak into p2's split.
    expect(split.hard.breakdown.every((b) => b.strokes === 6)).toBe(true);
  });

  // Regression lock: a 9-hole round (SI 1-9) must NOT collapse into just
  // hard/mid with an always-empty easy band. Thresholds are derived from
  // the round's own max SI (here 9), not a hardcoded 18-hole scale, so the
  // 9 holes split evenly into three 3-hole bands.
  test('splits a 9-hole round (SI 1-9) into three non-empty bands', () => {
    const h = Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } })],
    }], 'u1');
    const split = holeDifficultySplit(buildSyntheticTournament(myRounds), CANON_ID);
    expect(split.hard.holes).toBe(3);
    expect(split.mid.holes).toBe(3);
    expect(split.easy.holes).toBe(3);
    expect(split.easy.holes).toBeGreaterThan(0);
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

  test('shot metrics are null, not 0, when no shot detail exists', () => {
    const h = holes18();
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } })],
    }], 'u1');
    const m = computeMetrics(buildSyntheticTournament(myRounds));
    expect(m.hasShotData).toBe(false);
    expect(m.fairwayPct).toBeNull();
    expect(m.girPct).toBeNull();
    expect(m.puttsPerRound).toBeNull();
    expect(m.threePuttsPerRound).toBeNull();
  });

  test('round-total metrics are null, not 0, when no selected round is complete', () => {
    const h = holes18();
    const sixHoles = evenScores(h, 4);
    h.slice(6).forEach((hole) => { delete sixHoles[hole.number]; }); // only holes 1-6 scored
    // An early-finished game: selectable by default (finishedAt), but there
    // is no round-total sample at all. Returning 0 would render as a
    // fabricated "Avg pts: 0 / Best round: 0" — the UI prints '-' for null.
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', kind: 'game', finishedAt: '2026-05-22T18:00:00.000Z',
      players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: sixHoles }, playerHandicaps: { p1: 0 } })],
    }], 'u1');
    const m = computeMetrics(buildSyntheticTournament(myRounds));
    expect(m.rounds).toBe(1); // still counts as a round played
    expect(m.avgPoints).toBeNull();
    expect(m.bestRoundPoints).toBeNull();
    expect(m.avgVsPar).toBeNull();
  });

  test('excludes an early-finished 6-hole game from avgPoints/bestRoundPoints/avgVsPar, but keeps its holes in per-hole metrics', () => {
    const h = holes18(); // par 4 x 18, scratch handicap → 2 pts/hole
    const sixHoles = evenScores(h, 4);
    h.slice(6).forEach((hole) => { delete sixHoles[hole.number]; }); // only holes 1-6 scored, 12 pts
    const tournaments = [{
      id: 1, name: 'T', kind: 'game', finishedAt: '2026-05-22T18:00:00.000Z',
      players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: sixHoles }, playerHandicaps: { p1: 0 } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } }), // 36 pts, complete
      ],
    }];
    const myRounds = collectMyRounds(tournaments, 'u1');
    const synthetic = buildSyntheticTournament(myRounds);
    const m = computeMetrics(synthetic);
    // Only the complete 18-hole round counts toward the round-total averages —
    // averaging in the 6-hole game's 12 pts as if it were a full round would
    // pull avgPoints down to 24.
    expect(m.avgPoints).toBe(36);
    expect(m.bestRoundPoints).toBe(36);
    expect(m.avgVsPar).toBe(0);
    // But per-hole metrics still see all 24 scored holes (6 from the partial
    // round + 18 from the complete one).
    const diff = holeDifficultySplit(synthetic, CANON_ID);
    expect(diff.hard.holes + diff.mid.holes + diff.easy.holes).toBe(24);
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

  test('splits into recent (last N) and history (earlier), disjoint — adequate history sample', () => {
    // 8 rounds; N=5 → history = first 3 (adequate, ≥3), recent = last 5
    const my = collectMyRounds(roundsTournament([6, 6, 6, 5, 5, 5, 5, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.recentCount).toBe(5);
    expect(r.historyCount).toBe(3);
    expect(r.hasHistory).toBe(true);
    const points = r.metrics.find((m) => m.key === 'avgPoints');
    expect(points.recent).toBeGreaterThan(points.history); // recent rounds lower strokes → more points
    expect(points.delta).not.toBeNull();
    expect(points.direction).toBe('up');
  });

  // Below MIN_HISTORY_ROUNDS (3), one noisy early round drove a confident
  // "declining"/"improving" verdict that fed straight into Coach
  // formInsight (which keys off `delta`, not `direction`). A 1-round
  // history is not a baseline — delta/direction must stay null/flat, not
  // a confident claim, even though the raw recent/history values are
  // still shown.
  test('a 1-round history sample is not enough to claim a direction — stays flat/null', () => {
    // 6 rounds; N=5 → history = first 1 (below the 3-round minimum), recent = last 5
    const my = collectMyRounds(roundsTournament([6, 5, 5, 5, 5, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.recentCount).toBe(5);
    expect(r.historyCount).toBe(1);
    expect(r.hasHistory).toBe(true); // there IS a history round — just not enough of one
    const points = r.metrics.find((m) => m.key === 'avgPoints');
    expect(points.recent).not.toBeNull();
    expect(points.history).not.toBeNull(); // raw values still surface — only the verdict is suppressed
    expect(points.delta).toBeNull();
    expect(points.direction).toBe('flat');
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

  test('shot metrics show no delta when only recent rounds have shot detail', () => {
    // 7 rounds, N=5: history = first 2 (no shot detail), recent = last 5 (tracked).
    const tournaments = roundsTournament([5, 5, 4, 4, 4, 4, 4]);
    const h = holes18();
    tournaments[0].rounds.forEach((round, i) => {
      if (i < 2) return; // history rounds stay untracked
      round.shotDetails = {
        p1: Object.fromEntries(h.map((hole) => [hole.number, { putts: 2, drive: 'fairway' }])),
      };
    });
    const my = collectMyRounds(tournaments, 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.hasHistory).toBe(true);
    ['fairwayPct', 'girPct', 'puttsPerRound', 'threePuttsPerRound'].forEach((key) => {
      const m = r.metrics.find((x) => x.key === key);
      expect(m.recent).not.toBeNull();
      expect(m.history).toBeNull();   // untracked slice must not read as 0
      expect(m.delta).toBeNull();     // no fake "+45 vs 0%" delta
      expect(m.direction).toBe('flat');
    });
  });

  test('an all-incomplete recent window yields null deltas and a flat direction, not a false decline', () => {
    // 7 rounds, N=5: the last 5 are early-finished 6-hole games (partial,
    // low round totals). If they fed avgPoints, "recent" would read ~12 pts
    // vs a 36-pt history — a fabricated "Declining" verdict.
    const tournaments = roundsTournament([4, 4, 4, 4, 4, 4, 4]);
    tournaments[0].finishedAt = '2026-05-22T18:00:00.000Z';
    const h = holes18();
    tournaments[0].rounds.forEach((round, i) => {
      if (i < 2) return; // first 2 (history) stay complete
      h.slice(6).forEach((hole) => { delete round.scores.p1[hole.number]; });
    });
    const my = collectMyRounds(tournaments, 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.hasHistory).toBe(true);
    ['avgPoints', 'avgVsPar'].forEach((key) => {
      const m = r.metrics.find((x) => x.key === key);
      expect(m.recent).toBeNull();
      expect(m.delta).toBeNull();
      expect(m.direction).toBe('flat');
    });
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
      isComplete: true,
      holesPlayed: holes.length,
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

  test('appends a short date to the label when the round has a tournament date', () => {
    const h = holes18();
    const mr = myRound('Pine', h, 4);
    mr.tournamentDate = '2026-05-12T10:00:00.000Z';
    const { metrics } = computeFormSeries([mr]);
    expect(metrics.avgPoints[0].label).toBe('Pine · 12 May');
  });

  test('avgPoints/avgVsPar are null (a gap) for an incomplete round, not its partial total', () => {
    const h = holes18();
    const sixHoleScores = evenScores(h, 4);
    h.slice(6).forEach((hole) => { delete sixHoleScores[hole.number]; });
    const mr = myRound('Oak', h, 4);
    mr.round.scores.p1 = sixHoleScores;
    mr.isComplete = false;
    mr.holesPlayed = 6;
    const { metrics } = computeFormSeries([mr]);
    expect(metrics.avgPoints[0].value).toBeNull();
    expect(metrics.avgVsPar[0].value).toBeNull();
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
    // +0.43 (was −0.09): a 200+ miss to a greenside lie now uses a realistic
    // greenside node instead of a recovery-from-trouble node.
    expect(stats.approachTarget.buckets['200+']).toMatchObject({ holes: 6, avgSg: 0.43 });
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

  test('distributionGross is gross vs par while distribution stays net', () => {
    // Handicap 18 gives exactly 1 extra shot on every hole. Scoring gross
    // par (4) nets out as a net birdie under the points metric — comparing
    // that inflated net-birdie count against a gross benchmark table would
    // always read as green, so the ShotsTab benchmark reads the separate
    // gross field. The shared `distribution` must STAY net: BreakdownTab,
    // roundReportCard and formSeries.scoreMix all report net and must agree.
    const h = holes18();
    const myRound = {
      key: 'gross:0',
      round: mkRound({
        holes: h,
        scores: { p1: evenScores(h, 4) },
        shotDetails: {},
        playerHandicaps: { p1: 18 },
      }),
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 18 },
      courseName: 'Gross',
      tournamentName: 'T',
      tournamentDate: '2026-05-30',
      completed: true,
    };

    const stats = computeMyStats([myRound]);

    // Gross benchmark field: 18 gross pars, no birdies.
    expect(stats.distributionGross.birdies).toBe(0);
    expect(stats.distributionGross.pars).toBe(18);
    // Net field is unchanged: every gross par is a net birdie at hcp 18.
    expect(stats.distribution.birdies).toBe(18);
    expect(stats.distribution.pars).toBe(0);
  });
});

describe('computeMyStats baselineOnly', () => {
  // Two rounds with shot detail so the discarded pipeline (shot-impact,
  // strokes gained, form series) would have real data to chew on if it ran.
  function twoRoundsWithShots() {
    const h = holes18();
    const shotDetails = {};
    h.forEach((hole) => {
      shotDetails[hole.number] = {
        drive: 'fairway', approachBucket: '100-150', putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      };
    });
    const mk = (key, strokes, date) => ({
      key,
      round: mkRound({ holes: h, scores: { p1: evenScores(h, strokes) }, shotDetails: { p1: shotDetails }, playerHandicaps: { p1: 0 } }),
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0 },
      courseName: 'Baseline',
      tournamentName: 'T',
      tournamentDate: date,
      completed: true,
    });
    return [mk('r1', 4, '2026-05-01'), mk('r2', 5, '2026-05-08')];
  }

  const BASELINE_FIELDS = [
    'distribution', 'shots', 'parType', 'difficulty', 'warmupClosing', 'frontBack',
    'history', 'roundCount',
  ];

  test('returns byte-identical baseline fields to the full pipeline', () => {
    const rounds = twoRoundsWithShots();
    const full = computeMyStats(rounds, { targetHandicap: 10 });
    const baseline = computeMyStats(rounds, { targetHandicap: 10, baselineOnly: true });
    BASELINE_FIELDS.forEach((field) => {
      expect(baseline[field]).toEqual(full[field]);
    });
    expect(baseline.targetHandicap).toBe(full.targetHandicap);
    expect(baseline.shotBenchmark).toEqual(full.shotBenchmark);
  });

  test('omits the coach/action/form/SG-season pipeline entirely', () => {
    const rounds = twoRoundsWithShots();
    const baseline = computeMyStats(rounds, { baselineOnly: true });
    [
      'coach', 'actionPlan', 'formSeries', 'strokesGained', 'ranking', 'metrics', 'form',
      'driveImpact', 'approachImpact', 'puttDive', 'puttingTarget', 'approachTarget',
      'teeShot', 'distributionGross', 'bounceBack', 'scrambling', 'courseMastery',
      'careerMilestones', 'lagPutting', 'sandSaves', 'upAndDown', 'bunkerVisits',
    ].forEach((field) => {
      expect(baseline[field]).toBeUndefined();
    });
  });

  test('does not invoke the coach/impact/target-gap/SG pipeline (cross-module spies)', () => {
    const spies = [
      jest.spyOn(coachInsights, 'buildCoachInsights'),
      jest.spyOn(statsEngine, 'sgSeason'),
      jest.spyOn(statsEngine, 'driveScoreImpact'),
      jest.spyOn(statsEngine, 'approachScoreImpact'),
      jest.spyOn(statsEngine, 'puttDeepDive'),
      jest.spyOn(statsEngine, 'puttingTargetGaps'),
      jest.spyOn(statsEngine, 'approachTargetGaps'),
      jest.spyOn(statsEngine, 'teeShotImpact'),
      jest.spyOn(statsEngine, 'playerConsistency'),
      jest.spyOn(statsEngine, 'courseDNA'),
      jest.spyOn(statsEngine, 'bounceBackRate'),
      jest.spyOn(statsEngine, 'scramblingStats'),
      jest.spyOn(statsEngine, 'lagPuttingQuality'),
      jest.spyOn(statsEngine, 'sandSaveRate'),
      jest.spyOn(statsEngine, 'upAndDownRate'),
      jest.spyOn(statsEngine, 'bunkerVisits'),
    ];

    const rounds = twoRoundsWithShots();
    computeMyStats(rounds, { baselineOnly: true });
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    // Sanity: the same spies DO fire on the full (non-baseline) path, so a
    // false negative above (e.g. import wiring) would show up here instead.
    computeMyStats(rounds);
    spies.forEach((spy) => expect(spy).toHaveBeenCalled());

    spies.forEach((spy) => spy.mockRestore());
  });

  test('does not run the per-round form-series pass (call-count spy)', () => {
    // computeFormSeries and computeMetrics are local to personalStats.js, so
    // they can't be spied on directly (same-module self-calls bypass a
    // jest.spyOn on the exports object). Instead we prove they didn't run by
    // counting calls to the cross-module functions they delegate to:
    // baselineOnly should call each exactly once (for the direct baseline
    // field), never once-per-round (formSeries) or an extra time
    // (computeMetrics/distributionGross/careerMilestones).
    const distSpy = jest.spyOn(statsEngine, 'playerScoreDistribution');
    const shotsSpy = jest.spyOn(statsEngine, 'shotStats');

    const rounds = twoRoundsWithShots();
    computeMyStats(rounds, { baselineOnly: true });
    expect(distSpy).toHaveBeenCalledTimes(1);
    expect(shotsSpy).toHaveBeenCalledTimes(1);

    distSpy.mockClear();
    shotsSpy.mockClear();

    // Full path: distribution + distributionGross + one per round (formSeries)
    // + careerMilestones's own call = more than 1; shots: direct + metrics +
    // one per round (formSeries) = more than 1. We only assert "more", not an
    // exact count, so this stays robust to unrelated internal refactors.
    computeMyStats(rounds);
    expect(distSpy.mock.calls.length).toBeGreaterThan(1);
    expect(shotsSpy.mock.calls.length).toBeGreaterThan(1);

    distSpy.mockRestore();
    shotsSpy.mockRestore();
  });
});

// ── Two-course fixture shared by courseMastery / careerMilestones ──
// Chronological order: Pine (36 pts), Oak (54 pts, complete), Pine (18 pts),
// Oak (incomplete — only holes 1-6 scored, must be excluded from every
// round-total figure below). Handicap 0 throughout, par 4 x 18, so net
// points/hole = 2 + par - strokes:
//   strokes 4 → 2 pts/hole → 36 pts/round (Pine A)
//   strokes 5 → 1 pt/hole  → 18 pts/round (Pine B)
//   strokes 3 → 3 pts/hole → 54 pts/round (Oak C)
function twoCourseTournament() {
  const h = holes18();
  const pineA = mkRound({
    courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 },
  });
  const oakC = mkRound({
    courseName: 'Oak', holes: h, scores: { p1: evenScores(h, 3) }, playerHandicaps: { p1: 0 },
  });
  const pineB = mkRound({
    courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 },
  });
  const oakDScores = evenScores(h, 6);
  h.slice(6).forEach((hole) => { delete oakDScores[hole.number]; }); // only holes 1-6 scored
  const oakD = mkRound({
    courseName: 'Oak', holes: h, scores: { p1: oakDScores }, playerHandicaps: { p1: 0 },
  });
  return [{
    id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
    rounds: [pineA, oakC, pineB, oakD],
  }];
}

describe('courseMastery', () => {
  test('per-course rounds/avgPoints/bestPoints/trend, complete rounds only', () => {
    const myRounds = collectMyRounds(twoCourseTournament(), 'u1');
    const synthetic = buildSyntheticTournament(myRounds);
    const mastery = courseMastery(synthetic);

    // Oak: 1 complete round (54 pts) — the 6-hole round is excluded, so
    // rounds=1 and trend has nothing to compare against (null, NOT 0 —
    // 0 is a claim about two equal rounds, not a missing comparison).
    // Pine: 2 complete rounds (36, then 18) — avg 27, best 36, trend down
    // (latest 18 < previous 36 → -1).
    expect(mastery).toEqual([
      { courseName: 'Oak', rounds: 1, avgPoints: 54, bestPoints: 54, trend: null },
      { courseName: 'Pine', rounds: 2, avgPoints: 27, bestPoints: 36, trend: -1 },
    ]);
  });

  test('a complete round with an empty courseName keeps its real bestPoints under the R{n} identity', () => {
    // SetupScreen/OfficialCreateScreen default courseName to '' — courseDNA
    // keys such a round 'R{n}'. bestPoints/trend must come from the same
    // keying, not silently collapse to 0 on a name mismatch.
    const h = holes18();
    const tournaments = [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ courseName: '', holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } })],
    }];
    const mastery = courseMastery(buildSyntheticTournament(collectMyRounds(tournaments, 'u1')));
    expect(mastery).toEqual([
      { courseName: 'R1', rounds: 1, avgPoints: 36, bestPoints: 36, trend: null },
    ]);
  });

  test('pools rounds by courseId when the course label was renamed', () => {
    // EditTournamentScreen lets users rename a round's course label without
    // changing courseId — one physical course must stay one mastery row
    // (courseId ?? courseName, the strokeIndexAccuracy/nemesisEncore
    // convention), shown under its most recent label.
    const h = holes18();
    const r1 = mkRound({ courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } });
    r1.courseId = 'c9';
    const r2 = mkRound({ courseName: 'Pine GC (renamed)', holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 } });
    r2.courseId = 'c9';
    const tournaments = [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [r1, r2],
    }];
    const mastery = courseMastery(buildSyntheticTournament(collectMyRounds(tournaments, 'u1')));
    expect(mastery).toEqual([
      { courseName: 'Pine GC (renamed)', rounds: 2, avgPoints: 27, bestPoints: 36, trend: -1 },
    ]);
  });

  test('trend is 0 for genuinely equal consecutive rounds', () => {
    const h = holes18();
    const mk = () => mkRound({ courseName: 'Elm', holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } });
    const tournaments = [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mk(), mk()],
    }];
    const mastery = courseMastery(buildSyntheticTournament(collectMyRounds(tournaments, 'u1')));
    expect(mastery).toEqual([
      { courseName: 'Elm', rounds: 2, avgPoints: 36, bestPoints: 36, trend: 0 },
    ]);
  });

  // A 1-point swing between the two most recent rounds is inside the noise
  // band (one extra stroke on a single hole) — it must not paint a
  // confident "improving"/"declining" arrow in the Course Mastery UI.
  test('a 1-point difference between the two latest rounds is flat, not a fake trend arrow', () => {
    const h = holes18();
    // strokes 4 → 36 pts/round; strokes 4 on all but one hole (that hole
    // strokes 5) → 35 pts/round. A genuine 1-point swing.
    const roundA = mkRound({ courseName: 'Birch', holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } });
    const scoresB = evenScores(h, 4);
    scoresB[1] = 5;
    const roundB = mkRound({ courseName: 'Birch', holes: h, scores: { p1: scoresB }, playerHandicaps: { p1: 0 } });
    const tournaments = [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [roundA, roundB],
    }];
    const mastery = courseMastery(buildSyntheticTournament(collectMyRounds(tournaments, 'u1')));
    expect(mastery).toEqual([
      { courseName: 'Birch', rounds: 2, avgPoints: 35.5, bestPoints: 36, trend: 0 },
    ]);
  });

  test('a real multi-point swing still yields a confident trend arrow', () => {
    const h = holes18();
    const roundA = mkRound({ courseName: 'Cedar', holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } });
    const roundB = mkRound({ courseName: 'Cedar', holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 } });
    const tournaments = [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [roundA, roundB],
    }];
    const mastery = courseMastery(buildSyntheticTournament(collectMyRounds(tournaments, 'u1')));
    expect(mastery).toEqual([
      { courseName: 'Cedar', rounds: 2, avgPoints: 27, bestPoints: 36, trend: -1 },
    ]);
  });

  test('returns an empty list with no rounds', () => {
    expect(courseMastery(buildSyntheticTournament([]))).toEqual([]);
  });
});

describe('careerMilestones', () => {
  test('birdies/eagles/streak see every scored hole; bestNine/bestRound use complete rounds only', () => {
    const myRounds = collectMyRounds(twoCourseTournament(), 'u1');
    const synthetic = buildSyntheticTournament(myRounds);
    const milestones = careerMilestones(synthetic);

    // Oak's complete round (strokes 3, vsPar -1) is a birdie on all 18
    // holes — no eagles anywhere. The 6-hole incomplete round (vsPar +2,
    // double bogey) still contributes its holes to the distribution but
    // never a birdie/eagle.
    expect(milestones.birdies).toBe(18);
    expect(milestones.eagles).toBe(0);
    // Longest run of par-or-better holes: a full 18-hole round at par
    // (Pine A) or birdie (Oak C) — either way, 18 consecutive holes.
    expect(milestones.longestParStreak).toBe(18);
    // Best nine: max single-nine total across complete 18-hole rounds —
    // Oak C's front/back nine (27 each) beats Pine's 18/9.
    expect(milestones.bestNine).toBe(27);
    // Best round: highest round-total points among complete rounds — Oak C
    // at 54, ahead of Pine's 36 and 18.
    expect(milestones.bestRound).toBe(54);
  });

  test('bestNine/bestRound are null (not 0) with no complete rounds, but per-hole feats still count', () => {
    const h = holes18();
    const sixHoles = evenScores(h, 3); // birdie pace, but only 6 holes scored
    h.slice(6).forEach((hole) => { delete sixHoles[hole.number]; });
    const tournaments = [{
      id: 1, name: 'T', kind: 'game', finishedAt: '2026-05-22T18:00:00.000Z',
      players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: sixHoles }, playerHandicaps: { p1: 0 } })],
    }];
    const myRounds = collectMyRounds(tournaments, 'u1');
    const synthetic = buildSyntheticTournament(myRounds);
    const milestones = careerMilestones(synthetic);

    expect(milestones.bestNine).toBeNull();
    expect(milestones.bestRound).toBeNull();
    expect(milestones.birdies).toBe(6);
    expect(milestones.longestParStreak).toBe(6);
  });

  test('returns zeros and nulls with no rounds at all', () => {
    const milestones = careerMilestones(buildSyntheticTournament([]));
    expect(milestones).toEqual({
      birdies: 0, eagles: 0, longestParStreak: 0, bestNine: null, bestRound: null,
    });
  });
});
