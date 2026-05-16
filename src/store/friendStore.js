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
  };
}

async function fetchProfiles(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, handicap, avatar_url, avatar_color')
    .in('user_id', ids);
  if (error) throw error;
  return (data ?? []).map(rowToPerson);
}

// Username prefix search. Excludes the current user. 2-char minimum keeps
// the result set sane and avoids a full-table scan on every keystroke.
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
  const me = await currentUserId();
  if (signal?.aborted) throw abortError();
  let request = supabase
    .from('profiles')
    .select('user_id, username, display_name, handicap, avatar_url, avatar_color')
    .ilike('username', `${q}%`)
    .not('username', 'is', null)
    .order('username')
    .limit(20);
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
  return (data ?? []).filter((r) => r.user_id !== me).map(rowToPerson);
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
async function loadFriendshipRows() {
  const me = await currentUserId();
  if (!me) return { me: null, rows: [] };
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  if (error) throw error;
  return { me, rows: data ?? [] };
}

// Accepted friends, as Person objects. Caches the result for offline reads.
export async function listFriends() {
  const { me, rows } = await loadFriendshipRows();
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

// Send a friend request. If the target already sent the current user a
// pending request, accept that instead of creating a mirror row.
export async function sendRequest(targetUserId) {
  const me = await currentUserId();
  if (!me) throw new Error('Not signed in');
  if (targetUserId === me) throw new Error('You cannot add yourself');

  const { data: existing, error: exErr } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${targetUserId}),` +
      `and(requester_id.eq.${targetUserId},addressee_id.eq.${me})`,
    );
  if (exErr) throw exErr;

  const row = (existing ?? [])[0];
  if (row) {
    if (row.status === 'accepted') return { status: 'accepted' };
    // They already requested us → accept their row.
    if (row.requester_id === targetUserId) {
      await acceptRequest(row.id);
      return { status: 'accepted' };
    }
    return { status: 'pending' }; // our own request already out
  }

  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: me, addressee_id: targetUserId, status: 'pending' });
  if (error) throw error;
  return { status: 'pending' };
}

export async function acceptRequest(friendshipId) {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId);
  if (error) throw error;
}

// Decline an incoming request or cancel an outgoing one — both delete the row.
export async function declineRequest(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
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

// Profile view-model for a friend: recent rounds, handicap, and a
// head-to-head record vs the current user. Derived from the shared feed
// (buildFeed already unions the current user's + friends' tournaments and
// flattens every round), so this needs no extra server schema.
//
// Returns { handicap, recentRounds: [...], headToHead: { wins, losses, ties } }.
// Never throws — degrades to empty data when offline.
export async function getFriendProfile(friend) {
  const empty = {
    handicap: friend?.handicap ?? null,
    recentRounds: [],
    headToHead: { wins: 0, losses: 0, ties: 0 },
  };
  if (!friend?.userId) return empty;
  try {
    // Lazily required to avoid a static import cycle (feedStore imports
    // friendStore).
    const { buildFeed } = require('./feedStore');
    const { me, items } = await buildFeed();

    const recentRounds = [];
    let wins = 0; let losses = 0; let ties = 0;

    for (const item of items) {
      if (item.type !== 'round' || !Array.isArray(item.results)) continue;
      const theirs = item.results.find((r) => r.userId === friend.userId);
      if (!theirs) continue;

      recentRounds.push({
        key: item.key,
        tournamentId: item.tournamentId,
        roundId: item.roundId,
        tournamentName: item.tournamentName,
        roundIndex: item.roundIndex,
        courseName: item.courseName,
        points: theirs.points,
        strokes: theirs.strokes,
        holes: theirs.holes,
        ts: item.ts,
      });

      // Head-to-head: only rounds where both the friend and the current
      // user have a result count.
      const mine = me ? item.results.find((r) => r.userId === me) : null;
      if (mine) {
        if (mine.points > theirs.points) wins += 1;
        else if (mine.points < theirs.points) losses += 1;
        else ties += 1;
      }
    }

    recentRounds.sort((a, b) => b.ts - a.ts);
    return {
      handicap: friend.handicap ?? null,
      recentRounds: recentRounds.slice(0, 10),
      headToHead: { wins, losses, ties },
    };
  } catch {
    return empty;
  }
}

// Relationship of the current user to a given user id — drives the
// add/pending/friends button state in search results.
export async function friendshipStatus(targetUserId) {
  const { me, rows } = await loadFriendshipRows();
  if (!me) return 'none';
  const row = rows.find(
    (r) =>
      (r.requester_id === me && r.addressee_id === targetUserId) ||
      (r.requester_id === targetUserId && r.addressee_id === me),
  );
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === me ? 'outgoing' : 'incoming';
}
