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
import { roundDurationMs } from '../store/roundDuration';

export function useRoundDuration({ tournamentId, roundId, endAt = null } = {}) {
  const { state } = useRoundCards(tournamentId, roundId);

  useEffect(() => {
    if (!tournamentId || !roundId || !isOnline()) return;
    pull(tournamentId, roundId).catch(() => {});
  }, [tournamentId, roundId]);

  return useMemo(
    () => roundDurationMs({ endAt, cardsByAuthor: state.cardsByAuthor }),
    [endAt, state.cardsByAuthor],
  );
}

export default useRoundDuration;
