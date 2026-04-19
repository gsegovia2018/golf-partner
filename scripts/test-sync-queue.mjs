import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncQueue } from '../src/store/syncQueue.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: async (k) => m.has(k) ? m.get(k) : null,
    setItem: async (k, v) => { m.set(k, v); },
    removeItem: async (k) => { m.delete(k); },
    _map: m,
  };
}

test('enqueue appends; all() returns FIFO order', async () => {
  const q = createSyncQueue({ storage: memoryStorage() });
  await q.enqueue({ type: 'score.set', value: 1 });
  await q.enqueue({ type: 'score.set', value: 2 });
  const all = await q.all();
  assert.equal(all.length, 2);
  assert.equal(all[0].value, 1);
  assert.equal(all[1].value, 2);
  assert.ok(all[0].id && all[1].id, 'entries get ids');
});

test('drop removes by id', async () => {
  const q = createSyncQueue({ storage: memoryStorage() });
  const a = await q.enqueue({ type: 'x' });
  const b = await q.enqueue({ type: 'y' });
  await q.drop(a.id);
  const all = await q.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, b.id);
});

test('queue survives a reload via the same storage', async () => {
  const storage = memoryStorage();
  const q1 = createSyncQueue({ storage });
  await q1.enqueue({ type: 'x', value: 42 });
  const q2 = createSyncQueue({ storage });
  const all = await q2.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].value, 42);
});
