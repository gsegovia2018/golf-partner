import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/connectivity';
import {
  loadCachedTournamentsList,
  loadAllTournamentsWithFallback,
  roundTotals,
  isTournamentFinished,
  formatRoundLabel,
} from './tournamentStore';
import {
  fetchTournament as fetchTournamentRemote,
  fetchRoundActivity,
} from './tournamentRepo';
import { roundScoringMode, calcExtraShots } from './scoring';
import { loadMediaForTournaments } from './mediaStore';
import { listFriends, getCachedFriends } from './friendStore';

// The activity feed is derived client-side (no server aggregation table).
// It unions the current user's tournaments with tournaments their friends
// played — discovered through tournament_participants — then flattens every
// completed round into a single time-sorted item list. Round media is grouped
// into stories and attached to the corresponding round card.

// Set true once any data source has failed during a buildFeed pass. Surfaces
// to the screen so it can show a distinct error/partial state instead of
// pretending the feed is genuinely empty.

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Real per-round "last touched" timestamp, used purely for feed ordering.
// Sourced from the get_round_activity RPC, which computes
// GREATEST(max(game_scores.updated_at), game_rounds.updated_at) per round
// server-side — CRUCIALLY including game_scores, because set_game_score
// writes ONLY the game_scores row and does NOT bump game_rounds.updated_at
// (verified against the migration: only patch_game_round / upsertRound touch
// game_rounds.updated_at). Scoring is the single most common round activity,
// so keying off game_rounds.updated_at alone would leave an actively-scored
// round frozen at its last config edit and let a stale finished round
// outrank a live one. This replaces the legacy `t._meta` LWW-stamp heuristic
// (gone post-Task-11: blob writers were deleted, so _meta was never stamped
// and every lookup silently fell through to the tournament-id fallback).
//
// Previously this issued two unpaginated .from('game_scores') /
// .from('game_rounds') selects directly — PostgREST caps an unpaginated
// response at 1000 rows, and prod's game_scores table (~1398 rows and
// growing) silently truncated past that cap, leaving whichever tournaments'
// score rows fell outside the first (unordered) 1000 with no activity
// timestamp at all. get_round_activity aggregates server-side instead,
// returning one row PER ROUND rather than per score cell — which dramatically
// raises the ceiling (from ~total-score-cell count to ~total-round count),
// but does NOT remove it: PostgREST's db-max-rows (max_rows=1000) caps
// SETOF/TABLE-returning RPCs too, so a caller with enough tournaments could
// still exceed 1000 rounds in one RPC. So we also CHUNK the id list into
// bounded batches (ROUND_ACTIVITY_CHUNK tournaments per call): with only a
// handful of rounds per tournament, 200 tournaments/call keeps each response
// far under 1000 rows with large headroom, and it scales to any number of
// tournaments. Chunks run concurrently; a single failing chunk is swallowed
// (Promise.allSettled) so the rest still contribute their real timestamps —
// rounds from a failed chunk are simply absent from the map, and
// roundActivityTs falls back for them. Same RLS as game_rounds/game_scores
// (SECURITY INVOKER — see the migration). Callers must treat a missing entry
// as "timestamp unknown", not zero, and fall back accordingly.
const ROUND_ACTIVITY_CHUNK = 200;

async function fetchRoundActivityTimestamps(tournamentIds) {
  const map = new Map();
  if (tournamentIds.length === 0 || !isOnline()) return map;
  const chunks = [];
  for (let i = 0; i < tournamentIds.length; i += ROUND_ACTIVITY_CHUNK) {
    chunks.push(tournamentIds.slice(i, i + ROUND_ACTIVITY_CHUNK));
  }
  const settled = await Promise.allSettled(chunks.map((chunk) => fetchRoundActivity(chunk)));
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue; // failed chunk → its rounds fall back
    for (const row of res.value ?? []) {
      const ms = Date.parse(row.activity_ts);
      if (Number.isFinite(ms)) map.set(`${row.tournament_id}:${row.round_id}`, ms);
    }
  }
  return map;
}

