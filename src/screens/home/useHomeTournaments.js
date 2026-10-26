import { useEffect, useState, useCallback, useRef } from 'react';
import { afterTabSettles } from '../../navigation/tabSettle';
import { markBootReady } from '../../store/bootReveal';
import {
  loadTournament, loadAllTournamentsWithFallback, loadCachedTournamentsList,
  subscribeTournamentChanges, getTournament,
} from '../../store/tournamentStore';
import { ensureRealtimeForTournament, stopRealtime } from '../../store/realtimeSync';
import { subscribeConnectivity } from '../../lib/connectivity';
import { shouldHandleStoreChange } from '../../lib/navigationFocus';
import { useT } from '../../i18n';

// Home's data: the viewed tournament (the route's, else the active one) and
// the list of every tournament, reloaded on focus, store change and reconnect.
export function useHomeTournaments({ navigation, routeTournamentId, initialTournament }) {
  const tx = useT();
  const [tournament, setTournament] = useState(() => initialTournament);
  const [allTournaments, setAllTournaments] = useState(() => (initialTournament ? [initialTournament] : []));
  const [listStale, setListStale] = useState(false);
  const [openableIds, setOpenableIds] = useState(null); // null = all openable
  const [loading, setLoading] = useState(() => !initialTournament);
  const [refreshing, setRefreshing] = useState(false);
  // Surfaced inline when reload() throws — instead of silently dropping the
  // user into an empty state with no way to recover.
  const [reloadError, setReloadError] = useState(null);

  // Drop the boot splash overlay (App.js) once this screen has real content
  // to stand behind it — the first render where nothing is loading.
  useEffect(() => {
    if (!loading) markBootReady();
  }, [loading]);

  // Coalesce reload calls: `focus` and store-change emits can arrive in
  // quick succession. Run them serially and squash consecutive triggers
  // into a single trailing reload so we don't fan out overlapping
  // network round-trips.
  const reloadInFlight = useRef(null);
  const reloadPending = useRef(false);
  const hasLoadedOnceRef = useRef(!!initialTournament);
  // `remote: false` (store-change reloads) reads the tournament from the cache
  // with no background fetch: that fetch writes through saveLocal, which emits
  // another change, which would re-enter here (see getTournament). Focus,
  // pull-to-refresh and reconnect keep the refresh.
  const reloadPendingRemote = useRef(false);
  const reload = useCallback(async (opts) => {
    const remote = opts?.remote !== false;
    if (reloadInFlight.current) {
      reloadPending.current = true;
      if (remote) reloadPendingRemote.current = true;
      return reloadInFlight.current;
    }
    const run = async () => {
      // Only flash the splash on the first load. Subsequent reloads swap
      // data in place to avoid flicker and perceived slowness.
      if (!hasLoadedOnceRef.current) setLoading(true);
      // The game view keeps its own round selection in step (GameView).
      const applyTournament = (t) => {
        setTournament(t);
        ensureRealtimeForTournament(t?.id ?? null).catch(() => {});
      };
      try {
        const tournamentPromise = routeTournamentId
          ? getTournament(routeTournamentId, { refreshRemote: remote })
          : loadTournament({ refreshRemote: remote });
        // Never throws: falls back to the device copy on failure.
        const listPromise = loadAllTournamentsWithFallback();
        if (!hasLoadedOnceRef.current) {
          // Cold start: the list already on the device paints Home (and lifts
          // the boot splash) at once, and the remote list replaces it below.
          // Waiting on the remote list held the splash for its round-trip, up
          // to the 6 s failsafe on a weak course signal. The tournament is a
          // local read that refreshes in the background.
          const cachedList = await loadCachedTournamentsList({ listedOnly: true }).catch(() => []);
          if (cachedList.length > 0) {
            applyTournament(await tournamentPromise);
            setAllTournaments(cachedList);
            hasLoadedOnceRef.current = true;
            setLoading(false);
          }
        }
        const [t, listResult] = await Promise.all([tournamentPromise, listPromise]);
        applyTournament(t);
        setAllTournaments(listResult.list);
        setListStale(listResult.stale);
        setOpenableIds(listResult.openableIds);
        setReloadError(null);
      } catch (err) {
        // Surface the failure inline (with a Retry) rather than letting the
        // empty state render as if there were genuinely nothing to show.
        setReloadError(err?.message ?? tx('home.error.loadTournaments'));
      } finally {
        hasLoadedOnceRef.current = true;
        setLoading(false);
      }
    };
    const p = run().finally(() => {
      reloadInFlight.current = null;
      if (reloadPending.current) {
        const again = reloadPendingRemote.current;
        reloadPending.current = false;
        reloadPendingRemote.current = false;
        reload({ remote: again });
      }
    });
    reloadInFlight.current = p;
    return p;
  }, [routeTournamentId, tx]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => afterTabSettles(reload));
    const unsubStore = subscribeTournamentChanges(() => {
      if (shouldHandleStoreChange(navigation)) reload({ remote: false });
    });
    // Re-pull when the device comes back online so the orange "Sin
    // conexión" banner clears on its own without forcing the user to
    // navigate or pull-to-refresh. The first event fires the current
    // state — ignore it so we don't double-load on mount (`focus`
    // already triggers the initial reload).
    let seenFirstConnEvent = false;
    const unsubConn = subscribeConnectivity((online) => {
      if (!seenFirstConnEvent) { seenFirstConnEvent = true; return; }
      if (online) reload();
    });
    return () => { unsubscribe(); unsubStore(); unsubConn(); };
  }, [navigation, reload]);

  // Home owns the realtime channel's lifetime — torn down on unmount so a
  // signed-out/backgrounded Home doesn't leave a stale subscription open.
  useEffect(() => () => stopRealtime(), []);

  return {
    tournament, setTournament,
    allTournaments, setAllTournaments,
    listStale, setListStale,
    openableIds, setOpenableIds,
    loading, reloadError, reload,
    refreshing, onRefresh,
  };
}
