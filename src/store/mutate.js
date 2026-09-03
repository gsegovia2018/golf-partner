import { syncQueue } from './syncQueue';
import { saveLocal, readLocal, _setSyncStatus } from './tournamentStore';
import { isOnline } from '../lib/connectivity';
import { normalizeRoundNotes } from './roundNotes';
import { clampScoreInput, resolvePlayerHandicap, holeCountOf } from './scoring';

// Maps a mutation to a stable dotted path identifying what it touches.
// Asserted on directly by tests/legacy call sites — it is NOT a queue
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
        paths.push(`rounds.${patch.roundId}.scoreEntries.${m.playerId}`);
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
    // When the round was finished. Stamped once, on the finish action, and
    // never re-stamped by a later edit — the feed orders on it.
    case 'round.setFinished': return `rounds.${m.roundId}.finishedAt`;
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
        // Player ids are library-stable and REUSED on re-add (PlayersScreen
        // passes id: p.id, not a fresh uuid), so a remove→re-add of the same
        // person must clear the removedPlayerIds tombstone this round may
        // still carry — otherwise preserveLocalConflictState would keep
        // pruning the now-legitimate player's fresh scoreEntries, silently
        // disabling their conflict detection. The roster gate in
        // pruneRemovedPlayers is the primary guarantee (it also covers the
        // realtime game_players INSERT re-add path, which never reaches this
        // apply branch); this clear keeps the tombstone from lingering.
        if (Array.isArray(round.removedPlayerIds)) {
          const kept = round.removedPlayerIds.filter((id) => id !== m.player.id);
          if (kept.length) round.removedPlayerIds = kept;
          else delete round.removedPlayerIds;
        }
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
        // Kills the phantom-conflict bug: without this, the removed
        // player's per-author scoreEntries survive and preserveLocalConflict
        // State/unionScoreEntries re-merge them on every reconcile/realtime
        // patch, so listRoundConflicts/surfaceableConflicts derive a
        // conflict for a player who no longer exists (subjectName renders
        // '—' — see scoreEntries.js).
        if (round.scoreEntries) {
          const scoreEntries = { ...round.scoreEntries };
          delete scoreEntries[m.playerId];
          round.scoreEntries = scoreEntries;
        }
        if (round.scoreResolutions) {
          const scoreResolutions = { ...round.scoreResolutions };
          delete scoreResolutions[m.playerId];
          round.scoreResolutions = scoreResolutions;
        }
        // Tombstone (see preserveLocalConflictState) — a monotonic record
        // that this playerId was removed from this round, so a later merge
        // against a stale `source` snapshot that still carries their
        // scoreEntries/scoreResolutions never resurrects them.
        const removedPlayerIds = new Set(round.removedPlayerIds ?? []);
        removedPlayerIds.add(m.playerId);
        round.removedPlayerIds = [...removedPlayerIds];
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
    case 'round.setFinished': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      // First write wins: re-finishing a round (or replaying a queued
      // mutation) must not move the timestamp the feed sorts on.
      if (!round.finishedAt) round.finishedAt = m.finishedAt;
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

function entryTs(entry) {
  const ts = entry?.ts;
  return Number.isFinite(ts) ? ts : 0;
}

// Per-cell precedence for the two unions below: newest `ts` wins, target wins
// a tie (so `>` on the source side, not `>=`).
function pickNewer(targetEntry, sourceEntry) {
  if (targetEntry === undefined) return sourceEntry;
  if (sourceEntry === undefined) return targetEntry;
  return entryTs(sourceEntry) > entryTs(targetEntry) ? sourceEntry : targetEntry;
}

