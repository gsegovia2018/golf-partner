import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { SETTINGS_KEY, getAppSettings, isSettingsHydrated } from './settingsStore';

// GPS trail experiment (owner-only, setting `recordGpsTrail`, off by default).
// Records this phone's own position during a live round so stop detection —
// where the golfer stood still, roughly a ball position — can be evaluated
// offline later (scripts/analyzeGpsTrail.mjs). Nothing in the app reads it.
//
// Points `{ t, lat, lng, acc, spd? }` are appended from lib/roundTracking's
// location task, which can run headless (no React tree, settings not
// hydrated), so everything here reads its state back from AsyncStorage when
// memory has none and never throws.
//
// Storage, per round: one meta key plus one key per 500-point chunk. A chunk
// is exactly one golf_gps_trail row (seq = chunk number), so appending only
// rewrites the open tail chunk, and upload is an idempotent upsert of every
// chunk that grew since its last upload. A full chunk, once uploaded, is
// never touched again and its local copy is dropped, keeping AsyncStorage
// (6 MB by default on Android) far from its limit over many rounds.

export const TRAIL_PREFIX = '@gps_trail/';
export const ACTIVE_TRAIL_KEY = '@gps_trail_active';
export const CHUNK_SIZE = 500;
export const MAX_POINTS_PER_ROUND = 20000;
const TABLE = 'golf_gps_trail';
// Headless only: how long a settings-mirror read is trusted before re-reading.
const MIRROR_TTL_MS = 30000;

const enc = encodeURIComponent;
export const trailMetaKey = ({ tournamentId, roundId, roundIndex }) =>
  `${TRAIL_PREFIX}${enc(tournamentId)}/${enc(roundId)}/${roundIndex}`;
export const trailChunkKey = (metaKey, seq) => `${metaKey}#${seq}`;
const isMetaKey = (k) => typeof k === 'string' && k.startsWith(TRAIL_PREFIX) && !k.includes('#');

function normalizeKey(key) {
  if (!key) return null;
  const { userId, tournamentId, roundId, roundIndex } = key;
  if (!userId || !tournamentId || !roundId || !Number.isInteger(roundIndex)) return null;
  return { userId, tournamentId, roundId, roundIndex };
}

async function readJson(k) {
  const raw = await AsyncStorage.getItem(k);
  return raw == null ? null : JSON.parse(raw);
}

