import AsyncStorage from '@react-native-async-storage/async-storage';

const INDEX_KEY = '@golf_tournaments_index';
const BLOB_PREFIX = '@golf_tournament_';

// Storage is injectable for tests. In production it's AsyncStorage.
// getAllKeys is used by getLocalBlobIds; AsyncStorage exposes it natively.
export function createTournamentsIndex({ storage = AsyncStorage, key = INDEX_KEY } = {}) {
  function summarize(t) {
    return {
      id: t?.id,
      name: t?.name ?? '',
      createdAt: t?.createdAt ?? null,
      role: t?._role ?? null,
      updatedAt: t?.updatedAt ?? null,
    };
  }

  return {
    async readIndex() {
      const raw = await storage.getItem(key);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },

    async writeIndex(tournaments) {
      const summary = (tournaments ?? []).map(summarize);
      await storage.setItem(key, JSON.stringify(summary));
    },

    async getLocalBlobIds() {
      const keys = typeof storage.getAllKeys === 'function' ? await storage.getAllKeys() : [];
      return keys
        .filter((k) => typeof k === 'string' && k.startsWith(BLOB_PREFIX))
        .map((k) => k.slice(BLOB_PREFIX.length));
    },
  };
}

// Singleton used by the app. Tests call createTournamentsIndex with their own storage.
export const tournamentsIndex = createTournamentsIndex();