// scoreEntries (per-author submissions) and scoreResolutions (explicit
// resolution stamps) never travel in game_rounds.body — tournamentRepo.js
// strips them from every round body before it reaches the server
// (stripRoundHotKeys) — but they are NO LONGER local-only: since
// supabase/migrations/20260815000000_fetch_score_entries.sql,
// get_game_tournament reassembles both from game_score_entries /
// game_score_resolutions, in exactly the shapes realtimeSync's row patchers
// produce. So a fetch is now a RECOVERY path: a device that was offline while
// a peer's entry broadcast finally learns about it on the next pull, instead
// of the conflict staying one-sided forever.
//
// A fetched `target` may therefore carry entries this device has never seen,
// while `source` (the previous local blob) may carry entries the server has
// never seen (queued offline edits). Neither side can be dropped, so this is
// a deep UNION per round, resolved by `ts`:
//   scoreEntries[playerId][hole]: union of authorIds from both sides; when an
//     authorId is on both, the HIGHER-ts entry wins (missing/invalid ts = 0;
//     a tie keeps `target`). Blind target-precedence would let a stale server
//     copy of MY OWN author entry — fetched mid-drain, before my newer edit
//     lands — beat the newer local one.
//   scoreResolutions[playerId][hole]: same ts-aware rule per cell (a
//     resolution is one atomic stamp, not per-author).
// Correct for every caller: on the realtime path `target` is
// cached-plus-just-applied-row, so the union reduces to `target` with the new
// row intact; on the fetch/overlay path (syncWorker's post-drain reconcile,
// tournamentStore's _overlayAndSave) server entries and still-local ones both
// survive, newest per author.
//
// KNOWN CONSERVATIVE BEHAVIOR: a union never removes. A server-side entry
// DELETE therefore does not propagate through a fetch — only realtime DELETE
// events (applyScoreEntryRow) and the removedPlayerIds tombstone below prune
// anything. Accepted: entries are effectively append/overwrite-only in normal
// play, and keeping a stale candidate visible is far cheaper than silently
// dropping a live one. Mutates and returns `target`.
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
      const sAuthors = sHoles[hole] ?? {};
      const tAuthors = tHoles[hole] ?? {};
      const byAuthor = {};
      for (const authorId of new Set([...Object.keys(sAuthors), ...Object.keys(tAuthors)])) {
        byAuthor[authorId] = pickNewer(tAuthors[authorId], sAuthors[authorId]);
      }
      byHole[hole] = byAuthor;
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
    const byHole = {};
    for (const hole of new Set([...Object.keys(sHoles), ...Object.keys(tHoles)])) {
      byHole[hole] = pickNewer(tHoles[hole], sHoles[hole]);
    }
    out[playerId] = byHole;
  }
  return out;
}

// round.removedPlayerIds is a monotonic, LOCAL-ONLY tombstone — stripped from
// round bodies like scoreEntries/scoreResolutions (see stripRoundHotKeys in
// tournamentRepo.js, which must also omit it) but, unlike them, never
// reassembled by any fetch — recording every playerId a
// tournament.removePlayer apply has ever cleared from THIS round. It only
// ever grows, so a plain array union (never a target-wins overwrite) is
// correct and sufficient here — unlike scoreEntries' ts-aware per-cell rule.
function unionRemovedPlayerIds(targetIds, sourceIds) {
  if (!sourceIds && !targetIds) return undefined;
  return [...new Set([...(sourceIds ?? []), ...(targetIds ?? [])])];
}

// Drops a tombstoned playerId from a scoreEntries/scoreResolutions map ONLY
// when that player is ALSO absent from the current roster (`knownPlayerIds`).
// Two guards, both required:
//   1. Tombstone (removedPlayerIds): scoped to explicitly-removed players,
//      not "any playerId missing from the roster" — a roster-only check would
//      prune a legitimate peer's entry for a brand-new player whose
//      game_players row hasn't reached this device yet (a narrow but real
//      cross-table realtime-ordering race), silently dropping a live score.
//   2. Roster gate (knownPlayerIds): player ids are library-stable and REUSED
//      on re-add, so a remove→re-add of the same person must NOT keep pruning
//      their fresh entries. Once they're back on the roster the tombstone is
//      inert. (mutate.js's addPlayer branch also clears the tombstone, but the
//      realtime game_players INSERT re-add path never reaches that branch, so
//      this gate is the load-bearing guarantee for Critical-2.)
// `knownPlayerIds` null/absent (bare `{ rounds }` fixtures) disables the gate
// — those callers never set a tombstone, so pruning is a no-op regardless.
function pruneRemovedPlayers(map, removedPlayerIds, knownPlayerIds) {
  if (!map || !removedPlayerIds?.length) return map;
  const removed = new Set(removedPlayerIds);
  const out = {};
  for (const [playerId, value] of Object.entries(map)) {
    const stillRostered = knownPlayerIds?.has(playerId);
    if (!removed.has(playerId) || stillRostered) out[playerId] = value;
  }
  return out;
}

