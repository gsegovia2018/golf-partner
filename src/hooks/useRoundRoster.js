import { useEffect, useMemo, useState } from 'react';
import { getCachedPlayers } from '../store/libraryStore';
import { recoverRoundRoster } from '../store/scoring';

// Reads the local player library once and hands back `players` with any
// player this round still references but the roster has lost — named from
// that library. See recoverRoundRoster (store/scoring.js) for why a roster
// player can go missing and why recovery is scoped to a single round.
//
// The library read is local-only (AsyncStorage) and never throws, so this
// works exactly as well with no connection — which is the case it exists for.
// Until it resolves, `known` is null and the roster passes through untouched.
export function useRoundRoster(round, players) {
  const [known, setKnown] = useState(null);

  useEffect(() => {
    let alive = true;
    getCachedPlayers()
      .then((rows) => { if (alive) setKnown(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return useMemo(
    () => recoverRoundRoster(round, players, known),
    [round, players, known],
  );
}
