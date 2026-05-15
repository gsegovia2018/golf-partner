import { calcStablefordPoints, calcExtraShots, roundPairLeaderboard, getPlayingHandicap, pickupStrokes } from './tournamentStore';

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

export function playerScoreDistribution(tournament, playerId, { metric = 'points', roundIndex = null } = {}) {
  const useNet = metric === 'points';
  const dist = {
    eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worse: 0, total: 0,
    eagleHoles: [], birdieHoles: [], parHoles: [], bogeyHoles: [], doubleHoles: [], worseHoles: [],
  };
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
      const entry = {
        roundIndex: ri, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, strokes: sc, points, vsPar,
      };
      dist.total++;
      if (vsPar <= -2) { dist.eagles++; dist.eagleHoles.push(entry); }
      else if (vsPar === -1) { dist.birdies++; dist.birdieHoles.push(entry); }
      else if (vsPar === 0) { dist.pars++; dist.parHoles.push(entry); }
      else if (vsPar === 1) { dist.bogeys++; dist.bogeyHoles.push(entry); }
      else if (vsPar === 2) { dist.doubles++; dist.doubleHoles.push(entry); }
      else { dist.worse++; dist.worseHoles.push(entry); }
    });
  });
  return dist;
}

// ── Streaks ──

export function playerStreaks(tournament, playerId, { metric = 'points', roundIndex = null } = {}) {
  const useNet = metric === 'points';
  const entries = [];
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
      entries.push({
        roundIndex: ri, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, strokes: sc, points, vsPar,
      });
    });
  });

  const longestRun = (predicate) => {
    let bestCount = 0, bestStart = -1, bestEnd = -1;
    let curStart = -1;
    entries.forEach((e, i) => {
      if (predicate(e)) {
        if (curStart === -1) curStart = i;
        const curCount = i - curStart + 1;
        if (curCount > bestCount) { bestCount = curCount; bestStart = curStart; bestEnd = i; }
      } else {
        curStart = -1;
      }
    });
    return {
      count: bestCount,
      holes: bestCount > 0 ? entries.slice(bestStart, bestEnd + 1) : [],
    };
  };

  const par = longestRun(e => e.vsPar <= 0);
  const birdie = longestRun(e => e.vsPar <= -1);
  const bogeyOnly = longestRun(e => e.vsPar === 1);
  const doubleBogeyPlus = longestRun(e => e.vsPar >= 2);

  return {
    bestParStreak: par.count,
    bestBirdieStreak: birdie.count,
    bogeyOnlyStreak: bogeyOnly.count,
    doubleBogeyPlusStreak: doubleBogeyPlus.count,
    parStreakHoles: par.holes,
    birdieStreakHoles: birdie.holes,
    bogeyOnlyStreakHoles: bogeyOnly.holes,
    doubleBogeyPlusStreakHoles: doubleBogeyPlus.holes,
  };
}

// ── Hole Analysis ──

export function bestWorstHoles(tournament, { metric = 'points', roundIndex = null } = {}) {
  const holeMap = {};
  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores || Object.keys(round.scores).length === 0) return;
    round.holes.forEach(hole => {
      const key = `${ri}-${hole.number}`;
      let totalPts = 0, totalStrokes = 0, totalVsPar = 0, count = 0;
      const playerScores = [];
      tournament.players.forEach(p => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const handicap = getPlayingHandicap(round, p);
        const pts = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        totalPts += pts;
        totalStrokes += sc;
        totalVsPar += (sc - hole.par);
        count++;
        playerScores.push({ playerId: p.id, playerName: p.name, strokes: sc, points: pts });
      });
      if (count > 0) {
        holeMap[key] = {
          roundIndex: ri,
          holeNumber: hole.number,
          courseName: round.courseName,
          par: hole.par,
          si: hole.strokeIndex,
          avgPoints: +(totalPts / count).toFixed(2),
          avgStrokes: +(totalStrokes / count).toFixed(2),
          avgVsPar: +(totalVsPar / count).toFixed(2),
          playerScores,
        };
      }
    });
  });

  const all = Object.values(holeMap);
  // Easier = higher points, or lower vsPar. Sort descending by points.
  const sorted = metric === 'strokes'
    ? [...all].sort((a, b) => a.avgVsPar - b.avgVsPar) // ascending vsPar; easiest first
    : [...all].sort((a, b) => b.avgPoints - a.avgPoints); // descending points; easiest first
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
    const avgPts = playerScores.length > 0 ? +(playerScores.reduce((s, x) => s + x.points, 0) / playerScores.length).toFixed(2) : 0;
    const avgStr = playerScores.length > 0 ? +(playerScores.reduce((s, x) => s + x.strokes, 0) / playerScores.length).toFixed(2) : 0;
    return { holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, playerScores, avgPoints: avgPts, avgStrokes: avgStr };
  });
}

// ── Head-to-Head ──

export function headToHead(tournament, p1Id, p2Id, { roundIndex = null } = {}) {
  const p1 = tournament.players.find(p => p.id === p1Id);
  const p2 = tournament.players.find(p => p.id === p2Id);
  const bucket = () => ({ p1Wins: 0, p2Wins: 0, ties: 0 });
  const points = bucket();
  const strokes = bucket();
  const totals = { p1Points: 0, p2Points: 0, p1Strokes: 0, p2Strokes: 0, holesCompared: 0 };
  const perRound = [];
  const holes = [];

  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores?.[p1Id] || !round.scores?.[p2Id]) return;
    const h1 = p1 ? getPlayingHandicap(round, p1) : 0;
    const h2 = p2 ? getPlayingHandicap(round, p2) : 0;
    const rp = { roundIndex: ri, courseName: round.courseName, points: bucket(), strokes: bucket(), p1Points: 0, p2Points: 0, p1Strokes: 0, p2Strokes: 0, holesCompared: 0 };
    round.holes.forEach(hole => {
      const s1 = round.scores[p1Id]?.[hole.number];
      const s2 = round.scores[p2Id]?.[hole.number];
      if (!s1 || !s2) return;
      const pts1 = calcStablefordPoints(hole.par, s1, h1, hole.strokeIndex);
      const pts2 = calcStablefordPoints(hole.par, s2, h2, hole.strokeIndex);
      if (pts1 > pts2) { points.p1Wins++; rp.points.p1Wins++; }
      else if (pts2 > pts1) { points.p2Wins++; rp.points.p2Wins++; }
      else { points.ties++; rp.points.ties++; }
      // Strokes: lower is better
      if (s1 < s2) { strokes.p1Wins++; rp.strokes.p1Wins++; }
      else if (s2 < s1) { strokes.p2Wins++; rp.strokes.p2Wins++; }
      else { strokes.ties++; rp.strokes.ties++; }
      rp.p1Points += pts1; rp.p2Points += pts2;
      rp.p1Strokes += s1; rp.p2Strokes += s2;
      rp.holesCompared++;
      totals.p1Points += pts1; totals.p2Points += pts2;
      totals.p1Strokes += s1; totals.p2Strokes += s2;
      totals.holesCompared++;
      holes.push({ roundIndex: ri, holeNumber: hole.number, courseName: round.courseName, p1Points: pts1, p2Points: pts2, p1Strokes: s1, p2Strokes: s2, par: hole.par });
    });
    if (rp.holesCompared > 0) perRound.push(rp);
  });
  return { points, strokes, totals, perRound, holes };
}

// ── Pair Chemistry ──

