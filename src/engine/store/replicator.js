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
//     the server copy replace it.

import { isOnline, subscribeConnectivity } from '../../lib/connectivity';
import { supabase } from '../../lib/supabase';
import { captureException } from '../../lib/errorReporting';
import { getDeviceAuthorId, initDeviceAuthorId } from '../../store/deviceId';
import { applyRound, knownRounds } from './roundState';
import { getCardStorage } from './storage';

const CARDS_TABLE = 'scorer_cards';
const RESOLUTIONS_TABLE = 'score_resolutions';
const CARDS_CONFLICT = 'tournament_id,round_id,author_id';
const RESOLUTIONS_CONFLICT = 'tournament_id,round_id,player_id,hole';

const PUSH_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
const LIVE_BACKOFF_CAP_MS = 30000;

let _client = supabase;

let _pushInFlight = null;
let _pushAttempts = 0;
let _retryTimer = null;
let _lastError = null;

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

/** The last write/read failure, `{ message, code }`, or null. */
export function getLastError() {
  return _lastError;
}

function noteError(error, context) {
  _lastError = {
    message: error?.message != null ? String(error.message) : String(error),
    code: error?.code ?? null,
  };
  captureException(error, { scope: 'cards.replicator', ...context });
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

async function pushCards(tid, myAuthorId, rounds) {
  const store = getCardStorage();
  let failed = false;
  let remaining = false;

  for (const roundId of rounds) {
    const mine = await store.getMine(tid, roundId);
    if (!mine?.pending) continue;

    // The whole card, every time: a partial retry is exactly the failure mode
    // this design exists to remove.
    const row = { tournament_id: tid, round_id: roundId, author_id: myAuthorId, card: mine.card };
    const { error } = await _client.from(CARDS_TABLE).upsert(row, { onConflict: CARDS_CONFLICT });
    if (error) {
      failed = true;
      remaining = true;
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

  return { failed, remaining };
}

async function pushResolutions(tid) {
  const store = getCardStorage();
  const all = await store.getResolutions(tid);
  let failed = false;
  let remaining = false;

  for (const [roundId, byPlayer] of Object.entries(all)) {
    for (const [playerId, byHole] of Object.entries(byPlayer ?? {})) {
      for (const [hole, resolution] of Object.entries(byHole ?? {})) {
        if (!resolution?.pending) continue;
        const row = {
          tournament_id: tid,
          round_id: roundId,
          player_id: playerId,
          hole: Number(hole),
          value: resolution.value ?? null,
          resolved_by: resolution.by,
          basis: resolution.basis ?? {},
        };
        const { error } = await _client
          .from(RESOLUTIONS_TABLE)
          .upsert(row, { onConflict: RESOLUTIONS_CONFLICT });
        if (error) {
          failed = true;
          remaining = true;
          noteError(error, { table: RESOLUTIONS_TABLE, tid, roundId, playerId, hole });
          continue;
        }

        const forRound = await store.withTid(tid, async () => {
          const cur = await store.getResolutions(tid);
          const stored = cur[roundId]?.[playerId]?.[hole];
          if (!stored?.pending || stored.ts !== resolution.ts) return null;
          const { pending, ...clean } = stored;
          const round = {
            ...(cur[roundId] ?? {}),
            [playerId]: { ...(cur[roundId]?.[playerId] ?? {}), [hole]: clean },
          };
          await store.setResolutions(tid, { ...cur, [roundId]: round });
          return round;
        });
        if (forRound) applyRound(tid, roundId, { resolutions: forRound });
        else remaining = true;
      }
    }
  }

  return { failed, remaining };
}

/**
 * Execute the Reset Round markers (`meta.pendingResets`) as a delete of every
 * card and agreement the server holds for that round — the projection trigger
 * then rebuilds `game_scores` for it as empty.
 *
 * Runs BEFORE the card push so a restore queued on top of a reset lands in
 * order: delete the round, then upsert the restored card. A failure keeps the
 * marker and rides the same backoff as every other pending write (R8).
 */
async function pushResets(tid) {
  const store = getCardStorage();
  const meta = await store.getMeta(tid);
  const pending = meta.pendingResets ?? {};
  let failed = false;
  let remaining = false;

  for (const [roundId, ts] of Object.entries(pending)) {
    let ok = true;
    for (const table of [CARDS_TABLE, RESOLUTIONS_TABLE]) {
      const { error } = await _client.from(table)
        .delete()
        .eq('tournament_id', tid)
        .eq('round_id', roundId);
      if (!error) continue;
      ok = false;
      failed = true;
      remaining = true;
      noteError(error, { table, tid, roundId, op: 'reset' });
      break;
    }
    if (!ok) continue;

    await store.withTid(tid, async () => {
      const cur = await store.getMeta(tid);
      const next = { ...(cur.pendingResets ?? {}) };
      // A reset recorded again while this delete was in flight is a NEWER
      // marker — leave it for the next pass.
      if (next[roundId] !== ts) return;
      delete next[roundId];
      await store.setMeta(tid, { ...cur, pendingResets: next });
    });
  }

  return { failed, remaining };
}

async function pushTournament(tid) {
  const store = getCardStorage();
  const myAuthorId = getDeviceAuthorId();
  const meta = await store.getMeta(tid);
  const rounds = [...new Set([...(meta.rounds ?? []), ...knownRounds(tid)])];

  const resets = await pushResets(tid);
  const cards = await pushCards(tid, myAuthorId, rounds);
  const resolutions = await pushResolutions(tid);
  const failed = resets.failed || cards.failed || resolutions.failed;
  const remaining = resets.remaining || cards.remaining || resolutions.remaining;

  if (!remaining) await store.removePendingTid(tid);
  return { failed, remaining };
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
      setStatus('idle');
      return { pushed: 0, failed: false };
    }

    setStatus('syncing');
    let anyFailed = false;
    let anyRemaining = false;
    for (const tid of tids) {
      // One tournament's failure must not hold up another's (S14).
      try {
        const res = await pushTournament(tid);
        anyFailed = anyFailed || res.failed;
        anyRemaining = anyRemaining || res.remaining;
      } catch (e) {
        anyFailed = true;
        anyRemaining = true;
        noteError(e, { tid });
      }
    }

    if (anyFailed) {
      scheduleRetry();
      setStatus('error');
    } else {
      _pushAttempts = 0;
      _lastError = null;
      setStatus(anyRemaining ? 'pending' : 'idle');
    }
    return { failed: anyFailed, remaining: anyRemaining };
  })().finally(() => { _pushInFlight = null; });
  return _pushInFlight;
}

