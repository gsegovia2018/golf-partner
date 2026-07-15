// One Supabase Realtime channel per active tournament, patching the local
// blob cache (tournamentStore's readLocal/saveLocal) directly from `game_*`
// row events instead of waiting on the 20s cross-device poll (ScorecardScreen)
// or the next focus/store-change reload. Casual tournaments only — official
// tournaments already have their own live data layer (useOfficialRound's RPC
// polling) and never carry a `game_*`-backed local blob shaped for these
// patchers.
//
// The row shapes here are the `game_*` TABLE columns (snake_case), NOT the
// assembled blob shape get_game_tournament() returns — see
// supabase/migrations/20260712000000_sync_v2_normalized.sql for the ground
// truth. Each `applyXRow` translates one column-shaped row into a patch on
// the assembled tournament object cached locally.
import { supabase } from '../lib/supabase';
import { readLocal, saveLocal } from './tournamentStore';
import { applyPendingMutations, preserveLocalConflictState } from './mutate';
import { syncQueue } from './syncQueue';

function deepClone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

function clampIndex(index, length) {
  const i = Number.isFinite(index) ? index : length;
  return Math.max(0, Math.min(i, length));
}

// ── Pure row → tournament patchers (exported for tests) ─────────────────────

// Realtime payloads carry an `eventType` of 'INSERT' | 'UPDATE' | 'DELETE'.
// A DELETE delivers only the OLD record, which for these tables is the
// primary key alone (no strokes/detail/note/body) — so the patchers below
// must locate the addressed row by PK and REMOVE it rather than treat a
// field-less record as an upsert (which would resurrect a corrupt stub —
// an {id}-only round or a {} player — that crashes unguarded consumers like
// round.holes). This helper centralizes the "is this a delete?" decision:
// an explicit DELETE event, OR (for the per-cell tables) a null value in an
// INSERT/UPDATE, which get_game_tournament treats identically (its
// `WHERE ... IS NOT NULL` filters drop the cell either way).
function isDeleteEvent(eventType) {
  return eventType === 'DELETE';
}

// game_scores row: { round_id, tournament_id, player_id, hole, strokes, ... }.
// strokes === null (an INSERT/UPDATE tombstone) and a DELETE event both clear
// the cell, mirroring get_game_tournament's `WHERE s.strokes IS NOT NULL`
// filter (a stored null would never round-trip back out of the RPC). After
// clearing the last hole for a player, the now-empty per-player bucket is
// pruned entirely — get_game_tournament omits players with zero cells, and
// roundPairClinched (tournamentStore.js) keys off Object.keys(scores).length,
// so a stray `scores[pid] = {}` would diverge from a refetch and mis-count.
export function applyScoreRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const holeKey = String(row.hole);
  const scores = { ...(round.scores ?? {}) };
  const playerScores = { ...(scores[row.player_id] ?? {}) };
  if (isDeleteEvent(eventType) || row.strokes == null) delete playerScores[holeKey];
  else playerScores[holeKey] = row.strokes;
  if (Object.keys(playerScores).length === 0) delete scores[row.player_id];
  else scores[row.player_id] = playerScores;
  round.scores = scores;
  return next;
}

// game_score_entries row: { round_id, tournament_id, player_id, hole,
// author_id, strokes, updated_at }. Per-author scoring entries, keyed three
// levels deep (player → hole → author) so each contributor's independent
// entry survives alongside the others — unlike game_scores (one settled
// value per player+hole), this table can hold multiple simultaneous authors
// for the same cell pending resolution. DELETE (or the row simply being
// retracted) removes just that author's entry; empty author/hole/player
// buckets are pruned the same way applyScoreRow prunes empty player buckets.
export function applyScoreEntryRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const entries = { ...(round.scoreEntries ?? {}) };
  const byHole = { ...(entries[row.player_id] ?? {}) };
  const byAuthor = { ...(byHole[row.hole] ?? {}) };
  if (isDeleteEvent(eventType)) delete byAuthor[row.author_id];
  else byAuthor[row.author_id] = { value: row.strokes ?? null, ts: new Date(row.updated_at).getTime() };
  if (Object.keys(byAuthor).length === 0) delete byHole[row.hole];
  else byHole[row.hole] = byAuthor;
  if (Object.keys(byHole).length === 0) delete entries[row.player_id];
  else entries[row.player_id] = byHole;
  round.scoreEntries = entries;
  return next;
}

