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
  const { data, error } = await supabase
    .from('tournaments')
    .select('data')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => row.data);
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
  const { error } = await supabase.from('tournaments').upsert({
    id: tournament.id,
    name: tournament.name,
    created_at: tournament.createdAt,
    data: tournament,
  });
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

// Individual leaderboard for best ball mode.
// Each player earns win-points from their pair's hole wins per round.
export function tournamentBestWorstLeaderboard(tournament) {
  const { players, rounds, settings } = tournament;
  const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };
  const totals = Object.fromEntries(players.map((p) => [p.id, { player: p, points: 0, bestWins: 0, worstWins: 0 }]));

  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament) || !round.pairs?.length) return;
    const result = calcBestWorstBall(round, players);
    if (!result) return;
    const { pair1, pair2, bestBall, worstBall } = result;

    // Attribute hole wins to each player in the winning pair
    const awardPair = (pair, bestWins, worstWins) => {
      pair.forEach((p) => {
        totals[p.id].points += bestWins * bestBallValue + worstWins * worstBallValue;
        totals[p.id].bestWins += bestWins;
        totals[p.id].worstWins += worstWins;
      });
    };

    awardPair(pair1, bestBall.pair1, worstBall.pair1);
    awardPair(pair2, bestBall.pair2, worstBall.pair2);
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
