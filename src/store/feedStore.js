import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/connectivity';
import {
  loadCachedTournamentsList,
  loadAllTournamentsWithFallback,
  roundTotals,
  isTournamentFinished,
  formatRoundLabel,
} from './tournamentStore';
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

// Best "when did this round happen" proxy: the newest LWW timestamp stamped
// on any path under this round. Falls back to tournament creation time.
function roundActivityTs(t, roundId, roundIndex) {
  let max = 0;
  const meta = t._meta ?? {};
  const prefix = `rounds.${roundId}.`;
  for (const key in meta) {
    if (key.startsWith(prefix)) {
      const v = meta[key];
      if (typeof v === 'number' && v > max) max = v;
    }
  }
  if (max) return max;
  return (Number(t.id) || 0) + roundIndex;
}

function holesPlayed(round, playerId) {
  const scores = round?.scores?.[playerId];
  if (!scores) return 0;
  return Object.values(scores).filter((v) => v != null).length;
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
    const { data, error } = await supabase
      .from('tournaments')
      .select('data')
      .in('id', missing);
    if (error) throw error;
    return (data ?? []).map((r) => ({ ...r.data, _role: 'friend' }));
  } catch {
    return [];
  }
}

async function resolveFeedUserId(userId) {
  if (userId !== undefined) return userId ?? null;
  return currentUserId();
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
  } = options;
  let partial = false;

  let me = null;
  try { me = await resolveFeedUserId(userId); } catch { partial = true; }

  let friends = [];
  try {
    const friendResult = await loadFeedFriends(source);
    friends = friendResult.friends;
    partial = partial || !!friendResult.partial;
  } catch {
    partial = true;
    friends = [];
  }
  const friendIds = friends.map((f) => f.userId);
  const friendSet = new Set(friendIds);
  const friendById = new Map(friends.map((f) => [f.userId, f]));

  let myTournaments = [];
  let tournamentResult = null;
  try {
    tournamentResult = await loadFeedTournaments(source);
    ({ list: myTournaments } = tournamentResult);
    partial = partial || !!tournamentResult?.stale;
  } catch {
    // The only hard-fail path: with no tournaments at all there is nothing
    // to build a feed from.
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
  const all = [...byId.values()];

  const items = [];

  for (const t of all) {
    const players = t.players ?? [];
    const iAmIn = players.some((p) => p.user_id && p.user_id === me);
    const finished = isTournamentFinished(t);

    (t.rounds ?? []).forEach((round, roundIndex) => {
      if (!round || round._deleted || !round.scores) return;
      const totals = roundTotals(round, players);
      const ts = roundActivityTs(t, round.id, roundIndex);

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
        });
      }
      if (results.length === 0) return;

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
        // A friend's round the current user did not play in.
        withMe: iAmIn || anyMine,
      });
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  const limitedItems = limit == null ? items : items.slice(0, limit);

  let roundStories = [];
  if (includeMedia) {
    const visibleTournamentIds = [...new Set(limitedItems.map((item) => item.tournamentId))];
    const visibleRoundKeys = new Set(limitedItems.map((item) => (
      `${item.tournamentId}:${item.roundId ?? 'none'}`
    )));
    const visibleTournaments = all.filter((t) => visibleTournamentIds.includes(t.id));

    // Photos. Attributed by uploader user id (media.uploaderId) — falling back
    // to the case-folded uploader_label only for legacy media uploaded before
    // the id column existed.
    let media = [];
    try {
      media = await loadMediaForTournaments(visibleTournamentIds);
    } catch { partial = true; /* offline — feed still shows rounds */ }

    const visibleMedia = media.filter((item) => (
      visibleRoundKeys.has(`${item.tournamentId}:${item.roundId ?? 'none'}`)
    ));
    roundStories = buildRoundStories(visibleTournaments, visibleMedia);
    const storyByRoundKey = new Map(roundStories.map((story) => [
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

  return { me, friends, items: limitedItems, roundStories, partial, error: false };
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
