import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const ACTIVE_ID_KEY = '@golf_active_id';
const LEGACY_TOURNAMENTS_KEY = '@golf_tournaments';
const LEGACY_KEY = '@golf_tournament';

// Runs once: pushes any locally-stored tournaments up to Supabase then clears local keys.
async function migrate() {
  const [legacy, legacyAll] = await Promise.all([
    AsyncStorage.getItem(LEGACY_KEY),
    AsyncStorage.getItem(LEGACY_TOURNAMENTS_KEY),
  ]);

  const toUpsert = [];

  if (legacyAll) {
    const ts = JSON.parse(legacyAll);
    ts.forEach((t) => toUpsert.push({ id: t.id, name: t.name, created_at: t.createdAt, data: t }));
    await AsyncStorage.removeItem(LEGACY_TOURNAMENTS_KEY);
  }

  if (legacy) {
    const t = JSON.parse(legacy);
    if (!toUpsert.find((r) => r.id === t.id)) {
      toUpsert.push({ id: t.id, name: t.name, created_at: t.createdAt, data: t });
    }
    await AsyncStorage.removeItem(LEGACY_KEY);
  }

  if (toUpsert.length > 0) {
    await supabase.from('tournaments').upsert(toUpsert);
  }
}

let _migrated = false;
async function ensureMigrated() {
  if (_migrated) return;
  await migrate();
  _migrated = true;
}

async function getCurrentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const _subs = new Set();
function _emitChange() {
  _subs.forEach((fn) => { try { fn(); } catch (_) {} });
}
export function subscribeTournamentChanges(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export async function loadAllTournaments() {
  await ensureMigrated();
  const userId = await getCurrentUserId();

  if (!userId) {
    const { data, error } = await supabase
      .from('tournaments').select('data')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map((row) => ({ ...row.data, _role: 'owner' }));
  }

  const [{ data: owned, error: ownedErr }, { data: memberships, error: memberErr }] = await Promise.all([
    supabase.from('tournaments').select('data')
      .or(`created_by.eq.${userId},created_by.is.null`)
      .order('created_at', { ascending: false }),
    supabase.from('tournament_members')
      .select('role, tournaments(data)')
      .eq('user_id', userId),
  ]);
  if (ownedErr) throw ownedErr;
  if (memberErr) throw memberErr;

  const ownedIds = new Set();
  const result = (owned ?? []).map((row) => {
    ownedIds.add(row.data.id);
    return { ...row.data, _role: 'owner' };
  });
  (memberships ?? []).forEach((m) => {
    if (!m.tournaments?.data || ownedIds.has(m.tournaments.data.id)) return;
    result.push({ ...m.tournaments.data, _role: m.role });
  });
  return result.sort((a, b) => b.id - a.id);
}

export async function loadTournament() {
  const [all, activeId] = await Promise.all([
    loadAllTournaments(),
    AsyncStorage.getItem(ACTIVE_ID_KEY),
  ]);
  if (!activeId) return null;
  return all.find((t) => t.id === activeId) ?? null;
}

async function persistTournament(tournament) {
  const userId = await getCurrentUserId();
  const { _role, ...cleanData } = tournament;
  const row = { id: cleanData.id, name: cleanData.name, created_at: cleanData.createdAt, data: cleanData };
  if (userId) row.created_by = userId;
  const { error } = await supabase.from('tournaments').upsert(row);
  if (error) throw error;
}

export async function saveTournament(tournament) {
  await persistTournament(tournament);
  await AsyncStorage.setItem(ACTIVE_ID_KEY, tournament.id);
  _emitChange();
}

export async function setActiveTournament(id) {
  await AsyncStorage.setItem(ACTIVE_ID_KEY, id);
  _emitChange();
}

export async function clearActiveTournament() {
  await AsyncStorage.removeItem(ACTIVE_ID_KEY);
  _emitChange();
}

export async function deleteTournament(id) {
  const activeId = await AsyncStorage.getItem(ACTIVE_ID_KEY);
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) throw error;
  if (activeId === id) await AsyncStorage.removeItem(ACTIVE_ID_KEY);
  _emitChange();
}

