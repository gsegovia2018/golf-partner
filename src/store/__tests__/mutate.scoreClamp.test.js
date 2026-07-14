// score.set mutations must clamp the entered stroke count to [1, pickup] in
// the STORE, so every entry path (keypad text field, +/- stepper, and any
// sync-replay of this device's own queued mutations) is protected — not just
// whichever UI widget happens to validate its own input. See scoring.js's
// pickupStrokes/clampScoreInput for the shared threshold math.
//
// jest.mock calls are hoisted above imports by babel-jest.
jest.mock('../syncWorker', () => ({ scheduleSync: jest.fn(), syncNow: jest.fn() }));
jest.mock('../tournamentStore', () => ({
  saveLocal: jest.fn(async () => {}),
  _setSyncStatus: jest.fn(),
}));
jest.mock('../syncQueue', () => ({ syncQueue: { enqueue: jest.fn(async () => {}) } }));
jest.mock('../../lib/connectivity', () => ({ isOnline: () => true }));

// eslint-disable-next-line import/first
import { mutate } from '../mutate';
// eslint-disable-next-line import/first
import { syncQueue } from '../syncQueue';

// Par-4, stroke index 1 hole, scratch player (no extra shots) — pickup is
// par + 2 + 0 extra = 6.
const tournamentWithHole = (playerHandicaps = {}) => ({
  id: 't1',
  players: [{ id: 'p1', handicap: 0 }],
  rounds: [{
    id: 'r1',
    scores: {},
    holes: [{ number: 3, par: 4, strokeIndex: 1 }],
    playerHandicaps,
  }],
});

beforeEach(() => jest.clearAllMocks());

describe('score.set clamps to [1, pickup] in the store', () => {
  it('clamps an over-entered score (44 meant 4) down to the pickup max', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 44, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1[3]).toBe(6);
  });

  it('clamps a negative entry up to 1', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: -1, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1[3]).toBe(1);
  });

  it('clamps a zero entry up to 1', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 0, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1[3]).toBe(1);
  });

  it('leaves a normal, in-range score unchanged', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 4, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1[3]).toBe(4);
  });

  it('clearing a score (undefined) still yields no score, not 1', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: undefined, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1?.[3]).toBeUndefined();
  });

  it('clearing a score (null) still yields no score, not 1', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: null, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1?.[3]).toBeUndefined();
  });

  it('raises the pickup ceiling when the player has extra shots on this hole', async () => {
    // handicap 18 on SI 1 => +1 extra shot => pickup = 4 + 2 + 1 = 7.
    const t = await mutate(tournamentWithHole({ p1: 18 }), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 44, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1[3]).toBe(7);
  });

  it('passes through unclamped when the hole cannot be found (defensive fallback)', async () => {
    const t = await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 99, value: 44, authorId: 'p1',
    });
    expect(t.rounds[0].scores.p1[99]).toBe(44);
  });

  it('enqueues the CLAMPED value, not the raw entry, so the server never receives the corrupted number', async () => {
    await mutate(tournamentWithHole(), {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 44, authorId: 'p1',
    });
    expect(syncQueue.enqueue).toHaveBeenCalledTimes(1);
    const enqueued = syncQueue.enqueue.mock.calls[0][0];
    expect(enqueued.mutation.value).toBe(6);
  });
});
