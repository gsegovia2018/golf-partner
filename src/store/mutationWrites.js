// Executes one queued mutation against the server via the Task 6 repository
// (tournamentRepo), writing the row(s) that mirror what the local blob
// already holds post-mutation. Mirrors the mutation catalog in
// metaPathFor/applyToTournament (mutate.js) — every type there has a branch
// below EXCEPT tournament.setMe (local-only, never enqueued — mutate() short
// -circuits it) and player.upsertLibrary (stays in syncWorker's legacy RPC
// branch, drained separately with tournamentId: null).
//
// Reads round/player values from `localTournament` (the local blob AFTER the
// mutation was applied) rather than the mutation payload wherever a value is
// derived state (pairs, scoringMode, handicaps, ...) — the mutation only
// carries the delta, but the server row wants the resulting value. When the
// referenced round/player is no longer present locally (a later queued
// mutation removed it), the write is skipped rather than crashing.
import * as repo from './tournamentRepo';
import { syncTournamentParticipants } from './tournamentStore';

// Mirrors user-linked players into tournament_participants (see
// tournamentStore.js's syncTournamentParticipants) after any mutation that
// can change a player's user_id. Best-effort: a failed participant sync must
// never fail the mutation that already landed.
function syncParticipantsBestEffort(localTournament) {
  syncTournamentParticipants(localTournament).catch(() => {});
}

function findRound(localTournament, roundId) {
  return (localTournament.rounds ?? []).find((r) => r.id === roundId);
}

function findPlayerIndex(localTournament, playerId) {
  return (localTournament.players ?? []).findIndex((p) => p.id === playerId);
}

const NO_CONFLICT = { conflict: null };

// Fields the round.upsert emitters actually own/rebuild themselves — read
// each site before touching this list:
//   - EditTournamentScreen.js: courseName (updateCourseName), holes+tees
//     (handleHolesSaved, fed by CourseEditorScreen's onSave({holes, tees})).
//     addRound also seeds a brand-new round's playerTees (empty {}), which
//     is otherwise PlayersScreen's field (below).
//   - PlayersScreen.js: playerTees (handleRoundTeesChange).
//   - courseId: never edited directly by either screen, but travels with
//     holes/tees as "which library course this round is" identity, and no
//     other mutation type owns it — safe/expected to ride along.
//   - tournamentStore.js's propagatePlayerToTournaments /
//     propagateCourseToTournaments sweeps also emit round.upsert (course
//     propagation rebuilds holes/tees/playerTees; player propagation only
//     touches pairs/playerHandicaps, both excluded below, so its round.upsert
//     becomes a no-op post-fix — see the callers for why that's the accepted
//     trade-off).
//
// `notes` is deliberately NOT in this list (Task 13.2 fix): get_game_tournament
// reassembles a round's notes from game_round_notes, not game_rounds.body (see
// that RPC's `gr.body - 'notes'` strip), so patching notes into body here
// would write data the read path can never see — a dead write masking the
// real bug (round-note edits never reaching game_round_notes). Round-note
// edits must go through their own note.set mutation instead (see
// EditTournamentScreen.js's debounced save effect).
//
// Every field NOT in this list is derived/owned-elsewhere state with its own
// dedicated mutation (pairs.set, round.reveal, round.setScoringMode,
// round.setBestBallValues, handicap.set, index.set, note.set) and must NEVER
// ride along in this patch — these screens deliberately don't refresh
// round-level fields while open (to protect in-flight edits), so m.round can
// be stale w.r.t. a concurrent device's write to one of those fields. Sending
// the stale value here would silently revert that concurrent write (the HIGH
// regression this fixes). Kept as an explicit allowlist (not a blocklist) so
// a future round field defaults to NOT syncing here until someone deliberately
// adds it.
const ROUND_UPSERT_OWNED_FIELDS = ['courseName', 'courseId', 'holes', 'tees', 'playerTees'];