function scheduleRetry() {
  if (_retryTimer) return;
  const delay = PUSH_BACKOFF_MS[Math.min(_pushAttempts, PUSH_BACKOFF_MS.length - 1)];
  _pushAttempts += 1;
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    pushAll().catch(() => {});
  }, delay);
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
async function applyRows(tid, cardRows, resolutionRows, { stampPull = false, roundId = null } = {}) {
  await initDeviceAuthorId();
  const myAuthorId = getDeviceAuthorId();
  const store = getCardStorage();
  const touched = new Map();
  const pulledAt = Date.now();

  await store.withTid(tid, async () => {
    const meta = await store.getMeta(tid);
    const peers = { ...(meta.peers ?? {}) };
    const rounds = new Set(meta.rounds ?? []);

    for (const row of cardRows) {
      if (!row?.round_id || !row?.author_id || !row?.card) continue;
      rounds.add(row.round_id);
      // My own row is authoritative locally — never let an echo of it back in.
      if (row.author_id === myAuthorId) continue;
      await store.setPeer(tid, row.round_id, row.author_id, row.card);
      const list = peers[row.round_id] ?? [];
      if (!list.includes(row.author_id)) peers[row.round_id] = [...list, row.author_id];
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
        rounds.add(rid);
        // An agreement this device made and has not pushed yet outranks the
        // server's older copy until it lands.
        if (all[rid]?.[pid]?.[hole]?.pending) continue;
        all[rid] = { ...(all[rid] ?? {}) };
        all[rid][pid] = { ...(all[rid][pid] ?? {}), [hole]: toResolution(row) };
        changedRounds.add(rid);
      }
      if (changedRounds.size) {
        await store.setResolutions(tid, all);
        for (const rid of changedRounds) touch(touched, rid).resolutions = all[rid];
      }
    }

    await store.setMeta(tid, {
      ...meta,
      peers,
      rounds: [...rounds],
      lastPulledAt: stampPull ? pulledAt : meta.lastPulledAt,
    });
  });

  if (stampPull && touched.size === 0 && roundId) touch(touched, roundId);

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

  await applyRows(tid, cards?.data ?? [], resolutions?.data ?? [], { stampPull: true, roundId });
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
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
}

/** Test-only: swap the Supabase client for a fake. */
export function _setReplicatorClientForTests(client) {
  _client = client ?? supabase;
}

/** Test-only: reset every singleton bit of state between cases. */
export function _resetReplicatorForTests() {
  stopReplication();
  _pushInFlight = null;
  _pushAttempts = 0;
  _lastError = null;
  _status = 'idle';
  _statusSubs.clear();
  _syncedSubs.clear();
  _client = supabase;
}
