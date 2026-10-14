import { useCallback, useEffect, useRef, useState } from 'react';
import { getLeagueCardEvents } from '../store/leagueStore';
import { leagueErrorText } from '../lib/leagueErrorText';
import { t } from '../i18n';

// A card's timeline, oldest first. Reloads when the card changes or `version`
// does (the screen bumps it after an action). { events, loading, error, reload }.
export function useCardEvents(cardId, version = 0) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(!!cardId);
  const [error, setError] = useState(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!cardId) return;
    const mine = ++latest.current;
    setLoading(true);
    try {
      const rows = await getLeagueCardEvents(cardId);
      if (mine !== latest.current) return;
      setEvents(rows);
      setError(null);
    } catch (e) {
      if (mine !== latest.current) return;
      setError(leagueErrorText(e) || t('league.timeline.loadError'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    setEvents([]);
    load();
    return () => { latest.current += 1; };
  }, [load, version]);

  return { events, loading, error, reload: load };
}
