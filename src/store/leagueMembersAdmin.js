// Members admin (remove, release a claimed spot, new invite code): pure
// helpers over the membership log plus the "seen" flags kept on this device.
// The server decides everything; this only reads the log and words the result.
import AsyncStorage from '@react-native-async-storage/async-storage';

// Claims still standing, oldest first. A spot's last log entry decides: a
// 'spot_claimed' whose account is still an active member is a live claim; a
// later 'spot_released' (or the account leaving) ends it.
export function activeSpotClaims(events, members) {
  const latest = new Map();
  for (const ev of events ?? []) {
    if (!ev.inviteeId) continue;
    if (ev.kind === 'spot_claimed' || ev.kind === 'spot_released') latest.set(ev.inviteeId, ev);
  }
  const activeIds = new Set((members ?? []).filter((m) => !m.leftAt).map((m) => m.userId));
  return [...latest.values()]
    .filter((ev) => ev.kind === 'spot_claimed' && activeIds.has(ev.userId))
    .map((ev) => ({
      eventId: ev.id,
      inviteeId: ev.inviteeId,
      userId: ev.userId,
      spotName: ev.data?.spot_name ?? '',
      accountName: ev.data?.name ?? '',
      handicap: ev.data?.handicap == null ? null : Number(ev.data.handicap),
      at: ev.at,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Claims the admin has not dismissed with "Looks right" on this device.
export function pendingSpotClaims(claims, seenIds) {
  const seen = new Set((seenIds ?? []).map(String));
  return (claims ?? []).filter((c) => !seen.has(String(c.eventId)));
}

// The live claim of a member's account, for the "claimed a spot" row line.
export function claimForUser(claims, userId) {
  return (claims ?? []).find((c) => c.userId === userId) ?? null;
}

// Past cards that stay in the standings when a member is removed.
export function pastCardCount(cards, userId) {
  return (cards ?? []).filter((c) => c.userId === userId && c.status !== 'void').length;
}

// Server hint -> catalogue key, null when the hint has no screen copy.
const ERROR_KEYS = {
  last_admin: 'league.members.errLastAdmin',
  use_leave: 'league.members.errUseLeave',
  not_member: 'league.members.errNotMember',
  not_claimed: 'league.members.errNotClaimed',
};
export function memberAdminErrorKey(error) {
  return ERROR_KEYS[error?.hint] ?? null;
}

const SEEN_PREFIX = '@league_claims_seen:';

export async function loadSeenClaims(leagueId) {
  try {
    const raw = await AsyncStorage.getItem(SEEN_PREFIX + leagueId);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

// Adds event ids to the seen list; returns the new list (also when storage fails).
export async function markClaimsSeen(leagueId, eventIds) {
  const next = [...new Set([...(await loadSeenClaims(leagueId)), ...eventIds.map(String)])];
  try {
    await AsyncStorage.setItem(SEEN_PREFIX + leagueId, JSON.stringify(next));
  } catch {
    // Not remembering costs the admin one extra tap, nothing else.
  }
  return next;
}

// The membership log newest first, as catalogue descriptors for the History
// list: { id, key, params, at }. Unknown kinds are skipped.
export function membershipHistory(events, nameOf, limit = 8) {
  const line = (ev) => {
    const who = ev.data?.name || nameOf(ev.userId);
    const actor = nameOf(ev.actorUserId);
    switch (ev.kind) {
      case 'promoted': return { key: 'league.members.histPromoted', params: { name: who } };
      case 'demoted': return { key: 'league.members.histDemoted', params: { name: who } };
      case 'removed': return { key: 'league.members.histRemoved', params: { name: who, actor } };
      case 'spot_claimed': return { key: 'league.members.histClaimed', params: { spot: ev.data?.spot_name ?? '', name: who } };
      case 'spot_released': return { key: 'league.members.histReleased', params: { spot: ev.data?.spot_name ?? '', actor } };
      case 'invite_code_rotated': return { key: 'league.members.histCode', params: { actor } };
      default: return null;
    }
  };
  return [...(events ?? [])].reverse()
    .map((ev) => { const l = line(ev); return l && { ...l, id: ev.id, at: ev.at }; })
    .filter(Boolean)
    .slice(0, limit);
}
