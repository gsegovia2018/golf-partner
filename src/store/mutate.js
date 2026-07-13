import { syncQueue } from './syncQueue';
import { saveLocal, _setSyncStatus } from './tournamentStore';
import { isOnline } from '../lib/connectivity';
import { normalizeRoundNotes } from './roundNotes';

// Maps a mutation to a stable dotted path identifying what it touches. Used
// for labeling entries in SyncStatusSheet's log (see conflictLabels.js) and
// asserted on directly by tests/legacy call sites — it is NOT a queue
// coalescing/identity key (the queue never reads entry.path) and it no
// longer stamps anything on the tournament blob (sync is row-based, not
// blob-merged).
// Returns null for library-only mutations (which do not touch the tournament blob).
export function metaPathFor(m) {
  switch (m.type) {
    case 'score.set':    return `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`;
    // Per-player, per-hole shot detail (putts / drive / penalties).
    case 'shot.set':     return `rounds.${m.roundId}.shotDetails.${m.playerId}.h${m.hole}`;
    case 'note.set':
      return m.scope === 'hole'
        ? `rounds.${m.roundId}.notes.hole.${m.hole}`
        : `rounds.${m.roundId}.notes.round`;
    case 'pairs.set':    return `rounds.${m.roundId}.pairs`;
    case 'round.setScoringMode':
      return [`rounds.${m.roundId}.scoringMode`, `rounds.${m.roundId}.pairs`];
    // Per-round best/worst ball point value overrides. Two scalar LWW paths.
    case 'round.setBestBallValues':
      return [`rounds.${m.roundId}.bestBallValue`, `rounds.${m.roundId}.worstBallValue`];
    // Tournament-wide team behavior (fixed teams / manual teams). Edited from
    // the gear Team Settings sheet; each toggle is its own LWW path.
    case 'tournament.setTeamSettings':
      return ['settings.fixedTeams', 'settings.manualTeams'];
    case 'handicap.set': return `rounds.${m.roundId}.playerHandicaps.${m.playerId}`;
    // Per-round handicap INDEX override (recomputes the playing handicap for
    // non-manual entries). Scoped to one round, one player.
    case 'index.set': return `rounds.${m.roundId}.playerIndexes.${m.playerId}`;
    // Structural round deletion. The path itself is no longer consumed by
    // any merge/reconcile logic (deletion now flows through repo.deleteRound
    // + the row-based read path) — it survives purely as the queue entry's
    // coalescing/identity key.
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
        if (patch.clearScoringMode) paths.push(`rounds.${patch.roundId}.scoringMode`);
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
        paths.push(`rounds.${patch.roundId}.scoreResolutions.${m.playerId}`);
        if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
        if (patch.clearScoringMode) paths.push(`rounds.${patch.roundId}.scoringMode`);
      }
      if (m.nextScoringMode) paths.push('settings.scoringMode');
      return paths;
    }
    // Archive / reopen a tournament. Scalar LWW path.
    case 'tournament.setFinished': return `finishedAt`;
    // Which tournament player is "me" (drives shot-detail tracking). Per-
    // device identity — never synced. Handled as a local-only mutation in
    // mutate() below (short-circuited before enqueue).
    case 'tournament.setMe': return null;
    // A joining editor links their account to a tournament player: stamps
    // that player's user_id (the joiner's claim must propagate to other
    // devices). The local meId update is intentional but device-local — see
    // deriveMeIdFromAuth in tournamentStore.js, which re-derives meId from
    // auth on every read instead of trusting whatever the fetched/merged
    // blob carried.
    case 'tournament.claimPlayer': return 'players';
    // Mid-game scoring-mode change: bumps the mode flag plus, for every round
    // whose pairs were rebuilt to match the new mode, that round's pairs path.
    case 'tournament.setScoringMode': {
      const paths = ['settings.scoringMode'];
      for (const patch of (m.roundPatches ?? [])) {
        if (patch.pairs) paths.push(`rounds.${patch.roundId}.pairs`);
        paths.push(`rounds.${patch.roundId}.scoringMode`);
      }
      return paths;
    }
    // Resolving a score conflict writes the chosen value AND stamps a
    // resolution marker that other devices merge in as the winning value.
    case 'conflict.resolve': return [
      `rounds.${m.roundId}.scores.${m.playerId}.h${m.hole}`,
      `rounds.${m.roundId}.scoreResolutions.${m.playerId}.h${m.hole}`,
    ];
    case 'player.upsertLibrary': return null;
    // Advances the tournament's "current round" pointer (drives which round
    // the app opens by default). Monotonic — mirrors advance_game_round's
    // GREATEST() on the server, so an out-of-order replay never regresses it.
    case 'tournament.advanceRound': return 'currentRound';
    // Reveals a round's pairs (post-randomize reveal moment). Optionally
    // carries the pairs themselves when reveal and pairing happen together.
    case 'round.reveal': return `rounds.${m.roundId}.revealed`;
    // Tournament profile edit (name/kind/settings/etc.) — mirrors
    // patch_game_tournament's one-level-deep merge. Single LWW path: the
    // whole patch lands together.
    case 'tournament.updateProfile': return 'props';
    // Tournament creation: the row is already saved locally by the creation
    // flow itself, so this mutation only needs to reach the server queue.
    case 'tournament.create': return 'create';
    // Whole-round content replace (Reset Round / Undo / Restore snapshot in
    // HomeScreen). scores/notes live in their own normalized tables (never
    // touched path-by-path by the per-cell mutations above), so this returns
    // the coarse parent paths instead of one per cell.
    case 'round.resetContent': return [
      `rounds.${m.roundId}.scores`,
      `rounds.${m.roundId}.notes`,
      `rounds.${m.roundId}.resetHistory`,
    ];
    // Whole-round upsert (EditTournamentScreen / PlayersScreen bulk round
    // save — course/holes/tees/handicaps edited together). Mirrors
    // tournament.create: a coarse path, not a per-field one. `m.isNew` (see
    // mutationWrites.js's round.upsert branch) is server-write-only metadata
    // — it doesn't change this path.
    case 'round.upsert': return `rounds.${m.roundId}.upsert`;
    // Edit an EXISTING roster player's fields (e.g. base handicap) — distinct
    // from tournament.addPlayer (new player) / tournament.claimPlayer (just
    // user_id).
    case 'tournament.updatePlayer': return 'players';
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
      // Per-author submission mirror (source of derived conflict state).
      round.scoreEntries = { ...(round.scoreEntries ?? {}) };
      round.scoreEntries[m.playerId] = { ...(round.scoreEntries[m.playerId] ?? {}) };
      round.scoreEntries[m.playerId][m.hole] = {
        ...(round.scoreEntries[m.playerId][m.hole] ?? {}),
        [m.authorId]: { value: m.value ?? null, ts: m.ts },
      };
      break;
    }
    case 'conflict.resolve': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = { ...(round.scores ?? {}) };
      round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
      if (m.value == null) delete round.scores[m.playerId][m.hole];
      else round.scores[m.playerId][m.hole] = m.value;
      // Resolution stamp: records the explicit resolution (value + who +
      // when). Synced like any other cell — conflicts are now DERIVED from
      // scoreEntries vs. scores (see scoreEntries.js), so this stamp is what
      // lets every device converge on the same chosen value.
      round.scoreResolutions = { ...(round.scoreResolutions ?? {}) };
      round.scoreResolutions[m.playerId] = { ...(round.scoreResolutions[m.playerId] ?? {}) };
      round.scoreResolutions[m.playerId][m.hole] = { value: m.value ?? null, by: m.resolvedBy, ts: m.ts };
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
        // normalizeRoundNotes omits `hole` entirely when there are no hole
        // notes (matches get_game_tournament's shape) — so it can't be
        // indexed into directly; build the bucket here instead.
        const notes = normalizeRoundNotes(round.notes);
        notes.hole = { ...(notes.hole ?? {}), [m.hole]: m.text };
        round.notes = notes;
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
    case 'round.setScoringMode': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      // Per-round mode override. Teams are rebuilt by the caller for the
      // new shape; revealed is preserved — changing a future round's mode
      // must not spoil its reveal.
      round.scoringMode = m.scoringMode;
      if (m.pairs) round.pairs = m.pairs;
      break;
    }
    case 'round.setBestBallValues': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      round.bestBallValue = m.bestBallValue;
      round.worstBallValue = m.worstBallValue;
      break;
    }
    case 'tournament.setTeamSettings': {
      t.settings = {
        ...(t.settings ?? {}),
        fixedTeams: Boolean(m.fixedTeams),
        manualTeams: Boolean(m.manualTeams),
      };
      break;
    }
    case 'handicap.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      round.playerHandicaps = { ...(round.playerHandicaps ?? {}), [m.playerId]: m.handicap };
      round.manualHandicaps = { ...(round.manualHandicaps ?? {}), [m.playerId]: true };
      break;
    }
    case 'index.set': {
      const round = t.rounds.find((r) => r.id === m.roundId);
      if (!round) return;
      // Per-round index override. The recomputed playing handicap rides its
      // own handicap.set path; this just records the index for that round so
      // display + later auto-recomputes (e.g. a tee change) use it.
      round.playerIndexes = { ...(round.playerIndexes ?? {}), [m.playerId]: m.index };
      break;
    }
    case 'tournament.addPlayer': {
      // Dedupe by id: a realtime game_players INSERT can patch this player
      // into the cache before this still-queued addPlayer replays on top of
      // that same base (the read-path overlay in realtimeSync/tournamentStore
      // applies pending mutations over a freshly-patched object). Without the
      // guard the player would land in players[] twice. The roundPatches /
      // nextScoringMode below are re-applied either way — they set handicaps/
      // pairs/mode the row event never carried, and doing so is idempotent.
      if (!(t.players ?? []).some((p) => p.id === m.player.id)) {
        t.players = [...(t.players ?? []), m.player];
      }
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (!round) continue;
        round.playerHandicaps = {
          ...(round.playerHandicaps ?? {}),
          [m.player.id]: patch.playerHandicap,
        };
        if (patch.pairs) round.pairs = patch.pairs;
        // The new roster size invalidated this round's override — it falls
        // back to the tournament's (possibly also new) default mode.
        if (patch.clearScoringMode) delete round.scoringMode;
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
        if (round.scoreResolutions) {
          const scoreResolutions = { ...round.scoreResolutions };
          delete scoreResolutions[m.playerId];
          round.scoreResolutions = scoreResolutions;
        }
        if (patch.pairs) round.pairs = patch.pairs;
        // See tournament.addPlayer: the smaller roster invalidated this
        // round's override.
        if (patch.clearScoringMode) delete round.scoringMode;
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
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (!round) continue;
        if (patch.pairs) round.pairs = patch.pairs;
        // The tournament-wide setter makes the tournament uniform again:
        // per-round overrides on the patched (future) rounds are cleared.
        delete round.scoringMode;
      }
      break;
    }
    case 'tournament.advanceRound': {
      // Monotonic like the server's advance_game_round: an out-of-order
      // replay (e.g. a stale queued mutation applied after a newer local
      // state) never regresses the pointer.
      t.currentRound = Math.max(t.currentRound ?? 0, m.roundIndex);
      break;
    }
    case 'round.reveal': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      round.revealed = true;
      if (m.pairs) round.pairs = m.pairs;
      break;
    }
    case 'tournament.updateProfile': {
      for (const [k, v] of Object.entries(m.patch ?? {})) {
        // name/kind are plain top-level fields on the local object, never
        // merged into any nested object. Server-side, name is a dedicated
        // (unconstrained) column; kind is the app's domain kind and now
        // lives in tournaments.props.kind (patch_game_tournament also derives
        // the CHECK-constrained casual/official column from it, but that
        // column is never what this local object's `kind` reflects). Both
        // map to NOT NULL fields server-side, where a null means "skip the
        // update" (never "clear") — mirror that here so local and server
        // state can't diverge on a null name/kind patch.
        if (k === 'name' || k === 'kind') {
          if (v != null) t[k] = v;
          continue;
        }
        // currentRound routes through the same monotonic rule as
        // tournament.advanceRound (mirrors the server's routing to
        // advance_game_round from within patch_game_tournament).
        if (k === 'currentRound') { t.currentRound = Math.max(t.currentRound ?? 0, v); continue; }
        // Object values merge one level deep; scalars/arrays/null replace
        // outright (an explicit null clears the field locally).
        if (v !== null && typeof v === 'object' && !Array.isArray(v)
          && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) {
          t[k] = { ...t[k], ...v };
        } else {
          t[k] = v;
        }
      }
      break;
    }
    case 'tournament.create': {
      // No-op: the tournament creation flow already saves this tournament
      // locally before this mutation is enqueued.
      break;
    }
    case 'round.resetContent': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      round.scores = m.scores ?? {};
      round.notes = normalizeRoundNotes(m.notes);
      round.resetHistory = m.resetHistory ?? [];
      break;
    }
    case 'round.upsert': {
      // Local apply always writes the full round (the UI's own view is never
      // stale to itself) regardless of `m.isNew` — that flag only steers
      // mutationWrites.js's server write (full upsert vs owned-fields patch).
      const rounds = [...(t.rounds ?? [])];
      const idx = rounds.findIndex((r) => r.id === m.roundId);
      if (idx === -1) rounds.splice(m.roundIndex ?? rounds.length, 0, m.round);
      else rounds[idx] = m.round;
      t.rounds = rounds;
      break;
    }
    case 'tournament.updatePlayer': {
      t.players = (t.players ?? []).map((p) => (
        p.id === m.playerId ? { ...p, ...m.patch } : p
      ));
      break;
    }
    default:
      break; // library-only mutations don't change the tournament object
  }
}