// game_score_resolutions row: { round_id, tournament_id, player_id, hole,
// value, resolved_by, resolved_at }. The settled outcome once conflicting
// game_score_entries rows for a cell have been reconciled — one resolution
// per player+hole. DELETE removes it outright; empty per-player buckets are
// pruned the same way applyScoreRow prunes empty player buckets.
export function applyScoreResolutionRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const res = { ...(round.scoreResolutions ?? {}) };
  const byHole = { ...(res[row.player_id] ?? {}) };
  if (isDeleteEvent(eventType)) delete byHole[row.hole];
  else byHole[row.hole] = { value: row.value ?? null, by: row.resolved_by, ts: new Date(row.resolved_at).getTime() };
  if (Object.keys(byHole).length === 0) delete res[row.player_id];
  else res[row.player_id] = byHole;
  round.scoreResolutions = res;
  return next;
}

// game_shot_details row: { round_id, tournament_id, player_id, hole, detail }.
// detail === null / DELETE clear the cell; empty per-player bucket pruned —
// same reasoning as applyScoreRow.
export function applyShotDetailRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const holeKey = String(row.hole);
  const shotDetails = { ...(round.shotDetails ?? {}) };
  const playerDetails = { ...(shotDetails[row.player_id] ?? {}) };
  if (isDeleteEvent(eventType) || row.detail == null) delete playerDetails[holeKey];
  else playerDetails[holeKey] = row.detail;
  if (Object.keys(playerDetails).length === 0) delete shotDetails[row.player_id];
  else shotDetails[row.player_id] = playerDetails;
  round.shotDetails = shotDetails;
  return next;
}

// game_round_notes row: { round_id, tournament_id, hole_key, note }.
// Mirrors get_game_tournament's notes assembly exactly: 'round' → notes.round,
// any other hole_key → notes.hole[holeKey]; note === null / DELETE tombstones
// that key, and an empty bucket (or an empty `notes` object entirely) is
// dropped rather than left as `{}`/`{ hole: {} }` so a fully-cleared round has
// no stray `notes` key at all — same as the RPC's COALESCE-to-omitted shape.
export function applyNoteRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const remove = isDeleteEvent(eventType) || row.note == null;
  const notes = { ...(round.notes ?? {}) };
  if (row.hole_key === 'round') {
    if (remove) delete notes.round;
    else notes.round = row.note;
  } else {
    const hole = { ...(notes.hole ?? {}) };
    if (remove) delete hole[row.hole_key];
    else hole[row.hole_key] = row.note;
    if (Object.keys(hole).length === 0) delete notes.hole;
    else notes.hole = hole;
  }
  if (Object.keys(notes).length === 0) delete round.notes;
  else round.notes = notes;
  return next;
}

