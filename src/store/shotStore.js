import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';

// Personal GPS shot log (golf_shot table). Shots are private to the author,
// so this is a single-user store: one in-memory list of every shot the signed
// in player has marked, mirrored to AsyncStorage for offline/instant reads and
// synced to Supabase best-effort. Optimistic: logShot adds locally at once and
// pushes to the server in the background; a failed push stays `pending` and is
// retried on the next flush. Shaped for useSyncExternalStore like geo.js.

const CACHE_KEY = 'golf_shots.v1';

let SHOTS = []; // [{ id, roundId, roundIndex, holeNumber, seq, lat, lng, club, holed, pending? }]
let userId = null;
let version = 0;
const listeners = new Set();

function emit() { version += 1; listeners.forEach((l) => l()); }
export function subscribeShots(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getShotsVersion() { return version; }
export function getShots() { return SHOTS; }

async function persistCache() {
  try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(SHOTS)); } catch { /* ignore */ }
}

function rowToShot(r) {
  return {
    id: r.id,
    roundId: r.round_id,
    roundIndex: r.round_index,
    holeNumber: r.hole_number,
    seq: r.seq,
    lat: r.lat,
    lng: r.lng,
    club: r.club ?? null,
    holed: !!r.holed,
  };
}

function shotToRow(s) {
  return {
    id: s.id,
    user_id: userId,
    round_id: s.roundId,
    round_index: s.roundIndex,
    hole_number: s.holeNumber,
    seq: s.seq,
    lat: s.lat,
    lng: s.lng,
    club: s.club ?? null,
    holed: !!s.holed,
  };
}

// Call once at app boot. Cache first (instant/offline), then Supabase wins.
// Never throws — falls back to whatever is cached on any failure.
export async function hydrateShots() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) { SHOTS = JSON.parse(raw); emit(); }
  } catch { /* ignore corrupt cache */ }
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    if (!userId) return;
    // Push anything that never reached the server before adopting server truth.
    await flushPending();
    const { data, error } = await supabase
      .from('golf_shot')
      .select('id,round_id,round_index,hole_number,seq,lat,lng,club,holed')
      .eq('user_id', userId);
    if (error) throw error;
    const server = (data ?? []).map(rowToShot);
    // Keep still-pending local shots the server hasn't acked yet.
    const pending = SHOTS.filter((s) => s.pending && !server.some((r) => r.id === s.id));
    SHOTS = [...server, ...pending];
    await persistCache();
    emit();
  } catch {
    // offline or table not migrated yet — keep cache
  }
}

async function flushPending() {
  const pend = SHOTS.filter((s) => s.pending);
  if (!pend.length || !userId) return;
  for (const s of pend) {
    const { error } = await supabase.from('golf_shot').upsert(shotToRow(s));
    if (!error) { delete s.pending; }
  }
  await persistCache();
  emit();
}

// Shots for one hole of a round, ordered by seq.
export function shotsForHole(roundId, roundIndex, holeNumber) {
  return SHOTS
    .filter((s) => s.roundId === roundId && s.roundIndex === roundIndex && s.holeNumber === holeNumber)
    .sort((a, b) => a.seq - b.seq);
}

function nextSeq(roundId, roundIndex, holeNumber) {
  const hole = shotsForHole(roundId, roundIndex, holeNumber);
  return hole.length ? hole[hole.length - 1].seq + 1 : 1;
}

// Mark a shot at the current GPS position. Adds locally immediately; syncs in
// the background. `pos` is [lat, lng]. Returns the new shot.
export async function logShot({ roundId, roundIndex, holeNumber, pos, club = null, holed = false }) {
  const shot = {
    id: uuidv4(),
    roundId,
    roundIndex,
    holeNumber,
    seq: nextSeq(roundId, roundIndex, holeNumber),
    lat: pos[0],
    lng: pos[1],
    club,
    holed,
    pending: true,
  };
  SHOTS = [...SHOTS, shot];
  emit();
  await persistCache();
  try {
    if (userId) {
      const { error } = await supabase.from('golf_shot').upsert(shotToRow(shot));
      if (!error) { delete shot.pending; await persistCache(); emit(); }
    }
  } catch { /* stays pending, retried on next hydrate/flush */ }
  return shot;
}

