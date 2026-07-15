// Client repository over the sync-v2 normalized `game_*` tables/RPCs — see
// supabase/migrations/20260712000000_sync_v2_normalized.sql for the server
// side (the ground truth for every RPC name/param and table shape here).
//
// Round ids are only unique per-tournament (see that migration's comment on
// game_rounds), so every round-addressed RPC/table call below carries
// tournament_id alongside round_id — never round_id alone.
//
// Every function throws on `{ error }` from supabase; callers own retry
// (the offline sync queue drains and retries, so these stay simple and
// idempotent rather than swallowing failures).

import { supabase } from '../lib/supabase';

async function getCurrentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Keys split off `round` before it becomes game_rounds.body — mirrors the
// server's own strip contract (get_game_tournament's reassembly / the
// backfill script), so a stale local computed field never lands in body.
function stripRoundHotKeys(round) {
  const {
    scores, shotDetails, notes, scoreEntries, scoreResolutions, removedPlayerIds, ...body
  } = round;
  return body;
}

// -- Reads --------------------------------------------------------------

export async function fetchTournament(id) {
  const { data, error } = await supabase.rpc('get_game_tournament', { p_id: id });
  if (error) throw error;
  return data ?? null;
}

export async function fetchMyTournaments() {
  const { data, error } = await supabase.rpc('get_my_game_tournaments');
  if (error) throw error;
  return (data ?? []).map(({ tournament, role }) => ({ ...tournament, _role: role }));
}

// One row per round across the given tournaments — see
// supabase/migrations/20260713000000_round_activity_rpc.sql. Returns one row
// per ROUND (not per score cell), which dramatically raises the response-size
// ceiling vs a raw .from('game_scores') select — but does NOT remove it:
// PostgREST's db-max-rows (config.toml max_rows, 1000) also caps RPCs that
// return SETOF/TABLE, so a caller with enough tournaments could still exceed
// it in one call. This wrapper issues a single RPC for the ids it is given;
// the caller (feedStore) is responsible for chunking a large id list into
// bounded batches so each call stays well under the cap. Used by feedStore
// for real per-round activity recency.
export async function fetchRoundActivity(tournamentIds) {
  const { data, error } = await supabase.rpc('get_round_activity', {
    p_tournament_ids: tournamentIds,
  });
  if (error) throw error;
  return data ?? [];
}

// -- Per-cell writes ------------------------------------------------------

export async function setScore({
  tournamentId, roundId, playerId, hole, strokes,
}) {
  const { data, error } = await supabase.rpc('set_game_score', {
    p_round_id: roundId,
    p_tournament_id: tournamentId,
    p_player_id: playerId,
    p_hole: hole,
    p_strokes: strokes,
  });
  if (error) throw error;
  return data;
}

export async function submitScore({
  tournamentId, roundId, playerId, hole, authorId, strokes,
}) {
  const { data, error } = await supabase.rpc('submit_game_score', {
    p_tournament_id: tournamentId,
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_author_id: authorId,
    p_strokes: strokes,
  });
  if (error) throw error;
  return data;
}

export async function resolveScore({
  tournamentId, roundId, playerId, hole, value, resolvedBy,
}) {
  const { error } = await supabase.rpc('resolve_game_score', {
    p_tournament_id: tournamentId,
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_value: value,
    p_resolver: resolvedBy,
  });
  if (error) throw error;
}