// game_rounds row: { id, tournament_id, round_index, body, updated_at }.
// body is the round minus scores/shotDetails/notes (those live in their own
// tables) — reassemble by carrying forward whichever of those "hot keys" the
// currently-cached round already has, then place the round at round_index,
// reordering/inserting as needed. Round bodies never carry their own index
// field (array position IS the order — see get_game_tournament's `ORDER BY
// round_index, id`), so the existing entry is pulled out and the new one
// spliced back in at the target position rather than patched in place.
export function applyRoundRow(t, row, eventType) {
  const next = deepClone(t);
  const rounds = (next.rounds ?? []).slice();
  const existingIdx = rounds.findIndex((r) => r.id === row.id);

  // DELETE (round.remove → deleteRound, cascading its game_scores/
  // game_shot_details/game_round_notes rows) removes the round outright. A
  // field-less old record must never fall through to the upsert path below —
  // that would resurrect an {id}-only stub with no `holes`, crashing every
  // unguarded round.holes consumer (including on the removing device via the
  // DELETE self-echo). No-op when already absent.
  if (isDeleteEvent(eventType)) {
    if (existingIdx !== -1) rounds.splice(existingIdx, 1);
    next.rounds = rounds;
    return next;
  }

  const existing = existingIdx === -1 ? null : rounds[existingIdx];
  if (existingIdx !== -1) rounds.splice(existingIdx, 1);

  const assembled = { ...(row.body ?? {}), id: row.id };
  // Preserve existing hot keys on an update; for a brand-new round emit empty
  // scores/shotDetails so the shape matches get_game_tournament (which always
  // includes both objects, even when empty). notes stays omitted unless the
  // existing round had it — the RPC only adds notes when live note rows exist.
  assembled.scores = existing && 'scores' in existing ? existing.scores : {};
  assembled.shotDetails = existing && 'shotDetails' in existing ? existing.shotDetails : {};
  if (existing && 'notes' in existing) assembled.notes = existing.notes;

  const idx = clampIndex(row.round_index, rounds.length);
  rounds.splice(idx, 0, assembled);
  next.rounds = rounds;
  return next;
}

// game_players row: { tournament_id, player_id, user_id, pos, body }. body IS
// the whole player object (see tournamentRepo.upsertPlayer) — upsert it at
// `pos`, reordering the same way applyRoundRow does for round_index.
export function applyPlayerRow(t, row, eventType) {
  const next = deepClone(t);
  const players = (next.players ?? []).slice();
  const existingIdx = players.findIndex((p) => p.id === row.player_id);

  // DELETE (removePlayer → deletePlayer) removes the player by player_id. A
  // field-less old record must not upsert a `{}` stub — downstream code reads
  // p.id / p.name / p.user_id unguarded. No-op when already absent.
  if (isDeleteEvent(eventType)) {
    if (existingIdx !== -1) players.splice(existingIdx, 1);
    next.players = players;
    // Stamp the removedPlayerIds tombstone (see mutate.js's
    // preserveLocalConflictState) so a later union-merge on THIS device
    // never resurrects the removed player's scoreEntries/scoreResolutions
    // from a stale cache copy — this device may not be the one that ran
    // removePlayer, and the corresponding game_score_entries DELETE rows can
    // arrive out of order (or not at all, e.g. this device was offline for
    // part of the removal window).
    //
    // CRITICAL: scope the tombstone to the SAME rounds the removal actually
    // cleared — not-yet-played rounds only (idx >= currentRound), mirroring
    // removePlayerRoundPatches (tournamentStore.js), which leaves
    // already-played earlier rounds untouched and preserves the removed
    // player's scores/entries there as history. Tombstoning a played round
    // would make preserveLocalConflictState strip that legitimate history —
    // a data-loss regression, since repo.deletePlayer broadcasts this DELETE
    // to every device.
    if (Array.isArray(next.rounds)) {
      const currentRound = next.currentRound ?? 0;
      next.rounds = next.rounds.map((round, idx) => {
        if (idx < currentRound) return round; // already-played — leave history intact
        const removedPlayerIds = new Set(round.removedPlayerIds ?? []);
        removedPlayerIds.add(row.player_id);
        return { ...round, removedPlayerIds: [...removedPlayerIds] };
      });
    }
    return next;
  }

  if (existingIdx !== -1) players.splice(existingIdx, 1);
  const assembled = { ...(row.body ?? {}) };
  const idx = clampIndex(row.pos, players.length);
  players.splice(idx, 0, assembled);
  next.players = players;
  return next;
}