export const STANDARD_SLOPE = 113;

// Course playing handicap = index × slope / 113 (rounded). No slope → raw index.
export function calcPlayingHandicap(index, slope) {
  const idx = parseInt(index, 10) || 0;
  const sv = parseInt(slope, 10) || 0;
  if (sv <= 0) return idx;
  return Math.round(idx * (sv / STANDARD_SLOPE));
}

// Ensure every current player has an entry in round.playerHandicaps. Missing
// entries are backfilled from the player's base index applied to round.slope.
// For legacy rounds lacking manualHandicaps, infer manual overrides by
// comparing stored value to the slope-derived value.
export function normalizeRoundHandicaps(round, players) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manualHandicaps = { ...(round.manualHandicaps ?? {}) };
  const hasLegacyFlags = round.manualHandicaps != null;
  players.forEach((p) => {
    const auto = calcPlayingHandicap(p.handicap, round.slope);
    const current = playerHandicaps[p.id];
    if (current == null) {
      playerHandicaps[p.id] = auto;
    } else if (!hasLegacyFlags && round.slope && Number(current) !== auto) {
      manualHandicaps[p.id] = true;
    }
  });
  return { ...round, playerHandicaps, manualHandicaps };
}

// Read the playing handicap for a player in a round. Falls back to deriving
// from the player's base index × round slope when the round has no stored
// entry (e.g. legacy data).
export function getPlayingHandicap(round, player) {
  const stored = round.playerHandicaps?.[player.id];
  if (stored != null) return Number(stored);
  return calcPlayingHandicap(player.handicap, round.slope);
}

// Recompute playerHandicaps for non-manual entries when base index or slope
// changes. Preserves manual overrides.
export function recomputeRoundPlayingHandicaps(round, players) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manual = round.manualHandicaps ?? {};
  players.forEach((p) => {
    if (manual[p.id]) return;
    playerHandicaps[p.id] = calcPlayingHandicap(p.handicap, round.slope);
  });
  return { ...round, playerHandicaps };
}

// Push a player library edit (name/handicap) into every tournament that
// references this player id. Updates tournament.players and the player
// snapshot embedded in each round.pairs. Non-manual round playing handicaps
// are re-derived from the new base index.
export async function propagatePlayerToTournaments(playerId, { name, handicap }) {
  if (!playerId) return [];
  const parsedIndex = parseInt(handicap, 10) || 0;
  const tournaments = await loadAllTournaments();
  const updatedIds = [];
  for (const t of tournaments) {
    const hasPlayer = t.players?.some((p) => p.id === playerId);
    if (!hasPlayer) continue;

    const nextPlayers = t.players.map((p) =>
      p.id === playerId ? { ...p, name, handicap: parsedIndex } : p,
    );
    const nextRounds = t.rounds.map((round) => {
      const nextPairs = round.pairs?.map((pair) =>
        pair.map((pp) =>
          pp.id === playerId ? { ...pp, name, handicap: parsedIndex } : pp,
        ),
      );
      const patched = { ...round, pairs: nextPairs ?? round.pairs };
      return recomputeRoundPlayingHandicaps(patched, nextPlayers);
    });

    await persistTournament({ ...t, players: nextPlayers, rounds: nextRounds });
    updatedIds.push(t.id);
  }
  if (updatedIds.length > 0) _emitChange();
  return updatedIds;
}

// Push a course library edit (slope/holes) into every tournament round that
// references this courseId. Holes are deep-copied per round. Non-manual
// playing handicaps are re-derived from the new slope.
export async function propagateCourseToTournaments(courseId, { slope, holes }) {
  if (!courseId) return [];
  const tournaments = await loadAllTournaments();
  const updatedIds = [];
  for (const t of tournaments) {
    let changed = false;
    const nextRounds = t.rounds.map((round) => {
      if (round.courseId !== courseId) return round;
      changed = true;
      const nextRound = {
        ...round,
        holes: holes.map((h) => ({ ...h })),
        slope: slope ?? null,
      };
      return recomputeRoundPlayingHandicaps(nextRound, t.players);
    });
    if (changed) {
      const next = { ...t, rounds: nextRounds };
      await persistTournament(next);
      updatedIds.push(next.id);
    }
  }
  if (updatedIds.length > 0) _emitChange();
  return updatedIds;
}