export function pairPerformance(tournament) {
  const pairMap = {};
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.pairs || !round.scores || Object.keys(round.scores).length === 0) return;
    round.pairs.forEach(pair => {
      const key = [pair[0].id, pair[1].id].sort().join('-');
      if (!pairMap[key]) {
        pairMap[key] = { players: [pair[0], pair[1]], rounds: 0, totalPoints: 0, roundList: [] };
      }
      const results = roundPairLeaderboard(round, tournament.players);
      const match = results.find(r => r.members.some(m => m.player.id === pair[0].id));
      if (match) {
        pairMap[key].rounds++;
        pairMap[key].totalPoints += match.combinedPoints;
        pairMap[key].roundList.push({
          roundIndex,
          courseName: round.courseName,
          combinedPoints: match.combinedPoints,
          combinedStrokes: match.combinedStrokes,
          memberPoints: match.members.map(m => ({
            playerId: m.player.id,
            playerName: m.player.name,
            points: m.totalPoints,
          })),
        });
      }
    });
  });
  return Object.values(pairMap)
    .map(p => ({ ...p, avgPoints: p.rounds > 0 ? +(p.totalPoints / p.rounds).toFixed(1) : 0 }))
    .sort((a, b) => b.avgPoints - a.avgPoints);
}

// ── Tournament Highlights ──

export function tournamentHighlights(tournament, { metric = 'points', roundIndex = null } = {}) {
  const isStrokes = metric === 'strokes';
  // For strokes, best round = lowest; use negative value for "higher is better"
  let bestRound = { value: -Infinity, entries: [] };
  let mostBirdies = { value: -1, entries: [] };
  let longestParStreak = { value: 0, entries: [] };

  const pushTied = (holder, value, entry) => {
    if (value > holder.value) { holder.value = value; holder.entries = [entry]; }
    else if (value === holder.value) holder.entries.push(entry);
  };

  tournament.players.forEach(p => {
    const history = playerRoundHistory(tournament, p.id)
      .filter(r => roundIndex === null || r.roundIndex === roundIndex);
    history.forEach(r => {
      const round = tournament.rounds[r.roundIndex];
      const handicap = getPlayingHandicap(round, p);
      const holes = round.holes
        .map(h => {
          const sc = round.scores?.[p.id]?.[h.number];
          if (!sc) return null;
          return {
            roundIndex: r.roundIndex, courseName: round.courseName,
            holeNumber: h.number, par: h.par, strokes: sc,
            points: calcStablefordPoints(h.par, sc, handicap, h.strokeIndex),
          };
        })
        .filter(Boolean);
      const rankValue = isStrokes ? -r.strokes : r.points;
      pushTied(bestRound, rankValue, { player: p, points: r.points, strokes: r.strokes, courseName: r.courseName, roundIndex: r.roundIndex, breakdown: holes });
    });

    const dist = playerScoreDistribution(tournament, p.id, { metric, roundIndex });
    const birdiesAndEagles = [...dist.eagleHoles, ...dist.birdieHoles];
    pushTied(mostBirdies, birdiesAndEagles.length, { player: p, count: birdiesAndEagles.length, breakdown: birdiesAndEagles });

    const streaks = playerStreaks(tournament, p.id, { metric, roundIndex });
    pushTied(longestParStreak, streaks.bestParStreak, { player: p, count: streaks.bestParStreak, breakdown: streaks.parStreakHoles });
  });

  const holes = bestWorstHoles(tournament, { metric, roundIndex });

  return {
    bestRound: bestRound.entries.length ? {
      value: isStrokes ? -bestRound.value : bestRound.value,
      metric,
      entries: bestRound.entries,
    } : null,
    mostBirdies: mostBirdies.value > 0 ? { value: mostBirdies.value, entries: mostBirdies.entries } : null,
    longestParStreak: longestParStreak.value > 1 ? { value: longestParStreak.value, entries: longestParStreak.entries } : null,
    bestHole: holes.best[0] || null,
    worstHole: holes.worst[0] || null,
  };
}

// ── Pair Hole Wins (Best Ball / Worst Ball) ──

// Decide which of two partners (a, b) holds the MB role on `hole` when they
// tie on the metric value. Rule order (per house rules):
//   1) Lower playing handicap.
//   2) Better score on the previous hole, walking backwards until broken.
//   3) Final fallback: lexicographic player.id (deterministic, stable).
// Returns the player.id chosen as MB.
function pickMBTiebreak(aPlayer, bPlayer, round, holeOrderIndex, isStrokes) {
  const aHcp = getPlayingHandicap(round, aPlayer);
  const bHcp = getPlayingHandicap(round, bPlayer);
  if (aHcp !== bHcp) return aHcp < bHcp ? aPlayer.id : bPlayer.id;
  for (let i = holeOrderIndex - 1; i >= 0; i--) {
    const prev = round.holes[i];
    const aSc = round.scores[aPlayer.id]?.[prev.number];
    const bSc = round.scores[bPlayer.id]?.[prev.number];
    if (!aSc || !bSc) continue;
    if (isStrokes) {
      if (aSc !== bSc) return aSc < bSc ? aPlayer.id : bPlayer.id;
    } else {
      const aPts = calcStablefordPoints(prev.par, aSc, aHcp, prev.strokeIndex);
      const bPts = calcStablefordPoints(prev.par, bSc, bHcp, prev.strokeIndex);
      if (aPts !== bPts) return aPts > bPts ? aPlayer.id : bPlayer.id;
    }
  }
  return aPlayer.id < bPlayer.id ? aPlayer.id : bPlayer.id;
}

// Assigns each pair member a unique MB/PB role on a hole, using the tiebreaker
// above when the two partners share the same metric value. Returns ids.
function assignPairRoles(aPlayer, aValue, bPlayer, bValue, round, holeOrderIndex, isStrokes) {
  const aIsBetter = isStrokes ? aValue < bValue : aValue > bValue;
  const bIsBetter = isStrokes ? bValue < aValue : bValue > aValue;
  if (aIsBetter) return { mbId: aPlayer.id, pbId: bPlayer.id };
  if (bIsBetter) return { mbId: bPlayer.id, pbId: aPlayer.id };
  const mbId = pickMBTiebreak(aPlayer, bPlayer, round, holeOrderIndex, isStrokes);
  const pbId = mbId === aPlayer.id ? bPlayer.id : aPlayer.id;
  return { mbId, pbId };
}

