import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Friendships are a mutual request/accept graph (see
// supabase/migrations/20260515_friends_and_feed.sql). This module is the
// app-side surface: search users, send/accept/decline requests, list
// friends. The accepted-friends list is cached so the Feed degrades to a
// last-known set when offline.

const FRIENDS_CACHE_KEY = '@golf_friends_cache';

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Shared profile shape used everywhere a "person" is rendered.
function rowToPerson(row) {
  return {
    userId: row.user_id,
    username: row.username ?? '',
    displayName: row.display_name ?? row.username ?? 'Golfer',
    handicap: row.handicap ?? null,
    avatarUrl: row.avatar_url ?? null,
    avatarColor: row.avatar_color ?? null,
    gender: row.gender ?? null,
  };
}

async function fetchProfiles(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, handicap, avatar_url, avatar_color, gender')
    .in('user_id', ids);
  if (error) throw error;
  return (data ?? []).map(rowToPerson);
}

// Username prefix search. Excludes the current user. 2-char minimum keeps
// the result set sane and avoids a full-table scan on every keystroke.
//
// Goes through the search_profiles RPC (SECURITY DEFINER) rather than a
// direct profiles select: profiles_select RLS only exposes friends and
// shared-tournament members, which would make strangers unsearchable.
//
// `options.signal` accepts an AbortController signal so the caller can cancel
// a stale in-flight search. When the signal aborts, this rejects with a
// DOMException-like error whose `name` is 'AbortError' — callers should
// ignore that error rather than surfacing it.
export async function searchUsers(query, options = {}) {
  const { signal } = options;
  const q = (query ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  if (signal?.aborted) throw abortError();
  let request = supabase.rpc('search_profiles', { p_query: q });
  // supabase-js requests are abortable via .abortSignal().
  if (signal && typeof request.abortSignal === 'function') {
    request = request.abortSignal(signal);
  }
  const { data, error } = await request;
  if (signal?.aborted) throw abortError();
  if (error) {
    if (error.name === 'AbortError' || /abort/i.test(error.message ?? '')) {
      throw abortError();
    }
    throw error;
  }
  return (data ?? []).map(rowToPerson);
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

// True for the rejection produced by an aborted searchUsers call — lets the
// screen silently drop stale responses.
export function isAbortError(err) {
  return err?.name === 'AbortError';
}

// Raw accepted/pending rows touching the current user.
// `userId` lets a caller that already knows who is signed in (the Feed —
// it has the id from AuthContext) skip the `auth.getUser()` round trip to
// /auth/v1/user, which otherwise sits at the head of the feed's serial
// fetch chain. Omit it and we resolve the id ourselves, as before.
async function loadFriendshipRows(userId) {
  const me = userId ?? await currentUserId();
  if (!me) return { me: null, rows: [] };
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  if (error) throw error;
  return { me, rows: data ?? [] };
}

// Accepted friends, as Person objects. Caches the result for offline reads.
export async function listFriends(userId) {
  const { me, rows } = await loadFriendshipRows(userId);
  if (!me) return [];
  const friendIds = rows
    .filter((r) => r.status === 'accepted')
    .map((r) => (r.requester_id === me ? r.addressee_id : r.requester_id));
  const friends = await fetchProfiles(friendIds);
  AsyncStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify(friends)).catch(() => {});
  return friends;
}

// Last-known friends list — used by the Feed when a network read fails.
export async function getCachedFriends() {
  try {
    const raw = await AsyncStorage.getItem(FRIENDS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Pending requests split by direction. `incoming` are requests the user can
// accept/decline; `outgoing` are ones they sent and may cancel.
export async function listPendingRequests() {
  const { me, rows } = await loadFriendshipRows();
  if (!me) return { incoming: [], outgoing: [] };
  const pending = rows.filter((r) => r.status === 'pending');
  const incomingRows = pending.filter((r) => r.addressee_id === me);
  const outgoingRows = pending.filter((r) => r.requester_id === me);
  const [incomingP, outgoingP] = await Promise.all([
    fetchProfiles(incomingRows.map((r) => r.requester_id)),
    fetchProfiles(outgoingRows.map((r) => r.addressee_id)),
  ]);
  const byId = (list) => new Map(list.map((p) => [p.userId, p]));
  const inMap = byId(incomingP);
  const outMap = byId(outgoingP);
  return {
    incoming: incomingRows.map((r) => ({
      friendshipId: r.id,
      person: inMap.get(r.requester_id) ?? null,
    })).filter((x) => x.person),
    outgoing: outgoingRows.map((r) => ({
      friendshipId: r.id,
      person: outMap.get(r.addressee_id) ?? null,
    })).filter((x) => x.person),
  };
}

// Raw existing row (either ordering) for a pair, or null.
async function existingFriendshipRow(me, targetUserId) {
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${targetUserId}),` +
      `and(requester_id.eq.${targetUserId},addressee_id.eq.${me})`,
    );
  if (error) throw error;
  return (data ?? [])[0] ?? null;
}

// A row already exists for this pair — resolve it instead of inserting a
// mirror: already-accepted stays accepted; a row the target sent us gets
// accepted (turns mutual instead of sitting as two pending rows); otherwise
// it's our own request already out.
async function resolveExistingRow(row, targetUserId) {
  if (row.status === 'accepted') return { status: 'accepted' };
  if (row.requester_id === targetUserId) {
    await acceptRequest(row.id);
    return { status: 'accepted' };
  }
  return { status: 'pending' };
}

// Send a friend request. If the target already sent the current user a
// pending request, accept that instead of creating a mirror row.
//
// The check-then-insert below has a race window: two simultaneous "Add"
// taps (ours twice, or ours and the target's own concurrent request) can
// both pass the existence check before either insert lands. The DB closes
// that gap — friendships_unordered_pair_uq (migration 20260715000000) is a
// UNIQUE index on the unordered pair, so the loser's insert fails with a
// 23505. That is expected and handled here, not a real error: we re-read
// whichever row won and resolve it exactly like the pre-insert check would
// have, so the loser never sees a duplicate row or a thrown error.
export async function sendRequest(targetUserId) {
  const me = await currentUserId();
  if (!me) throw new Error('Not signed in');
  if (targetUserId === me) throw new Error('You cannot add yourself');

  const existingRow = await existingFriendshipRow(me, targetUserId);
  if (existingRow) return resolveExistingRow(existingRow, targetUserId);

  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: me, addressee_id: targetUserId, status: 'pending' });
  if (!error) return { status: 'pending' };

  if (error.code === '23505') {
    const row = await existingFriendshipRow(me, targetUserId);
    if (row) return resolveExistingRow(row, targetUserId);
    return { status: 'pending' }; // shouldn't happen, but fail soft
  }
  throw error;
}

export async function acceptRequest(friendshipId) {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId);
  if (error) throw error;
}

// Decline an incoming request or cancel an outgoing one — both delete the row.
// Also clears the friend_request notification so the recipient's badge stays
// honest. The cleanup is best-effort: the friendship is already gone, and a
// stale notification is harmless (it is marked read next time Friends opens).
export async function declineRequest(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
  try {
    await supabase.rpc('delete_notification_for_entity', {
      p_entity_id: friendshipId,
      p_type: 'friend_request',
    });
  } catch {
    // best-effort cleanup
  }
}

// Remove an existing friend. The row lives under either ordering of the
// pair, so delete by the unordered match.
export async function removeFriend(friendUserId) {
  const me = await currentUserId();
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${friendUserId}),` +
      `and(requester_id.eq.${friendUserId},addressee_id.eq.${me})`,
    );
  if (error) throw error;
}

// Everything the Player Stats screen needs for a friend, from one feed build:
// the friend's MyRound history and the current user's, over the same
// tournament set (buildFeed already unions the user's own tournaments with
// their friends' — see fetchFriendTournaments — so no extra server schema is
// needed).
//
// Both collections resolve STRICTLY by user_id. The name / lone-player-of-a-
// solo-game fallbacks in resolveMyPlayer exist for the signed-in user's own
// unlinked guest slots; applied to a friend they match the current user's
// solo games instead, inventing rounds the friend never played.
//
// Returns { me, myRounds, friendRounds, tournaments }. Throws whatever
// buildFeed throws — the screen owns the error state.
export async function loadFriendStatsData(friend) {
  if (!friend?.userId) return { me: null, myRounds: [], friendRounds: [], tournaments: [] };
  // Lazily required to avoid a static import cycle (feedStore imports
  // friendStore).
  const { buildFeed } = require('./feedStore');
  const { collectMyRounds } = require('./personalStats');
  const { me, tournaments: unsorted } = await buildFeed({ useCache: true, includeMedia: false });
  // buildFeed returns my tournaments followed by the friend-fetched ones in
  // arrival order; collectMyRounds assumes newest-first (it reverses to get
  // chronological order, and every chart/ledger downstream relies on that).
  const tournaments = [...unsorted].sort(
    (a, b) => new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0),
  );
  const strict = { strictUserId: true };
  return {
    me,
    myRounds: collectMyRounds(tournaments, me, null, strict),
    friendRounds: collectMyRounds(tournaments, friend.userId, null, strict),
    tournaments,
  };
}
