import { useEffect, useState } from 'react';
import { getMyLeagues, getMyCardsForMonth } from '../store/leagueStore';
import { cardMonth } from '../store/leagueRules';
import { eligibleLeagues } from '../store/leagueSetup';

// Leagues the Setup review step can offer the "Counts for <league>" switch
// for (eligibleLeagues). Read live once; offline or on any failure the list
// stays empty and the switch is simply not shown — a league card needs the
// server anyway.
export function useSetupLeagues(enabled, userId) {
  const [leagues, setLeagues] = useState([]);
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const [mine, cards] = await Promise.all([getMyLeagues(), getMyCardsForMonth(cardMonth(now))]);
        if (!cancelled) setLeagues(eligibleLeagues({ leagues: mine, cards, userId, now }));
      } catch {
        // No switch without a connection.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, userId]);
  return leagues;
}
