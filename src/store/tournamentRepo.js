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
// server's own strip contract (get_game_tournament's reassembly), so a stale
// local computed field never lands in body. All three are reassembled by the
// RPC from their own tables, `scores`/`shotDetails` now as a projection of
// the scorer_cards the phones own.
function stripRoundHotKeys(round) {
  const { scores, shotDetails, notes, ...body } = round;
  // Defense in depth: pairs persist ids only (see scoring.js thinPairs). The
  // patch builders in tournamentStore already thin, so in practice this is a
  // no-op; it catches any future caller that assembles a round body without
  // going through them. Lazy require matches this module's existing style for
  // breaking the scoring <-> store cycle.
  const { thinPairs } = require('./scoring');
  return 'pairs' in body ? { ...body, pairs: thinPairs(body.pairs) } : body;
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

// note === null/'' both write a null tombstone row: the row is upserted
// either way so deletes replicate correctly.
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
  // user_id is included ONLY when the local copy carries a claim. The column
  // is the source of truth (20260728000000) and get_game_tournament projects
  // identity from it — but this device's blob can be STALE about claims made
  // elsewhere (or stripped by a fetch that raced one). PostgREST builds the
  // conflict-update SET list from the payload keys, so omitting the key
  // leaves the server's claim untouched, while an explicit `user_id: null`
  // here would erase it. Un-claiming is exclusively
  // release_tournament_player's job; no client write path unlinks.
  const { error } = await supabase.from('game_players').upsert({
    tournament_id: tournamentId,
    player_id: player.id,
    ...(player.user_id ? { user_id: player.user_id } : {}),
    pos,
    body: player,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tournament_id,player_id' });
  if (error) throw error;
}

// SOFT delete (20260903000000): stamps deleted_at rather than removing the
// row. get_game_tournament still omits the player from `players`, but now also
// reports the id in `deletedPlayerIds` — which is what lets the read path tell
// "removed on another device" apart from "this device's add never landed", and
// so keep the second one instead of erasing it (see unionLocalRoster in
// mutate.js). A hard delete makes those two cases indistinguishable.
//
// Re-adding the same person clears the tombstone via
// add_tournament_player_if_room; upsertPlayer above deliberately does not
// touch deleted_at, so a routine field write can never resurrect them.
export async function deletePlayer(tournamentId, playerId) {
  const { error } = await supabase.from('game_players')
    .update({ deleted_at: new Date().toISOString() })
    .match({ tournament_id: tournamentId, player_id: playerId });
  if (error) throw error;
}

// -- Deletions ----------------------------------------------------------------

// Drops the projected rows that mirror a removed player's per-round state.
// The scorer_cards these are projected FROM are not touched: a card is one
// scorer's document, only that device writes it, and the next publication of
// any hole re-projects the round anyway. Removing a player is a roster fact;
// the cells they were marked on stay in whoever's card recorded them.
export async function clearPlayerRound(tournamentId, roundId, playerId) {
  const { error: scoresError } = await supabase.from('game_scores')
    .delete()
    .match({ tournament_id: tournamentId, round_id: roundId, player_id: playerId });
  if (scoresError) throw scoresError;

  const { error: shotDetailsError } = await supabase.from('game_shot_details')
    .delete()
    .match({ tournament_id: tournamentId, round_id: roundId, player_id: playerId });
  if (shotDetailsError) throw shotDetailsError;
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

  // The legacy tournaments.data blob is gone (migration 20260728000002). It
  // was written here only because the column was NOT NULL — omitting it raised
  // 23502, which the drain dropped as permanent, so no new game reached the
  // server. Nothing read it as a source of truth after sync-v2: the roster and
  // rounds are written to game_players/game_rounds below.
  const tournamentRow = {
    id,
    name,
    kind: kind === 'official' ? 'official' : 'casual',
    created_at: createdAt,
    props,
    current_round: currentRound ?? null,
  };
  if (userId) tournamentRow.created_by = userId;

  const playerRows = (players ?? []).map((player, pos) => ({
    tournament_id: id,
    player_id: player.id,
    user_id: player.user_id ?? null,
    pos,
    body: player,
    updated_at: now,
  }));

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

  // One transactional RPC (migration 20260728000006), NOT six upserts.
  // Writing the tournaments row, then players, then rounds as separate
  // statements left a window in which the server held a tournament with no
  // rounds. A fetch landing there returned a round-less game, which
  // _overlayAndSave then wrote over the local copy, and the render blew up on
  // `rounds[selectedRound]` being undefined. The function body is a single
  // transaction, so a game is now visible complete or not at all.
  //
  // The rows are still shaped here: keeping props/kind mapping and
  // stripRoundHotKeys client-side means the payload cannot drift from what
  // get_game_tournament expects to reassemble.
  const { error } = await supabase.rpc('create_game_tournament', {
    p_payload: {
      tournament: tournamentRow,
      players: playerRows,
      rounds: roundRows,
      scores: scoreRows,
      shot_details: shotDetailRows,
      notes: noteRows,
    },
  });
  if (error) throw error;
}
