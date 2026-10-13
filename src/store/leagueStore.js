import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { File as FsFile } from 'expo-file-system';
import { supabase } from '../lib/supabase';

// Client surface for the league tables and RPCs (see
// supabase/migrations/20261004000000_leagues.sql and
// docs/superpowers/plans/2026-10-04-league.md). Online-first: every write goes
// through an RPC (no direct table writes exist) and is never queued, because
// the server timestamp on announce is the point. Reads are live selects; the
// last league read is cached in AsyncStorage for display while offline only.
// The anon marker-page RPCs live in markerCardStore.js so the public page does
// not import this member store.

const CACHE_PREFIX = '@golf_league_cache:';
const PROOF_BUCKET = 'league-proofs';

/**
 * Thrown by every read and write here. `message` is the server's own text
 * (postgres RAISE message) so the UI can show it as is.
 */
export class LeagueError extends Error {
  constructor(message, { code = null, hint = null, offline = false } = {}) {
    super(message);
    this.name = 'LeagueError';
    this.code = code;
    this.hint = hint;
    this.offline = offline;
  }
}

export const OFFLINE_MESSAGE = 'You need a connection to do this.';
// A deleted league, or one I can no longer see (RLS hides it the same way).
export const LEAGUE_GONE_MESSAGE = 'This league no longer exists.';

function isOfflineNow() {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false;
}

// A postgres/PostgREST error always carries a `code`; only a real network
// failure (fetch TypeError, "Network request failed", offline browser) maps to
// the offline message. Anything else keeps its own message.
export function isNetworkFailure(error) {
  if (!error || error.code) return false;
  if (error instanceof TypeError) return true;
  return /network request failed|failed to fetch|networkerror|load failed|network error/i.test(String(error.message ?? ''));
}

export function toLeagueError(error) {
  if (error instanceof LeagueError) return error;
  const code = error?.code ?? null;
  if (!code) {
    if (isOfflineNow() || isNetworkFailure(error)) return new LeagueError(OFFLINE_MESSAGE, { offline: true });
    return new LeagueError(error?.message || 'Request failed', { hint: error?.hint ?? null });
  }
  return new LeagueError(error.message ?? 'Request failed', { code, hint: error.hint ?? null });
}

async function rpc(fn, args) {
  if (isOfflineNow()) throw new LeagueError(OFFLINE_MESSAGE, { offline: true });
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    throw toLeagueError(e);
  }
  if (res.error) throw toLeagueError(res.error);
  return res.data;
}

async function selectRows(query) {
  if (isOfflineNow()) throw new LeagueError(OFFLINE_MESSAGE, { offline: true });
  let res;
  try {
    res = await query;
  } catch (e) {
    throw toLeagueError(e);
  }
  if (res.error) throw toLeagueError(res.error);
  return res.data;
}

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const num = (v) => (v == null ? null : Number(v));

// ---- mappers (snake_case -> camelCase) ------------------------------------

export function rowToLeague(r) {
  return {
    id: r.id,
    name: r.name,
    seasonStart: r.season_start,
    seasonEnd: r.season_end,
    createdBy: r.created_by,
    pointsTable: r.points_table ?? [],
    handicapCap: r.handicap_cap == null ? 30 : Number(r.handicap_cap),
    entryFeeCents: r.entry_fee_cents ?? 0,
    inviteCode: r.invite_code,
    archivedAt: r.archived_at ?? null,
    // Season points every counting card earns at least (R2). A server without
    // the column (before 20261015000000) has no such rule: 0.
    participationPoints: r.participation_points == null ? 0 : Number(r.participation_points),
  };
}

// Row from get_league_invitees: an unclaimed reserved spot (admin and members).
export function rowToInvitee(r) {
  return { id: r.id, name: r.name, handicap: num(r.handicap), createdAt: r.created_at ?? null };
}

