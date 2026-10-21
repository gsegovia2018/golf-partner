import { createTournamentsIndex } from '../tournamentsIndex';

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
    async getAllKeys() {
      return [...map.keys()];
    },
  };
}

// Fix C (docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md §6):
// the index used to drop players entirely, so an index-only row (never
// opened on this device) rendered with a blank Home list card offline.
// summarize() now carries enough to reconstruct names — see
// tournamentStore.js's _loadCachedFullList for the consumer.
describe('tournamentsIndex summarize', () => {
  test('writeIndex/readIndex carries playerNames (nameless entries filtered) and playerCount', async () => {
    const index = createTournamentsIndex({ storage: memoryStorage(), key: 'idx1' });
    await index.writeIndex([{
      id: 't1',
      name: 'Cup',
      kind: 'casual',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      _role: 'owner',
      players: [{ id: 'p1', name: 'Marcos' }, { id: 'p2', name: null }, { id: 'p3', name: 'Guille' }],
    }]);

    const [row] = await index.readIndex();
    expect(row.playerNames).toEqual(['Marcos', 'Guille']);
    expect(row.playerCount).toBe(3);
  });

  test('a tournament with no players summarizes to an empty playerNames and zero count', async () => {
    const index = createTournamentsIndex({ storage: memoryStorage(), key: 'idx2' });
    await index.writeIndex([{ id: 't1', name: 'Cup' }]);

    const [row] = await index.readIndex();
    expect(row.playerNames).toEqual([]);
    expect(row.playerCount).toBe(0);
  });

  test('carries playerIds and de-duplicated courseIds for the pickers recent-use sort', async () => {
    const index = createTournamentsIndex({ storage: memoryStorage(), key: 'idx3' });
    await index.writeIndex([{
      id: 't1',
      players: [{ id: 'p1', name: 'Marcos' }, { name: 'stub' }],
      rounds: [{ courseId: 'c1' }, { courseId: 'c1' }, { courseId: 'c2' }, {}],
    }]);

    const [row] = await index.readIndex();
    expect(row.playerIds).toEqual(['p1']);
    expect(row.courseIds).toEqual(['c1', 'c2']);
  });
});
