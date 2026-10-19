import AsyncStorage from '@react-native-async-storage/async-storage';
import { findCourseGeometry } from '../lib/geo';
import { isOnline } from '../lib/connectivity';
import { ensureCourseGeometry } from './courseGeometryStore';

// Hourly weather per course from Open-Meteo (free, keyless, CC BY 4.0 — the
// app credits it in Your bag). Fetched ahead of play — when a game or round is
// created, when the active game loads, when a scorecard or hole map opens — and
// kept in AsyncStorage, so a round on a course with no signal still has its
// forecast. Never blocks and never throws: no forecast means callers fall back
// to the month estimate. Shaped for useSyncExternalStore (subscribe/version).

const API = 'https://api.open-meteo.com/v1/forecast';
const cacheKey = (key) => `weather.v1.${key}`;
export const FRESH_MS = 2.5 * 3600e3; // refetch after this, when online
const HOUR_SLACK_MS = 90 * 60e3; // an hourly value stands for ±90 min around it
const TIMEOUT_MS = 8000;

const mem = new Map(); // course key -> { fetchedAt, elevationM, hours: [{ t, tempC, windKmh, windFromDeg, gustKmh }] }
const cacheRead = new Set();
const inFlight = new Map();
const listeners = new Set();
let version = 0;
const bump = () => { version += 1; listeners.forEach((l) => l()); };

export function subscribeWeather(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getWeatherVersion() {
  return version;
}

// Any [lat, lng] on the course: a hole's tee or green, or a greens-mode green.
export function coursePoint(course) {
  for (const h of course?.holes ?? []) {
    const p = h.start ?? h.greenCenter ?? h.green?.[0];
    if (Array.isArray(p)) return p;
  }
  const g = course?.greens?.[0]?.[0];
  return Array.isArray(g) ? g : null;
}

// Open-Meteo JSON -> our entry, or null when it isn't the shape we asked for.
export function parseForecast(json, fetchedAt) {
  const h = json?.hourly;
  if (!Array.isArray(h?.time)) return null;
  const hours = h.time.map((t, i) => ({
    t: t * 1000,
    tempC: h.temperature_2m?.[i],
    windKmh: h.wind_speed_10m?.[i],
    windFromDeg: h.wind_direction_10m?.[i],
    gustKmh: h.wind_gusts_10m?.[i],
  })).filter((x) => Number.isFinite(x.tempC) && Number.isFinite(x.windKmh) && Number.isFinite(x.windFromDeg));
  if (!hours.length) return null;
  return { fetchedAt, elevationM: Number.isFinite(json.elevation) ? json.elevation : null, hours };
}

async function readCache(key) {
  if (cacheRead.has(key)) return;
  cacheRead.add(key);
  try {
    const raw = await AsyncStorage.getItem(cacheKey(key));
    const entry = raw ? JSON.parse(raw) : null;
    if (entry?.hours?.length && !(mem.get(key)?.fetchedAt >= entry.fetchedAt)) {
      mem.set(key, entry);
      bump();
    }
  } catch {
    // corrupt cache: refetched when online
  }
}

async function fetchForecast([lat, lng]) {
  const url = `${API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
    + '&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
    + '&past_hours=1&forecast_hours=24&timeformat=unixtime';
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) return null; // Open-Meteo answers 503 "overloaded" now and then
    return parseForecast(await res.json(), Date.now());
  } finally {
    clearTimeout(timer);
  }
}

// Make sure a course has a recent forecast: cache first, then Open-Meteo when
// online and the cached one is older than FRESH_MS. Resolves when done.
export function prefetchWeather(courseName) {
  const entry = courseName ? findCourseGeometry(courseName) : null;
  if (!entry) return Promise.resolve();
  const key = entry.key;
  if (inFlight.has(key)) return inFlight.get(key);
  const run = (async () => {
    try {
      await readCache(key);
      const have = mem.get(key);
      if ((have && Date.now() - have.fetchedAt < FRESH_MS) || !isOnline()) return;
      const course = coursePoint(entry) ? entry : await ensureCourseGeometry(key);
      const pt = coursePoint(course);
      if (!pt) return;
      const next = await fetchForecast(pt);
      if (!next) return;
      mem.set(key, next);
      bump();
      await AsyncStorage.setItem(cacheKey(key), JSON.stringify(next));
    } catch {
      // offline / timeout / storage error: keep what we have
    }
  })();
  inFlight.set(key, run);
  run.finally(() => inFlight.delete(key));
  return run;
}

// Load a course's stored forecast without touching the network (screens that
// list courses, like Your bag, show what is cached but never fetch for all).
export function loadCachedWeather(courseName) {
  const entry = courseName ? findCourseGeometry(courseName) : null;
  return entry ? readCache(entry.key) : Promise.resolve();
}

// Fire-and-forget prefetch for every course of a game (or one round), only
// while the player uses playing conditions (nothing else reads it yet).
export function prefetchWeatherForRounds(rounds) {
  // Lazy: settingsStore pulls in profileStore, which tournamentStore must not load eagerly.
  const { getAppSettings } = require('./settingsStore');
  if (!getAppSettings().conditionsEnabled) return;
  const names = new Set((rounds ?? []).map((r) => r?.courseName).filter(Boolean));
  names.forEach((n) => { prefetchWeather(n); });
}

// Conditions at `now` for a course from what is loaded, or null: the hourly
// value nearest to now, if one is within 90 min. `fresh` says whether it was
// fetched within FRESH_MS (otherwise it is an older forecast, used offline).
export function weatherAt(courseName, now = Date.now()) {
  const entry = courseName ? findCourseGeometry(courseName) : null;
  const w = entry ? mem.get(entry.key) : null;
  if (!w) return null;
  let best = null;
  for (const h of w.hours) {
    if (!best || Math.abs(h.t - now) < Math.abs(best.t - now)) best = h;
  }
  if (!best || Math.abs(best.t - now) > HOUR_SLACK_MS) return null;
  return {
    tempC: best.tempC,
    windKmh: best.windKmh,
    windFromDeg: best.windFromDeg,
    gustKmh: Number.isFinite(best.gustKmh) ? best.gustKmh : null,
    elevationM: w.elevationM,
    fetchedAt: w.fetchedAt,
    fresh: now - w.fetchedAt < FRESH_MS,
  };
}

export function _resetForTests() {
  mem.clear();
  cacheRead.clear();
  inFlight.clear();
  version = 0;
}