// Change the club on an already-logged shot.
export async function setShotClub(id, club) {
  const shot = SHOTS.find((s) => s.id === id);
  if (!shot) return;
  shot.club = club;
  shot.pending = true;
  emit();
  await persistCache();
  try {
    if (userId) {
      const { error } = await supabase.from('golf_shot').upsert(shotToRow(shot));
      if (!error) { delete shot.pending; await persistCache(); emit(); }
    }
  } catch { /* stays pending */ }
}

// Move an already-logged shot to a new [lat, lng] (drag/re-place the spot).
export async function setShotPos(id, pos) {
  const shot = SHOTS.find((s) => s.id === id);
  if (!shot || !pos) return;
  [shot.lat, shot.lng] = pos;
  shot.pending = true;
  emit();
  await persistCache();
  try {
    if (userId) {
      const { error } = await supabase.from('golf_shot').upsert(shotToRow(shot));
      if (!error) { delete shot.pending; await persistCache(); emit(); }
    }
  } catch { /* stays pending */ }
}

// Remove any one shot by id.
export async function deleteShot(id) {
  const shot = SHOTS.find((s) => s.id === id);
  if (!shot) return;
  SHOTS = SHOTS.filter((s) => s.id !== id);
  emit();
  await persistCache();
  try {
    if (userId && !shot.pending) await supabase.from('golf_shot').delete().eq('id', id);
  } catch { /* server row lingers; harmless, re-hydrate reconciles */ }
}

// Remove every shot belonging to a round (cascade when a round is deleted).
export async function deleteShotsForRound(roundId) {
  if (roundId == null) return;
  const before = SHOTS.length;
  SHOTS = SHOTS.filter((s) => s.roundId !== roundId);
  if (SHOTS.length === before) return;
  emit();
  await persistCache();
  try {
    if (userId) await supabase.from('golf_shot').delete().eq('round_id', roundId);
  } catch { /* server rows linger; harmless, re-hydrate reconciles */ }
}

// Drop shots whose round no longer exists. `validRoundIds` is the complete set
// of the user's current round ids — pass `deleteRemote: true` ONLY when that
// set is authoritative (a fresh server list), so a partial/offline list never
// deletes live shots. Local prune is always safe to show the right count.
export async function pruneShotsToRounds(validRoundIds, { deleteRemote = false } = {}) {
  const valid = validRoundIds instanceof Set ? validRoundIds : new Set(validRoundIds || []);
  const orphans = SHOTS.filter((s) => !valid.has(s.roundId));
  if (!orphans.length) return 0;
  SHOTS = SHOTS.filter((s) => valid.has(s.roundId));
  emit();
  await persistCache();
  if (deleteRemote && userId) {
    const ids = orphans.filter((s) => !s.pending).map((s) => s.id);
    try {
      for (let i = 0; i < ids.length; i += 100) {
        await supabase.from('golf_shot').delete().in('id', ids.slice(i, i + 100));
      }
    } catch { /* server rows linger; pruned again on the next authoritative load */ }
  }
  return orphans.length;
}

// Remove the last shot on a hole (undo mis-taps).
export async function undoLastShot(roundId, roundIndex, holeNumber) {
  const hole = shotsForHole(roundId, roundIndex, holeNumber);
  if (!hole.length) return;
  const last = hole[hole.length - 1];
  SHOTS = SHOTS.filter((s) => s.id !== last.id);
  emit();
  await persistCache();
  try {
    if (userId && !last.pending) await supabase.from('golf_shot').delete().eq('id', last.id);
  } catch { /* server row lingers; harmless, re-hydrate reconciles */ }
}