// Appends and the read-modify-write half of a flush share one chain, so a
// meta write never clobbers another's count or upload marks.
let chain = Promise.resolve();
function serial(job) {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

// ---- Active round -----------------------------------------------------------

let active = null;
let activeLoaded = false;

// The live round whose fixes are recorded: `{ userId, tournamentId, roundId,
// roundIndex }` from useRoundTracking, or null when tracking stops. Mirrored to
// AsyncStorage so a headless task in a fresh JS context still knows it.
export async function setActiveTrailRound(key) {
  active = normalizeKey(key);
  activeLoaded = true;
  try {
    if (active) await AsyncStorage.setItem(ACTIVE_TRAIL_KEY, JSON.stringify(active));
    else await AsyncStorage.removeItem(ACTIVE_TRAIL_KEY);
  } catch { /* memory still holds it for this run */ }
}

export async function getActiveTrailRound() {
  if (activeLoaded) return active;
  try {
    active = normalizeKey(await readJson(ACTIVE_TRAIL_KEY));
  } catch {
    active = null;
  }
  activeLoaded = true;
  return active;
}

// ---- Setting ----------------------------------------------------------------

let mirror = null; // { on, at } — the persisted settings, read when not hydrated

// In the app, settingsStore's memory is the truth once hydrated. A headless
// task (or the moments before hydrate) only has the AsyncStorage mirror that
// updateAppSettings / hydrateAppSettings write, so read that, briefly cached.
export async function isTrailRecordingEnabled() {
  if (isSettingsHydrated()) return getAppSettings().recordGpsTrail === true;
  const now = Date.now();
  if (mirror && now - mirror.at < MIRROR_TTL_MS) return mirror.on;
  let on = false;
  try {
    on = (await readJson(SETTINGS_KEY))?.recordGpsTrail === true;
  } catch { /* corrupt mirror → off */ }
  mirror = { on, at: now };
  return on;
}

// ---- Append -----------------------------------------------------------------

// An expo-location LocationObject → trail point, or null if unusable.
export function toTrailPoint(loc) {
  const c = loc?.coords;
  const t = loc?.timestamp;
  if (!c || !Number.isFinite(t) || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return null;
  const p = { t, lat: c.latitude, lng: c.longitude, acc: Number.isFinite(c.accuracy) ? c.accuracy : null };
  if (Number.isFinite(c.speed) && c.speed >= 0) p.spd = c.speed;
  return p;
}

// Appends points to a round's trail. Points at or before the last stored
// timestamp are dropped (de-dupes a re-delivered batch), and the round stops
// growing at MAX_POINTS_PER_ROUND. Resolves to the number of points kept;
// never throws.
export function appendTrailPoints(key, points) {
  const k = normalizeKey(key);
  if (!k || !points?.length) return Promise.resolve(0);
  return serial(async () => {
    try {
      const mk = trailMetaKey(k);
      const meta = (await readJson(mk)) ?? { ...k, count: 0, lastT: null, uploaded: {} };
      const fresh = [];
      let lastT = meta.lastT;
      for (const p of points) {
        if (!p || !Number.isFinite(p.t)) continue;
        if (lastT != null && p.t <= lastT) continue;
        if (meta.count + fresh.length >= MAX_POINTS_PER_ROUND) break;
        fresh.push(p);
        lastT = p.t;
      }
      if (!fresh.length) return 0;
      const writes = [];
      let count = meta.count;
      let i = 0;
      while (i < fresh.length) {
        const seq = Math.floor(count / CHUNK_SIZE);
        const offset = count % CHUNK_SIZE;
        const part = fresh.slice(i, i + (CHUNK_SIZE - offset));
        const tail = offset ? ((await readJson(trailChunkKey(mk, seq))) ?? []) : [];
        writes.push([trailChunkKey(mk, seq), JSON.stringify([...tail, ...part])]);
        i += part.length;
        count += part.length;
      }
      writes.push([mk, JSON.stringify({ ...meta, count, lastT })]);
      await AsyncStorage.multiSet(writes);
      return fresh.length;
    } catch {
      return 0;
    }
  });
}

// The hook point: lib/roundTracking's location task hands every batch of
// fixes here. Records only while a live round is active and the setting is on.
export async function recordTrailFixes(locations) {
  try {
    if (!locations?.length) return 0;
    const key = await getActiveTrailRound();
    if (!key) return 0;
    if (!(await isTrailRecordingEnabled())) return 0;
    return await appendTrailPoints(key, locations.map(toTrailPoint).filter(Boolean));
  } catch {
    return 0;
  }
}

// ---- Upload -----------------------------------------------------------------

const chunkLength = (count, seq) => Math.max(0, Math.min(CHUNK_SIZE, count - seq * CHUNK_SIZE));

async function flushRound(mk, userId) {
  let uploaded = 0;
  // Snapshot the chunks that grew since their last upload.
  const todo = await serial(async () => {
    const meta = await readJson(mk);
    if (!meta || (meta.userId && meta.userId !== userId)) return []; // another account's trail
    const out = [];
    const last = Math.ceil(meta.count / CHUNK_SIZE);
    for (let seq = 0; seq < last; seq += 1) {
      const len = chunkLength(meta.count, seq);
      if ((meta.uploaded?.[seq] ?? 0) >= len) continue;
      const points = await readJson(trailChunkKey(mk, seq));
      if (points?.length) out.push({ meta, seq, points });
    }
    return out;
  });
  for (const { meta, seq, points } of todo) {
    let error;
    try {
      ({ error } = await supabase.from(TABLE).upsert({
        user_id: userId,
        tournament_id: meta.tournamentId,
        round_id: meta.roundId,
        round_index: meta.roundIndex,
        seq,
        points,
      }, { onConflict: 'user_id,tournament_id,round_id,round_index,seq' }));
    } catch (e) {
      error = e;
    }
    if (error) return { uploaded, failed: true }; // offline: stays pending
    uploaded += 1;
    await serial(async () => {
      const m = await readJson(mk);
      if (!m) return;
      m.uploaded = { ...m.uploaded, [seq]: Math.max(m.uploaded?.[seq] ?? 0, points.length) };
      await AsyncStorage.setItem(mk, JSON.stringify(m));
      // A full chunk never changes again — the server copy is enough.
      if (points.length >= CHUNK_SIZE) await AsyncStorage.removeItem(trailChunkKey(mk, seq));
    });
  }
  return { uploaded, failed: false };
}

let flushing = null;

// Uploads every unsent chunk of every recorded round for the signed-in user.
// Concurrent calls share one run. Resolves to `{ uploaded, failed }` (chunks
// uploaded, whether anything stayed pending); never throws.
export function flushTrails() {
  if (!flushing) {
    flushing = (async () => {
      const result = { uploaded: 0, failed: false };
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (!userId) return result;
        const keys = (await AsyncStorage.getAllKeys()).filter(isMetaKey);
        for (const mk of keys) {
          const r = await flushRound(mk, userId);
          result.uploaded += r.uploaded;
          result.failed = result.failed || r.failed;
        }
      } catch {
        result.failed = true;
      }
      return result;
    })().finally(() => { flushing = null; });
  }
  return flushing;
}

let appStateSub = null;

// App boot: upload what an earlier run left pending, and again every time the
// app comes back to the foreground. Idempotent.
export function startGpsTrailSync() {
  flushTrails();
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushTrails();
    });
  }
}

export function __resetGpsTrailForTests() {
  chain = Promise.resolve();
  active = null;
  activeLoaded = false;
  mirror = null;
  flushing = null;
  appStateSub?.remove?.();
  appStateSub = null;
}
