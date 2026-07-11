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