export function calcExtraShots(playerHandicap, holeStrokeIndex) {
  const base = Math.floor(playerHandicap / 18);
  const remainder = playerHandicap % 18;
  return base + (holeStrokeIndex <= remainder ? 1 : 0);
}

export function calcStablefordPoints(par, strokes, playerHandicap, holeStrokeIndex) {
  if (!strokes || strokes <= 0) return 0;
  const extra = calcExtraShots(playerHandicap, holeStrokeIndex);
  const points = 2 + par - strokes + extra;
  return Math.max(0, points);
}

// Lowest stroke count that still yields 0 Stableford points on this hole for this
// player. Use as the recorded score when a player picks up the ball.
export function pickupStrokes(par, playerHandicap, holeStrokeIndex) {
  const extra = calcExtraShots(playerHandicap, holeStrokeIndex);
  return par + 2 + extra;
}

export function randomPairs(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const pairs = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const pair = [shuffled[i], shuffled[i + 1]].filter(Boolean);
    if (pair.length > 0) pairs.push(pair);
  }
  return pairs;
}

export const DEFAULT_SETTINGS = {
  scoringMode: 'stableford', // 'stableford' | 'bestball'
  bestBallValue: 1,          // points awarded per hole won in best ball match
  worstBallValue: 1,         // points awarded per hole won in worst ball match
};

export function createTournament({ name, players, rounds, settings }) {
  return {
    id: Date.now().toString(),
    name,
    createdAt: new Date().toISOString(),
    players,
    rounds,
    currentRound: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

// scores shape: { [playerId]: { [holeNumber]: strokes } }
export function roundTotals(round, players) {
  return players.map((player) => {
    const handicap = getPlayingHandicap(round, player);
    let totalPoints = 0;
    let totalStrokes = 0;
    round.holes.forEach((hole) => {
      const strokes = round.scores?.[player.id]?.[hole.number];
      if (strokes) {
        totalStrokes += strokes;
        totalPoints += calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex);
      }
    });
    return { player, handicap, totalPoints, totalStrokes };
  });
}

// Returns pair results for a single round sorted by combined points (Stableford mode)
export function roundPairLeaderboard(round, players) {
  if (!round.pairs?.length) return [];
  const playerTotals = roundTotals(round, players);
  const totalsById = Object.fromEntries(playerTotals.map((t) => [t.player.id, t]));

  return round.pairs
    .map((pair) => {
      const members = pair.map((p) => totalsById[p.id]).filter(Boolean);
      const combinedPoints = members.reduce((s, m) => s + m.totalPoints, 0);
      const combinedStrokes = members.reduce((s, m) => s + m.totalStrokes, 0);
      return { members, combinedPoints, combinedStrokes };
    })
    .sort((a, b) => b.combinedPoints - a.combinedPoints);
}

// Best ball / worst ball per-hole and totals for a round.
// Returns:
//   pair1, pair2: the pair arrays from round.pairs
//   holes: [{ number, pair1Best, pair1Worst, pair2Best, pair2Worst, bestWinner, worstWinner }]
//     bestWinner / worstWinner: 1 | 2 | 0 (0 = halved, null = incomplete)
//   bestBall: { pair1: holes won, pair2: holes won, halved }
//   worstBall: same
export function calcBestWorstBall(round, players) {
  if (!round.pairs || round.pairs.length < 2) return null;
  const [pair1, pair2] = round.pairs;
  if (!pair1 || !pair2 || pair1.length < 2 || pair2.length < 2) return null;
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));

  const pts = (playerId, hole) => {
    const player = playersById[playerId];
    if (!player) return null;
    const handicap = getPlayingHandicap(round, player);
    const strokes = round.scores?.[playerId]?.[hole.number];
    if (!strokes) return null;
    return calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex);
  };

  const bestBall = { pair1: 0, pair2: 0, halved: 0 };
  const worstBall = { pair1: 0, pair2: 0, halved: 0 };

  const holes = round.holes.map((hole) => {
    const p1a = pts(pair1[0].id, hole);
    const p1b = pts(pair1[1].id, hole);
    const p2a = pts(pair2[0].id, hole);
    const p2b = pts(pair2[1].id, hole);

    if (p1a === null || p1b === null || p2a === null || p2b === null) {
      return { number: hole.number, pair1Best: null, pair1Worst: null, pair2Best: null, pair2Worst: null, bestWinner: null, worstWinner: null };
    }

    const best1 = Math.max(p1a, p1b);
    const best2 = Math.max(p2a, p2b);
    const worst1 = Math.min(p1a, p1b);
    const worst2 = Math.min(p2a, p2b);

    let bestWinner = 0;
    if (best1 > best2) { bestWinner = 1; bestBall.pair1++; }
    else if (best2 > best1) { bestWinner = 2; bestBall.pair2++; }
    else bestBall.halved++;

    let worstWinner = 0;
    if (worst1 > worst2) { worstWinner = 1; worstBall.pair1++; }
    else if (worst2 > worst1) { worstWinner = 2; worstBall.pair2++; }
    else worstBall.halved++;

    return { number: hole.number, pair1Best: best1, pair1Worst: worst1, pair2Best: best2, pair2Worst: worst2, bestWinner, worstWinner };
  });

  return { pair1, pair2, holes, bestBall, worstBall };
}

