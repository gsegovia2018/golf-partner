// Replication of the card store against Supabase (plan §4).
//
// One singleton for the whole app, because push spans every live game while
// the realtime channel follows only the open one (plan §10, S14).
//
// Guarantees this module owes the rest of the system:
//   - A card row is the atomic unit. It is upserted whole, so a retry re-sends
//     the whole card and the server never holds half a hole (R7, S7).
//   - Nothing is ever dropped. A failed write stays pending, keeps its error,
//     and is retried with exponential backoff until it lands (R8).
//   - My own row is authoritative locally: a pulled row whose author_id is
//     mine is ignored, so a stale server echo can never overwrite what this
//     device published (R6, S11).
//   - A pending resolution survives a pull. Only after it has been pushed does
//     the server copy replace it — and what lands then is whichever agreement
//     the server kept, so two phones agreeing one cell at different values
//     converge on one of them instead of each showing its own (FIRST valid
//     agreement wins; see put_score_resolution).

import { isOnline, subscribeConnectivity } from '../../lib/connectivity';
import { supabase } from '../../lib/supabase';
import { captureException } from '../../lib/errorReporting';
import { getDeviceAuthorId, initDeviceAuthorId } from '../../store/deviceId';
import { applyRound, dropRound, knownRounds } from './roundState';
import { getCardStorage } from './storage';

const CARDS_TABLE = 'scorer_cards';
const RESOLUTIONS_TABLE = 'score_resolutions';
const CARDS_CONFLICT = 'tournament_id,round_id,author_id';

const PUSH_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
const LIVE_BACKOFF_CAP_MS = 30000;

// A card can outrun its own setup. `scorer_cards` has no FK, but the
// projection trigger writes `game_scores`, which is keyed on `game_rounds` —
// so a card published before the setup queue landed its round row is rejected
// with 23503, and one published before the tournaments row exists is rejected
// by RLS with 42501. Neither is a fault the scorer can act on and both clear
// themselves once the setup queue drains, so the sync sheet stays quiet for
// this long before it calls it an error.
const BLOCKED_BY_SETUP_CODES = new Set(['23503', '42501']);
const BLOCKED_GRACE_MS = 5 * 60 * 1000;

const isBlockedBySetup = (error) => BLOCKED_BY_SETUP_CODES.has(String(error?.code ?? ''));

let _client = supabase;

let _pushInFlight = null;
let _lastError = null;

// Per tournament, because a tournament that cannot push must not slow down or
// speak for any other one (S14): shared attempt counters pinned every game's
// retry at the 60 s cap as soon as one game was stuck, and a shared last-error
// showed one game's failure on all of them.
//
//   tid -> { attempts, lastError, failed, remaining, blockedSince, timer }
//
// `blockedSince` is the moment this tournament FIRST failed with nothing but
// blocked-by-setup errors, and is cleared by any other failure or by success.
const _tidState = new Map();
const _pushInFlightByTid = new Map();

function tidState(tid) {
  let rec = _tidState.get(tid);
  if (!rec) {
    rec = { attempts: 0, lastError: null, failed: false, remaining: false, blockedSince: null, timer: null };
    _tidState.set(tid, rec);
  }
  return rec;
}

let _status = 'idle';
const _statusSubs = new Set();
const _syncedSubs = new Set();

let _started = false;
let _unsubConnectivity = null;

let _channel = null;
let _liveTid = null;
let _liveAttempts = 0;
let _liveTimer = null;

// --- status -----------------------------------------------------------------

function setStatus(next) {
  if (_status === next) return;
  _status = next;
  for (const cb of [..._statusSubs]) {
    try { cb(_status); } catch { /* one bad subscriber must not stop the rest */ }
  }
}

/** 'idle' | 'pending' | 'syncing' | 'error' */
export function getSyncStatus() {
  return _status;
}

export function subscribeSyncStatus(cb) {
  _statusSubs.add(cb);
  return () => _statusSubs.delete(cb);
}

/**
 * The last write/read failure, `{ message, code }`, or null.
 *
 * With a `tid`, the failure of THAT tournament — which is what a screen showing
 * one game wants; without one, the most recent failure from anywhere.
 */
