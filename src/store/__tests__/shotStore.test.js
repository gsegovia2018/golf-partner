import {
  logShot, getShots, shotsForHole,
  deleteShotsForRound, pruneShotsToRounds,
} from '../shotStore';

// No signed-in user → the store stays local-only (no Supabase round-trips),
// which is exactly the path we want to exercise for the filtering logic.
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const at = (roundId, hole, seq) => logShot({
  roundId, roundIndex: 0, holeNumber: hole, pos: [40 + seq * 1e-4, -3], club: '7i',
});

describe('shotStore round cleanup', () => {
  beforeEach(async () => {
    // Clear any residue from a previous test by pruning to nothing.
    await pruneShotsToRounds(new Set());
  });

  it('deleteShotsForRound removes only that round', async () => {
    await at('r1', 1, 1);
    await at('r1', 1, 2);
    await at('r2', 1, 1);
    expect(getShots()).toHaveLength(3);

    await deleteShotsForRound('r1');
    const left = getShots();
    expect(left).toHaveLength(1);
    expect(left[0].roundId).toBe('r2');
    expect(shotsForHole('r1', 0, 1)).toHaveLength(0);
  });

  it('pruneShotsToRounds drops shots for unknown rounds', async () => {
    await at('keep', 1, 1);
    await at('gone', 1, 1);
    await at('gone', 2, 1);

    const removed = await pruneShotsToRounds(new Set(['keep']));
    expect(removed).toBe(2);
    expect(getShots().every((s) => s.roundId === 'keep')).toBe(true);
  });
});
