import { pairBoard } from '../homePairs';

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const players = [
  { id: 'p1', name: 'Luis Gómez', user_id: 'u1' },
  { id: 'p2', name: 'Pablo Martín', user_id: 'u2' },
  { id: 'p3', name: 'Marcos', user_id: 'u3' },
  { id: 'p4', name: 'Javier Ruiz', user_id: 'u4' },
];
// Hole 1: Luis 3 pts, Pablo 2 | Marcos 2, Javier 1 → pair A takes best and worst.
// Hole 2: Luis 2, Pablo 2 | Marcos 3, Javier 2 → B takes the best ball, the worst is halved.
// Hole 3: only Luis has scored.
const scores = {
  p1: { 1: 3, 2: 4, 3: 4 },
  p2: { 1: 4, 2: 4 },
  p3: { 1: 4, 2: 3 },
  p4: { 1: 5, 2: 4 },
};

function game(mode, settings = {}) {
  const round = {
    id: 'r1', holes, scores, scoringMode: mode,
    pairs: [[{ id: 'p1' }, { id: 'p2' }], [{ id: 'p3' }, { id: 'p4' }]],
    playerHandicaps: { p1: 0, p2: 0, p3: 0, p4: 0 },
  };
  return { tournament: { id: 't', kind: 'game', players, settings: { scoringMode: mode, ...settings }, rounds: [round] }, round };
}

describe('pairBoard', () => {
  it('scores Best Ball / Worst Ball as the match panel does: holes won times their values, halves score nothing', () => {
    const { tournament, round } = game('bestball');
    const b = pairBoard(tournament, round, 'p3');
    expect(b.mode).toBe('bestball');
    // My pair (B) first.
    expect(b.sides.map((sd) => [sd.side, sd.ids, sd.mine, sd.points])).toEqual([
      [1, ['p3', 'p4'], true, 1],
      [0, ['p1', 'p2'], false, 2],
    ]);
    expect(b.sides[1].holes[1]).toBe(2);
    expect(b.sides[0].holes[2]).toBe(1);
    expect(b.sides[1].holes[2]).toBe(0);
    expect(b.sides[0].holes[3]).toBeNull();
    expect(b.balls.slice(0, 3)).toEqual([
      { number: 1, best: 0, worst: 0 },
      { number: 2, best: 1, worst: 'halved' },
      { number: 3, best: null, worst: null },
    ]);
    expect(b).toMatchObject({ leader: 0, lead: 1, holesLeft: 16 });
  });

  it('uses the round\'s ball values', () => {
    const { tournament, round } = game('bestball', { bestBallValue: 2, worstBallValue: 1 });
    const b = pairBoard(tournament, round, 'p1');
    expect(b.sides.map((sd) => sd.points)).toEqual([3, 2]);
  });

  it('adds up the partners\' Stableford points in Stableford with Partners', () => {
    const { tournament, round } = game('stableford');
    const b = pairBoard(tournament, round, 'p1');
    expect(b.balls).toBeNull();
    expect(b.sides[0].holes[1]).toBe(5);
    expect(b.sides[0].holes[2]).toBe(4);
    // Hole 3 counts in the total (Luis's 2) but has no pair cell until both have scored.
    expect(b.sides[0].holes[3]).toBeNull();
    expect(b.sides.map((sd) => sd.points)).toEqual([11, 8]);
    expect(b).toMatchObject({ leader: 0, lead: 3 });
  });

  it('is null for games without two pairs', () => {
    const { tournament, round } = game('individual');
    expect(pairBoard(tournament, round, 'p1')).toBeNull();
    const one = game('bestball');
    one.round.pairs = [[{ id: 'p1' }, { id: 'p2' }]];
    expect(pairBoard(one.tournament, one.round, 'p1')).toBeNull();
    expect(pairBoard(one.tournament, null, 'p1')).toBeNull();
  });

  it('says level when the pairs are tied', () => {
    const { tournament, round } = game('bestball');
    round.scores = { p1: { 1: 4 }, p2: { 1: 4 }, p3: { 1: 4 }, p4: { 1: 4 } };
    expect(pairBoard(tournament, round, 'p1')).toMatchObject({ leader: null, lead: 0 });
  });
});