// detail === null is a tombstone (a cleared cell), not "skip the write" —
// the row is upserted either way so deletes replicate correctly.
export async function setShotDetail({
  tournamentId, roundId, playerId, hole, detail,
}) {
  const { error } = await supabase.from('game_shot_details').upsert({
    tournament_id: tournamentId,
    round_id: roundId,
    player_id: playerId,
    hole,
    detail: detail ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tournament_id,round_id,player_id,hole' });
  if (error) throw error;
}

// note === null/'' both write a null tombstone row (same reasoning as
// setShotDetail above).
export async function setNote({
  tournamentId, roundId, holeKey, note,
}) {
  const { error } = await supabase.from('game_round_notes').upsert({
    tournament_id: tournamentId,
    round_id: roundId,
    hole_key: holeKey,
    note: note || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tournament_id,round_id,hole_key' });
  if (error) throw error;
}

// -- Round / tournament patches -------------------------------------------

export async function patchRound(tournamentId, roundId, patch) {
  const { error } = await supabase.rpc('patch_game_round', {
    p_tournament_id: tournamentId,
    p_round_id: roundId,
    p_patch: patch,
  });
  if (error) throw error;
}

export async function patchTournament(id, patch) {
  const { error } = await supabase.rpc('patch_game_tournament', { p_id: id, p_patch: patch });
  if (error) throw error;
}

export async function advanceRound(id, roundIndex) {
  const { error } = await supabase.rpc('advance_game_round', { p_id: id, p_round: roundIndex });
  if (error) throw error;
}

// -- Players ----------------------------------------------------------------

export async function upsertPlayer(tournamentId, player, pos) {
  const { error } = await supabase.from('game_players').upsert({
    tournament_id: tournamentId,
    player_id: player.id,
    user_id: player.user_id ?? null,
    pos,
    body: player,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tournament_id,player_id' });
  if (error) throw error;
}

export async function deletePlayer(tournamentId, playerId) {
  const { error } = await supabase.from('game_players')
    .delete()
    .match({ tournament_id: tournamentId, player_id: playerId });
  if (error) throw error;
}

// -- Deletions ----------------------------------------------------------------

// Drops every server row that mirrors a removed player's per-round state.
// game_score_entries (the per-author submission layer added in
// 20260713000000_score_entries.sql) has no FK cascade off game_players, so
// without an explicit delete here a removed player's rows survive on the
// server and a later realtime INSERT/reconcile fetch can re-patch them into
// a device's local cache, resurrecting the phantom-conflict bug that
// mutate.js's removePlayer branch + preserveLocalConflictState's
// pruneToKnownPlayers guard otherwise kill locally.
export async function clearPlayerRound(tournamentId, roundId, playerId) {
  const { error: scoresError } = await supabase.from('game_scores')
    .delete()
    .match({ tournament_id: tournamentId, round_id: roundId, player_id: playerId });
  if (scoresError) throw scoresError;

  const { error: shotDetailsError } = await supabase.from('game_shot_details')
    .delete()
    .match({ tournament_id: tournamentId, round_id: roundId, player_id: playerId });
  if (shotDetailsError) throw shotDetailsError;

  const { error: scoreEntriesError } = await supabase.from('game_score_entries')
    .delete()
    .match({ tournament_id: tournamentId, round_id: roundId, player_id: playerId });
  if (scoreEntriesError) throw scoreEntriesError;
}

// Cascades to game_scores/game_shot_details/game_round_notes via the FK ON
// DELETE CASCADE declared on those tables.
export async function deleteRound(tournamentId, roundId) {
  const { error } = await supabase.from('game_rounds')
    .delete()
    .match({ tournament_id: tournamentId, id: roundId });
  if (error) throw error;
}

// -- Round upsert -------------------------------------------------------------

export async function upsertRound(tournamentId, roundIndex, round) {
  const { error } = await supabase.from('game_rounds').upsert({
    id: round.id,
    tournament_id: tournamentId,
    round_index: roundIndex,
    body: stripRoundHotKeys(round),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tournament_id,id' });
  if (error) throw error;
}

// -- Tournament creation --------------------------------------------------

// Splits a full local tournament object into the tournaments row (columns +
// props) plus game_players/game_rounds rows, and — for offline-created
// tournaments that already carry scores/shotDetails/notes by the time they
// drain — fans those out into their own row sets too. Plain upserts
// throughout: idempotent, since the sync queue may retry this write. Every
// row carries an explicit updated_at stamp for the same reason — a retry
// hits the UPDATE arm of the upsert, which does not fire the column's
// INSERT-only DEFAULT now(), and would otherwise leave updated_at stale.
export async function createTournament(t) {
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();
  const {
    id, name, kind, createdAt, currentRound, players, rounds, meId, _meta, ...rest
  } = t;

  // The tournaments.kind COLUMN is CHECK-constrained to 'casual'/'official',
  // so the app's domain kind ('game'/'tournament') can't live there — it goes
  // in props.kind, which get_game_tournament re-emits via
  // COALESCE(props->>'kind', column). Map the column to 'official' for
  // official mode, else 'casual'; keep the true domain kind in props.
  const props = { ...rest, kind };

  // tournaments.data is a legacy NOT NULL jsonb column (the pre-sync-v2 blob).
  // The normalized read path (get_game_tournament) ignores it, and claim/release
  // now source the roster from game_players — but the column is still NOT NULL,
  // so a new tournament must write a device-agnostic snapshot here. Omitting it
  // makes the upsert fail with 23502, which the drain drops as permanent and
  // no new game ever reaches the server. meId is device-local and _meta is the
  // retired LWW map, so neither belongs in the shared blob.
  const data = { id, name, kind, createdAt, currentRound, players, rounds, ...rest };

  const tournamentRow = {
    id,
    name,
    kind: kind === 'official' ? 'official' : 'casual',
    created_at: createdAt,
    data,
    props,
    current_round: currentRound ?? null,
  };
  if (userId) tournamentRow.created_by = userId;

  const { error: tError } = await supabase.from('tournaments').upsert(tournamentRow);
  if (tError) throw tError;

  const playerRows = (players ?? []).map((player, pos) => ({
    tournament_id: id,
    player_id: player.id,
    user_id: player.user_id ?? null,
    pos,
    body: player,
    updated_at: now,
  }));
  if (playerRows.length) {
    const { error } = await supabase.from('game_players')
      .upsert(playerRows, { onConflict: 'tournament_id,player_id' });
    if (error) throw error;
  }

  const roundRows = [];
  const scoreRows = [];
  const shotDetailRows = [];
  const noteRows = [];

  (rounds ?? []).forEach((round, roundIndex) => {
    roundRows.push({
      id: round.id,
      tournament_id: id,
      round_index: roundIndex,
      body: stripRoundHotKeys(round),
      updated_at: now,
    });

    Object.entries(round.scores ?? {}).forEach(([playerId, holes]) => {
      Object.entries(holes ?? {}).forEach(([hole, strokes]) => {
        scoreRows.push({
          round_id: round.id, tournament_id: id, player_id: playerId, hole: Number(hole), strokes,
          updated_at: now,
        });
      });
    });

    Object.entries(round.shotDetails ?? {}).forEach(([playerId, holes]) => {
      Object.entries(holes ?? {}).forEach(([hole, detail]) => {
        shotDetailRows.push({
          round_id: round.id, tournament_id: id, player_id: playerId, hole: Number(hole), detail,
          updated_at: now,
        });
      });
    });

    if (round.notes?.round != null) {
      noteRows.push({
        round_id: round.id, tournament_id: id, hole_key: 'round', note: round.notes.round,
        updated_at: now,
      });
    }
    Object.entries(round.notes?.hole ?? {}).forEach(([holeKey, note]) => {
      noteRows.push({
        round_id: round.id, tournament_id: id, hole_key: holeKey, note,
        updated_at: now,
      });
    });
  });

  if (roundRows.length) {
    const { error } = await supabase.from('game_rounds')
      .upsert(roundRows, { onConflict: 'tournament_id,id' });
    if (error) throw error;
  }
  if (scoreRows.length) {
    const { error } = await supabase.from('game_scores')
      .upsert(scoreRows, { onConflict: 'tournament_id,round_id,player_id,hole' });
    if (error) throw error;
  }
  if (shotDetailRows.length) {
    const { error } = await supabase.from('game_shot_details')
      .upsert(shotDetailRows, { onConflict: 'tournament_id,round_id,player_id,hole' });
    if (error) throw error;
  }
  if (noteRows.length) {
    const { error } = await supabase.from('game_round_notes')
      .upsert(noteRows, { onConflict: 'tournament_id,round_id,hole_key' });
    if (error) throw error;
  }
}
