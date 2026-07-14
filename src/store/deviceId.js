import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@golf_device_author_id';
let _cached = null;
let _initPromise = null;

function generateId() {
  return `dev-${Math.random().toString(36).slice(2)}`;
}

// Hydrates the stable, persisted device author id. MUST be awaited at app
// startup before any scoring UI can mount — see getDeviceAuthorId() below.
// Reads the persisted id from AsyncStorage, generating + persisting one
// exactly once if absent, and populates the in-memory cache. Safe to call
// more than once: concurrent/repeat calls share the same in-flight work and
// resolve to the same id, so the write to AsyncStorage happens exactly once.
export function initDeviceAuthorId() {
  if (_cached) return Promise.resolve(_cached);
  if (_initPromise) return _initPromise;
  _initPromise = AsyncStorage.getItem(KEY)
    .then((persisted) => {
      if (persisted) {
        _cached = persisted;
        return _cached;
      }
      const id = generateId();
      return AsyncStorage.setItem(KEY, id).then(() => {
        _cached = id;
        return _cached;
      });
    })
    .catch(() => {
      // AsyncStorage unavailable/failed: fall back to an in-memory-only id
      // for this session rather than leaving getDeviceAuthorId() stuck
      // returning null forever. It won't survive a reload, but it's stable
      // for the lifetime of this process, which is what deriveCell() needs.
      if (!_cached) _cached = generateId();
      return _cached;
    })
    .finally(() => { _initPromise = null; });
  return _initPromise;
}

// Stable device author id for score stamping, once initDeviceAuthorId() has
// resolved. Returns null if called before hydration completes — callers
// must ensure initDeviceAuthorId() is awaited at app startup, before any
// scoring UI can mount, so this is always safe in practice. It deliberately
// never falls back to a freshly-generated throwaway id: doing so previously
// caused the same physical device to stamp two different author ids on the
// same player/hole (one for scores authored before hydration, one after),
// which surfaced as a spurious, unresolvable "two phones recorded different
// scores" conflict in deriveCell() (see scoreEntries.js).
export function getDeviceAuthorId() {
  return _cached;
}

// Test-only: clears the in-memory cache (but not AsyncStorage) so tests can
// simulate an app reload against the same persisted backing store.
export function _resetDeviceAuthorIdCacheForTests() {
  _cached = null;
  _initPromise = null;
}
