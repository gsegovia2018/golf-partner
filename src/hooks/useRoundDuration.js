// How long a round took, live off the card store — see store/roundDuration.js.
//
// Reads the same per-round snapshot the scorecard does, so a round scored on
// this phone answers offline. A round scored elsewhere (a friend's, or one
// played before this device) only has its cards on the server, so one
// best-effort pull runs per round when online; the snapshot updates when it
// lands and the duration re-derives.

import { useEffect, useMemo } from 'react';
import { useRoundCards } from './useRoundCards';
import { pull } from '../engine/store/replicator';
import { isOnline } from '../lib/connectivity';
import { roundDurationMs, roundSpan } from '../store/roundDuration';

/** { firstAt, lastAt } of the round's published holes, or null. */
export function useRoundSpan(tournamentId, roundId) {
  const { state } = useRoundCards(tournamentId, roundId);

  useEffect(() => {
    if (!tournamentId || !roundId || !isOnline()) return;
    pull(tournamentId, roundId).catch(() => {});
  }, [tournamentId, roundId]);

  return useMemo(() => roundSpan(state.cardsByAuthor), [state.cardsByAuthor]);
}

export function useRoundDuration({
  tournamentId, roundId, endAt = null, createdAt = null,
} = {}) {
  const span = useRoundSpan(tournamentId, roundId);
  return useMemo(
    () => roundDurationMs({ span, endAt, createdAt }),
    [span, endAt, createdAt],
  );
}

export default useRoundDuration;
