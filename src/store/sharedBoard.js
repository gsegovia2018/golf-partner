// Pure model builder for the public shareable-board screen (see
// docs/superpowers/plans/2026-08-16-shareable-live-board.md, build item 2,
// and the Phase 1.5 "feed-style live board" section for `feedItem` /
// `buildSharedMediaModel` below).
//
// Input: the whitelisted JSON projection `get_shared_board(p_share_token)`
// (a SECURITY DEFINER RPC, built separately) returns — see that migration's
// authoritative shape at
// supabase/migrations/20260816000000_shared_board.sql (media rows come from
// the sibling supabase/migrations/20260816010000_shared_board_media.sql).
// This module never calls either RPC itself; it only maps already-fetched
// payloads through the app's existing scoring/leaderboard math. The one
// narrow exception is `buildSharedMediaModel`'s use of `supabase.storage
// .from(...).getPublicUrl(...)` — a pure string builder with no network/auth
// call of its own (see mediaStore.js:14-19, which does the same mapping for
// the authenticated path) — everything else stays IO-free.
//
// Reused, not reimplemented:
// - `roundLeaderboard` / `tournamentLeaderboardResolved` / `formatRoundLabel`
//   / `isRoundInProgress` / `isTournamentFinished` / `roundTotals`
//   (src/store/tournamentStore.js) — same functions src/lib/liveRoundSummary.js
//   and src/store/feedStore.js already import from there; they take a plain
//   tournament-shaped object and do no IO themselves.
// - `assignPlacements` / `comparatorForBoardMode` (leaderboardPlacement.js)
//   — the same tie-aware ranking HomeScreen uses for its on-screen board.
// - `roundScoringMode` / `isScrambleMode` / `scrambleUnits` /
//   `scrambleRoundTally` / `resolvePairs` / `calcExtraShots` (scoring.js) —
//   mode resolution, the scramble team-unit mapping (team score lives under
//   the captain/pair[0]), and the same extra-shot math feedStore.js's
//   `vsParThrough` delegates to.
import {
  roundLeaderboard,
  tournamentLeaderboardResolved,
  formatRoundLabel,
  isRoundInProgress,
  isTournamentFinished,
  roundTotals,
} from './tournamentStore';
import { assignPlacements, comparatorForBoardMode } from './leaderboardPlacement';
import {
  roundScoringMode,
  isScrambleMode,
  scrambleUnits,
  scrambleRoundTally,
  resolvePairs,
  calcExtraShots,
  holeCountOf,
} from './scoring';
import { supabase } from '../lib/supabase';

// How many holes, counting from hole 1, are fully entered for every scoring
// unit (each player, or — for scramble modes — each team, keyed by captain
// per scrambleUnits). Nothing in the existing stores computes this "thru N"
// presentation figure (liveRoundSummary's `thru` is scoped to a single
// device's player id, which the public board has no equivalent of), so it's
// new here rather than reused, but it does no scoring math of its own.
function computeThru(round, players, mode) {
  const holes = [...(round?.holes ?? [])].sort(
    (a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0),
  );
  if (holes.length === 0) return 0;
  const units = isScrambleMode(mode) ? scrambleUnits(round, players) : players;
  if (!units || units.length === 0) return 0;
  let thru = 0;
  for (const hole of holes) {
    const allEntered = units.every((u) => round?.scores?.[u.id]?.[hole.number] != null);
    if (!allEntered) break;
    thru += 1;
  }
  return thru;
}

