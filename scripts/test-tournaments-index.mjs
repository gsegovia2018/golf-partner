import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournamentsIndex } from '../src/store/tournamentsIndex.js';

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    async getItem(k) { return k in store ? store[k] : null; },
    async setItem(k, v) { store[k] = v; },
    async removeItem(k) { delete store[k]; },
    async getAllKeys() { return Object.keys(store); },
    __store: store,
  };
}

test('readIndex returns [] on empty storage', async () => {
  const idx = createTournamentsIndex({ storage: makeStorage() });
  assert.deepEqual(await idx.readIndex(), []);
});

test('writeIndex + readIndex round-trip strips to shape', async () => {
  const idx = createTournamentsIndex({ storage: makeStorage() });
  await idx.writeIndex([
    { id: 'a', name: 'Tour A', createdAt: '2026-04-01', _role: 'owner', updatedAt: 123, extra: 'drop' },
    { id: 'b', name: 'Tour B', createdAt: '2026-04-02', _role: 'editor' },
  ]);
  const out = await idx.readIndex();
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'a', name: 'Tour A', createdAt: '2026-04-01', role: 'owner', updatedAt: 123 });
  assert.deepEqual(out[1], { id: 'b', name: 'Tour B', createdAt: '2026-04-02', role: 'editor', updatedAt: null });
});

test('readIndex tolerates corrupted JSON', async () => {
  const storage = makeStorage({ '@golf_tournaments_index': 'not-json' });
  const idx = createTournamentsIndex({ storage });
  assert.deepEqual(await idx.readIndex(), []);
});

test('getLocalBlobIds returns ids from @golf_tournament_<id> keys', async () => {
  const storage = makeStorage({
    '@golf_tournament_a': '{}',
    '@golf_tournament_b': '{}',
    '@golf_sync_queue': '[]',
    '@unrelated': 'x',
  });
  const idx = createTournamentsIndex({ storage });
  const ids = await idx.getLocalBlobIds();
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('missing name/createdAt fields become empty string / null', async () => {
  const idx = createTournamentsIndex({ storage: makeStorage() });
  await idx.writeIndex([{ id: 'x' }]);
  assert.deepEqual(await idx.readIndex(), [{
    id: 'x', name: '', createdAt: null, role: null, updatedAt: null,
  }]);
});
