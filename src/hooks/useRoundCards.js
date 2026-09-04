// The scorecard's single source of truth (plan §4, §7).
//
// One `useSyncExternalStore` over the card store's stable per-round snapshot.
// There is deliberately no React copy of the scores, no dirty set and no
// self-echo skipping: the store already returns a reference that changes only
// when the data changed, so React re-renders exactly when it should.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  identify,
  publishHole,
  resolve,
  setDraftEntry,
  setDraftShot,
} from '../engine/store/actions';
import { getRoundState, loadRound, subscribeRound } from '../engine/store/roundState';
import { getSyncStatus, subscribeSyncStatus } from '../engine/store/replicator';

const NOOP_UNSUBSCRIBE = () => {};

/**
 * @returns {{ state, actions }} where `state` is
 *   `{ myAuthorId, cardsByAuthor, resolutions, draft, pending, lastPulledAt, loaded }`
 *   — feedable straight to `src/engine/cards.js` as its `ctx` — and `actions`
 *   are the write actions with `tid`/`roundId` already bound.
 */
export function useRoundCards(tid, roundId) {
  const subscribe = useCallback(
    (cb) => (tid && roundId ? subscribeRound(tid, roundId, cb) : NOOP_UNSUBSCRIBE),
    [tid, roundId],
  );
  const getSnapshot = useCallback(() => getRoundState(tid, roundId), [tid, roundId]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (tid && roundId) loadRound(tid, roundId);
  }, [tid, roundId]);

  const actions = useMemo(() => ({
    setDraftEntry: (hole, playerId, value) => setDraftEntry(tid, roundId, hole, playerId, value),
    setDraftShot: (hole, playerId, detail) => setDraftShot(tid, roundId, hole, playerId, detail),
    publishHole: (hole, now) => publishHole(tid, roundId, hole, now),
    resolve: (args) => resolve(tid, roundId, args),
    identify: (scorer) => identify(tid, scorer),
  }), [tid, roundId]);

  return { state, actions };
}

/** 'idle' | 'pending' | 'syncing' | 'error' — for the sync sheet / header. */
export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
}

export default useRoundCards;
