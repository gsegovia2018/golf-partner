import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import {
  loadAllTournaments,
  roundTotals,
  tournamentLeaderboard,
} from './tournamentStore';
import { isRoundPlayed } from './scoring';

// One row per auth.users.id — created by a trigger on signup, edited from
// ProfileScreen. `username` is a unique lowercase handle; `display_name`
// is the free-text name shown in UIs.
export async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, handicap, avatar_color, avatar_url, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return {
    userId: user.id,
    email: user.email,
    username: data?.username ?? '',
    displayName: data?.display_name ?? '',
    handicap: data?.handicap ?? null,
    avatarColor: data?.avatar_color ?? null,
    avatarUrl: data?.avatar_url ?? null,
    updatedAt: data?.updated_at ?? null,
  };
}

// Only sends the columns that were explicitly provided. Supabase `.upsert`
// would otherwise set every missing column to NULL on conflict and clobber
// the rest of the profile. The `avatarUrl` path from ProfileScreen passes
// nothing else, so it used to wipe display_name / handicap / avatar_color.
export async function upsertProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const row = { user_id: user.id, updated_at: new Date().toISOString() };
  if (fields.displayName !== undefined) {
    row.display_name = fields.displayName?.trim() || null;
  }
  if (fields.handicap !== undefined) {
    row.handicap = fields.handicap === '' || fields.handicap == null
      ? null
      : parseInt(fields.handicap, 10);
  }
  if (fields.avatarColor !== undefined) {
    row.avatar_color = fields.avatarColor || null;
  }
  if (fields.avatarUrl !== undefined) {
    row.avatar_url = fields.avatarUrl || null;
  }
  // Only write username when provided non-empty — lowercased so the
  // unique(lower(username)) index can't fail silently.
  if (fields.username !== undefined && fields.username !== null && fields.username !== '') {
    row.username = String(fields.username).trim().toLowerCase();
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
}

// Upload a locally-picked image to the `avatars` bucket under the user's
// own folder (RLS enforces this) and return the public URL. Shrinks to
// 256px first so we're not shipping 4 MB originals around.
export async function uploadAvatar(localUri) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const resized = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 256, height: 256 } }],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
  );

  // fetch(uri) resolves file:// / content:// / data: URIs on both native
  // and web, giving us a Blob we can hand directly to supabase-js.
  const resp = await fetch(resized.uri);
  const blob = await resp.blob();

  const path = `${user.id}/avatar-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  return pub.publicUrl;
}

// Resolve "me" inside a tournament: prefer the embedded player with
// user_id === current user. Fall back to name match for legacy data
// written before user_id was stamped onto embedded players.
function findMyPlayer(tournament, userId, displayName) {
  if (userId) {
    const byId = tournament.players.find((p) => p.user_id === userId);
    if (byId) return byId;
  }
  if (displayName) {
    const target = displayName.trim().toLowerCase();
    return tournament.players.find((p) => p.name.trim().toLowerCase() === target) ?? null;
  }
  return null;
}

// isRoundPlayed is imported from ./scoring (shared with tournamentStore).

// Aggregates: per-user stats computed client-side from tournaments the
// user can see (own + invited). Keeping this client-side avoids a new
// server-side aggregation table while the data volume is tiny.
export async function computePersonalStats({ userId, displayName }) {
  if (!userId && !displayName?.trim()) {
    return {
      tournamentsPlayed: 0,
      roundsPlayed: 0,
      totalPoints: 0,
      avgPointsPerRound: 0,
      bestRound: null,
      wins: 0,
    };
  }
  const tournaments = await loadAllTournaments();
  let tournamentsPlayed = 0;
  let roundsPlayed = 0;
  let totalPoints = 0;
  let bestRound = null;
  let wins = 0;

  for (const t of tournaments) {
    const me = findMyPlayer(t, userId, displayName);
    if (!me) continue;
    tournamentsPlayed += 1;

    t.rounds.forEach((round, index) => {
      if (!isRoundPlayed(round, index, t)) return;
      const totals = roundTotals(round, t.players);
      const mine = totals.find((e) => e.player.id === me.id);
      if (!mine || mine.totalStrokes === 0) return;
      roundsPlayed += 1;
      totalPoints += mine.totalPoints;
      if (!bestRound || mine.totalPoints > bestRound.points) {
        bestRound = {
          tournamentId: t.id,
          tournamentName: t.name,
          roundIndex: index,
          courseName: round.courseName ?? null,
          points: mine.totalPoints,
          strokes: mine.totalStrokes,
        };
      }
    });

    const leaderboard = tournamentLeaderboard(t);
    if (leaderboard[0]?.player.id === me.id && leaderboard[0]?.points > 0) {
      const finished = t.rounds.every((r, i) => !isRoundPlayed(r, i, t) ? false : true);
      if (finished) wins += 1;
    }
  }

  const avgPointsPerRound = roundsPlayed > 0 ? totalPoints / roundsPlayed : 0;

  return {
    tournamentsPlayed,
    roundsPlayed,
    totalPoints,
    avgPointsPerRound,
    bestRound,
    wins,
  };
}
