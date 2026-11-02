import AsyncStorage from '@react-native-async-storage/async-storage';

// Minutes per hole of recently played rounds (mine and friends'), kept on
// the phone so a round on a course with no signal still has a prior for
// roundPace.priorPace. Fed by feedStore, which already works out each
// finished round's duration from its cards. Shaped for useSyncExternalStore.

const KEY = 'paceHistory.v1';
const MAX_ROUNDS = 80;
const MIN_HOLES = 9;

let rows = null; // roundKey -> { course, minPerHole, at }
let version = 0;
const listeners = new Set();
const bump = () => { version += 1; listeners.forEach((l) => l()); };

export function subscribePaceHistory(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const getPaceHistoryVersion = () => version;

async function load() {
  if (rows) return;
  rows = new Map();
  try {
    const raw = await AsyncStorage.getItem(KEY);
    for (const [k, v] of Object.entries(raw ? JSON.parse(raw) : {})) rows.set(k, v);
    if (rows.size) bump();
  } catch {
    // corrupt: rebuilt from the next feed
  }
}

export function loadPaceHistory() {
  return load();
}

// [{ course, minPerHole }] for priorPace.
export function getPaceHistory() {
  return rows ? [...rows.values()] : [];
}

// Feed round items -> history. Keeps finished rounds of 9+ holes whose
// duration the cards could tell; the newest MAX_ROUNDS stay.
export async function recordRoundPaces(items) {
  await load();
  let changed = false;
  for (const it of items ?? []) {
    if (it?.type !== 'round' || it.live || !it.courseName) continue;
    const holes = it.holes ?? 0;
    if (!Number.isFinite(it.durationMs) || holes < MIN_HOLES) continue;
    const minPerHole = Math.round((it.durationMs / 60000 / holes) * 10) / 10;
    const prev = rows.get(it.key);
    if (prev && prev.minPerHole === minPerHole) continue;
    rows.set(it.key, { course: it.courseName, minPerHole, at: it.ts ?? 0 });
    changed = true;
  }
  if (!changed) return;
  if (rows.size > MAX_ROUNDS) {
    const keep = [...rows.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ROUNDS);
    rows = new Map(keep);
  }
  bump();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(Object.fromEntries(rows)));
  } catch {
    // storage full: the in-memory copy still serves this session
  }
}

export function _resetPaceHistoryForTests() {
  rows = null;
  version = 0;
}
