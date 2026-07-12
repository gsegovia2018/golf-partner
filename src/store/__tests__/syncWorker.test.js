// jest.mock calls are hoisted above these imports by babel-jest, so the
// mocks are in place before ../syncWorker and its dependencies load.
import {
  drainTournament, drainLibrary, setScoreConflictHandler, syncNow, syncSettled,
} from '../syncWorker';
import { readLocal, saveLocal, _setSyncStatus } from '../tournamentStore';
import { executeMutation } from '../mutationWrites';
import { applyPendingMutations } from '../mutate';
import { fetchTournament } from '../tournamentRepo';
import { upsertPlayer } from '../libraryStore';
import { syncQueue } from '../syncQueue';

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn(() => Promise.resolve({ error: null })) },
}));

jest.mock('../mutationWrites', () => ({ executeMutation: jest.fn() }));

jest.mock('../mutate', () => ({ applyPendingMutations: jest.fn((t) => t) }));

jest.mock('../tournamentRepo', () => ({ fetchTournament: jest.fn(() => Promise.resolve(null)) }));

jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(),
  saveLocal: jest.fn(() => Promise.resolve()),
  _setSyncStatus: jest.fn(),
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

const localBlob = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };

describe('drainTournament', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setScoreConflictHandler(null);
    readLocal.mockResolvedValue(localBlob);
    executeMutation.mockResolvedValue({ conflict: null });
    fetchTournament.mockResolvedValue(null);
    syncQueue.all.mockResolvedValue([]);
  });

  test('executes queued mutations via executeMutation in order, dropping each on success', async () => {
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 4 } };
    const e2 = { id: 'e2', tournamentId: 't1', mutation: { type: 'shot.set', roundId: 'r1', playerId: 'p1', hole: 1, detail: { putts: 2 } } };

    await drainTournament('t1', [e1, e2]);

    expect(executeMutation).toHaveBeenNthCalledWith(1, e1, localBlob);
    expect(executeMutation).toHaveBeenNthCalledWith(2, e2, localBlob);
    expect(syncQueue.drop).toHaveBeenNthCalledWith(1, 'e1');
    expect(syncQueue.drop).toHaveBeenNthCalledWith(2, 'e2');
  });

  test('re-reads local before each entry so a later entry sees an earlier one\'s local effects', async () => {
    const blobAfterE1 = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 1: 4 } } }] };
    readLocal.mockResolvedValueOnce(localBlob).mockResolvedValueOnce(blobAfterE1);
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    const e2 = { id: 'e2', tournamentId: 't1', mutation: { type: 'shot.set' } };

    await drainTournament('t1', [e1, e2]);

    expect(readLocal).toHaveBeenCalledTimes(2);
    expect(executeMutation).toHaveBeenNthCalledWith(1, e1, localBlob);
    expect(executeMutation).toHaveBeenNthCalledWith(2, e2, blobAfterE1);
  });

  test('a transient error (no error.code) keeps the entry queued and stops draining this tournament', async () => {
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    const e2 = { id: 'e2', tournamentId: 't1', mutation: { type: 'shot.set' } };
    executeMutation.mockRejectedValueOnce(new Error('network down'));

    await expect(drainTournament('t1', [e1, e2])).rejects.toThrow('network down');

    expect(syncQueue.drop).not.toHaveBeenCalled();
    expect(executeMutation).toHaveBeenCalledTimes(1); // e2 never attempted
    expect(fetchTournament).not.toHaveBeenCalled(); // reconcile skipped
  });

  test('a terminal error (error.code present) drops that entry and continues with the rest', async () => {
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    const e2 = { id: 'e2', tournamentId: 't1', mutation: { type: 'shot.set' } };
    const terminal = Object.assign(new Error('constraint violated'), { code: '23505' });
    executeMutation.mockRejectedValueOnce(terminal).mockResolvedValueOnce({ conflict: null });

    await drainTournament('t1', [e1, e2]);

    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(syncQueue.drop).toHaveBeenCalledWith('e2');
    expect(executeMutation).toHaveBeenCalledTimes(2);
  });

  test('a returned conflict is forwarded to the registered conflict handler', async () => {
    const handler = jest.fn(() => Promise.resolve());
    setScoreConflictHandler(handler);
    const conflict = {
      roundId: 'r1', playerId: 'p1', hole: 5, mine: 6, theirs: 5,
    };
    executeMutation.mockResolvedValueOnce({ conflict });
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };

    await drainTournament('t1', [e1]);

    expect(handler).toHaveBeenCalledWith('t1', conflict);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1'); // still dropped
  });

  test('a conflict handler that throws does not abort the drain', async () => {
    setScoreConflictHandler(() => { throw new Error('marker write failed'); });
    executeMutation.mockResolvedValueOnce({
      conflict: {
        roundId: 'r1', playerId: 'p1', hole: 5, mine: 6, theirs: 5,
      },
    });
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };

    await expect(drainTournament('t1', [e1])).resolves.toBeUndefined();
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
  });

  test('with no conflict handler registered, a conflict is silently ignored', async () => {
    executeMutation.mockResolvedValueOnce({
      conflict: {
        roundId: 'r1', playerId: 'p1', hole: 5, mine: 6, theirs: 5,
      },
    });
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };

    await expect(drainTournament('t1', [e1])).resolves.toBeUndefined();
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
  });

  test('after every entry drains, fetches the tournament once and overlays still-queued mutations', async () => {
    const fresh = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 1: 4 } } }] };
    const leftover = { id: 'e2', tournamentId: 't1', mutation: { type: 'shot.set' } };
    const otherTournament = { id: 'e9', tournamentId: 't2', mutation: { type: 'score.set' } };
    fetchTournament.mockResolvedValue(fresh);
    syncQueue.all.mockResolvedValue([leftover, otherTournament]);
    const reconciled = { ...fresh, _reconciled: true };
    applyPendingMutations.mockReturnValue(reconciled);

    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    await drainTournament('t1', [e1]);

    expect(fetchTournament).toHaveBeenCalledTimes(1);
    expect(fetchTournament).toHaveBeenCalledWith('t1');
    expect(applyPendingMutations).toHaveBeenCalledWith(fresh, [leftover]);
    expect(saveLocal).toHaveBeenCalledWith(reconciled);
  });

  test('skips the reconcile write entirely when fetchTournament resolves null', async () => {
    fetchTournament.mockResolvedValue(null);
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };

    await drainTournament('t1', [e1]);

    expect(applyPendingMutations).not.toHaveBeenCalled();
    expect(saveLocal).not.toHaveBeenCalled();
  });

  test('a reconcile fetch failure is swallowed rather than thrown', async () => {
    fetchTournament.mockRejectedValue(new Error('offline'));
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };

    await expect(drainTournament('t1', [e1])).resolves.toBeUndefined();
    expect(saveLocal).not.toHaveBeenCalled();
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
  beforeEach(() => {
    jest.clearAllMocks();
    syncQueue.all.mockResolvedValue([]);
  });

  it('returns a promise that resolves after the drain completes', async () => {
    // With the queue mock empty, drainOnce sets status idle and resolves.
    await expect(syncNow()).resolves.toBeUndefined();
  });

  it('a second call while a drain is running returns the same in-flight promise', async () => {
    const p1 = syncNow();
    const p2 = syncNow();
    expect(p2).toBe(p1);
    await p1;
  });
});

