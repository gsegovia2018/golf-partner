import { useCallback, useEffect, useState } from 'react';
import { getMyLeagues, getMyCardsForMonth } from '../store/leagueStore';
import { cardMonth } from '../store/leagueRules';
import { eligibleLeagues } from '../store/leagueSetup';

// Leagues the Setup review step can offer the "Counts for <league>" switch
// for (eligibleLeagues). Read live once (a league card needs the server
// anyway). `loading` is true until the read settles; `error` is true when it
// failed, so Setup can say the round won't count instead of silently dropping
// the switch; `retry` reads again.
export function useSetupLeagues(enabled, userId) {
  const active = !!enabled && !!userId;
  const [state, setState] = useState({ leagues: [], loading: active, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setState((st) => ({ ...st, loading: true, error: false }));
    (async () => {
      try {
        const now = new Date();
        const [mine, cards] = await Promise.all([getMyLeagues(), getMyCardsForMonth(cardMonth(now))]);
        if (!cancelled) setState({ leagues: eligibleLeagues({ leagues: mine, cards, userId, now }), loading: false, error: false });
      } catch {
        if (!cancelled) setState({ leagues: [], loading: false, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [active, userId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
