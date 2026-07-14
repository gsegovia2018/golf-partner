import { tournamentPlayerClinched } from '../tournamentStore';

// tournamentStore imports the supabase client at module load; stub it out so
// these pure-function tests don't touch IO (same pattern as roundPairClinched.test.js).
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({}),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

// Two players, handicap 0, so on a par-4 hole Stableford points = 6 − strokes.
const A = { id: 'a', name: 'Alex', handicap: 0 };
const B = { id: 'b', name: 'Bo', handicap: 0 };
const players = [A, B];
const holes = [
  { number: 1, par: 4, strokeIndex: 1 },
  { number: 2, par: 4, strokeIndex: 2 },
];

describe('tournamentPlayerClinched — stableford, stale currentRound', () => {
  test('detects clinch from a fully-scored later round even when currentRound is stale at 0', () => {
    // Round 0 (idx 0): a and b tie every hole (4 strokes each → 2 pts each
    // hole) — 0 lead, fully played.
    // Round 1 (idx 1): a plays better (2 strokes → 4 pts/hole) than b (4
    // strokes → 2 pts/hole) — a leads round 1 by 4 — fully played. But
    // currentRound never advanced past 0. The old idx > currentRound check
    // treated round 1 as "future" and added its full max-possible points
    // (10) to BOTH players' remaining, ignoring the real (already-locked-in)
    // outcome — hiding a's cumulative lead of 4 behind a phantom 10-point
    // swing. Scored state (isRoundPlayed) must recognize round 1 as played,
    // so b's real remaining is 0 and a's lead of 4 clinches.
    const tied = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 4, 2: 4 } },
    };
    const decisive = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 2, 2: 2 }, b: { 1: 4, 2: 4 } },
    };
    const tournament = {
      players,
      settings: { scoringMode: 'stableford' },
      rounds: [tied, decisive],
      currentRound: 0,
    };
    expect(tournamentPlayerClinched(tournament, 'stableford')).toBe('a');
  });

  test('a genuinely future (unplayed) round still keeps its holes in remaining', () => {
    // Round 0 fully played, decisive lead. Round 1 is genuinely unplayed
    // (no scores) — its holes must still count as real remaining, so a
    // lead that a truly-unplayed round could overturn is NOT a clinch.
    const decisive = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 2, 2: 2 }, b: { 1: 4, 2: 4 } },
    };
    const future = { holes, playerHandicaps: {}, scores: {} };
    const tournament = {
      players,
      settings: { scoringMode: 'stableford' },
      rounds: [decisive, future],
      currentRound: 0,
    };
    // a's lead after round 0 is 4; round 1 (unplayed) offers b up to 10
    // more points, so the lead can still be overturned — not clinched.
    expect(tournamentPlayerClinched(tournament, 'stableford')).toBeNull();
  });
});