// "When did this round last see activity" for feed ordering. Prefers the
// real game_rounds.updated_at timestamp (activityTsByKey, from
// fetchRoundActivityTimestamps above). Falls back to the tournament's
// creation instant folded with the round's position ONLY when the real
// timestamp couldn't be fetched (offline / query failure / cache-only
// build, or a round somehow missing from the map) — this keeps the sort
// stable and roughly tournament-grouped rather than silently randomizing,
// but it is NOT a recency signal in that degraded case: two rounds from the
// same tournament sort by index, not by which was actually played/edited
// more recently.
function roundActivityTs(t, roundId, roundIndex, activityTsByKey) {
  const real = activityTsByKey?.get(`${t.id}:${roundId}`);
  if (typeof real === 'number' && Number.isFinite(real)) return real;
  return (Date.parse(t.createdAt) || Number(t.id) || 0) + roundIndex;
}

function holesPlayed(round, playerId) {
  const scores = round?.scores?.[playerId];
  if (!scores) return 0;
  return Object.values(scores).filter((v) => v != null).length;
}

// Strokes vs par across only the holes this player has actually scored, so a
// mid-round card compares like-for-like (through N holes, not against a full
// 18-hole par). `allowed` is the handicap allowance over those same holes —
// the extra shots (by stroke index) the player's playing handicap grants —
// so the card can colour vs-par against the pace they "should" be on rather
// than against scratch. Both are null when nothing is scored yet.
function vsParThrough(round, playerId, handicap) {
  const scores = round?.scores?.[playerId];
  if (!scores) return { vsPar: null, allowed: null };
  let strokes = 0;
  let par = 0;
  let allowed = 0;
  let played = 0;
  for (const hole of round.holes ?? []) {
    const s = scores[hole.number];
    if (s != null) {
      strokes += s;
      par += hole.par ?? 0;
      played++;
      if (Number.isFinite(handicap)) allowed += calcExtraShots(handicap, hole.strokeIndex);
    }
  }
  if (played === 0) return { vsPar: null, allowed: null };
  return { vsPar: strokes - par, allowed: Number.isFinite(handicap) ? allowed : null };
}

const ROUND_STORY_LIMIT = 12;

function mediaTs(media) {
  return Date.parse(media?.createdAt) || 0;
}

function mediaCountLabel(count, hasVideo) {
  if (count === 1) return hasVideo ? '1 memory' : '1 photo';
  return hasVideo ? `${count} memories` : `${count} photos`;
}

function roundLabelForStory(tournament, roundId) {
  const rounds = tournament?.rounds ?? [];
  const index = rounds.findIndex((r) => r.id === roundId);
  const round = index >= 0 ? rounds[index] : null;
  return {
    round,
    roundIndex: index,
    roundLabel: round?.courseName
      || (index >= 0 ? formatRoundLabel({
        kind: tournament?.kind,
        courseName: round?.courseName,
        roundIndex: index,
      }) : tournament?.name || 'Tournament photos'),
  };
}

export function buildRoundStories(tournaments, media, options = {}) {
  const limit = options.limit ?? ROUND_STORY_LIMIT;
  const tournamentById = new Map((tournaments ?? []).map((t) => [t.id, t]));
  const groups = new Map();

  for (const item of media ?? []) {
    if (!item?.tournamentId || !item.roundId) continue;
    const tournament = tournamentById.get(item.tournamentId);
    if (!tournament) continue;
    if (!(tournament.rounds ?? []).some((round) => round.id === item.roundId)) continue;
    const groupKey = `${item.tournamentId}:${item.roundId ?? 'none'}`;
    let group = groups.get(groupKey);
    if (!group) {
      const { round, roundIndex, roundLabel } = roundLabelForStory(tournament, item.roundId ?? null);
      group = {
        key: `story:${item.tournamentId}:${item.roundId ?? 'none'}`,
        tournamentId: item.tournamentId,
        tournamentName: tournament.name,
        roundId: item.roundId ?? null,
        roundIndex,
        roundLabel,
        courseName: round?.courseName ?? null,
        latestTs: 0,
        mediaList: [],
        count: 0,
        uploaderNames: [],
        hasVideo: false,
      };
      groups.set(groupKey, group);
    }
    group.mediaList.push(item);
    group.latestTs = Math.max(group.latestTs, mediaTs(item));
    group.hasVideo = group.hasVideo || item.kind === 'video';
    const name = (item.uploaderLabel ?? '').trim();
    if (name && !group.uploaderNames.includes(name)) group.uploaderNames.push(name);
  }

  return [...groups.values()]
    .map((group) => {
      const mediaList = group.mediaList.slice().sort((a, b) => mediaTs(a) - mediaTs(b));
      const uploaderNames = [];
      for (const item of mediaList) {
        const name = (item.uploaderLabel ?? '').trim();
        if (name && !uploaderNames.includes(name)) uploaderNames.push(name);
      }
      return {
        ...group,
        mediaList,
        count: mediaList.length,
        countLabel: mediaCountLabel(mediaList.length, group.hasVideo),
        uploaderNames,
      };
    })
    .filter((group) => group.count > 0)
    .sort((a, b) => b.latestTs - a.latestTs)
    .slice(0, limit);
}

