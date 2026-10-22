import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyLeagues, getLeague } from '../store/leagueStore';
import { leagueSummary } from '../store/leagueView';

const ROWS_CACHE_KEY = '@golf_league_rows';

const removalListeners = new Set();

// A deleted league leaves the list at once: out of the cached rows (so a cold
// start or an offline focus cannot bring it back) and out of any mounted list.
export async function dropLeagueRow(leagueId) {
  removalListeners.forEach((fn) => fn(leagueId));
  try {
    const raw = await AsyncStorage.getItem(ROWS_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (cached && Array.isArray(cached.rows)) {
      await AsyncStorage.setItem(ROWS_CACHE_KEY, JSON.stringify({ ...cached, rows: cached.rows.filter((r) => r.id !== leagueId) }));
    }
  } catch {
    // Cache is best-effort.
  }
}

// Rows for the Play tab's LEAGUES section: `{ id, name, position, month, action }` (position and month are message
// descriptors, action is leagueView.homeAction's next step), loaded on
// every focus. Cached rows show first (so the list is there with no signal),
// then my leagues are read live, then each league's standings fill in
// `position` ("2nd of 7 · 2,340 league pts") and the open month's line. Any failure keeps what is on screen.
export function useMyLeagueRows(navigation, meId) {
  const [rows, setRows] = useState([]);
  const mountedRef = useRef(true);
  const rowsRef = useRef([]);

  const publish = useCallback((next) => {
    rowsRef.current = next;
    if (mountedRef.current) setRows(next);
  }, []);

  const load = useCallback(async () => {
    if (!meId) { publish([]); return; }
    if (rowsRef.current.length === 0) {
      try {
        const raw = await AsyncStorage.getItem(ROWS_CACHE_KEY);
        const cached = raw ? JSON.parse(raw) : null;
        if (cached?.meId === meId && Array.isArray(cached.rows)) publish(cached.rows);
      } catch {
        // Cache is best-effort.
      }
    }
    let leagues;
    try {
      leagues = await getMyLeagues();
    } catch {
      return; // offline or failed: keep the cached rows
    }
    const known = new Map(rowsRef.current.map((r) => [r.id, r]));
    let next = leagues.map((l) => ({
      id: l.id, name: l.name, position: known.get(l.id)?.position ?? null, month: known.get(l.id)?.month ?? null,
      action: known.get(l.id)?.action ?? null,
    }));
    publish(next);
    await Promise.all(leagues.map(async (l) => {
      try {
        const snapshot = await getLeague(l.id);
        const { position, month, action } = leagueSummary(snapshot, meId);
        next = next.map((r) => (r.id === l.id ? { ...r, position, month, action } : r));
        publish(next);
      } catch {
        // Keep the cached position for this league.
      }
    }));
    AsyncStorage.setItem(ROWS_CACHE_KEY, JSON.stringify({ meId, rows: next })).catch(() => {});
  }, [meId, publish]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const onRemoved = (id) => publish(rowsRef.current.filter((r) => r.id !== id));
    removalListeners.add(onRemoved);
    const unsubscribe = navigation?.addListener?.('focus', load);
    return () => {
      mountedRef.current = false;
      removalListeners.delete(onRemoved);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation, load]);

  return rows;
}