export function pairHoleWins(tournament, { metric = 'points', roundIndex = null } = {}) {
  const isStrokes = metric === 'strokes';
  const stats = {};
  tournament.players.forEach(p => {
    stats[p.id] = {
      player: p,
      best: { W: 0, T: 0, L: 0 },
      worst: { W: 0, T: 0, L: 0 },
      total: { W: 0, T: 0, L: 0 },
      breakdown: [],
    };
  });

  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores || !round.pairs || round.pairs.length < 2) return;
    const [pair1, pair2] = round.pairs;
    if (!pair1 || !pair2 || pair1.length < 2 || pair2.length < 2) return;

    const valueOf = (playerId, hole) => {
      const player = tournament.players.find(x => x.id === playerId);
      if (!player) return null;
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return null;
      if (isStrokes) return sc;
      const handicap = getPlayingHandicap(round, player);
      return calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
    };

    const better = (a, b) => isStrokes ? a < b : a > b;
    const pickBest = (a, b) => isStrokes ? Math.min(a, b) : Math.max(a, b);
    const pickWorst = (a, b) => isStrokes ? Math.max(a, b) : Math.min(a, b);

    round.holes.forEach((hole, hi) => {
      const p1a = valueOf(pair1[0].id, hole);
      const p1b = valueOf(pair1[1].id, hole);
      const p2a = valueOf(pair2[0].id, hole);
      const p2b = valueOf(pair2[1].id, hole);
      if (p1a === null || p1b === null || p2a === null || p2b === null) return;

      const pair1Best = pickBest(p1a, p1b);
      const pair1Worst = pickWorst(p1a, p1b);
      const pair2Best = pickBest(p2a, p2b);
      const pair2Worst = pickWorst(p2a, p2b);

      const r1 = assignPairRoles(pair1[0], p1a, pair1[1], p1b, round, hi, isStrokes);
      const r2 = assignPairRoles(pair2[0], p2a, pair2[1], p2b, round, hi, isStrokes);

      const bestOutcomePair1 = better(pair1Best, pair2Best) ? 'W' : better(pair2Best, pair1Best) ? 'L' : 'T';
      const bestOutcomePair2 = bestOutcomePair1 === 'W' ? 'L' : bestOutcomePair1 === 'L' ? 'W' : 'T';
      const worstOutcomePair1 = better(pair1Worst, pair2Worst) ? 'W' : better(pair2Worst, pair1Worst) ? 'L' : 'T';
      const worstOutcomePair2 = worstOutcomePair1 === 'W' ? 'L' : worstOutcomePair1 === 'L' ? 'W' : 'T';

      const valueById = { [pair1[0].id]: p1a, [pair1[1].id]: p1b, [pair2[0].id]: p2a, [pair2[1].id]: p2b };

      const credit = (playerId, roles, pairBest, pairWorst, bestOutcome, worstOutcome, oppBest, oppWorst) => {
        const rec = stats[playerId];
        const entry = {
          roundIndex: ri, courseName: round.courseName, holeNumber: hole.number, par: hole.par,
          playerValue: valueById[playerId], teamBest: pairBest, teamWorst: pairWorst,
          oppBest, oppWorst, metric,
          bestRole: null, bestOutcome: null,
          worstRole: null, worstOutcome: null,
        };
        if (roles.mbId === playerId) {
          rec.best[bestOutcome]++;
          rec.total[bestOutcome]++;
          entry.bestRole = 'MB';
          entry.bestOutcome = bestOutcome;
        }
        if (roles.pbId === playerId) {
          rec.worst[worstOutcome]++;
          rec.total[worstOutcome]++;
          entry.worstRole = 'PB';
          entry.worstOutcome = worstOutcome;
        }
        if (entry.bestRole || entry.worstRole) rec.breakdown.push(entry);
      };

      credit(pair1[0].id, r1, pair1Best, pair1Worst, bestOutcomePair1, worstOutcomePair1, pair2Best, pair2Worst);
      credit(pair1[1].id, r1, pair1Best, pair1Worst, bestOutcomePair1, worstOutcomePair1, pair2Best, pair2Worst);
      credit(pair2[0].id, r2, pair2Best, pair2Worst, bestOutcomePair2, worstOutcomePair2, pair1Best, pair1Worst);
      credit(pair2[1].id, r2, pair2Best, pair2Worst, bestOutcomePair2, worstOutcomePair2, pair1Best, pair1Worst);
    });
  });

  return Object.values(stats).sort((a, b) => b.total.W - a.total.W);
}

// ── Pair Difference by Hole ──
// Returns the hole-by-hole combined-pair totals and the cumulative pair1 − pair2
// advantage in the requested metric. For strokes, `delta` is pair2_strokes −
// pair1_strokes so that a positive number still means pair1 is ahead (fewer
// strokes). Null when the round has no pairs or no scores.
export function pairDifferenceByHole(tournament, roundIndex, { metric = 'points' } = {}) {
  const round = tournament.rounds?.[roundIndex];
  if (!round || !round.scores || !round.pairs || round.pairs.length < 2) return null;
  const [pair1, pair2] = round.pairs;
  if (!pair1 || !pair2 || pair1.length < 2 || pair2.length < 2) return null;
  const isStrokes = metric === 'strokes';

  const sumPair = (pair, hole) => {
    let total = 0;
    for (const member of pair) {
      const player = tournament.players.find(p => p.id === member.id);
      if (!player) return null;
      const sc = round.scores[player.id]?.[hole.number];
      if (!sc) return null;
      if (isStrokes) total += sc;
      else total += calcStablefordPoints(hole.par, sc, getPlayingHandicap(round, player), hole.strokeIndex);
    }
    return total;
  };

  let cumulative = 0;
  const holes = round.holes.map(hole => {
    const p1Total = sumPair(pair1, hole);
    const p2Total = sumPair(pair2, hole);
    if (p1Total == null || p2Total == null) {
      return { holeNumber: hole.number, par: hole.par, pair1Total: null, pair2Total: null, holeDelta: null, cumulative };
    }
    const holeDelta = isStrokes ? p2Total - p1Total : p1Total - p2Total;
    cumulative += holeDelta;
    return { holeNumber: hole.number, par: hole.par, pair1Total: p1Total, pair2Total: p2Total, holeDelta, cumulative };
  });

  const completed = holes.filter(h => h.holeDelta !== null);
  const playedDeltas = completed.map(h => h.cumulative);
  const maxLead = playedDeltas.length ? Math.max(0, ...playedDeltas) : 0;
  const maxDeficit = playedDeltas.length ? Math.min(0, ...playedDeltas) : 0;
  const finalDelta = completed.length ? completed[completed.length - 1].cumulative : 0;

  let crossovers = 0;
  let prevSign = 0;
  for (const h of completed) {
    const sign = h.cumulative > 0 ? 1 : h.cumulative < 0 ? -1 : 0;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossovers++;
    if (sign !== 0) prevSign = sign;
  }

  return {
    pair1, pair2, metric,
    courseName: round.courseName,
    holes,
    maxLead, maxDeficit, finalDelta, crossovers,
    maxAbs: Math.max(Math.abs(maxLead), Math.abs(maxDeficit)),
  };
}

// ── Hall of Shame ──

