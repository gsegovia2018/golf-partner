import { syncQueue } from './syncQueue';
import { saveLocal, _setSyncStatus } from './tournamentStore';
import { isOnline } from '../lib/connectivity';
import { normalizeRoundNotes } from './roundNotes';

// Maps a mutation to the in-tournament `_meta` path it bumps.
// Returns null for library-only mutations (which do not touch the tournament blob).
function metaPathFor(m) {
  switch (m.type) {
    case 'score.set':    return `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`;
    // Per-player, per-hole shot detail (putts / drive / penalties).
    case 'shot.set':     return `rounds.${m.roundId}.shotDetails.${m.playerId}.h${m.hole}`;
    case 'note.set':
      return m.scope === 'hole'
        ? `rounds.${m.roundId}.notes.hole.${m.hole}`
        : `rounds.${m.roundId}.notes.round`;
    case 'pairs.set':    return `rounds.${m.roundId}.pairs`;
    case 'handicap.set': return `rounds.${m.roundId}.playerHandicaps.${m.playerId}`;
    // Structural round deletion: tombstone path consumed by mergeTournaments
    // so the round stays gone after the next remote refresh.
    case 'round.remove': return `rounds.${m.roundId}._deleted`;
    // Players array LWW's as a single unit. Two concurrent offline adds
    // from different devices → last sync wins; this edge case is out of v1
    // scope per the spec's conflict section. Adding a player mid-round also
    // touches per-round playing handicaps and pairs, so this mutation bumps
    // several paths at once.
    case 'tournament.addPlayer': {
      const paths = ['players'];
      for (const patch of (m.roundPatches ?? [])) {
        paths.push(`rounds.${patch.roundId}.playerHandicaps.${m.player.id}`);
        if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
      }
      if (m.nextScoringMode) paths.push('settings.scoringMode');
      return paths;
    }
    // Removing a player drops them from the roster and clears their per-round
    // scores / shot detail / handicap; like addPlayer it can also flip the
    // scoring mode, so this mutation bumps several paths at once.
    case 'tournament.removePlayer': {
      const paths = ['players'];
      for (const patch of (m.roundPatches ?? [])) {
        paths.push(`rounds.${patch.roundId}.playerHandicaps.${m.playerId}`);
        paths.push(`rounds.${patch.roundId}.scores.${m.playerId}`);
        paths.push(`rounds.${patch.roundId}.shotDetails.${m.playerId}`);
        paths.push(`rounds.${patch.roundId}.scoreConflicts.${m.playerId}`);
        if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
      }
      if (m.nextScoringMode) paths.push('settings.scoringMode');
      return paths;
    }
    // Archive / reopen a tournament. Scalar LWW path.
    case 'tournament.setFinished': return `finishedAt`;
    // Which tournament player is "me" (drives shot-detail tracking). Per-
    // device identity — never synced, never stamped in _meta. Handled as a
    // local-only mutation in mutate() below (short-circuited before enqueue).
    case 'tournament.setMe': return null;
    // A joining editor links their account to a tournament player: stamps
    // that player's user_id (the joiner's claim must propagate to other
    // devices). The local meId update is intentional but device-local, so
    // it is NOT stamped — mergeTournaments restores local meId per device.
    case 'tournament.claimPlayer': return 'players';
    // Mid-game scoring-mode change: bumps the mode flag plus, for every round
    // whose pairs were rebuilt to match the new mode, that round's pairs path.
    case 'tournament.setScoringMode': {
      const paths = ['settings.scoringMode'];
      for (const patch of (m.roundPatches ?? [])) {
        if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
      }
      return paths;
    }
    // Resolving a score conflict writes the chosen value AND clears the
    // marker; both LWW-merge, so both paths are stamped.
    case 'conflict.resolve': return [
      `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`,
      `rounds.${m.roundId}.scoreConflicts.${m.playerId}.h${m.hole}`,
    ];
    case 'player.upsertLibrary': return null;
    default: throw new Error(`unknown mutation type: ${m.type}`);
  }
}

