import { calcStablefordPoints, calcExtraShots, roundPairLeaderboard, getPlayingHandicap } from './tournamentStore';

// ── Player Stats ──

export function playerRoundHistory(tournament, playerId) {
  return tournament.rounds
    .map((round, ri) => {
      if (!round.scores || !round.scores[playerId]) return null;
      const player = tournament.players.find(p => p.id === playerId);
      const handicap = player ? getPlayingHandicap(round, player) : 0;
      let points = 0, strokes = 0, holesPlayed = 0;
      round.holes.forEach(hole => {
        const sc = round.scores[playerId]?.[hole.number];
        if (sc) {
          strokes += sc;
          points += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
          holesPlayed++;
        }
      });
      if (holesPlayed === 0) return null;
      return { roundIndex: ri, courseName: round.courseName, points, strokes, holesPlayed, avgPerHole: +(points / holesPlayed).toFixed(2) };
    })
    .filter(Boolean);
}

export function playerAvgStableford(tournament, playerId) {
  const history = playerRoundHistory(tournament, playerId);
  if (history.length === 0) return 0;
  return +(history.reduce((s, r) => s + r.points, 0) / history.length).toFixed(1);
}

export function playerScoreDistribution(tournament, playerId, { useNet = false } = {}) {
  const dist = { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worse: 0, total: 0 };
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach(round => {
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      dist.total++;
      if (vsPar <= -2) dist.eagles++;
      else if (vsPar === -1) dist.birdies++;
      else if (vsPar === 0) dist.pars++;
      else if (vsPar === 1) dist.bogeys++;
      else if (vsPar === 2) dist.doubles++;
      else dist.worse++;
    });
  });
  return dist;
}

// ── Streaks ──

export function playerStreaks(tournament, playerId, { useNet = false } = {}) {
  const results = []; // array of vs-par per hole across all rounds
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach(round => {
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      results.push(sc - extra - hole.par);
    });
  });

  let bestParStreak = 0, bestBirdieStreak = 0, worstBogeyStreak = 0;
  let curPar = 0, curBirdie = 0, curBogey = 0;

  results.forEach(net => {
    // Par or better streak (net <= 0)
    if (net <= 0) { curPar++; bestParStreak = Math.max(bestParStreak, curPar); }
    else curPar = 0;
    // Birdie or better streak (net <= -1)
    if (net <= -1) { curBirdie++; bestBirdieStreak = Math.max(bestBirdieStreak, curBirdie); }
    else curBirdie = 0;
    // Bogey or worse streak (net >= 1)
    if (net >= 1) { curBogey++; worstBogeyStreak = Math.max(worstBogeyStreak, curBogey); }
    else curBogey = 0;
  });

  return { bestParStreak, bestBirdieStreak, worstBogeyStreak };
}

// ── Hole Analysis ──

export function bestWorstHoles(tournament) {
  const holeMap = {}; // key: "roundIndex-holeNumber"
  tournament.rounds.forEach((round, ri) => {
    if (!round.scores || Object.keys(round.scores).length === 0) return;
    round.holes.forEach(hole => {
      const key = `${ri}-${hole.number}`;
      let totalPts = 0, count = 0;
      tournament.players.forEach(p => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const handicap = getPlayingHandicap(round, p);
        totalPts += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        count++;
      });
      if (count > 0) {
        holeMap[key] = { holeNumber: hole.number, courseName: round.courseName, par: hole.par, si: hole.strokeIndex, avgPoints: +(totalPts / count).toFixed(2) };
      }
    });
  });

  const all = Object.values(holeMap);
  const sorted = [...all].sort((a, b) => b.avgPoints - a.avgPoints);
  return {
    best: sorted.slice(0, 3),
    worst: sorted.slice(-3).reverse(),
  };
}