// Rounds count towards tournament totals only once the user has advanced to
// them — otherwise auto-par scores from incidental navigation would inflate
// the tournament total.
function isRoundPlayed(round, index, tournament) {
  if (index > (tournament.currentRound ?? 0)) return false;
  return !!round.scores;
}

// Per-pair, per-hole assign each member a role: exactly one is the "best
// ball" (higher Stableford on that hole) and the other is the "worst ball".
// Then compares each pair's best / worst against the other pair's to decide
// whether that hole was won, tied, or lost inter-pair — and credits the
// player who was carrying the role for their pair.
//
// Within-pair tiebreaker when Stableford points tie:
//   1. Lower playing handicap is best.
//   2. Same handicap → whoever was best on the previous hole (walk back).
//   3. Everything tied → default to the first-listed pair member.
//
// Returns per player:
//   { best, worst,                               // role assignments
//     bestWon, bestTied, bestLost,               // inter-pair BB outcomes
//     worstWon, worstTied, worstLost }           // inter-pair WB outcomes
// Only holes where all four players have scored contribute to the inter-pair
// outcome counts; holes missing any score still contribute to within-pair
// role counts when the pair itself has both members' scores.
export function assignBestWorstRoles(round, players) {
  const emptyBucket = () => ({
    best: 0, worst: 0,
    bestWon: 0, bestTied: 0, bestLost: 0,
    worstWon: 0, worstTied: 0, worstLost: 0,
  });
  const roles = Object.fromEntries(players.map((p) => [p.id, emptyBucket()]));
  if (!round?.pairs?.length) return roles;

  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));

  // Precompute Stableford points per (player, hole). null = unscored.
  const points = {};
  players.forEach((p) => { points[p.id] = {}; });
  round.holes.forEach((hole) => {
    players.forEach((p) => {
      const strokes = round.scores?.[p.id]?.[hole.number];
      if (strokes == null) {
        points[p.id][hole.number] = null;
      } else {
        const hcp = getPlayingHandicap(round, p);
        points[p.id][hole.number] = calcStablefordPoints(hole.par, strokes, hcp, hole.strokeIndex);
      }
    });
  });

  const pickPairRoles = (pair, hole, holeIdx) => {
    if (pair.length < 2) return null;
    const m1 = playersById[pair[0].id];
    const m2 = playersById[pair[1].id];
    if (!m1 || !m2) return null;
    const p1 = points[m1.id][hole.number];
    const p2 = points[m2.id][hole.number];
    if (p1 == null || p2 == null) return null;
    const hcp1 = getPlayingHandicap(round, m1);
    const hcp2 = getPlayingHandicap(round, m2);

    let bestId, worstId;
    if (p1 > p2) { bestId = m1.id; worstId = m2.id; }
    else if (p2 > p1) { bestId = m2.id; worstId = m1.id; }
    else if (hcp1 < hcp2) { bestId = m1.id; worstId = m2.id; }
    else if (hcp2 < hcp1) { bestId = m2.id; worstId = m1.id; }
    else {
      let decided = false;
      for (let k = holeIdx - 1; k >= 0; k--) {
        const prev = round.holes[k];
        const q1 = points[m1.id][prev.number];
        const q2 = points[m2.id][prev.number];
        if (q1 == null || q2 == null) continue;
        if (q1 > q2) { bestId = m1.id; worstId = m2.id; decided = true; break; }
        if (q2 > q1) { bestId = m2.id; worstId = m1.id; decided = true; break; }
      }
      if (!decided) { bestId = m1.id; worstId = m2.id; }
    }
    return {
      bestId, worstId,
      bestVal: Math.max(p1, p2),
      worstVal: Math.min(p1, p2),
    };
  };

  round.holes.forEach((hole, holeIdx) => {
    const pairResults = round.pairs.map((pair) => pickPairRoles(pair, hole, holeIdx));

    pairResults.forEach((r) => {
      if (!r) return;
      roles[r.bestId].best += 1;
      roles[r.worstId].worst += 1;
    });

    if (pairResults.length >= 2 && pairResults[0] && pairResults[1]) {
      const [a, b] = pairResults;
      if (a.bestVal > b.bestVal) { roles[a.bestId].bestWon += 1; roles[b.bestId].bestLost += 1; }
      else if (b.bestVal > a.bestVal) { roles[b.bestId].bestWon += 1; roles[a.bestId].bestLost += 1; }
      else { roles[a.bestId].bestTied += 1; roles[b.bestId].bestTied += 1; }

      if (a.worstVal > b.worstVal) { roles[a.worstId].worstWon += 1; roles[b.worstId].worstLost += 1; }
      else if (b.worstVal > a.worstVal) { roles[b.worstId].worstWon += 1; roles[a.worstId].worstLost += 1; }
      else { roles[a.worstId].worstTied += 1; roles[b.worstId].worstTied += 1; }
    }
  });

  return roles;
}

