import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_KEY = '@golf_sync_queue';

// Storage is injectable for tests. In production it is AsyncStorage, which
// implements the same getItem/setItem/removeItem surface.
export function createSyncQueue({ storage = AsyncStorage, key = QUEUE_KEY } = {}) {
  async function readAll() {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeAll(entries) {
    await storage.setItem(key, JSON.stringify(entries));
  }

  return {
    async enqueue(mutation) {
      const entry = { id: uuidv4(), ...mutation };
      const all = await readAll();
      all.push(entry);
      await writeAll(all);
      return entry;
    },
    async all() {
      return readAll();
    },
    async drop(id) {
      const all = await readAll();
      await writeAll(all.filter((e) => e.id !== id));
    },
    async clear() {
      await storage.removeItem(key);
    },
  };
}

// Singleton used by the app. Tests pass their own storage instead.
export const syncQueue = createSyncQueue();
