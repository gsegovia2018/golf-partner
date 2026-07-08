import {
  pairsMatchDuels,
  pairsMatchHolePts,
  pairsMatchDuelPts,
  pairsMatchRoundTally,
} from '../scoring';

const P = (id, handicap = 0) => ({ id, name: id, handicap });
const pairs = [[P('a'), P('b')], [P('c'), P('d')]]; // duels: a-c, b-d
const hole1 = { number: 1, par: 4, strokeIndex: 1 };

describe('pairsMatchDuels', () => {
  it('index-matches across the two pairs', () => {
    const duels = pairsMatchDuels(pairs);
    expect(duels.map((d) => d.map((p) => p.id))).toEqual([['a', 'c'], ['b', 'd']]);
  });
  it('rejects malformed shapes', () => {
    expect(pairsMatchDuels(null)).toBeNull();
    expect(pairsMatchDuels([[P('a')], [P('c'), P('d')]])).toBeNull();
    expect(pairsMatchDuels([[P('a'), P('b')]])).toBeNull();
  });
});

describe('pairsMatchHolePts', () => {
  it('awards 1 per duel win and ½ each on a halve — 2 points always distributed', () => {
    // a beats c, b halves with d → team1 = 1.5, team2 = 0.5
    const scores = { a: { 1: 4 }, c: { 1: 5 }, b: { 1: 4 }, d: { 1: 4 } };
    const pts = pairsMatchHolePts(hole1, pairs, scores, {});
    expect(pts).toEqual({ team1: 1.5, team2: 0.5, decidedDuels: 2 });
    expect(pts.team1 + pts.team2).toBe(2);
  });

  it('unscored duel contributes nothing yet', () => {
    const scores = { a: { 1: 4 }, c: { 1: 5 } }; // b/d haven't scored
    const pts = pairsMatchHolePts(hole1, pairs, scores, {});
    expect(pts).toEqual({ team1: 1, team2: 0, decidedDuels: 1 });
  });

  it('net scoring via stroke index', () => {
    // gross: a 5, c 4 — but a gets a shot on SI 1 with handicap 18 → net 4 = halve
    const scores = { a: { 1: 5 }, c: { 1: 4 }, b: { 1: 4 }, d: { 1: 5 } };
    const pts = pairsMatchHolePts(hole1, pairs, scores, { a: 18, b: 0, c: 0, d: 0 });
    expect(pts.team1).toBe(1.5); // a halves (0.5) + b wins (1)
    expect(pts.team2).toBe(0.5);
  });
});

describe('pairsMatchDuelPts', () => {
  it('returns the individual duel result for a player', () => {
    const scores = { a: { 1: 4 }, c: { 1: 5 }, b: { 1: 4 }, d: { 1: 4 } };
    expect(pairsMatchDuelPts(hole1, 'a', pairs, scores, {})).toBe(1);
    expect(pairsMatchDuelPts(hole1, 'c', pairs, scores, {})).toBe(0);
    expect(pairsMatchDuelPts(hole1, 'b', pairs, scores, {})).toBe(0.5);
    expect(pairsMatchDuelPts(hole1, 'd', pairs, scores, {})).toBe(0.5);
  });
  it('null while the duel is not fully scored', () => {
    expect(pairsMatchDuelPts(hole1, 'a', pairs, { a: { 1: 4 } }, {})).toBeNull();
  });
});

describe('pairsMatchRoundTally', () => {
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
    { number: 3, par: 4, strokeIndex: 3 },
  ];

  it('accumulates team points and per-duel tallies', () => {
    const round = {
      holes,
      pairs,
      playerHandicaps: {},
      scores: {
        a: { 1: 4, 2: 4 }, c: { 1: 5, 2: 4 }, // a wins h1, halves h2
        b: { 1: 4, 2: 5 }, d: { 1: 4, 2: 4 }, // halve h1, d wins h2
      },
    };
    const t = pairsMatchRoundTally(round, [...pairs[0], ...pairs[1]]);
    expect(t.team1).toBe(2); // 1 + 0.5 + 0.5
    expect(t.team2).toBe(2); // 0.5 + 0.5 + 1
    expect(t.leaderIdx).toBeNull();
    expect(t.clinched).toBe(false);
    expect(t.holesLeft).toBe(1);
    expect(t.duels[0]).toMatchObject({ aId: 'a', bId: 'c', aPts: 1.5, bPts: 0.5 });
  });

  it('clinches when lead exceeds the trailing side\'s max remaining points', () => {
    const round = {
      holes,
      pairs,
      playerHandicaps: {},
      scores: {
        a: { 1: 3, 2: 3 }, c: { 1: 5, 2: 5 },
        b: { 1: 3, 2: 3 }, d: { 1: 5, 2: 5 },
      },
    };
    // team1 = 4, team2 = 0, one hole (2 pts) left → 4 > 0 + 2 → clinched
    const t = pairsMatchRoundTally(round, [...pairs[0], ...pairs[1]]);
    expect(t.team1).toBe(4);
    expect(t.clinched).toBe(true);
    expect(t.leaderIdx).toBe(0);
  });

  it('null for malformed pairs', () => {
    expect(pairsMatchRoundTally({ holes, pairs: [[P('a')], [P('c')]] }, [])).toBeNull();
  });
});