// Points earned by a single player in a round from their best/worst-ball
// role — only holes their pair won outright count (ties and losses score
// nothing), scaled by the tournament's bestBallValue / worstBallValue.
export function playerRoundBestWorstPoints(round, playerId, players, settings) {
  const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };
  const roles = assignBestWorstRoles(round, players);
  const r = roles[playerId];
  if (!r) return 0;
  return r.bestWon * bestBallValue + r.worstWon * worstBallValue;
}

// Individual leaderboard for best-ball mode: each player is tallied by the
// holes they *won* carrying the best / worst ball for their pair (ties and
// losses do not count), scaled by bestBallValue / worstBallValue. Also
// exposes bestTies/bestLosses and worstTies/worstLosses for display.
export function tournamentBestWorstLeaderboard(tournament) {
  const { players, rounds, settings } = tournament;
  const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };
  const totals = Object.fromEntries(players.map((p) => [p.id, {
    player: p, points: 0,
    bestWins: 0, bestTies: 0, bestLosses: 0,
    worstWins: 0, worstTies: 0, worstLosses: 0,
  }]));

  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament) || !round.pairs?.length) return;
    const roles = assignBestWorstRoles(round, players);
    players.forEach((p) => {
      const r = roles[p.id];
      if (!r) return;
      totals[p.id].points += r.bestWon * bestBallValue + r.worstWon * worstBallValue;
      totals[p.id].bestWins += r.bestWon;
      totals[p.id].bestTies += r.bestTied;
      totals[p.id].bestLosses += r.bestLost;
      totals[p.id].worstWins += r.worstWon;
      totals[p.id].worstTies += r.worstTied;
      totals[p.id].worstLosses += r.worstLost;
    });
  });

  return Object.values(totals).sort((a, b) => b.points - a.points);
}