// tournaments row: { id, name, kind, props, current_round }. props merges
// into the top level one level deep (Object.assign, not recursive) — name
// comes from its own column; kind is the domain kind from props, falling
// back to the (CHECK-constrained 'casual'/'official') column, exactly like
// get_game_tournament's COALESCE(props->>'kind', column); currentRound only
// ever advances (Math.max), matching advance_game_round's GREATEST semantics
// server-side.
// rounds/players are restored after the merge so a props payload can never
// stomp them (props never carries either key server-side — see
// tournamentRepo.createTournament's destructure — but this patcher does not
// trust that as its only guard).
// No eventType branch: a tournaments DELETE is never wired here (the row is
// the tournament itself, handled by its own deletion flow, not a game_*
// patch), and the shared handler harmlessly passes a third arg this ignores.
export function applyTournamentRow(t, row) {
  const next = deepClone(t);
  const { rounds, players } = next;
  Object.assign(next, row.props ?? {});
  next.rounds = rounds;
  next.players = players;
  if (row.name != null) next.name = row.name;
  // kind: row.kind is the tournaments.kind COLUMN, CHECK-constrained to
  // 'casual'/'official' — it can never hold the app's domain kind
  // ('game'/'tournament'). The domain kind lives in props.kind (already
  // merged into next above). Mirror get_game_tournament's exact emission
  // rule — COALESCE(props->>'kind', column) — so the column is only a
  // fallback, never a clobber, when props carries no kind (official rows).
  next.kind = row.props?.kind ?? row.kind;
  next.currentRound = Math.max(next.currentRound ?? 0, row.current_round ?? 0);
  return next;
}

const APPLIERS = {
  game_scores: applyScoreRow,
  game_score_entries: applyScoreEntryRow,
  game_score_resolutions: applyScoreResolutionRow,
  game_shot_details: applyShotDetailRow,
  game_round_notes: applyNoteRow,
  game_rounds: applyRoundRow,
  game_players: applyPlayerRow,
  tournaments: applyTournamentRow,
};

// ── Channel lifecycle ────────────────────────────────────────────────────────

let _channel = null;
let _channelId = null;

// Backoff rejoin state for the current channel. A fresh ensureRealtimeForTournament
// call (a real tournament switch, or stopRealtime) always cancels any pending
// rejoin — see stopRealtime — so this never fires for a superseded channel.
let _reconnectTimer = null;
let _reconnectAttempts = 0;

// ── Presence: per-device currentHole broadcast ───────────────────────────────
// Supabase presence state shape: { [presenceKey]: [{ authorId, currentHole },
// ...] }. Reduced to the highest currentHole seen per authorId — pure, so the
// conflict-surfacing gate (authorProgress/isCellSurfaceable) can consume it
// without touching the channel itself.
export function reducePresenceProgress(state) {
  const out = {};
  for (const metas of Object.values(state ?? {})) {
    for (const m of metas ?? []) {
      if (m?.authorId && (m.currentHole ?? 0) > (out[m.authorId] ?? 0)) out[m.authorId] = m.currentHole;
    }
  }
  return out;
}

const _presenceCbs = new Set();
let _lastHole = null;
let _lastAuthor = null;

export function getPresenceProgress() {
  if (!_channel) return {};
  return reducePresenceProgress(_channel.presenceState());
}

export function subscribeProgress(cb) {
  _presenceCbs.add(cb);
  return () => _presenceCbs.delete(cb);
}

export function setPresenceHole(authorId, hole) {
  _lastAuthor = authorId;
  _lastHole = hole;
  if (_channel && authorId) _channel.track({ authorId, currentHole: hole });
}

// This tournament's still-undrained queue entries, read fresh (not captured
// earlier) so each settle pass sees whatever is queued right now.
async function pendingEntriesFor(id) {
  const all = await syncQueue.all();
  return all.filter((e) => e.tournamentId === id);
}