// Row from the get_league_members RPC (names come from profiles, server side).
export function rowToMember(r, leagueId = null) {
  return {
    leagueId,
    userId: r.user_id,
    role: r.role,
    leagueHandicap: num(r.league_handicap),
    feePaid: !!r.fee_paid,
    joinedAt: r.joined_at ?? null,
    leftAt: r.left_at ?? null,
    username: r.username ?? null,
    displayName: r.display_name ?? r.username ?? null,
    avatarUrl: r.avatar_url ?? null,
  };
}

// Shape consumed by leagueStandings.js / leagueRules.js: `userId`, `status`,
// `points` (the ranking value, scored by the server), `netDifferential`
// (secondary), `teeVerified` (the tee came from the course library; false =
// entered by hand, null = not scored yet), `month` ('YYYY-MM-01'), `announcedAt`, `firstShotAt`,
// `postBy` (post deadline, null on cards from before it existed), `approvedBy` /
// `approvedAt` (an admin's approval of a not-announced card). `monthKey`
// ('YYYY-MM') is the key for seasonTable's cardsByMonth.
export function rowToCard(r) {
  const month = r.month ?? null;
  return {
    id: r.id,
    leagueId: r.league_id,
    userId: r.user_id,
    month,
    monthKey: month ? String(month).slice(0, 7) : null,
    source: r.source,
    status: r.status,
    tournamentId: r.tournament_id ?? null,
    roundId: r.round_id ?? null,
    playerId: r.player_id ?? null,
    course: r.course ?? null,
    teeTime: r.tee_time ?? null,
    playedOn: r.played_on ?? null,
    announcedAt: r.announced_at ?? null,
    firstShotAt: r.first_shot_at ?? null,
    notAnnounced: !!r.not_announced,
    postBy: r.post_by ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    leagueHandicap: num(r.league_handicap),
    playingHandicap: r.playing_handicap ?? null,
    holes: r.holes ?? null,
    gross: r.gross ?? null,
    // Ranking value (more is better): Stableford points, computed by the server.
    points: r.points ?? null,
    // Secondary information, also computed by the server. null = the card's
    // tee had no slope/rating (cards from before rated tees were required).
    differential: num(r.differential),
    netDifferential: num(r.net_differential),
    teeVerified: r.tee_verified ?? null,
    confirmation: r.confirmation ?? null,
    confirmedByUser: r.confirmed_by_user ?? null,
    confirmedByName: r.confirmed_by_name ?? null,
    confirmedAt: r.confirmed_at ?? null,
    proofPath: r.proof_path ?? null,
    markerNote: r.marker_note ?? null,
    returnedAt: r.returned_at ?? null,
    // "Pick your marker": who I asked to confirm this card (markerName is null
    // once the request is cancelled or answered).
    markerUserId: r.marker_user_id ?? null,
    markerName: r.marker_name ?? null,
    markerRequestedAt: r.marker_requested_at ?? null,
    markerRemindedAt: r.marker_reminded_at ?? null,
    voidedReason: r.voided_reason ?? null,
  };
}

export function rowToHandicapEvent(r) {
  return {
    id: r.id,
    leagueId: r.league_id,
    userId: r.user_id,
    old: num(r.old),
    new: num(r.new),
    reason: r.reason,
    byUser: r.by_user ?? null,
    at: r.at,
  };
}

export function rowToVote(r, ballots = []) {
  return {
    id: r.id,
    leagueId: r.league_id,
    subjectUser: r.subject_user,
    proposed: Number(r.proposed),
    openedBy: r.opened_by ?? null,
    openedAt: r.opened_at,
    closesAt: r.closes_at,
    status: r.status,
    ballots: ballots.map((b) => ({ voteId: b.vote_id, voter: b.voter, yes: !!b.yes, at: b.at })),
  };
}

function summaryToCamel(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    seasonStart: s.season_start,
    seasonEnd: s.season_end,
    pointsTable: s.points_table ?? [],
    handicapCap: s.handicap_cap == null ? 30 : Number(s.handicap_cap),
    entryFeeCents: s.entry_fee_cents ?? 0,
    archived: !!s.archived,
    adminName: s.admin_name ?? null,
    memberCount: s.member_count ?? 0,
    proposedHandicap: num(s.proposed_handicap),
    isMember: !!s.is_member,
    invitees: inviteesToCamel(s.invitees),
  };
}

