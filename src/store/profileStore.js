import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { File as FsFile } from 'expo-file-system';
import { supabase } from '../lib/supabase';
import {
  loadAllTournaments,
  roundTotals,
  tournamentStablefordLeaderboard,
  isTournamentFinished,
} from './tournamentStore';
import { isRoundPlayed, isFullLengthRound, isRoundFullyScoredBy } from './scoring';
import { parseHandicapIndex } from '../lib/handicap';
import { findPlayerForIdentity } from './historyModel';
import { t } from '../i18n';

// One row per auth.users.id — created by a trigger on signup, edited from
// ProfileScreen. `username` is a unique lowercase handle; `display_name`
// is the free-text name shown in UIs.
// Last profile this device loaded, so start-up, Profile and History can paint
// at once and refresh behind it. Stored with its owner's id and only served
// back for that id. Callers pass the signed-in user's id (useAuth's session)
// rather than this asking supabase.auth: every auth call queues on the auth
// client's lock, which getUser() holds for its whole network round-trip, so
// even getSession() waited behind start-up's user checks on a slow signal.
const PROFILE_CACHE_KEY = 'golf.profileCache.v1';
let _profileCache = null;

export async function loadCachedProfile(userId) {
  if (!userId) return null;
  try {
    const uid = userId;
    if (_profileCache?.userId === uid) return _profileCache;
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (cached?.userId !== uid) return null;
    _profileCache = cached;
    return cached;
  } catch {
    return null;
  }
}

export async function clearCachedProfile() {
  _profileCache = null;
  try { await AsyncStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* best-effort */ }
}

function rememberProfile(profile) {
  _profileCache = profile;
  AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)).catch(() => {});
}

// Start-up asks for the profile from several places at once (the onboarding
// gate, settings, locale, Home); concurrent callers share one fetch, and each
// gets its own copy.
let _profileInFlight = null;

export function loadProfile() {
  if (!_profileInFlight) {
    _profileInFlight = _fetchProfile().finally(() => { _profileInFlight = null; });
  }
  return _profileInFlight.then((p) => (p ? { ...p } : p));
}

async function _fetchProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user) {
    // getUser() swallows network failures (AuthRetryableFetchError) into a
    // null user instead of throwing. Returning null here for anything other
    // than a real signed-out state made App.js's onboarding gate misread
    // "auth server unreachable" as "account has no username" and drop a
    // logged-in user onto the onboarding screen mid-round. Only signed-out
    // (AuthSessionMissingError — auth-js's own marker, matched by name the
    // same way its isAuthSessionMissingError helper does) may return null;
    // everything else must throw so callers hit their offline paths.
    if (userError && userError.name !== 'AuthSessionMissingError') throw userError;
    return null;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, handicap, target_handicap, avatar_color, avatar_url, gender, settings, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  const profile = {
    userId: user.id,
    email: user.email,
    username: data?.username ?? '',
    displayName: data?.display_name ?? '',
    handicap: data?.handicap ?? null,
    targetHandicap: data?.target_handicap ?? null,
    avatarColor: data?.avatar_color ?? null,
    avatarUrl: data?.avatar_url ?? null,
    gender: data?.gender ?? null,
    settings: data?.settings ?? {},
    updatedAt: data?.updated_at ?? null,
  };
  rememberProfile(profile);
  return profile;
}

// True when nobody else holds `username` (case-insensitive). Goes through
// the username_available RPC because profiles_select RLS hides strangers —
// a direct select would miss their rows and report taken names as free.
export async function isUsernameAvailable(username) {
  const { data, error } = await supabase.rpc('username_available', {
    p_username: String(username ?? '').trim().toLowerCase(),
  });
  if (error) throw error;
  return data === true;
}

// Only sends the columns that were explicitly provided. Supabase `.upsert`
// would otherwise set every missing column to NULL on conflict and clobber
// the rest of the profile. The `avatarUrl` path from ProfileScreen passes
// nothing else, so it used to wipe display_name / handicap / avatar_color.
export async function upsertProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error(t('shared.error.notSignedIn'));

  const row = { user_id: user.id, updated_at: new Date().toISOString() };
  if (fields.displayName !== undefined) {
    row.display_name = fields.displayName?.trim() || null;
  }
  if (fields.handicap !== undefined) {
    if (fields.handicap == null || fields.handicap === '') {
      row.handicap = null;
    } else {
      const r = parseHandicapIndex(fields.handicap);
      row.handicap = r.ok ? r.value : null;
    }
  }
  if (fields.targetHandicap !== undefined) {
    row.target_handicap = fields.targetHandicap === '' || fields.targetHandicap == null
      ? null
      : Number(fields.targetHandicap);
  }
  if (fields.avatarColor !== undefined) {
    row.avatar_color = fields.avatarColor || null;
  }
  if (fields.avatarUrl !== undefined) {
    row.avatar_url = fields.avatarUrl || null;
  }
  if (fields.gender !== undefined) {
    row.gender = fields.gender === 'male' || fields.gender === 'female' ? fields.gender : null;
  }
  // Only write username when provided non-empty — lowercased so the
  // unique(lower(username)) index can't fail silently.
  if (fields.username !== undefined && fields.username !== null && fields.username !== '') {
    row.username = String(fields.username).trim().toLowerCase();
  }
  // Whole-blob write: settingsStore always sends the full merged object, so
  // replacing (not merging) the column is correct.
  if (fields.settings !== undefined) {
    row.settings = fields.settings ?? {};
  }

  // Does this row already exist? If yes, surgical UPDATE (only touches the
  // keys in `row`). If no, INSERT with defaults for everything else.
  const { data: existing, error: existingErr } = await supabase
    .from('profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const { error } = await supabase.from('profiles').update(row).eq('user_id', user.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('profiles').insert(row);
    if (error) throw error;
  }
  // A load that started before this write must not answer the reload after it.
  _profileInFlight = null;
}

