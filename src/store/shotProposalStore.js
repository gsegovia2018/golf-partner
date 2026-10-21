import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveTrailRound, isTrailRecordingEnabled, toTrailPoint } from './gpsTrailStore';
import { takeClosedStops, seqForProposal } from './shotDetection';
import { extendWalk } from '../lib/gpsTrailStops';
import { shotsForHole, insertShotAt, logShot } from './shotStore';

// Automatic shot detection, stateful half. Fed by lib/roundTracking's location
// task with every batch of fixes; gated exactly like the GPS trail experiment
// (the "Record GPS trail (test)" setting and an active live round of the
// signed-in player — see gpsTrailStore), so it only runs on Android.
//
// Per round it keeps the detected stops and the golfer's answer to each:
// `{ id, start, end, lat, lng, hole, status: 'open'|'added'|'dismissed', shotId? }`,
// persisted under PROPOSALS_PREFIX + `<roundId>|<roundIndex>` (on web that is
// localStorage, which is also how the proposals are seeded for testing).
// Confirming writes a normal shot through shotStore. Raw fixes stay in memory;
// a thinned copy of them (one point every WALK_STEP_M) is kept per round under
// WALK_PREFIX as the walk the hole map draws.
// shortcut: the open (not yet closed) stop is lost if Android kills the process
// mid-stop; persist the buffer if device tests show that happening.

export const PROPOSALS_PREFIX = '@shot_proposals/';
export const WALK_PREFIX = '@shot_walk/';
export const MAX_WALK_POINTS = 6000; // ~30 km at 5 m spacing: a round and then some
export const MAX_BUFFER = 2000; // ~1 h of fixes at the tracker's 2 s / 2 m cadence
const EMPTY = [];

export const proposalRoundKey = (roundId, roundIndex) => `${roundId}|${roundIndex}`;

const rounds = new Map(); // roundKey -> stops[]
const walks = new Map(); // roundKey -> [[lat,lng],...]
const loaded = new Map(); // roundKey -> Promise
let buffer = [];
let bufferKey = null;
let holeNow = null;
let version = 0;
const listeners = new Set();

function emit() { version += 1; listeners.forEach((l) => l()); }
export function subscribeShotProposals(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getShotProposalsVersion() { return version; }
export function getRoundStops(roundId, roundIndex) {
  return rounds.get(proposalRoundKey(roundId, roundIndex)) ?? EMPTY;
}
export function getRoundWalk(roundId, roundIndex) {
  return walks.get(proposalRoundKey(roundId, roundIndex)) ?? EMPTY;
}

let chain = Promise.resolve();
function serial(job) {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

// Reads a round's stored proposals into memory (once). Never throws.
export function loadShotProposals(roundId, roundIndex) {
  const key = proposalRoundKey(roundId, roundIndex);
  if (!loaded.has(key)) {
    loaded.set(key, (async () => {
      try {
        const raw = await AsyncStorage.getItem(PROPOSALS_PREFIX + key);
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored) && !rounds.has(key)) {
          rounds.set(key, stored);
          emit();
        }
      } catch { /* corrupt or missing: start empty */ }
      try {
        const raw = await AsyncStorage.getItem(WALK_PREFIX + key);
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored) && !walks.has(key)) {
          walks.set(key, stored);
          emit();
        }
      } catch { /* corrupt or missing: start empty */ }
    })());
  }
  return loaded.get(key);
}

async function save(key, stops) {
  rounds.set(key, stops);
  emit();
  try { await AsyncStorage.setItem(PROPOSALS_PREFIX + key, JSON.stringify(stops)); } catch { /* memory still has it */ }
}

// The scorecard's current hole, stamped on stops for courses with no geometry.
export function setDetectionHole(holeNumber) { holeNow = Number.isInteger(holeNumber) ? holeNumber : null; }

