// In-memory round state and change notification (plan §4).
//
// One record per (tournament, round). `getRoundState` returns a STABLE object
// reference that changes identity only when the data behind it changed, which
// is exactly the contract `useSyncExternalStore` needs — see
// src/hooks/useRoundCards.js.
//
// The snapshot is the engine's `ctx` plus the bookkeeping the screen needs:
//
//   { myAuthorId, cardsByAuthor, resolutions, draft,
//     pending: { cards, resolutions }, lastPulledAt, loaded }
//
// `cardsByAuthor` carries my own card under `myAuthorId` alongside the peers',
// so it can be handed straight to cards.js. `resolutions` is the engine shape
// for this round only (`{ [playerId]: { [hole]: resolution } }`); a resolution
// this device has not pushed yet also carries `pending: true`, which the
// engine ignores.
//
// Nothing here touches the network. Persistence is storage.js; the network is
// replicator.js.

import { getDeviceAuthorId, initDeviceAuthorId } from '../../store/deviceId';
import { getCardStorage } from './storage';

const EMPTY_STATE = Object.freeze({
  myAuthorId: null,
  cardsByAuthor: Object.freeze({}),
  resolutions: Object.freeze({}),
  draft: Object.freeze({}),
  pending: Object.freeze({ cards: false, resolutions: false }),
  lastPulledAt: null,
  loaded: false,
});

const records = new Map();

const recordKey = (tid, roundId) => `${tid}\u0000${roundId}`;

function getRecord(tid, roundId) {
  const k = recordKey(tid, roundId);
  let rec = records.get(k);
  if (rec) return rec;
  rec = {
    tid,
    roundId,
    myCard: null,
    minePending: false,
    peers: {},
    resolutions: {},
    draft: {},
    lastPulledAt: null,
    loaded: false,
    loadPromise: null,
    subs: new Set(),
    snapshot: null,
  };
  rebuild(rec);
  records.set(k, rec);
  return rec;
}

function rebuild(rec) {
  // Resolved on every rebuild rather than captured once: deviceId hydration
  // is async, so a record created before it resolves must pick the id up as
  // soon as it exists instead of caching null forever.
  const myAuthorId = getDeviceAuthorId();
  const cardsByAuthor = { ...rec.peers };
  if (myAuthorId && rec.myCard) cardsByAuthor[myAuthorId] = rec.myCard;

  let resolutionsPending = false;
  for (const byHole of Object.values(rec.resolutions)) {
    for (const resolution of Object.values(byHole ?? {})) {
      if (resolution?.pending) { resolutionsPending = true; break; }
    }
    if (resolutionsPending) break;
  }

  rec.snapshot = {
    myAuthorId,
    cardsByAuthor,
    resolutions: rec.resolutions,
    draft: rec.draft,
    pending: { cards: !!rec.minePending, resolutions: resolutionsPending },
    lastPulledAt: rec.lastPulledAt,
    loaded: rec.loaded,
  };
}

/**
 * Apply a batch of changes to one round and notify subscribers ONCE. Callers
 * batch on purpose: a pull that lands seven holes of a peer's card must cost
 * one render, not seven (S5).
 *
 * Recognised patch keys: `draft`, `myCard`, `minePending`, `peers` (merged
 * into the existing map), `resolutions`, `lastPulledAt`, `loaded`.
 */
export function applyRound(tid, roundId, patch) {
  if (!tid || !roundId || !patch) return;
  const rec = getRecord(tid, roundId);
  if ('draft' in patch) rec.draft = patch.draft ?? {};
  if ('myCard' in patch) rec.myCard = patch.myCard ?? null;
  if ('minePending' in patch) rec.minePending = !!patch.minePending;
  if ('peers' in patch) rec.peers = { ...rec.peers, ...(patch.peers ?? {}) };
  if ('resolutions' in patch) rec.resolutions = patch.resolutions ?? {};
  if ('lastPulledAt' in patch) rec.lastPulledAt = patch.lastPulledAt ?? null;
  if ('loaded' in patch) rec.loaded = !!patch.loaded;
  rebuild(rec);
  for (const cb of [...rec.subs]) {
    try { cb(); } catch { /* a bad subscriber must not stop the others */ }
  }
}

/** The stable snapshot for this round. Safe to call before `loadRound`. */
export function getRoundState(tid, roundId) {
  if (!tid || !roundId) return EMPTY_STATE;
  return getRecord(tid, roundId).snapshot;
}

export function subscribeRound(tid, roundId, cb) {
  if (!tid || !roundId) return () => {};
  const rec = getRecord(tid, roundId);
  rec.subs.add(cb);
  return () => rec.subs.delete(cb);
}

/** Rounds of this tournament that have an in-memory record. */
export function knownRounds(tid) {
  const out = [];
  for (const rec of records.values()) if (rec.tid === tid) out.push(rec.roundId);
  return out;
}