export function hallOfShame(tournament, { metric = 'points' } = {}) {
  const useNet = metric === 'points';
  const perPlayerEntries = {};
  tournament.players.forEach(p => { perPlayerEntries[p.id] = []; });
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    tournament.players.forEach(p => {
      if (!round.scores[p.id]) return;
      const handicap = getPlayingHandicap(round, p);
      round.holes.forEach(hole => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
        const vsPar = sc - extra - hole.par;
        const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
        perPlayerEntries[p.id].push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
          strokes: sc, vsPar, points,
        });
      });
    });
  });

  const tied = (minValue = 1) => ({ value: -Infinity, entries: [], minValue });
  const push = (holder, value, entry) => {
    if (value < holder.minValue) return;
    if (value > holder.value) { holder.value = value; holder.entries = [entry]; }
    else if (value === holder.value) holder.entries.push(entry);
  };
  const finalize = (holder) => holder.entries.length ? { value: holder.value, entries: holder.entries } : null;

  // 1. Triple Bogey Club — worst single hole by vsPar
  const tripleBogey = tied(3);
  tournament.players.forEach(p => {
    perPlayerEntries[p.id].forEach(e => push(tripleBogey, e.vsPar, { player: p, ...e, breakdown: [e] }));
  });

  // longest-run helper per-player
  const longestRunPerPlayer = (predicate) => {
    const holder = tied(1);
    tournament.players.forEach(p => {
      const entries = perPlayerEntries[p.id];
      let curStart = -1, bestCount = 0, bestStart = -1, bestEnd = -1;
      entries.forEach((e, i) => {
        if (predicate(e)) {
          if (curStart === -1) curStart = i;
          const curCount = i - curStart + 1;
          if (curCount > bestCount) { bestCount = curCount; bestStart = curStart; bestEnd = i; }
        } else { curStart = -1; }
      });
      if (bestCount > 0) {
        push(holder, bestCount, {
          player: p, count: bestCount,
          breakdown: entries.slice(bestStart, bestEnd + 1),
        });
      }
    });
    return holder;
  };

  // 2. Bogey Streak — longest run of exactly-bogey holes
  const bogeyStreak = longestRunPerPlayer(e => e.vsPar === 1);
  // Require at least 2 to be meaningful
  bogeyStreak.minValue = 2;
  if (bogeyStreak.value < 2) bogeyStreak.entries = [];

  // 3. Double Bogey+ Streak — longest run of 2-over-or-worse
  const doubleBogeyStreak = longestRunPerPlayer(e => e.vsPar >= 2);
  doubleBogeyStreak.minValue = 2;
  if (doubleBogeyStreak.value < 2) doubleBogeyStreak.entries = [];

  // 4. Pointless Streak — longest 0-stableford-points streak
  const pointlessStreak = longestRunPerPlayer(e => e.points === 0);
  pointlessStreak.minValue = 2;
  if (pointlessStreak.value < 2) pointlessStreak.entries = [];

  // 5. The Gift — biggest gap between others' avg and this player's points on a hole
  const gift = { value: -Infinity, entries: [] };
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    round.holes.forEach(hole => {
      const scores = tournament.players.map(p => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return null;
        const handicap = getPlayingHandicap(round, p);
        const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
        const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
        return { player: p, strokes: sc, points, netVsPar: sc - extra - hole.par };
      }).filter(Boolean);
      if (scores.length < 4) return;
      scores.forEach(entry => {
        const others = scores.filter(s => s.player.id !== entry.player.id);
        const othersAvg = others.reduce((s, o) => s + o.points, 0) / others.length;
        const gap = +(othersAvg - entry.points).toFixed(2);
        const payload = {
          player: entry.player,
          gap,
          playerPoints: entry.points,
          othersAvg: +othersAvg.toFixed(2),
          roundIndex,
          courseName: round.courseName,
          holeNumber: hole.number,
          par: hole.par,
          breakdown: scores.map(s => ({
            playerId: s.player.id,
            playerName: s.player.name,
            strokes: s.strokes,
            points: s.points,
          })),
        };
        if (gap > gift.value) { gift.value = gap; gift.entries = [payload]; }
        else if (gap === gift.value) gift.entries.push(payload);
      });
    });
  });

  // 6. The Collapse — biggest front9 − back9 drop (18 holes required)
  const collapse = { value: 0, entries: [] };
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores || round.holes.length < 18) return;
    tournament.players.forEach(p => {
      if (!round.scores[p.id]) return;
      const handicap = getPlayingHandicap(round, p);
      let front = 0, back = 0, frontComplete = 0, backComplete = 0;
      const holeEntries = [];
      round.holes.forEach(hole => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
        if (hole.number <= 9) { front += points; frontComplete++; } else { back += points; backComplete++; }
        holeEntries.push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, strokes: sc, points,
        });
      });
      if (frontComplete < 9 || backComplete < 9) return;
      const drop = front - back;
      if (drop <= 0) return;
      const payload = { player: p, drop, front, back, roundIndex, courseName: round.courseName, breakdown: holeEntries };
      if (drop > collapse.value) { collapse.value = drop; collapse.entries = [payload]; }
      else if (drop === collapse.value) collapse.entries.push(payload);
    });
  });

  // 7. Blow-up Hole — highest raw stroke count on any hole
  const blowup = { value: 0, entries: [] };
  tournament.players.forEach(p => {
    perPlayerEntries[p.id].forEach(e => {
      const payload = { player: p, ...e, breakdown: [e] };
      if (e.strokes > blowup.value) { blowup.value = e.strokes; blowup.entries = [payload]; }
      else if (e.strokes === blowup.value) blowup.entries.push(payload);
    });
  });

  return {
    tripleBogey: finalize(tripleBogey),
    bogeyStreak: bogeyStreak.entries.length ? { value: bogeyStreak.value, entries: bogeyStreak.entries } : null,
    doubleBogeyStreak: doubleBogeyStreak.entries.length ? { value: doubleBogeyStreak.value, entries: doubleBogeyStreak.entries } : null,
    pointlessStreak: pointlessStreak.entries.length ? { value: pointlessStreak.value, entries: pointlessStreak.entries } : null,
    gift: gift.entries.length ? { value: gift.value, entries: gift.entries } : null,
    collapse: collapse.entries.length ? { value: collapse.value, entries: collapse.entries } : null,
    blowup: blowup.entries.length ? { value: blowup.value, entries: blowup.entries } : null,
  };
}

// ── Helpers: shared hole iteration ──

// Visits every (player, round, hole) triple where the player has a score,
// yielding the derived metrics needed by most aggregate stats in one place.
function forEachHole(tournament, fn) {
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    tournament.players.forEach(player => {
      if (!round.scores[player.id]) return;
      const handicap = getPlayingHandicap(round, player);
      round.holes.forEach(hole => {
        const strokes = round.scores[player.id]?.[hole.number];
        if (!strokes) return;
        const points = calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex);
        fn({ player, round, roundIndex, hole, strokes, points, handicap });
      });
    });
  });
}

// ── Tournament Momentum ──
// Returns one entry per player with their Stableford points and strokes by
// round, letting a caller plot a trajectory across the weekend.
export function tournamentMomentum(tournament) {
  return tournament.players.map(player => {
    const rounds = tournament.rounds.map((round, roundIndex) => {
      if (!round.scores?.[player.id]) return { roundIndex, courseName: round.courseName, points: null, strokes: null, holesPlayed: 0 };
      const handicap = getPlayingHandicap(round, player);
      let points = 0, strokes = 0, holesPlayed = 0;
      round.holes.forEach(hole => {
        const sc = round.scores[player.id]?.[hole.number];
        if (!sc) return;
        strokes += sc;
        points += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        holesPlayed++;
      });
      return { roundIndex, courseName: round.courseName, points: holesPlayed ? points : null, strokes: holesPlayed ? strokes : null, holesPlayed };
    });
    const played = rounds.filter(r => r.points != null);
    const minPts = played.length ? Math.min(...played.map(r => r.points)) : 0;
    const maxPts = played.length ? Math.max(...played.map(r => r.points)) : 0;
    return { player, rounds, minPts, maxPts };
  });
}

// ── Clutch on Hardest Holes ──
// Average points scored by each player on the top-N hardest-SI holes across
// every completed round. Uses stroke index as the difficulty indicator (the
// lower the index, the harder the hole).
export function clutchOnHardest(tournament, { topN = 3 } = {}) {
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, points: 0, strokes: 0, holesPlayed: 0, breakdown: [] }; });

  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    const hardest = [...round.holes].sort((a, b) => a.strokeIndex - b.strokeIndex).slice(0, topN);
    const hardestNumbers = new Set(hardest.map(h => h.number));
    tournament.players.forEach(player => {
      if (!round.scores[player.id]) return;
      const handicap = getPlayingHandicap(round, player);
      round.holes.forEach(hole => {
        if (!hardestNumbers.has(hole.number)) return;
        const sc = round.scores[player.id]?.[hole.number];
        if (!sc) return;
        const pts = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        const rec = perPlayer[player.id];
        rec.points += pts;
        rec.strokes += sc;
        rec.holesPlayed++;
        rec.breakdown.push({ roundIndex, courseName: round.courseName, holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, strokes: sc, points: pts });
      });
    });
  });

  return Object.values(perPlayer)
    .map(r => ({
      ...r,
      avgPoints: r.holesPlayed ? +(r.points / r.holesPlayed).toFixed(2) : 0,
      avgStrokes: r.holesPlayed ? +(r.strokes / r.holesPlayed).toFixed(2) : 0,
    }))
    .filter(r => r.holesPlayed > 0)
    .sort((a, b) => b.avgPoints - a.avgPoints);
}

