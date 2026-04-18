import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@golf_media_queue';

const _subs = new Set();
function _emit() { _subs.forEach((fn) => { try { fn(); } catch (_) {} }); }

export function subscribeQueueChanges(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

let _cache = null;
async function read() {
  if (_cache) return _cache;
  const raw = await AsyncStorage.getItem(KEY);
  _cache = raw ? JSON.parse(raw) : [];
  return _cache;
}

async function write(items) {
  _cache = items;
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  _emit();
}

export async function listQueue() {
  return [...(await read())];
}

export async function listQueueForTournament(tournamentId) {
  return (await read()).filter((e) => e.tournamentId === tournamentId);
}

export async function listQueueForRound(roundId) {
  return (await read()).filter((e) => e.roundId === roundId);
}

export async function enqueueMedia(entry) {
  const items = await read();
  const next = [...items, {
    ...entry,
    status: 'pending',
    attempts: 0,
    lastError: null,
    enqueuedAt: new Date().toISOString(),
  }];
  await write(next);
}

export async function updateQueueEntry(id, patch) {
  const items = await read();
  const next = items.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await write(next);
}

export async function removeQueueEntry(id) {
  const items = await read();
  await write(items.filter((e) => e.id !== id));
}

export async function clearQueue() {
  await write([]);
}
