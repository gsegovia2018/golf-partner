import { collectMyRounds, buildSyntheticTournament, CANON_ID } from '../personalStats';

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
