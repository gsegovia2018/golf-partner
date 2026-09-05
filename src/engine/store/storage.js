// Persistence for the per-scorer card model (plan §3.2, §4).
//
// A thin async key/value layer over an injectable storage that implements
// AsyncStorage's getItem/setItem/removeItem surface. Nothing here knows about
// React, the network, or the engine's semantics — it stores and returns plain
// JSON.
//
// Keys, all namespaced per tournament so two live games never touch each
// other's bytes (S14):
//
//   @cards:<tid>:draft                    { [roundId]: { [hole]: { entries, shots? } } }
//   @cards:<tid>:mine:<roundId>           { card, pending: boolean }
//   @cards:<tid>:peer:<roundId>:<author>  card
//   @cards:<tid>:resolutions              { [roundId]: { [playerId]: { [hole]: resolution } } }
//   @cards:<tid>:meta                     { scorer, rounds, peers, lastPulledAt }
//   @cards:pending                        [tid...]
//
// The peer keys are NOT enumerable through this interface on purpose (the
// injectable surface has no getAllKeys): `meta.peers[roundId]` is the index of
// which peer rows exist, so hydration never has to scan storage.
//
// Every mutation of a tournament's keys runs under that tournament's mutex
// (`withTid`), using the same promise-chain technique as store/syncQueue.js:
// each read-modify-write observes the previous one's completed write. The
// cross-tournament pending index has its own mutex, so taking it from inside
// a tournament's critical section cannot deadlock.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_INDEX_KEY = '@cards:pending';

export const cardKeys = {
  draft: (tid) => `@cards:${tid}:draft`,
  mine: (tid, roundId) => `@cards:${tid}:mine:${roundId}`,
  peer: (tid, roundId, authorId) => `@cards:${tid}:peer:${roundId}:${authorId}`,
  resolutions: (tid) => `@cards:${tid}:resolutions`,
  meta: (tid) => `@cards:${tid}:meta`,
};

export function emptyMeta() {
  return {
    scorer: { playerId: null, userId: null },
    rounds: [],
    peers: {},
    lastPulledAt: null,
  };
}

export function createCardStorage({ storage = AsyncStorage } = {}) {
  async function readJson(key, fallback) {
    const raw = await storage.getItem(key);
    if (raw == null) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      // A corrupt value is treated as absent rather than thrown: losing one
      // cached blob must never wedge the scorecard (R5).
      return fallback;
    }
  }

  function writeJson(key, value) {
    return storage.setItem(key, JSON.stringify(value));
  }

  // One promise chain per lock key. The chain promise itself never rejects —
  // a rejection would break the chain for every op queued behind it — but the
  // failure still propagates to the caller through the returned promise.
  const mutexes = new Map();
  function runExclusive(lockKey, fn) {
    const prev = mutexes.get(lockKey) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    mutexes.set(lockKey, result.then(() => undefined, () => undefined));
    return result;
  }

  return {
    /** Serialize a read-modify-write over one tournament's keys. */
    withTid(tid, fn) {
      return runExclusive(`tid:${tid}`, fn);
    },

    // --- unlocked primitives: call from inside withTid when mutating ---

    getDraft: (tid) => readJson(cardKeys.draft(tid), {}),
    setDraft: (tid, draft) => writeJson(cardKeys.draft(tid), draft),

    /** `{ card, pending }` for my own row, or null when I never scored. */
    getMine: (tid, roundId) => readJson(cardKeys.mine(tid, roundId), null),
    /** ONE storage write: the card row is the atomic unit (R7). */
    setMine: (tid, roundId, row) => writeJson(cardKeys.mine(tid, roundId), row),

    getPeer: (tid, roundId, authorId) => readJson(cardKeys.peer(tid, roundId, authorId), null),
    setPeer: (tid, roundId, authorId, card) => writeJson(cardKeys.peer(tid, roundId, authorId), card),

    getResolutions: (tid) => readJson(cardKeys.resolutions(tid), {}),
    setResolutions: (tid, byRound) => writeJson(cardKeys.resolutions(tid), byRound),

    getMeta: (tid) => readJson(cardKeys.meta(tid), emptyMeta()).then((m) => ({ ...emptyMeta(), ...m })),
    setMeta: (tid, meta) => writeJson(cardKeys.meta(tid), meta),

    // --- pending index: self-locked, so pushAll never scans storage ---

    listPendingTids: () => readJson(PENDING_INDEX_KEY, []),

    addPendingTid(tid) {
      return runExclusive(PENDING_INDEX_KEY, async () => {
        const all = await readJson(PENDING_INDEX_KEY, []);
        if (all.includes(tid)) return all;
        const next = [...all, tid];
        await writeJson(PENDING_INDEX_KEY, next);
        return next;
      });
    },

    removePendingTid(tid) {
      return runExclusive(PENDING_INDEX_KEY, async () => {
        const all = await readJson(PENDING_INDEX_KEY, []);
        if (!all.includes(tid)) return all;
        const next = all.filter((t) => t !== tid);
        await writeJson(PENDING_INDEX_KEY, next);
        return next;
      });
    },
  };
}

// The app-wide instance. Tests swap the backing store instead of mocking
// AsyncStorage, so every module below reaches it through getCardStorage() at
// call time rather than capturing it at import time.
let _instance = createCardStorage();

export function getCardStorage() {
  return _instance;
}

/** Test-only: rebind every module to an in-memory backing store. */
export function _setCardStorageForTests(storage) {
  _instance = createCardStorage(storage ? { storage } : {});
  return _instance;
}