export function getLastError(tid) {
  if (tid == null) return _lastError;
  return _tidState.get(tid)?.lastError ?? null;
}

function noteError(error, context = {}) {
  const entry = {
    message: error?.message != null ? String(error.message) : String(error),
    code: error?.code ?? null,
  };
  _lastError = entry;
  if (context.tid != null) tidState(context.tid).lastError = entry;
  captureException(error, { scope: 'cards.replicator', ...context });
}

/** Status is derived, never assigned: it is whatever the per-tid records say. */
function computeStatus(now = Date.now()) {
  let error = false;
  let waiting = false;
  let pending = false;
  for (const rec of _tidState.values()) {
    if (rec.failed) {
      pending = true;
      if (rec.blockedSince != null && now - rec.blockedSince < BLOCKED_GRACE_MS) waiting = true;
      else error = true;
    } else if (rec.remaining) {
      pending = true;
    }
  }
  if (error) return 'error';
  // Still failing, but only on setup that has not landed yet: keep calling it
  // syncing until the grace window is up. Re-evaluated on every retry, so the
  // flip to 'error' happens within one backoff tick of the threshold.
  if (waiting) return 'syncing';
  return pending ? 'pending' : 'idle';
}

function refreshStatus() {
  let anyFailing = false;
  for (const rec of _tidState.values()) if (rec.failed) { anyFailing = true; break; }
  if (!anyFailing) _lastError = null;
  setStatus(computeStatus());
}

/** Emitted after a reconnect has pushed and pulled — the screen's cue to
 *  open one batched discrepancy sheet rather than one per arriving row. */
export function onSynced(cb) {
  _syncedSubs.add(cb);
  return () => _syncedSubs.delete(cb);
}

function emitSynced(payload) {
  for (const cb of [..._syncedSubs]) {
    try { cb(payload); } catch { /* ignore */ }
  }
}

// --- push -------------------------------------------------------------------

function rowsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Does this round still exist for the app? `true`/`false` are answers;
 * anything else (no cached tournament, a resolver that threw) means "unknown",
 * and unknown always keeps the card — never destroy scores on a guess.
 *
 * The default reads the setup store lazily so the engine keeps no import edge
 * onto it (tournamentRepo imports back into here). Swap it with
 * `setRoundExistsResolver` from tests or from the app.
 */
function defaultRoundExists(tid, roundId) {
  try {
    const { getTournamentSnapshot } = require('../../store/tournamentStore');
    const tournament = getTournamentSnapshot(tid);
    if (!tournament || !Array.isArray(tournament.rounds)) return null;
    return tournament.rounds.some((r) => r?.id === roundId);
  } catch {
    return null;
  }
}

let _roundExists = defaultRoundExists;

/** Override how the replicator decides a round is gone. Pass null to restore. */
export function setRoundExistsResolver(fn) {
  _roundExists = fn ?? defaultRoundExists;
}

async function roundIsGone(tid, roundId) {
  try {
    return (await _roundExists(tid, roundId)) === false;
  } catch {
    return false;
  }
}

async function pushCards(tid, myAuthorId, rounds) {
  const store = getCardStorage();
  let failed = false;
  let remaining = false;
  let blocked = false;
  let hardFailed = false;
  const dropped = new Set();

  for (const roundId of rounds) {
    const mine = await store.getMine(tid, roundId);
    if (!mine?.pending) continue;

    // The whole card, every time: a partial retry is exactly the failure mode
    // this design exists to remove.
    const row = { tournament_id: tid, round_id: roundId, author_id: myAuthorId, card: mine.card };
    const { error } = await _client.from(CARDS_TABLE).upsert(row, { onConflict: CARDS_CONFLICT });
    if (error) {
      if (isBlockedBySetup(error) && (await roundIsGone(tid, roundId))) {
        // The round was deleted — here or on another phone. No retry will ever
        // be accepted, so keeping the card pending would fail forever and hold
        // the whole game in 'pending'. Reported, not surfaced: this is a
        // handled outcome, not an error the scorer can do anything about.
        captureException(error, { scope: 'cards.replicator', table: CARDS_TABLE, tid, roundId, dropped: true });
        await dropRound(tid, roundId);
        dropped.add(roundId);
        continue;
      }
      failed = true;
      remaining = true;
      if (isBlockedBySetup(error)) blocked = true;
      else hardFailed = true;
      noteError(error, { table: CARDS_TABLE, tid, roundId });
      continue;
    }

    const cleared = await store.withTid(tid, async () => {
      const cur = await store.getMine(tid, roundId);
      // A publish that landed while this upsert was in flight is a NEWER
      // version that has not been sent — leave it pending.
      if (!cur?.pending || !rowsEqual(cur.card, mine.card)) return false;
      await store.setMine(tid, roundId, { card: cur.card, pending: false });
      return true;
    });
    if (cleared) applyRound(tid, roundId, { minePending: false });
    else remaining = true;
  }

  return { failed, remaining, blocked, hardFailed, dropped };
}