// Unclaimed reserved spots as the invite screens see them: id and name only,
// the handicap stays hidden until a spot is picked (getLeagueInvitee).
function inviteesToCamel(list) {
  return (list ?? []).map((i) => ({ id: i.id, name: i.name }));
}

// ---- cache (display only, while offline) ----------------------------------

export async function setLeagueCache(leagueId, snapshot) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + leagueId, JSON.stringify({ at: Date.now(), snapshot }));
  } catch {
    // Cache is best-effort.
  }
}

// Returns { at, snapshot } or null.
export async function getLeagueCached(leagueId) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + leagueId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- reads ----------------------------------------------------------------

// Leagues where I'm an active member, each with my `role` and `leagueHandicap`.
export async function getMyLeagues() {
  const me = await currentUserId();
  if (!me) return [];
  const rows = await selectRows(
    supabase
      .from('league_members')
      .select('role, league_handicap, leagues(*)')
      .eq('user_id', me)
      .not('joined_at', 'is', null)
      .is('left_at', null),
  );
  return (rows ?? [])
    .filter((r) => r.leagues)
    .map((r) => ({
      ...rowToLeague(r.leagues),
      role: r.role,
      leagueHandicap: num(r.league_handicap),
    }));
}

// My live (non-void) cards for one month across every league, for the Setup
// switch. monthKey: 'YYYY-MM'.
export async function getMyCardsForMonth(monthKey) {
  const me = await currentUserId();
  if (!me || !monthKey) return [];
  const rows = await selectRows(
    supabase.from('league_cards').select('*')
      .eq('user_id', me)
      .eq('month', `${monthKey}-01`)
      .neq('status', 'void'),
  );
  return (rows ?? []).map(rowToCard);
}

// One card, live. The marker QR screen polls it to notice the confirmation.
export async function getLeagueCard(cardId) {
  if (!cardId) return null;
  const row = await selectRows(
    supabase.from('league_cards').select('*').eq('id', cardId).maybeSingle(),
  );
  return row ? rowToCard(row) : null;
}

// Everything the League screens need, read live and written to the cache.
// `cardsByMonth` ({ 'YYYY-MM': cards[] }, void excluded) feeds seasonTable.
export async function getLeague(leagueId) {
  const leagueRow = await selectRows(
    supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
  );
  if (!leagueRow) throw new LeagueError(LEAGUE_GONE_MESSAGE, { code: 'league_gone' });
  const league = rowToLeague(leagueRow);

  const [memberRows, inviteeRows, cardRows, voteRows, eventRows, finalRow] = await Promise.all([
    rpc('get_league_members', { p_league: leagueId }),
    // An older server has no invitees yet; the members list still loads.
    rpc('get_league_invitees', { p_league: leagueId }).catch(() => []),
    selectRows(
      supabase.from('league_cards').select('*')
        .eq('league_id', leagueId)
        .gte('month', `${String(league.seasonStart).slice(0, 7)}-01`)
        .lte('month', league.seasonEnd)
        .order('month', { ascending: true }),
    ),
    selectRows(supabase.from('league_handicap_votes').select('*')
      .eq('league_id', leagueId).eq('status', 'open')),
    selectRows(supabase.from('league_handicap_events').select('*')
      .eq('league_id', leagueId).order('at', { ascending: true })),
    selectRows(supabase.from('league_finals').select('*').eq('league_id', leagueId).maybeSingle()),
  ]);

  const voteIds = (voteRows ?? []).map((v) => v.id);
  const ballotRows = voteIds.length
    ? await selectRows(supabase.from('league_handicap_ballots').select('*').in('vote_id', voteIds))
    : [];

  const cards = (cardRows ?? []).map(rowToCard);
  const cardsByMonth = {};
  for (const c of cards) {
    if (c.status === 'void') continue;
    (cardsByMonth[c.monthKey] ??= []).push(c);
  }

  const result = {
    league,
    members: (memberRows ?? []).map((m) => rowToMember(m, leagueId)),
    invitees: (inviteeRows ?? []).map(rowToInvitee),
    cards,
    cardsByMonth,
    votes: (voteRows ?? []).map((v) => rowToVote(v, (ballotRows ?? []).filter((b) => b.vote_id === v.id))),
    handicapEvents: (eventRows ?? []).map(rowToHandicapEvent),
    final: finalRow
      ? { tournamentId: finalRow.tournament_id, strokes: finalRow.strokes ?? {}, createdAt: finalRow.created_at ?? null }
      : null,
  };
  await setLeagueCache(leagueId, result);
  return result;
}