// Map the shared-board RPC payload into `{ tournamentName, rounds, overall,
// liveRoundIndex }` for the (later) SharedBoardScreen to render as-is. Null
// for a falsy/malformed payload; tolerant of missing/empty players, rounds,
// and scores otherwise — this comes from an anon RPC over the network, so
// nothing here may throw on partial data.
export function buildSharedBoardModel(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const players = Array.isArray(payload.players) ? payload.players : [];
  const roundsIn = Array.isArray(payload.rounds) ? payload.rounds : [];
  // Shape roundLeaderboard/tournamentLeaderboardResolved expect: a
  // tournament-like object with players/rounds arrays plus whatever
  // round-scoped keys (scoringMode, playerHandicaps, pairs, ...) the payload
  // already carries per round.
  const tournament = { ...payload, players, rounds: roundsIn };

  const live = isRoundInProgress(tournament);
  const liveRoundIndex = live ? tournament.currentRound : null;
  const finished = isTournamentFinished(tournament);

  const rounds = roundsIn.map((round, index) => {
    const mode = roundScoringMode(tournament, round);
    let board;
    try {
      board = roundLeaderboard(tournament, round);
    } catch {
      board = { mode, unit: 'pts', entries: [] };
    }
    const entries = assignPlacements(board.entries, comparatorForBoardMode(board.mode));
    const holes = Array.isArray(round?.holes) ? round.holes : [];
    let feedItem = null;
    try {
      feedItem = buildFeedItem(tournament, round, index, mode, finished);
    } catch {
      feedItem = null;
    }
    return {
      id: round?.id ?? `round-${index}`,
      label: formatRoundLabel({
        kind: payload.kind,
        courseName: round?.courseName || round?.course?.name || '',
        roundIndex: index,
      }),
      leaderboard: { ...board, entries },
      isLive: live && index === liveRoundIndex,
      holesPlayed: holes.length,
      thru: computeThru(round, players, mode),
      feedItem,
    };
  });

  let overall = [];
  try {
    const overallBoard = tournamentLeaderboardResolved(tournament);
    overall = assignPlacements(overallBoard.entries, comparatorForBoardMode(overallBoard.mode));
  } catch {
    overall = [];
  }

  return {
    tournamentName: payload.name || '',
    rounds,
    overall,
    liveRoundIndex,
  };
}

// ---------------------------------------------------------------------------
// `feedItem`: a FeedRoundCard-shaped item per round (Phase 1.5 build item 2).
// Mirrors buildFeed's per-round item in feedStore.js (~413-554) MINUS the
// friends-only filtering feedStore does (there is no "me"/friend concept on
// an anonymous public page — every scored player/team is shown) and minus
// avatars (the RPC never returns them; `avatarUrl` is always null here).
// Built from the same pure primitives feedStore reads (`roundTotals` /
// `scrambleRoundTally` / `resolvePairs`), so the numbers can never drift from
// what the authenticated feed shows for the same round.
//
// `holesPlayed` / `vsParThrough` below are small pure re-statements of
// feedStore.js's own (module-private, unexported) helpers of the same name —
// duplicated rather than imported because exporting them is feedStore.js's
// call, not this build item's (touch-scope is `src/store/sharedBoard.js`
// only). `vsParThrough` still delegates the actual handicap math to
// `calcExtraShots`, so it does not fork the scoring itself, only the
// through-N-holes bookkeeping around it.
function holesPlayed(round, unitId) {
  const scores = round?.scores?.[unitId];
  if (!scores) return 0;
  return Object.values(scores).filter((v) => v != null).length;
}

function vsParThrough(round, unitId, handicap) {
  const scores = round?.scores?.[unitId];
  if (!scores) return { vsPar: null, allowed: null };
  let strokes = 0;
  let par = 0;
  let allowed = 0;
  let played = 0;
  for (const hole of round?.holes ?? []) {
    const s = scores[hole.number];
    if (s != null) {
      strokes += s;
      par += hole.par ?? 0;
      played += 1;
      if (Number.isFinite(handicap)) allowed += calcExtraShots(handicap, hole.strokeIndex, holeCountOf(round));
    }
  }
  if (played === 0) return { vsPar: null, allowed: null };
  return { vsPar: strokes - par, allowed: Number.isFinite(handicap) ? allowed : null };
}

