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
import { applyPendingMutations, preserveLocalScoreConflicts } from './mutate';
import { syncQueue } from './syncQueue';

function deepClone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

function clampIndex(index, length) {
  const i = Number.isFinite(index) ? index : length;
  return Math.max(0, Math.min(i, length));
}

// ── Pure row → tournament patchers (exported for tests) ─────────────────────

// game_scores row: { round_id, tournament_id, player_id, hole, strokes, ... }.
// strokes === null is a tombstone (cleared cell) — delete the hole key rather
// than store null, mirroring get_game_tournament's `WHERE s.strokes IS NOT
// NULL` filter (a stored null would never round-trip back out of the RPC).
export function applyScoreRow(t, row) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const holeKey = String(row.hole);
  const scores = { ...(round.scores ?? {}) };
  const playerScores = { ...(scores[row.player_id] ?? {}) };
  if (row.strokes == null) delete playerScores[holeKey];
  else playerScores[holeKey] = row.strokes;
  scores[row.player_id] = playerScores;
  round.scores = scores;
  return next;
}

// game_shot_details row: { round_id, tournament_id, player_id, hole, detail }.
// detail === null is a tombstone, same reasoning as applyScoreRow.
export function applyShotDetailRow(t, row) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const holeKey = String(row.hole);
  const shotDetails = { ...(round.shotDetails ?? {}) };
  const playerDetails = { ...(shotDetails[row.player_id] ?? {}) };
  if (row.detail == null) delete playerDetails[holeKey];
  else playerDetails[holeKey] = row.detail;
  shotDetails[row.player_id] = playerDetails;
  round.shotDetails = shotDetails;
  return next;
}

// game_round_notes row: { round_id, tournament_id, hole_key, note }.
// Mirrors get_game_tournament's notes assembly exactly: 'round' → notes.round,
// any other hole_key → notes.hole[holeKey]; note === null tombstones that
// key, and an empty bucket (or an empty `notes` object entirely) is dropped
// rather than left as `{}`/`{ hole: {} }` so a fully-cleared round has no
// stray `notes` key at all — same as the RPC's COALESCE-to-omitted shape.
export function applyNoteRow(t, row) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const notes = { ...(round.notes ?? {}) };
  if (row.hole_key === 'round') {
    if (row.note == null) delete notes.round;
    else notes.round = row.note;
  } else {
    const hole = { ...(notes.hole ?? {}) };
    if (row.note == null) delete hole[row.hole_key];
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
export function applyRoundRow(t, row) {
  const next = deepClone(t);
  const rounds = (next.rounds ?? []).slice();
  const existingIdx = rounds.findIndex((r) => r.id === row.id);
  const existing = existingIdx === -1 ? null : rounds[existingIdx];
  if (existingIdx !== -1) rounds.splice(existingIdx, 1);

  const assembled = { ...(row.body ?? {}), id: row.id };
  if (existing && 'scores' in existing) assembled.scores = existing.scores;
  if (existing && 'shotDetails' in existing) assembled.shotDetails = existing.shotDetails;
  if (existing && 'notes' in existing) assembled.notes = existing.notes;

  const idx = clampIndex(row.round_index, rounds.length);
  rounds.splice(idx, 0, assembled);
  next.rounds = rounds;
  return next;
}

// game_players row: { tournament_id, player_id, user_id, pos, body }. body IS
// the whole player object (see tournamentRepo.upsertPlayer) — upsert it at
// `pos`, reordering the same way applyRoundRow does for round_index.
export function applyPlayerRow(t, row) {
  const next = deepClone(t);
  const players = (next.players ?? []).slice();
  const existingIdx = players.findIndex((p) => p.id === row.player_id);
  if (existingIdx !== -1) players.splice(existingIdx, 1);

  const assembled = { ...(row.body ?? {}) };
  const idx = clampIndex(row.pos, players.length);
  players.splice(idx, 0, assembled);
  next.players = players;
  return next;
}

// tournaments row: { id, name, kind, props, current_round }. props merges
// into the top level one level deep (Object.assign, not recursive) — name/
// kind come from their own columns, and currentRound only ever advances
// (Math.max), matching advance_game_round's GREATEST semantics server-side.
// rounds/players are restored after the merge so a props payload can never
// stomp them (props never carries either key server-side — see
// tournamentRepo.createTournament's destructure — but this patcher does not
// trust that as its only guard).
export function applyTournamentRow(t, row) {
  const next = deepClone(t);
  const { rounds, players } = next;
  Object.assign(next, row.props ?? {});
  next.rounds = rounds;
  next.players = players;
  if (row.name != null) next.name = row.name;
  if (row.kind != null) next.kind = row.kind;
  next.currentRound = Math.max(next.currentRound ?? 0, row.current_round ?? 0);
  return next;
}

const APPLIERS = {
  game_scores: applyScoreRow,
  game_shot_details: applyShotDetailRow,
  game_round_notes: applyNoteRow,
  game_rounds: applyRoundRow,
  game_players: applyPlayerRow,
  tournaments: applyTournamentRow,
};

// ── Channel lifecycle ────────────────────────────────────────────────────────

let _channel = null;
let _channelId = null;

// Shared handler tail for every table: reads the current local cache, patches
// it with the row, re-applies this tournament's still-undrained pending
// mutations on top (a realtime row is SERVER state — replaying pending
// mutations mirrors tournamentStore's own read-path overlay, so we never
// clobber an optimistic local edit whose write hasn't round-tripped yet),
// restores the device-local meId (never trusted from a realtime row, same as
// _overlayAndSave), and preserves round.scoreConflicts (LOCAL-ONLY markers —
// see mutate.js's preserveLocalScoreConflicts — that no row event ever
// carries) before saving. Skips entirely if this tournament has no local
// cache to patch (nothing to preserve, nothing to render).
function makeHandler(id, applyFn) {
  return async (payload) => {
    const row = payload?.new ?? payload?.old;
    if (!row) return;
    const cached = await readLocal(id);
    if (!cached) return;
    const patched = applyFn(cached, row);
    const entries = (await syncQueue.all()).filter((e) => e.tournamentId === id);
    let merged = applyPendingMutations(patched, entries);
    if ('meId' in cached) merged.meId = cached.meId;
    merged = preserveLocalScoreConflicts(merged, cached);
    await saveLocal(merged, { makeActive: false });
  };
}

export function stopRealtime() {
  if (_channel) supabase.removeChannel(_channel);
  _channel = null;
  _channelId = null;
}

// Idempotent: a repeat call for the same id is a no-op. A call for a
// different id tears down the old channel first. null/undefined and
// official-kind tournaments never get a channel (official tournaments have
// no game_*-backed local blob for these patchers to act on).
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

  const channel = supabase.channel(`game-${id}`);
  for (const [table, applyFn] of Object.entries(APPLIERS)) {
    const filter = table === 'tournaments' ? `id=eq.${id}` : `tournament_id=eq.${id}`;
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter },
      makeHandler(id, applyFn),
    );
  }
  channel.subscribe();

  _channel = channel;
  _channelId = id;
}