describe('syncSettled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readLocal.mockResolvedValue(localBlob);
    executeMutation.mockResolvedValue({ conflict: null });
    fetchTournament.mockResolvedValue(null);
  });

  it('resolves immediately when the queue is empty (single pass, no second drain)', async () => {
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
    // First drainOnce pass sees one entry; after it drops that entry the
    // queue is still reported non-empty once more (simulating an entry that
    // was enqueued mid-drain, after this pass's syncQueue.all() snapshot was
    // taken but before the pass finished). syncSettled's follow-up check
    // observes that leftover and triggers a second drainOnce pass.
    syncQueue.all
      .mockResolvedValueOnce([{ id: 'e1', tournamentId: 't1' }]) // drainOnce pass 1: initial snapshot
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // drainTournament pass 1: reconcile stillQueued
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // drainOnce pass 1: remaining check -> pending
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // syncSettled's own remaining check -> non-empty
      .mockResolvedValueOnce([{ id: 'e2', tournamentId: 't1' }]) // drainOnce pass 2: initial snapshot
      .mockResolvedValueOnce([]) // drainTournament pass 2: reconcile stillQueued
      .mockResolvedValueOnce([]); // drainOnce pass 2: remaining check -> idle

    await syncSettled();

    const syncingCalls = _setSyncStatus.mock.calls.filter((c) => c[0] === 'syncing').length;
    expect(syncingCalls).toBe(2);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(syncQueue.drop).toHaveBeenCalledWith('e2');
  });
});