// Per-tournament promise-chain mutex for the row-handler read-modify-write.
// Two row events for the SAME tournament can arrive close together; each
// handler's readLocal→patch→saveLocal is a read-modify-write over the whole
// cached blob, so without serialization the second handler clones the same
// pre-patch base and its saveLocal clobbers the first handler's patch (lost
// update). Keying by tournament id (rather than a single global chain) keeps
// unrelated tournaments' handlers from queuing behind each other. Modeled on
// syncQueue.js's runExclusive: the chain promise itself must never reject (a
// rejection would break the chain for every subsequent queued op for this
// id), so failures are swallowed on the chain but still propagate to the
// caller via the returned promise. Entries are pruned once their chain empties
// so this map never grows unbounded across a long session's tournaments.
const _handlerMutex = new Map();
function runExclusiveForTournament(id, fn) {
  const prev = _handlerMutex.get(id) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  const settled = result.then(() => undefined, () => undefined);
  _handlerMutex.set(id, settled);
  settled.then(() => {
    if (_handlerMutex.get(id) === settled) _handlerMutex.delete(id);
  });
  return result;
}

// Shared handler tail for every table: reads the current local cache, patches
// it with the row, re-applies this tournament's still-undrained pending
// mutations on top (a realtime row is SERVER state — replaying pending
// mutations mirrors tournamentStore's own read-path overlay, so we never
// clobber an optimistic local edit whose write hasn't round-tripped yet),
// restores the device-local meId (never trusted from a realtime row, same as
// _overlayAndSave), and preserves round.scoreEntries/scoreResolutions
// (LOCAL-ONLY hot keys — see mutate.js's preserveLocalConflictState — that no
// row event ever carries) before saving. Skips entirely if this tournament
// has no local cache to patch (nothing to preserve, nothing to render).
//
// Bounded settle loop — the SAME race guard as syncWorker.drainTournament and
// tournamentStore._overlayAndSave (neither is exported, so this mirrors their
// semantics rather than sharing): mutate() saves locally BEFORE it enqueues,
// so a score entered right as this handler runs can be present in local state
// but absent from the first queue snapshot — and a saveLocal computed from
// that snapshot would erase the just-entered value (the "scores erased as
// entered" scar). After each save, re-read the queue; if it changed, recompute
// the overlay from the SAME row-patched base (never a re-read — the patch, i.e.
// which key this row changed, must stay applied across passes) and save again.
// Bounded to 3 passes — on hitting the bound, stop WITHOUT a further stale save
// (local wins; the still-queued mutations drain and re-reconcile on the next
// worker pass / poll anyway).
function makeHandler(id, applyFn) {
  return (payload) => runExclusiveForTournament(id, async () => {
    const eventType = payload?.eventType;
    // A DELETE delivers only `old` (the PK); INSERT/UPDATE deliver `new`. The
    // patchers key off eventType to decide remove-vs-upsert, so a DELETE must
    // route through `old` (which for these tables is the primary key alone).
    const row = eventType === 'DELETE' ? payload?.old : (payload?.new ?? payload?.old);
    if (!row) return;
    // readLocal happens INSIDE the exclusive region (not before it's
    // acquired) so a queued second handler observes the first handler's
    // saveLocal, not the entry-time snapshot — otherwise both handlers would
    // clone the same pre-patch base and the second saveLocal would clobber
    // the first handler's patch.
    const cached = await readLocal(id);
    if (!cached) return;
    const patched = applyFn(cached, row, eventType);
    let snapshot = await pendingEntriesFor(id);
    for (let pass = 0; pass < 3; pass++) {
      let merged = applyPendingMutations(patched, snapshot);
      if ('meId' in cached) merged.meId = cached.meId;
      merged = preserveLocalConflictState(merged, cached);
      await saveLocal(merged, { makeActive: false });
      const latest = await pendingEntriesFor(id);
      const stable = latest.length === snapshot.length
        && latest.every((e, i) => e.id === snapshot[i].id);
      if (stable) break;
      snapshot = latest;
    }
  });
}