async function pushResolutions(tid, dropped = new Set()) {
  const store = getCardStorage();
  const all = await store.getResolutions(tid);
  let failed = false;
  let remaining = false;
  let blocked = false;
  let hardFailed = false;

  roundLoop:
  for (const [roundId, byPlayer] of Object.entries(all)) {
    if (dropped.has(roundId)) continue;
    for (const [playerId, byHole] of Object.entries(byPlayer ?? {})) {
      for (const [hole, resolution] of Object.entries(byHole ?? {})) {
        if (!resolution?.pending) continue;
        // put_score_resolution, not a plain upsert: two phones agreeing the
        // same cell at different values would otherwise both stick, each
        // showing its own tick. The RPC keeps the FIRST agreement made off a
        // given basis and hands back whichever row now stands, so the loser
        // adopts the winner instead of insisting (see the 20260906 migration).
        const { data, error } = await _client.rpc('put_score_resolution', {
          p_tournament_id: tid,
          p_round_id: roundId,
          p_player_id: playerId,
          p_hole: Number(hole),
          p_value: resolution.value ?? null,
          p_resolved_by: resolution.by,
          p_basis: resolution.basis ?? {},
        });
        if (error) {
          // Same blocked-by-setup story as a card: the agreement is keyed on a
          // round the setup queue has not landed — or on one that is gone.
          if (isBlockedBySetup(error) && (await roundIsGone(tid, roundId))) {
            captureException(error, { scope: 'cards.replicator', table: RESOLUTIONS_TABLE, tid, roundId, dropped: true });
            await dropRound(tid, roundId);
            dropped.add(roundId);
            continue roundLoop;
          }
          failed = true;
          remaining = true;
          if (isBlockedBySetup(error)) blocked = true;
          else hardFailed = true;
          noteError(error, { table: RESOLUTIONS_TABLE, tid, roundId, playerId, hole });
          continue;
        }
        const winner = Array.isArray(data) ? data[0] : data;

        const forRound = await store.withTid(tid, async () => {
          const cur = await store.getResolutions(tid);
          const stored = cur[roundId]?.[playerId]?.[hole];
          if (!stored?.pending || stored.ts !== resolution.ts) return null;
          // The standing row, `pending` dropped. Falling back to the local
          // copy keeps an older server that cannot return the row working.
          const { pending, ...clean } = stored;
          const settled = winner?.round_id ? toResolution(winner) : clean;
          const round = {
            ...(cur[roundId] ?? {}),
            [playerId]: { ...(cur[roundId]?.[playerId] ?? {}), [hole]: settled },
          };
          await store.setResolutions(tid, { ...cur, [roundId]: round });
          return round;
        });
        if (forRound) applyRound(tid, roundId, { resolutions: forRound });
        else remaining = true;
      }
    }
  }

  return { failed, remaining, blocked, hardFailed };
}

