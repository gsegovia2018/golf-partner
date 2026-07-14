// jest.mock calls are hoisted above these imports by babel-jest, so the
// mocks are in place before ../syncWorker and its dependencies load.
import {
  drainTournament, drainLibrary, syncNow, syncSettled,
  isPermanentSyncError,
} from '../syncWorker';
import { readLocal, saveLocal, _setSyncStatus } from '../tournamentStore';
import { executeMutation } from '../mutationWrites';
import { applyPendingMutations } from '../mutate';
import { fetchTournament } from '../tournamentRepo';
import { upsertPlayer } from '../libraryStore';
import { syncQueue } from '../syncQueue';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn(() => Promise.resolve({ error: null })) },
}));

jest.mock('../mutationWrites', () => ({ executeMutation: jest.fn() }));

jest.mock('../mutate', () => ({
  applyPendingMutations: jest.fn((t) => t),
  preserveLocalConflictState: jest.fn((target) => target),
}));

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
    incrementAttempts: jest.fn(() => Promise.resolve(1)),
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
    readLocal.mockResolvedValue(localBlob);
    executeMutation.mockResolvedValue({ conflict: null });
    fetchTournament.mockResolvedValue(null);
    syncQueue.all.mockResolvedValue([]);
    // Re-pin the pass-through implementation: jest.clearAllMocks() does NOT
    // undo a mockReturnValue/mockImplementation set inside a test body, so
    // without this a per-test override would leak into later tests.
    applyPendingMutations.mockImplementation((t) => t);
    syncQueue.incrementAttempts.mockImplementation(() => Promise.resolve(1));
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
    // Permanent drops must be visible on the sync indicator, not just a
    // console.warn nobody sees.
    expect(_setSyncStatus).toHaveBeenCalledWith('error');
  });

  test('a recoverable coded error (expired session) is NOT dropped — it stays queued and stops the drain', async () => {
    // This is the "Finish tournament" bug: PGRST301 (JWT expired) carries a
    // `.code`, but it is a transient auth hiccup, not a poison mutation. It
    // must behave like the no-code transient path — entry stays queued,
    // draining this tournament stops, nothing is silently lost.
    const authError = Object.assign(new Error('JWT expired'), { code: 'PGRST301' });
    executeMutation.mockRejectedValueOnce(authError);
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'tournament.setFinished', finishedAt: 123 } };
    const e2 = { id: 'e2', tournamentId: 't1', mutation: { type: 'score.set' } };

    await expect(drainTournament('t1', [e1, e2])).rejects.toThrow('JWT expired');

    expect(syncQueue.drop).not.toHaveBeenCalled();
    expect(executeMutation).toHaveBeenCalledTimes(1); // e2 never attempted
    expect(fetchTournament).not.toHaveBeenCalled(); // reconcile skipped
    // Never falsely report all-clear while a mutation is still stuck.
    expect(_setSyncStatus).not.toHaveBeenCalledWith('idle');

    // A later drain (session refreshed) succeeds and lands it.
    executeMutation.mockResolvedValueOnce({ conflict: null });
    await drainTournament('t1', [e1]);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
  });

  test('the finish-tournament scenario: setFinished hits a transient PGRST301 once, then succeeds and is not lost', async () => {
    const authError = Object.assign(new Error('JWT expired'), { code: 'PGRST301' });
    executeMutation.mockRejectedValueOnce(authError).mockResolvedValueOnce({ conflict: null });
    const e1 = {
      id: 'e1', tournamentId: 't1', mutation: { type: 'tournament.setFinished', finishedAt: 123 },
    };

    await expect(drainTournament('t1', [e1])).rejects.toThrow('JWT expired');
    expect(syncQueue.drop).not.toHaveBeenCalled();

    // Next drain pass reaches executeMutation (→ repo.patchTournament →
    // patch_game_tournament in the real stack) again and this time lands.
    await drainTournament('t1', [e1]);
    expect(executeMutation).toHaveBeenCalledTimes(2);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
  });

  test('poison guard: a recoverable coded error that keeps failing past the retry cap is eventually dropped and surfaced', async () => {
    const authError = Object.assign(new Error('JWT expired'), { code: 'PGRST301' });
    executeMutation.mockRejectedValue(authError);
    let attempts = 0;
    syncQueue.incrementAttempts.mockImplementation(() => Promise.resolve(++attempts));
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'tournament.setFinished' } };

    for (let i = 0; i < 7; i++) {
      await expect(drainTournament('t1', [e1])).rejects.toThrow('JWT expired');
    }
    expect(syncQueue.drop).not.toHaveBeenCalled();

    // 8th failure crosses the cap — dropped, but surfaced, not silent.
    await drainTournament('t1', [e1]);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(_setSyncStatus).toHaveBeenCalledWith('error');
  });

  test('executeMutation always resolving { conflict: null } never blocks the drop (conflict state is derived, not raised, here)', async () => {
    executeMutation.mockResolvedValueOnce({ conflict: null });
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };

    await drainTournament('t1', [e1]);

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
    // Stable queue (same entries on the post-save re-check) → exactly one save.
    expect(saveLocal).toHaveBeenCalledTimes(1);
  });

  test('a mutation enqueued between the reconcile snapshot and its saveLocal is overlaid by a follow-up save', async () => {
    // The "scores erased as entered" race: mutate() runs saveLocal BEFORE
    // syncQueue.enqueue, so a score entered while reconcile is snapshotting
    // has already landed in local state but is missing from the queue
    // snapshot — an overlay computed from that snapshot, saved over local,
    // erases the just-entered value. The drain must detect the queue change
    // after saving and re-save with the late entry overlaid.
    const fresh = { id: 't1', rounds: [] };
    fetchTournament.mockResolvedValue(fresh);
    applyPendingMutations.mockImplementation((t, queued) => ({
      ...t, _applied: queued.map((e) => e.id),
    }));
    const late = { id: 'late', tournamentId: 't1', mutation: { type: 'score.set' } };
    syncQueue.all
      .mockResolvedValueOnce([]) // reconcile snapshot: late's enqueue hasn't landed yet
      .mockResolvedValue([late]); // every later check: it has

    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    await drainTournament('t1', [e1]);

    // First save overlaid [] (would have erased the late score); the post-
    // save re-check saw the queue change and saved again with it applied.
    const lastSave = saveLocal.mock.calls[saveLocal.mock.calls.length - 1][0];
    expect(lastSave._applied).toEqual(['late']);
    expect(applyPendingMutations).toHaveBeenLastCalledWith(fresh, [late]);
  });

  test('the reconcile re-save loop is bounded: a queue that never stabilizes stops after 3 saves', async () => {
    const fresh = { id: 't1', rounds: [] };
    fetchTournament.mockResolvedValue(fresh);
    applyPendingMutations.mockImplementation((t, queued) => ({
      ...t, _applied: queued.map((e) => e.id),
    }));
    // Every queue read returns a different (growing) entry set, so the
    // stability check never passes — the loop must give up after 3 saves
    // rather than spin (the still-queued mutations drain on the next pass).
    let reads = 0;
    syncQueue.all.mockImplementation(() => {
      reads += 1;
      return Promise.resolve(
        Array.from({ length: reads }, (_, i) => ({ id: `q${i}`, tournamentId: 't1' })),
      );
    });

    await drainTournament('t1', [{ id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } }]);

    expect(saveLocal).toHaveBeenCalledTimes(3);
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

describe('isPermanentSyncError', () => {
  test.each([
    ['PGRST301', false], // JWT expired / auth — recoverable
    ['401', false],
    ['403', false],
    ['429', false], // rate limit — recoverable
    ['500', false],
    ['503', false],
    ['08006', false], // SQLSTATE connection-exception class — recoverable
    ['08003', false],
    ['UNKNOWN_WEIRD_CODE', false], // any unrecognized code — recoverable
    ['23505', true], // SQLSTATE integrity constraint (unique violation)
    ['22P02', true], // SQLSTATE data exception (invalid text representation)
    ['42501', true], // SQLSTATE syntax/insufficient-privilege
    ['PGRST116', true], // PostgREST "no rows"
    ['P0001', true], // PL/pgSQL RAISE EXCEPTION default (business rule, e.g. 'party locked')
    ['P0002', true], // no_data_found
    ['P0003', true], // too_many_rows
    ['P0004', true], // assert_failure
  ])('error.code %s -> permanent = %s', (code, expected) => {
    expect(isPermanentSyncError({ code, message: 'x' })).toBe(expected);
  });

  test('no error.code (network/transport failure) is recoverable, not permanent', () => {
    expect(isPermanentSyncError(new Error('network down'))).toBe(false);
  });

  test('the "unknown mutation type" throw from executeMutation is permanent (genuinely un-processable)', () => {
    expect(isPermanentSyncError(new Error('unknown mutation type: bogus.op'))).toBe(true);
  });

  test('a nullish error is not permanent', () => {
    expect(isPermanentSyncError(null)).toBe(false);
    expect(isPermanentSyncError(undefined)).toBe(false);
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

  test('rpc.call: a recoverable coded error (e.g. 429 rate limit) is rethrown so the entry retries, not dropped', async () => {
    // Supabase errors are plain objects, not Error instances, so assert via
    // the rejected value's shape rather than jest's toThrow (which expects
    // an Error-like prototype).
    supabase.rpc.mockResolvedValueOnce({ error: { code: '429', message: 'rate limited' } });
    const e1 = { id: 'e1', mutation: { type: 'rpc.call', fn: 'do_thing', args: {} } };

    await expect(drainLibrary([e1])).rejects.toMatchObject({ code: '429', message: 'rate limited' });
    expect(syncQueue.drop).not.toHaveBeenCalled();
  });

  test('rpc.call: a permanent coded error (e.g. unique violation) is dropped as before', async () => {
    supabase.rpc.mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } });
    const e1 = { id: 'e1', mutation: { type: 'rpc.call', fn: 'do_thing', args: {} } };

    await drainLibrary([e1]);

    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
  });

  test('rpc.call: a P0001 business-rule raise (e.g. "party locked" from submit_score) is dropped + surfaced, never retried', async () => {
    // submit_score RAISE EXCEPTION 'party locked' surfaces as code P0001.
    // It is permanent — retrying can never succeed. It must drop
    // immediately (not sit queued forever wedging the pipeline) and flip
    // the sync indicator so the failure is visible.
    supabase.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'party locked' } });
    const e1 = { id: 'e1', mutation: { type: 'rpc.call', fn: 'submit_score', args: {} } };

    await drainLibrary([e1]);

    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(_setSyncStatus).toHaveBeenCalledWith('error');
  });

  test('rpc.call: a recoverable coded error that keeps failing past the retry cap is eventually dropped + surfaced (no infinite retry)', async () => {
    // drainLibrary must have the same poison guard as drainTournament — a
    // recoverable error that never actually recovers can't be allowed to
    // retry forever (that is what wedged the whole pipeline).
    supabase.rpc.mockResolvedValue({ error: { code: 'PGRST301', message: 'JWT expired' } });
    let attempts = 0;
    syncQueue.incrementAttempts.mockImplementation(() => Promise.resolve(++attempts));
    const e1 = { id: 'e1', mutation: { type: 'rpc.call', fn: 'submit_score', args: {} } };

    for (let i = 0; i < 7; i++) {
      await expect(drainLibrary([e1])).rejects.toMatchObject({ code: 'PGRST301' });
    }
    expect(syncQueue.drop).not.toHaveBeenCalled();

    // 8th failure crosses the cap — dropped and surfaced, not silent, not
    // thrown (so drainOnce continues).
    await drainLibrary([e1]);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(_setSyncStatus).toHaveBeenCalledWith('error');
  });
});