// ---- RPC wrappers: leagues and membership ---------------------------------

// members: [{ userId, handicap }] or, for someone not in the app yet,
// [{ name, handicap }] (a reserved spot they claim from the invite link).
// participationPoints: season points every counting card earns at least;
// omitted = the server default (10). Returns { id, inviteCode }.
export async function createLeague({
  name, seasonStart, seasonEnd, pointsTable = null, cap = null, feeCents = 0, members = [],
  participationPoints = null,
}) {
  // Sent only when set, so the call still matches a server without the argument.
  const extra = participationPoints == null ? {} : { p_participation_points: participationPoints };
  const d = await rpc('create_league', {
    ...extra,
    p_name: name,
    p_season_start: seasonStart,
    p_season_end: seasonEnd,
    p_points_table: pointsTable,
    p_cap: cap,
    p_fee_cents: feeCents,
    p_members: members.map((m) => (m.userId
      ? { user_id: m.userId, handicap: m.handicap ?? null }
      : { name: m.name, handicap: m.handicap ?? null })),
  });
  return { id: d.id, inviteCode: d.invite_code };
}

// Join-screen summary; null for an unknown code.
export async function getLeagueByCode(code) {
  return summaryToCamel(await rpc('get_league_by_code', { p_code: code }));
}

// Does this code belong to a league? "Join with code" asks after the
// tournament lookup found nothing. Any failure reads as "no", so the
// tournament's own error stays the one the person sees.
export async function leagueCodeExists(code) {
  try {
    return !!(await getLeagueByCode(String(code ?? '').toUpperCase().trim()));
  } catch {
    return false;
  }
}

// Signed-out invite screen: league-level facts only (anon-callable). null for
// an unknown code. No id, no member names — see 20261005000000.
export async function getLeagueInvitePreview(code) {
  const p = await rpc('get_league_invite_preview', { p_code: code });
  if (!p) return null;
  return {
    name: p.name,
    adminFirstName: p.admin_first_name || null,
    memberCount: p.member_count ?? 0,
    entryFeeCents: p.entry_fee_cents ?? 0,
    handicapCap: p.handicap_cap == null ? 30 : Number(p.handicap_cap),
    archived: !!p.archived,
    invitees: inviteesToCamel(p.invitees),
  };
}

// One reserved spot with the handicap the admin set (anon-callable). null when
// the spot is gone; `claimed` when someone joined as it meanwhile.
export async function getLeagueInvitee(code, inviteeId) {
  const i = await rpc('get_league_invitee', { p_code: code, p_invitee: inviteeId });
  if (!i) return null;
  return { id: i.id, name: i.name, handicap: num(i.handicap), claimed: !!i.claimed };
}

// Unclaimed spots of a league (members only), by name as the server sends.
export async function listLeagueInvitees(leagueId) {
  return ((await rpc('get_league_invitees', { p_league: leagueId })) ?? []).map(rowToInvitee);
}

// Admin: drop a spot nobody has taken.
export async function removeLeagueInvitee(leagueId, inviteeId) {
  await rpc('remove_league_invitee', { p_league: leagueId, p_invitee: inviteeId });
}

// Returns { leagueId }. `displayName` is required by the server for a guest
// (anonymous) session and saved to the profile; omit it for a real account.
// `inviteeId` claims a reserved spot the admin saved for this person.
export async function joinLeague(code, proposedHandicap = null, displayName = null, inviteeId = null) {
  const args = { p_code: code, p_proposed_handicap: proposedHandicap };
  if (displayName) args.p_display_name = displayName;
  if (inviteeId) args.p_invitee = inviteeId;
  const d = await rpc('join_league', args);
  return { leagueId: d.league_id };
}

