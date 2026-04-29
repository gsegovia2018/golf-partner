import { syncQueue } from './syncQueue';
import { saveLocal, _setSyncStatus } from './tournamentStore';
import { isOnline } from '../lib/connectivity';

// Maps a mutation to the in-tournament `_meta` path it bumps.
// Returns null for library-only mutations (which do not touch the tournament blob).
function metaPathFor(m) {
  switch (m.type) {
    case 'score.set':    return `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`;
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
    // scope per the spec's conflict section.
    case 'tournament.addPlayer': return `players`;
    case 'player.upsertLibrary': return null;
    default: throw new Error(`unknown mutation type: ${m.type}`);
  }
}

// Applies the mutation's side effect to a cloned tournament object in place.
function applyToTournament(t, m) {
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
    case 'note.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      if (m.scope === 'hole') {
        round.notes = { ...(round.notes ?? {}) };
        round.notes.hole = { ...(round.notes.hole ?? {}) };
        round.notes.hole[m.hole] = m.text;
      } else {
        round.notes = { ...(round.notes ?? {}), round: m.text };
      }
      break;
    }
    case 'pairs.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.pairs = m.pairs;
      // `revealed` is monotonic — setting pairs always reveals them.
      round.revealed = true;
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
      break;
    }
    case 'round.remove': {
      t.rounds = (t.rounds ?? []).filter((r) => r.id !== m.roundId);
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

  // 1. Clone + apply + bump _meta
  const t = JSON.parse(JSON.stringify(tournamentBefore));
  applyToTournament(t, m);
  const path = metaPathFor(m);
  if (path) {
    t._meta = { ...(t._meta ?? {}), [path]: ts };
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