describe('drainOnce isolation (via syncNow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readLocal.mockResolvedValue(localBlob);
    executeMutation.mockResolvedValue({ conflict: null });
    fetchTournament.mockResolvedValue(null);
    applyPendingMutations.mockImplementation((t) => t);
    syncQueue.incrementAttempts.mockImplementation(() => Promise.resolve(1));
  });

  it('a throwing drainLibrary (recoverable, under cap) does NOT prevent the tournament loop from draining', async () => {
    // The wedge: a stuck official-score rpc.call must not block casual
    // tournament score/finish sync. drainLibrary throws (recoverable, under
    // cap) but drainOnce isolates it, so the tournament entry still drains.
    const libEntry = { id: 'lib1', mutation: { type: 'rpc.call', fn: 'submit_score', args: {} } };
    const tournEntry = { id: 't-e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    supabase.rpc.mockResolvedValue({ error: { code: 'PGRST301', message: 'JWT expired' } });
    syncQueue.all.mockResolvedValue([libEntry, tournEntry]);

    await syncNow();

    // The tournament drain ran despite the library mutation throwing.
    expect(executeMutation).toHaveBeenCalledWith(tournEntry, localBlob);
    expect(syncQueue.drop).toHaveBeenCalledWith('t-e1');
  });

  it('a throwing drainTournament for one tournament does NOT starve sibling tournaments', async () => {
    // Head-of-line blocking: byTournament preserves insertion order (tA
    // before tB). Before the fix, an unwrapped `await drainTournament(...)`
    // in the loop meant tA's recoverable throw aborted the whole for-loop —
    // tB (and every tournament after it) never got a chance to drain until
    // tA's entry either recovered or crossed the poison cap (up to
    // RECOVERABLE_ATTEMPT_CAP cycles later). Each tournament's drain must be
    // isolated, like the library drain immediately above it.
    jest.useFakeTimers(); // syncNow's backoff .catch() schedules a retry timer
    const aEntry = { id: 'a-e1', tournamentId: 'tA', mutation: { type: 'score.set' } };
    const bEntry = { id: 'b-e1', tournamentId: 'tB', mutation: { type: 'score.set' } };
    syncQueue.all.mockResolvedValue([aEntry, bEntry]);
    executeMutation.mockImplementation((entry) => (
      entry.tournamentId === 'tA'
        ? Promise.reject(new Error('network down'))
        : Promise.resolve({ conflict: null })
    ));

    await syncNow();

    // tA's entry stays queued (recoverable, under cap) — never dropped.
    expect(syncQueue.drop).not.toHaveBeenCalledWith('a-e1');
    // tB drained successfully despite tA's failure preceding it in the loop.
    expect(executeMutation).toHaveBeenCalledWith(bEntry, localBlob);
    expect(syncQueue.drop).toHaveBeenCalledWith('b-e1');
    // The failure is still surfaced so backoff/retry indicators trigger.
    expect(_setSyncStatus).toHaveBeenCalledWith('error');

    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('a recoverable tournament failure still triggers syncNow backoff (schedules a retry timer)', async () => {
    // Isolation must not swallow the failure outright: drainOnce catches each
    // tournament's throw so siblings drain, but must rethrow afterward so
    // drainOnce() rejects → syncNow's .catch() bumps _attempt and schedules a
    // backoff retry for the still-queued entry. Asserting ONLY that
    // _setSyncStatus('error') fired would miss this — the entry would sit
    // queued with no scheduled retry.
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const aEntry = { id: 'a-e1', tournamentId: 'tA', mutation: { type: 'score.set' } };
    syncQueue.all.mockResolvedValue([aEntry]);
    executeMutation.mockRejectedValue(new Error('network down'));

    await syncNow();

    // A backoff retry timer was scheduled — its delay is one of the known
    // BACKOFF_MS steps (which step depends on the module-level _attempt
    // counter carried across tests, so assert membership, not an exact ms).
    const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
    expect(setTimeoutSpy).toHaveBeenCalled();
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    expect(delays.some((d) => BACKOFF_MS.includes(d))).toBe(true);
    // The failing entry stays queued — never dropped by isolation.
    expect(syncQueue.drop).not.toHaveBeenCalledWith('a-e1');

    setTimeoutSpy.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
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
    applyPendingMutations.mockImplementation((t) => t);
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
    // First drainOnce pass sees one entry (e1); an entry e2 lands mid-drain
    // (after pass 1's initial snapshot). Pass 1's reconcile overlays e2, its
    // remaining check reports 'pending', and syncSettled's follow-up check
    // observes the leftover and triggers a second drainOnce pass, which
    // drains e2 and settles to 'idle'. fetchTournament returns a row so the
    // reconcile path (2 syncQueue.all reads per pass: snapshot + post-save
    // stability re-check) actually executes.
    fetchTournament.mockResolvedValue({ id: 't1', rounds: [] });
    const e1 = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    const e2 = { id: 'e2', tournamentId: 't1', mutation: { type: 'score.set' } };
    syncQueue.all
      .mockResolvedValueOnce([e1]) // drainOnce pass 1: initial snapshot
      .mockResolvedValueOnce([e2]) // pass 1 reconcile: overlay snapshot (e2 landed mid-drain)
      .mockResolvedValueOnce([e2]) // pass 1 reconcile: stability re-check -> unchanged, stop
      .mockResolvedValueOnce([e2]) // drainOnce pass 1: remaining check -> 'pending'
      .mockResolvedValueOnce([e2]) // syncSettled's own remaining check -> non-empty, second pass
      .mockResolvedValueOnce([e2]) // drainOnce pass 2: initial snapshot
      .mockResolvedValueOnce([]) // pass 2 reconcile: overlay snapshot (queue drained)
      .mockResolvedValueOnce([]) // pass 2 reconcile: stability re-check -> unchanged, stop
      .mockResolvedValueOnce([]); // drainOnce pass 2: remaining check -> 'idle'

    await syncSettled();

    const syncingCalls = _setSyncStatus.mock.calls.filter((c) => c[0] === 'syncing').length;
    expect(syncingCalls).toBe(2);
    expect(syncQueue.drop).toHaveBeenCalledWith('e1');
    expect(syncQueue.drop).toHaveBeenCalledWith('e2');
    expect(fetchTournament).toHaveBeenCalledTimes(2); // one reconcile per pass
    // The settled state is 'idle' — pass 2's remaining check found an empty queue.
    const statusCalls = _setSyncStatus.mock.calls;
    expect(statusCalls[statusCalls.length - 1][0]).toBe('idle');
  });
});
