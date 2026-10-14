import { useCallback, useEffect, useRef, useState } from 'react';
import { getLeague, getLeagueCached } from '../store/leagueStore';
import { leagueErrorText } from '../lib/leagueErrorText';
import { t } from '../i18n';

// One league's snapshot for the League screens (the shape getLeague returns).
// Cache first, then live, on mount and on every focus. The cached snapshot is
// not `stale` while the live read is still in flight; if the live read fails
// it stays on screen and `stale` is true; with nothing cached
// `error` carries the message. A deleted league always ends in `error`. `refresh` is the pull-to-refresh handler.
export function useLeague(navigation, leagueId) {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const dataRef = useRef(null);

  const load = useCallback(async () => {
    if (!leagueId) return;
    if (!dataRef.current) {
      const cached = await getLeagueCached(leagueId);
      if (cached?.snapshot && mountedRef.current && !dataRef.current) {
        dataRef.current = cached.snapshot;
        setData(cached.snapshot);
        setLoading(false);
      }
    }
    try {
      const live = await getLeague(leagueId);
      if (!mountedRef.current) return;
      dataRef.current = live;
      setData(live);
      setStale(false);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      if (e?.code === 'league_gone') {
        // Deleted: the cached snapshot must not keep it alive on screen.
        dataRef.current = null;
        setData(null);
        setStale(false);
        setError(leagueErrorText(e));
      } else if (dataRef.current) setStale(true);
      else setError(leagueErrorText(e) || t('league.final.loadFailed'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const unsubscribe = navigation?.addListener?.('focus', load);
    return () => {
      mountedRef.current = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    if (mountedRef.current) setRefreshing(false);
  }, [load]);

  return { data, stale, loading, refreshing, error, reload: load, refresh };
}