// Fetch tournaments a friend played that the current user's own list does
// not already include. Relies on the friend-aware RLS added in
// migrations/20260515_friends_and_feed.sql. Network-only; returns [] on
// failure so the feed still renders the user's own activity.
//
// One get_game_tournament RPC call per missing id (not a bulk blob select) —
// the legacy `tournaments.data` blob column is frozen (nothing has written it
// since Task 11), so a bulk select would return permanently stale copies.
// The feed is not a hot path, so N small round-trips here (N = friend
// tournaments the caller doesn't already have, typically a handful) is an
// accepted trade for reusing the already-correct per-tournament read path
// rather than adding a new batched-fetch RPC. A single friend tournament
// failing to fetch doesn't drop the rest (Promise.allSettled).
async function fetchFriendTournaments(friendIds, alreadyHaveIds) {
  if (friendIds.length === 0 || !isOnline()) return [];
  try {
    const { data: parts, error: pErr } = await supabase
      .from('tournament_participants')
      .select('tournament_id')
      .in('user_id', friendIds);
    if (pErr) throw pErr;
    const missing = [...new Set((parts ?? []).map((p) => p.tournament_id))]
      .filter((id) => !alreadyHaveIds.has(id));
    if (missing.length === 0) return [];
    const settled = await Promise.allSettled(missing.map((id) => fetchTournamentRemote(id)));
    return settled
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => ({ ...r.value, _role: 'friend' }));
  } catch {
    return [];
  }
}

async function resolveFeedUserId(userId) {
  if (userId !== undefined) return userId ?? null;
  return currentUserId();
}

// ---------------------------------------------------------------------------
// Build-pipeline cache. The remote path fans out into a friend-list RPC, one
// fetchTournament RPC per not-already-owned friend tournament, and chunked
// get_round_activity RPCs (see fetchFriendTournaments / fetchRoundActivityTimestamps
// above) — expensive, and identical work whether it's re-run because the
// screen refocused with nothing new to show, or because `onEndReached` asked
// for the next slice of the SAME already-sorted list. Every successful
// non-'cache'-source build stores its fetched ingredients here so a caller
// that opts in with `useCache: true` (a plain refocus, or a pagination page
// fetch — see FeedScreen) can reuse them and skip the network entirely.
// Never read unless the caller explicitly asks (default `useCache: false`),
// so every existing direct buildFeed() call keeps doing a fresh fetch exactly
// as before. A tournament-change event (real data change) must call
// invalidateFeedCache() first so the next build is guaranteed fresh.
//
// Safety net: subscribeTournamentChanges only fires for changes THIS device
// observes locally (its own edits, or a realtime event for a tournament it
// has an open channel on) — a friend's edit landing purely server-side while
// this device sits idle on the Feed screen produces no local event to
// invalidate the cache. A short TTL bounds that worst case so a stale-cache
// refocus can never show data older than FEED_CACHE_TTL_MS, without
// defeating the point of caching rapid pagination/refocus bursts.
const FEED_CACHE_TTL_MS = 3 * 60 * 1000;
let feedBuildCache = null; // { key, ts, friends, friendSet, friendById, all, activityTsByKey, partial }

function feedCacheKey(userId, source) {
  return `${userId ?? 'anon'}::${source}`;
}

export function invalidateFeedCache() {
  feedBuildCache = null;
}

async function loadFeedFriends(source) {
  if (source === 'cache') {
    return { friends: await getCachedFriends(), partial: false };
  }
  try {
    return { friends: await listFriends(), partial: false };
  } catch {
    return { friends: await getCachedFriends(), partial: true };
  }
}