/**
 * Hydrate one round from storage. Idempotent: concurrent and repeat calls
 * share the same in-flight work and never re-read a loaded round.
 */
export function loadRound(tid, roundId) {
  if (!tid || !roundId) return Promise.resolve(EMPTY_STATE);
  const rec = getRecord(tid, roundId);
  if (rec.loaded) return Promise.resolve(rec.snapshot);
  if (rec.loadPromise) return rec.loadPromise;

  rec.loadPromise = (async () => {
    // The author id is the key my own card hangs on; hydrating without it
    // would drop my card out of cardsByAuthor entirely.
    await initDeviceAuthorId();
    const store = getCardStorage();
    const [meta, mine, drafts, resolutions] = await Promise.all([
      store.getMeta(tid),
      store.getMine(tid, roundId),
      store.getDraft(tid),
      store.getResolutions(tid),
    ]);
    const authorIds = meta.peers?.[roundId] ?? [];
    const peerCards = await Promise.all(authorIds.map((a) => store.getPeer(tid, roundId, a)));
    const peers = {};
    authorIds.forEach((authorId, i) => { if (peerCards[i]) peers[authorId] = peerCards[i]; });

    applyRound(tid, roundId, {
      myCard: mine?.card ?? null,
      minePending: !!mine?.pending,
      peers,
      draft: drafts?.[roundId] ?? {},
      resolutions: resolutions?.[roundId] ?? {},
      lastPulledAt: meta.lastPulledAt ?? null,
      loaded: true,
    });
    return rec.snapshot;
  })().finally(() => { rec.loadPromise = null; });

  return rec.loadPromise;
}

/** Does this tournament still hold anything the replicator owes the server? */
async function tidHasPending(tid, rounds) {
  const store = getCardStorage();
  for (const roundId of rounds) {
    const row = await store.getMine(tid, roundId);
    if (row?.pending) return true;
  }
  const all = await store.getResolutions(tid);
  for (const byPlayer of Object.values(all)) {
    for (const byHole of Object.values(byPlayer ?? {})) {
      for (const resolution of Object.values(byHole ?? {})) {
        if (resolution?.pending) return true;
      }
    }
  }
  return false;
}

/**
 * Forget one round completely: my card, every peer card, the draft, the
 * agreements, the meta index entries, and any pending flag they carried.
 *
 * This exists because a card is otherwise retried forever (R8) — which is the
 * right answer until the round is *gone*. `scorer_cards` has no FK of its own,
 * but the projection trigger writes `game_scores`, which does, so a card whose
 * `game_rounds` row was deleted fails with 23503 on every attempt and the game
 * never leaves 'pending'. Called from tournamentRepo.deleteRound once the
 * server delete lands, and from the replicator when a blocked card turns out
 * to belong to a round another device deleted.
 *
 * Subscribers are kept and notified: a screen still mounted on the round must
 * re-render onto the empty state rather than keep stale cells.
 */
export async function dropRound(tid, roundId) {
  if (!tid || !roundId) return false;
  const store = getCardStorage();

  const remainingRounds = await store.withTid(tid, async () => {
    const meta = await store.getMeta(tid);
    const authorIds = meta.peers?.[roundId] ?? [];
    await store.removeMine(tid, roundId);
    await Promise.all(authorIds.map((a) => store.removePeer(tid, roundId, a)));

    const drafts = await store.getDraft(tid);
    if (roundId in drafts) {
      const { [roundId]: _draft, ...rest } = drafts;
      await store.setDraft(tid, rest);
    }

    const resolutions = await store.getResolutions(tid);
    if (roundId in resolutions) {
      const { [roundId]: _res, ...rest } = resolutions;
      await store.setResolutions(tid, rest);
    }

    const { [roundId]: _peers, ...peers } = meta.peers ?? {};
    const rounds = (meta.rounds ?? []).filter((r) => r !== roundId);
    await store.setMeta(tid, { ...meta, peers, rounds });
    return rounds;
  });

  // The pending index is what pushAll walks. Dropping the last pending round
  // of a tournament has to take the tournament out of it, or every future
  // push re-reads a tournament with nothing to send.
  const others = [...new Set([...remainingRounds, ...knownRounds(tid)])].filter((r) => r !== roundId);
  if (!(await tidHasPending(tid, others))) await store.removePendingTid(tid);

  const rec = records.get(recordKey(tid, roundId));
  if (rec) {
    rec.myCard = null;
    rec.minePending = false;
    rec.peers = {};
    rec.resolutions = {};
    rec.draft = {};
    rec.lastPulledAt = null;
    rec.loaded = false;
    rebuild(rec);
    for (const cb of [...rec.subs]) {
      try { cb(); } catch { /* a bad subscriber must not stop the others */ }
    }
  }
  return true;
}

/** Test-only: drop every cached record and subscriber. */
export function _resetRoundStateForTests() {
  records.clear();
}
