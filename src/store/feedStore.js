import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/connectivity';
import {
  loadAllTournamentsWithFallback,
  roundTotals,
  isTournamentFinished,
} from './tournamentStore';
import { loadMediaForTournaments } from './mediaStore';
import { loadProfile } from './profileStore';
import { listFriends, getCachedFriends } from './friendStore';

// The activity feed is derived client-side (no server aggregation table).
// It unions the current user's tournaments with tournaments their friends
// played — discovered through tournament_participants — then flattens every
// completed round and every photo into a single time-sorted item list.

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

// Build the full, time-sorted feed. Never throws — degrades to whatever
// data is reachable. Returns { me, friends, items, partial, error }.
//   - error:   true when the feed could not be built at all (no items).
//   - partial: true when some — but not all — data sources failed, so the
//              feed is incomplete (e.g. friends loaded but media did not).
// The screen uses these to show a Retry-able error state distinct from a
// genuinely empty feed.
export async function buildFeed() {
  let partial = false;

  let me = null;
  try { me = await currentUserId(); } catch { partial = true; }

  let profile = null;
  try { profile = await loadProfile(); } catch { partial = true; /* offline */ }
  const myName = (profile?.displayName ?? '').trim().toLowerCase();

  let friends = [];
  try {
    friends = await listFriends();
  } catch {
    partial = true;
    friends = await getCachedFriends();
  }
  const friendIds = friends.map((f) => f.userId);
  const friendSet = new Set(friendIds);
  const friendById = new Map(friends.map((f) => [f.userId, f]));

  let myTournaments = [];
  try {
    ({ list: myTournaments } = await loadAllTournamentsWithFallback());
  } catch {
    // The only hard-fail path: with no tournaments at all there is nothing
    // to build a feed from.
    return { me, friends, items: [], partial: false, error: true };
  }
  const haveIds = new Set(myTournaments.map((t) => t.id));
  const friendTournaments = await fetchFriendTournaments(friendIds, haveIds);

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
      for (const entry of totals) {
        const player = entry.player;
        if (!player || entry.totalStrokes === 0) continue;
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
        playerCount: results.length,
        finished,
        // A friend's round the current user did not play in.
        withMe: iAmIn || anyMine,
      });
    });
  }

  // Photos. Attributed by uploader user id (media.uploaderId) — falling back
  // to the case-folded uploader_label only for legacy media uploaded before
  // the id column existed.
  let media = [];
  try {
    media = await loadMediaForTournaments(all.map((t) => t.id));
  } catch { partial = true; /* offline — feed still shows rounds */ }

  const tournamentById = new Map(all.map((t) => [t.id, t]));
  // Group photos by round (tournament-level photos with no roundId group per
  // tournament) so the feed shows one swipeable card per round of memories.
  const photoGroups = new Map();
  for (const m of media) {
    const t = tournamentById.get(m.tournamentId);
    if (!t) continue;
    const groupKey = `${m.tournamentId}:${m.roundId ?? 'none'}`;
    let group = photoGroups.get(groupKey);
    if (!group) {
      group = { tournament: t, roundId: m.roundId ?? null, media: [] };
      photoGroups.set(groupKey, group);
    }
    group.media.push(m);
  }

  for (const group of photoGroups.values()) {
    const { tournament: t, roundId } = group;
    // Oldest-first so the feed carousel swipes chronologically.
    const list = group.media
      .slice()
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    if (list.length === 0) continue;
    // The card surfaces by its most recent photo; attribute it to that
    // photo's uploader — by user id when present, falling back to the
    // legacy display-name label.
    const newest = list[list.length - 1];
    const uploaderId = newest.uploaderId ?? null;
    const label = (newest.uploaderLabel ?? '').trim();
    const friendInfo = uploaderId ? friendById.get(uploaderId) : null;
    const isMine = uploaderId
      ? uploaderId === me
      : (!!myName && label.toLowerCase() === myName);
    const actorName = isMine
      ? 'You'
      : (friendInfo?.displayName || label || 'Someone');
    items.push({
      type: 'photo',
      key: `photos:${t.id}:${roundId ?? 'none'}`,
      ts: Date.parse(newest.createdAt) || 0,
      isMine,
      actorUserId: uploaderId,
      actorName,
      actorAvatarUrl: friendInfo?.avatarUrl ?? null,
      actorAvatarColor: friendInfo?.avatarColor ?? null,
      tournamentId: t.id,
      tournamentName: t.name,
      roundId,
      count: list.length,
      mediaList: list,
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  return { me, friends, items, partial, error: false };
}

// ---------------------------------------------------------------------------
// Feed reactions (emoji). Backed by the feed_reactions table added in
// migrations/20260516_feed_reactions_and_uploader.sql. Every function here
// degrades gracefully if the table is not yet present — the feed must keep
// working before the migration is applied.
// ---------------------------------------------------------------------------

export const FEED_REACTION_EMOJI = ['👏', '🔥', '⛳', '😂'];

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
