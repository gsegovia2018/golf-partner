import { supabase } from '../lib/supabase';
import {
  loadAllTournaments,
  roundTotals,
  tournamentLeaderboard,
} from './tournamentStore';

// One row per auth.users.id — created by a trigger on signup, edited from
// ProfileScreen. `display_name` is also what we match against the
// per-tournament player entries to compute personal stats.
export async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, handicap, avatar_color, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return {
    userId: user.id,
    email: user.email,
    displayName: data?.display_name ?? '',
    handicap: data?.handicap ?? null,
    avatarColor: data?.avatar_color ?? null,
    updatedAt: data?.updated_at ?? null,
  };
}

export async function upsertProfile({ displayName, handicap, avatarColor }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const row = {
    user_id: user.id,
    display_name: displayName?.trim() || null,
    handicap: handicap === '' || handicap == null ? null : parseInt(handicap, 10),
    avatar_color: avatarColor || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('profiles').upsert(row);
  if (error) throw error;
}

// Match on player name (case-insensitive, trimmed). 4-friends app, names
// are distinct; if that ever stops being true we can layer an explicit
// claim table on top. Returns null entries when the name isn't found in
// the tournament's player list.
function findPlayerByName(tournament, displayName) {
  if (!displayName) return null;
  const target = displayName.trim().toLowerCase();
  return tournament.players.find((p) => p.name.trim().toLowerCase() === target) ?? null;
}

function isRoundPlayed(round, index, tournament) {
  if (index > (tournament.currentRound ?? 0)) return false;
  return !!round.scores;
}

// Aggregates: per-user stats computed client-side from tournaments the
// user can see (own + invited). Keeping this client-side avoids a new
// server-side aggregation table while the data volume is tiny.
export async function computePersonalStats(displayName) {
  if (!displayName?.trim()) {
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
    const me = findPlayerByName(t, displayName);
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