async function pushTournament(tid) {
  const store = getCardStorage();
  const myAuthorId = getDeviceAuthorId();
  const meta = await store.getMeta(tid);
  const rounds = [...new Set([...(meta.rounds ?? []), ...knownRounds(tid)])];

  const cards = await pushCards(tid, myAuthorId, rounds);
  const resolutions = await pushResolutions(tid, cards.dropped);
  const failed = cards.failed || resolutions.failed;
  const remaining = cards.remaining || resolutions.remaining;
  // Blocked only while NOTHING else is failing: a real error standing next to
  // a missing round row is still a real error, and must be shown as one.
  const blocked = (cards.blocked || resolutions.blocked)
    && !cards.hardFailed && !resolutions.hardFailed;

  if (!remaining) await store.removePendingTid(tid);
  return { failed, remaining, blocked };
}

/**
 * Push one tournament and settle its own retry. Coalesced per tid, so the
 * tournament's retry timer and a sweeping `pushAll` share one attempt rather
 * than racing each other's read-modify-writes.
 */
function pushTid(tid) {
  const existing = _pushInFlightByTid.get(tid);
  if (existing) return existing;

  const run = (async () => {
    const rec = tidState(tid);
    let res;
    try {
      res = await pushTournament(tid);
    } catch (e) {
      noteError(e, { tid });
      res = { failed: true, remaining: true, blocked: false };
    }
    rec.failed = res.failed;
    rec.remaining = res.remaining;
    if (res.failed) {
      rec.blockedSince = res.blocked ? (rec.blockedSince ?? Date.now()) : null;
      scheduleRetry(tid, res.blocked);
    } else {
      clearRetry(rec);
      rec.attempts = 0;
      rec.blockedSince = null;
      rec.lastError = null;
      if (!res.remaining) _tidState.delete(tid);
    }
    return res;
  })().finally(() => { _pushInFlightByTid.delete(tid); });

  _pushInFlightByTid.set(tid, run);
  return run;
}

/**
 * Push every pending row of every tournament in the `@cards:pending` index —
 * no storage scan, so this stays cheap however many finished games are
 * cached. Concurrent calls coalesce into the in-flight promise (S11).
 */
export function pushAll() {
  if (_pushInFlight) return _pushInFlight;
  _pushInFlight = (async () => {
    await initDeviceAuthorId();
    const store = getCardStorage();
    const tids = await store.listPendingTids();
    if (tids.length === 0) {
      refreshStatus();
      return { pushed: 0, failed: false };
    }

    setStatus('syncing');
    let anyFailed = false;
    let anyRemaining = false;
    // One tournament's failure must not hold up another's, nor borrow its
    // backoff: each settles its own retry inside pushTid (S14).
    for (const tid of tids) {
      const res = await pushTid(tid);
      anyFailed = anyFailed || res.failed;
      anyRemaining = anyRemaining || res.remaining;
    }
    refreshStatus();
    return { failed: anyFailed, remaining: anyRemaining };
  })().finally(() => { _pushInFlight = null; });
  return _pushInFlight;
}

function clearRetry(rec) {
  if (!rec?.timer) return;
  clearTimeout(rec.timer);
  rec.timer = null;
}

function scheduleRetry(tid, blocked = false) {
  const rec = tidState(tid);
  if (rec.timer) return;
  // A blocked-by-setup card gains nothing from a fast first retry — it is
  // waiting on another subsystem, not on the network — so it goes straight to
  // the cap and stays there.
  const idx = blocked ? PUSH_BACKOFF_MS.length - 1 : Math.min(rec.attempts, PUSH_BACKOFF_MS.length - 1);
  rec.attempts += 1;
  rec.timer = setTimeout(() => {
    rec.timer = null;
    pushTid(tid).then(refreshStatus, refreshStatus);
  }, PUSH_BACKOFF_MS[idx]);
}

/** Push now if there is a connection, otherwise just say so. */
export function schedulePush() {
  if (isOnline()) return pushAll();
  setStatus('pending');
  return Promise.resolve({ failed: false, remaining: true });
}

// --- pull / apply -----------------------------------------------------------

/** Server row → the engine's resolution shape. */
export function toResolution(row) {
  return {
    roundId: row.round_id,
    playerId: row.player_id,
    hole: row.hole,
    value: row.value,
    by: row.resolved_by,
    ts: row.resolved_at ? new Date(row.resolved_at).getTime() : 0,
    basis: row.basis ?? {},
  };
}