// Admin. Returns the value stored (clamped to the league cap).
export async function setLeagueHandicap(leagueId, userId, value) {
  return Number(await rpc('set_league_handicap', { p_league: leagueId, p_user: userId, p_value: value }));
}

// Admin.
export async function setLeagueFeePaid(leagueId, userId, paid) {
  await rpc('set_league_fee_paid', { p_league: leagueId, p_user: userId, p_paid: paid });
}

// Admin. Omitted fields keep their current value.
export async function updateLeagueRules(leagueId, {
  name, seasonStart, seasonEnd, pointsTable, cap, feeCents, participationPoints,
} = {}) {
  // Sent only when set, so the call still matches a server without the argument.
  const extra = participationPoints == null ? {} : { p_participation_points: participationPoints };
  await rpc('update_league_rules', {
    ...extra,
    p_league: leagueId,
    p_name: name ?? null,
    p_season_start: seasonStart ?? null,
    p_season_end: seasonEnd ?? null,
    p_points_table: pointsTable ?? null,
    p_cap: cap ?? null,
    p_fee_cents: feeCents ?? null,
  });
}

export async function leaveLeague(leagueId) {
  await rpc('leave_league', { p_league: leagueId });
}

// Admin. role: 'admin' | 'member'. The last admin cannot be demoted.
export async function setLeagueRole(leagueId, userId, role) {
  await rpc('set_league_role', { p_league: leagueId, p_user: userId, p_role: role });
}

// Admin. An archived league refuses announces, joins and other writes.
export async function archiveLeague(leagueId) {
  await rpc('archive_league', { p_league: leagueId });
}

// Admin. Deletes the league for everyone; every league row cascades from it.
// Proof photos go first, through the Storage API (an admin may delete them,
// see `league-proofs admin delete`): once the league is gone nobody can.
// Removing them is best effort — a leftover photo is private and unreachable.
export async function deleteLeague(leagueId) {
  if (isOfflineNow()) throw new LeagueError(OFFLINE_MESSAGE, { offline: true });
  try {
    const bucket = supabase.storage.from(PROOF_BUCKET);
    const { data } = await bucket.list(leagueId, { limit: 1000 });
    const paths = (data ?? []).map((f) => `${leagueId}/${f.name}`);
    if (paths.length) await bucket.remove(paths);
  } catch {
    // Best effort, see above.
  }
  await rpc('delete_league', { p_league: leagueId });
  try {
    await AsyncStorage.removeItem(CACHE_PREFIX + leagueId);
  } catch {
    // Cache is best-effort.
  }
}

// ---- handicap votes -------------------------------------------------------

// Returns the new vote id.
export async function openHandicapVote(leagueId, subjectUserId, proposed) {
  return rpc('open_handicap_vote', { p_league: leagueId, p_subject: subjectUserId, p_proposed: proposed });
}

// Returns { status: 'open'|'passed'|'failed', yes, no, threshold }.
export async function castHandicapBallot(voteId, yes) {
  const d = await rpc('cast_handicap_ballot', { p_vote: voteId, p_yes: yes });
  return { status: d.status, yes: d.yes, no: d.no, threshold: d.threshold };
}

// ---- cards ----------------------------------------------------------------

// Needs a connection: the server stamps `announced_at`. Throws LeagueError
// with the server message (e.g. "You already have your October card.", hint
// 'card_exists'). source: 'app' (needs tournamentId/roundId/playerId) | 'offapp'.
// scoringMode: the app round's mode; the server refuses a scramble
// ('scramble_round'). Returns { id, month, announcedAt, leagueHandicap }.
export async function announceLeagueCard({
  leagueId, source, course, teeTime = null, tournamentId = null, roundId = null, playerId = null,
  scoringMode = null,
}) {
  // Sent only when set, so the call still matches a server without the argument.
  const extra = scoringMode == null ? {} : { p_scoring_mode: scoringMode };
  const d = await rpc('announce_league_card', {
    ...extra,
    p_league: leagueId,
    p_source: source,
    p_course: course,
    p_tee_time: teeTime,
    p_tournament_id: tournamentId,
    p_round_id: roundId,
    p_player_id: playerId,
  });
  return {
    id: d.id,
    month: d.month,
    announcedAt: d.announced_at,
    leagueHandicap: num(d.league_handicap),
  };
}

