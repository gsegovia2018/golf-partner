import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveTrailRound, isTrailRecordingEnabled, toTrailPoint } from './gpsTrailStore';
import { takeClosedStops, seqForProposal } from './shotDetection';
import { shotsForHole, insertShotAt, deleteShot } from './shotStore';

// Automatic shot detection, stateful half. Fed by lib/roundTracking's location
// task with every batch of fixes; gated exactly like the GPS trail experiment
// (the "Record GPS trail (test)" setting and an active live round of the
// signed-in player — see gpsTrailStore), so it only runs on Android.
//
// Per round it keeps the detected stops and the golfer's answer to each:
// `{ id, start, end, lat, lng, hole, status: 'open'|'added'|'dismissed', shotId? }`,
// persisted under PROPOSALS_PREFIX + `<roundId>|<roundIndex>` (on web that is
// localStorage, which is also how the proposals are seeded for testing).
// Confirming writes a normal shot through shotStore. Raw fixes stay in memory.
// shortcut: the open (not yet closed) stop is lost if Android kills the process
// mid-stop; persist the buffer if device tests show that happening.

export const PROPOSALS_PREFIX = '@shot_proposals/';
export const MAX_BUFFER = 2000; // ~1 h of fixes at the tracker's 2 s / 2 m cadence
const EMPTY = [];

// shortcut: dev-only switch between the three review UIs while Marcos picks
// one ('A' map pins, 'B' hole card, 'C' header strip). Delete with the losers.
export const PROPOSAL_UI_KEY = '@shot_proposals_ui';
let ui = 'B';
export const getProposalUi = () => ui;

export const proposalRoundKey = (roundId, roundIndex) => `${roundId}|${roundIndex}`;

const rounds = new Map(); // roundKey -> stops[]
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
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          const v = await AsyncStorage.getItem(PROPOSAL_UI_KEY);
          if (v === 'A' || v === 'B' || v === 'C') ui = v;
        }
        const raw = await AsyncStorage.getItem(PROPOSALS_PREFIX + key);
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored) && !rounds.has(key)) {
          rounds.set(key, stored);
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
      buffer = buffer.concat(locations.map(toTrailPoint).filter(Boolean)).slice(-MAX_BUFFER);
      const { stops, rest } = takeClosedStops(buffer);
      buffer = rest;
      if (!stops.length) return 0;
      await loadShotProposals(active.roundId, active.roundIndex);
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
// the club to tag (a guess the golfer can change on the map).
export function confirmProposals({ roundId, roundIndex, holeNumber, proposals, green = null, clubFor = () => null }) {
  return serial(async () => {
    for (const p of [...proposals].sort((a, b) => a.start - b.start)) {
      // Re-read: a second confirm queued behind this one must not add it twice.
      if (getRoundStops(roundId, roundIndex).find((s) => s.id === p.id)?.status !== 'open') continue;
      const seq = seqForProposal(p, shotsForHole(roundId, roundIndex, holeNumber), green);
      const shot = await insertShotAt({
        roundId, roundIndex, holeNumber, seq, pos: [p.lat, p.lng], club: clubFor(p),
      });
      await update(roundId, roundIndex, p.id, { status: 'added', shotId: shot?.id ?? null });
    }
  });
}

// Takes an added proposal back out of the shot log; it is open again.
export function undoProposal(roundId, roundIndex, id) {
  return serial(async () => {
    const p = getRoundStops(roundId, roundIndex).find((s) => s.id === id);
    if (!p) return;
    if (p.shotId) await deleteShot(p.shotId);
    await update(roundId, roundIndex, id, { status: 'open', shotId: null });
  });
}

export function __resetShotProposalsForTests() {
  rounds.clear();
  loaded.clear();
  buffer = [];
  bufferKey = null;
  holeNow = null;
  ui = 'B';
  chain = Promise.resolve();
}
