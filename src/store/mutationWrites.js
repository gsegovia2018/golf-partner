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

// Executes one queued mutation against the server. Returns { conflict }
// where conflict is null except for score.set: a
// { roundId, playerId, hole, mine, theirs } object when the row we just
// overwrote held a different value that was committed server-side after our
// local write went stale (entry.ts) — i.e. we stomped a newer value.
export async function executeMutation(entry, localTournament) {
  const { tournamentId: id, mutation: m } = entry;

  switch (m.type) {
    case 'score.set': {
      const result = await repo.setScore({
        tournamentId: id, roundId: m.roundId, playerId: m.playerId, hole: m.hole, strokes: m.value,
      });
      if (
        result
        && result.previousStrokes != null
        && result.previousStrokes !== m.value
        && new Date(result.previousUpdatedAt).getTime() > entry.ts
      ) {
        return {
          conflict: {
            roundId: m.roundId,
            playerId: m.playerId,
            hole: m.hole,
            mine: m.value,
            theirs: result.previousStrokes,
          },
        };
      }
      return NO_CONFLICT;
    }

    case 'conflict.resolve': {
      // This IS the resolution — it never raises a conflict of its own.
      await repo.setScore({
        tournamentId: id, roundId: m.roundId, playerId: m.playerId, hole: m.hole, strokes: m.value,
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
      // Whole-round upsert (EditTournamentScreen / PlayersScreen bulk save —
      // course/holes/tees/handicaps edited together, and brand-new rounds
      // added mid-edit). upsertRound already strips scores/shotDetails/notes/
      // scoreConflicts/scoreResolutions before writing body, so this can't
      // clobber per-cell tables it doesn't own.
      await repo.upsertRound(id, m.roundIndex, m.round);
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