async function loadFeedTournaments(source) {
  if (source === 'cache') {
    return { list: await loadCachedTournamentsList(), stale: true };
  }
  return loadAllTournamentsWithFallback();
}

// Build the full, time-sorted feed. Never throws — degrades to whatever
// data is reachable. Returns { me, friends, items, roundStories, partial, error }.
//   - error:   true when the feed could not be built at all (no items).
//   - partial: true when some — but not all — data sources failed, so the
//              feed is incomplete (e.g. friends loaded but media did not).
// The screen uses these to show a Retry-able error state distinct from a
// genuinely empty feed.
export async function buildFeed(options = {}) {
  const {
    userId,
    source = 'remote',
    includeMedia = true,
    limit = null,
    offset = 0,
    // Opt-in only: every direct call keeps doing a fresh fetch unless the
    // caller explicitly asks to reuse the last build's ingredients (see the
    // feedBuildCache block above).
    useCache = false,
  } = options;
  let partial = false;

  let me = null;
  try { me = await resolveFeedUserId(userId); } catch { partial = true; }

  const cacheKey = feedCacheKey(me, source);
  const cached = feedBuildCache;
  const cacheFresh = !!cached && (Date.now() - cached.ts) < FEED_CACHE_TTL_MS;
  const canReuseCache = useCache && source !== 'cache' && cacheFresh && cached.key === cacheKey;

  let friends;
  let friendSet;
  let friendById;
  let all;
  let activityTsByKey;

  if (canReuseCache) {
    ({
      friends, friendSet, friendById, all, activityTsByKey,
    } = cached);
    partial = partial || cached.partial;
  } else {
    let basePartial = false;

    friends = [];
    try {
      const friendResult = await loadFeedFriends(source);
      friends = friendResult.friends;
      basePartial = basePartial || !!friendResult.partial;
    } catch {
      basePartial = true;
      friends = [];
    }
    const friendIds = friends.map((f) => f.userId);
    friendSet = new Set(friendIds);
    friendById = new Map(friends.map((f) => [f.userId, f]));

    let myTournaments = [];
    let tournamentResult = null;
    try {
      tournamentResult = await loadFeedTournaments(source);
      ({ list: myTournaments } = tournamentResult);
      basePartial = basePartial || !!tournamentResult?.stale;
    } catch {
      // The only hard-fail path: with no tournaments at all there is nothing
      // to build a feed from. Leave any existing cache untouched.
      return { me, friends, items: [], roundStories: [], partial: false, error: true };
    }
    const haveIds = new Set(myTournaments.map((t) => t.id));
    const friendTournaments = source === 'cache'
      ? []
      : await fetchFriendTournaments(friendIds, haveIds);

    // De-dupe by id; my own blob wins over a friend-fetched copy.
    const byId = new Map();
    for (const t of [...myTournaments, ...friendTournaments]) {
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
    all = [...byId.values()];

    // Real per-round recency for ordering (see roundActivityTs above). Skipped
    // for a cache-only build — same as fetchFriendTournaments above, there's no
    // network to query and every round falls back to the deterministic (not
    // recency-based) ordering instead.
    activityTsByKey = source === 'cache'
      ? new Map()
      : await fetchRoundActivityTimestamps([...new Set(all.map((t) => t.id))]);

    partial = partial || basePartial;

    if (source !== 'cache') {
      feedBuildCache = {
        key: cacheKey, ts: Date.now(), friends, friendSet, friendById, all, activityTsByKey, partial: basePartial,
      };
    }
  }

  const items = [];

  for (const t of all) {
    const players = t.players ?? [];
    const iAmIn = players.some((p) => p.user_id && p.user_id === me);
    const finished = isTournamentFinished(t);

    (t.rounds ?? []).forEach((round, roundIndex) => {
      if (!round || round._deleted || !round.scores) return;
      const totals = roundTotals(round, players);
      const ts = roundActivityTs(t, round.id, roundIndex, activityTsByKey);

      // A 4-player round produces up to 4 per-player entries. Collect them
      // all into ONE feed card for the round-event so the feed shows a
      // single card with every player's result.
      const results = [];
      let scoredPlayerCount = 0;
      for (const entry of totals) {
        const player = entry.player;
        if (!player || entry.totalStrokes === 0) continue;
        scoredPlayerCount += 1;
        const uid = player.user_id ?? null;
        const isMe = !!uid && uid === me;
        const isFriend = !!uid && friendSet.has(uid);
        if (!isMe && !isFriend) continue; // skip guests / strangers

        const friendInfo = isFriend ? friendById.get(uid) : null;
        const pace = vsParThrough(round, player.id, entry.handicap);
        results.push({
          playerId: player.id,
          userId: uid,
          isMine: isMe,
          isFriend,
          name: isMe ? 'You' : (friendInfo?.displayName ?? player.name),
          avatarUrl: friendInfo?.avatarUrl ?? player.avatar_url ?? null,
          avatarColor: friendInfo?.avatarColor ?? null,
          points: entry.totalPoints,
          strokes: entry.totalStrokes,
          holes: holesPlayed(round, player.id),
          handicap: Number.isFinite(entry.handicap) ? entry.handicap : null,
          vsPar: pace.vsPar,
          vsParAllowed: pace.allowed,
        });
      }
      if (results.length === 0) return;

      // A round is "live" when the tournament is still open and the leading
      // player has scored at least one hole but not the whole round. Drives
      // the feed card's LIVE pill and per-player glowing "on hole N" badge.
      const totalHoles = round.holes?.length ?? 18;
      const maxHoles = Math.max(0, ...results.map((r) => r.holes ?? 0));
      const live = !finished && maxHoles > 0 && maxHoles < totalHoles;

      // Best result (most points) leads the card. Mine wins ties so the feed
      // foregrounds the current user when they were in the round.
      results.sort((a, b) => (b.points - a.points) || (b.isMine - a.isMine));
      const lead = results.find((r) => r.isMine) ?? results[0];
      const anyMine = results.some((r) => r.isMine);

      items.push({
        type: 'round',
        // Keyed by the round-event, not the player — one card per round.
        key: `round:${t.id}:${round.id}`,
        ts,
        isMine: anyMine,
        actorUserId: lead.userId,
        actorName: lead.name,
        actorAvatarUrl: lead.avatarUrl,
        actorAvatarColor: lead.avatarColor,
        tournamentId: t.id,
        tournamentName: t.name,
        tournamentKind: t.kind ?? 'tournament',
        roundId: round.id,
        roundIndex,
        courseName: round.courseName ?? null,
        // Lead player's headline numbers (kept for back-compat with the card).
        points: lead.points,
        strokes: lead.strokes,
        holes: lead.holes,
        // Every player's result for the grouped card.
        results,
        playerCount: scoredPlayerCount,
        finished,
        // Live-round + mode metadata for the feed card.
        live,
        totalHoles,
        scoringMode: roundScoringMode(t, round),
        // A friend's round the current user did not play in.
        withMe: iAmIn || anyMine,
      });
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  const limitedItems = limit == null
    ? items.slice(offset)
    : items.slice(offset, offset + limit);
  // True when there are more items beyond this page — drives infinite-scroll
  // pagination in FeedScreen (`onEndReached`). Always false when `limit` is
  // unset (an unbounded build has nothing left to page).
  const hasMore = limit != null && (offset + limit) < items.length;

  let roundStories = [];
  if (includeMedia) {
    // The round-stories rail must reflect the FULL feed history — every round
    // that has media — NOT just the paginated feed-card window. Before
    // pagination the remote build passed no `limit`, so `limitedItems ===
    // items` (the whole history) fed the rail; narrowing the rail to page 1
    // would silently drop a round whose fresh photo activity sorts outside
    // the newest-30-by-date window (a content regression). So the rail is
    // built from the full `items` set, decoupled from the card window.
    //
    // Only the FIRST page (offset 0) builds and owns the rail — it needs
    // media for every tournament in the history, exactly the cost the
    // pre-pagination remote build already paid on each build. Paginated
    // pages (offset > 0) skip the rail entirely (FeedScreen keeps page 1's)
    // and only load media for their own cards' tournaments, so scrolling
    // doesn't re-pay the full-history media fetch each page.
    const buildStoryRail = offset === 0;
    const storyItems = buildStoryRail ? items : limitedItems;
    const mediaTournamentIds = [...new Set(storyItems.map((item) => item.tournamentId))];
    const storyRoundKeys = new Set(storyItems.map((item) => (
      `${item.tournamentId}:${item.roundId ?? 'none'}`
    )));
    const storyTournaments = all.filter((t) => mediaTournamentIds.includes(t.id));

    // Photos. Attributed by uploader user id (media.uploaderId) — falling back
    // to the case-folded uploader_label only for legacy media uploaded before
    // the id column existed.
    let media = [];
    try {
      media = await loadMediaForTournaments(mediaTournamentIds);
    } catch { partial = true; /* offline — feed still shows rounds */ }

    const storyMedia = media.filter((item) => (
      storyRoundKeys.has(`${item.tournamentId}:${item.roundId ?? 'none'}`)
    ));
    // buildRoundStories covers every round in `storyItems`, which is a
    // superset of the page (`limitedItems`) on page 1 and equal to it on
    // later pages — so it can hydrate this page's cards in both cases.
    const builtStories = buildRoundStories(storyTournaments, storyMedia);
    if (buildStoryRail) roundStories = builtStories;
    const storyByRoundKey = new Map(builtStories.map((story) => [
      `${story.tournamentId}:${story.roundId ?? 'none'}`,
      story,
    ]));
    for (const item of limitedItems) {
      if (item.type !== 'round') continue;
      const story = storyByRoundKey.get(`${item.tournamentId}:${item.roundId ?? 'none'}`);
      if (!story) continue;
      const newestMedia = story.mediaList[story.mediaList.length - 1] ?? null;
      item.mediaCount = story.count;
      item.mediaCountLabel = story.countLabel;
      item.mediaId = newestMedia?.id ?? null;
      item.mediaCoverUrl = newestMedia?.thumbUrl || newestMedia?.url || null;
      item.mediaUrl = newestMedia?.url || newestMedia?.thumbUrl || null;
      item.mediaList = story.mediaList.slice();
      item.mediaHasVideo = story.hasVideo;
    }
  }

  return {
    me,
    friends,
    items: limitedItems,
    roundStories,
    partial,
    error: false,
    hasMore,
    nextOffset: offset + limitedItems.length,
  };
}

// ---------------------------------------------------------------------------
// Feed reactions (emoji). Backed by the feed_reactions table added in
// migrations/20260516_feed_reactions_and_uploader.sql. Every function here
// degrades gracefully if the table is not yet present — the feed must keep
// working before the migration is applied.
// ---------------------------------------------------------------------------

// Default quick-pick reactions shown on every feed card. Intentionally empty:
// the UI only shows reactions people have actually used, plus an input to add
// any emoji.
export const FEED_REACTION_EMOJI = [];

// Validates an emoji picked from the OS keyboard before it is stored.
// Mirrors the feed_reactions.emoji DB CHECK (1–16 chars) and requires at
// least one non-ASCII character so a typed word/letter is not stored as a
// "reaction". Returns true when `str` is acceptable.
export function isValidReactionEmoji(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (s.length < 1 || s.length > 16) return false;
  return /[^\x00-\x7F]/.test(s);
}

// A Postgres "relation does not exist" surfaces with code 42P01 (or a message
// mentioning the table). Treat that as "feature not provisioned yet".
function isMissingTable(error) {
  if (!error) return false;
  return error.code === '42P01'
    || /feed_reactions/i.test(error.message ?? '')
    || /does not exist/i.test(error.message ?? '');
}

// Reactions for a set of feed item keys, shaped for the screen:
//   { [itemKey]: { counts: { '🔥': 3, ... }, mine: ['🔥'] } }
// Returns {} on any failure (offline, table missing) — never throws.
export async function loadReactions(itemKeys) {
  const keys = [...new Set(itemKeys)].filter(Boolean);
  if (keys.length === 0 || !isOnline()) return {};
  try {
    const me = await currentUserId();
    const { data, error } = await supabase
      .from('feed_reactions')
      .select('item_key, user_id, emoji')
      .in('item_key', keys);
    if (error) {
      if (isMissingTable(error)) return {};
      throw error;
    }
    const out = {};
    for (const row of data ?? []) {
      let bucket = out[row.item_key];
      if (!bucket) { bucket = { counts: {}, mine: [] }; out[row.item_key] = bucket; }
      bucket.counts[row.emoji] = (bucket.counts[row.emoji] ?? 0) + 1;
      if (me && row.user_id === me && !bucket.mine.includes(row.emoji)) {
        bucket.mine.push(row.emoji);
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Toggle the current user's reaction on a feed item. Returns true on success,
// false if it could not be persisted (offline / table missing) so the caller
// can decide whether to keep an optimistic update.
export async function toggleReaction(itemKey, emoji, currentlyMine) {
  if (!itemKey || !emoji || !isOnline()) return false;
  try {
    const me = await currentUserId();
    if (!me) return false;
    if (currentlyMine) {
      const { error } = await supabase
        .from('feed_reactions')
        .delete()
        .eq('item_key', itemKey)
        .eq('user_id', me)
        .eq('emoji', emoji);
      if (error && !isMissingTable(error)) throw error;
      return !error;
    }
    const { error } = await supabase
      .from('feed_reactions')
      .insert({ item_key: itemKey, user_id: me, emoji });
    // A duplicate (23505) means the reaction is already there — treat as OK.
    if (error && error.code !== '23505' && !isMissingTable(error)) throw error;
    return !error || error.code === '23505';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Feed comments. Backed by the feed_comments table added in
// migrations/20260517_feed_comments.sql. Like reactions, every function here
// degrades gracefully if the table is not yet present or the device is
// offline — the feed must keep working before the migration is applied.
// ---------------------------------------------------------------------------

// Comment counts for a set of feed item keys: { [itemKey]: number }.
// Loaded with the feed as a lightweight overlay. Returns {} on any failure.
export async function loadCommentCounts(itemKeys) {
  const keys = [...new Set(itemKeys)].filter(Boolean);
  if (keys.length === 0 || !isOnline()) return {};
  try {
    const { data, error } = await supabase
      .from('feed_comments')
      .select('item_key')
      .in('item_key', keys);
    if (error) {
      if (isMissingTable(error)) return {};
      throw error;
    }
    const out = {};
    for (const row of data ?? []) {
      out[row.item_key] = (out[row.item_key] ?? 0) + 1;
    }
    return out;
  } catch {
    return {};
  }
}

// Full comment thread for one feed item, oldest first, each row enriched with
// the author's profile. Returns [] on any failure (offline / table missing).
export async function loadComments(itemKey) {
  if (!itemKey || !isOnline()) return [];
  try {
    const { data, error } = await supabase
      .from('feed_comments')
      .select('id, user_id, body, created_at')
      .eq('item_key', itemKey)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    const rows = data ?? [];
    // feed_comments.user_id references auth.users (not public.profiles), so
    // there is no FK PostgREST can embed through — fetch profiles separately.
    const authorIds = [...new Set(rows.map((r) => r.user_id))];
    const profiles = {};
    if (authorIds.length > 0) {
      const { data: profRows } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url, avatar_color')
        .in('user_id', authorIds);
      for (const p of profRows ?? []) profiles[p.user_id] = p;
    }
    const me = await currentUserId();
    return rows.map((r) => {
      const p = profiles[r.user_id];
      return {
        id: r.id,
        userId: r.user_id,
        body: r.body,
        createdAt: r.created_at,
        isMine: !!me && r.user_id === me,
        author: {
          name: p?.display_name ?? null,
          avatarUrl: p?.avatar_url ?? null,
          avatarColor: p?.avatar_color ?? null,
        },
      };
    });
  } catch {
    return [];
  }
}

// Adds a comment by the current user. Returns the created comment (shaped
// like a loadComments row) on success, or null on failure (offline / table
// missing / empty or over-long body).
export async function addComment(itemKey, body) {
  const text = (body ?? '').trim();
  if (!itemKey || text.length < 1 || text.length > 500 || !isOnline()) return null;
  try {
    const me = await currentUserId();
    if (!me) return null;
    const { data, error } = await supabase
      .from('feed_comments')
      .insert({ item_key: itemKey, user_id: me, body: text })
      .select('id, user_id, body, created_at')
      .single();
    if (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
    return {
      id: data.id,
      userId: data.user_id,
      body: data.body,
      createdAt: data.created_at,
      isMine: true,
      author: { name: null, avatarUrl: null, avatarColor: null },
    };
  } catch {
    return null;
  }
}

// Deletes one of the current user's comments. Returns true on success.
export async function deleteComment(commentId) {
  if (!commentId || !isOnline()) return false;
  try {
    const me = await currentUserId();
    if (!me) return false;
    const { error } = await supabase
      .from('feed_comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', me);
    if (error && !isMissingTable(error)) throw error;
    return !error;
  } catch {
    return false;
  }
}