// ── Player Consistency ──
// Standard deviation of points per hole. Lower = more consistent.
export function playerConsistency(tournament) {
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, samples: [] }; });
  forEachHole(tournament, ({ player, points }) => { perPlayer[player.id].samples.push(points); });

  return Object.values(perPlayer).map(r => {
    const n = r.samples.length;
    if (n === 0) return { player: r.player, stdev: null, mean: null, holesPlayed: 0 };
    const mean = r.samples.reduce((s, x) => s + x, 0) / n;
    const variance = r.samples.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    return {
      player: r.player,
      stdev: +Math.sqrt(variance).toFixed(2),
      mean: +mean.toFixed(2),
      holesPlayed: n,
    };
  }).filter(r => r.holesPlayed > 0).sort((a, b) => a.stdev - b.stdev);
}

// ── Course DNA ──
// Per-player average points and strokes on each course. Highlights whose game
// suits each venue.
export function courseDNA(tournament) {
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, courses: {} }; });

  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    tournament.players.forEach(player => {
      if (!round.scores[player.id]) return;
      const handicap = getPlayingHandicap(round, player);
      let points = 0, strokes = 0, holesPlayed = 0;
      round.holes.forEach(hole => {
        const sc = round.scores[player.id]?.[hole.number];
        if (!sc) return;
        strokes += sc;
        points += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        holesPlayed++;
      });
      if (holesPlayed === 0) return;
      const key = round.courseName || `R${roundIndex + 1}`;
      const cur = perPlayer[player.id].courses[key] || { courseName: key, points: 0, strokes: 0, holesPlayed: 0, rounds: 0 };
      cur.points += points;
      cur.strokes += strokes;
      cur.holesPlayed += holesPlayed;
      cur.rounds++;
      perPlayer[player.id].courses[key] = cur;
    });
  });

  return Object.values(perPlayer).map(r => ({
    player: r.player,
    courses: Object.values(r.courses).map(c => ({
      ...c,
      avgPoints: c.holesPlayed ? +(c.points / c.holesPlayed).toFixed(2) : 0,
      roundPoints: c.rounds ? +(c.points / c.rounds).toFixed(1) : 0,
      roundStrokes: c.rounds ? +(c.strokes / c.rounds).toFixed(1) : 0,
    })).sort((a, b) => b.avgPoints - a.avgPoints),
  }));
}

// ── Par Type Split ──
// Per-player split of points / strokes by par-3, par-4, par-5 holes.
export function parTypeSplit(tournament, playerId) {
  const buckets = { 3: [], 4: [], 5: [] };
  forEachHole(tournament, ({ player, hole, strokes, points }) => {
    if (player.id !== playerId) return;
    if (!buckets[hole.par]) buckets[hole.par] = [];
    buckets[hole.par].push({ strokes, points, par: hole.par });
  });
  const summarize = (arr) => {
    if (arr.length === 0) return { holes: 0, avgPoints: 0, avgStrokes: 0, totalPoints: 0 };
    const pts = arr.reduce((s, h) => s + h.points, 0);
    const str = arr.reduce((s, h) => s + h.strokes, 0);
    return { holes: arr.length, avgPoints: +(pts / arr.length).toFixed(2), avgStrokes: +(str / arr.length).toFixed(2), totalPoints: pts };
  };
  return { par3: summarize(buckets[3] || []), par4: summarize(buckets[4] || []), par5: summarize(buckets[5] || []) };
}

// ── Warm-up vs Closing ──
// Average points on the opening 3 holes vs the closing 3 holes across all
// rounds. Reveals nerves / fatigue patterns.
export function warmupVsClosing(tournament, playerId) {
  const warmup = [], closing = [];
  tournament.rounds.forEach((round) => {
    if (!round.scores?.[playerId]) return;
    const player = tournament.players.find(p => p.id === playerId);
    if (!player) return;
    const handicap = getPlayingHandicap(round, player);
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
      if (hole.number <= 3) warmup.push({ points, strokes: sc, par: hole.par, holeNumber: hole.number, courseName: round.courseName });
      else if (hole.number >= round.holes.length - 2) closing.push({ points, strokes: sc, par: hole.par, holeNumber: hole.number, courseName: round.courseName });
    });
  });
  const avg = (arr) => arr.length ? +(arr.reduce((s, h) => s + h.points, 0) / arr.length).toFixed(2) : 0;
  return {
    warmup: { avgPoints: avg(warmup), holes: warmup.length, breakdown: warmup },
    closing: { avgPoints: avg(closing), holes: closing.length, breakdown: closing },
    delta: +(avg(closing) - avg(warmup)).toFixed(2),
  };
}

// ── Handicap ROI ──
// A player whose handicap matches their level averages 36 Stableford points
// per 18-hole round. Actual / 36 gives a ROI ratio. >1.0 = outperformed
// handicap; <1.0 = underperformed.
export function handicapROI(tournament, playerId) {
  let totalPoints = 0, totalHoles = 0, rounds = 0;
  tournament.rounds.forEach(round => {
    if (!round.scores?.[playerId]) return;
    const player = tournament.players.find(p => p.id === playerId);
    if (!player) return;
    const handicap = getPlayingHandicap(round, player);
    let rp = 0, rh = 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      rp += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
      rh++;
    });
    if (rh > 0) { totalPoints += rp; totalHoles += rh; rounds++; }
  });
  if (rounds === 0) return null;
  const expected = 2 * totalHoles;
  return {
    actual: totalPoints,
    expected,
    ratio: expected > 0 ? +(totalPoints / expected).toFixed(2) : null,
    holesPlayed: totalHoles,
    rounds,
  };
}

// ── Nemesis & Crushed Hole ──
// For each player, the single worst (fewest points) and best (most points)
// hole they played, across the tournament. Ties broken by strokes above par.
export function playerNemesisAndCrushed(tournament) {
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, nemesis: null, crushed: null }; });
  forEachHole(tournament, ({ player, round, roundIndex, hole, strokes, points }) => {
    const entry = {
      roundIndex, courseName: round.courseName,
      holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
      strokes, points, vsPar: strokes - hole.par,
    };
    const rec = perPlayer[player.id];
    if (!rec.nemesis || entry.points < rec.nemesis.points || (entry.points === rec.nemesis.points && entry.vsPar > rec.nemesis.vsPar)) rec.nemesis = entry;
    if (!rec.crushed || entry.points > rec.crushed.points || (entry.points === rec.crushed.points && entry.vsPar < rec.crushed.vsPar)) rec.crushed = entry;
  });
  return Object.values(perPlayer).filter(r => r.nemesis && r.crushed);
}

