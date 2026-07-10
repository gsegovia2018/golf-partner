import { roundPairClinched } from '../tournamentStore';

// tournamentStore imports the supabase client at module load; stub it out so
// these pure-function tests don't touch IO (same pattern as bestWorstRoles.test.js).
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({}),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

// Four players, handicap 0, so on a par-4 hole Stableford points = 6 − strokes.
const A1 = { id: 'a1', name: 'A1', handicap: 0 };
const A2 = { id: 'a2', name: 'A2', handicap: 0 };
const B1 = { id: 'b1', name: 'B1', handicap: 0 };
const B2 = { id: 'b2', name: 'B2', handicap: 0 };
const players = [A1, A2, B1, B2];

// strokesByHole: { a1: [h1, h2, ...], ... } — null = unscored hole.
function makeRound(strokesByHole) {
  const holeCount = strokesByHole.a1.length;
  const holes = Array.from({ length: holeCount }, (_, i) => ({
    number: i + 1, par: 4, strokeIndex: i + 1,
  }));
  const scores = {};
  players.forEach((p) => {
    scores[p.id] = {};
    strokesByHole[p.id].forEach((s, i) => {
      if (s != null) scores[p.id][i + 1] = s;
    });
  });
  return {
    holes,
    scores,
    pairs: [[A1, A2], [B1, B2]],
    playerHandicaps: { a1: 0, a2: 0, b1: 0, b2: 0 },
  };
}

describe('roundPairClinched — bestball', () => {
  const settings = { bestBallValue: 1, worstBallValue: 1 };

  // Pair A wins the best ball (worst halved) on each of the first two holes:
  // A up 2 with one hole left. The last hole is worth bestBallValue +
  // worstBallValue = 2 to pair B, so B can still TIE — not clinched.
  test('lead equal to the max remaining swing is NOT a clinch (tie still possible)', () => {
    const round = makeRound({
      a1: [4, 4, null],
      a2: [5, 5, null],
      b1: [5, 5, null],
      b2: [5, 5, null],
    });
    expect(roundPairClinched(round, players, settings, 'bestball')).toBeNull();
  });

  test('lead greater than the max remaining swing IS a clinch', () => {
    // Three best-ball wins → A up 3, one hole (max swing 2) left.
    const round = makeRound({
      a1: [4, 4, 4, null],
      a2: [5, 5, 5, null],
      b1: [5, 5, 5, null],
      b2: [5, 5, 5, null],
    });
    expect(roundPairClinched(round, players, settings, 'bestball')).toBe(0);
  });

  test('all holes scored and strictly ahead is a clinch', () => {
    const round = makeRound({
      a1: [4], a2: [5], b1: [5], b2: [5],
    });
    expect(roundPairClinched(round, players, settings, 'bestball')).toBe(0);
  });
});

describe('roundPairClinched — stableford (partners)', () => {
  // Hole 1: A1/A2 hole out in 1 (5 pts each → 10 combined); B1/B2 blob
  // (0 pts). Hole 2 unscored by everyone: B's max remaining is 5 + 5 = 10,
  // so B can still exactly tie at 10 — not clinched.
  test('lead equal to the trailing pair max remaining is NOT a clinch', () => {
    const round = makeRound({
      a1: [1, null],
      a2: [1, null],
      b1: [6, null],
      b2: [6, null],
    });
    expect(roundPairClinched(round, players, {}, 'stableford')).toBeNull();
  });

  test('lead greater than the trailing pair max remaining IS a clinch', () => {
    // All holes scored, A strictly ahead → nothing left for B.
    const round = makeRound({
      a1: [3], a2: [3], b1: [5], b2: [5],
    });
    expect(roundPairClinched(round, players, {}, 'stableford')).toBe(0);
  });
});
