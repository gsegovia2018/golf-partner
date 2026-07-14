import { createSyncQueue } from '../syncQueue';

function memoryStorage() {
  const map = new Map();
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

describe('syncQueue ts stamping', () => {
  test('enqueue stamps ts: Date.now() on the entry when not already present', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q1' });
    const before = Date.now();
    const entry = await queue.enqueue({
      tournamentId: 't1',
      mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 4 },
      path: 'rounds.r1.scores.p1.h1',
    });
    const after = Date.now();

    expect(typeof entry.ts).toBe('number');
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(entry.ts).toBeLessThanOrEqual(after);

    const all = await queue.all();
    expect(all[0].ts).toBe(entry.ts);
  });

  test('enqueue preserves an already-present ts instead of overwriting it', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q2' });
    const entry = await queue.enqueue({
      tournamentId: 't1',
      mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 4 },
      path: 'rounds.r1.scores.p1.h1',
      ts: 12345,
    });

    expect(entry.ts).toBe(12345);
  });

  test('still assigns an id and preserves existing entry shape', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q3' });
    const entry = await queue.enqueue({
      tournamentId: 't1',
      mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 4 },
      path: 'rounds.r1.scores.p1.h1',
    });

    expect(typeof entry.id).toBe('string');
    expect(entry.tournamentId).toBe('t1');
    expect(entry.path).toBe('rounds.r1.scores.p1.h1');
    expect(entry.mutation).toEqual({ type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 4 });
  });
});

describe('syncQueue attempts tracking', () => {
  test('enqueue stamps attempts: 0 when not already present', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q4' });
    const entry = await queue.enqueue({
      tournamentId: 't1',
      mutation: { type: 'score.set' },
    });

    expect(entry.attempts).toBe(0);
  });

  test('incrementAttempts bumps and persists the count for one entry, leaving others untouched', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q5' });
    const e1 = await queue.enqueue({ tournamentId: 't1', mutation: { type: 'score.set' } });
    const e2 = await queue.enqueue({ tournamentId: 't1', mutation: { type: 'shot.set' } });

    const first = await queue.incrementAttempts(e1.id);
    const second = await queue.incrementAttempts(e1.id);

    expect(first).toBe(1);
    expect(second).toBe(2);

    const all = await queue.all();
    expect(all.find((e) => e.id === e1.id).attempts).toBe(2);
    expect(all.find((e) => e.id === e2.id).attempts).toBe(0);
  });

  test('incrementAttempts on an unknown id is a no-op that returns 0', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q6' });
    await queue.enqueue({ tournamentId: 't1', mutation: { type: 'score.set' } });

    const result = await queue.incrementAttempts('does-not-exist');

    expect(result).toBe(0);
  });
});

describe('syncQueue concurrency (mutex serialization)', () => {
  test('two concurrent enqueue calls both persist — neither writeAll clobbers the other', async () => {
    // Without a mutex, both calls read the same (empty) array before either
    // writes: enqueue A reads [], pushes A, writes [A]; enqueue B ALSO reads
    // [] (racing A's read), pushes B, writes [B] — clobbering A's write. The
    // queue must serialize these read-modify-write ops so both survive.
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q7' });

    const [a, b] = await Promise.all([
      queue.enqueue({ tournamentId: 't1', mutation: { type: 'score.set', hole: 1 } }),
      queue.enqueue({ tournamentId: 't1', mutation: { type: 'score.set', hole: 2 } }),
    ]);

    const all = await queue.all();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  test('many concurrent enqueue calls all persist (stress the mutex ordering)', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q8' });

    const entries = await Promise.all(
      Array.from({ length: 20 }, (_, i) => queue.enqueue({
        tournamentId: 't1',
        mutation: { type: 'score.set', hole: i },
      })),
    );

    const all = await queue.all();
    expect(all).toHaveLength(20);
    expect(new Set(all.map((e) => e.id)).size).toBe(20);
    expect(entries.map((e) => e.id).sort()).toEqual(all.map((e) => e.id).sort());
  });

  test('a concurrent drop and enqueue do not clobber each other', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q9' });
    const e1 = await queue.enqueue({ tournamentId: 't1', mutation: { type: 'score.set' } });

    const [, e2] = await Promise.all([
      queue.drop(e1.id),
      queue.enqueue({ tournamentId: 't1', mutation: { type: 'shot.set' } }),
    ]);

    const all = await queue.all();
    expect(all.map((e) => e.id)).toEqual([e2.id]);
  });

  test('concurrent incrementAttempts calls on different entries both land', async () => {
    const queue = createSyncQueue({ storage: memoryStorage(), key: 'q10' });
    const e1 = await queue.enqueue({ tournamentId: 't1', mutation: { type: 'score.set' } });
    const e2 = await queue.enqueue({ tournamentId: 't1', mutation: { type: 'shot.set' } });

    await Promise.all([
      queue.incrementAttempts(e1.id),
      queue.incrementAttempts(e2.id),
    ]);

    const all = await queue.all();
    expect(all.find((e) => e.id === e1.id).attempts).toBe(1);
    expect(all.find((e) => e.id === e2.id).attempts).toBe(1);
  });
});