// ── Chaos Holes ──
// Holes whose stroke counts among the group had the widest range. Useful for
// spotting holes that split the field. Returns top-5 by descending range.
export function chaosHoles(tournament) {
  const out = [];
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    round.holes.forEach(hole => {
      const scores = [];
      tournament.players.forEach(player => {
        const sc = round.scores[player.id]?.[hole.number];
        if (sc) {
          const handicap = getPlayingHandicap(round, player);
          const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
          scores.push({ playerId: player.id, playerName: player.name, strokes: sc, points });
        }
      });
      if (scores.length < 2) return;
      const strokeValues = scores.map(s => s.strokes);
      const range = Math.max(...strokeValues) - Math.min(...strokeValues);
      if (range === 0) return;
      out.push({
        roundIndex, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
        range, scores, minStrokes: Math.min(...strokeValues), maxStrokes: Math.max(...strokeValues),
      });
    });
  });
  return out.sort((a, b) => b.range - a.range).slice(0, 5);
}

// ── Collective Extremes ──
// Holes where every playing member tanked (0 points each) or every playing
// member scored ≥2 points.
export function collectiveExtremes(tournament) {
  const disasters = [], gimmes = [];
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    round.holes.forEach(hole => {
      const scores = [];
      tournament.players.forEach(player => {
        const sc = round.scores[player.id]?.[hole.number];
        if (!sc) return;
        const handicap = getPlayingHandicap(round, player);
        const pts = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        scores.push({ playerId: player.id, playerName: player.name, strokes: sc, points: pts });
      });
      if (scores.length < tournament.players.length) return;
      const entry = {
        roundIndex, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, scores,
      };
      if (scores.every(s => s.points === 0)) disasters.push(entry);
      if (scores.every(s => s.points >= 2)) gimmes.push(entry);
    });
  });
  return { disasters, gimmes };
}

// ── Pair Synergy ──
// Combined pair points vs a baseline equal to the sum of the two members'
// per-hole tournament averages (projected to the holes they played together).
// Ratio >1 means they lift each other; <1 means they drag each other down.
export function pairSynergy(tournament) {
  const playerAvg = {};
  const playerCount = {};
  tournament.players.forEach(p => { playerAvg[p.id] = 0; playerCount[p.id] = 0; });
  forEachHole(tournament, ({ player, points }) => {
    playerAvg[player.id] += points;
    playerCount[player.id]++;
  });
  tournament.players.forEach(p => {
    playerAvg[p.id] = playerCount[p.id] ? playerAvg[p.id] / playerCount[p.id] : 0;
  });

  const pairMap = {};
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores || !round.pairs) return;
    round.pairs.forEach(pair => {
      if (pair.length < 2) return;
      const key = [pair[0].id, pair[1].id].sort().join('|');
      if (!pairMap[key]) pairMap[key] = { members: [pair[0], pair[1]], combined: 0, expected: 0, rounds: 0, holesPlayed: 0 };
      let combined = 0, expected = 0, holes = 0;
      round.holes.forEach(hole => {
        const s1 = round.scores[pair[0].id]?.[hole.number];
        const s2 = round.scores[pair[1].id]?.[hole.number];
        if (!s1 || !s2) return;
        const h1 = getPlayingHandicap(round, tournament.players.find(p => p.id === pair[0].id));
        const h2 = getPlayingHandicap(round, tournament.players.find(p => p.id === pair[1].id));
        combined += calcStablefordPoints(hole.par, s1, h1, hole.strokeIndex);
        combined += calcStablefordPoints(hole.par, s2, h2, hole.strokeIndex);
        expected += playerAvg[pair[0].id] + playerAvg[pair[1].id];
        holes++;
      });
      if (holes > 0) {
        pairMap[key].combined += combined;
        pairMap[key].expected += expected;
        pairMap[key].rounds++;
        pairMap[key].holesPlayed += holes;
      }
    });
  });

  return Object.values(pairMap)
    .filter(p => p.holesPlayed > 0 && p.expected > 0)
    .map(p => ({
      members: p.members,
      rounds: p.rounds,
      combined: +p.combined.toFixed(1),
      expected: +p.expected.toFixed(1),
      synergy: +(p.combined / p.expected).toFixed(2),
      holesPlayed: p.holesPlayed,
    }))
    .sort((a, b) => b.synergy - a.synergy);
}

// ── Pair Carry Ratio ──
// Within every pair, what share of their combined Stableford points each
// member contributed. 0.5 is an even split. Higher = carried the pair.
export function pairCarryRatio(tournament) {
  const pairMap = {};
  tournament.rounds.forEach(round => {
    if (!round.scores || !round.pairs) return;
    round.pairs.forEach(pair => {
      if (pair.length < 2) return;
      const key = [pair[0].id, pair[1].id].sort().join('|');
      if (!pairMap[key]) pairMap[key] = { members: [pair[0], pair[1]], points: { [pair[0].id]: 0, [pair[1].id]: 0 }, holesPlayed: 0 };
      round.holes.forEach(hole => {
        const s1 = round.scores[pair[0].id]?.[hole.number];
        const s2 = round.scores[pair[1].id]?.[hole.number];
        if (!s1 || !s2) return;
        const h1 = getPlayingHandicap(round, tournament.players.find(p => p.id === pair[0].id));
        const h2 = getPlayingHandicap(round, tournament.players.find(p => p.id === pair[1].id));
        pairMap[key].points[pair[0].id] += calcStablefordPoints(hole.par, s1, h1, hole.strokeIndex);
        pairMap[key].points[pair[1].id] += calcStablefordPoints(hole.par, s2, h2, hole.strokeIndex);
        pairMap[key].holesPlayed++;
      });
    });
  });

  return Object.values(pairMap)
    .filter(p => p.holesPlayed > 0)
    .map(p => {
      const total = p.points[p.members[0].id] + p.points[p.members[1].id];
      const shareA = total > 0 ? p.points[p.members[0].id] / total : 0.5;
      const shareB = 1 - shareA;
      return {
        members: p.members,
        shares: [
          { player: p.members[0], points: p.points[p.members[0].id], share: +shareA.toFixed(2) },
          { player: p.members[1], points: p.points[p.members[1].id], share: +shareB.toFixed(2) },
        ],
        totalPoints: total,
        holesPlayed: p.holesPlayed,
        imbalance: +Math.abs(shareA - shareB).toFixed(2),
      };
    })
    .sort((a, b) => b.imbalance - a.imbalance);
}

// ── Swing Hole ──
// The single hole within the given round whose result shifted the cumulative
// pair-vs-pair points delta the most in magnitude. Returns null if the round
// has no pairs or no scores.
export function swingHole(tournament, roundIndex) {
  const data = pairDifferenceByHole(tournament, roundIndex, { metric: 'points' });
  if (!data) return null;
  let best = null;
  data.holes.forEach(h => {
    if (h.holeDelta == null) return;
    const magnitude = Math.abs(h.holeDelta);
    if (!best || magnitude > best.magnitude) best = { ...h, magnitude };
  });
  if (!best) return null;
  return {
    pair1: data.pair1, pair2: data.pair2,
    courseName: data.courseName,
    holeNumber: best.holeNumber, par: best.par,
    holeDelta: best.holeDelta,
    cumulativeAfter: best.cumulative,
    pair1Total: best.pair1Total,
    pair2Total: best.pair2Total,
  };
}