export async function notifyLeagueTeeOff(cardId) {
  await rpc('notify_league_tee_off', { p_card: cardId });
}

// Freezes the snapshot of an announced/playing card. `holes` = { '1': 5, ... }.
// The server scores the card itself: gross, points and playingHandicap are
// still sent for older servers but ignored (20261015000000). Server hints
// include 'incomplete_card', 'holes_mismatch' (an app card that differs from
// the game) and 'unrated_tee'. Returns { id, status, notAnnounced, firstShotAt,
// points, playingHandicap, teeVerified } (the last three null from an older server).
export async function submitLeagueCard({
  cardId, holes, gross, points, playingHandicap, playedOn = null,
}) {
  const d = await rpc('submit_league_card', {
    p_card: cardId,
    p_holes: holes,
    p_gross: gross,
    p_points: points,
    p_playing_handicap: playingHandicap,
    p_played_on: playedOn,
  });
  return {
    id: d.id,
    status: d.status,
    notAnnounced: !!d.not_announced,
    firstShotAt: d.first_shot_at ?? null,
    points: d.points ?? null,
    playingHandicap: d.playing_handicap ?? null,
    teeVerified: d.tee_verified ?? null,
  };
}

// Off-app card with no announcement: created already submitted and labelled
// "Not announced in the app". Scored by the server like submitLeagueCard.
// Returns { id, month, status, notAnnounced }.
export async function addUnannouncedLeagueCard({
  leagueId, course, teeTime = null, playedOn = null, holes, gross, points, playingHandicap,
}) {
  const d = await rpc('add_unannounced_league_card', {
    p_league: leagueId,
    p_course: course,
    p_tee_time: teeTime,
    p_played_on: playedOn,
    p_holes: holes,
    p_gross: gross,
    p_points: points,
    p_playing_handicap: playingHandicap,
  });
  return { id: d.id, month: d.month, status: d.status, notAnnounced: !!d.not_announced };
}

// Owner. An off-app card's tee time can move until the original passes, within
// the same month and season; the post deadline moves with it. Server hints:
// 'tee_time_passed', 'month_change', 'outside_season', 'not_offapp', 'not_open'.
// Returns { id, teeTime, postBy }.
export async function rescheduleLeagueCard(cardId, teeTime) {
  const d = await rpc('reschedule_league_card', { p_card: cardId, p_tee_time: teeTime });
  return { id: d.id, teeTime: d.tee_time, postBy: d.post_by ?? null };
}

// Admin, not on their own card (hint 'own_card'). A missed card goes back to
// announced/playing with a fresh 8 hours (hint 'not_missed'). Returns { id, status, postBy }.
export async function reopenLeagueCard(cardId) {
  const d = await rpc('reopen_league_card', { p_card: cardId });
  return { id: d.id, status: d.status, postBy: d.post_by ?? null };
}

// Admin, not on their own card (hint 'own_card'). Lets a not-announced card
// score (hint 'not_needed' when it doesn't need it). Returns { id, approvedAt }.
export async function approveLeagueCard(cardId) {
  const d = await rpc('approve_league_card', { p_card: cardId });
  return { id: d.id, approvedAt: d.approved_at };
}

// Partner check, server side. A failed check is not an error: `confirmed` is
// false with a `reason` ('not_settled' | 'snapshot_mismatch' | 'not_your_player'
// | ...) so Validate can offer the QR fallback.
export async function confirmLeagueCardByPartner(cardId) {
  const d = await rpc('confirm_league_card_by_partner', { p_card: cardId });
  return {
    confirmed: !!d.confirmed,
    reason: d.reason ?? null,
    settled: d.settled ?? 0,
    matches: d.matches ?? null,
    marked: d.marked ?? 0,
    partnerUserId: d.partner_user_id ?? null,
    partnerName: d.partner_name ?? null,
  };
}