// Replays a queue of pending mutations on top of a freshly fetched
// tournament — the read-path replacement for LWW merging (server truth +
// my undrained ops). `entries` is the syncQueue entry array for ONE
// tournament ({ tournamentId, mutation, path, ts }); mutations are applied
// in order via applyToTournament, which is already defensive about
// mutations referencing rounds/players that no longer exist.
export function applyPendingMutations(tournament, entries) {
  const t = JSON.parse(JSON.stringify(tournament));
  for (const entry of entries) {
    applyToTournament(t, entry.mutation);
  }
  return t;
}

// scoreEntries (per-author submissions) and scoreResolutions (explicit
// resolution stamps) are LOCAL-ONLY hot keys: tournamentRepo.js strips them
// from every round body before it ever reaches the server
// (stripRoundHotKeys), and get_game_tournament never reassembles them — so a
// freshly fetched `target` (repo read, or applyPendingMutations(fresh, ...)
// replay) NEVER carries them. Both reconcile paths that recompute local
// state from a fresh fetch (syncWorker's drainTournament post-drain
// reconcile, and tournamentStore's _overlayAndSave) must carry `source`'s
// (the previous local blob's) round.scoreEntries/scoreResolutions forward,
// or a conflict the user hasn't seen yet silently vanishes the moment
// ANYTHING else for that tournament syncs or the screen pulls a background
// refresh.
//
// But `target` is NOT always entries-less: realtimeSync's makeHandler calls
// this with `target` = cached-plus-just-applied-row (a fresh
// game_score_entries/game_score_resolutions row legitimately carries a new
// peer's entry) and `source` = the pre-row cache. A wholesale replace with
// `source` there would discard that peer's entry before deriveCell ever sees
// two authors — the conflict feature would never fire cross-device. So this
// is a deep UNION per round, with `target` winning per cell/author:
//   scoreEntries[playerId][hole]: union of authorIds from both sides;
//     target's entry wins when an authorId appears on both.
//   scoreResolutions[playerId][hole]: union of cells from both sides; target
//     wins per cell (a resolution is one atomic stamp, not per-author).
// This is correct for both callers: on the realtime path `target` already
// contains everything `source` (cached) had plus the new row, so the union
// with target-precedence reduces to `target`, entry intact. On the
// fetch/overlay path `target` has no entries at all, so the union reduces to
// `source`, restoring what the fetch stripped. Mutates and returns `target`.
function unionScoreEntries(targetEntries, sourceEntries) {
  if (!sourceEntries && !targetEntries) return undefined;
  const playerIds = new Set([
    ...Object.keys(sourceEntries ?? {}),
    ...Object.keys(targetEntries ?? {}),
  ]);
  const out = {};
  for (const playerId of playerIds) {
    const sHoles = sourceEntries?.[playerId] ?? {};
    const tHoles = targetEntries?.[playerId] ?? {};
    const holes = new Set([...Object.keys(sHoles), ...Object.keys(tHoles)]);
    const byHole = {};
    for (const hole of holes) {
      byHole[hole] = { ...(sHoles[hole] ?? {}), ...(tHoles[hole] ?? {}) };
    }
    out[playerId] = byHole;
  }
  return out;
}