// Applies the mutation's side effect to a cloned tournament object in place.
export function applyToTournament(t, m) {
  switch (m.type) {
    case 'score.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      if (m.value == null) delete round.scores[m.playerId][m.hole];
      else round.scores[m.playerId][m.hole] = m.value;
      break;
    }
    case 'conflict.resolve': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      round.scores[m.playerId][m.hole] = m.value;
      if (round.scoreConflicts?.[m.playerId]) {
        round.scoreConflicts = { ...round.scoreConflicts };
        round.scoreConflicts[m.playerId] = { ...round.scoreConflicts[m.playerId] };
        delete round.scoreConflicts[m.playerId][m.hole];
      }
      break;
    }
    case 'shot.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.shotDetails = { ...(round.shotDetails ?? {}) };
      round.shotDetails[m.playerId] = { ...(round.shotDetails[m.playerId] ?? {}) };
      if (m.detail == null) delete round.shotDetails[m.playerId][m.hole];
      else round.shotDetails[m.playerId][m.hole] = m.detail;
      break;
    }
    case 'note.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      if (m.scope === 'hole') {
        round.notes = normalizeRoundNotes(round.notes);
        round.notes.hole[m.hole] = m.text;
      } else {
        round.notes = { ...normalizeRoundNotes(round.notes), round: m.text };
      }
      break;
    }
    case 'pairs.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.pairs = m.pairs;
      // `revealed` is monotonic — setting pairs reveals them, except when a
      // fixed-teams edit propagates pairs to future rounds that haven't had
      // their own reveal yet (m.reveal === false preserves their state).
      if (m.reveal !== false) round.revealed = true;
      break;
    }
    case 'handicap.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.playerHandicaps = { ...(round.playerHandicaps ?? {}), [m.playerId]: m.handicap };
      round.manualHandicaps = { ...(round.manualHandicaps ?? {}), [m.playerId]: true };
      break;
    }
    case 'tournament.addPlayer': {
      t.players = [...(t.players ?? []), m.player];
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (!round) continue;
        round.playerHandicaps = {
          ...(round.playerHandicaps ?? {}),
          [m.player.id]: patch.playerHandicap,
        };
        if (patch.pairs) round.pairs = patch.pairs;
      }
      if (m.nextScoringMode) {
        t.settings = { ...(t.settings ?? {}), scoringMode: m.nextScoringMode };
      }
      break;
    }
    case 'tournament.removePlayer': {
      t.players = (t.players ?? []).filter((p) => p.id !== m.playerId);
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (!round) continue;
        const handicaps = { ...(round.playerHandicaps ?? {}) };
        delete handicaps[m.playerId];
        round.playerHandicaps = handicaps;
        const scores = { ...(round.scores ?? {}) };
        delete scores[m.playerId];
        round.scores = scores;
        const shotDetails = { ...(round.shotDetails ?? {}) };
        delete shotDetails[m.playerId];
        round.shotDetails = shotDetails;
        if (round.scoreConflicts) {
          const scoreConflicts = { ...round.scoreConflicts };
          delete scoreConflicts[m.playerId];
          round.scoreConflicts = scoreConflicts;
        }
        if (patch.pairs) round.pairs = patch.pairs;
      }
      if (m.nextScoringMode) {
        t.settings = { ...(t.settings ?? {}), scoringMode: m.nextScoringMode };
      }
      break;
    }
    case 'tournament.setFinished': {
      t.finishedAt = m.finishedAt ?? null;
      break;
    }
    case 'tournament.setMe': {
      t.meId = m.meId ?? null;
      break;
    }
    case 'tournament.claimPlayer': {
      t.players = (t.players ?? []).map((p) => (
        p.id === m.playerId ? { ...p, user_id: m.userId } : p
      ));
      t.meId = m.playerId;
      break;
    }
    case 'round.remove': {
      t.rounds = (t.rounds ?? []).filter((r) => r.id !== m.roundId);
      break;
    }
    case 'tournament.setScoringMode': {
      t.settings = { ...(t.settings ?? {}), scoringMode: m.scoringMode };
      // Rebuild each affected round's pairs so teams match the new mode
      // (e.g. switching into Best Ball assigns partnerships; switching out
      // collapses them to individuals). Patches are pre-computed by the
      // caller via setScoringModeRoundPatches.
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (round && patch.pairs) round.pairs = patch.pairs;
      }
      break;
    }
    default:
      break; // library-only mutations don't change the tournament object
  }
}

export async function mutate(tournamentBefore, mutation) {
  const ts = mutation.ts ?? Date.now();
  const m = { ...mutation, ts };

  // Library-only mutations do not touch any tournament blob — just enqueue.
  if (m.type === 'player.upsertLibrary') {
    await syncQueue.enqueue({ tournamentId: null, mutation: m, path: null });
    const { scheduleSync } = require('./syncWorker');
    if (isOnline()) scheduleSync();
    else _setSyncStatus('pending');
    return tournamentBefore;
  }

  // tournament.setMe is per-device identity ("which player is me on this
  // phone"). Apply and persist locally, but skip enqueue/sync entirely so
  // a joiner's setMe never overwrites another device's meId.
  if (m.type === 'tournament.setMe') {
    const t = JSON.parse(JSON.stringify(tournamentBefore));
    applyToTournament(t, m);
    await saveLocal(t);
    return t;
  }

  // 1. Clone + apply + bump _meta
  const t = JSON.parse(JSON.stringify(tournamentBefore));
  applyToTournament(t, m);
  const path = metaPathFor(m);
  if (path) {
    // Most mutations stamp one _meta path; some (addPlayer) stamp several.
    const paths = Array.isArray(path) ? path : [path];
    const meta = { ...(t._meta ?? {}) };
    for (const p of paths) meta[p] = ts;
    t._meta = meta;
  }

  // 2. Persist local (UI source of truth)
  await saveLocal(t);

  // 3. Enqueue for sync
  await syncQueue.enqueue({ tournamentId: t.id, mutation: m, path });

  // 4. Kick worker (lazy require to break circular import)
  const { scheduleSync } = require('./syncWorker');
  if (isOnline()) scheduleSync();
  else _setSyncStatus('pending');

  return t;
}