// Who can mark this card: { pending, candidates }. `pending` is my open
// request ({ userId, name, requestedAt, remindedAt, expiresAt }) or null;
// `candidates` are other signed-in players of the game who kept a card
// ({ userId, name, inLeague, marked }), `marked` = holes they scored for me.
export async function getLeagueMarkerCandidates(cardId) {
  const d = await rpc('get_league_marker_candidates', { p_card: cardId });
  const p = d?.pending;
  return {
    pending: p ? {
      userId: p.user_id,
      name: p.name ?? null,
      requestedAt: p.requested_at ?? null,
      remindedAt: p.reminded_at ?? null,
      expiresAt: p.expires_at ?? null,
    } : null,
    candidates: (d?.candidates ?? []).map((c) => ({
      userId: c.user_id, name: c.name, inLeague: !!c.in_league, marked: c.marked ?? 0,
    })),
  };
}

// Asks a signed-in member to confirm the submitted card. Notifies them.
export async function requestLeagueMarker(cardId, userId) {
  const d = await rpc('request_league_marker', { p_card: cardId, p_user: userId });
  return { markerUserId: d.marker_user_id, markerName: d.marker_name ?? null, expiresAt: d.expires_at };
}

// Nudges the marker again; the server allows once a day ('You can remind once a day.').
export async function remindLeagueMarker(cardId) {
  const d = await rpc('remind_league_marker', { p_card: cardId });
  return { remindedAt: d.reminded_at };
}

export async function cancelLeagueMarkerRequest(cardId) {
  await rpc('cancel_league_marker_request', { p_card: cardId });
}

// kind: 'photo' | 'official'.
export async function attachLeagueProof(cardId, path, kind, markerName = null) {
  await rpc('attach_league_proof', { p_card: cardId, p_path: path, p_kind: kind, p_marker_name: markerName });
}

// The card must be submitted. Returns { token, expiresAt }.
export async function createMarkerToken(cardId) {
  const d = await rpc('create_marker_token', { p_card: cardId });
  return { token: d.token, expiresAt: d.expires_at };
}

// Admin. Mistakes and duplicates; lets the member announce again.
export async function voidLeagueCard(cardId, reason = null) {
  await rpc('void_league_card', { p_card: cardId, p_reason: reason });
}

// Admin. strokes = extra strokes keyed by user id.
export async function recordLeagueFinal(leagueId, tournamentId, strokes) {
  await rpc('record_league_final', { p_league: leagueId, p_tournament_id: tournamentId, p_strokes: strokes });
}

// ---- proof upload ---------------------------------------------------------

async function uriToBody(uri) {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read photo (${res.status})`);
    return res.blob();
  }
  return new FsFile(uri).arrayBuffer();
}

// Compresses like lib/mediaUpload.js (1920px, JPEG 0.8), uploads to the
// private `league-proofs` bucket at `<league_id>/<card_id>.jpg` (upsert, so a
// retake overwrites) and returns the path for attachLeagueProof.
export async function uploadLeagueProof(leagueId, cardId, localUri) {
  if (isOfflineNow()) throw new LeagueError(OFFLINE_MESSAGE, { offline: true });
  const path = `${leagueId}/${cardId}.jpg`;
  try {
    const compressed = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: 1920 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );
    const body = await uriToBody(compressed.uri);
    const { error } = await supabase.storage
      .from(PROOF_BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', upsert: true });
    if (error) throw toLeagueError(error);
  } catch (e) {
    throw e instanceof LeagueError ? e : toLeagueError(e);
  }
  return path;
}

// A short-lived URL for a card's proof photo (private bucket; any league member
// can read it, see `league-proofs member read`).
export async function getLeagueProofUrl(path) {
  if (isOfflineNow()) throw new LeagueError(OFFLINE_MESSAGE, { offline: true });
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw toLeagueError(error ?? { message: 'Could not load the photo.' });
  return data.signedUrl;
}
