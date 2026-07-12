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
      // Stamp ts (queue-entry enqueue time, distinct from mutation.ts) when
      // not already present, so later consumers (e.g. replaying a single
      // tournament's pending entries) can order/inspect entries without
      // reaching into the nested mutation payload. attempts starts at 0 —
      // it's bumped by incrementAttempts each time a drain fails to land
      // this entry with a recoverable error, so the worker can tell a
      // one-off blip from a poison entry that never recovers.
      const entry = {
        id: uuidv4(), ...mutation, ts: mutation.ts ?? Date.now(), attempts: mutation.attempts ?? 0,
      };
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
    // Persists a bumped attempts count for one entry and returns the new
    // count. Used by the sync worker to cap retries of a RECOVERABLE coded
    // error (see syncWorker.js's isPermanentSyncError) so a mutation that
    // never actually recovers doesn't sit in the queue forever.
    async incrementAttempts(id) {
      const all = await readAll();
      let attempts = 0;
      const updated = all.map((e) => {
        if (e.id !== id) return e;
        attempts = (e.attempts ?? 0) + 1;
        return { ...e, attempts };
      });
      await writeAll(updated);
      return attempts;
    },
    async clear() {
      await storage.removeItem(key);
    },
  };
}

// Singleton used by the app. Tests pass their own storage instead.
export const syncQueue = createSyncQueue();
