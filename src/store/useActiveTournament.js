import { useEffect, useState, useCallback } from 'react';
import { loadTournament, subscribeTournamentChanges } from './tournamentStore';

export function useActiveTournament() {
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const t = await loadTournament();
      setTournament(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const unsub = subscribeTournamentChanges(reload);
    return unsub;
  }, [reload]);

  return { tournament, loading, reload };
}
