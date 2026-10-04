import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyLeagues, getLeague } from '../store/leagueStore';
import { leagueSummary } from '../store/leagueView';

const ROWS_CACHE_KEY = '@golf_league_rows';

// Rows for the Play tab's LEAGUES section: `{ id, name, position }`, loaded on
// every focus. Cached rows show first (so the list is there with no signal),
// then my leagues are read live, then each league's standings fill in
// `position` ("2nd of 7 · 2,340 pts"). Any failure keeps what is on screen.
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
    const known = new Map(rowsRef.current.map((r) => [r.id, r.position]));
    let next = leagues.map((l) => ({ id: l.id, name: l.name, position: known.get(l.id) ?? null }));
    publish(next);
    await Promise.all(leagues.map(async (l) => {
      try {
        const snapshot = await getLeague(l.id);
        const { position } = leagueSummary(snapshot, meId);
        next = next.map((r) => (r.id === l.id ? { ...r, position } : r));
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
    const unsubscribe = navigation?.addListener?.('focus', load);
    return () => {
      mountedRef.current = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation, load]);

  return rows;
}
