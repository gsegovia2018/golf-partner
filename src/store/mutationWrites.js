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
      await repo.patchRound(id, m.roundId, { pairs: round.pairs });
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
      await repo.patchRound(id, m.roundId, {
        playerHandicaps: { [m.playerId]: round.playerHandicaps?.[m.playerId] ?? null },
      });
      return NO_CONFLICT;
    }

    case 'index.set': {
      const round = findRound(localTournament, m.roundId);
      if (!round) return NO_CONFLICT;
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
      return NO_CONFLICT;
    }

    case 'tournament.removePlayer': {
      await repo.deletePlayer(id, m.playerId);
      for (const patch of (m.roundPatches ?? [])) {
        await repo.clearPlayerRound(id, patch.roundId, m.playerId);
        const round = findRound(localTournament, patch.roundId);
        if (!round) continue;
        if (patch.pairs || patch.clearScoringMode) {
          const roundPatch = {};
          if (patch.pairs) roundPatch.pairs = round.pairs;
          if (patch.clearScoringMode) roundPatch.scoringMode = round.scoringMode ?? null;
          await repo.patchRound(id, patch.roundId, roundPatch);
        }
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
      return NO_CONFLICT;
    }

    default:
      throw new Error(`unknown mutation type: ${m.type}`);
  }
}