// `tournament` is the same tournament-shaped object buildSharedBoardModel
// already assembled (players/rounds normalised); `finished` is that
// tournament's isTournamentFinished() result, computed once by the caller
// and shared across every round's item (same as feedStore's `finished`).
// Returns null when nobody has scored anything yet — a round with no
// results gets no feed card, matching feedStore's `if (results.length ===
// 0) return;` skip.
function buildFeedItem(tournament, round, index, mode, finished) {
  const players = tournament.players;
  const results = [];
  let playerCount = 0;
  let hiddenPlayerCount = null;
  let teamsLabel = null;

  if (isScrambleMode(mode)) {
    // One result per TEAM, keyed by captain — scramble scores live under
    // pair[0] with a team handicap (scrambleUnits), so a per-player split
    // would surface only captains. Nothing is filtered by "mine/friend" on
    // a public board, so every scored team is shown and nothing is hidden.
    hiddenPlayerCount = 0;
    for (const row of scrambleRoundTally(round, players)?.totals ?? []) {
      const { unit } = row;
      if (row.strokes === 0) continue;
      playerCount += unit.members.length;
      const pace = vsParThrough(round, unit.id, unit.handicap);
      results.push({
        playerId: unit.id,
        name: unit.name,
        avatarUrl: null,
        points: row.points,
        strokes: row.strokes,
        holes: holesPlayed(round, unit.id),
        handicap: unit.handicap,
        vsPar: pace.vsPar,
        vsParAllowed: pace.allowed,
      });
    }
  } else {
    const scored = roundTotals(round, players)
      .filter((entry) => entry.player && entry.totalStrokes > 0);
    playerCount = scored.length;
    for (const entry of scored) {
      const { player } = entry;
      const pace = vsParThrough(round, player.id, entry.handicap);
      results.push({
        playerId: player.id,
        name: player.name,
        avatarUrl: null,
        points: entry.totalPoints,
        strokes: entry.totalStrokes,
        holes: holesPlayed(round, player.id),
        handicap: Number.isFinite(entry.handicap) ? entry.handicap : null,
        vsPar: pace.vsPar,
        vsParAllowed: pace.allowed,
      });
    }
    // "Marcos + Noé vs Guille + Alex" — scramble rounds skip this: their
    // tiles ARE the teams (same rule as feedStore.js:493-500).
    const pairs = resolvePairs(round?.pairs, players) ?? [];
    if (pairs.length === 2 && pairs.every((pr) => Array.isArray(pr) && pr.length > 0)) {
      teamsLabel = pairs
        .map((pr) => pr.map((m) => (m?.name ?? '').split(' ')[0] || '?').join(' + '))
        .join(' vs ');
    }
  }

  if (results.length === 0) return null;

  results.sort((a, b) => b.points - a.points);

  const totalHoles = round?.holes?.length ?? 18;
  const maxHoles = Math.max(0, ...results.map((r) => r.holes ?? 0));
  const live = !finished && maxHoles > 0 && maxHoles < totalHoles;

  return {
    type: 'round',
    // No real tournament id survives the whitelist (see the migration
    // header) — keyed on the round id alone, which is unique within one
    // board response.
    key: `board-round:${round?.id ?? index}`,
    // Rounds carry no timestamp of their own in the whitelisted payload —
    // only the tournament-level createdAt does. Same fallback shape as
    // feedStore's roundActivityTs degraded case: the tournament instant
    // folded with the round's position, so cards sort deterministically
    // even though this isn't a real per-round activity signal.
    ts: (Date.parse(tournament.createdAt) || 0) + index,
    tournamentName: tournament.name || '',
    roundIndex: index,
    courseName: round?.courseName ?? null,
    results,
    playerCount,
    hiddenPlayerCount,
    teamsLabel,
    live,
    totalHoles,
    scoringMode: mode,
    finished,
  };
}

// ---------------------------------------------------------------------------
// Media model (Phase 1.5 build item 2). Consumes the (separately fetched)
// `get_shared_board_media(p_token)` RPC's rows — see
// supabase/migrations/20260816010000_shared_board_media.sql for the
// authoritative whitelist ({ id, roundId, holeIndex, kind, storagePath,
// thumbPath, durationS, createdAt }, newest-first; no uploader/caption/
// tournament id — see that migration's header for why). Builds the props
// MemoryCard (src/components/MemoryCard.js) and MemoriesStoriesViewer
// (src/components/MemoriesStoriesViewer.js) / RoundStoriesRail
// (src/components/feed/RoundStoriesRail.js) read.
const MEDIA_BUCKET = 'tournament-media';