function roundUpsertOwnedPatch(round) {
  const patch = {};
  for (const key of ROUND_UPSERT_OWNED_FIELDS) {
    if (round[key] !== undefined) patch[key] = round[key];
  }
  return patch;
}

// Executes one queued mutation against the server. Always returns
// { conflict: null } — score.set/conflict.resolve no longer raise a
// one-sided, clock-based conflict here; conflict state is derived from
// synced per-author score entries (store/scoreEntries.js) instead.
export async function executeMutation(entry, localTournament) {
  const { tournamentId: id, mutation: m } = entry;

  switch (m.type) {
    case 'score.set': {
      await repo.submitScore({
        tournamentId: id, roundId: m.roundId, playerId: m.playerId,
        hole: m.hole, authorId: m.authorId, strokes: m.value,
      });
      // Conflict state is derived from synced entries (store/scoreEntries.js),
      // never raised one-sidedly here.
      return NO_CONFLICT;
    }

    case 'conflict.resolve': {
      // This IS the resolution — it never raises a conflict of its own.
      await repo.resolveScore({
        tournamentId: id, roundId: m.roundId, playerId: m.playerId,
        hole: m.hole, value: m.value, resolvedBy: m.resolvedBy,
      });
      return NO_CONFLICT;
    }

    case 'shot.set': {
      await repo.setShotDetail({
        tournamentId: id, roundId: m.roundId, playerId: m.playerId, hole: m.hole, detail: m.detail,
      });
      return NO_CONFLICT;
    }

    case 'note.set': {
      const holeKey = m.scope === 'hole' ? String(m.hole) : 'round';
      await repo.setNote({
        tournamentId: id, roundId: m.roundId, holeKey, note: m.text,
      });
      return NO_CONFLICT;
    }

    case 'pairs.set': {
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
      // applyToTournament also flips `revealed` (setting pairs reveals them,
      // unless m.reveal === false preserved a future round's unrevealed
      // state) — mirror whatever the local round now holds. This is the only
      // live reveal path for team edits (EditTeamsScreen), so dropping it
      // would leave the reveal state stranded on other devices.
      await repo.patchRound(id, m.roundId, {
        pairs: round.pairs,
        revealed: !!round.revealed,
      });
      return NO_CONFLICT;
    }

    case 'round.setScoringMode': {
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
      await repo.patchRound(id, m.roundId, {
        scoringMode: round.scoringMode ?? null,
        pairs: round.pairs ?? null,
      });
      return NO_CONFLICT;
    }

    case 'round.setBestBallValues': {
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
      await repo.patchRound(id, m.roundId, {
        bestBallValue: round.bestBallValue,
        worstBallValue: round.worstBallValue,
      });
      return NO_CONFLICT;
    }

    case 'tournament.setTeamSettings': {
      const settings = localTournament.settings ?? {};
      await repo.patchTournament(id, {
        settings: { fixedTeams: settings.fixedTeams, manualTeams: settings.manualTeams },
      });
      return NO_CONFLICT;
    }

    case 'handicap.set': {
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
      // applyToTournament also stamps manualHandicaps[playerId] = true — the
      // flag recomputeRoundPlayingHandicaps uses to know this entry is a
      // manual override (never auto-recomputed). One-level merge preserves
      // other players' keys in both maps.
      await repo.patchRound(id, m.roundId, {
        playerHandicaps: { [m.playerId]: round.playerHandicaps?.[m.playerId] ?? null },
        manualHandicaps: { [m.playerId]: round.manualHandicaps?.[m.playerId] ?? null },
      });
      return NO_CONFLICT;
    }

    case 'index.set': {
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
      // applyToTournament's index.set touches ONLY playerIndexes: the
      // recomputed playing handicap rides its own handicap.set mutation
      // (queued alongside by the caller) and manualHandicaps is untouched —
      // so this patch deliberately carries nothing else.
      await repo.patchRound(id, m.roundId, {
        playerIndexes: { [m.playerId]: round.playerIndexes?.[m.playerId] ?? null },
      });
      return NO_CONFLICT;
    }

    case 'round.remove': {
      await repo.deleteRound(id, m.roundId);
      return NO_CONFLICT;
    }

    case 'tournament.addPlayer': {
      const idx = findPlayerIndex(localTournament, m.player.id);
      if (idx !== -1) await repo.upsertPlayer(id, m.player, idx);
      for (const patch of (m.roundPatches ?? [])) {
        const round = findRound(localTournament, patch.roundId);
        if (!round) continue;
        const roundPatch = {
          playerHandicaps: { [m.player.id]: round.playerHandicaps?.[m.player.id] ?? null },
        };
        if (patch.pairs) roundPatch.pairs = round.pairs;
        if (patch.clearScoringMode) roundPatch.scoringMode = round.scoringMode ?? null;
        await repo.patchRound(id, patch.roundId, roundPatch);
      }
      if (m.nextScoringMode) {
        await repo.patchTournament(id, { settings: { scoringMode: m.nextScoringMode } });
      }
      // A player added directly from a friend picker can already carry a
      // user_id — mirror it into tournament_participants same as claimPlayer.
      syncParticipantsBestEffort(localTournament);
      return NO_CONFLICT;
    }

    case 'tournament.removePlayer': {
      await repo.deletePlayer(id, m.playerId);
      for (const patch of (m.roundPatches ?? [])) {
        await repo.clearPlayerRound(id, patch.roundId, m.playerId);
        const round = findRound(localTournament, patch.roundId);
        if (!round) continue;
        // Null out the removed player's per-round body keys. Locally,
        // applyToTournament DELETES playerHandicaps[pid]; patch_game_round's
        // one-level merge can't delete nested keys, so we write JSON null
        // instead — a deliberate null-vs-absent cosmetic divergence: every
        // consumer reads these maps with ?./??, so null and absent behave
        // identically. playerIndexes/manualHandicaps get the same null for
        // hygiene (a re-added player with the same id must not inherit
        // stale index/manual-override state from the server body).
        const roundPatch = {
          playerHandicaps: { [m.playerId]: null },
          playerIndexes: { [m.playerId]: null },
          manualHandicaps: { [m.playerId]: null },
        };
        if (patch.pairs) roundPatch.pairs = round.pairs;
        if (patch.clearScoringMode) roundPatch.scoringMode = round.scoringMode ?? null;
        await repo.patchRound(id, patch.roundId, roundPatch);
      }
      if (m.nextScoringMode) {
        await repo.patchTournament(id, { settings: { scoringMode: m.nextScoringMode } });
      }
      return NO_CONFLICT;
    }

    case 'tournament.setFinished': {
      await repo.patchTournament(id, { finishedAt: localTournament.finishedAt ?? null });
      return NO_CONFLICT;
    }

    case 'tournament.claimPlayer': {
      const idx = findPlayerIndex(localTournament, m.playerId);
      if (idx === -1) return NO_CONFLICT;
      await repo.upsertPlayer(id, localTournament.players[idx], idx);
      syncParticipantsBestEffort(localTournament);
      return NO_CONFLICT;
    }

    case 'tournament.setScoringMode': {
      await repo.patchTournament(id, { settings: { scoringMode: m.scoringMode } });
      for (const patch of (m.roundPatches ?? [])) {
        const round = findRound(localTournament, patch.roundId);
        if (!round) continue;
        const roundPatch = { scoringMode: round.scoringMode ?? null };
        if (patch.pairs) roundPatch.pairs = round.pairs;
        await repo.patchRound(id, patch.roundId, roundPatch);
      }
      return NO_CONFLICT;
    }

    case 'tournament.advanceRound': {
      await repo.advanceRound(id, m.roundIndex);
      return NO_CONFLICT;
    }

    case 'round.reveal': {
      await repo.patchRound(id, m.roundId, {
        revealed: true,
        ...(m.pairs ? { pairs: m.pairs } : {}),
      });
      return NO_CONFLICT;
    }

    case 'tournament.updateProfile': {
      await repo.patchTournament(id, m.patch);
      return NO_CONFLICT;
    }

    case 'tournament.create': {
      await repo.createTournament(m.tournament);
      syncParticipantsBestEffort(m.tournament);
      return NO_CONFLICT;
    }

    case 'round.resetContent': {
      // Reset Round / Undo / Restore snapshot (HomeScreen): a whole-round
      // scores+notes replace. There's no bulk-replace RPC for the normalized
      // game_scores/game_round_notes tables, so this writes the round's full
      // grid cell by cell, mirroring the granular score.set/note.set writes.
      // A rare, low-frequency user action, so the extra round trips are an
      // acceptable trade for reusing the existing per-cell repo primitives
      // instead of adding bulk endpoints.
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
      const players = localTournament.players ?? [];
      const holes = round.holes ?? [];
      for (const p of players) {
        for (const h of holes) {
          const strokes = round.scores?.[p.id]?.[h.number] ?? null;
          await repo.setScore({
            tournamentId: id, roundId: m.roundId, playerId: p.id, hole: h.number, strokes,
          });
        }
      }
      const notes = round.notes ?? {};
      await repo.setNote({
        tournamentId: id, roundId: m.roundId, holeKey: 'round', note: notes.round ?? null,
      });
      for (const h of holes) {
        await repo.setNote({
          tournamentId: id, roundId: m.roundId, holeKey: String(h.number), note: notes.hole?.[h.number] ?? null,
        });
      }
      await repo.patchRound(id, m.roundId, { resetHistory: round.resetHistory ?? [] });
      return NO_CONFLICT;
    }

    case 'round.upsert': {
      // Whole-round upsert (EditTournamentScreen / PlayersScreen bulk save,
      // plus tournamentStore's propagatePlayerToTournaments /
      // propagateCourseToTournaments sweeps). A genuinely NEW round (server
      // has never seen this id — e.g. EditTournamentScreen's addRound mid-
      // edit) can't clobber anything, so it still gets the full-body
      // repo.upsertRound (which already strips scores/shotDetails/notes-
      // table-owned keys/scoreEntries/scoreResolutions before writing body).
      //
      // An EXISTING round instead gets ONLY its owned fields (see
      // ROUND_UPSERT_OWNED_FIELDS above) patched via repo.patchRound's
      // one-level merge — never the whole stale body — so a screen that's
      // deliberately not refreshing round-level fields while open can't
      // silently revert a concurrent device's pairs.set / round.reveal /
      // round.setScoringMode / round.setBestBallValues / handicap.set /
      // index.set write.
      //
      // isNew is stamped by the emitting screen/sweep from whether the round
      // existed in its pre-edit tournament snapshot. A caller that omits it
      // defaults to false/existing (patch-only) — the safe default: a missed
      // NEW round just means its non-owned fields arrive via their own
      // dedicated mutations, whereas a missed EXISTING round is exactly the
      // clobber being fixed here.
      if (m.isNew) {
        await repo.upsertRound(id, m.roundIndex, m.round);
        return NO_CONFLICT;
      }
      const patch = roundUpsertOwnedPatch(m.round ?? {});
      if (Object.keys(patch).length > 0) {
        await repo.patchRound(id, m.roundId, patch);
      }
      return NO_CONFLICT;
    }

    case 'tournament.updatePlayer': {
      const idx = findPlayerIndex(localTournament, m.playerId);
      if (idx === -1) return NO_CONFLICT;
      await repo.upsertPlayer(id, localTournament.players[idx], idx);
      // e.g. PlayersScreen's friend-link flow patches user_id through here.
      syncParticipantsBestEffort(localTournament);
      return NO_CONFLICT;
    }

    default:
      throw new Error(`unknown mutation type: ${m.type}`);
  }
}
