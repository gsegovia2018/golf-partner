import { readShotSenseEvents } from '../lib/shotSense';
import { soundIndex } from './shotSound';

// Per-round cache of the shot listener's events (lib/shotSense), as the
// soundIndex the scorecard's levels need (store/shotSound).

const indexes = new Map(); // session -> soundIndex
const reading = new Map(); // session -> Promise
let version = 0;
const listeners = new Set();
const EMPTY = { strikes: [], spans: [] };

export function subscribeShotSound(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getShotSoundVersion() { return version; }
export function getShotSoundIndex(session) { return indexes.get(session) ?? EMPTY; }

// Re-reads a session's events (they grow while the round is played). One read
// at a time per session; resolves when it is in. Never throws.
export function refreshShotSound(session) {
  if (session == null) return Promise.resolve();
  if (reading.has(session)) return reading.get(session);
  const job = readShotSenseEvents(session).then((events) => {
    const prev = indexes.get(session);
    const last = events[events.length - 1]?.t ?? null;
    const prevLast = prev?.last ?? null;
    if (!prev || prev.count !== events.length || prevLast !== last) {
      indexes.set(session, { ...soundIndex(events), count: events.length, last });
      version += 1;
      listeners.forEach((l) => l());
    }
  }).finally(() => reading.delete(session));
  reading.set(session, job);
  return job;
}

export function __resetShotSoundForTests() {
  indexes.clear();
  reading.clear();
  listeners.clear();
  version = 0;
}