// ── Par-3 Heartbreak ──
// Player with the worst average strokes on par-3 holes. Par-3s should be
// the "free" holes but sometimes drown someone in sand.
export function par3Heartbreak(tournament) {
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, strokes: 0, holes: 0, points: 0, breakdown: [] }; });
  forEachHole(tournament, ({ player, round, roundIndex, hole, strokes, points }) => {
    if (hole.par !== 3) return;
    const rec = perPlayer[player.id];
    rec.strokes += strokes;
    rec.points += points;
    rec.holes++;
    rec.breakdown.push({ roundIndex, courseName: round.courseName, holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, strokes, points });
  });
  const candidates = Object.values(perPlayer).filter(r => r.holes > 0);
  if (candidates.length === 0) return null;
  const worst = candidates.reduce((best, r) => r.strokes / r.holes > best.strokes / best.holes ? r : best, candidates[0]);
  return {
    player: worst.player,
    avgStrokes: +(worst.strokes / worst.holes).toFixed(2),
    holes: worst.holes,
    totalPoints: worst.points,
    breakdown: worst.breakdown,
    all: candidates.map(r => ({ player: r.player, avgStrokes: +(r.strokes / r.holes).toFixed(2), holes: r.holes }))
      .sort((a, b) => b.avgStrokes - a.avgStrokes),
  };
}

// ── Pickup Champion ──
// Player with the most picked-up holes. A pickup is detected when the recorded
// strokes equal the deterministic pickup value (par + 2 + extra shots).
export function pickupChampion(tournament) {
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, pickups: 0, breakdown: [] }; });
  forEachHole(tournament, ({ player, round, roundIndex, hole, strokes, handicap }) => {
    if (strokes === pickupStrokes(hole.par, handicap, hole.strokeIndex) && strokes > hole.par + 1) {
      const rec = perPlayer[player.id];
      rec.pickups++;
      rec.breakdown.push({ roundIndex, courseName: round.courseName, holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, strokes, points: 0 });
    }
  });
  const candidates = Object.values(perPlayer).filter(r => r.pickups > 0);
  if (candidates.length === 0) return null;
  const max = Math.max(...candidates.map(r => r.pickups));
  const winners = candidates.filter(r => r.pickups === max);
  return { value: max, entries: winners, all: Object.values(perPlayer).sort((a, b) => b.pickups - a.pickups) };
}

// ── Anchor ──
// Player who was their pair's PB (worst ball) most often minus MB (best ball).
// Uses the tiebreaker rules in pairHoleWins.
export function anchor(tournament) {
  const stats = pairHoleWins(tournament, { metric: 'points' });
  const enriched = stats.map(r => {
    const mbCount = r.best.W + r.best.T + r.best.L;
    const pbCount = r.worst.W + r.worst.T + r.worst.L;
    return { player: r.player, mbCount, pbCount, anchorScore: pbCount - mbCount };
  });
  const candidates = enriched.filter(r => r.mbCount + r.pbCount > 0);
  if (candidates.length === 0) return null;
  const max = Math.max(...candidates.map(r => r.anchorScore));
  if (max <= 0) return null;
  const winners = candidates.filter(r => r.anchorScore === max);
  return { value: max, entries: winners, all: enriched.sort((a, b) => b.anchorScore - a.anchorScore) };
}

// ── Zero Hero ──
// Rounds in which a single player scored zero Stableford points on 3 or more
// holes. The "hero" here is ironic.
export function zeroHero(tournament) {
  const entries = [];
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    tournament.players.forEach(player => {
      if (!round.scores[player.id]) return;
      const handicap = getPlayingHandicap(round, player);
      const zeroHoles = [];
      round.holes.forEach(hole => {
        const sc = round.scores[player.id]?.[hole.number];
        if (!sc) return;
        const pts = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        if (pts === 0) zeroHoles.push({ roundIndex, courseName: round.courseName, holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, strokes: sc, points: 0 });
      });
      if (zeroHoles.length >= 3) {
        entries.push({ player, roundIndex, courseName: round.courseName, count: zeroHoles.length, breakdown: zeroHoles });
      }
    });
  });
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(e => e.count));
  return { value: max, entries: entries.sort((a, b) => b.count - a.count) };
}

// ── Skins Leaderboard ──
// Per-hole skins: the player with the strictly best score wins 1 skin. Ties
// award nothing (no carry-over to keep scoring simple and deterministic).
// Uses Stableford points in points mode, strokes in strokes mode.
export function skinsLeaderboard(tournament, { metric = 'points' } = {}) {
  const isStrokes = metric === 'strokes';
  const perPlayer = {};
  tournament.players.forEach(p => { perPlayer[p.id] = { player: p, skins: 0, ties: 0, breakdown: [] }; });
  const rounds = [];

  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    const roundRec = { roundIndex, courseName: round.courseName, skinsPerPlayer: {}, holes: [] };
    tournament.players.forEach(p => { roundRec.skinsPerPlayer[p.id] = 0; });

    round.holes.forEach(hole => {
      const candidates = [];
      tournament.players.forEach(player => {
        const sc = round.scores[player.id]?.[hole.number];
        if (!sc) return;
        const handicap = getPlayingHandicap(round, player);
        const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        candidates.push({ player, strokes: sc, points });
      });
      if (candidates.length < 2) return;
      const values = candidates.map(c => isStrokes ? c.strokes : c.points);
      const bestVal = isStrokes ? Math.min(...values) : Math.max(...values);
      const leaders = candidates.filter(c => (isStrokes ? c.strokes : c.points) === bestVal);

      const holeEntry = {
        roundIndex, courseName: round.courseName, holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
        bestVal, winner: leaders.length === 1 ? leaders[0].player : null,
        tiedLeaders: leaders.length > 1 ? leaders.map(l => l.player) : null,
        players: candidates.map(c => ({ playerId: c.player.id, playerName: c.player.name, strokes: c.strokes, points: c.points })),
      };
      roundRec.holes.push(holeEntry);

      if (leaders.length === 1) {
        const winner = leaders[0].player;
        perPlayer[winner.id].skins++;
        perPlayer[winner.id].breakdown.push(holeEntry);
        roundRec.skinsPerPlayer[winner.id]++;
      } else {
        leaders.forEach(l => { perPlayer[l.player.id].ties++; });
      }
    });
    rounds.push(roundRec);
  });

  return {
    leaderboard: Object.values(perPlayer).sort((a, b) => b.skins - a.skins),
    rounds,
    totalSkins: Object.values(perPlayer).reduce((s, p) => s + p.skins, 0),
  };
}