function unionScoreResolutions(targetResolutions, sourceResolutions) {
  if (!sourceResolutions && !targetResolutions) return undefined;
  const playerIds = new Set([
    ...Object.keys(sourceResolutions ?? {}),
    ...Object.keys(targetResolutions ?? {}),
  ]);
  const out = {};
  for (const playerId of playerIds) {
    const sHoles = sourceResolutions?.[playerId] ?? {};
    const tHoles = targetResolutions?.[playerId] ?? {};
    out[playerId] = { ...sHoles, ...tHoles };
  }
  return out;
}

export function preserveLocalConflictState(target, source) {
  if (!target?.rounds?.length || !source?.rounds?.length) return target;
  const byId = new Map(source.rounds.map((r) => [r.id, {
    scoreEntries: r?.scoreEntries, scoreResolutions: r?.scoreResolutions,
  }]));
  target.rounds = target.rounds.map((r) => {
    const s = byId.get(r.id);
    if (!s) return r;
    const mergedEntries = unionScoreEntries(r?.scoreEntries, s.scoreEntries);
    const mergedResolutions = unionScoreResolutions(r?.scoreResolutions, s.scoreResolutions);
    return {
      ...r,
      ...(mergedEntries ? { scoreEntries: mergedEntries } : {}),
      ...(mergedResolutions ? { scoreResolutions: mergedResolutions } : {}),
    };
  });
  return target;
}

export async function mutate(tournamentBefore, mutation, opts = {}) {
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

  // 1. Clone + apply. `path` no longer stamps anything on the blob (sync is
  // row-based now, not blob-merged) — it rides along on the queue entry as a
  // stable label only (see metaPathFor above / conflictLabels.js), not a
  // coalescing key the queue reads.
  const t = JSON.parse(JSON.stringify(tournamentBefore));
  applyToTournament(t, m);
  const path = metaPathFor(m);

  // 2. Persist local (UI source of truth)
  await saveLocal(t);

  // 3. Enqueue for sync
  await syncQueue.enqueue({ tournamentId: t.id, mutation: m, path });

  // 4. Kick worker (lazy require to break circular import). Score entry
  // passes deferSync so taps batch locally; the scorecard flushes the queue
  // on hole change / finish / background instead.
  if (opts.deferSync) {
    _setSyncStatus('pending');
  } else {
    const { scheduleSync } = require('./syncWorker');
    if (isOnline()) scheduleSync();
    else _setSyncStatus('pending');
  }

  return t;
}