function touch(map, roundId) {
  let entry = map.get(roundId);
  if (!entry) {
    entry = { peers: {} };
    map.set(roundId, entry);
  }
  return entry;
}

// Shared by pull() and the realtime handler: one row and a thousand rows go
// through exactly the same code, so a live update and a reconnect can never
// diverge (plan §3).
async function applyRows(tid, cardRows, resolutionRows, { stampPull = false } = {}) {
  await initDeviceAuthorId();
  const myAuthorId = getDeviceAuthorId();
  const store = getCardStorage();
  const touched = new Map();
  const pulledAt = Date.now();

  await store.withTid(tid, async () => {
    const meta = await store.getMeta(tid);
    const peers = { ...(meta.peers ?? {}) };
    const rounds = new Set(meta.rounds ?? []);
    let metaChanged = false;

    for (const row of cardRows) {
      if (!row?.round_id || !row?.author_id || !row?.card) continue;
      if (!rounds.has(row.round_id)) {
        rounds.add(row.round_id);
        metaChanged = true;
      }
      // My own row is authoritative locally — never let an echo of it back in.
      if (row.author_id === myAuthorId) continue;
      const list = peers[row.round_id] ?? [];
      if (!list.includes(row.author_id)) {
        peers[row.round_id] = [...list, row.author_id];
        metaChanged = true;
      }
      // The scorecard polls every 20 s and gets the same cards back nearly
      // every time. Writing an identical card would cost a storage write and,
      // far worse, a fresh roundState snapshot — which re-runs every derived
      // memo on the screen for no change at all. Compare first.
      const stored = await store.getPeer(tid, row.round_id, row.author_id);
      if (stored && rowsEqual(stored, row.card)) continue;
      await store.setPeer(tid, row.round_id, row.author_id, row.card);
      touch(touched, row.round_id).peers[row.author_id] = row.card;
    }

    if (resolutionRows.length) {
      const all = await store.getResolutions(tid);
      const changedRounds = new Set();
      for (const row of resolutionRows) {
        if (!row?.round_id || !row?.player_id) continue;
        const rid = row.round_id;
        const pid = row.player_id;
        const hole = String(row.hole);
        if (!rounds.has(rid)) {
          rounds.add(rid);
          metaChanged = true;
        }
        // An agreement this device made and has not pushed yet outranks the
        // server's older copy until it lands.
        if (all[rid]?.[pid]?.[hole]?.pending) continue;
        const next = toResolution(row);
        if (rowsEqual(all[rid]?.[pid]?.[hole], next)) continue;
        all[rid] = { ...(all[rid] ?? {}) };
        all[rid][pid] = { ...(all[rid][pid] ?? {}), [hole]: next };
        changedRounds.add(rid);
      }
      if (changedRounds.size) {
        await store.setResolutions(tid, all);
        for (const rid of changedRounds) touch(touched, rid).resolutions = all[rid];
      }
    }

    // `lastPulledAt` marks the last pull that brought something, not the last
    // one attempted: stamping it on every empty poll was itself enough to mint
    // a new snapshot and re-render the card. Nothing reads it as "when did we
    // last talk to the server" — see storage.js.
    const stamp = stampPull && touched.size > 0;
    if (metaChanged || stamp) {
      await store.setMeta(tid, {
        ...meta,
        peers,
        rounds: [...rounds],
        lastPulledAt: stamp ? pulledAt : meta.lastPulledAt,
      });
    }
  });

  // One notification per affected round, however many rows arrived (S5).
  for (const [rid, entry] of touched) {
    applyRound(tid, rid, {
      ...(Object.keys(entry.peers).length ? { peers: entry.peers } : {}),
      ...(entry.resolutions ? { resolutions: entry.resolutions } : {}),
      ...(stampPull ? { lastPulledAt: pulledAt } : {}),
    });
  }
}