// ── Match Play Results (pair vs pair) ──
// Walks the holes of a round and tracks up/down between pair1 and pair2 using
// their combined stableford points per hole (or combined strokes when
// metric='strokes'). Returns the scoreline in classic match-play format.
export function matchPlayResults(tournament, { metric = 'points' } = {}) {
  const isStrokes = metric === 'strokes';
  return tournament.rounds.map((round, roundIndex) => {
    if (!round.scores || !round.pairs || round.pairs.length < 2) {
      return { roundIndex, courseName: round.courseName, available: false };
    }
    const [pair1, pair2] = round.pairs;
    if (pair1.length < 2 || pair2.length < 2) {
      return { roundIndex, courseName: round.courseName, available: false };
    }
    const sumPair = (pair, hole) => {
      let total = 0;
      for (const member of pair) {
        const player = tournament.players.find(p => p.id === member.id);
        const sc = round.scores[player?.id]?.[hole.number];
        if (!sc || !player) return null;
        if (isStrokes) total += sc;
        else total += calcStablefordPoints(hole.par, sc, getPlayingHandicap(round, player), hole.strokeIndex);
      }
      return total;
    };

    let pair1Up = 0; // pair1 holes won − pair2 holes won
    const holes = [];
    let closedAt = null, closedScore = null;
    const totalHoles = round.holes.length;
    round.holes.forEach((hole, hi) => {
      const p1 = sumPair(pair1, hole);
      const p2 = sumPair(pair2, hole);
      if (p1 == null || p2 == null) {
        holes.push({ holeNumber: hole.number, winner: null, pair1Score: p1, pair2Score: p2, pair1UpAfter: pair1Up });
        return;
      }
      const p1Better = isStrokes ? p1 < p2 : p1 > p2;
      const p2Better = isStrokes ? p2 < p1 : p2 > p1;
      let winner = null;
      if (p1Better) { pair1Up++; winner = 'pair1'; }
      else if (p2Better) { pair1Up--; winner = 'pair2'; }
      holes.push({ holeNumber: hole.number, winner, pair1Score: p1, pair2Score: p2, pair1UpAfter: pair1Up });
      const remaining = totalHoles - (hi + 1);
      if (closedAt === null && Math.abs(pair1Up) > remaining) {
        closedAt = hole.number;
        closedScore = { up: Math.abs(pair1Up), remaining, winner: pair1Up > 0 ? 'pair1' : 'pair2' };
      }
    });

    const winnerPair = pair1Up > 0 ? pair1 : pair1Up < 0 ? pair2 : null;
    const scoreline = closedScore
      ? `${closedScore.up}&${closedScore.remaining}`
      : pair1Up === 0 ? 'Halved' : `${Math.abs(pair1Up)} up`;

    return {
      roundIndex, courseName: round.courseName, available: true,
      pair1, pair2,
      pair1Up, finalPair1Up: pair1Up,
      holes, closedAt, closedScore, scoreline,
      winnerPair, metric,
    };
  });
}

// ── Pair Config Matrix ──
// For every 2-vs-2 pair configuration encountered, aggregates hole-by-hole
// W/T/L between the two sides using combined stableford points. Each round's
// pairing defines one config; rounds using the same config accumulate.
export function pairConfigMatrix(tournament) {
  const configs = {};
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores || !round.pairs || round.pairs.length < 2) return;
    const [pair1, pair2] = round.pairs;
    if (pair1.length < 2 || pair2.length < 2) return;
    const sideA = [pair1[0].id, pair1[1].id].sort();
    const sideB = [pair2[0].id, pair2[1].id].sort();
    const key = [sideA.join('+'), sideB.join('+')].sort().join(' vs ');
    if (!configs[key]) configs[key] = { sideA: pair1, sideB: pair2, holeWins: { A: 0, B: 0, T: 0 }, pointsA: 0, pointsB: 0, rounds: [] };

    const cur = configs[key];
    let roundA = 0, roundB = 0, roundT = 0, roundPtsA = 0, roundPtsB = 0;
    round.holes.forEach(hole => {
      let aPts = 0, bPts = 0, complete = true;
      for (const member of pair1) {
        const player = tournament.players.find(p => p.id === member.id);
        const sc = round.scores[player?.id]?.[hole.number];
        if (!sc || !player) { complete = false; break; }
        aPts += calcStablefordPoints(hole.par, sc, getPlayingHandicap(round, player), hole.strokeIndex);
      }
      if (!complete) return;
      for (const member of pair2) {
        const player = tournament.players.find(p => p.id === member.id);
        const sc = round.scores[player?.id]?.[hole.number];
        if (!sc || !player) { complete = false; break; }
        bPts += calcStablefordPoints(hole.par, sc, getPlayingHandicap(round, player), hole.strokeIndex);
      }
      if (!complete) return;
      roundPtsA += aPts; roundPtsB += bPts;
      if (aPts > bPts) { cur.holeWins.A++; roundA++; }
      else if (bPts > aPts) { cur.holeWins.B++; roundB++; }
      else { cur.holeWins.T++; roundT++; }
    });
    cur.pointsA += roundPtsA; cur.pointsB += roundPtsB;
    cur.rounds.push({ roundIndex, courseName: round.courseName, wins: { A: roundA, B: roundB, T: roundT }, points: { A: roundPtsA, B: roundPtsB } });
  });

  return Object.values(configs).map(c => ({
    ...c,
    totalHoles: c.holeWins.A + c.holeWins.B + c.holeWins.T,
    pointDiff: c.pointsA - c.pointsB,
  }));
}

// ── Shot Stats (putts / driver direction / penalties) ──
//
// Aggregates the per-hole shot detail recorded for a single player
// (round.shotDetails[playerId][holeNumber]) across every round. Driver
// accuracy excludes par 3s — there is no driver off that tee. Returns a
// plain object; an empty `hasData` flag lets the UI show a prompt.
export function shotStats(tournament, playerId) {
  const rounds = tournament?.rounds ?? [];
  let puttsTotal = 0, holesWithPutts = 0, onePutts = 0, threePuttPlus = 0;
  let drivesRecorded = 0, fairwaysHit = 0;
  const driveDistribution = { fairway: 0, left: 0, right: 0, short: 0, super: 0 };
  let teePenalties = 0, otherPenalties = 0;
  let girHoles = 0, girEligible = 0;
  let roundsWithData = 0;

  rounds.forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    let roundHasData = false;
    (round.holes ?? []).forEach((hole) => {
      const d = byHole[hole.number];
      if (!d) return;
      if (d.putts != null || d.drive != null
        || (d.teePenalties ?? 0) > 0 || (d.otherPenalties ?? 0) > 0) {
        roundHasData = true;
      }
      if (d.putts != null) {
        puttsTotal += d.putts;
        holesWithPutts += 1;
        if (d.putts === 1) onePutts += 1;
        if (d.putts >= 3) threePuttPlus += 1;
      }
      if (d.drive != null && hole.par !== 3) {
        drivesRecorded += 1;
        if (driveDistribution[d.drive] != null) driveDistribution[d.drive] += 1;
        if (d.drive === 'fairway' || d.drive === 'super') fairwaysHit += 1;
      }
      teePenalties += d.teePenalties ?? 0;
      otherPenalties += d.otherPenalties ?? 0;

      // Green in regulation: reached the green with at least two strokes
      // left for putting (strokes − putts ≤ par − 2).
      const strokes = round?.scores?.[playerId]?.[hole.number];
      if (strokes != null && d.putts != null) {
        girEligible += 1;
        if ((strokes - d.putts) <= (hole.par - 2)) girHoles += 1;
      }
    });
    if (roundHasData) roundsWithData += 1;
  });

  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    hasData: holesWithPutts > 0 || drivesRecorded > 0
      || teePenalties > 0 || otherPenalties > 0,
    roundsWithData,
    putts: {
      total: puttsTotal,
      holes: holesWithPutts,
      perHole: holesWithPutts > 0 ? round1(puttsTotal / holesWithPutts) : 0,
      perRound: roundsWithData > 0 ? round1(puttsTotal / roundsWithData) : 0,
      onePutts,
      threePuttPlus,
    },
    drives: {
      recorded: drivesRecorded,
      fairwaysHit,
      fairwayPct: drivesRecorded > 0 ? Math.round((fairwaysHit / drivesRecorded) * 100) : 0,
      distribution: driveDistribution,
    },
    penalties: {
      tee: teePenalties,
      other: otherPenalties,
      total: teePenalties + otherPenalties,
    },
    gir: {
      holes: girHoles,
      eligible: girEligible,
      pct: girEligible > 0 ? Math.round((girHoles / girEligible) * 100) : 0,
    },
  };
}