export function tournamentLeaderboard(tournament) {
  const { players, rounds } = tournament;
  const totals = players.map((p) => ({ player: p, points: 0, strokes: 0 }));

  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    roundTotals(round, players).forEach(({ player, totalPoints, totalStrokes }) => {
      const entry = totals.find((t) => t.player.id === player.id);
      entry.points += totalPoints;
      entry.strokes += totalStrokes;
    });
  });

  return totals.sort((a, b) => b.points - a.points);
}

export async function generateInviteCode(tournamentId) {
  const { data: existing } = await supabase
    .from('tournament_invites').select('code')
    .eq('tournament_id', tournamentId).maybeSingle();
  if (existing?.code) return existing.code;

  const userId = await getCurrentUserId();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const { data, error } = await supabase
    .from('tournament_invites')
    .insert({ tournament_id: tournamentId, code, created_by: userId })
    .select('code').single();
  if (error) throw error;
  return data.code;
}

// Members list for a tournament: owner + everyone who joined via an invite
// code. Profile fields are joined client-side since PostgREST can't traverse
// tournament_members → auth.users → profiles automatically.
export async function loadTournamentMembers(tournamentId) {
  const [{ data: members, error: memErr }, { data: tournament, error: tErr }] = await Promise.all([
    supabase.from('tournament_members')
      .select('user_id, role, created_at')
      .eq('tournament_id', tournamentId)
      .order('created_at'),
    supabase.from('tournaments')
      .select('created_by, created_at')
      .eq('id', tournamentId)
      .maybeSingle(),
  ]);
  if (memErr) throw memErr;
  if (tErr) throw tErr;

  const ids = [...new Set(
    [tournament?.created_by, ...(members ?? []).map((m) => m.user_id)].filter(Boolean),
  )];

  let byId = {};
  if (ids.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('user_id, display_name, handicap, avatar_color')
      .in('user_id', ids);
    if (pErr) throw pErr;
    byId = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p]));
  }

  const rows = [];
  if (tournament?.created_by) {
    rows.push({
      userId: tournament.created_by,
      role: 'owner',
      joinedAt: tournament.created_at,
      profile: byId[tournament.created_by] ?? null,
    });
  }
  (members ?? []).forEach((m) => {
    if (m.user_id === tournament?.created_by) return;
    rows.push({
      userId: m.user_id,
      role: m.role,
      joinedAt: m.created_at,
      profile: byId[m.user_id] ?? null,
    });
  });
  return rows;
}

export async function removeTournamentMember(tournamentId, userId) {
  const { error } = await supabase
    .from('tournament_members')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function joinTournamentByCode(code) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Must be signed in to join');

  const { data: invite, error: inviteErr } = await supabase
    .from('tournament_invites').select('tournament_id, role')
    .eq('code', code.toUpperCase().trim()).maybeSingle();
  if (inviteErr) throw inviteErr;
  if (!invite) throw new Error('Invalid code — check with the tournament owner');

  // Default = editor: the common use case is friends scoring a tournament
  // together. Viewer-only invites are a future per-invite opt-in.
  const role = invite.role ?? 'editor';
  const { error } = await supabase
    .from('tournament_members')
    .upsert({ tournament_id: invite.tournament_id, user_id: userId, role });
  if (error) throw error;
  return invite.tournament_id;
}

export function isRoundInProgress(tournament) {
  if (!tournament) return false;
  const round = tournament.rounds?.[tournament.currentRound];
  if (!round || !round.scores) return false;

  const playerIds = tournament.players.map((p) => p.id);
  const holeCount = round.course?.holes?.length ?? 18;
  const expected = playerIds.length * holeCount;

  let entered = 0;
  for (const pid of playerIds) {
    const perPlayer = round.scores[pid];
    if (!perPlayer) continue;
    entered += Object.keys(perPlayer).length;
  }
  return entered > 0 && entered < expected;
}
