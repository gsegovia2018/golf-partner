jest.mock('../../store/mediaQueue', () => ({
  listQueue: jest.fn(),
  updateQueueEntry: jest.fn(() => Promise.resolve()),
  removeQueueEntry: jest.fn(() => Promise.resolve()),
}));

jest.mock('../mediaUpload', () => ({
  processUpload: jest.fn(),
}));

const { listQueue, updateQueueEntry, removeQueueEntry } = require('../../store/mediaQueue');
const { processUpload } = require('../mediaUpload');
const { kickUploadWorker } = require('../uploadWorker');

// Flush pending microtasks so mocked async chains inside drain() settle
// before assertions run.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('uploadWorker drain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A failed upload schedules a real retry via setTimeout(); fake it so a
    // leftover timer doesn't fire minutes later against a torn-down mock
    // queue and crash the test process after the suite has finished.
    // setImmediate stays real so the `flush()` helper still works.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('media attached during an in-flight drain is uploaded before the drain exits, not left pending forever', async () => {
    const entryA = { id: 'a', status: 'pending', attempts: 0 };
    const entryB = { id: 'b', status: 'pending', attempts: 0 };

    let resolveA;
    const aPromise = new Promise((resolve) => { resolveA = resolve; });

    listQueue
      .mockResolvedValueOnce([entryA]) // first pass, before B is attached
      .mockResolvedValueOnce([entryB]); // second pass, after B was attached mid-drain

    processUpload
      .mockImplementationOnce(() => aPromise)
      .mockImplementationOnce(() => Promise.resolve());

    const drainDone = kickUploadWorker();
    await flush();

    // Simulate a new photo being attached (and the worker kicked) WHILE the
    // first drain is still awaiting A's upload.
    kickUploadWorker();

    resolveA();
    await drainDone;

    expect(processUpload).toHaveBeenCalledTimes(2);
    expect(processUpload).toHaveBeenNthCalledWith(1, entryA);
    expect(processUpload).toHaveBeenNthCalledWith(2, entryB);
    expect(removeQueueEntry).toHaveBeenCalledWith('a');
    expect(removeQueueEntry).toHaveBeenCalledWith('b');
  });

  test('an entry with a future nextAttemptAt is skipped this pass; a due entry still uploads', async () => {
    const now = Date.now();
    const dueEntry = { id: 'due', status: 'pending', attempts: 1, nextAttemptAt: now - 1_000 };
    const futureEntry = { id: 'future', status: 'pending', attempts: 1, nextAttemptAt: now + 60_000 };

    listQueue.mockResolvedValueOnce([dueEntry, futureEntry]);
    processUpload.mockResolvedValue();

    await kickUploadWorker();

    expect(processUpload).toHaveBeenCalledTimes(1);
    expect(processUpload).toHaveBeenCalledWith(dueEntry);
    expect(removeQueueEntry).toHaveBeenCalledWith('due');
    expect(removeQueueEntry).not.toHaveBeenCalledWith('future');
  });

  test('a failed upload stores a per-entry nextAttemptAt backoff instead of retrying immediately on every event', async () => {
    const entry = { id: 'x', status: 'pending', attempts: 0 };
    listQueue.mockResolvedValueOnce([entry]);
    processUpload.mockRejectedValueOnce(new Error('network down'));

    const before = Date.now();
    await kickUploadWorker();

    const patchCall = updateQueueEntry.mock.calls.find(
      ([id, patch]) => id === 'x' && patch.status === 'pending' && 'nextAttemptAt' in patch,
    );
    expect(patchCall).toBeDefined();
    const [, patch] = patchCall;
    expect(patch.attempts).toBe(1);
    expect(patch.nextAttemptAt).toBeGreaterThan(before);
  });
});