// A cached-local score entry the reconciled target knows nothing about —
// absent from the fresh server state AND not re-created by a still-queued
// mutation (syncWorker applies those onto the target before merging) — can
// never reach the server again: its write was dropped by the drain
// (permanent error / poison cap) or died with the process before it was
// ever enqueued. Left alone it survives every union-merge as a phantom
// author that later "conflicts" with real entries (the 2026-08-16 solo
// "Someone" conflicts). Once such an entry is older than the caller's
// cutoff, drop it. The grace keeps mutate()'s save-before-enqueue window
// and the reconcile settle-loop races safely out of reach — a live write
// is always either younger than the cutoff or represented in the queue.
function dropOrphanEntries(merged, targetEntries, cutoff) {
  if (!merged) return merged;
  for (const [playerId, byHole] of Object.entries(merged)) {
    for (const [hole, byAuthor] of Object.entries(byHole ?? {})) {
      for (const [authorId, entry] of Object.entries(byAuthor ?? {})) {
        const known = targetEntries?.[playerId]?.[hole]?.[authorId] !== undefined;
        if (!known && (entry?.ts ?? 0) < cutoff) delete byAuthor[authorId];
      }
      if (Object.keys(byAuthor ?? {}).length === 0) delete byHole[hole];
    }
    if (Object.keys(byHole ?? {}).length === 0) delete merged[playerId];
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

// Same rule for resolutions (one per player+hole, no author level).
function dropOrphanResolutions(merged, targetResolutions, cutoff) {
  if (!merged) return merged;
  for (const [playerId, byHole] of Object.entries(merged)) {
    for (const [hole, res] of Object.entries(byHole ?? {})) {
      const known = targetResolutions?.[playerId]?.[hole] !== undefined;
      if (!known && (res?.ts ?? 0) < cutoff) delete byHole[hole];
    }
    if (Object.keys(byHole ?? {}).length === 0) delete merged[playerId];
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

// `opts.pruneOrphansBefore` (epoch ms): only the post-drain reconcile passes
// it — the one caller whose target is fresh server state WITH the pending
// queue already applied, so "unknown to target" provably means "will never
// sync". The realtime/fetch merge paths must NOT prune: their targets don't
// carry still-queued mutations, and a queued-but-undrained entry would look
// orphaned there.
// A fetch may ADD or UPDATE a roster player. It may never DELETE one.
//
// `target` (fresh server state) replaces local's `players` wholesale on every
// read path, and until 20260903000000 an absent player was indistinguishable
// from a removed one — so a player whose add never reached the server (a
// queued mutation dropped after repeated failures, or lost before it was ever
// enqueued) was erased from this device the first time it managed a fetch.
// The visible damage was oddly narrow: pairs persist ids only (thinPairs) and
// scores/playerHandicaps are id-keyed, so the slot and the scores stayed and
// only the NAME went.
//
// Now removal is a fact the server reports — `deletedPlayerIds`, the
// tombstoned game_players rows — so the two cases separate cleanly:
//
//   in target.players                         -> server truth, use it
//   absent, id IN target.deletedPlayerIds     -> genuinely removed, drop it
//   absent, id NOT IN deletedPlayerIds        -> never landed, KEEP local's
//
// A server that predates that migration sends no `deletedPlayerIds` key at
// all. That is deliberately treated as "no removals known", which is the safe
// direction: a stale local player lingers on one device until the client is
// pointed at the migrated schema, rather than being destroyed. Callers that
// want the kept ids (to re-queue the write that never landed) diff the result
// against `target.players` themselves — see _overlayAndSave.
//
// Order: kept players are appended, never spliced back at a remembered index.
// game_players.pos is assigned once and frozen server-side
// (20260728000003), so a local-only player has no authoritative position to
// restore, and re-splicing by a local index is exactly the roster-reordering
// bug that migration exists to prevent. Mutates and returns `target`.
export function unionLocalRoster(target, source) {
  if (!Array.isArray(target?.players) || !Array.isArray(source?.players)) return target;
  const known = new Set(target.players.map((p) => p?.id));
  const removed = new Set(target.deletedPlayerIds ?? []);
  const kept = source.players.filter(
    (p) => p?.id && !known.has(p.id) && !removed.has(p.id),
  );
  if (kept.length > 0) target.players = [...target.players, ...kept];
  return target;
}

export function preserveLocalConflictState(target, source, opts = {}) {
  if (!target?.rounds?.length || !source?.rounds?.length) return target;
  const knownPlayerIds = Array.isArray(target.players)
    ? new Set(target.players.map((p) => p?.id))
    : null;
  const byId = new Map(source.rounds.map((r) => [r.id, {
    scoreEntries: r?.scoreEntries,
    scoreResolutions: r?.scoreResolutions,
    removedPlayerIds: r?.removedPlayerIds,
  }]));
  target.rounds = target.rounds.map((r) => {
    const s = byId.get(r.id);
    if (!s) return r;
    const removedPlayerIds = unionRemovedPlayerIds(r?.removedPlayerIds, s.removedPlayerIds);
    let mergedEntries = pruneRemovedPlayers(
      unionScoreEntries(r?.scoreEntries, s.scoreEntries), removedPlayerIds, knownPlayerIds,
    );
    let mergedResolutions = pruneRemovedPlayers(
      unionScoreResolutions(r?.scoreResolutions, s.scoreResolutions), removedPlayerIds, knownPlayerIds,
    );
    if (opts.pruneOrphansBefore) {
      mergedEntries = dropOrphanEntries(mergedEntries, r?.scoreEntries, opts.pruneOrphansBefore);
      mergedResolutions = dropOrphanResolutions(mergedResolutions, r?.scoreResolutions, opts.pruneOrphansBefore);
    }
    return {
      ...r,
      ...(mergedEntries ? { scoreEntries: mergedEntries } : {}),
      ...(mergedResolutions ? { scoreResolutions: mergedResolutions } : {}),
      ...(removedPlayerIds ? { removedPlayerIds } : {}),
    };
  });
  return target;
}

export async function mutate(tournamentBefore, mutation, opts = {}) {
  const ts = mutation.ts ?? Date.now();
  const m = { ...mutation, ts };

  // Clamp a raw entered stroke count to [1, pickup] HERE — the single choke
  // point every score.set mutation passes through (keypad text field, +/-
  // stepper, and any future entry path), so an out-of-range value (a
  // fat-fingered "44" for "4", or a stray "-1"/"0") never reaches local
  // state OR the server. Clamping `m.value` itself (not just what
  // applyToTournament later writes into the round) matters: `m` is the same
  // object handed to syncQueue.enqueue below and replayed by
  // mutationWrites.js's score.set case (`strokes: m.value`) — clamping only
  // the local write would leave the corrupted number queued for the server,
  // which would then hand it right back on the next fetch/realtime sync.
  // `m.value == null` (a cleared cell) and a hole we can't find (defensive
  // fallback — should not happen in practice) both pass through untouched.
  if (m.type === 'score.set' && m.value != null) {
    const round = tournamentBefore?.rounds?.find((r) => r.id === m.roundId);
    const hole = round?.holes?.find((h) => h.number === m.hole);
    if (hole) {
      const playerHandicap = resolvePlayerHandicap(round, tournamentBefore?.players, m.playerId);
      m.value = clampScoreInput(
        m.value, hole.par, playerHandicap, hole.strokeIndex, holeCountOf(round),
      );
    }
  }

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
  //
  // Under the per-tournament mutex, applied to the FRESHEST local blob, not
  // the caller's snapshot: the overlay paths (_overlayAndSave, realtime
  // flushBatch) read local inside this same lock and restore its meId over
  // their merged result, so an unserialized whole-blob write from a stale
  // screen ref here would (a) race those restores — a pick landing between
  // an overlay's read and save was erased by the old null being written
  // back — and (b) revert every field the snapshot was stale about.
  if (m.type === 'tournament.setMe') {
    const { runExclusiveForTournament } = require('./tournamentMutex');
    return runExclusiveForTournament(tournamentBefore.id, async () => {
      const base = (await readLocal(tournamentBefore.id)) ?? tournamentBefore;
      const t = JSON.parse(JSON.stringify(base));
      applyToTournament(t, m);
      await saveLocal(t);
      return t;
    });
  }

  // 1. Clone + apply. `path` no longer stamps anything on the blob (sync is
  // row-based now, not blob-merged) — it rides along on the queue entry as a
  // stable label only (see metaPathFor above), not a coalescing key the
  // queue reads.
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