// The hook point: lib/roundTracking hands every batch of fixes here. Resolves
// to the number of new proposals; never throws.
export function feedShotDetection(locations) {
  if (!locations?.length) return Promise.resolve(0);
  return serial(async () => {
    try {
      const active = await getActiveTrailRound();
      if (!active || !(await isTrailRecordingEnabled())) return 0;
      const key = proposalRoundKey(active.roundId, active.roundIndex);
      if (bufferKey !== key) { buffer = []; bufferKey = key; }
      const points = locations.map(toTrailPoint).filter(Boolean);
      buffer = buffer.concat(points).slice(-MAX_BUFFER);
      const { stops, rest } = takeClosedStops(buffer);
      buffer = rest;
      await loadShotProposals(active.roundId, active.roundIndex);
      await saveWalk(key, extendWalk(walks.get(key), points).slice(-MAX_WALK_POINTS), { force: stops.length > 0 });
      if (!stops.length) return 0;
      const fresh = stops.map((s) => ({
        id: String(s.start), start: s.start, end: s.end, lat: s.lat, lng: s.lng, hole: holeNow, status: 'open',
      }));
      await save(key, [...(rounds.get(key) ?? []), ...fresh]);
      return fresh.length;
    } catch {
      return 0;
    }
  });
}

// The walk grows by a point every few metres while you move, so it is written
// to storage every WALK_PERSIST_EVERY points (and whenever a stop closes)
// rather than on every batch of fixes.
const WALK_PERSIST_EVERY = 20;
const walkPersisted = new Map(); // roundKey -> length last written
async function saveWalk(key, walk, { force = false } = {}) {
  const prev = walks.get(key);
  const grew = !prev || walk[walk.length - 1] !== prev[prev.length - 1];
  if (grew) { walks.set(key, walk); emit(); }
  if (!force && !(grew && walk.length - (walkPersisted.get(key) ?? 0) >= WALK_PERSIST_EVERY)) return;
  walkPersisted.set(key, walk.length);
  try { await AsyncStorage.setItem(WALK_PREFIX + key, JSON.stringify(walk)); } catch { /* memory still has it */ }
}

function update(roundId, roundIndex, id, patch) {
  const key = proposalRoundKey(roundId, roundIndex);
  const stops = rounds.get(key) ?? [];
  return save(key, stops.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export function dismissProposal(roundId, roundIndex, id) {
  return serial(() => update(roundId, roundIndex, id, { status: 'dismissed' }));
}

// Confirms proposals on one hole, oldest first, each slotted into the shot
// chain by distance to `green` (see seqForProposal). `clubFor(proposal)` gives
// the club to tag. Resolves to the shots it created, oldest first.
export function confirmProposals({ roundId, roundIndex, holeNumber, proposals, green = null, clubFor = () => null }) {
  return serial(async () => {
    const created = [];
    for (const p of [...proposals].sort((a, b) => a.start - b.start)) {
      // Re-read: a second confirm queued behind this one must not add it twice.
      if (getRoundStops(roundId, roundIndex).find((s) => s.id === p.id)?.status !== 'open') continue;
      const seq = seqForProposal(p, shotsForHole(roundId, roundIndex, holeNumber), green);
      const shot = await insertShotAt({
        roundId, roundIndex, holeNumber, seq, pos: [p.lat, p.lng], club: clubFor(p),
      });
      await update(roundId, roundIndex, p.id, { status: 'added', shotId: shot?.id ?? null });
      if (shot) created.push(shot);
    }
    return created;
  });
}

// Ends an open hole on its green at `stop` (shotDetection.greenLandingStop):
// a spot with no club there, so the approach gets its real landing. The stop
// is marked used, so it is never added twice, nor again after the spot is
// deleted. Resolves to the new shot, or null when the stop was already used.
export function closeHoleOnGreen({ roundId, roundIndex, holeNumber, stop }) {
  return serial(async () => {
    if (getRoundStops(roundId, roundIndex).find((s) => s.id === stop.id)?.status !== 'open') return null;
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos: [stop.lat, stop.lng], club: null });
    await update(roundId, roundIndex, stop.id, { status: 'added', shotId: shot?.id ?? null });
    return shot;
  });
}

// Marks a stop as used by a shot written elsewhere (a measured shot split
// at it), so it isn't offered as "seen" too.
export function markProposalAdded(roundId, roundIndex, id, shotId = null) {
  return serial(() => update(roundId, roundIndex, id, { status: 'added', shotId }));
}

export function __resetShotProposalsForTests() {
  rounds.clear();
  walks.clear();
  walkPersisted.clear();
  loaded.clear();
  buffer = [];
  bufferKey = null;
  holeNow = null;
  chain = Promise.resolve();
}