export function holeDifficultyMap(tournament, roundIndex) {
  const round = tournament.rounds[roundIndex];
  if (!round?.scores) return [];
  return round.holes.map(hole => {
    const playerScores = tournament.players.map(p => {
      const sc = round.scores[p.id]?.[hole.number];
      if (!sc) return null;
      const handicap = getPlayingHandicap(round, p);
      return { playerId: p.id, playerName: p.name, points: calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex), strokes: sc };
    }).filter(Boolean);
    const avg = playerScores.length > 0 ? +(playerScores.reduce((s, x) => s + x.points, 0) / playerScores.length).toFixed(2) : 0;
    return { holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, playerScores, avgPoints: avg };
  });
}

// ── Head-to-Head ──

export function headToHead(tournament, p1Id, p2Id) {
  let p1Wins = 0, p2Wins = 0, ties = 0;
  const holes = [];
  const p1 = tournament.players.find(p => p.id === p1Id);
  const p2 = tournament.players.find(p => p.id === p2Id);
  tournament.rounds.forEach(round => {
    if (!round.scores?.[p1Id] || !round.scores?.[p2Id]) return;
    const h1 = p1 ? getPlayingHandicap(round, p1) : 0;
    const h2 = p2 ? getPlayingHandicap(round, p2) : 0;
    round.holes.forEach(hole => {
      const s1 = round.scores[p1Id]?.[hole.number];
      const s2 = round.scores[p2Id]?.[hole.number];
      if (!s1 || !s2) return;
      const pts1 = calcStablefordPoints(hole.par, s1, h1, hole.strokeIndex);
      const pts2 = calcStablefordPoints(hole.par, s2, h2, hole.strokeIndex);
      if (pts1 > pts2) p1Wins++;
      else if (pts2 > pts1) p2Wins++;
      else ties++;
      holes.push({ holeNumber: hole.number, courseName: round.courseName, p1Points: pts1, p2Points: pts2 });
    });
  });
  return { p1Wins, p2Wins, ties, holes };
}

// ── Pair Chemistry ──

export function pairPerformance(tournament) {
  const pairMap = {};
  tournament.rounds.forEach(round => {
    if (!round.pairs || !round.scores || Object.keys(round.scores).length === 0) return;
    round.pairs.forEach(pair => {
      const key = [pair[0].id, pair[1].id].sort().join('-');
      if (!pairMap[key]) pairMap[key] = { players: [pair[0], pair[1]], rounds: 0, totalPoints: 0 };
      const results = roundPairLeaderboard(round, tournament.players);
      const match = results.find(r => r.members.some(m => m.player.id === pair[0].id));
      if (match) {
        pairMap[key].rounds++;
        pairMap[key].totalPoints += match.combinedPoints;
      }
    });
  });
  return Object.values(pairMap)
    .map(p => ({ ...p, avgPoints: p.rounds > 0 ? +(p.totalPoints / p.rounds).toFixed(1) : 0 }))
    .sort((a, b) => b.avgPoints - a.avgPoints);
}

// ── Tournament Highlights ──

export function tournamentHighlights(tournament, { useNet = false } = {}) {
  let bestRound = null, mostBirdies = null, longestParStreak = null;

  tournament.players.forEach(p => {
    const history = playerRoundHistory(tournament, p.id);
    history.forEach(r => {
      if (!bestRound || r.points > bestRound.points) bestRound = { player: p, ...r };
    });

    const dist = playerScoreDistribution(tournament, p.id, { useNet });
    if (!mostBirdies || dist.birdies + dist.eagles > mostBirdies.count) {
      mostBirdies = { player: p, count: dist.birdies + dist.eagles };
    }

    const streaks = playerStreaks(tournament, p.id, { useNet });
    if (!longestParStreak || streaks.bestParStreak > longestParStreak.count) {
      longestParStreak = { player: p, count: streaks.bestParStreak };
    }
  });

  const holes = bestWorstHoles(tournament);

  return { bestRound, mostBirdies, longestParStreak, bestHole: holes.best[0] || null, worstHole: holes.worst[0] || null };
}
