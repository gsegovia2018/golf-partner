// Regression test for the drainTournament read-modify-write race:
// the sync worker snapshots the local blob, does a slow network fetchRemote,
// then merges + writes back. An edit made WHILE fetchRemote is in flight is
// saved locally but absent from the pre-fetch snapshot — writing the merged
// snapshot back silently reverts that just-entered score / shot detail.
//
// jest.mock calls are hoisted above these imports by babel-jest, so the
// mocks are in place before ../syncWorker and its dependencies load.
import { drainTournament, drainLibrary } from '../syncWorker';
import { readLocal, saveLocal, _setSyncStatus } from '../tournamentStore';
import { upsertPlayer } from '../libraryStore';
import { syncQueue } from '../syncQueue';

let mockRemote = null;

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: mockRemote == null ? null : { data: mockRemote },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(),
  saveLocal: jest.fn(() => Promise.resolve()),
  pushRemote: jest.fn(() => Promise.resolve()),
  _setSyncStatus: jest.fn(),
  _appendConflicts: jest.fn(() => Promise.resolve()),
  _setLastSyncAt: jest.fn(() => Promise.resolve()),
}));

jest.mock('../syncQueue', () => ({
  syncQueue: {
    drop: jest.fn(() => Promise.resolve()),
    all: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../libraryStore', () => ({ upsertPlayer: jest.fn() }));

jest.mock('../../lib/connectivity', () => ({
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(),
}));

// One round, one player, hole 5 — a strokes value and a putts shot detail,
// each with a matching _meta timestamp so mergeTournaments can LWW them.
const blob = (strokes, strokesTs, putts, puttsTs) => ({
  id: 't1',
  rounds: [{
    id: 'r1',
    scores: { p1: { 5: strokes } },
    shotDetails: { p1: { 5: { putts } } },
  }],
  _meta: {
    'rounds.r1.scores.p1.h5': strokesTs,
    'rounds.r1.shotDetails.p1.h5': puttsTs,
  },
});

describe('drainTournament', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemote = null;
  });

  test('edits made while fetchRemote is in flight are not reverted', async () => {
    // Pre-fetch snapshot: hole 5 = 5 strokes, 1 putt.
    // During the fetch the user taps hole 5 to 6 strokes / 3 putts (saved
    // locally, newer timestamps). The server still holds the old values.
    readLocal
      .mockResolvedValueOnce(blob(5, 1000, 1, 1000))
      .mockResolvedValueOnce(blob(6, 2000, 3, 2000));
    mockRemote = blob(5, 1000, 1, 1000);

    await drainTournament('t1', [{ id: 'e1' }]);

    const saved = saveLocal.mock.calls[0][0];
    expect(saved.rounds[0].scores.p1[5]).toBe(6);
    expect(saved.rounds[0].shotDetails.p1[5].putts).toBe(3);
  });
});

describe('drainLibrary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('player.upsertLibrary mutation carries gender through to upsertPlayer', async () => {
    await drainLibrary([{
      id: 'e1',
      mutation: {
        type: 'player.upsertLibrary', playerId: 'p1', name: 'Ana', handicap: 20, gender: 'female',
      },
    }]);

    expect(upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', gender: 'female' }),
    );
  });
});

describe('syncNow', () => {
  it('returns a promise that resolves after the drain completes', async () => {
    const { syncNow } = require('../syncWorker');
    // With the queue mock empty, drainOnce sets status idle and resolves.
    await expect(syncNow()).resolves.toBeUndefined();
  });

  it('a second call while a drain is running returns the same in-flight promise', async () => {
    const { syncNow } = require('../syncWorker');
    const p1 = syncNow();
    const p2 = syncNow();
    expect(p2).toBe(p1);
    await p1;
  });
});

describe('syncSettled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemote = null;
  });

  it('resolves immediately when the queue is empty (single pass, no second drain)', async () => {
    const { syncSettled } = require('../syncWorker');
    syncQueue.all.mockResolvedValue([]);

    await syncSettled();

    // An empty queue never reaches the 'syncing' branch of drainOnce — it
    // short-circuits straight to 'idle'. Exactly one 'idle' call proves only
    // one drainOnce pass ran (syncNow's, from inside syncSettled); a second
    // pass would have produced a second 'idle' call.
    expect(_setSyncStatus.mock.calls.filter((c) => c[0] === 'idle').length).toBe(1);
    expect(_setSyncStatus.mock.calls.filter((c) => c[0] === 'syncing').length).toBe(0);
  });

  it('drains entries enqueued while a drain was in flight', async () => {
    const { syncSettled } = require('../syncWorker');

    // First drainOnce pass sees one entry; after it drops that entry the
    // queue is still reported non-empty once more (simulating an entry that
    // was enqueued mid-drain, after this pass's syncQueue.all() snapshot was
    // taken but before the pass finished). syncSettled's follow-up check
    // observes that leftover and triggers a second drainOnce pass.
    syncQueue.all
      .mockResolvedValueOnce([{ id: 'e1', tournamentId: 't1' }]) // drainOnce pass 1: initial snapshot
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // drainOnce pass 1: remaining check -> pending
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // syncSettled's own remaining check -> non-empty
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // drainOnce pass 2: initial snapshot
      .mockResolvedValueOnce([]); // drainOnce pass 2: remaining check -> idle

    readLocal.mockResolvedValue({
      id: 't1',
      rounds: [{ id: 'r1', scores: {}, shotDetails: {} }],
      _meta: {},
    });
    mockRemote = null;

    await syncSettled();

    const syncingCalls = _setSyncStatus.mock.calls.filter((c) => c[0] === 'syncing').length;
    expect(syncingCalls).toBe(2);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(syncQueue.drop).toHaveBeenCalledWith('e2');
  });
});
