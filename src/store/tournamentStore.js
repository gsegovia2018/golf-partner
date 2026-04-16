import AsyncStorage from '@react-native-async-storage/async-storage';

const TOURNAMENTS_KEY = '@golf_tournaments';
const ACTIVE_ID_KEY = '@golf_active_id';
const LEGACY_KEY = '@golf_tournament';

async function migrate() {
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (!legacy) return;
  const t = JSON.parse(legacy);
  await AsyncStorage.multiSet([
    [TOURNAMENTS_KEY, JSON.stringify([t])],
    [ACTIVE_ID_KEY, t.id],
  ]);
  await AsyncStorage.removeItem(LEGACY_KEY);
}

export async function loadAllTournaments() {
  await migrate();
  const raw = await AsyncStorage.getItem(TOURNAMENTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function loadTournament() {
  const [all, activeId] = await Promise.all([
    loadAllTournaments(),
    AsyncStorage.getItem(ACTIVE_ID_KEY),
  ]);
  if (!activeId) return null;
  return all.find((t) => t.id === activeId) ?? null;
}

export async function saveTournament(tournament) {
  const all = await loadAllTournaments();
  const idx = all.findIndex((t) => t.id === tournament.id);
  if (idx >= 0) all[idx] = tournament; else all.push(tournament);
  await AsyncStorage.multiSet([
    [TOURNAMENTS_KEY, JSON.stringify(all)],
    [ACTIVE_ID_KEY, tournament.id],
  ]);
}

export async function setActiveTournament(id) {
  await AsyncStorage.setItem(ACTIVE_ID_KEY, id);
}

export async function clearActiveTournament() {
  await AsyncStorage.removeItem(ACTIVE_ID_KEY);
}

export async function deleteTournament(id) {
  const all = await loadAllTournaments();
  const filtered = all.filter((t) => t.id !== id);
  const activeId = await AsyncStorage.getItem(ACTIVE_ID_KEY);
  const ops = [[TOURNAMENTS_KEY, JSON.stringify(filtered)]];
  if (activeId === id) ops.push([ACTIVE_ID_KEY, '']);
  await AsyncStorage.multiSet(ops);
  if (activeId === id) await AsyncStorage.removeItem(ACTIVE_ID_KEY);
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

export function randomPairs(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return [
    [shuffled[0], shuffled[1]],
    [shuffled[2], shuffled[3]],
  ];
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
    const handicap = round.playerHandicaps?.[player.id] ?? player.handicap;
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
  if (!round.pairs?.length) return null;
  const [pair1, pair2] = round.pairs;
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));

  const pts = (playerId, hole) => {
    const player = playersById[playerId];
    if (!player) return null;
    const handicap = round.playerHandicaps?.[playerId] ?? player.handicap;
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

// Individual leaderboard for best ball mode.
// Each player earns win-points from their pair's hole wins per round.
export function tournamentBestWorstLeaderboard(tournament) {
  const { players, rounds, settings } = tournament;
  const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };
  const totals = Object.fromEntries(players.map((p) => [p.id, { player: p, points: 0, bestWins: 0, worstWins: 0 }]));

  rounds.forEach((round) => {
    if (!round.scores || !round.pairs?.length) return;
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

  rounds.forEach((round) => {
    if (!round.scores) return;
    roundTotals(round, players).forEach(({ player, totalPoints, totalStrokes }) => {
      const entry = totals.find((t) => t.player.id === player.id);
      entry.points += totalPoints;
      entry.strokes += totalStrokes;
    });
  });

  return totals.sort((a, b) => b.points - a.points);
}