// Upload a locally-picked image to the `avatars` bucket under the user's
// own folder (RLS enforces this) and return the public URL. Shrinks to
// 256px first so we're not shipping 4 MB originals around.
export async function uploadAvatar(localUri) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error(t('shared.error.notSignedIn'));

  const resized = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 256, height: 256 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
  );

  // On web a Blob from fetch() uploads cleanly. On native the React Native
  // Blob is a bridge reference whose bytes supabase-js can't serialize for the
  // multipart upload — the request fails with "Network request failed".
  // Reading the file into an ArrayBuffer via expo-file-system sends the raw
  // bytes directly. Same fix as src/lib/mediaUpload.js `uriToBody`.
  const body = Platform.OS === 'web'
    ? await (await fetch(resized.uri)).blob()
    : await new FsFile(resized.uri).arrayBuffer();

  const path = `${user.id}/avatar-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  return pub.publicUrl;
}

// isRoundPlayed is imported from ./scoring (shared with tournamentStore).

// Aggregates: per-user stats computed client-side from tournaments the
// user can see (own + invited). Keeping this client-side avoids a new
// server-side aggregation table while the data volume is tiny.
// `tournaments` is optional: a caller that already holds the list (History)
// passes it instead of paying for a second full fetch.
export async function computePersonalStats({ userId, displayName }, tournaments = null) {
  if (!userId && !displayName?.trim()) {
    return {
      tournamentsPlayed: 0,
      roundsPlayed: 0,
      fullRounds: 0,
      totalPoints: 0,
      avgPointsPerRound: 0,
      bestRound: null,
      wins: 0,
    };
  }
  const list = tournaments ?? await loadAllTournaments();
  let tournamentsPlayed = 0;
  let roundsPlayed = 0;
  // Denominator for Avg pts: the subset of roundsPlayed whose totals are
  // actually comparable with each other (see the forEach below).
  let fullRounds = 0;
  let totalPoints = 0;
  let bestRound = null;
  let wins = 0;

  for (const t of list) {
    const me = findPlayerForIdentity(t.players, { userId, displayName });
    if (!me) continue;
    // Personal record reflects completed play only — consistent with the
    // History archive (which lists `isTournamentFinished` events) and with
    // `wins` below. In-progress tournaments are excluded so the record does
    // not drift ahead of what the user sees archived.
    if (!isTournamentFinished(t)) continue;
    // "Tournaments" counts multi-round tournaments only. Single-round games
    // (`kind === 'game'`) still contribute their rounds, points and wins
    // below — they just aren't tournaments.
    if (t.kind !== 'game') tournamentsPlayed += 1;

    t.rounds.forEach((round, index) => {
      if (!isRoundPlayed(round, index, t)) return;
      const totals = roundTotals(round, t.players);
      const mine = totals.find((e) => e.player.id === me.id);
      if (!mine || mine.totalStrokes === 0) return;
      // A round is a round whatever its length, so the count takes every one.
      roundsPlayed += 1;
      // Avg pts and Best are whole-round TOTALS, though, and those only
      // compare between rounds of the same length — the rule the My Stats
      // career panel already follows. A nine scores about half an eighteen and
      // a round walked off after six holes about a third, so averaging either
      // in dragged this strip below the figure the stats screens report for
      // the same career. Completeness is per-player here: these are raw
      // rounds, which carry no isComplete flag.
      if (!isFullLengthRound(round) || !isRoundFullyScoredBy(round, me.id)) return;
      fullRounds += 1;
      totalPoints += mine.totalPoints;
      if (!bestRound || mine.totalPoints > bestRound.points) {
        // Stableford points are net of the handicap the round was played
        // off, so a career-best total belongs to whichever era the handicap
        // was highest and quietly invites comparison with rounds played off
        // a different one. Carry the era with it: `handicap` is the frozen
        // playing handicap (shots received, always present), `index` the
        // handicap index where the round has its own snapshot — older
        // rounds have none, because players[].handicap used to be
        // overwritten in place on every edit (see
        // propagatePlayerToTournaments, which now freezes it).
        //
        // NB: `index` is this forEach's ROUND index — the index snapshot
        // needs its own name or roundIndex silently picks it up instead.
        const snapshot = round.playerIndexes?.[me.id];
        const playedIndex = snapshot == null || snapshot === '' ? null : parseFloat(snapshot);
        bestRound = {
          tournamentId: t.id,
          tournamentName: t.name,
          roundIndex: index,
          courseName: round.courseName ?? null,
          points: mine.totalPoints,
          strokes: mine.totalStrokes,
          handicap: mine.handicap ?? null,
          index: Number.isFinite(playedIndex) ? playedIndex : null,
        };
      }
    });

    // Tournament is already known finished (guarded above), so topping the
    // leaderboard with a positive score is a win.
    const leaderboard = tournamentStablefordLeaderboard(t);
    if (leaderboard[0]?.player.id === me.id && leaderboard[0]?.points > 0) {
      wins += 1;
    }
  }

  const avgPointsPerRound = fullRounds > 0 ? totalPoints / fullRounds : 0;

  return {
    tournamentsPlayed,
    roundsPlayed,
    fullRounds,
    totalPoints,
    avgPointsPerRound,
    bestRound,
    wins,
  };
}