// Same getPublicUrl mapping mediaStore.js's rowToMedia does for the
// authenticated path (mediaStore.js:14-19) — a pure string builder, no
// network/auth call. Tolerant of a missing/non-string path.
function publicUrl(path) {
  if (typeof path !== 'string' || !path) return null;
  try {
    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

// Mirrors feedStore.js's own (private) mediaCountLabel — trivial string
// formatting, not scoring math, so restating it here doesn't fork anything
// that matters.
function mediaCountLabel(count, hasVideo) {
  if (count === 1) return hasVideo ? '1 memory' : '1 photo';
  return hasVideo ? `${count} memories` : `${count} photos`;
}

function mediaRowToItem(row) {
  if (!row || typeof row !== 'object' || row.roundId == null) return null;
  return {
    id: row.id ?? null,
    roundId: row.roundId,
    holeIndex: typeof row.holeIndex === 'number' ? row.holeIndex : null,
    kind: row.kind === 'video' ? 'video' : 'photo',
    durationS: row.durationS ?? null,
    createdAt: row.createdAt ?? null,
    url: publicUrl(row.storagePath),
    thumbUrl: publicUrl(row.thumbPath) || publicUrl(row.storagePath),
  };
}

// Maps `get_shared_board_media`'s rows (newest-first) plus the already-built
// `model` (buildSharedBoardModel's output, for round index/label lookup)
// into `{ byRoundId, stories, coverForRound, total, hasVideo }`.
//
// `byRoundId[roundId]` and each story's `mediaList` are oldest-first —
// matching the convention every other pure helper in this app uses for
// playback order (buildRoundStories / deriveRoundEntries), so
// MemoriesStoriesViewer plays a round's photos chronologically. Covers use
// the newest item instead (mirrors feedStore's `mediaList[mediaList.length -
// 1]` "newest" pick).
//
// Tolerant of null/non-array/malformed rows and an unmatched/missing
// `model` — this is fed straight from an anon network response and must
// never throw.
export function buildSharedMediaModel(mediaRows, model) {
  const rows = Array.isArray(mediaRows) ? mediaRows : [];
  const rounds = Array.isArray(model?.rounds) ? model.rounds : [];
  const roundMeta = new Map(rounds.map((r, i) => [r.id, { roundIndex: i, roundLabel: r.label }]));

  // Grouped in input (newest-first) order; reversed per round below.
  const groupsNewestFirst = new Map();
  let total = 0;
  let hasVideo = false;

  for (const row of rows) {
    const item = mediaRowToItem(row);
    if (!item) continue;
    total += 1;
    if (item.kind === 'video') hasVideo = true;
    const list = groupsNewestFirst.get(item.roundId) ?? [];
    list.push(item);
    groupsNewestFirst.set(item.roundId, list);
  }

  const byRoundId = {};
  const coverForRound = {};
  const stories = [];

  for (const [roundId, itemsNewestFirst] of groupsNewestFirst) {
    const items = itemsNewestFirst.slice().reverse(); // oldest-first
    byRoundId[roundId] = items;
    const newest = items[items.length - 1];
    coverForRound[roundId] = newest?.thumbUrl || newest?.url || null;

    const meta = roundMeta.get(roundId) ?? { roundIndex: -1, roundLabel: '' };
    const storyHasVideo = items.some((it) => it.kind === 'video');
    stories.push({
      key: `board-story:${roundId}`,
      roundId,
      roundIndex: meta.roundIndex,
      roundLabel: meta.roundLabel,
      count: items.length,
      countLabel: mediaCountLabel(items.length, storyHasVideo),
      hasVideo: storyHasVideo,
      mediaList: items,
    });
  }

  stories.sort((a, b) => a.roundIndex - b.roundIndex);

  return {
    byRoundId, stories, coverForRound, total, hasVideo,
  };
}