/** Fetch a tournament's cards and resolutions (optionally one round's). */
export async function pull(tid, roundId = null) {
  if (!tid) return false;
  const read = async (table) => {
    let q = _client.from(table).select('*').eq('tournament_id', tid);
    if (roundId) q = q.eq('round_id', roundId);
    return q;
  };

  const cards = await read(CARDS_TABLE);
  if (cards?.error) {
    noteError(cards.error, { table: CARDS_TABLE, tid });
    setStatus('error');
    return false;
  }
  const resolutions = await read(RESOLUTIONS_TABLE);
  if (resolutions?.error) {
    noteError(resolutions.error, { table: RESOLUTIONS_TABLE, tid });
    setStatus('error');
    return false;
  }

  await applyRows(tid, cards?.data ?? [], resolutions?.data ?? [], { stampPull: true });
  return true;
}

// --- realtime ---------------------------------------------------------------

function buildLiveChannel(tid) {
  const channel = _client.channel(`cards-${tid}`);
  for (const table of [CARDS_TABLE, RESOLUTIONS_TABLE]) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `tournament_id=eq.${tid}` },
      (payload) => {
        const row = payload?.new;
        if (!row) return; // deletes carry no new row; nothing in this design emits them
        const cards = table === CARDS_TABLE ? [row] : [];
        const resolutions = table === RESOLUTIONS_TABLE ? [row] : [];
        applyRows(tid, cards, resolutions).catch((e) => noteError(e, { table, tid }));
      },
    );
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') _liveAttempts = 0;
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      scheduleRejoin(tid);
    }
  });
  _channel = channel;
  return channel;
}

// A dropped socket stops delivering rows with no signal. Rejoin with backoff
// rather than hammering a flaky connection; a SUBSCRIBED resets the counter.
// Coalesced: a rejoin already pending is left alone.
function scheduleRejoin(tid) {
  if (_liveTimer) return;
  const delay = Math.min(1000 * 2 ** _liveAttempts, LIVE_BACKOFF_CAP_MS);
  _liveAttempts += 1;
  _liveTimer = setTimeout(() => {
    _liveTimer = null;
    if (_liveTid !== tid) return; // superseded by a tournament switch
    if (_channel) _client.removeChannel?.(_channel);
    buildLiveChannel(tid);
  }, delay);
}

/** Idempotent per tournament; a different tid tears the previous one down. */
export function openLive(tid) {
  if (!tid) {
    closeLive();
    return null;
  }
  if (_liveTid === tid && _channel) return _channel;
  closeLive();
  _liveTid = tid;
  return buildLiveChannel(tid);
}

export function closeLive() {
  if (_liveTimer) {
    clearTimeout(_liveTimer);
    _liveTimer = null;
  }
  _liveAttempts = 0;
  if (_channel) _client.removeChannel?.(_channel);
  _channel = null;
  _liveTid = null;
}

export function getLiveTid() {
  return _liveTid;
}

// --- lifecycle --------------------------------------------------------------

/** Push, then pull the open tournament, then announce it once. Also the
 *  scorecard screen's focus handler. */
export async function reconnect() {
  await pushAll();
  const tid = _liveTid;
  if (tid) await pull(tid);
  emitSynced({ tid: tid ?? null });
  return tid;
}

/** Idempotent. Reconnects whenever connectivity comes back. */
export function startReplication() {
  if (_started) return;
  _started = true;
  _unsubConnectivity = subscribeConnectivity((online) => {
    if (online) reconnect().catch(() => {});
  });
}

export function stopReplication() {
  if (_unsubConnectivity) _unsubConnectivity();
  _unsubConnectivity = null;
  _started = false;
  closeLive();
  for (const rec of _tidState.values()) clearRetry(rec);
}

/** Test-only: swap the Supabase client for a fake. */
export function _setReplicatorClientForTests(client) {
  _client = client ?? supabase;
}

/** Test-only: reset every singleton bit of state between cases. */
export function _resetReplicatorForTests() {
  stopReplication();
  _pushInFlight = null;
  _pushInFlightByTid.clear();
  _tidState.clear();
  _lastError = null;
  _status = 'idle';
  _statusSubs.clear();
  _syncedSubs.clear();
  _client = supabase;
  _roundExists = defaultRoundExists;
}