// Builds and subscribes a channel for `id`, wiring the same bindings every
// time: the eight postgres_changes row handlers, the presence 'sync' relay,
// and a subscribe status callback that (a) flushes the last known presence
// hole once SUBSCRIBED and resets the backoff counter, and (b) schedules a
// backoff rejoin on CHANNEL_ERROR/TIMED_OUT/CLOSED. Deliberately NOT exported
// and does not touch _lastAuthor/_lastHole itself — callers decide whether
// this is a fresh tournament (ensureRealtimeForTournament resets presence
// first) or a same-tournament reconnect (scheduleRejoin's callback, which
// must preserve presence so the rejoin resumes broadcasting the right hole).
function buildChannel(id) {
  const channel = supabase.channel(`game-${id}`);
  for (const [table, applyFn] of Object.entries(APPLIERS)) {
    const filter = table === 'tournaments' ? `id=eq.${id}` : `tournament_id=eq.${id}`;
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter },
      makeHandler(id, applyFn),
    );
  }
  channel.on('presence', { event: 'sync' }, () => {
    const progress = reducePresenceProgress(channel.presenceState());
    for (const cb of _presenceCbs) cb(progress);
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      _reconnectAttempts = 0;
      if (_lastAuthor) channel.track({ authorId: _lastAuthor, currentHole: _lastHole });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      scheduleRejoin(id);
    }
  });

  _channel = channel;
  _channelId = id;
}

// After a network blip (or the server dropping the socket) the channel stops
// delivering game_* events with no signal — degrading silently to the 20s
// cross-device poll. Reconnect with exponential backoff (capped at 30s)
// rather than hammering Supabase on a flaky connection; a successful
// SUBSCRIBED (in buildChannel above) resets the counter so a later blip
// starts its own backoff from zero rather than inheriting an earlier one.
// Coalesced: a rejoin already pending for this channel is left alone rather
// than restarting the backoff on every error signal.
function scheduleRejoin(id) {
  if (_reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** _reconnectAttempts, 30000);
  _reconnectAttempts += 1;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    // The channel may have been superseded (a tournament switch or an
    // explicit stopRealtime) while this timer was pending — stopRealtime
    // always cancels the timer, so in practice this guard is a belt-and-
    // braces check against that race rather than the primary defense.
    if (_channelId !== id) return;
    if (_channel) supabase.removeChannel(_channel);
    buildChannel(id);
  }, delay);
}

export function stopRealtime() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _reconnectAttempts = 0;
  if (_channel) supabase.removeChannel(_channel);
  _channel = null;
  _channelId = null;
}

// Idempotent: a repeat call for the same id is a no-op. A call for a
// different id tears down the old channel first. null/undefined and
// official-kind tournaments never get a channel (official tournaments have
// no game_*-backed local blob for these patchers to act on).
//
// _lastAuthor/_lastHole are reset here (not in buildChannel) whenever this
// call actually proceeds past the idempotent guard above — i.e. on a genuine
// channel-id change. Without this, switching tournaments left the previous
// tournament's presence state in place, so the new channel's first
// SUBSCRIBED would broadcast/gate conflict-surfacing off the WRONG
// tournament's last-known hole. A backoff rejoin of the SAME tournament
// (scheduleRejoin, above) intentionally bypasses this function so a
// reconnect keeps broadcasting the right hole instead of resetting it.
export async function ensureRealtimeForTournament(id) {
  if (!id) {
    stopRealtime();
    return;
  }
  if (_channelId === id) return;

  const cached = await readLocal(id);
  if (cached?.kind === 'official') {
    stopRealtime();
    return;
  }

  stopRealtime();
  _lastAuthor = null;
  _lastHole = null;

  buildChannel(id);
}
