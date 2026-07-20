// Per-course satellite tile cache. Buckets keep deletion/eviction simple:
// one bucket per course (courseKeyFor), plus '_browse' for tiles fetched
// outside any prefetch. Best-effort by design — every failure path returns
// null and the flyover's vector layer covers for missing imagery.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const TILE_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const MAX_CACHE_BYTES = 150 * 1024 * 1024;
const INDEX_KEY = 'tileCacheIndex.v1'; // { buckets: { [bucket]: { bytes, lastUsed } } }

export function courseKeyFor(courseName) {
  return String(courseName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '_unknown';
}

// ---------- storage adapters ----------
function makeWebAdapter() {
  const cacheName = (bucket) => `tiles:${bucket}`;
  const req = (key) => `https://tiles.local/${key}`; // synthetic Request key
  return {
    async get(bucket, key) {
      try {
        const c = await caches.open(cacheName(bucket));
        const r = await c.match(req(key));
        return r ? await r.text() : null; // stored as data-URL text
      } catch { return null; }
    },
    async put(bucket, key, dataUrl) {
      try {
        const c = await caches.open(cacheName(bucket));
        await c.put(req(key), new Response(dataUrl));
        return dataUrl.length;
      } catch { return 0; }
    },
    async deleteBucket(bucket) {
      try { await caches.delete(cacheName(bucket)); } catch { /* best effort */ }
    },
  };
}

function makeNativeAdapter() {
  // Lazy require keeps web bundles clean; legacy API for a stable surface.
  const FileSystem = require('expo-file-system/legacy');
  const dir = (bucket) => `${FileSystem.documentDirectory}tiles/${bucket}/`;
  const path = (bucket, key) => `${dir(bucket)}${key.replace(/\//g, '_')}.txt`;
  return {
    async get(bucket, key) {
      try { return await FileSystem.readAsStringAsync(path(bucket, key)); } catch { return null; }
    },
    async put(bucket, key, dataUrl) {
      try {
        await FileSystem.makeDirectoryAsync(dir(bucket), { intermediates: true }).catch(() => {});
        await FileSystem.writeAsStringAsync(path(bucket, key), dataUrl);
        return dataUrl.length;
      } catch { return 0; }
    },
    async deleteBucket(bucket) {
      try { await FileSystem.deleteAsync(dir(bucket), { idempotent: true }); } catch { /* best effort */ }
    },
  };
}

let adapter = null;
function getAdapter() {
  if (!adapter) adapter = Platform.OS === 'web' ? makeWebAdapter() : makeNativeAdapter();
  return adapter;
}

// ---------- index (sizes + recency for eviction) ----------
let indexCache = null;
async function loadIndex() {
  if (indexCache) return indexCache;
  try { indexCache = JSON.parse(await AsyncStorage.getItem(INDEX_KEY)) || { buckets: {} }; }
  catch { indexCache = { buckets: {} }; }
  if (!indexCache.buckets) indexCache.buckets = {};
  return indexCache;
}
async function saveIndex() {
  try { await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(indexCache)); } catch { /* best effort */ }
}
async function touchBucket(bucket, addBytes) {
  const idx = await loadIndex();
  const b = idx.buckets[bucket] || (idx.buckets[bucket] = { bytes: 0, lastUsed: 0 });
  b.bytes += addBytes;
  b.lastUsed = Date.now();
  await saveIndex();
  if (addBytes > 0) await maybeEvict(bucket);
}
async function maybeEvict(keepBucket) {
  const idx = await loadIndex();
  let total = Object.values(idx.buckets).reduce((s, b) => s + b.bytes, 0);
  if (total <= MAX_CACHE_BYTES) return;
  // '_browse' goes first, then least-recently-used courses; never evict the
  // bucket currently being written.
  const order = Object.keys(idx.buckets).filter((k) => k !== keepBucket).sort((a, b) => {
    if (a === '_browse') return -1;
    if (b === '_browse') return 1;
    return idx.buckets[a].lastUsed - idx.buckets[b].lastUsed;
  });
  for (const bucket of order) {
    if (total <= MAX_CACHE_BYTES) break;
    total -= idx.buckets[bucket].bytes;
    await getAdapter().deleteBucket(bucket);
    delete idx.buckets[bucket];
  }
  await saveIndex();
}

// ---------- fetch + encode ----------
const failedThisSession = new Set(); // 'z/x/y' — no retry storms while offline
async function fetchTileDataUrl(z, x, y) {
  const res = await fetch(TILE_URL(z, x, y));
  if (!res.ok) throw new Error(`tile ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = typeof btoa === 'function' ? btoa(bin) : global.Buffer.from(bin, 'binary').toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}

// ---------- public API ----------
const inFlight = new Map(); // '${bucket}|${z}/${x}/${y}' -> Promise<string|null>
export async function getTileDataUrl({ z, x, y, bucket = '_browse' }) {
  const key = `${z}/${x}/${y}`;
  const hit = await getAdapter().get(bucket, key);
  if (hit) { touchBucket(bucket, 0); return hit; }
  if (failedThisSession.has(key)) return null;
  const flightKey = `${bucket}|${key}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const dataUrl = await fetchTileDataUrl(z, x, y);
      const bytes = await getAdapter().put(bucket, key, dataUrl);
      await touchBucket(bucket, bytes);
      return dataUrl;
    } catch {
      failedThisSession.add(key);
      return null;
    }
  })();
  inFlight.set(flightKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(flightKey);
  }
}

export async function ensureTile({ z, x, y, bucket }) {
  return (await getTileDataUrl({ z, x, y, bucket })) != null;
}

export async function deleteBucket(bucket) {
  await getAdapter().deleteBucket(bucket);
  const idx = await loadIndex();
  delete idx.buckets[bucket];
  await saveIndex();
}

// ---------- test seams ----------
export function _setAdapterForTests(a) { adapter = a; }
export function _resetForTests() {
  adapter = null;
  indexCache = null;
  failedThisSession.clear();
  inFlight.clear();
}
